/**
 * 모집공고 PDF 파싱 결과 Zod 스키마 — 단일 소스
 *
 * Gemini `responseSchema` / OpenAI `response_format.json_schema` / Claude `tools`
 * 가 모두 같은 구조를 쓰도록 여기서 한 번만 선언한다.
 *
 * 핵심 원칙:
 *  1. 모든 리프 필드는 `null | value` — undefined/빈문자 대신 null 명시
 *  2. 추출된 값마다 `evidenceQuote`(근거 원문 1~2줄)를 요구 → 환각 필드 탐지
 *  3. enum 강제는 최소화. `type`은 원문 그대로, `canonicalType` 보조
 */

import { z } from "zod";

/** 자유 문자열 + 근거 인용 */
const fieldWithEvidence = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema,
    evidenceQuote: z.string().nullable(),
  });

/** ISO 8601 datetime 또는 date */
const IsoDate = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/,
  "ISO 8601 날짜/시간 형식이어야 합니다",
);

/** 공급유형 정식 매핑 */
export const CanonicalSupplyType = z.enum([
  "일반공급",
  "신혼부부",
  "생애최초",
  "다자녀가구",
  "노부모부양",
  "기관추천",
  "신생아",
  "이전기관",
  "기타",
]);

/** 규제 지역 분류 */
export const RegulationTier = z.enum([
  "투기과열",
  "청약과열",
  "조정대상",
  "비규제",
  "알수없음",
]);

/** 공급유형 상세 */
export const SupplyTypeDetail = z.object({
  type: z.string().describe("공고 원문의 표현 그대로 (예: '신생아 우선공급')"),
  canonicalType: CanonicalSupplyType.nullable(),
  priorityTier: z.enum(["우선", "일반", "추첨"]).nullable(),
  units: z.number().int().nullable().describe("해당 유형 공급 세대수"),
  requireHomeless: z.boolean().nullable(),
  minSubscriptionMonths: z.number().int().nullable(),
  incomeLimitPercent: z.number().nullable().describe("도시근로자 월평균소득 %"),
  incomeLimitDualPercent: z.number().nullable().describe("맞벌이 기준 %"),
  maxMarriageYears: z.number().nullable(),
  minChildren: z.number().int().nullable(),
  maxAgeParent: z.number().int().nullable(),
  assetLimit: z.string().nullable().describe("총자산 한도 (원 단위 문자열)"),
  carValueLimit: z.string().nullable(),
  conditions: z.array(z.string()),
  requiredDocuments: z.array(z.string()),
  evidenceQuote: z.string().nullable(),
});
export type SupplyTypeDetail = z.infer<typeof SupplyTypeDetail>;

/** 전용면적별 공급 세대 */
export const ExclusiveArea = z.object({
  area: z.string().describe("주택형 코드 (예: '84A', '59B')"),
  squareMeters: z.number().nullable(),
  totalUnits: z.number().int().nullable(),
  generalUnits: z.number().int().nullable(),
  specialUnits: z.number().int().nullable(),
  price: z.string().nullable().describe("분양가 문자열 (원)"),
  evidenceQuote: z.string().nullable(),
});
export type ExclusiveArea = z.infer<typeof ExclusiveArea>;

/** 소득기준표 — 행: 가구원수, 열: 소득구간 */
export const IncomeTableRow = z.object({
  householdSize: z.number().int().describe("가구원 수"),
  percentages: z.record(z.string(), z.number()).describe("예: { '100%': 6200000, '120%': 7440000 }"),
});

/** 공고 파싱 결과 전체 */
export const AnnouncementParseResult = z.object({
  /* ── 기본 정보 ── */
  title: z.string().nullable(),
  announcementNo: z.string().nullable().describe("부동산원 공고번호 (예: 2024-서울-0001)"),
  region: z.string().nullable().describe("시·군·구·동 단위 주소"),
  totalUnits: z.number().int().nullable(),

  /* ── 일정 ── */
  announcementDate: IsoDate.nullable(),
  applicationStart: IsoDate.nullable().describe("청약 접수 시작일 (통합)"),
  applicationEnd: IsoDate.nullable(),
  specialApplyDate: IsoDate.nullable().describe("특별공급 접수 시작일"),
  general1stDate: IsoDate.nullable().describe("일반 1순위 접수일"),
  general2ndDate: IsoDate.nullable().describe("일반 2순위 접수일"),
  winnerAnnounceDate: IsoDate.nullable(),
  docSubmitStart: IsoDate.nullable().describe("당첨자 서류접수 시작"),
  docSubmitEnd: IsoDate.nullable(),
  contractStart: IsoDate.nullable().describe("계약체결 시작"),
  contractEnd: IsoDate.nullable(),
  moveInDate: z.string().nullable().describe("입주예정 시기 (YYYY-MM 혹은 자유)"),

  /* ── 자격 ── */
  noHomeRequired: z.boolean().nullable(),
  minSubscriptionMonths: z.number().int().nullable(),
  regulation: RegulationTier.nullable(),
  landType: z.string().nullable().describe("공공분양/민간분양/사전청약 등"),

  /* ── 상세 ── */
  supplyTypes: z.array(SupplyTypeDetail),
  exclusiveAreas: z.array(ExclusiveArea),
  requiredDocuments: z.record(z.string(), z.array(z.string())).describe("공급유형 → 필요서류 목록"),
  incomeTable: z.array(IncomeTableRow),
  assetLimit: z.string().nullable(),
  carValueLimit: z.string().nullable(),

  /* ── 제한 사항 ── */
  resaleRestriction: z.string().nullable().describe("전매제한 기간"),
  reWinRestriction: z.string().nullable().describe("재당첨 제한"),
  residenceObligation: z.string().nullable().describe("거주의무 기간"),
  priceCapApplied: z.boolean().nullable().describe("분양가 상한제 적용 여부"),

  /* ── 가점제 ── */
  pointSystemRatio: z
    .object({
      ratio: z.string(),
      items: z.array(z.string()).nullable(),
    })
    .nullable(),
});

export type AnnouncementParseResult = z.infer<typeof AnnouncementParseResult>;

/** 필드별 신뢰도 */
export type FieldConfidence = "high" | "med" | "low" | "unknown";

export interface ParseEngineResult {
  data: Partial<AnnouncementParseResult>;
  /** 각 필드의 신뢰도 (선택) */
  confidence?: Partial<Record<keyof AnnouncementParseResult, FieldConfidence>>;
  /** 엔진 메타 */
  engine: "gemini" | "openai" | "claude" | "groq" | "regex";
  durationMs: number;
  /** 실패 시 에러 메시지 */
  error?: string;
}

/** 여러 엔진 결과 병합 후 최종 응답 */
export interface ConsensusResult {
  data: Partial<AnnouncementParseResult>;
  confidence: Partial<Record<keyof AnnouncementParseResult, FieldConfidence>>;
  engines: Array<{ engine: string; success: boolean; durationMs: number; error?: string }>;
  totalDurationMs: number;
}
