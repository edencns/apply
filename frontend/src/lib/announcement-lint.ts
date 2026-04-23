/**
 * 공고 데이터 자체 감사 — "추출됐지만 수동 검토가 필요한 부분" 찾기
 *
 * 사용처: 상세 페이지 상단 "검토 필요" 배너.
 * Gemini·Groq·regex 혼합 추출 결과에서 누락·비정상 패턴을 자동 감지해
 * 담당자가 짧은 시간에 "무엇을 수동 확인해야 하는가"를 알 수 있게 함.
 */

export interface LintIssue {
  severity: "error" | "warning" | "info";
  category: "meta" | "schedule" | "units" | "eligibility" | "regulation" | "supply" | "docs";
  field: string;      // 스니펫 식별자 (예: "housing_management_no")
  label: string;      // 사람이 읽을 수 있는 이름
  message: string;    // 상세 설명
  page?: number;      // 공고문에서 확인할 페이지 (있으면)
  tab?: string;       // 점프할 탭 (overview/eligibility/special/income/documents)
}

function isBlank(v: any): boolean {
  return v === null || v === undefined || v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v || {}).length === 0);
}

function parseDate(s: any): Date | null {
  if (!s || typeof s !== "string") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** rules 객체 + ann 스칼라를 받아 감사 결과 반환 */
export function lintAnnouncement(ann: any, rules: Record<string, any>): LintIssue[] {
  const issues: LintIssue[] = [];

  // ─── 메타 — 기본 식별 정보 ───
  if (isBlank(rules.housing_management_no)) {
    issues.push({ severity: "warning", category: "meta", field: "housing_management_no",
      label: "주택관리번호", message: "공고 표지나 개요 페이지에서 10자리 주택관리번호 확인 필요", tab: "overview" });
  }
  if (isBlank(rules.announcement_base_date) && isBlank(rules.announcement_date)) {
    issues.push({ severity: "error", category: "meta", field: "announcement_base_date",
      label: "공고 기준일", message: "자격 판정 기준일이 없어 모든 연령/기간 계산이 부정확해질 수 있음", tab: "overview" });
  }
  if (isBlank(rules.location_address) && isBlank(rules.region_full)) {
    issues.push({ severity: "warning", category: "meta", field: "location_address",
      label: "공급위치 주소", message: "지번 포함 정확 주소 확인 필요", tab: "overview" });
  }

  // ─── 세대수 — 합계 불일치 검사 ───
  const general = Number(rules.general_total_units || 0);
  const special = Number(rules.special_total_units || 0);
  const total = Number(rules.total_units || 0);
  if (general > 0 && special > 0 && total > 0) {
    const sum = general + special;
    const diff = Math.abs(sum - total);
    if (diff > 2) {  // 최하층 우선배정 등 소량 편차는 허용
      issues.push({ severity: "warning", category: "units", field: "total_units",
        label: "세대수 합계 불일치",
        message: `총 ${total}세대 ≠ 일반 ${general} + 특별 ${special} = ${sum} (차이 ${diff}세대)`, tab: "overview" });
    }
  }

  // ─── 일정 — 순서 검증 ───
  const appStart = parseDate(ann.application_start || rules.special_apply_date || rules.general_1st_date);
  const appEnd = parseDate(ann.application_end || rules.general_2nd_date);
  const winnerDate = parseDate(ann.winner_announce_date);
  const contractStart = parseDate(ann.contract_start);
  const contractEnd = parseDate(ann.contract_end);
  const baseDate = parseDate(rules.announcement_base_date || rules.announcement_date);
  const docStart = parseDate(rules.doc_submit_start);
  const docEnd = parseDate(rules.doc_submit_end);

  if (appStart && appEnd && appStart > appEnd) {
    issues.push({ severity: "error", category: "schedule", field: "application_end",
      label: "청약 접수 일정", message: "접수 시작이 종료보다 늦음 — 날짜 뒤집힘", tab: "overview" });
  }
  if (baseDate && appStart && baseDate > appStart) {
    issues.push({ severity: "warning", category: "schedule", field: "announcement_base_date",
      label: "공고 기준일", message: "공고 기준일이 접수 시작일보다 늦음 — 일반적이지 않은 순서", tab: "overview" });
  }
  if (appEnd && winnerDate && winnerDate < appEnd) {
    issues.push({ severity: "error", category: "schedule", field: "winner_announce_date",
      label: "당첨자 발표일", message: "발표일이 접수 종료일보다 이름 — 순서 이상", tab: "overview" });
  }
  if (docStart && docEnd && docStart > docEnd) {
    issues.push({ severity: "error", category: "schedule", field: "doc_submit_end",
      label: "서류접수 일정", message: "서류접수 시작이 종료보다 늦음", tab: "overview" });
  }
  if (contractStart && contractEnd && contractStart > contractEnd) {
    issues.push({ severity: "error", category: "schedule", field: "contract_end",
      label: "계약체결 일정", message: "계약 시작이 종료보다 늦음", tab: "overview" });
  }
  if (winnerDate && contractStart && contractStart < winnerDate) {
    issues.push({ severity: "warning", category: "schedule", field: "contract_start",
      label: "계약 시작일", message: "계약 시작이 당첨자 발표일보다 이름 — 재확인 권장", tab: "overview" });
  }

  // ─── 자격 — 핵심 요건 누락 ───
  if (isBlank(rules.regulation)) {
    issues.push({ severity: "warning", category: "eligibility", field: "regulation",
      label: "규제 지역 분류", message: "규제지역/비규제 여부가 없어 판정 기준 불확실", tab: "eligibility" });
  }
  if (isBlank(rules.min_subscription_period)) {
    issues.push({ severity: "info", category: "eligibility", field: "min_subscription_period",
      label: "최소 청약통장 가입기간", message: "공고에서 확인 후 수동 입력 필요", tab: "eligibility" });
  }
  const regional = Array.isArray(rules.regional_priority) ? rules.regional_priority : [];
  if (regional.length === 0) {
    issues.push({ severity: "info", category: "eligibility", field: "regional_priority",
      label: "지역 우선공급 비율", message: "지역·거주기간별 비율 데이터 없음 — 고급 분석 실행으로 보강 가능", tab: "eligibility" });
  } else {
    const ratioSum = regional.reduce((s: number, r: any) => s + (Number(r.ratioPercent) || 0), 0);
    if (ratioSum > 0 && Math.abs(ratioSum - 100) > 5) {
      issues.push({ severity: "warning", category: "eligibility", field: "regional_priority",
        label: "지역 우선공급 합계", message: `비율 합계가 ${ratioSum}% (100% 예상) — 데이터 재확인 필요`, tab: "eligibility" });
    }
  }
  const deposits = Array.isArray(rules.subscription_deposits) ? rules.subscription_deposits : [];
  if (deposits.length === 0) {
    issues.push({ severity: "info", category: "eligibility", field: "subscription_deposits",
      label: "청약 예치금 기준", message: "면적·지역별 예치금 데이터 없음", tab: "eligibility" });
  }

  // ─── 공급유형 — supplyTypes 없거나 단일 유형뿐 ───
  const supplyTypes = Array.isArray(rules.supply_types_detail) ? rules.supply_types_detail : [];
  if (supplyTypes.length === 0) {
    issues.push({ severity: "warning", category: "supply", field: "supply_types_detail",
      label: "공급유형 상세", message: "추출된 공급유형이 없음 — 공고문 직접 확인", tab: "special" });
  } else {
    // 특공 유형만 있고 일반공급이 없는 경우도 흔치 않음
    const hasGeneral = supplyTypes.some((s: any) => s.canonicalType === "일반공급" || s.type?.includes("일반"));
    if (!hasGeneral) {
      issues.push({ severity: "info", category: "supply", field: "supply_types_detail",
        label: "일반공급 누락 가능성", message: "일반공급 엔트리가 없음 — 공고문 확인", tab: "special" });
    }
    // 세대수 0인 항목
    const zeroUnits = supplyTypes.filter((s: any) => !s.units || s.units === 0);
    if (zeroUnits.length > 0) {
      issues.push({ severity: "info", category: "supply", field: "supply_types_detail",
        label: "세대수 미기재 유형",
        message: `${zeroUnits.map((s: any) => s.type).join(", ")} — 세대수 수동 입력 필요`, tab: "special" });
    }
  }

  // ─── 주택형 — exclusive_areas 수량 ───
  const areas = Array.isArray(rules.exclusive_areas) ? rules.exclusive_areas : [];
  if (areas.length === 0) {
    issues.push({ severity: "warning", category: "supply", field: "exclusive_areas",
      label: "주택형 정보", message: "전용면적별 세대수 데이터 없음", tab: "overview" });
  }

  // ─── 규제 — 특이 사항 누락 ───
  if (isBlank(rules.resale_restriction)) {
    issues.push({ severity: "info", category: "regulation", field: "resale_restriction",
      label: "전매제한 기간", message: "공고문 규제 섹션 확인", tab: "eligibility" });
  }
  if (isBlank(rules.residence_obligation) && rules.price_cap_applied) {
    issues.push({ severity: "warning", category: "regulation", field: "residence_obligation",
      label: "거주의무 기간",
      message: "분양가상한제 적용인데 거주의무 데이터 없음 — 공고문 필수 확인", tab: "eligibility" });
  }

  // ─── 서류 — 서류 상세 추출 여부 ───
  const docsDetailed = Array.isArray(rules.required_documents_detailed) ? rules.required_documents_detailed : [];
  if (docsDetailed.length === 0) {
    const basicDocs = rules.required_documents || {};
    if (Object.keys(basicDocs).length === 0) {
      issues.push({ severity: "info", category: "docs", field: "required_documents_detailed",
        label: "서류 상세", message: "서류 데이터 없음 — 고급 분석으로 추출 가능", tab: "documents" });
    }
  }

  return issues;
}

/** 심각도별 요약 카운트 */
export function lintSummary(issues: LintIssue[]) {
  return {
    error: issues.filter((i) => i.severity === "error").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
    total: issues.length,
  };
}
