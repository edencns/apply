/**
 * 여러 엔진 결과를 합의 기반으로 병합.
 *
 * 필드별 우선순위:
 *   high: 모델 2개가 같은 값을 낸 경우
 *   med:  모델 1개만 값을 낸 경우
 *   low:  모델 모두 null/빈값 → regex seed로 채움
 *   unknown: 어디서도 값 없음
 */

import type {
  AnnouncementParseResult,
  ConsensusResult,
  FieldConfidence,
  ParseEngineResult,
} from "../announcement-schema";

type PA = Partial<AnnouncementParseResult>;

const isEmpty = (v: any): boolean =>
  v === null || v === undefined || v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v || {}).length === 0);

/** 값 동치 비교 — 날짜/숫자는 관대하게 */
function valuesEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  if (typeof a === "string" && typeof b === "string") {
    // 날짜 앞 10자리만 비교 (시간 0이 들어가도 같은 날로 인정)
    if (/^\d{4}-\d{2}-\d{2}/.test(a) && /^\d{4}-\d{2}-\d{2}/.test(b)) {
      return a.slice(0, 10) === b.slice(0, 10);
    }
    return a.trim() === b.trim();
  }
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length; // 간단히 길이로만 — 정밀 비교는 consumer에서
  }
  return false;
}

/** scalar 필드 병합.
 *  Gemini가 주 엔진. OpenAI는 선택적 교차검증.
 *  - Gemini + OpenAI 일치 → high (최고 신뢰)
 *  - Gemini + regex 일치 → high (교차 확인됨)
 *  - Gemini 단독 → high (주 엔진이 뽑았으면 신뢰)
 *  - OpenAI 단독 → med
 *  - regex 단독 → low
 *  - 전부 없음 → unknown
 */
function mergeScalar<T>(
  regex: T | null | undefined,
  gemini: T | null | undefined,
  openai: T | null | undefined,
): { value: T | null; conf: FieldConfidence } {
  if (!isEmpty(gemini) && !isEmpty(openai) && valuesEqual(gemini, openai)) {
    return { value: gemini as T, conf: "high" };
  }
  if (!isEmpty(gemini) && !isEmpty(regex) && valuesEqual(gemini, regex)) {
    return { value: gemini as T, conf: "high" };
  }
  if (!isEmpty(gemini)) return { value: gemini as T, conf: "high" };
  if (!isEmpty(openai)) return { value: openai as T, conf: "med" };
  if (!isEmpty(regex)) return { value: regex as T, conf: "low" };
  return { value: null, conf: "unknown" };
}

/** 배열 필드 — Gemini 우선, OpenAI 있으면 개수 비교로 교차검증 */
function mergeArray<T>(
  gemini: T[] | null | undefined,
  openai: T[] | null | undefined,
): { value: T[]; conf: FieldConfidence } {
  const g = gemini || [];
  const o = openai || [];
  if (g.length === 0 && o.length === 0) return { value: [], conf: "unknown" };
  if (g.length > 0 && o.length > 0 && Math.abs(g.length - o.length) <= 1) {
    return { value: g.length >= o.length ? g : o, conf: "high" };
  }
  if (g.length > 0) return { value: g, conf: "high" };
  return { value: o, conf: "med" };
}

/** Core Gemini 호출이 추출하는 scalar 필드만. Extended 전용 필드는 제외.
 *  Extended 필드를 여기 포함하면 Core 단독 호출 시 전부 unknown으로 잡혀
 *  신뢰도 "低" 카운트가 과도하게 부풀려진다. */
const SCALAR_FIELDS: (keyof AnnouncementParseResult)[] = [
  "title", "announcementNo", "region", "totalUnits",
  // 일정
  "announcementDate", "applicationStart", "applicationEnd",
  "specialApplyDate", "general1stDate", "general2ndDate",
  "winnerAnnounceDate", "docSubmitStart", "docSubmitEnd",
  "contractStart", "contractEnd", "moveInDate",
  // 자격 기본 (Core)
  "noHomeRequired", "minSubscriptionMonths", "regulation", "landType",
  // 상세
  "assetLimit", "carValueLimit",
  // 제한 (Core)
  "resaleRestriction", "reWinRestriction", "residenceObligation", "priceCapApplied",
];

export function mergeByConsensus(
  regex: PA,
  geminiResult: ParseEngineResult,
  openaiResult: ParseEngineResult,
): ConsensusResult {
  const g = geminiResult.data;
  const o = openaiResult.data;
  const data: PA = {};
  const confidence: Partial<Record<keyof AnnouncementParseResult, FieldConfidence>> = {};

  // Scalar fields
  for (const key of SCALAR_FIELDS) {
    const { value, conf } = mergeScalar(
      (regex as any)[key],
      (g as any)[key],
      (o as any)[key],
    );
    if (value !== null) (data as any)[key] = value;
    confidence[key] = conf;
  }

  // Array fields
  const sa = mergeArray(g.supplyTypes, o.supplyTypes);
  data.supplyTypes = sa.value as any;
  confidence.supplyTypes = sa.conf;

  const ea = mergeArray(g.exclusiveAreas, o.exclusiveAreas);
  data.exclusiveAreas = ea.value as any;
  confidence.exclusiveAreas = ea.conf;

  // requiredDocuments (Record<string, string[]>) — gemini 우선, openai는 누락 카테고리만 보강
  const rd = { ...(g.requiredDocuments || {}) };
  if (o.requiredDocuments) {
    for (const [k, v] of Object.entries(o.requiredDocuments)) {
      if (!rd[k] || rd[k].length === 0) rd[k] = v;
    }
  }
  if (Object.keys(rd).length > 0) {
    data.requiredDocuments = rd;
    confidence.requiredDocuments = "high";
  }

  // incomeTable — 길이로 합의
  const inc = mergeArray(g.incomeTable as any, o.incomeTable as any);
  if (inc.value.length > 0) {
    data.incomeTable = inc.value as any;
    confidence.incomeTable = inc.conf;
  }

  // pointSystemRatio — scalar처럼 처리
  const psr = mergeScalar(
    (regex as any).pointSystemRatio,
    g.pointSystemRatio,
    o.pointSystemRatio,
  );
  if (psr.value !== null) data.pointSystemRatio = psr.value as any;
  confidence.pointSystemRatio = psr.conf;

  const totalDuration = Math.max(geminiResult.durationMs, openaiResult.durationMs);

  return {
    data,
    confidence,
    engines: [
      {
        engine: "gemini",
        success: !geminiResult.error,
        durationMs: geminiResult.durationMs,
        error: geminiResult.error,
      },
      {
        engine: "openai",
        success: !openaiResult.error,
        durationMs: openaiResult.durationMs,
        error: openaiResult.error,
      },
    ],
    totalDurationMs: totalDuration,
  };
}

/** Claude 검증 결과(patch)를 기존 consensus에 덮어씀 */
export function applyClaudePatch(
  consensus: ConsensusResult,
  claudePatch: PA,
): ConsensusResult {
  const merged = { ...consensus.data };
  const conf = { ...consensus.confidence };
  for (const [k, v] of Object.entries(claudePatch)) {
    if (!isEmpty(v)) {
      (merged as any)[k] = v;
      (conf as any)[k] = "high"; // Claude 검증을 통과한 필드는 high로 격상
    }
  }
  return { ...consensus, data: merged, confidence: conf };
}
