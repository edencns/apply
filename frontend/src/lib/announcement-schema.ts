/**
 * 모집공고 PDF 파싱 결과 Zod 스키마 — 단일 소스
 *
 * Gemini `responseSchema` / OpenAI `response_format.json_schema` / Claude `tools`
 * 가 모두 같은 구조를 쓰도록 여기서 한 번만 선언한다.
 *
 * 핵심 원칙:
 *  1. 모든 리프 필드는 `null | value` — undefined/빈문자 대신 null 명시
 *  2. 추출된 값마다 `evidenceQuote`(근거 원문 1~2줄)를 요구 → 환각 필드 탐지
 *  3. 추출된 값마다 `evidencePage`(공고문 페이지 번호)를 요구 → 근거 추적
 *  4. enum 강제는 최소화. `type`은 원문 그대로, `canonicalType` 보조
 */

import { z } from "zod";

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
  /** Phase A 신규 */
  selectionMethod: z.string().nullable().describe("선정 방식 (예: '가점제 100%', '추첨 우선 후 가점', '우선공급 50% + 일반공급 50%')"),
  ineligibleReasons: z.array(z.string()).nullable().describe("신청 불가 사유 목록"),
  evidenceQuote: z.string().nullable(),
  evidencePage: z.number().int().nullable().describe("공고문 페이지 번호"),
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
  /** Phase A 신규 */
  priceMin: z.string().nullable().describe("최저 분양가 (원 단위 문자열)"),
  priceMax: z.string().nullable().describe("최고 분양가 (원 단위 문자열)"),
  evidenceQuote: z.string().nullable(),
  evidencePage: z.number().int().nullable(),
});
export type ExclusiveArea = z.infer<typeof ExclusiveArea>;

/** 소득기준표 — 행: 가구원수, 열: 소득구간 */
export const IncomeTableRow = z.object({
  householdSize: z.number().int().describe("가구원 수"),
  percentages: z.record(z.string(), z.number()).describe("예: { '100%': 6200000, '120%': 7440000 }"),
});

/** 지역 우선공급 비율 (Phase A 신규) */
export const RegionalPriority = z.object({
  region: z.string().describe("예: '양주시', '경기도', '수도권 기타'"),
  minResidenceMonths: z.number().int().nullable().describe("최소 거주 개월수"),
  ratioPercent: z.number().nullable().describe("배정 비율 %"),
  supplyScope: z.string().nullable().describe("적용 범위 (예: '일반공급', '특별공급', '전체')"),
  evidenceQuote: z.string().nullable(),
  evidencePage: z.number().int().nullable(),
});
export type RegionalPriority = z.infer<typeof RegionalPriority>;

/** 지역·면적별 청약 예치금 기준 (Phase A 신규) */
export const SubscriptionDeposit = z.object({
  areaRange: z.string().describe("예: '85㎡ 이하', '102㎡ 이하'"),
  region: z.string().describe("예: '서울/부산', '기타광역시', '기타시/군'"),
  minDeposit: z.string().describe("최소 예치금 (원 단위 문자열)"),
  evidenceQuote: z.string().nullable(),
  evidencePage: z.number().int().nullable(),
});
export type SubscriptionDeposit = z.infer<typeof SubscriptionDeposit>;

/** 주택형별 가점제/추첨제 비율 (Phase A 신규) */
export const PointLotteryRatio = z.object({
  area: z.string().describe("주택형 (예: '84A', '전체')"),
  pointPercent: z.number().nullable().describe("가점제 비율 %"),
  lotteryPercent: z.number().nullable().describe("추첨제 비율 %"),
  evidenceQuote: z.string().nullable(),
  evidencePage: z.number().int().nullable(),
});
export type PointLotteryRatio = z.infer<typeof PointLotteryRatio>;

/** 필요 서류 상세 (Phase A 신규) — 기존 requiredDocuments(Record)는 유지 */
export const RequiredDocumentDetail = z.object({
  category: z.string().describe("공통/일반공급/신혼부부/생애최초/다자녀/노부모부양/기관추천 등"),
  name: z.string(),
  required: z.enum(["필수", "해당시"]).nullable(),
  issuer: z.string().nullable().describe("발급처 (예: '정부24', '국민건강보험공단')"),
  validityDays: z.number().int().nullable().describe("유효기간(일). 예: 3개월 이내면 90"),
  detailedVersion: z.boolean().nullable().describe("상세본 필요 여부"),
  originalRequired: z.boolean().nullable().describe("원본 필요 여부"),
  submitTiming: z.string().nullable().describe("제출 시점 (예: '서류제출기간 내', '계약 시')"),
  alternativeDocs: z.array(z.string()).nullable().describe("대체 가능 서류"),
  evidenceQuote: z.string().nullable(),
  evidencePage: z.number().int().nullable(),
});
export type RequiredDocumentDetail = z.infer<typeof RequiredDocumentDetail>;

