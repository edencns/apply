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
import { classifyAddress } from "./region-classifier";

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

/* ─── 날짜·연령 헬퍼 ─────────────────────────────────── */

/** 'YYYY-MM-DD' / 'YYYYMMDD' / 'YYYY.MM.DD' 등 다양한 포맷 → Date | null */
export function parseAnyDate(s?: string | null): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  // YYYYMMDD
  const m1 = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m1) return new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
  // YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
  const m2 = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m2) return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 두 날짜 사이 개월 수 (반올림 X, 정수 floor) */
export function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12
    + (b.getMonth() - a.getMonth())
    + (b.getDate() < a.getDate() ? -1 : 0);
}

/** 두 날짜 사이 연도 수 */
export function yearsBetween(a: Date, b: Date): number {
  let y = b.getFullYear() - a.getFullYear();
  const m = b.getMonth() - a.getMonth();
  if (m < 0 || (m === 0 && b.getDate() < a.getDate())) y--;
  return y;
}

/**
 * 주민번호 앞자리 + 뒷자리 1자리 → 생년월일 Date.
 * 뒷자리 첫 숫자가 세기를 결정:
 *   0,9 → 1800년대 (희박, 외국인 등록증)
 *   1,2,5,6 → 1900년대
 *   3,4,7,8 → 2000년대
 */
export function birthFromRrn(rrnFront?: string, rrnBack?: string): Date | null {
  if (!rrnFront || rrnFront.length < 6) return null;
  const yy = Number(rrnFront.slice(0, 2));
  const mm = Number(rrnFront.slice(2, 4));
  const dd = Number(rrnFront.slice(4, 6));
  if (Number.isNaN(yy) || Number.isNaN(mm) || Number.isNaN(dd)) return null;
  const c = rrnBack ? Number(String(rrnBack).slice(0, 1)) : NaN;
  let year: number;
  if ([1, 2, 5, 6].includes(c)) year = 1900 + yy;
  else if ([3, 4, 7, 8].includes(c)) year = 2000 + yy;
  else if ([0, 9].includes(c)) year = 1800 + yy;
  else {
    // 뒷자리 미상 — yy로 추정 (1925~2024 범위에서 가장 그럴듯한 해)
    year = yy <= 24 ? 2000 + yy : 1900 + yy;
  }
  return new Date(year, mm - 1, dd);
}

export function calcAge(birth: Date, ref: Date = new Date()): number {
  return yearsBetween(birth, ref);
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

  // 무주택 기간 자동 검증 — 신고값과 자동계산값 비교
  const auto = calculateNoHomeYears(customer);
  if (auto != null) {
    ctx.noHomeYearsAuto = auto;
    const declared = (customer as any).no_home_years;
    if (declared != null && Math.abs(declared - auto) >= 2) {
      return ok({
        context: ctx,
        warnings: [
          `무주택 기간 신고값(${declared}년)과 자동계산값(${auto}년) 차이 ≥2년 — 검증 필요. ` +
          `자동계산은 만 30세 도달일 또는 혼인일 중 빠른 시점부터 산정 (현재 보유 주택 있으면 0).`,
        ],
      });
    }
  }
  return ok({ context: ctx });
}

/**
 * 무주택 기간 자동 계산 — 청약 가점제 기준:
 *   시작일 = max(만 30세 도달일, 혼인일) (둘 다 있으면 빠른 쪽)
 *   현재 시점 기준으로 보유 주택 있으면 0년 (유주택)
 *   없으면 (현재 - 시작일) 연 단위 반환
 *
 * 만 30세 미만이고 미혼이면 0 반환 (무주택 기간 산정 대상 아님).
 */
