/**
 * 서류별 담당자 확인 포인트 자동 생성
 *
 * 5단계 서류 판정 UI에서 각 서류(주민등록등본·가족관계증명서·통장확인서 등)마다
 * 담당자가 PDF를 열어봤을 때 "이 서류에서 무엇을 확인해야 하는지" 자동 표시.
 *
 * 포인트는:
 *  - 당첨자가 청약 시 신고한 조건 (customer 필드)
 *  - 공고가 요구하는 기준 (announcement.eligibility_rules)
 * 두 가지를 조합해 동적 생성.
 *
 * 예:
 *   주민등록등본 → "세대원 5명 일치 확인" (customer.dependents_count = 5)
 *                  "세대주 확인" (공고가 세대주 필수로 요구 시)
 *                  "전입일 2024-04-24 이전" (지역 우선 1년 거주 요건)
 */

import type { LocalCustomer, LocalAnnouncement } from "./local-store";

export type CheckpointSeverity = "must" | "verify" | "info";

export interface DocumentCheckpoint {
  /** 체크포인트 식별자 (저장·중복 판별용) */
  key: string;
  /** 한 줄 설명 — 담당자가 바로 이해할 수 있는 문장 */
  label: string;
  /** 기대 값 (있으면 강조 표시) */
  expected?: string;
  /** 정보 출처 */
  source: "신고값" | "공고 요건" | "조합";
  /** 중요도 */
  severity: CheckpointSeverity;
  /** 보조 설명 */
  hint?: string;
}

/* ─── 유틸 ─────────────────────────────────────── */