/** 공고 파싱 결과 전체 */
export const AnnouncementParseResult = z.object({
  /* ── 기본 정보 ── */
  title: z.string().nullable(),
  announcementNo: z.string().nullable().describe("부동산원 공고번호 (예: 2024-서울-0001)"),
  region: z.string().nullable().describe("시·군·구·동 단위 주소"),
  totalUnits: z.number().int().nullable(),

  /* ── Phase A 신규: 공고 메타 ── */
  housingManagementNo: z.string().nullable().describe("주택관리번호 (예: 2026000049)"),
  approvalNo: z.string().nullable().describe("공고 승인번호"),
  developer: z.string().nullable().describe("사업주체"),
  builder: z.string().nullable().describe("시공사"),
  locationAddress: z.string().nullable().describe("공급위치 (지번 포함 정확 주소)"),
  announcementBaseDate: IsoDate.nullable().describe("자격 판정 기준일(공고 기준일). 통상 입주자모집공고일"),

  /* ── Phase A 신규: 세대수 구성 ── */
  generalTotalUnits: z.number().int().nullable().describe("일반공급 총 세대수"),
  specialTotalUnits: z.number().int().nullable().describe("특별공급 총 세대수"),
  lowestFloorPriorityUnits: z.number().int().nullable().describe("최하층 우선배정 세대수"),

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

  /* ── Phase A 신규: 신청 가능 대상 ── */
  minAge: z.number().int().nullable().describe("신청 가능 최소 나이 (보통 19)"),
  minorHeadAllowed: z.boolean().nullable().describe("세대주인 미성년자 허용 여부"),
  eligibleRegions: z.array(z.string()).nullable().describe("신청 가능 지역 목록"),
  foreignerAllowed: z.boolean().nullable().describe("외국인/재외동포 신청 가능 여부"),

  /* ── Phase A 신규: 지역 우선공급 / 예치금 / 가점·추첨 ── */
  regionalPriority: z.array(RegionalPriority).nullable(),
  subscriptionDeposits: z.array(SubscriptionDeposit).nullable(),
  rank1Criteria: z.string().nullable().describe("1순위 요건 원문 요약"),
  rank2Criteria: z.string().nullable().describe("2순위 요건 원문 요약"),
  householdHeadRequired: z.boolean().nullable().describe("세대주 요건 여부"),
  homelessHouseholdRequired: z.boolean().nullable().describe("무주택세대구성원 요건 여부"),
  singleHomeOwnerRank1Allowed: z.boolean().nullable().describe("1주택자 1순위 허용"),
  pointLotteryRatios: z.array(PointLotteryRatio).nullable(),

  /* ── 상세 ── */
  supplyTypes: z.array(SupplyTypeDetail),
  exclusiveAreas: z.array(ExclusiveArea),
  requiredDocuments: z.record(z.string(), z.array(z.string())).describe("공급유형 → 필요서류 목록"),
  requiredDocumentsDetailed: z.array(RequiredDocumentDetail).nullable(),
  incomeTable: z.array(IncomeTableRow),
  assetLimit: z.string().nullable(),
  carValueLimit: z.string().nullable(),

  /* ── 제한 사항 ── */
  resaleRestriction: z.string().nullable().describe("전매제한 기간"),
  reWinRestriction: z.string().nullable().describe("재당첨 제한"),
  residenceObligation: z.string().nullable().describe("거주의무 기간"),
  priceCapApplied: z.boolean().nullable().describe("분양가 상한제 적용 여부"),
  /** Phase A 신규 */
  duplicateApplicationRule: z.string().nullable().describe("중복청약 제한 규칙 원문 요약"),
  passbookReuseBlocked: z.boolean().nullable().describe("당첨 시 청약통장 재사용 불가 여부"),
  longTermOverseasRestriction: z.string().nullable().describe("장기 해외체류 시 우선공급 제한 규칙"),

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
