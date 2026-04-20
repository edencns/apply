/**
 * 청약 공고 PDF 업로드 → 텍스트 추출 → regex + Groq LLM 하이브리드 파싱
 *
 * 파싱 전략:
 *  1단계: regex로 확정적 필드 추출 (날짜, 공고번호, 지역 등)
 *  2단계: 텍스트를 섹션 분리 → Groq Llama 3.3 70B에 전송 → 구조화 JSON
 *  3단계: regex + LLM 결과 병합, LLM 실패 시 regex fallback
 *
 * 반환 필드:
 *  - title, announcementNo, region, dates (applicationStart/End, winner, contract)
 *  - noHomeRequired, minSubscriptionMonths
 *  - specialTypes: 특별공급 유형 목록
 *  - supplyTypes: 공급유형별 상세 조건 (소득기준, 자산한도, 필요서류 등)
 *  - exclusiveAreas: 전용면적별 공급세대 정보
 *  - requiredDocuments: 공급유형별 필요 서류 목록
 */

import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { extractKoreanPdfText } from '@/lib/pdf-helper';

export const runtime = 'nodejs';
export const maxDuration = 120;

/* ─────────────────────────────────────────────
   Types
   ───────────────────────────────────────────── */

interface ParsedAnnouncement {
  title?: string;
  announcementNo?: string;
  applicationStart?: string;
  applicationEnd?: string;
  winnerAnnounceDate?: string;
  docSubmitStart?: string;
  docSubmitEnd?: string;
  contractStart?: string;
  contractEnd?: string;
  region?: string;
  totalUnits?: number;
  noHomeRequired?: boolean;
  minSubscriptionMonths?: number;
  specialTypes?: string[];
  // ── LLM 확장 필드 ──
  supplyTypes?: SupplyTypeDetail[];
  exclusiveAreas?: ExclusiveArea[];
  requiredDocuments?: Record<string, string[]>;
  incomeTable?: Record<string, Record<string, number>>;
  assetLimit?: string;
  carValueLimit?: string;
  resaleRestriction?: string;
  reWinRestriction?: string;
  residenceObligation?: string;
  priceCapApplied?: boolean;
  landType?: string;
  moveInDate?: string;
  pointSystemRatio?: { ratio: string; items?: string[] };
  announcementDate?: string;  // 공고일
  specialApplyDate?: string;  // 특별공급 접수일
  general1stDate?: string;    // 1순위 접수일
  general2ndDate?: string;    // 2순위 접수일
  rawTextPreview?: string;
}

interface SupplyTypeDetail {
  type: string;                          // 신혼부부, 생애최초, 다자녀, 노부모부양, 기관추천, 일반공급
  requireHomeless?: boolean;             // 무주택 요건
  minSubscriptionMonths?: number;        // 최소 청약저축 가입기간
  incomeLimitPercent?: number;           // 도시근로자 월평균소득 %
  incomeLimitDualPercent?: number;       // 맞벌이 소득기준 %
  maxMarriageYears?: number;             // 신혼 혼인기간 (년)
  minChildren?: number;                  // 다자녀 최소 자녀수
  maxAgeParent?: number;                 // 노부모부양 직계존속 최소 나이
  assetLimit?: string;                   // 총자산 한도 (원)
  carValueLimit?: string;                // 자동차가액 한도 (원)
  conditions?: string[];                 // 기타 조건 목록
  requiredDocuments?: string[];          // 이 유형에 필요한 서류
}

interface ExclusiveArea {
  area: string;                          // "84A", "59B" 등
  squareMeters?: number;                 // 전용면적 ㎡
  totalUnits?: number;                   // 총 세대수
  generalUnits?: number;                 // 일반공급
  specialUnits?: number;                 // 특별공급
  price?: string;                        // 분양가 (최고가 또는 대표가)
}

/* ─────────────────────────────────────────────
   1. Date Extraction (regex — 기존 유지)
   ───────────────────────────────────────────── */

interface DateMatch { iso: string; offset: number; raw: string; }

