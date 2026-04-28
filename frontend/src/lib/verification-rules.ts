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
  if (properties.length === 0 && !customer.property_checked_at) {
    return missing();
  }

  // 현재 보유 + 주거용만 카운트 (본인+세대원)
  const current = properties.filter(
    (p) => !p.transferredDate && isResidentialUse(p.usage),
  );

  /**
   * 단독주택 합산 규칙 — 도메인 정책:
   *   같은 소유자의 단독주택은 주소가 여러 개여도 1주택으로 카운트.
   *   (다가구주택의 호별 등기, 아파트 등 다른 유형은 행 단위 그대로 카운트)
   *
   * 반환: 합산된 effective count.
   */
  const collapseDetachedHouses = (props: typeof current): number => {
    const detached = props.filter((p) => /단독주택/.test(p.usage || ""));
    const others = props.filter((p) => !/단독주택/.test(p.usage || ""));
    return (detached.length > 0 ? 1 : 0) + others.length;
  };
  const currentEffective = collapseDetachedHouses(current);
  const detachedCollapsed = current.filter((p) => /단독주택/.test(p.usage || "")).length;

  // ── 분리세대 주택 합산 ──
  // 배우자 분리세대 = 법적 같은 세대 → 본인 판정에 합산
  // 그 외(자녀·부모 등) 분리세대 = 원칙적으로 본인 판정에 영향 없음, 단 경고 표시
  const separatedMembers = customer.separated_household_members || [];
  const separatedProperties = customer.separated_properties || [];
  const spouseRrns = new Set(
    separatedMembers
      .filter((m) => /배우자|부인|남편|처|妻|夫/.test(m.relation || ""))
      .map((m) => (m.rrn || "").replace(/[^\d]/g, "").slice(0, 6))
      .filter(Boolean),
  );

  // 분리세대 PDF에 기록된 주택 중 배우자 것만 본인 합산
  const spouseProps = separatedProperties.filter((p) => {
    const rrnFront = (p.ownerRrn || "").replace(/[^\d]/g, "").slice(0, 6);
    if (!rrnFront) return false;
    if (spouseRrns.has(rrnFront)) return true;
    if (/배우자/.test(p.relation || "")) return true;
    return false;
  }).filter((p) => !p.transferredDate && isResidentialUse(p.usage));

  const nonSpouseSeparatedProps = separatedProperties.filter(
    (p) => !spouseProps.includes(p) && !p.transferredDate && isResidentialUse(p.usage),
  );

  // 본인 + 배우자 합산 — 단독주택 합산 규칙은 본인·배우자 각각 적용 후 더함
  const spouseEffective = collapseDetachedHouses(spouseProps);
  const combinedCount = currentEffective + spouseEffective;
  const regulation = (announcement?.eligibility_rules?.regulation as string) || "";

  const warnings: string[] = [];
  const reasons: string[] = [];

  // 단독주택 합산 안내 — 행 수와 effective count가 다르면 사용자에게 명시
  const detachedNote = detachedCollapsed >= 2
    ? ` (단독주택 ${detachedCollapsed}행을 1주택으로 합산)`
    : "";

  if (regulation === "투기과열" || regulation === "청약과열") {
    // 강화 규제: 1건이라도 보유 시 부적합
    if (combinedCount > 0) {
      const sources: string[] = [];
      if (currentEffective > 0) sources.push(`본인 세대 ${currentEffective}건${detachedNote}`);
      if (spouseEffective > 0) sources.push(`배우자 분리세대 ${spouseEffective}건`);
      reasons.push(`${regulation}지구 — 주택 보유 ${combinedCount}건 (${sources.join(" + ")})`);
    }
  } else {
    // 비규제 / 미지정: 2주택 이상 부적격, 1주택은 경고
    if (combinedCount >= 2) {
      const sources: string[] = [];
      if (currentEffective > 0) sources.push(`본인 세대 ${currentEffective}건${detachedNote}`);
      if (spouseEffective > 0) sources.push(`배우자 분리세대 ${spouseEffective}건`);
      reasons.push(`주택 보유 ${combinedCount}건 (${sources.join(" + ")}) — 2주택 이상 부적격`);
    } else if (combinedCount === 1) {
      warnings.push(`1주택 보유 — 일반공급 가점제에서 감점${detachedNote}`);
    }
  }

  // 비배우자 분리세대원(자녀·부모 등) 주택은 판정 영향 없지만 경고
  if (nonSpouseSeparatedProps.length > 0) {
    const owners = Array.from(
      new Set(nonSpouseSeparatedProps.map((p) => p.ownerName).filter(Boolean)),
    );
    warnings.push(
      `분리세대원(${owners.join(", ")}) 주택 ${nonSpouseSeparatedProps.length}건 발견 — ` +
      `원칙상 본인 판정 무관이나 60세 미만 직계존속 등 특수 조건은 수동 확인 권장`,
    );
  }

  // 분리세대 체크 누락 경고 (분리세대원은 등록됐지만 주택소유 PDF 미업로드)
  if (separatedMembers.length > 0 && !customer.separated_property_checked_at) {
    warnings.push(
      `분리세대원 ${separatedMembers.length}명 등록됨 — 청약홈 회신 PDF 업로드 필요 (배우자 포함 시 판정에 영향)`,
    );
  }

  if (reasons.length > 0) {
    return fail(reasons, {
      context: {
        count: currentEffective,
        rawCount: current.length,
        spouseCount: spouseEffective,
        combinedCount,
        regulation,
        detachedCollapsed,
      },
      warnings,
    });
  }

  return {
    ok: true,
    reasons: [],
    warnings,
    missing: false,
    context: {
      count: currentEffective,
      rawCount: current.length,
      spouseCount: spouseEffective,
      combinedCount,
      regulation: regulation || "비규제",
      detachedCollapsed,
    },
  };
}

