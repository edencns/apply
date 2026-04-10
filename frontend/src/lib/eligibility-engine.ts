// 청약 자격 검증 엔진 - 2025년 기준
// 엑셀 데이터 기반 모든 청약 규칙 구현

// ============ 타입 정의 ============

export interface UserInput {
  // 기본 정보
  age: number;
  isHouseholdHead: boolean;
  maritalStatus: 'single' | 'married' | 'divorced' | 'widowed';
  marriageDurationMonths: number; // 혼인기간 (개월)
  spouseAge: number | null;

  // 주택 정보
  isHomeless: boolean; // 무주택 여부
  homelessPeriodYears: number; // 무주택 기간 (년)
  householdAllHomeless: boolean; // 세대구성원 전원 무주택
  ownedHouseCount: number; // 소유 주택 수
  hasPastWinning: boolean; // 과거 당첨 사실
  pastWinningYearsAgo: number; // 당첨 후 경과 년수

  // 청약통장 정보
  accountType: 'comprehensive' | 'savings' | 'deposit' | 'installment'; // 종합저축/저축/예금/부금
  accountOpenDate: string; // 가입일 (YYYY-MM-DD)
  monthlyDeposit: number; // 월 납입금 (만원)
  depositCount: number; // 납입 횟수
  totalDeposit: number; // 예치금액 (만원)

  // 가구 정보
  householdSize: number; // 가구원 수
  dependentsCount: number; // 부양가족 수 (배우자, 직계존비속)
  childrenCount: number; // 미성년 자녀 수
  childrenUnder2Count: number; // 2세 미만 자녀 수 (신생아)
  hasElderlyParent: boolean; // 만65세 이상 직계존속 3년 이상 부양
  elderlyParentDurationYears: number;

  // 소득 정보
  monthlyIncome: number; // 본인 월평균소득 (만원)
  spouseIncome: number; // 배우자 월평균소득 (만원)
  totalHouseholdIncome: number; // 세대 월평균소득 (만원)
  totalAssets: number; // 총 자산 (만원)
  carValue: number; // 자동차가액 (만원)

  // 신청 정보
  region: 'seoul' | 'gyeonggi' | 'incheon' | 'metropolitan' | 'other'; // 지역
  housingType: 'public' | 'private'; // 국민주택 / 민영주택
  exclusiveArea: number; // 전용면적 (m²)
  isSpeculationZone: boolean; // 투기과열지구
  isSubscriptionOverheatZone: boolean; // 청약과열지역
  isShrinkageZone: boolean; // 위축지역

  // 특별공급 관련
  isFirstTimeBuyer: boolean; // 생애최초 주택구입 여부
  hasPregnancy: boolean; // 임신 중 여부
}

export interface CheckResult {
  passed: boolean;
  label: string;
  detail: string;
  importance: 'critical' | 'major' | 'info';
}

export interface CategoryResult {
  category: string;
  categoryLabel: string;
  eligible: boolean;
  verdict: 'eligible' | 'ineligible' | 'conditional';
  score?: number;
  maxScore?: number;
  checks: CheckResult[];
  summary: string;
}

export interface EligibilityReport {
  timestamp: string;
  overallEligible: boolean;
  categories: CategoryResult[];
  scoreBreakdown: ScoreBreakdown | null;
  recommendations: string[];
}

export interface ScoreBreakdown {
  homelessPeriod: { years: number; score: number; max: 32 };
  dependents: { count: number; score: number; max: 35 };
  accountPeriod: { months: number; score: number; max: 17 };
  total: number;
  max: 84;
}

// ============ 2025년 도시근로자 월평균소득 기준 (만원) ============

const INCOME_CRITERIA_2025: Record<number, number> = {
  1: 3_731_457,
  2: 3_731_457,
  3: 7_533_763,
  4: 8_802_202,
  5: 8_802_202,
  6: 9_326_986,
  7: 9_326_986,
  8: 9_326_986,
};

function getIncomeLimit(householdSize: number): number {
  const size = Math.min(Math.max(householdSize, 1), 8);
  return INCOME_CRITERIA_2025[size];
}

// ============ 민영주택 지역별 예치금액 기준 (만원) ============

interface DepositRequirement {
  [area: string]: { [region: string]: number };
}

const PRIVATE_DEPOSIT_REQUIREMENTS: DepositRequirement = {
  '85이하': { seoul: 300, metropolitan: 250, other: 200 },
  '102이하': { seoul: 600, metropolitan: 400, other: 300 },
  '135이하': { seoul: 1000, metropolitan: 700, other: 400 },
  '모든면적': { seoul: 1500, metropolitan: 1000, other: 500 },
};

function getRequiredDeposit(area: number, region: string): number {
  const regionKey = region === 'seoul' ? 'seoul' :
    ['gyeonggi', 'incheon', 'metropolitan'].includes(region) ? 'metropolitan' : 'other';

  if (area <= 85) return PRIVATE_DEPOSIT_REQUIREMENTS['85이하'][regionKey];
  if (area <= 102) return PRIVATE_DEPOSIT_REQUIREMENTS['102이하'][regionKey];
  if (area <= 135) return PRIVATE_DEPOSIT_REQUIREMENTS['135이하'][regionKey];
  return PRIVATE_DEPOSIT_REQUIREMENTS['모든면적'][regionKey];
}