function findAllDates(text: string): DateMatch[] {
  const results: DateMatch[] = [];
  const push = (y: string, mo: string, d: string, offset: number, raw: string) => {
    const yy = y.length === 2 ? `20${y}` : y;
    const yi = parseInt(yy, 10);
    if (yi < 2020 || yi > 2035) return;
    const iso = `${yy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`;
    results.push({ iso, offset, raw });
  };

  const re1 = /['\u2018\u2019](\d{2})\.(\d{1,2})\.(\d{1,2})/g;
  const re2 = /\b(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/g;
  const re3 = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;

  let m: RegExpExecArray | null;
  while ((m = re1.exec(text)) !== null) push(m[1], m[2], m[3], m.index, m[0]);
  while ((m = re2.exec(text)) !== null) push(m[1], m[2], m[3], m.index, m[0]);
  while ((m = re3.exec(text)) !== null) push(m[1], m[2], m[3], m.index, m[0]);

  results.sort((a, b) => a.offset - b.offset);
  const dedup: DateMatch[] = [];
  for (const r of results) {
    if (!dedup.length || Math.abs(dedup[dedup.length - 1].offset - r.offset) > 2) dedup.push(r);
  }
  return dedup;
}

function withTime(iso: string, t: { h: number; m: number } | null): string {
  if (!t) return iso.replace('T00:00:00', 'T00:00');
  const d = iso.split('T')[0];
  return `${d}T${t.h.toString().padStart(2, '0')}:${t.m.toString().padStart(2, '0')}`;
}

/* ─────────────────────────────────────────────
   2. Schedule Table Parser (regex — 기존 유지)
   ───────────────────────────────────────────── */

interface Schedule {
  applicationStart?: string;
  applicationEnd?: string;
  winnerAnnounceDate?: string;
  docSubmitStart?: string;
  docSubmitEnd?: string;
  contractStart?: string;
  contractEnd?: string;
  announcementDate?: string;
  specialApplyDate?: string;
  general1stDate?: string;
  general2ndDate?: string;
}

function parseScheduleTable(text: string, allDates: DateMatch[]): Schedule {
  const headerRe = /입주자모집공고일[\s\S]{0,300}?계약체결/;
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return {};
  const headerEnd = (headerMatch.index || 0) + headerMatch[0].length;

  const zoneStart = headerEnd;
  const zoneEnd = headerEnd + 1200;
  const zoneDates = allDates.filter(d => d.offset >= zoneStart && d.offset < zoneEnd);
  if (zoneDates.length < 4) return {};

  const d = zoneDates.map(x => x.iso);
  const sched: Schedule = {};

  sched.applicationStart = d[1] || d[0];
  sched.applicationEnd = d[3] || d[2] || d[1];
  sched.announcementDate = d[0];
  sched.specialApplyDate = d[1];
  sched.general1stDate = d[2];
  sched.general2ndDate = d[3];
  sched.winnerAnnounceDate = d[4];

  // d[5] 이후: 서류접수(start/end) + 계약(start/end)
  // 전형적 구조: [서류시작, 서류끝, 계약시작, 계약끝] (4개)
  // 또는 [서류시작, 서류끝, 계약시작] (3개)
  // 또는 [계약시작, 계약끝] (2개 — 서류접수 생략)
  const tail = d.slice(5);
  if (tail.length >= 4) {
    sched.docSubmitStart = tail[0];
    sched.docSubmitEnd = tail[1];
    sched.contractStart = tail[2];
    sched.contractEnd = tail[3];
  } else if (tail.length === 3) {
    sched.docSubmitStart = tail[0];
    sched.docSubmitEnd = tail[0]; // 서류접수 1일만
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

function findDateNearKeyword(text: string, allDates: DateMatch[], keywords: string[], maxDistance = 200): string | null {
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

/* ─────────────────────────────────────────────
   3. Simple Regex Extractors (기존 유지)
   ───────────────────────────────────────────── */

function extractTitle(text: string, filename: string): string | undefined {
  const fnameClean = filename.replace(/\.pdf$/i, '').replace(/입주자모집공고문?/g, '').replace(/\(.*?\)/g, '').trim();
  const withoutNo = fnameClean.replace(/^\d{10,}\s*/, '').replace(/^\d{4}-\d{4,}\s*/, '').trim();
  if (withoutNo && withoutNo.length >= 3) return withoutNo;

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3 && l.length < 60);
  for (const ln of lines) {
    if (/(아파트|오피스텔|힐스테이트|푸르지오|자이|래미안|더샵|디에트르|트리마제)/.test(ln)) {
      return ln.replace(/입주자모집공고.*/, '').trim();
    }
  }
  return fnameClean || undefined;
}

function extractAnnouncementNo(text: string, filename: string): string | undefined {
  const fm = filename.match(/(\d{10})/);
  if (fm) return fm[1];
  const bodyMatch = text.match(/(?:주택관리번호|공고번호)\D{0,20}(\d{10})/);
  if (bodyMatch) return bodyMatch[1];
  const any = text.match(/\b(\d{10})\b/);
  return any?.[1];
}

function extractRegion(text: string): string | undefined {
  /**
   * "도 시 구 동" 까지만 깔끔하게 추출.
   * 번지·지번·공급규모 등은 포함하지 않는다.
   */
  // 후처리: 동/읍/면/리 뒤의 숫자·번지 등 제거
  function trimAddress(raw: string): string {
    return raw
      .replace(/\s+/g, ' ')
      .replace(/\d[\d\-]*\s*번지.*/, '')       // "395-1번지 ■ …" 제거
      .replace(/\d[\d\-]*\s*$/, '')             // 끝에 붙은 숫자 제거
      .replace(/[■●▶※·,.].*/, '')              // 특수문자 이후 제거
      .trim();
  }

  // 1) "공급위치" / "대지위치" 키워드 뒤에서 추출
  const kwRe = /(?:공급\s*위치|대지\s*위치|건설\s*위치)\s*[:：]?\s*/g;
  let kwMatch: RegExpExecArray | null;
  while ((kwMatch = kwRe.exec(text)) !== null) {
    const after = text.slice(kwMatch.index + kwMatch[0].length, kwMatch.index + kwMatch[0].length + 120);
    const firstLine = after.split(/\n/)[0].trim();
    const cleaned = trimAddress(firstLine);
    if (cleaned.length >= 5 && /[시군구동읍면리]/.test(cleaned)) return cleaned;
  }
  // 2) "~도 ~시 ~구 ~동" 풀패턴
  const m2 = text.match(/([가-힣]+(?:특별시|광역시|특별자치시|도)\s+[가-힣]+(?:시|군)\s+[가-힣]+(?:구|군)(?:\s+[가-힣]+(?:동|읍|면|리))?)/);
  if (m2) return m2[1].trim();
  // 3) "~시 ~구 ~동" 패턴
  const m3 = text.match(/([가-힣]+(?:시|군)\s+[가-힣]+구\s+[가-힣]+(?:동|읍|면|리))/);
  if (m3) return m3[1].trim();
  // 4) 짧은 패턴
  const m4 = text.match(/([가-힣]+(?:시|군)\s+[가-힣]+(?:구|동))/);
  return m4?.[1]?.trim();
}

function extractMinSubscription(text: string): number | undefined {
  const m = text.match(/(?:청약통장|가입기간|가입\s*후)\D{0,20}(\d{1,3})\s*개월/);
  if (m) return parseInt(m[1], 10);
  return undefined;
}

function extractTotalUnits(text: string): number | undefined {
  // "총 55세대", "총 123 세대", "합계 55세대" 등
  const m = text.match(/(?:총|합계)\s*(\d{1,5})\s*세대/);
  if (m) return parseInt(m[1], 10);
  // "일반분양 총 55세대"
  const m2 = text.match(/일반\s*분양\s*총?\s*(\d{1,5})\s*세대/);
  if (m2) return parseInt(m2[1], 10);
  return undefined;
}

function extractResaleRestriction(text: string): string | undefined {
  // "전매행위 제한기간", "전매제한" 근처
  const m = text.match(/전매(?:행위)?\s*제한\s*(?:기간)?\s*[:：]?\s*([가-힣\d\s~·\-()（）]+?)(?:\n|, |\.)/);
  if (m) return m[1].trim().slice(0, 60);
  // "소유권이전등기일까지" 등
  const m2 = text.match(/전매(?:행위)?\s*제한[^.]*?(소유권이전등기[가-힣]*|당첨[가-힣]*로부터\s*\d+[가-힣]*)/);
  if (m2) return m2[1].trim();
  return undefined;
}

function extractReWinRestriction(text: string): string | undefined {
  const m = text.match(/재당첨\s*제한\s*[:：]?\s*([가-힣\d\s~·\-()（）]+?)(?:\n|, |\.)/);
  if (m) {
    const val = m[1].trim();
    if (/없|미적용|해당\s*없/.test(val)) return "없음";
    return val.slice(0, 60);
  }
  if (/재당첨\s*제한\s*(?:이|을)\s*(?:받지|적용[가-힣]*않)/.test(text)) return "없음";
  return undefined;
}

function extractResidenceObligation(text: string): string | undefined {
  const m = text.match(/거주\s*의무\s*(?:기간)?\s*[:：]?\s*([가-힣\d\s~·\-()（）]+?)(?:\n|, |\.)/);
  if (m) {
    const val = m[1].trim();
    if (/없|미적용|해당\s*없/.test(val)) return "없음";
    return val.slice(0, 60);
  }
  return undefined;
}

function extractPriceCap(text: string): boolean | undefined {
  if (/분양가\s*상한제\s*(?:가\s*)?적용/.test(text)) return true;
  if (/분양가\s*상한제\s*(?:가\s*)?미적용|분양가\s*상한제\s*(?:를\s*)?적용[가-힣]*않/.test(text)) return false;
  return undefined;
}

function extractLandType(text: string): string | undefined {
  if (/공공택지|공공사업/.test(text)) return "공공택지";
  if (/민간택지|민간사업/.test(text)) return "민간택지";
  return undefined;
}

function extractMoveInDate(text: string): string | undefined {
  const m = text.match(/입주\s*(?:예정|시기|개시)\s*[:：]?\s*(\d{4}\s*년?\s*\d{1,2}\s*월)/);
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  return undefined;
}

function extractPointSystemRatio(text: string): { ratio: string; items?: string[] } | undefined {
  // "가점제 40%, 추첨제 60%" or "가점제 100%"
  const m = text.match(/가점제\s*(\d{1,3})\s*%\s*[,/·]\s*추첨제\s*(\d{1,3})\s*%/);
  if (m) {
    const ratio = `가점제 ${m[1]}% / 추첨제 ${m[2]}%`;
    const items = [
      "무주택기간 (32점)",
      "부양가족수 (35점)",
      "저축가입기간 (17점)",
    ];
    return { ratio, items };
  }
  // "가점제 100%"
  const m2 = text.match(/가점제\s*(\d{1,3})\s*%/);
  if (m2 && parseInt(m2[1]) === 100) return { ratio: "가점제 100%" };
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
    if (matches && matches.length >= 2) {
      const negRe = new RegExp(re.source + '\\s*[^가-힣]*(?:해당\\s*없음|미시행|미실시)');
      if (!negRe.test(normalized)) types.push(name);
    }
  }
  return types;
}

/* ─────────────────────────────────────────────
   4. Text Section Splitter (신규)
   ───────────────────────────────────────────── */

interface TextSections {
  supplyTable: string;        // 공급대상 (면적별 세대수 표)
  specialSupply: string;      // 특별공급 자격조건
  incomeAsset: string;        // 소득·자산 기준
  documentList: string;       // 제출서류
  generalInfo: string;        // 일반 사항 (규제 지역, 전매 제한 등)
}

function splitSections(fullText: string): TextSections {
  const totalLen = fullText.length;

  /**
   * 여러 앵커 중 가장 먼저 등장하는 위치에서 시작, maxChars만큼 추출.
   * stopAnchors는 시작점에서 최소 minSkip 이후에 나타나야 유효 (테이블 내부 키워드 방지).
   */
  function findSection(
    anchors: string[],
    stopAnchors: string[],
    maxChars: number = 4000,
    minSkip: number = 300
  ): string {
    let startIdx = -1;
    for (const anchor of anchors) {
      const idx = fullText.indexOf(anchor);
      if (idx >= 0 && (startIdx < 0 || idx < startIdx)) {
        startIdx = idx;
      }
    }
    if (startIdx < 0) return '';

    let endIdx = Math.min(startIdx + maxChars, totalLen);
    for (const stop of stopAnchors) {
      // minSkip 이후부터 찾아야 테이블 헤더 내부 키워드를 건너뜀
      const idx = fullText.indexOf(stop, startIdx + minSkip);
      if (idx > startIdx && idx < endIdx) {
        endIdx = idx + stop.length; // stop 키워드 포함
      }
    }

    return fullText.slice(startIdx, endIdx);
  }

  /**
   * 특정 키워드가 N번째로 나타나는 위치부터 추출 (첫 등장이 본문이 아닌 목차일 수 있음)
   */
  function findSectionNth(
    keyword: string,
    nthOccurrence: number,
    maxChars: number
  ): string {
    let pos = 0;
    let count = 0;
    while (pos < totalLen) {
      const idx = fullText.indexOf(keyword, pos);
      if (idx < 0) break;
      count++;
      if (count >= nthOccurrence) {
        return fullText.slice(idx, Math.min(idx + maxChars, totalLen));
      }
      pos = idx + keyword.length;
    }
    return '';
  }

  // ── 공급대상 (면적별 세대수 표) ──
  // "공급규모"가 있으면 가장 정확, 없으면 "공급대상" 근처
  const supplyTable = findSection(
    ['공급규모', '공급대상 (단위', '공급대상(단위'],
    ['입주자저축', '청약자격', '자격요건', '청약 자격'],
    6000, 500 // 테이블이 크므로 500자 이후부터 stop 탐색
  ) || findSection(
    ['공급대상', '주택공급 대상'],
    ['입주자저축', '청약자격'],
    5000, 500
  );

  // ── 특별공급 자격조건 ──
  // "특별공급" 이 목차/헤더에도 자주 나오므로, "공급자격" 또는 "신혼부부" 등 본문 시작 키워드 활용
  const specialSupply = findSection(
    ['특별공급 대상자별 자격', '특별공급 자격', '특별공급대상자별'],
    ['일반공급 당첨자', '일반공급 입주자', '당첨자 선정방법'],
    8000, 200
  ) || findSectionNth('특별공급', 3, 6000); // 3번째 등장부터 (목차/요약 건너뜀)

  // ── 소득·자산 기준 ──
  const incomeAsset = findSection(
    ['소득기준', '소득 및 자산', '월평균소득 기준'],
    ['제출서류', '구비서류', '서류제출'],
    6000, 200
  ) || findSectionNth('월평균소득', 2, 5000)
    || findSectionNth('도시근로자', 2, 5000);

  // ── 제출서류 ──
  const documentList = findSection(
    ['당첨자 제출서류', '당첨자서류', '구비서류 안내', '구비서류'],
    ['유의사항', '기타사항', '주의사항', '개인정보'],
    6000, 200
  ) || findSectionNth('제출서류', 2, 5000);

  // ── 일반 사항 ──
  const generalInfo = findSection(
    ['전매제한', '재당첨제한', '투기과열지구', '규제지역'],
    ['입주자저축', '공급대상'],
    3000, 100
  );

  return { supplyTable, specialSupply, incomeAsset, documentList, generalInfo };
}

/* ─────────────────────────────────────────────
   5. Groq LLM Parser (신규)
   ───────────────────────────────────────────── */

interface GroqParsedResult {
  supplyTypes?: SupplyTypeDetail[];
  exclusiveAreas?: ExclusiveArea[];
  requiredDocuments?: Record<string, string[]>;
  incomeTable?: Record<string, Record<string, number>>;
  assetLimit?: string;
  carValueLimit?: string;
  pointSystemRatio?: string;
}

async function parseWithGroq(sections: TextSections): Promise<GroqParsedResult | null> {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_2;
  if (!apiKey) {
    console.warn('[parse-pdf] GROQ_API_KEY 없음 — LLM 파싱 건너뜀');
    return null;
  }

  const groq = new Groq({ apiKey });

  /**
   * 텍스트 압축: 연속 공백/빈줄 제거, 페이지 구분자 제거
   * Groq 무료 티어 TPM(12K) 내에 맞추기 위해 최대 ~8000자로 제한
   */
  function compress(text: string, maxLen: number): string {
    return text
      .replace(/[ \t]{2,}/g, ' ')           // 연속 공백 축소
      .replace(/\n{3,}/g, '\n\n')           // 3줄 이상 빈줄 축소
      .replace(/- \d+ -/g, '')              // 페이지 번호 "- 7 -" 제거
      .replace(/^\s*\d+\s*$/gm, '')         // 단독 숫자 줄 제거
      .trim()
      .slice(0, maxLen);
  }

  // 각 섹션을 압축하여 총 ~8000자 이내로 (Groq 12K TPM 제한 대응)
  const combinedText = [
    sections.supplyTable   ? `=== 공급대상 ===\n${compress(sections.supplyTable, 2500)}` : '',
    sections.specialSupply ? `=== 특별공급 조건 ===\n${compress(sections.specialSupply, 2500)}` : '',
    sections.incomeAsset   ? `=== 소득·자산 기준 ===\n${compress(sections.incomeAsset, 2000)}` : '',
    sections.documentList  ? `=== 제출서류 ===\n${compress(sections.documentList, 1500)}` : '',
    sections.generalInfo   ? `=== 일반 사항 ===\n${compress(sections.generalInfo, 500)}` : '',
  ].filter(Boolean).join('\n\n');

  if (combinedText.length < 100) {
    console.warn('[parse-pdf] 추출된 섹션 텍스트가 너무 짧음 — LLM 파싱 건너뜀');
    return null;
  }

  console.log(`[parse-pdf] 압축된 텍스트: ${combinedText.length}자 (예상 토큰: ~${Math.ceil(combinedText.length / 1.5)})`);

  const systemPrompt = `당신은 한국 주택청약 공고문을 분석하는 전문가입니다.
주어진 공고 텍스트에서 아래 JSON 스키마에 맞춰 정보를 추출하세요.

중요 규칙:
1. 텍스트에서 확인할 수 없는 필드는 null로 두세요. 추측하지 마세요.
2. supplyTypes의 type은 반드시 다음 중 하나만 사용: "다자녀가구", "신혼부부", "생애최초", "노부모부양", "기관추천", "신생아", "일반공급"
   - "신생아 우선공급"과 "신생아 일반공급"은 모두 "신생아"로 통합하세요.
   - "우선공급"이나 "추첨공급"은 별도 type으로 만들지 마세요.
3. exclusiveAreas의 area는 타입명(예: "40A", "59B", "84A")으로, squareMeters는 전용면적(㎡)으로 기재.
4. 소득기준표(incomeTable)는 가구원수별, 비율별 월소득 금액(원)을 숫자로 기재.
5. 반드시 유효한 JSON만 출력하세요. 설명이나 마크다운 없이 JSON만 출력하세요.`;

  const userPrompt = `아래는 청약 공고문에서 추출한 텍스트 섹션입니다:

${combinedText}

다음 JSON 형식으로 파싱 결과를 출력하세요:

{
  "supplyTypes": [
    {
      "type": "다자녀가구|신혼부부|생애최초|노부모부양|기관추천|신생아|일반공급 중 하나",
      "units": 세대수 (숫자 또는 null),
      "requireHomeless": true/false,
      "minSubscriptionMonths": 숫자 또는 null,
      "incomeLimitPercent": 도시근로자 월평균소득 대비 % (예: 100, 120, 140),
      "incomeLimitDualPercent": 맞벌이 기준 % 또는 null,
      "maxMarriageYears": 신혼 혼인기간(년) 또는 null,
      "minChildren": 다자녀 최소 자녀수 또는 null,
      "maxAgeParent": 노부모부양 직계존속 최소 연령 또는 null,
      "assetLimit": "총자산 한도 원단위 문자열" 또는 null,
      "carValueLimit": "자동차가액 한도 문자열" 또는 null,
      "conditions": ["기타 자격조건을 한 줄씩"],
      "requiredDocuments": ["이 유형에 필요한 서류를 한 줄씩"]
    }
  ],
  "exclusiveAreas": [
    {
      "area": "40A",
      "squareMeters": 40.58,
      "totalUnits": 5,
      "generalUnits": 2,
      "specialUnits": 3,
      "price": "분양가 문자열 또는 null"
    }
  ],
  "requiredDocuments": {
    "공통": ["주민등록등본(세대원 전원 포함, 주민등록번호 뒷자리 포함)", ...],
    "신혼부부": ["혼인관계증명서(상세)", "소득증빙서류", ...],
    "생애최초": [...],
    "다자녀가구": [...]
  },
  "incomeTable": {
    "3인이하": {"100%": 6228914, "120%": 7474697, "140%": 8720480},
    "4인": {"100%": 7200809, "120%": 8640971, "140%": 10081133},
    "5인이상": {"100%": 7326048, "120%": 8791258, "140%": 10256467}
  },
  "assetLimit": "총자산 기준 금액 (원단위 문자열)",
  "carValueLimit": "자동차가액 기준 금액 (원단위 문자열)"
}`;

  try {
    console.log(`[parse-pdf] Groq 호출 시작 (텍스트 길이: ${combinedText.length}자)`);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      console.warn('[parse-pdf] Groq 응답이 비어있음');
      return null;
    }

    console.log(`[parse-pdf] Groq 응답 수신 (${content.length}자)`);

    // JSON 파싱
    const parsed = JSON.parse(content) as GroqParsedResult;
    return parsed;
  } catch (err: any) {
    console.error('[parse-pdf] Groq 호출 실패:', err?.message || err);

    // Rate limit인 경우 두 번째 키로 재시도
    if (err?.status === 429 && process.env.GROQ_API_KEY_2 && apiKey !== process.env.GROQ_API_KEY_2) {
      console.log('[parse-pdf] 두 번째 API 키로 재시도...');
      try {
        const groq2 = new Groq({ apiKey: process.env.GROQ_API_KEY_2 });
        const completion = await groq2.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
        });
        const content = completion.choices?.[0]?.message?.content;
        if (content) return JSON.parse(content) as GroqParsedResult;
      } catch (err2: any) {
        console.error('[parse-pdf] 두 번째 키도 실패:', err2?.message);
      }
    }

    return null;
  }
}

