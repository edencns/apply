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
import { extractText, getDocumentProxy } from 'unpdf';

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

/** 텍스트에서 모든 날짜(ISO 형식)를 offset과 함께 추출
 *  지원 포맷:
 *   - '26.03.27 / '26.03.27 / ‘26.03.27 / ’26.03.27 (2자리 연도, 각종 따옴표)
 *   - 2026.03.27 / 2026-03-27 / 2026/03/27
 *   - 2026년 3월 27일
 */
interface DateMatch { iso: string; offset: number; raw: string; }

function findAllDates(text: string): DateMatch[] {
  const results: DateMatch[] = [];
  const push = (y: string, mo: string, d: string, offset: number, raw: string) => {
    let yy = y.length === 2 ? `20${y}` : y;
    const yi = parseInt(yy, 10);
    if (yi < 2020 || yi > 2035) return; // sanity
    const iso = `${yy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`;
    results.push({ iso, offset, raw });
  };

  // 1) `'YY.MM.DD` — straight(') or curly(‘’) quote prefix
  const re1 = /['\u2018\u2019](\d{2})\.(\d{1,2})\.(\d{1,2})/g;
  // 2) `YYYY.MM.DD` / `YYYY-MM-DD` / `YYYY/MM/DD`
  const re2 = /\b(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/g;
  // 3) `YYYY년 MM월 DD일`
  const re3 = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;

  let m: RegExpExecArray | null;
  while ((m = re1.exec(text)) !== null) push(m[1], m[2], m[3], m.index, m[0]);
  while ((m = re2.exec(text)) !== null) push(m[1], m[2], m[3], m.index, m[0]);
  while ((m = re3.exec(text)) !== null) push(m[1], m[2], m[3], m.index, m[0]);

  // offset 기준 정렬 + 동일 오프셋 중복 제거
  results.sort((a, b) => a.offset - b.offset);
  const dedup: DateMatch[] = [];
  for (const r of results) {
    if (!dedup.length || Math.abs(dedup[dedup.length - 1].offset - r.offset) > 2) dedup.push(r);
  }
  return dedup;
}

/** 시간까지 포함해 특정 시각 키워드 근처에서 시분을 추출 (예: "오전 10시" → 10:00) */
function extractTimeNearOffset(text: string, offset: number, range = 80): { h: number; m: number } | null {
  const slice = text.slice(offset, offset + range);
  const m = slice.match(/(오전|오후)?\s*(\d{1,2})\s*(?:시|:)\s*(\d{1,2})?/);
  if (!m) return null;
  let h = parseInt(m[2], 10);
  const mi = parseInt(m[3] || '0', 10);
  if (m[1] === '오후' && h < 12) h += 12;
  if (m[1] === '오전' && h === 12) h = 0;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, m: mi };
}

function withTime(iso: string, t: { h: number; m: number } | null): string {
  if (!t) return iso.replace('T00:00:00', 'T00:00');
  const d = iso.split('T')[0];
  return `${d}T${t.h.toString().padStart(2, '0')}:${t.m.toString().padStart(2, '0')}`;
}

/** 모집공고 일정표(헤더 → 일정 행) 파싱.
 *  예) "구분 입주자모집공고일 특별공급 접수일 일반공급 1순위 접수일 일반공급 2순위 접수일 당첨자발표일 서류접수 계약체결
 *       일정 '26.03.27.(금) '26.04.06.(월) '26.04.07.(화) '26.04.08.(수) '26.04.14.(화) '26.04.18.(토)~ '26.04.21.(화) '26.04.27.(월)~ '26.04.29.(수)"
 */
interface Schedule {
  applicationStart?: string;
  applicationEnd?: string;
  winnerAnnounceDate?: string;
  contractStart?: string;
  contractEnd?: string;
}

function parseScheduleTable(text: string, allDates: DateMatch[]): Schedule {
  // 헤더행을 '입주자모집공고일 ... 계약체결' 시퀀스로 찾는다 (최대 300자)
  const headerRe = /입주자모집공고일[\s\S]{0,300}?계약체결/;
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return {};
  const headerEnd = (headerMatch.index || 0) + headerMatch[0].length;

  // 헤더 직후 800자 구간의 날짜들만 테이블 값으로 본다
  const zoneStart = headerEnd;
  const zoneEnd = headerEnd + 900;
  const zoneDates = allDates.filter(d => d.offset >= zoneStart && d.offset < zoneEnd);
  if (zoneDates.length < 4) return {};

  // 컬럼 해석 (9개 최대: 공고, 특공, 1순위, 2순위, 당발, 서류시작, 서류끝, 계약시작, 계약끝)
  // 일부 현장은 서류접수 또는 계약체결이 단일 날짜이거나 생략될 수 있음 → 보수적으로 매핑
  const d = zoneDates.map(x => x.iso);
  const sched: Schedule = {};

  // [0]=공고일, [1]=특공 첫날, [2]=1순위, [3]=2순위, [4]=당첨발표, 이후는 가변
  sched.applicationStart = d[1] || d[0];       // 특별공급 접수 시작
  sched.applicationEnd   = d[3] || d[2] || d[1]; // 일반 2순위 (또는 1순위) = 접수 마지막
  sched.winnerAnnounceDate = d[4];

  // 당첨발표 이후 날짜들 = [서류시작, 서류끝, 계약시작, 계약끝] 또는 축약형
  const tail = d.slice(5);
  if (tail.length >= 4) {
    sched.contractStart = tail[2];
    sched.contractEnd = tail[3];
  } else if (tail.length === 3) {
    sched.contractStart = tail[1];
    sched.contractEnd = tail[2];
  } else if (tail.length === 2) {
    sched.contractStart = tail[0];
    sched.contractEnd = tail[1];
  } else if (tail.length === 1) {
    sched.contractStart = tail[0];
  }

  return sched;
}

/** 테이블 파싱 실패 시, 키워드 근처 날짜로 폴백 */
function findDateNearKeyword(text: string, allDates: DateMatch[], keywords: string[], maxDistance = 200): string | null {
  // 첫 번째 키워드가 실제 표에서 등장하는 위치를 찾는다
  // "입주자모집공고일 현재" 같은 본문 false positive를 피하기 위해 키워드 뒤에 날짜가 있는 경우만
  for (const kw of keywords) {
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(kw, searchFrom);
      if (idx < 0) break;
      const near = allDates.find(d => d.offset > idx && d.offset - idx < maxDistance);
      if (near) return near.iso;
      searchFrom = idx + kw.length;
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

    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const fullText: string = Array.isArray(text) ? text.join('\n') : (text || '');

    if (!fullText.trim()) {
      return NextResponse.json({ error: '텍스트 추출 실패 — 이미지 기반 PDF일 수 있습니다.' }, { status: 422 });
    }

    // 1) 전체 날짜 인덱스 (offset 포함)
    const allDates = findAllDates(fullText);

    // 2) 일정표 구조 파싱 (최우선)
    const schedule = parseScheduleTable(fullText, allDates);

    // 3) 실패 시 키워드 근접 탐색으로 폴백
    const appStart = schedule.applicationStart
      || findDateNearKeyword(fullText, allDates, ['특별공급 접수', '특별공급접수', '청약접수', '청약 접수', '1순위 접수']) || undefined;
    const appEnd = schedule.applicationEnd
      || findDateNearKeyword(fullText, allDates, ['2순위 접수', '접수 마감', '청약 마감']) || undefined;
    const winDate = schedule.winnerAnnounceDate
      || findDateNearKeyword(fullText, allDates, ['당첨자발표일', '당첨자발표', '당첨자 발표']) || undefined;
    const conStart = schedule.contractStart
      || findDateNearKeyword(fullText, allDates, ['계약체결', '계약 체결', '계약기간', '계약 기간']) || undefined;
    const conEnd = schedule.contractEnd || undefined;

    // 4) 시:분은 본문의 "청약접수 ... 오전 10시" 같은 문구에서 별도 보강
    const applyOpen = fullText.match(/(?:청약\s*접수|청약접수)[\s\S]{0,120}?(오전|오후)\s*(\d{1,2})\s*(?:시|:)/);
    const applyClose = fullText.match(/(?:접수\s*마감|마감\s*시간)[\s\S]{0,60}?(오전|오후)\s*(\d{1,2})\s*(?:시|:)/);

    const applyH = (m: RegExpMatchArray | null) => {
      if (!m) return null;
      let h = parseInt(m[2], 10);
      if (m[1] === '오후' && h < 12) h += 12;
      if (m[1] === '오전' && h === 12) h = 0;
      return { h, m: 0 };
    };

    const parsed: ParsedAnnouncement = {
      title: extractTitle(fullText, file.name),
      announcementNo: extractAnnouncementNo(fullText, file.name),
      applicationStart: appStart ? withTime(appStart, applyH(applyOpen)) : undefined,
      applicationEnd:   appEnd   ? withTime(appEnd,   applyH(applyClose)) : undefined,
      winnerAnnounceDate: winDate ? withTime(winDate, null) : undefined,
      contractStart: conStart ? withTime(conStart, null) : undefined,
      contractEnd:   conEnd   ? withTime(conEnd, null) : undefined,
      region: extractRegion(fullText),
      noHomeRequired: /무주택\s*세대구성원/.test(fullText),
      minSubscriptionMonths: extractMinSubscription(fullText),
      specialTypes: extractSpecialTypes(fullText),
      rawTextPreview: fullText.slice(0, 500),
    };

    return NextResponse.json({ success: true, data: parsed, totalPages });
  } catch (err: any) {
    console.error('[parse-announcement-pdf]', err);
    return NextResponse.json({ error: err?.message || 'PDF 파싱 실패' }, { status: 500 });
  }
}
