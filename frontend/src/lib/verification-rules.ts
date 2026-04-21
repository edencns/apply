/**
 * 공고 기준을 반영한 단계별 판정 엔진
 *
 * 각 단계 평가 함수는 `(customer, announcement)`를 받아 `StageVerdict`를 반환한다.
 * - ok=true  → 해당 단계 통과
 * - ok=false → reasons 배열에 부적합 사유 나열
 * - missing  → 판정에 필요한 데이터가 아직 없음 (예: 세대원내역 업로드 전)
 *
 * 공고의 `eligibility_rules` 에서 읽는 주요 필드:
 *   - regulation: "투기과열" | "청약과열" | "비규제"
 *   - min_subscription_period: number (개월)
 *   - min_region_residence_months: number (개월)
 *   - required_documents: Record<category, string[]>
 *   - income_table, asset_limit (차후 확장용)
 */

import type { LocalCustomer, LocalAnnouncement } from "./local-store";

/** 단계별 판정 결과 */
export interface StageVerdict {
  /** 통과 여부. missing=true 면 ok는 의미 없음 */
  ok: boolean;
  /** 부적합 사유 또는 경고 (빈 배열이면 문제 없음) */
  reasons: string[];
  /** 부드러운 경고 (판정에는 영향 없지만 사용자에게 알림) */
  warnings: string[];
  /** 판정에 필요한 데이터가 없을 때 */
  missing: boolean;
  /** 참고 컨텍스트 (UI 표시용) */
  context?: Record<string, any>;
}

function ok(extra: Partial<StageVerdict> = {}): StageVerdict {
  return { ok: true, reasons: [], warnings: [], missing: false, ...extra };
}
function fail(reasons: string[], extra: Partial<StageVerdict> = {}): StageVerdict {
  return { ok: false, reasons, warnings: [], missing: false, ...extra };
}
function missing(extra: Partial<StageVerdict> = {}): StageVerdict {
  return { ok: false, reasons: [], warnings: [], missing: true, ...extra };
}

/** 주거용 용도 판별 — 주택소유 레코드의 `용도 등` 필드 기준 */
export function isResidentialUse(usage?: string): boolean {
  if (!usage) return true; // 미상은 보수적으로 주거용 간주
  if (/토지|임야|전|답|상가|사무실|공장|창고/.test(usage)) return false;
  return true;
}

/* ─── Stage 1: 당첨자 등록 ─────────────────────────── */

export function evaluateRegistration(customer: LocalCustomer): StageVerdict {
  // 필수 필드: 성명, 주민번호 앞자리
  if (!customer.name) return fail(["성명 미입력"]);
  if (!customer.rrn_front || customer.rrn_front.length < 6) {
    return fail(["주민번호 앞자리 미입력"]);
  }
  const ctx: Record<string, any> = {};
  if (!customer.unit_type) ctx.note = "주택형 미확인";
  if (!customer.supply_type) ctx.note = "공급유형 미지정";
  return ok({ context: ctx });
}

/* ─── Stage 2: 세대원 확인 ─────────────────────────── */

export function evaluateHousehold(customer: LocalCustomer): StageVerdict {
  const members = customer.household_members || [];
  if (members.length === 0) return missing();
  const issues = members.filter((m) => m.errorCode);
  if (issues.length > 0) {
    return fail([`세대원 오류코드 ${issues.length}건 — 주민번호 불일치·사망·출국 등 재확인 필요`]);
  }
  return ok({ context: { count: members.length } });
}

/* ─── Stage 3: 주택소유 조회 ───────────────────────── */

