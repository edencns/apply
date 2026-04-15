/**
 * 청약 공고 PDF 업로드 → 텍스트 추출 → 주요 필드 regex 파싱
 *
 * 반환 필드:
 *  - title           : 단지명 (파일명 또는 첫 페이지에서 추정)
 *  - announcementNo  : 공고번호 (10자리 또는 "YYYY-XXXXX")
 *  - applicationStart/End, winnerAnnounceDate, contractStart/End  (YYYY-MM-DDTHH:mm)
 *  - region          : 공급위치(시·도·구·동)
 *  - noHomeRequired  : 무주택세대구성원 문구 포함 여부
 *  - minSubscription : 청약통장 가입기간 최소 (개월)
 *  - specialTypes    : 특별공급 유형 목록
 *
 * LLM 의존성 없음 — 서버리스에서 안정적으로 동작.
 */

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore - pdf-parse v2는 타입 없음
import pdfParse from 'pdf-parse';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ParsedAnnouncement {
  title?: string;
  announcementNo?: string;
  applicationStart?: string;
  applicationEnd?: string;
  winnerAnnounceDate?: string;
  contractStart?: string;
  contractEnd?: string;
  region?: string;
  noHomeRequired?: boolean;
  minSubscriptionMonths?: number;
  specialTypes?: string[];
  rawTextPreview?: string;
}

