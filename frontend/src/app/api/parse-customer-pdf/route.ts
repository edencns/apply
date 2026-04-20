/**
 * 고객 PDF 업로드 → 텍스트 추출 → regex + Groq LLM 하이브리드 파싱
 *
 * 지원 문서: 주민등록등본, 주민등록초본, 가족관계증명서, 혼인관계증명서, 청약신청서 등
 *
 * 반환 필드:
 *  - name, rrnFront, rrnBack, phone, address
 *  - dependentsCount, noHomeYears, subscriptionMonths
 *  - currentRegion, specialTypes
 */

import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { extractKoreanPdfText } from '@/lib/pdf-helper';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ParsedCustomer {
  name?: string;
  rrnFront?: string;
  rrnBack?: string;
  phone?: string;
  address?: string;
  dependentsCount?: number;
  noHomeYears?: number;
  subscriptionMonths?: number;
  currentRegion?: string;
  specialTypes?: string[];
  rawTextPreview?: string;
}

/* ─── Regex helpers ──────────────────────────────── */

function extractName(text: string): string | undefined {
  // "성    명 : 홍길동" / "성명 홍길동" / "이름: 홍길동"
  const patterns = [
    /성\s*명\s*[:：]?\s*([가-힣]{2,4})/,
    /이\s*름\s*[:：]?\s*([가-힣]{2,4})/,
    /세대주\s*[:：]?\s*([가-힣]{2,4})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return undefined;
}

function extractRRN(text: string): { front?: string; back?: string } {
  // "주민등록번호 : 901231-1234567" or "901231-1******"
  const m = text.match(/(\d{6})\s*[-–]\s*([\d*]{7})/);
  if (!m) return {};
  return {
    front: m[1],
    back: m[2].replace(/\*/g, ""),
  };
}

function extractPhone(text: string): string | undefined {
  // 010-1234-5678 / 01012345678
  const m = text.match(/(01[016789])\s*[-. ]?\s*(\d{3,4})\s*[-. ]?\s*(\d{4})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

function extractAddress(text: string): string | undefined {
  // "주    소 : 서울특별시 강남구 역삼동 123..."
  const m = text.match(/주\s*소\s*[:：]?\s*((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n]{5,80})/);
  return m ? m[1].trim() : undefined;
}

function extractRegion(address?: string): string | undefined {
  if (!address) return undefined;
  const m = address.match(/^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/);
  return m ? m[1] : undefined;
}

function extractDependents(text: string): number | undefined {
  // 등본 상 세대원 수 추출 — 세대 구성 테이블에서 행 수를 세거나, "세대원 수" 명시값
  const m = text.match(/세대원\s*(?:수|인원)\s*[:：]?\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  return undefined;
}

/* ─── LLM parsing ─────────────────────────────────── */

async function parseWithLLM(text: string): Promise<Partial<ParsedCustomer>> {
  if (!process.env.GROQ_API_KEY) return {};
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const truncated = text.slice(0, 8000);

  try {
    const r = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            '당신은 한국어 주민등록등본/가족관계증명서/청약신청서를 파싱해 JSON으로 변환하는 전문가입니다. 모든 필드는 추출 가능한 경우에만 포함하고 알 수 없으면 null을 반환하세요.',
        },
        {
          role: 'user',
          content: `다음 문서에서 고객 정보를 추출해 JSON으로 반환하세요.

스키마:
{
  "name": string | null,                 // 신청자 성명 (세대주 또는 본인)
  "rrnFront": string | null,             // 주민번호 앞 6자리
  "rrnBack": string | null,              // 주민번호 뒷 7자리 (마스킹이면 null)
  "phone": string | null,                // 연락처
  "address": string | null,              // 주소 전체
  "dependentsCount": number | null,      // 부양가족 수 (세대주 제외한 세대원 수)
  "noHomeYears": number | null,          // 무주택 기간 (년)
  "subscriptionMonths": number | null,   // 청약통장 가입 개월
  "currentRegion": string | null,        // 현재 거주 광역시/도
  "specialTypes": string[] | null        // 해당 특별공급 유형 (신혼부부, 생애최초, 다자녀가구, 노부모부양, 기관추천)
}

문서:
${truncated}`,
        },
      ],
    });

    const content = r.choices[0]?.message?.content;
    if (!content) return {};
    const json = JSON.parse(content);
    return {
      name: json.name || undefined,
      rrnFront: json.rrnFront || undefined,
      rrnBack: json.rrnBack || undefined,
      phone: json.phone || undefined,
      address: json.address || undefined,
      dependentsCount: typeof json.dependentsCount === 'number' ? json.dependentsCount : undefined,
      noHomeYears: typeof json.noHomeYears === 'number' ? json.noHomeYears : undefined,
      subscriptionMonths: typeof json.subscriptionMonths === 'number' ? json.subscriptionMonths : undefined,
      currentRegion: json.currentRegion || undefined,
      specialTypes: Array.isArray(json.specialTypes) ? json.specialTypes : undefined,
    };
  } catch (err) {
    console.error('[parse-customer-pdf] LLM failed', err);
    return {};
  }
}