export function evaluateProperty(
  customer: LocalCustomer,
  announcement?: LocalAnnouncement | null,
): StageVerdict {
  const properties = customer.properties || [];
  // 주택소유 전산검색 파일이 업로드된 적 있으면, 레코드 없는 사람은 "무주택"으로 확정
  if (properties.length === 0) {
    if (customer.property_checked_at) {
      return {
        ok: true,
        reasons: [],
        warnings: [],
        missing: false,
        context: { count: 0, regulation: "무주택 확정", verified: true },
      };
    }
    return missing();
  }

  // 현재 보유 + 주거용만 카운트
  const current = properties.filter(
    (p) => !p.transferredDate && isResidentialUse(p.usage),
  );
  const count = current.length;
  const regulation = (announcement?.eligibility_rules?.regulation as string) || "";

  const warnings: string[] = [];

  if (regulation === "투기과열" || regulation === "청약과열") {
    // 강화 규제: 1건이라도 보유 시 부적합
    if (count > 0) {
      return fail([`${regulation}지구 — 세대 주택 보유 ${count}건 (유주택자 배제)`], {
        context: { count, regulation },
      });
    }
  } else {
    // 비규제 / 미지정: 2주택 이상 부적격, 1주택은 경고
    if (count >= 2) {
      return fail([`세대 주택 보유 ${count}건 (2주택 이상 부적격)`], {
        context: { count, regulation: regulation || "비규제" },
      });
    }
    if (count === 1) {
      warnings.push("1주택 보유 — 일반공급 가점제에서 감점");
    }
  }

  return { ok: true, reasons: [], warnings, missing: false, context: { count, regulation: regulation || "비규제" } };
}

/* ─── Stage 4: 청약통장 순위 ───────────────────────── */

export function evaluateSavings(
  customer: LocalCustomer,
  announcement?: LocalAnnouncement | null,
): StageVerdict {
  const s = customer.savings_priority;
  if (!s) return missing();

  const reasons: string[] = [];

  // 1) 순위확인 검증 결과
  if (!s.verified) {
    const note = s.errorNote || `결과 코드 ${s.resultLength})`;
    reasons.push(`청약통장 순위확인 실패: ${note}`);
  }

  // 2) 공고의 최소 가입기간 조건
  const minMonths = announcement?.eligibility_rules?.min_subscription_period as number | undefined;
  const cust = customer.subscription_months ?? 0;
  if (typeof minMonths === "number" && minMonths > 0 && cust < minMonths) {
    reasons.push(`청약통장 가입기간 부족 — 최소 ${minMonths}개월 필요, 현재 ${cust}개월`);
  }

  return reasons.length > 0
    ? fail(reasons, { context: { minMonths, current: cust } })
    : ok({ context: { minMonths, current: cust } });
}

/* ─── Stage 5: 서류 제출 ───────────────────────────── */

export function evaluateDocuments(
  submitted: Record<string, boolean>,
  requiredDocs: Array<{ name: string; conditional: boolean }>,
): StageVerdict {
  const missingDocs = requiredDocs
    .filter((d) => !d.conditional && !submitted[d.name])
    .map((d) => d.name);

  if (requiredDocs.length === 0) return missing();
  if (missingDocs.length > 0) {
    const preview = missingDocs.slice(0, 3).join(", ");
    const more = missingDocs.length > 3 ? ` 외 ${missingDocs.length - 3}건` : "";
    return fail([`필수 서류 ${missingDocs.length}건 미제출: ${preview}${more}`], {
      context: { missingDocs },
    });
  }
  return ok({ context: { totalSubmitted: requiredDocs.filter((d) => submitted[d.name]).length } });
}

/* ─── 최종 통합 판정 ─────────────────────────────── */

export interface FinalVerdict {
  verdict: "eligible" | "ineligible" | "pending";
  reasons: string[];
  warnings: string[];
  stages: {
    registration: StageVerdict;
    household: StageVerdict;
    property: StageVerdict;
    savings: StageVerdict;
    documents: StageVerdict;
  };
}

export function evaluateFinal(
  customer: LocalCustomer,
  announcement: LocalAnnouncement | null | undefined,
  submitted: Record<string, boolean>,
  requiredDocs: Array<{ name: string; conditional: boolean }>,
): FinalVerdict {
  const stages = {
    registration: evaluateRegistration(customer),
    household: evaluateHousehold(customer),
    property: evaluateProperty(customer, announcement),
    savings: evaluateSavings(customer, announcement),
    documents: evaluateDocuments(submitted, requiredDocs),
  };

  const reasons: string[] = [];
  const warnings: string[] = [];

  for (const s of Object.values(stages)) {
    reasons.push(...s.reasons);
    warnings.push(...s.warnings);
  }

  // 데이터 누락 단계는 판정 보류 (pending)
  const hasMissing = Object.values(stages).some((s) => s.missing);
  const verdict: "eligible" | "ineligible" | "pending" =
    reasons.length > 0
      ? "ineligible"
      : hasMissing
        ? "pending"
        : "eligible";

  return { verdict, reasons, warnings, stages };
}