/* ─── Stage 4: 청약통장 순위 (선택사항 — 경고만, 부적합 판정 X) ─────────

   청약 당첨자는 이미 청약통장 1순위 요건을 통과한 상태이므로 본 시스템의
   서류 검수 단계에서 통장 조건으로 재차 부적합 처리하는 건 과도함.
   데이터 수집 목적은 유지하되 모든 이슈는 warnings(참고)로만 표시.
   ──────────────────────────────────────────── */

export function evaluateSavings(
  customer: LocalCustomer,
  announcement?: LocalAnnouncement | null,
): StageVerdict {
  const s = customer.savings_priority;
  if (!s) return missing();

  const warnings: string[] = [];

  // 1) 순위확인 검증 결과 — 경고로만 표시
  if (!s.verified) {
    const note = s.errorNote || `결과 코드 ${s.resultLength}`;
    warnings.push(`청약통장 순위확인 실패 (참고): ${note}`);
  }

  // 2) 공고의 최소 가입기간 조건 — 경고로만 표시
  const minMonths = announcement?.eligibility_rules?.min_subscription_period as number | undefined;
  const cust = customer.subscription_months ?? 0;
  if (typeof minMonths === "number" && minMonths > 0 && cust < minMonths) {
    warnings.push(`청약통장 가입기간 참고: 공고 최소 ${minMonths}개월, 현재 ${cust}개월`);
  }

  // 항상 ok=true 반환 (부적합 사유에서 제외)
  return {
    ok: true,
    reasons: [],
    warnings,
    missing: false,
    context: { minMonths, current: cust, advisory: true },
  };
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
  // 단, savings(청약통장)는 선택사항 — missing이어도 pending으로 만들지 않음
  const hasMissing = (Object.entries(stages) as Array<[string, StageVerdict]>)
    .filter(([key]) => key !== "savings")
    .some(([, s]) => s.missing);
  const verdict: "eligible" | "ineligible" | "pending" =
    reasons.length > 0
      ? "ineligible"
      : hasMissing
        ? "pending"
        : "eligible";

  return { verdict, reasons, warnings, stages };
}