/* ─── 당첨자 명단 (배치) 파싱 ────────────────────────── */

/**
 * 한국부동산원 당첨자 명단 PDF 포맷 감지.
 * 한 줄에 [순번 주택형 공급종류 동 호 성명 주민번호 전화번호] 형태의 행이 반복된다.
 */
function detectWinnerListFormat(text: string): boolean {
  if (!text) return false;
  const keywords = ['당첨자 명단', '특별공급 당첨자', '일반공급 당첨자', '순번', '주택형'];
  const matchCount = keywords.filter((k) => text.includes(k)).length;
  return matchCount >= 3;
}

/** 당첨자 명단 행 파싱 — 각 당첨자를 고객 1건으로 변환 */
function parseWinnerRows(text: string): ParsedCustomer[] {
  const customers: ParsedCustomer[] = [];
  // 예시: "1 059.9660 생애최초특별공급 103 401 김*형 961101-1****** 010-2698-7887"
  //       "23 077.8300A 신혼부부특별공급 101 2105 정*호 880711-1****** 010-6271-9990"
  // 또는 일반공급: "1 059.9660 20240000001 103 401 김*형 961101-1****** 010-2698-7887 국민은행 주택청약저축 ..."
  // 순번(숫자) + 주택형(소수점 가능) + 타입/접수번호 + 동 + 호 + 이름(한글+별표) + 주민번호 + 전화
  const rowRegex = /(\d+)\s+([\d.]+[A-Z]?)\s+(\S+?(?:특별공급|\d{10,}))\s+(\d+)\s+(\d+)\s+([가-힣*]+)\s+(\d{6})[-–]([\d*]{7})\s+(01[016789]\s*[-. ]?\s*\d{3,4}\s*[-. ]?\s*\d{4})/g;

  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = rowRegex.exec(text)) !== null) {
    const [, , housingType, supplyRaw, dong, ho, name, rrnFront, , phoneRaw] = m;
    // 중복 방지 (같은 성명+전화)
    const key = `${name}:${phoneRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // 공급 종류 정리
    let specialType: string | null = null;
    if (supplyRaw.includes('신혼부부')) specialType = '신혼부부';
    else if (supplyRaw.includes('생애최초')) specialType = '생애최초';
    else if (supplyRaw.includes('다자녀')) specialType = '다자녀가구';
    else if (supplyRaw.includes('노부모')) specialType = '노부모부양';
    else if (supplyRaw.includes('기관추천')) specialType = '기관추천';
    else if (supplyRaw.includes('신생아')) specialType = '신생아';

    const phone = phoneRaw.replace(/\s+/g, '').replace(/[.]/g, '-');

    customers.push({
      name,
      rrnFront,
      rrnBack: undefined, // 마스킹되어 있음
      phone,
      specialTypes: specialType ? [specialType] : undefined,
    });
  }
  return customers;
}

/* ─── POST handler ────────────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'file 필드가 필요합니다' }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const text = await extractKoreanPdfText(buf);

    if (!text || text.trim().length < 10) {
      return NextResponse.json(
        { error: 'PDF에서 텍스트를 추출할 수 없습니다. 스캔본이거나 특수 폰트가 사용된 경우입니다.' },
        { status: 422 },
      );
    }

    // 당첨자 명단 포맷이면 배치 파싱
    if (detectWinnerListFormat(text)) {
      const customers = parseWinnerRows(text);
      if (customers.length > 0) {
        return NextResponse.json({
          mode: 'batch',
          count: customers.length,
          customers,
          rawTextPreview: text.slice(0, 500),
        });
      }
    }

    // 단일 고객 문서 (주민등록등본 등) 파싱
    // 1단계: regex
    const rrn = extractRRN(text);
    const address = extractAddress(text);
    const regex: Partial<ParsedCustomer> = {
      name: extractName(text),
      rrnFront: rrn.front,
      rrnBack: rrn.back,
      phone: extractPhone(text),
      address,
      currentRegion: extractRegion(address),
      dependentsCount: extractDependents(text),
    };

    // 2단계: LLM으로 보강
    const llm = await parseWithLLM(text);

    // 병합 — regex 결과 우선, 없으면 LLM 결과
    const merged: ParsedCustomer = {
      name: regex.name || llm.name,
      rrnFront: regex.rrnFront || llm.rrnFront,
      rrnBack: regex.rrnBack || llm.rrnBack,
      phone: regex.phone || llm.phone,
      address: regex.address || llm.address,
      currentRegion: regex.currentRegion || llm.currentRegion,
      dependentsCount: regex.dependentsCount ?? llm.dependentsCount,
      noHomeYears: llm.noHomeYears,
      subscriptionMonths: llm.subscriptionMonths,
      specialTypes: llm.specialTypes,
      rawTextPreview: text.slice(0, 500),
    };

    return NextResponse.json({ mode: 'single', ...merged });
  } catch (err: any) {
    console.error('[parse-customer-pdf] error', err);
    return NextResponse.json(
      { error: err?.message || 'PDF 파싱 실패' },
      { status: 500 },
    );
  }
}