/* ─────────────────────────────────────────────
   6. POST Handler
   ───────────────────────────────────────────── */

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
    const fullText: string = await extractKoreanPdfText(buf);

    if (!fullText.trim()) {
      return NextResponse.json({ error: '텍스트 추출 실패 — 이미지 기반 PDF일 수 있습니다.' }, { status: 422 });
    }

    // ── 1단계: Regex 파싱 (기존) ──
    const allDates = findAllDates(fullText);
    const schedule = parseScheduleTable(fullText, allDates);

    const appStart = schedule.applicationStart
      || findDateNearKeyword(fullText, allDates, ['특별공급 접수', '특별공급접수', '청약접수', '청약 접수', '1순위 접수']) || undefined;
    const appEnd = schedule.applicationEnd
      || findDateNearKeyword(fullText, allDates, ['2순위 접수', '접수 마감', '청약 마감']) || undefined;
    const winDate = schedule.winnerAnnounceDate
      || findDateNearKeyword(fullText, allDates, ['당첨자발표일', '당첨자발표', '당첨자 발표']) || undefined;
    const docStart = schedule.docSubmitStart
      || findDateNearKeyword(fullText, allDates, ['서류접수', '서류 접수', '서류제출', '서류 제출', '적격심사', '적격 심사'], 300) || undefined;
    const docEnd = schedule.docSubmitEnd
      || findDateNearKeyword(fullText, allDates, ['서류접수', '서류 접수', '서류제출', '서류 제출'], 500) || undefined;
    const conStart = schedule.contractStart
      || findDateNearKeyword(fullText, allDates, ['계약체결', '계약 체결', '계약기간', '계약 기간']) || undefined;
    const conEnd = schedule.contractEnd || undefined;

    const applyOpen = fullText.match(/(?:청약\s*접수|청약접수)[\s\S]{0,120}?(오전|오후)\s*(\d{1,2})\s*(?:시|:)/);
    const applyClose = fullText.match(/(?:접수\s*마감|마감\s*시간)[\s\S]{0,60}?(오전|오후)\s*(\d{1,2})\s*(?:시|:)/);

    const applyH = (m: RegExpMatchArray | null) => {
      if (!m) return null;
      let h = parseInt(m[2], 10);
      if (m[1] === '오후' && h < 12) h += 12;
      if (m[1] === '오전' && h === 12) h = 0;
      return { h, m: 0 };
    };

    // ── 2단계: 섹션 분리 + Groq LLM ──
    const sections = splitSections(fullText);
    const groqResult = await parseWithGroq(sections);

    // ── 3단계: 병합 ──
    const regexSpecialTypes = extractSpecialTypes(fullText);

    // LLM에서 나온 supplyTypes의 type 목록으로 specialTypes 보강
    let mergedSpecialTypes = [...regexSpecialTypes];
    if (groqResult?.supplyTypes) {
      for (const st of groqResult.supplyTypes) {
        const normalized = st.type.replace(/가구$/, '가구');
        if (!mergedSpecialTypes.includes(normalized) && normalized !== '일반공급') {
          mergedSpecialTypes.push(normalized);
        }
      }
    }

    const parsed: ParsedAnnouncement = {
      // regex 기반
      title: extractTitle(fullText, file.name),
      announcementNo: extractAnnouncementNo(fullText, file.name),
      applicationStart: appStart ? withTime(appStart, applyH(applyOpen)) : undefined,
      applicationEnd: appEnd ? withTime(appEnd, applyH(applyClose)) : undefined,
      winnerAnnounceDate: winDate ? withTime(winDate, null) : undefined,
      docSubmitStart: docStart ? withTime(docStart, null) : undefined,
      docSubmitEnd: docEnd ? withTime(docEnd, null) : undefined,
      contractStart: conStart ? withTime(conStart, null) : undefined,
      contractEnd: conEnd ? withTime(conEnd, null) : undefined,
      region: extractRegion(fullText),
      totalUnits: extractTotalUnits(fullText),
      noHomeRequired: /무주택\s*세대구성원/.test(fullText),
      minSubscriptionMonths: extractMinSubscription(fullText),
      specialTypes: mergedSpecialTypes,

      // LLM 기반 (없으면 undefined)
      supplyTypes: groqResult?.supplyTypes || undefined,
      exclusiveAreas: groqResult?.exclusiveAreas || undefined,
      requiredDocuments: groqResult?.requiredDocuments || undefined,
      incomeTable: groqResult?.incomeTable || undefined,
      assetLimit: groqResult?.assetLimit || undefined,
      carValueLimit: groqResult?.carValueLimit || undefined,

      resaleRestriction: extractResaleRestriction(fullText),
      reWinRestriction: extractReWinRestriction(fullText),
      residenceObligation: extractResidenceObligation(fullText),
      priceCapApplied: extractPriceCap(fullText),
      landType: extractLandType(fullText),
      moveInDate: extractMoveInDate(fullText),
      pointSystemRatio: extractPointSystemRatio(fullText),
      announcementDate: schedule.announcementDate || findDateNearKeyword(fullText, allDates, ['모집공고일', '입주자모집공고']) || undefined,
      specialApplyDate: schedule.specialApplyDate || undefined,
      general1stDate: schedule.general1stDate || findDateNearKeyword(fullText, allDates, ['1순위 접수', '일순위']) || undefined,
      general2ndDate: schedule.general2ndDate || findDateNearKeyword(fullText, allDates, ['2순위 접수', '이순위']) || undefined,

      rawTextPreview: fullText.slice(0, 500),
    };

    return NextResponse.json({
      success: true,
      data: parsed,
      llmUsed: !!groqResult,
    });
  } catch (err: any) {
    console.error('[parse-announcement-pdf]', err);
    return NextResponse.json({ error: err?.message || 'PDF 파싱 실패' }, { status: 500 });
  }
}