/** "2026년 03월 27일 10:00" / "2026.03.27" / "2026-03-27" 같은 한글/숫자 날짜를 ISO로 */
function parseKoreanDate(s: string): string | null {
  // 2026년 03월 27일 [오전/오후] HH시MM분
  const m1 = s.match(/(\d{4})[년.\-\/\s]+(\d{1,2})[월.\-\/\s]+(\d{1,2})\D*?(?:(오전|오후)\s*)?(\d{1,2})?(?:시\s*)?(\d{1,2})?/);
  if (m1) {
    const [, y, mo, d, ampm, hRaw, mi] = m1;
    let h = parseInt(hRaw || '0', 10);
    if (ampm === '오후' && h < 12) h += 12;
    if (ampm === '오전' && h === 12) h = 0;
    const mm = (parseInt(mi || '0', 10) || 0).toString().padStart(2, '0');
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.toString().padStart(2, '0')}:${mm}`;
  }
  return null;
}

/** 라인 단위로 "키:값" 또는 "키 ... 2026.03.27" 형태에서 날짜 찾기 */
function findDateNearKeyword(text: string, keywords: string[]): string | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (keywords.some(k => ln.includes(k))) {
      // 같은 라인 또는 다음 3줄 안에서 날짜 찾기
      const block = [ln, lines[i + 1] || '', lines[i + 2] || '', lines[i + 3] || ''].join(' ');
      const parsed = parseKoreanDate(block);
      if (parsed) return parsed;
    }
  }
  return null;
}

function extractTitle(text: string, filename: string): string | undefined {
  // 우선 파일명에서 추출: "2026000070 힐스테이트 안양펠루스 입주자모집공고문.pdf"
  const fnameClean = filename.replace(/\.pdf$/i, '').replace(/입주자모집공고문?/g, '').replace(/\(.*?\)/g, '').trim();
  // 앞의 공고번호 숫자 제거
  const withoutNo = fnameClean.replace(/^\d{10,}\s*/, '').replace(/^\d{4}-\d{4,}\s*/, '').trim();
  if (withoutNo && withoutNo.length >= 3) return withoutNo;

  // 본문에서 "단지명" 또는 "아파트" 포함 첫 줄
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3 && l.length < 60);
  for (const ln of lines) {
    if (/(아파트|오피스텔|힐스테이트|푸르지오|자이|래미안|더샵|디에트르|트리마제)/.test(ln)) {
      return ln.replace(/입주자모집공고.*/, '').trim();
    }
  }
  return fnameClean || undefined;
}

function extractAnnouncementNo(text: string, filename: string): string | undefined {
  // 파일명 우선
  const fm = filename.match(/(\d{10})/);
  if (fm) return fm[1];
  // 본문 "주택관리번호" / "공고번호" 근처 10자리 숫자
  const bodyMatch = text.match(/(?:주택관리번호|공고번호)\D{0,20}(\d{10})/);
  if (bodyMatch) return bodyMatch[1];
  // fallback: 첫 10자리
  const any = text.match(/\b(\d{10})\b/);
  return any?.[1];
}

function extractRegion(text: string): string | undefined {
  // "공급위치 : 경기도 안양시 만안구 안양동 395-1번지"
  const m = text.match(/공급위치\s*[:：]?\s*([가-힣\d\s\-·]+?)(?:\n|번지|일대|$)/);
  if (m) return m[1].trim().slice(0, 60);
  const m2 = text.match(/([가-힣]+(?:특별시|광역시|특별자치시|도)\s+[가-힣]+(?:시|군|구)(?:\s+[가-힣]+(?:구|동|읍|면))?)/);
  return m2?.[1];
}

function extractMinSubscription(text: string): number | undefined {
  // "청약통장 가입기간 6개월" / "가입 후 12개월 이상"
  const m = text.match(/(?:청약통장|가입기간|가입\s*후)\D{0,20}(\d{1,3})\s*개월/);
  if (m) return parseInt(m[1], 10);
  return undefined;
}

function extractSpecialTypes(text: string): string[] {
  const types: string[] = [];
  const normalized = text.replace(/\s+/g, ' ');
  const checks: Array<[string, RegExp]> = [
    ['다자녀가구', /다자녀\s*가구/],
    ['신혼부부', /신혼부부/],
    ['생애최초', /생애\s*최초/],
    ['노부모부양', /노부모\s*부양/],
    ['기관추천', /기관\s*추천/],
    ['신생아', /신생아/],
  ];
  for (const [name, re] of checks) {
    const matches = normalized.match(new RegExp(re.source, 'g'));
    // 2회 이상 등장 + 해당없음 명시 없으면 채택
    if (matches && matches.length >= 2) {
      const negRe = new RegExp(re.source + '\\s*[^가-힣]*(?:해당\\s*없음|미시행|미실시)');
      if (!negRe.test(normalized)) types.push(name);
    }
  }
  return types;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'PDF 파일이 없습니다.' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'PDF 파일만 업로드 가능합니다.' }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const pdfData = await pdfParse(buf);
    const fullText: string = pdfData.text || '';

    if (!fullText.trim()) {
      return NextResponse.json({ error: '텍스트 추출 실패 — 이미지 기반 PDF일 수 있습니다.' }, { status: 422 });
    }

    const parsed: ParsedAnnouncement = {
      title: extractTitle(fullText, file.name),
      announcementNo: extractAnnouncementNo(fullText, file.name),
      applicationStart:
        findDateNearKeyword(fullText, ['청약접수', '청약 접수', '신청접수', '특별공급 청약', '1순위']) || undefined,
      applicationEnd:
        findDateNearKeyword(fullText, ['접수 마감', '청약 마감', '기타지역', '2순위']) || undefined,
      winnerAnnounceDate:
        findDateNearKeyword(fullText, ['당첨자발표', '당첨자 발표', '당첨 발표']) || undefined,
      contractStart:
        findDateNearKeyword(fullText, ['계약체결', '계약 체결', '계약기간', '계약 기간']) || undefined,
      contractEnd: undefined,
      region: extractRegion(fullText),
      noHomeRequired: /무주택\s*세대구성원/.test(fullText),
      minSubscriptionMonths: extractMinSubscription(fullText),
      specialTypes: extractSpecialTypes(fullText),
      rawTextPreview: fullText.slice(0, 500),
    };

    return NextResponse.json({ success: true, data: parsed, totalPages: pdfData.numpages });
  } catch (err: any) {
    console.error('[parse-announcement-pdf]', err);
    return NextResponse.json({ error: err?.message || 'PDF 파싱 실패' }, { status: 500 });
  }
}