function fmtDate(s?: string | null): string {
  if (!s) return "";
  const m = String(s).match(/(\d{4})[-./T](\d{1,2})[-./T](\d{1,2})/);
  if (!m) return String(s);
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** 날짜 X 기준으로 N년 전 YYYY-MM-DD 반환 */
function yearsBefore(base: string, years: number): string {
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${Number(m[1]) - years}-${m[2]}-${m[3]}`;
}

function monthsBefore(base: string, months: number): string {
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  let y = Number(m[1]);
  let mo = Number(m[2]) - months;
  while (mo <= 0) { y--; mo += 12; }
  return `${y}-${String(mo).padStart(2, "0")}-${m[3]}`;
}

function supplyOf(c: LocalCustomer): string {
  return c.supply_type || c.special_types?.[0] || "일반공급";
}

/* ─── 서류 이름 매칭 (부분 일치) ─── */

function matchDoc(name: string, ...keys: string[]): boolean {
  const s = name || "";
  return keys.some((k) => s.includes(k));
}

/* ─── 개별 서류별 체크포인트 생성 ─── */

function makeRegistrationCertChecks(
  c: LocalCustomer,
  a?: LocalAnnouncement,
): DocumentCheckpoint[] {
  const out: DocumentCheckpoint[] = [];
  const baseDate = (a?.eligibility_rules as any)?.announcement_base_date;
  const supply = supplyOf(c);

  // 세대원 수
  const declared = (c as any).dependents_count ?? c.household_members?.length;
  if (declared != null) {
    out.push({
      key: "household_count",
      label: "세대원 수 일치 확인",
      expected: `${declared}명`,
      source: "신고값",
      severity: "must",
      hint: "등본상 세대원 수가 신고값과 다르면 부적합 가능",
    });
  }

  // 세대주 / 세대구성원 여부 — 공급유형 우선순위로 판정
  //   1순위: 노부모부양 → 세대주 본인 필수 (실제 규정)
  //   2순위: 신혼부부/생애최초/다자녀/신생아 → 무주택세대구성원이면 가능
  //          (공고 PDF에 household_head_required=true가 잘못 들어와도 무시)
  //   3순위: 일반공급 등 — 공고에 명시되면 세대주 체크
  const needsHead = (a?.eligibility_rules as any)?.household_head_required;
  if (supply.includes("노부모")) {
    out.push({
      key: "household_head",
      label: "세대주 본인 확인",
      expected: `${c.name} 본인이 세대주`,
      source: "공고 요건",
      severity: "must",
      hint: "노부모부양 특공은 세대주 본인 필수 (배우자·세대원은 불가)",
    });
  } else if (/신혼부부|생애최초|다자녀|신생아/.test(supply)) {
    out.push({
      key: "household_member_homeless",
      label: "무주택세대구성원 확인",
      expected: "본인 + 세대원 전원 무주택",
      source: "공고 요건",
      severity: "verify",
      hint: "세대주 강제 아님 — 본인이 세대원이어도 「세대 전원 무주택」이면 OK",
    });
  } else if (needsHead) {
    out.push({
      key: "household_head",
      label: "세대주 본인 확인",
      expected: `${c.name} 본인이 세대주`,
      source: "공고 요건",
      severity: "must",
      hint: "공고에 세대주 필수로 명시됨",
    });
  }

  // 지역 우선공급 거주기간
  const regionMonths = (a?.eligibility_rules as any)?.min_region_residence_months;
  if (regionMonths && baseDate) {
    out.push({
      key: "residence_period",
      label: `지역 거주기간 ${regionMonths}개월 이상`,
      expected: `전입일 ${monthsBefore(fmtDate(baseDate), regionMonths)} 이전`,
      source: "공고 요건",
      severity: "verify",
      hint: "등본 발급사항란의 전입일 확인",
    });
  }

  // 전원 무주택 (규제지역)
  const reg = (a?.eligibility_rules as any)?.regulation;
  if (reg === "투기과열" || reg === "청약과열") {
    out.push({
      key: "homeless_all",
      label: "세대원 전원 무주택 확인",
      source: "공고 요건",
      severity: "must",
      hint: `${reg}지구 필수`,
    });
  }

  return out;
}

function makeAbstractCertChecks(c: LocalCustomer, a?: LocalAnnouncement): DocumentCheckpoint[] {
  const out: DocumentCheckpoint[] = [];
  const baseDate = (a?.eligibility_rules as any)?.announcement_base_date;
  const regionMonths = (a?.eligibility_rules as any)?.min_region_residence_months;
  if (regionMonths && baseDate) {
    out.push({
      key: "address_history",
      label: `주소 이력상 ${regionMonths}개월 이상 거주 확인`,
      expected: `${monthsBefore(fmtDate(baseDate), regionMonths)} 이전부터 지역 내`,
      source: "공고 요건",
      severity: "must",
      hint: "초본은 이전 주소 포함돼 있어야 거주기간 계산 가능",
    });
  }
  return out;
}

function makeFamilyRegistryChecks(c: LocalCustomer): DocumentCheckpoint[] {
  const out: DocumentCheckpoint[] = [];
  const supply = supplyOf(c);

  const dep = (c as any).dependents_count;
  if (dep != null) {
    out.push({
      key: "dependents",
      label: `부양가족 수 ${dep}명 일치`,
      expected: `${dep}명`,
      source: "신고값",
      severity: "must",
    });
  }

  if (supply.includes("신혼부부")) {
    out.push({
      key: "spouse_check",
      label: "배우자 정보 일치",
      source: "조합",
      severity: "must",
      hint: "이혼 이력 및 재혼 여부 확인",
    });
  }

  if (supply.includes("다자녀")) {
    out.push({
      key: "child_count",
      label: "미성년 자녀 3명 이상 확인",
      source: "공고 요건",
      severity: "must",
      hint: "다자녀가구 특공 핵심 요건",
    });
  }

  if (supply.includes("생애최초")) {
    out.push({
      key: "first_time",
      label: "본인·배우자 생애최초 주택 구입",
      source: "공고 요건",
      severity: "must",
      hint: "과거 주택 취득 이력 전무 확인",
    });
  }

  return out;
}

function makeMarriageCertChecks(c: LocalCustomer, a?: LocalAnnouncement): DocumentCheckpoint[] {
  const out: DocumentCheckpoint[] = [];
  const supply = supplyOf(c);
  const baseDate = (a?.eligibility_rules as any)?.announcement_base_date;

  if (supply.includes("신혼부부")) {
    const maxYears = 7;
    if (baseDate) {
      out.push({
        key: "marriage_date",
        label: `혼인 ${maxYears}년 이내`,
        expected: `혼인일 ${yearsBefore(fmtDate(baseDate), maxYears)} 이후`,
        source: "공고 요건",
        severity: "must",
        hint: "혼인신고일 기준. 사실혼은 제외",
      });
    }
    out.push({
      key: "no_divorce",
      label: "현재 혼인관계 유지 확인",
      source: "공고 요건",
      severity: "must",
      hint: "이혼 이력이 있으면 재혼 기간도 7년 이내여야 함",
    });
  }

  return out;
}

function makeSavingsConfirmChecks(c: LocalCustomer, a?: LocalAnnouncement): DocumentCheckpoint[] {
  const out: DocumentCheckpoint[] = [];
  const minMonths = (a?.eligibility_rules as any)?.min_subscription_period;
  const declared = (c as any).subscription_months;

  if (minMonths) {
    out.push({
      key: "saving_months",
      label: `통장 가입기간 ${minMonths}개월 이상`,
      expected: declared ? `신고값 ${declared}개월` : undefined,
      source: "공고 요건",
      severity: "must",
    });
    out.push({
      key: "saving_payments",
      label: `납입 회차 ${minMonths}회 이상`,
      source: "공고 요건",
      severity: "must",
      hint: "회차와 가입기간은 별개. 미납 개월 확인",
    });
  }

  return out;
}

function makeIncomeChecks(c: LocalCustomer, a?: LocalAnnouncement): DocumentCheckpoint[] {
  const out: DocumentCheckpoint[] = [];
  const supply = supplyOf(c);
  const limit = (a?.eligibility_rules as any)?.income_limit;

  if (limit) {
    out.push({
      key: "income_limit",
      label: `전년도 소득 ${Number(limit).toLocaleString("ko-KR")}원 이하`,
      source: "공고 요건",
      severity: "must",
      hint: "총급여 또는 종합소득금액 기준 (공고 확인)",
    });
  }
  if (supply.includes("신혼부부")) {
    out.push({
      key: "combined_income",
      label: "부부 합산 소득 확인",
      source: "공고 요건",
      severity: "verify",
      hint: "신혼부부 특공은 맞벌이 시 합산 소득 기준 적용",
    });
  }

  return out;
}

function makePropertyConfirmChecks(c: LocalCustomer, a?: LocalAnnouncement): DocumentCheckpoint[] {
  const out: DocumentCheckpoint[] = [];
  const reg = (a?.eligibility_rules as any)?.regulation;
  const noHomeYears = (c as any).no_home_years;

  if (noHomeYears != null && noHomeYears > 0) {
    out.push({
      key: "no_home_years",
      label: `무주택 기간 ${noHomeYears}년 주장값 확인`,
      expected: `${noHomeYears}년`,
      source: "신고값",
      severity: "must",
      hint: "과거 주택 처분 이력이 있으면 처분일 ≥ 주장 기간 이전이어야 함",
    });
  }

  if (reg === "투기과열" || reg === "청약과열") {
    out.push({
      key: "no_property",
      label: "세대 전원 무주택",
      source: "공고 요건",
      severity: "must",
      hint: `${reg}지구 필수`,
    });
  }

  return out;
}

function makeSealCertChecks(): DocumentCheckpoint[] {
  return [
    {
      key: "seal_recent",
      label: "발급일 3개월 이내",
      source: "공고 요건",
      severity: "must",
      hint: "발급일자가 3개월 경과 시 재발급 요구",
    },
  ];
}

function makeIdChecks(c: LocalCustomer): DocumentCheckpoint[] {
  return [
    {
      key: "id_match",
      label: `신분증 성명·주민번호 일치 (${c.name})`,
      source: "신고값",
      severity: "must",
      hint: "유효기간 만료 여부도 확인",
    },
  ];
}

function makeBirthCertChecks(c: LocalCustomer): DocumentCheckpoint[] {
  const supply = supplyOf(c);
  if (!supply.includes("다자녀") && !supply.includes("신혼부부")) return [];
  return [
    {
      key: "child_birth",
      label: "자녀 출생일 (미성년 여부) 확인",
      source: "공고 요건",
      severity: "verify",
      hint: "다자녀는 미성년 자녀 수가 요건",
    },
  ];
}

/* ─── 공개 API ─────────────────────────────────── */

/**
 * 서류 이름 + 당첨자 + 공고 → 자동 생성 체크포인트 배열.
 * 매칭 실패하면 빈 배열 반환.
 */
export function getCheckpointsForDocument(
  docName: string,
  customer: LocalCustomer,
  announcement?: LocalAnnouncement,
): DocumentCheckpoint[] {
  if (matchDoc(docName, "주민등록등본", "주민등본", "등본")) {
    return makeRegistrationCertChecks(customer, announcement);
  }
  if (matchDoc(docName, "주민등록초본", "초본")) {
    return makeAbstractCertChecks(customer, announcement);
  }
  if (matchDoc(docName, "가족관계증명서", "가족관계")) {
    return makeFamilyRegistryChecks(customer);
  }
  if (matchDoc(docName, "혼인관계증명서", "혼인관계")) {
    return makeMarriageCertChecks(customer, announcement);
  }
  if (matchDoc(docName, "청약통장", "입주자저축", "순위확인")) {
    return makeSavingsConfirmChecks(customer, announcement);
  }
  if (matchDoc(docName, "소득", "원천징수", "근로소득")) {
    return makeIncomeChecks(customer, announcement);
  }
  if (matchDoc(docName, "주택소유", "부동산 소유", "등기부")) {
    return makePropertyConfirmChecks(customer, announcement);
  }
  if (matchDoc(docName, "인감증명")) {
    return makeSealCertChecks();
  }
  if (matchDoc(docName, "신분증", "주민등록증", "운전면허")) {
    return makeIdChecks(customer);
  }
  if (matchDoc(docName, "출생증명", "자녀")) {
    return makeBirthCertChecks(customer);
  }
  return [];
}