export function calculateNoHomeYears(customer: LocalCustomer): number | null {
  const birth = birthFromRrn(customer.rrn_front, customer.rrn_back);
  if (!birth) return null;
  const today = new Date();
  const age = calcAge(birth, today);
  const marriage = parseAnyDate((customer as any).marriage_date);

  // 만30세 도달일
  const age30 = new Date(birth.getFullYear() + 30, birth.getMonth(), birth.getDate());

  // 산정 시작일
  let start: Date;
  if (marriage && marriage < age30) {
    start = marriage;
  } else if (age >= 30) {
    start = age30;
  } else if (marriage) {
    start = marriage;
  } else {
    return 0; // 만30세 미만 + 미혼 → 산정 대상 아님
  }
  if (start > today) return 0;

  // 현재 보유 주택이 있으면 0 (단, 예외 룰 적용된 후 effective count 기준 — 여기선
  // 보수적으로 모든 properties 카운트)
  const properties = customer.properties || [];
  const hasActive = properties.some(
    (p) => !p.transferredDate && isResidentialUse(p.usage),
  );
  if (hasActive) return 0;

  return Math.max(0, yearsBetween(start, today));
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
  const beforeExceptions = properties.filter(
    (p) => !p.transferredDate && isResidentialUse(p.usage),
  );

  // ─── 무주택 예외 룰 (eligibility_rules 의 임계값 사용) ───────────
  const rules = announcement?.eligibility_rules || {};
  const SMALL_AREA_MAX     = Number(rules.small_low_house_area_max) || 60;
  // 수도권/비수도권 별도 한도 (주택공급에 관한 규칙 기준).
  // - 수도권(서울·인천·경기): 1.6억
  // - 비수도권: 1억
  // 공고에 명시 없으면 단일값 small_low_house_price_max → 양쪽 동일 fallback.
  const SMALL_PRICE_MAX_METRO     = Number(rules.small_low_house_price_max_metro)     || Number(rules.small_low_house_price_max) || 160_000_000;
  const SMALL_PRICE_MAX_NON_METRO = Number(rules.small_low_house_price_max_non_metro) || Number(rules.small_low_house_price_max) || 100_000_000;
  const INHERITANCE_MONTHS = Number(rules.inheritance_grace_months) || 6;
  const TEMP_2HOUSE_MONTHS = Number(rules.temporary_2housing_grace_months) || 36;

  const today = new Date();
  const exceptionWarnings: string[] = [];

  /** 1) 소형·저가주택 예외 — 60㎡ 이하 + 공시가격 한도 이하면 무주택 인정.
   *  수도권(서울·인천·경기) 1.6억 / 비수도권 1억으로 분기. */
  let smallLowApplied = 0;
  let smallAreaButPriceUnknown = 0;
  const priceMaxForProperty = (p: any): number => {
    const region = p?.regionType || classifyAddress(p?.address);
    return region === "non_metro" ? SMALL_PRICE_MAX_NON_METRO : SMALL_PRICE_MAX_METRO;
  };
  const afterSmallLow = beforeExceptions.filter((p) => {
    const isSmall = (p.areaM2 ?? Infinity) > 0 && (p.areaM2 ?? Infinity) <= SMALL_AREA_MAX;
    if (!isSmall) return true;
    const limit = priceMaxForProperty(p);
    if ((p as any).officialPrice != null) {
      // 공시가격 데이터 있음 → 자동 판정
      if ((p as any).officialPrice <= limit) {
        smallLowApplied++;
        return false;
      }
      return true;
    }
    // 공시가격 데이터 없음 — 면적 기준만 만족. 일단 카운트 유지하고 경고
    smallAreaButPriceUnknown++;
    return true;
  });
  if (smallLowApplied > 0) {
    exceptionWarnings.push(
      `소형·저가주택 ${smallLowApplied}건 자동 무주택 예외 적용 (≤${SMALL_AREA_MAX}㎡ + 공시가격: 수도권 ≤${(SMALL_PRICE_MAX_METRO/100_000_000).toFixed(1)}억 / 비수도권 ≤${(SMALL_PRICE_MAX_NON_METRO/100_000_000).toFixed(1)}억)`,
    );
  }
  if (smallAreaButPriceUnknown > 0) {
    exceptionWarnings.push(
      `소형 주택 ${smallAreaButPriceUnknown}건 — 면적 ≤${SMALL_AREA_MAX}㎡ 충족. 「공시가격 자동 조회」 또는 수동 입력으로 무주택 예외 적용 가능 (수도권 ≤${(SMALL_PRICE_MAX_METRO/100_000_000).toFixed(1)}억 / 비수도권 ≤${(SMALL_PRICE_MAX_NON_METRO/100_000_000).toFixed(1)}억)`,
    );
  }

  /** 2) 상속 주택 예외 — 상속일로부터 N개월 이내면 처분 약정 가정 무주택 인정 */
  let inheritedApplied = 0;
  let inheritedExpired = 0;
  const afterInheritance = afterSmallLow.filter((p) => {
    if (!/상속/.test(p.changeReason || "")) return true;
    const inheritDate = parseAnyDate(p.changeDate || p.acquiredDate);
    if (!inheritDate) {
      // 일자 없으면 일단 예외 적용 + 검증 권장 경고
      inheritedApplied++;
      return false;
    }
    const months = monthsBetween(inheritDate, today);
    if (months <= INHERITANCE_MONTHS) {
      inheritedApplied++;
      return false;
    }
    inheritedExpired++;
    return true;
  });
  if (inheritedApplied > 0) {
    exceptionWarnings.push(
      `상속 주택 ${inheritedApplied}건 무주택 예외 적용 (상속 ${INHERITANCE_MONTHS}개월 이내) — 처분 약정서 확인 권장`,
    );
  }
  if (inheritedExpired > 0) {
    exceptionWarnings.push(
      `상속 주택 ${inheritedExpired}건 — 상속 ${INHERITANCE_MONTHS}개월 경과로 예외 만료, 일반 보유로 카운트`,
    );
  }

  /** 합산 룰 적용 — 단독·다가구는 1로 합산, 그 외 행 단위 */
  const collapseDetachedHouses = (props: typeof afterInheritance): number => {
    const detached = props.filter((p) => /단독주택/.test(p.usage || ""));
    const dagagu   = props.filter((p) => /다가구주택/.test(p.usage || ""));
    const others   = props.filter((p) =>
      !/단독주택/.test(p.usage || "") &&
      !/다가구주택/.test(p.usage || ""),
    );
    return (detached.length > 0 ? 1 : 0)
         + (dagagu.length   > 0 ? 1 : 0)
         + others.length;
  };
  const current = afterInheritance;
  const currentEffective = collapseDetachedHouses(current);
  const detachedCollapsed = current.filter((p) => /단독주택/.test(p.usage || "")).length;
  const dagaguCollapsed   = current.filter((p) => /다가구주택/.test(p.usage || "")).length;

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

  const warnings: string[] = [...exceptionWarnings];
  const reasons: string[] = [];

  /** 3) 일시적 2주택 감지 — 정확히 2주택 + 최근 취득이 grace 기간 이내 */
  let temporaryTwoHousing = false;
  if (combinedCount === 2) {
    // 가장 최근 취득일 찾기 (본인 properties 중)
    const acquireDates = current
      .map((p) => parseAnyDate(p.acquiredDate || p.contractDate || p.changeDate))
      .filter((d): d is Date => !!d);
    if (acquireDates.length > 0) {
      const mostRecent = acquireDates.reduce((a, b) => (a > b ? a : b));
      const monthsAgo = monthsBetween(mostRecent, today);
      if (monthsAgo >= 0 && monthsAgo <= TEMP_2HOUSE_MONTHS) {
        temporaryTwoHousing = true;
        warnings.push(
          `🟡 일시적 2주택 가능 — 최근 취득 ${monthsAgo}개월 전 ` +
          `(처분 기한 ${TEMP_2HOUSE_MONTHS}개월). 입주자모집공고일까지 ` +
          `기존 주택 처분 약정 시 무주택 인정 가능 — 수동 확인 필요.`,
        );
      }
    }
  }

  // 합산 안내 — 행 수와 effective count가 다르면 사용자에게 명시
  const collapseNotes: string[] = [];
  if (detachedCollapsed >= 2) collapseNotes.push(`단독주택 ${detachedCollapsed}행을 1주택`);
  if (dagaguCollapsed >= 2)   collapseNotes.push(`다가구주택 ${dagaguCollapsed}호(행)을 1주택`);
  const detachedNote = collapseNotes.length > 0
    ? ` (${collapseNotes.join(", ")}으로 합산)`
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
        dagaguCollapsed,
        smallLowApplied,
        inheritedApplied,
        temporaryTwoHousing,
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
      dagaguCollapsed,
      smallLowApplied,
      inheritedApplied,
      temporaryTwoHousing,
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