// ============ 가점 계산 ============

function calcHomelessScore(years: number): number {
  if (years < 1) return 2;
  if (years < 2) return 4;
  if (years < 3) return 6;
  if (years < 4) return 8;
  if (years < 5) return 10;
  if (years < 6) return 12;
  if (years < 7) return 14;
  if (years < 8) return 16;
  if (years < 9) return 18;
  if (years < 10) return 20;
  if (years < 11) return 22;
  if (years < 12) return 24;
  if (years < 13) return 26;
  if (years < 14) return 28;
  if (years < 15) return 30;
  return 32;
}

function calcDependentsScore(count: number): number {
  if (count <= 0) return 5;
  if (count === 1) return 10;
  if (count === 2) return 15;
  if (count === 3) return 20;
  if (count === 4) return 25;
  if (count === 5) return 30;
  return 35; // 6명 이상
}

function calcAccountPeriodScore(months: number): number {
  if (months < 6) return 1;
  if (months < 12) return 2;
  if (months < 24) return 3;
  if (months < 36) return 4;
  if (months < 48) return 5;
  if (months < 60) return 6;
  if (months < 72) return 7;
  if (months < 84) return 8;
  if (months < 96) return 9;
  if (months < 108) return 10;
  if (months < 120) return 11;
  if (months < 132) return 12;
  if (months < 144) return 13;
  if (months < 156) return 14;
  if (months < 168) return 15;
  if (months < 180) return 16;
  return 17; // 15년 이상
}

export function calculateScore(input: UserInput): ScoreBreakdown {
  const accountMonths = getAccountMonths(input.accountOpenDate);
  const homelessScore = input.isHomeless ? calcHomelessScore(input.homelessPeriodYears) : 0;
  const dependentsScore = calcDependentsScore(input.dependentsCount);
  const accountScore = calcAccountPeriodScore(accountMonths);

  return {
    homelessPeriod: { years: input.homelessPeriodYears, score: homelessScore, max: 32 },
    dependents: { count: input.dependentsCount, score: dependentsScore, max: 35 },
    accountPeriod: { months: accountMonths, score: accountScore, max: 17 },
    total: homelessScore + dependentsScore + accountScore,
    max: 84,
  };
}

// ============ 유틸리티 ============

function getAccountMonths(openDate: string): number {
  const open = new Date(openDate);
  const now = new Date();
  return (now.getFullYear() - open.getFullYear()) * 12 + (now.getMonth() - open.getMonth());
}

function isMetroRegion(region: string): boolean {
  return ['seoul', 'gyeonggi', 'incheon'].includes(region);
}

function toManwon(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}억`;
  return `${value.toLocaleString()}만원`;
}

// ============ 일반공급 - 민영주택 검증 ============

function checkPrivateGeneral(input: UserInput): CategoryResult {
  const checks: CheckResult[] = [];
  const accountMonths = getAccountMonths(input.accountOpenDate);
  let allPassed = true;

  // 1. 나이 확인
  const agePassed = input.age >= 19;
  checks.push({
    passed: agePassed,
    label: '만 19세 이상',
    detail: agePassed ? `만 ${input.age}세로 자격 충족` : `만 ${input.age}세로 미달 (19세 이상 필요)`,
    importance: 'critical',
  });
  if (!agePassed) allPassed = false;

  // 2. 청약통장 종류
  const validAccounts = ['comprehensive', 'deposit', 'installment'];
  const accountPassed = validAccounts.includes(input.accountType);
  const accountLabels: Record<string, string> = {
    comprehensive: '주택청약종합저축', savings: '청약저축', deposit: '청약예금', installment: '청약부금'
  };
  checks.push({
    passed: accountPassed,
    label: '청약통장 종류',
    detail: accountPassed
      ? `${accountLabels[input.accountType]} - 민영주택 청약 가능`
      : `${accountLabels[input.accountType]} - 민영주택 청약 불가 (종합저축/예금/부금 필요)`,
    importance: 'critical',
  });
  if (!accountPassed) allPassed = false;

  // 3. 가입기간 확인
  let requiredMonths = 24;
  let periodLabel = '';
  if (input.isShrinkageZone) {
    requiredMonths = 1;
    periodLabel = '위축지역: 1개월 이상';
  } else if (input.isSpeculationZone || input.isSubscriptionOverheatZone) {
    requiredMonths = 24;
    periodLabel = '투기과열/청약과열지역: 24개월 이상';
  } else if (isMetroRegion(input.region)) {
    requiredMonths = 12;
    periodLabel = '수도권: 12개월 이상';
  } else {
    requiredMonths = 6;
    periodLabel = '수도권 외: 6개월 이상';
  }
  const periodPassed = accountMonths >= requiredMonths;
  checks.push({
    passed: periodPassed,
    label: '청약통장 가입기간',
    detail: periodPassed
      ? `${accountMonths}개월 가입 (${periodLabel}) - 충족`
      : `${accountMonths}개월 가입 (${periodLabel}) - ${requiredMonths - accountMonths}개월 부족`,
    importance: 'critical',
  });
  if (!periodPassed) allPassed = false;

  // 4. 예치금액 확인
  const requiredDeposit = getRequiredDeposit(input.exclusiveArea, input.region);
  const depositPassed = input.totalDeposit >= requiredDeposit;
  checks.push({
    passed: depositPassed,
    label: '납입 인정금액',
    detail: depositPassed
      ? `${toManwon(input.totalDeposit)} 예치 (${toManwon(requiredDeposit)} 이상 필요) - 충족`
      : `${toManwon(input.totalDeposit)} 예치 (${toManwon(requiredDeposit)} 이상 필요) - ${toManwon(requiredDeposit - input.totalDeposit)} 부족`,
    importance: 'critical',
  });
  if (!depositPassed) allPassed = false;

  // 5. 투기과열지구 추가 제한
  if (input.isSpeculationZone || input.isSubscriptionOverheatZone) {
    const headPassed = input.isHouseholdHead;
    checks.push({
      passed: headPassed,
      label: '세대주 여부 (투기/과열지역)',
      detail: headPassed ? '세대주 - 충족' : '세대주 아님 - 투기/과열지역에서는 세대주만 1순위 청약 가능',
      importance: 'critical',
    });
    if (!headPassed) allPassed = false;

    const noWinPassed = !input.hasPastWinning || input.pastWinningYearsAgo >= 5;
    checks.push({
      passed: noWinPassed,
      label: '5년 이내 당첨 이력',
      detail: noWinPassed
        ? '5년 이내 세대원 당첨 이력 없음 - 충족'
        : '5년 이내 당첨 이력 있음 - 1순위 제한',
      importance: 'critical',
    });
    if (!noWinPassed) allPassed = false;

    const housePassed = input.ownedHouseCount < 2;
    checks.push({
      passed: housePassed,
      label: '2주택 이상 소유 제한',
      detail: housePassed
        ? `${input.ownedHouseCount}주택 보유 - 충족`
        : `${input.ownedHouseCount}주택 보유 - 2주택 이상 1순위 제한`,
      importance: 'critical',
    });
    if (!housePassed) allPassed = false;
  }

  // 6. 무주택 여부 (가점제 적용시 중요)
  checks.push({
    passed: input.isHomeless,
    label: '무주택 여부',
    detail: input.isHomeless
      ? `무주택 ${input.homelessPeriodYears}년 - 가점제 적용 가능`
      : '유주택 - 추첨제로만 청약 가능 (가점제 불가)',
    importance: 'major',
  });

  return {
    category: 'private_general',
    categoryLabel: '일반공급 (민영주택)',
    eligible: allPassed,
    verdict: allPassed ? 'eligible' : 'ineligible',
    checks,
    summary: allPassed
      ? '민영주택 1순위 일반공급 자격이 충족됩니다.'
      : '민영주택 1순위 일반공급 자격 조건이 미달됩니다.',
  };
}

// ============ 일반공급 - 국민주택 검증 ============

function checkPublicGeneral(input: UserInput): CategoryResult {
  const checks: CheckResult[] = [];
  const accountMonths = getAccountMonths(input.accountOpenDate);
  let allPassed = true;

  // 1. 나이 확인
  const agePassed = input.age >= 19;
  checks.push({
    passed: agePassed,
    label: '만 19세 이상',
    detail: agePassed ? `만 ${input.age}세로 자격 충족` : `만 ${input.age}세 - 19세 이상 필요`,
    importance: 'critical',
  });
  if (!agePassed) allPassed = false;

  // 2. 청약통장 종류
  const validAccounts = ['comprehensive', 'savings'];
  const accountPassed = validAccounts.includes(input.accountType);
  const accountLabels: Record<string, string> = {
    comprehensive: '주택청약종합저축', savings: '청약저축', deposit: '청약예금', installment: '청약부금'
  };
  checks.push({
    passed: accountPassed,
    label: '청약통장 종류',
    detail: accountPassed
      ? `${accountLabels[input.accountType]} - 국민주택 청약 가능`
      : `${accountLabels[input.accountType]} - 국민주택 청약 불가 (종합저축/저축 필요)`,
    importance: 'critical',
  });
  if (!accountPassed) allPassed = false;

  // 3. 무주택 세대구성원
  const homelessPassed = input.isHomeless && input.householdAllHomeless;
  checks.push({
    passed: homelessPassed,
    label: '무주택 세대구성원',
    detail: homelessPassed
      ? '본인 및 세대구성원 전원 무주택 - 충족'
      : !input.isHomeless
        ? '유주택자 - 무주택세대구성원이어야 함'
        : '세대구성원 중 주택 소유자 있음 - 전원 무주택 필요',
    importance: 'critical',
  });
  if (!homelessPassed) allPassed = false;

  // 4. 납입횟수
  let requiredDeposits = 24;
  if (input.isSpeculationZone || input.isSubscriptionOverheatZone || isMetroRegion(input.region)) {
    requiredDeposits = 24;
  } else {
    requiredDeposits = 6;
  }
  const depositCountPassed = input.depositCount >= requiredDeposits;
  checks.push({
    passed: depositCountPassed,
    label: '납입 횟수',
    detail: depositCountPassed
      ? `${input.depositCount}회 납입 (${requiredDeposits}회 이상 필요) - 충족`
      : `${input.depositCount}회 납입 (${requiredDeposits}회 이상 필요) - ${requiredDeposits - input.depositCount}회 부족`,
    importance: 'critical',
  });
  if (!depositCountPassed) allPassed = false;

  // 5. 가입기간
  let requiredMonths = 24;
  if (input.isShrinkageZone) {
    requiredMonths = 1;
  } else if (input.isSpeculationZone || input.isSubscriptionOverheatZone || isMetroRegion(input.region)) {
    requiredMonths = 24;
  } else {
    requiredMonths = 6;
  }
  const periodPassed = accountMonths >= requiredMonths;
  checks.push({
    passed: periodPassed,
    label: '청약통장 가입기간',
    detail: periodPassed
      ? `${accountMonths}개월 가입 (${requiredMonths}개월 이상 필요) - 충족`
      : `${accountMonths}개월 가입 (${requiredMonths}개월 이상 필요) - 미달`,
    importance: 'critical',
  });
  if (!periodPassed) allPassed = false;

  return {
    category: 'public_general',
    categoryLabel: '일반공급 (국민주택)',
    eligible: allPassed,
    verdict: allPassed ? 'eligible' : 'ineligible',
    checks,
    summary: allPassed
      ? '국민주택 1순위 일반공급 자격이 충족됩니다.'
      : '국민주택 1순위 일반공급 자격 조건이 미달됩니다.',
  };
}

// ============ 특별공급 - 신혼부부 ============

function checkNewlywed(input: UserInput): CategoryResult {
  const checks: CheckResult[] = [];
  let allPassed = true;

  // 1. 혼인 상태
  const marriedPassed = input.maritalStatus === 'married' && input.marriageDurationMonths <= 84;
  checks.push({
    passed: marriedPassed,
    label: '혼인 기간',
    detail: marriedPassed
      ? `혼인 ${Math.floor(input.marriageDurationMonths / 12)}년 ${input.marriageDurationMonths % 12}개월 (7년 이내) - 충족`
      : input.maritalStatus !== 'married'
        ? '미혼 상태 - 혼인 중이어야 함'
        : `혼인 ${Math.floor(input.marriageDurationMonths / 12)}년 - 7년 초과`,
    importance: 'critical',
  });
  if (!marriedPassed) allPassed = false;

  // 2. 무주택
  const homelessPassed = input.isHomeless && input.householdAllHomeless;
  checks.push({
    passed: homelessPassed,
    label: '무주택 세대구성원',
    detail: homelessPassed ? '세대구성원 전원 무주택 - 충족' : '무주택 조건 미충족',
    importance: 'critical',
  });
  if (!homelessPassed) allPassed = false;

  // 3. 청약통장 가입 6개월 이상
  const accountMonths = getAccountMonths(input.accountOpenDate);
  const accountPassed = accountMonths >= 6;
  checks.push({
    passed: accountPassed,
    label: '청약통장 가입기간',
    detail: accountPassed
      ? `${accountMonths}개월 (6개월 이상) - 충족`
      : `${accountMonths}개월 - 6개월 이상 필요`,
    importance: 'critical',
  });
  if (!accountPassed) allPassed = false;

  // 4. 소득 기준 (도시근로자 월평균소득 기준)
  const incomeLimit = getIncomeLimit(input.householdSize);
  const incomeLimitManwon = Math.round(incomeLimit / 10000);

  // 맞벌이 기준: 부부 모두 소득이 있는 경우 140% 적용
  const isDualIncome = input.monthlyIncome > 0 && input.spouseIncome > 0;
  const incomeMultiplier = isDualIncome ? 1.4 : 1.3;
  const adjustedLimit = Math.round(incomeLimitManwon * incomeMultiplier);
  const incomePassed = input.totalHouseholdIncome <= adjustedLimit;

  checks.push({
    passed: incomePassed,
    label: '소득 기준',
    detail: incomePassed
      ? `월 ${input.totalHouseholdIncome.toLocaleString()}만원 (기준 ${adjustedLimit.toLocaleString()}만원${isDualIncome ? ', 맞벌이 140%' : ' 130%'}) - 충족`
      : `월 ${input.totalHouseholdIncome.toLocaleString()}만원 (기준 ${adjustedLimit.toLocaleString()}만원 초과) - 미달`,
    importance: 'critical',
  });
  if (!incomePassed) allPassed = false;

  // 5. 자녀 유무 (가점 요소)
  checks.push({
    passed: input.childrenCount > 0,
    label: '미성년 자녀',
    detail: input.childrenCount > 0
      ? `${input.childrenCount}명 - 우선공급 대상 가능`
      : '미성년 자녀 없음 - 일반공급으로 배정',
    importance: 'info',
  });

  return {
    category: 'special_newlywed',
    categoryLabel: '특별공급 (신혼부부)',
    eligible: allPassed,
    verdict: allPassed ? 'eligible' : 'ineligible',
    checks,
    summary: allPassed
      ? '신혼부부 특별공급 자격이 충족됩니다.'
      : '신혼부부 특별공급 자격 조건이 미달됩니다.',
  };
}

// ============ 특별공급 - 생애최초 ============

function checkFirstTimeBuyer(input: UserInput): CategoryResult {
  const checks: CheckResult[] = [];
  let allPassed = true;

  // 1. 생애최초 주택구입
  checks.push({
    passed: input.isFirstTimeBuyer,
    label: '생애최초 주택구입',
    detail: input.isFirstTimeBuyer
      ? '과거 주택 소유 이력 없음 - 충족'
      : '과거 주택 소유 이력 있음 - 생애최초 불가',
    importance: 'critical',
  });
  if (!input.isFirstTimeBuyer) allPassed = false;

  // 2. 무주택 세대구성원
  const homelessPassed = input.isHomeless && input.householdAllHomeless;
  checks.push({
    passed: homelessPassed,
    label: '무주택 세대구성원',
    detail: homelessPassed ? '세대구성원 전원 무주택 - 충족' : '무주택 조건 미충족',
    importance: 'critical',
  });
  if (!homelessPassed) allPassed = false;

  // 3. 소득활동 (근로자/자영업자)
  const hasIncome = input.monthlyIncome > 0;
  checks.push({
    passed: hasIncome,
    label: '소득활동 여부',
    detail: hasIncome ? '소득활동 중 - 충족' : '소득 없음 - 근로자/자영업자여야 함',
    importance: 'critical',
  });
  if (!hasIncome) allPassed = false;

  // 4. 소득 기준 (130%, 맞벌이 140%)
  const incomeLimit = getIncomeLimit(input.householdSize);
  const incomeLimitManwon = Math.round(incomeLimit / 10000);
  const isDualIncome = input.monthlyIncome > 0 && input.spouseIncome > 0;
  const incomeMultiplier = isDualIncome ? 1.6 : 1.3;
  const adjustedLimit = Math.round(incomeLimitManwon * incomeMultiplier);
  const incomePassed = input.totalHouseholdIncome <= adjustedLimit;

  checks.push({
    passed: incomePassed,
    label: '소득 기준',
    detail: incomePassed
      ? `월 ${input.totalHouseholdIncome.toLocaleString()}만원 (기준 ${adjustedLimit.toLocaleString()}만원${isDualIncome ? ', 맞벌이 160%' : ' 130%'}) - 충족`
      : `월 ${input.totalHouseholdIncome.toLocaleString()}만원 (기준 초과) - 미달`,
    importance: 'critical',
  });
  if (!incomePassed) allPassed = false;

  // 5. 청약통장 가입기간
  const accountMonths = getAccountMonths(input.accountOpenDate);
  const requiredMonths = isMetroRegion(input.region) ? 24 : 6;
  const accountPassed = accountMonths >= requiredMonths;
  checks.push({
    passed: accountPassed,
    label: '청약통장 가입기간',
    detail: accountPassed
      ? `${accountMonths}개월 (${requiredMonths}개월 이상) - 충족`
      : `${accountMonths}개월 - ${requiredMonths}개월 필요`,
    importance: 'critical',
  });
  if (!accountPassed) allPassed = false;

  return {
    category: 'special_first_time',
    categoryLabel: '특별공급 (생애최초)',
    eligible: allPassed,
    verdict: allPassed ? 'eligible' : 'ineligible',
    checks,
    summary: allPassed
      ? '생애최초 특별공급 자격이 충족됩니다.'
      : '생애최초 특별공급 자격 조건이 미달됩니다.',
  };
}

// ============ 특별공급 - 다자녀가구 ============

function checkMultiChild(input: UserInput): CategoryResult {
  const checks: CheckResult[] = [];
  let allPassed = true;

  // 1. 미성년 자녀 3명 이상
  // 또는 2명 이상 (민영주택)
  const minChildren = input.housingType === 'public' ? 3 : 2;
  const childPassed = input.childrenCount >= minChildren;
  checks.push({
    passed: childPassed,
    label: `미성년 자녀 ${minChildren}명 이상`,
    detail: childPassed
      ? `미성년 자녀 ${input.childrenCount}명 - 충족`
      : `미성년 자녀 ${input.childrenCount}명 - ${minChildren}명 이상 필요`,
    importance: 'critical',
  });
  if (!childPassed) allPassed = false;

  // 2. 무주택 세대구성원
  const homelessPassed = input.isHomeless && input.householdAllHomeless;
  checks.push({
    passed: homelessPassed,
    label: '무주택 세대구성원',
    detail: homelessPassed ? '세대구성원 전원 무주택 - 충족' : '무주택 조건 미충족',
    importance: 'critical',
  });
  if (!homelessPassed) allPassed = false;

  // 3. 청약통장 가입기간 6개월 이상
  const accountMonths = getAccountMonths(input.accountOpenDate);
  const accountPassed = accountMonths >= 6;
  checks.push({
    passed: accountPassed,
    label: '청약통장 가입기간',
    detail: accountPassed
      ? `${accountMonths}개월 (6개월 이상) - 충족`
      : `${accountMonths}개월 - 6개월 이상 필요`,
    importance: 'critical',
  });
  if (!accountPassed) allPassed = false;

  // 4. 소득기준 (공공주택의 경우)
  if (input.housingType === 'public') {
    const incomeLimit = getIncomeLimit(input.householdSize);
    const incomeLimitManwon = Math.round(incomeLimit / 10000);
    const adjustedLimit = Math.round(incomeLimitManwon * 1.2);
    const incomePassed = input.totalHouseholdIncome <= adjustedLimit;
    checks.push({
      passed: incomePassed,
      label: '소득 기준 (공공주택)',
      detail: incomePassed
        ? `월 ${input.totalHouseholdIncome.toLocaleString()}만원 (기준 ${adjustedLimit.toLocaleString()}만원, 120%) - 충족`
        : `월 ${input.totalHouseholdIncome.toLocaleString()}만원 (기준 초과) - 미달`,
      importance: 'critical',
    });
    if (!incomePassed) allPassed = false;
  }

  return {
    category: 'special_multi_child',
    categoryLabel: '특별공급 (다자녀가구)',
    eligible: allPassed,
    verdict: allPassed ? 'eligible' : 'ineligible',
    checks,
    summary: allPassed
      ? '다자녀가구 특별공급 자격이 충족됩니다.'
      : '다자녀가구 특별공급 자격 조건이 미달됩니다.',
  };
}

// ============ 특별공급 - 노부모부양 ============

function checkElderlyParent(input: UserInput): CategoryResult {
  const checks: CheckResult[] = [];
  let allPassed = true;

  // 1. 만 65세 이상 직계존속 3년 이상 부양
  const elderlyPassed = input.hasElderlyParent && input.elderlyParentDurationYears >= 3;
  checks.push({
    passed: elderlyPassed,
    label: '만 65세 이상 직계존속 3년 이상 부양',
    detail: elderlyPassed
      ? `직계존속 ${input.elderlyParentDurationYears}년 부양 - 충족`
      : !input.hasElderlyParent
        ? '만 65세 이상 직계존속 부양 해당 없음'
        : `부양 기간 ${input.elderlyParentDurationYears}년 - 3년 이상 필요`,
    importance: 'critical',
  });
  if (!elderlyPassed) allPassed = false;

  // 2. 세대주
  checks.push({
    passed: input.isHouseholdHead,
    label: '세대주 여부',
    detail: input.isHouseholdHead ? '세대주 - 충족' : '세대주 아님 - 세대주여야 함',
    importance: 'critical',
  });
  if (!input.isHouseholdHead) allPassed = false;

  // 3. 무주택 세대구성원
  const homelessPassed = input.isHomeless && input.householdAllHomeless;
  checks.push({
    passed: homelessPassed,
    label: '무주택 세대구성원',
    detail: homelessPassed ? '세대구성원 전원 무주택 - 충족' : '무주택 조건 미충족',
    importance: 'critical',
  });
  if (!homelessPassed) allPassed = false;

  // 4. 청약통장 가입기간 24개월
  const accountMonths = getAccountMonths(input.accountOpenDate);
  const requiredMonths = isMetroRegion(input.region) ? 24 : 6;
  const accountPassed = accountMonths >= requiredMonths;
  checks.push({
    passed: accountPassed,
    label: '청약통장 가입기간',
    detail: accountPassed
      ? `${accountMonths}개월 (${requiredMonths}개월 이상) - 충족`
      : `${accountMonths}개월 - ${requiredMonths}개월 필요`,
    importance: 'critical',
  });
  if (!accountPassed) allPassed = false;

  // 5. 소득기준 (공공주택의 경우)
  if (input.housingType === 'public') {
    const incomeLimit = getIncomeLimit(input.householdSize);
    const incomeLimitManwon = Math.round(incomeLimit / 10000);
    const adjustedLimit = Math.round(incomeLimitManwon * 1.2);
    const incomePassed = input.totalHouseholdIncome <= adjustedLimit;
    checks.push({
      passed: incomePassed,
      label: '소득 기준',
      detail: incomePassed
        ? `월 ${input.totalHouseholdIncome.toLocaleString()}만원 (기준 ${adjustedLimit.toLocaleString()}만원) - 충족`
        : `월 ${input.totalHouseholdIncome.toLocaleString()}만원 - 기준 초과`,
      importance: 'critical',
    });
    if (!incomePassed) allPassed = false;
  }

  return {
    category: 'special_elderly_parent',
    categoryLabel: '특별공급 (노부모부양)',
    eligible: allPassed,
    verdict: allPassed ? 'eligible' : 'ineligible',
    checks,
    summary: allPassed
      ? '노부모부양 특별공급 자격이 충족됩니다.'
      : '노부모부양 특별공급 자격 조건이 미달됩니다.',
  };
}

// ============ 특별공급 - 청년 ============

function checkYouth(input: UserInput): CategoryResult {
  const checks: CheckResult[] = [];
  let allPassed = true;

  // 1. 나이: 만 19세 이상 39세 이하
  const agePassed = input.age >= 19 && input.age <= 39;
  checks.push({
    passed: agePassed,
    label: '나이 (만 19~39세)',
    detail: agePassed
      ? `만 ${input.age}세 - 충족`
      : `만 ${input.age}세 - 19세 이상 39세 이하 필요`,
    importance: 'critical',
  });
  if (!agePassed) allPassed = false;

  // 2. 미혼
  const singlePassed = input.maritalStatus === 'single';
  checks.push({
    passed: singlePassed,
    label: '미혼 여부',
    detail: singlePassed ? '미혼 - 충족' : '기혼/이혼/사별 - 미혼이어야 함',
    importance: 'critical',
  });
  if (!singlePassed) allPassed = false;

  // 3. 무주택 (과거에도 주택 소유 이력 없어야 함)
  checks.push({
    passed: input.isHomeless && input.isFirstTimeBuyer,
    label: '무주택 (과거 포함)',
    detail: input.isHomeless && input.isFirstTimeBuyer
      ? '현재 및 과거 무주택 - 충족'
      : '주택 소유 이력 있음',
    importance: 'critical',
  });
  if (!(input.isHomeless && input.isFirstTimeBuyer)) allPassed = false;

  // 4. 소득 기준 (도시근로자 월평균소득 140% 이하)
  const incomeLimit = getIncomeLimit(1); // 1인가구 기준
  const incomeLimitManwon = Math.round(incomeLimit / 10000);
  const adjustedLimit = Math.round(incomeLimitManwon * 1.4);
  const incomePassed = input.monthlyIncome <= adjustedLimit;
  checks.push({
    passed: incomePassed,
    label: '소득 기준 (140%)',
    detail: incomePassed
      ? `월 ${input.monthlyIncome.toLocaleString()}만원 (기준 ${adjustedLimit.toLocaleString()}만원) - 충족`
      : `월 ${input.monthlyIncome.toLocaleString()}만원 - 기준 초과`,
    importance: 'critical',
  });
  if (!incomePassed) allPassed = false;

  // 5. 청약통장 가입기간
  const accountMonths = getAccountMonths(input.accountOpenDate);
  const accountPassed = accountMonths >= 6;
  checks.push({
    passed: accountPassed,
    label: '청약통장 가입기간',
    detail: accountPassed
      ? `${accountMonths}개월 (6개월 이상) - 충족`
      : `${accountMonths}개월 - 6개월 이상 필요`,
    importance: 'critical',
  });
  if (!accountPassed) allPassed = false;

  // 6. 전용면적 60m² 이하
  const areaPassed = input.exclusiveArea <= 60;
  checks.push({
    passed: areaPassed,
    label: '전용면적 60m² 이하',
    detail: areaPassed
      ? `${input.exclusiveArea}m² - 충족`
      : `${input.exclusiveArea}m² - 60m² 이하만 가능`,
    importance: 'critical',
  });
  if (!areaPassed) allPassed = false;

  return {
    category: 'special_youth',
    categoryLabel: '특별공급 (청년)',
    eligible: allPassed,
    verdict: allPassed ? 'eligible' : 'ineligible',
    checks,
    summary: allPassed
      ? '청년 특별공급 자격이 충족됩니다.'
      : '청년 특별공급 자격 조건이 미달됩니다.',
  };
}

// ============ 특별공급 - 신생아 ============

function checkNewborn(input: UserInput): CategoryResult {
  const checks: CheckResult[] = [];
  let allPassed = true;

  // 1. 2세 미만 자녀
  const childPassed = input.childrenUnder2Count > 0 || input.hasPregnancy;
  checks.push({
    passed: childPassed,
    label: '2세 미만 자녀 (또는 임신 중)',
    detail: childPassed
      ? input.childrenUnder2Count > 0
        ? `2세 미만 자녀 ${input.childrenUnder2Count}명 - 충족`
        : '임신 중 - 충족'
      : '2세 미만 자녀 없음, 임신 중 아님',
    importance: 'critical',
  });
  if (!childPassed) allPassed = false;

  // 2. 무주택 세대구성원
  const homelessPassed = input.isHomeless && input.householdAllHomeless;
  checks.push({
    passed: homelessPassed,
    label: '무주택 세대구성원',
    detail: homelessPassed ? '세대구성원 전원 무주택 - 충족' : '무주택 조건 미충족',
    importance: 'critical',
  });
  if (!homelessPassed) allPassed = false;

  // 3. 소득 기준 (맞벌이 200%, 외벌이 150%)
  const incomeLimit = getIncomeLimit(input.householdSize);
  const incomeLimitManwon = Math.round(incomeLimit / 10000);
  const isDualIncome = input.monthlyIncome > 0 && input.spouseIncome > 0;
  const incomeMultiplier = isDualIncome ? 2.0 : 1.5;
  const adjustedLimit = Math.round(incomeLimitManwon * incomeMultiplier);
  const incomePassed = input.totalHouseholdIncome <= adjustedLimit;

  checks.push({
    passed: incomePassed,
    label: '소득 기준',
    detail: incomePassed
      ? `월 ${input.totalHouseholdIncome.toLocaleString()}만원 (기준 ${adjustedLimit.toLocaleString()}만원${isDualIncome ? ', 맞벌이 200%' : ' 150%'}) - 충족`
      : `월 ${input.totalHouseholdIncome.toLocaleString()}만원 - 기준 초과`,
    importance: 'critical',
  });
  if (!incomePassed) allPassed = false;

  // 4. 청약통장 가입 6개월 이상
  const accountMonths = getAccountMonths(input.accountOpenDate);
  const accountPassed = accountMonths >= 6;
  checks.push({
    passed: accountPassed,
    label: '청약통장 가입기간',
    detail: accountPassed
      ? `${accountMonths}개월 (6개월 이상) - 충족`
      : `${accountMonths}개월 - 6개월 이상 필요`,
    importance: 'critical',
  });
  if (!accountPassed) allPassed = false;

  return {
    category: 'special_newborn',
    categoryLabel: '특별공급 (신생아)',
    eligible: allPassed,
    verdict: allPassed ? 'eligible' : 'ineligible',
    checks,
    summary: allPassed
      ? '신생아 특별공급 자격이 충족됩니다.'
      : '신생아 특별공급 자격 조건이 미달됩니다.',
  };
}

// ============ 메인 검증 함수 ============

export function runEligibilityCheck(input: UserInput): EligibilityReport {
  const categories: CategoryResult[] = [];

  // 일반공급 검증
  if (input.housingType === 'private') {
    categories.push(checkPrivateGeneral(input));
  } else {
    categories.push(checkPublicGeneral(input));
  }

  // 특별공급 검증 - 해당되는 것만
  if (input.maritalStatus === 'married' && input.marriageDurationMonths <= 84) {
    categories.push(checkNewlywed(input));
  }

  if (input.isFirstTimeBuyer) {
    categories.push(checkFirstTimeBuyer(input));
  }

  if (input.childrenCount >= 2) {
    categories.push(checkMultiChild(input));
  }

  if (input.hasElderlyParent) {
    categories.push(checkElderlyParent(input));
  }

  if (input.age >= 19 && input.age <= 39 && input.maritalStatus === 'single') {
    categories.push(checkYouth(input));
  }

  if (input.childrenUnder2Count > 0 || input.hasPregnancy) {
    categories.push(checkNewborn(input));
  }

  // 가점 계산 (민영주택 가점제용)
  const scoreBreakdown = input.housingType === 'private' ? calculateScore(input) : null;

  // 추천 사항 생성
  const recommendations: string[] = [];
  const eligibleCategories = categories.filter(c => c.eligible);
  const ineligibleCategories = categories.filter(c => !c.eligible);

  if (eligibleCategories.length > 0) {
    recommendations.push(`${eligibleCategories.map(c => c.categoryLabel).join(', ')}에 지원 가능합니다.`);
  }

  if (scoreBreakdown && input.housingType === 'private') {
    recommendations.push(`가점제 점수: ${scoreBreakdown.total}점 / ${scoreBreakdown.max}점`);
    if (scoreBreakdown.total < 40) {
      recommendations.push('가점이 40점 미만으로 추첨제 지원이 유리할 수 있습니다.');
    }
  }

  if (ineligibleCategories.length > 0) {
    for (const cat of ineligibleCategories) {
      const failedChecks = cat.checks.filter(c => !c.passed && c.importance === 'critical');
      if (failedChecks.length > 0) {
        recommendations.push(`${cat.categoryLabel}: ${failedChecks[0].label} 조건을 확인해주세요.`);
      }
    }
  }

  const accountMonths = getAccountMonths(input.accountOpenDate);
  if (accountMonths < 24) {
    recommendations.push(`청약통장 가입기간이 ${accountMonths}개월입니다. 24개월 이상 유지를 권장합니다.`);
  }

  return {
    timestamp: new Date().toISOString(),
    overallEligible: eligibleCategories.length > 0,
    categories,
    scoreBreakdown,
    recommendations,
  };
}

// ============ 기본값 ============

export function getDefaultInput(): UserInput {
  return {
    age: 30,
    isHouseholdHead: true,
    maritalStatus: 'single',
    marriageDurationMonths: 0,
    spouseAge: null,
    isHomeless: true,
    homelessPeriodYears: 3,
    householdAllHomeless: true,
    ownedHouseCount: 0,
    hasPastWinning: false,
    pastWinningYearsAgo: 0,
    accountType: 'comprehensive',
    accountOpenDate: '2022-01-01',
    monthlyDeposit: 10,
    depositCount: 36,
    totalDeposit: 360,
    householdSize: 1,
    dependentsCount: 0,
    childrenCount: 0,
    childrenUnder2Count: 0,
    hasElderlyParent: false,
    elderlyParentDurationYears: 0,
    monthlyIncome: 300,
    spouseIncome: 0,
    totalHouseholdIncome: 300,
    totalAssets: 20000,
    carValue: 0,
    region: 'seoul',
    housingType: 'private',
    exclusiveArea: 84,
    isSpeculationZone: false,
    isSubscriptionOverheatZone: false,
    isShrinkageZone: false,
    isFirstTimeBuyer: true,
    hasPregnancy: false,
  };
}
