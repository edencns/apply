// 서류 교차 검증 엔진
// 입주예정자 정보(청약홈) + 분양 공고 조건 + 제출 서류 → 교차 비교

// ============ 타입 정의 ============

/** 청약홈에서 가져온 입주예정자 정보 */
export interface ApplicantInfo {
  name: string;
  residentNumber: string; // 주민등록번호 (앞자리만 또는 마스킹)
  birthDate: string;
  isHouseholdHead: boolean;
  address: string;
  householdMembers: HouseholdMember[];
  // 청약 신청 정보
  isHomeless: boolean;
  homelessPeriodYears: number;
  dependentsCount: number;
  subscriptionAccountType: string;
  subscriptionOpenDate: string;
  subscriptionMonths: number;
  depositCount: number;
  totalDeposit: number; // 만원
  // 소득 정보
  monthlyIncome: number; // 만원
  spouseIncome: number;
  totalHouseholdIncome: number;
  // 신혼부부/특별공급 관련
  maritalStatus: string;
  marriageDate: string;
  childrenCount: number;
  isFirstTimeBuyer: boolean;
  // 가점 신청 정보
  claimedScore: number;
  claimedHomelessScore: number;
  claimedDependentsScore: number;
  claimedAccountScore: number;
}

export interface HouseholdMember {
  name: string;
  relation: string; // 본인, 배우자, 자녀, 부, 모 등
  birthDate: string;
  residentNumber: string;
}

/** 순위/지역/면적별 세부 공급 조건 */
export interface SupplyCondition {
  rank: 1 | 2 | 0;                        // 1순위 / 2순위 / 특별공급(0)
  regionType?: 'local' | 'other' | 'all'; // 해당지역 / 기타지역 / 전체
  areaType?: 'under85' | 'over85' | 'all'; // 85㎡ 이하 / 초과 / 전체
  label: string;                          // 표시용 (예: "1순위 해당지역")
  minSubscriptionMonths: number;
  minDepositCount: number;
  requiredDeposit?: number;  // 만원 (단일값, 레거시)
  depositByArea?: Record<string, number>; // 면적상한(m²,str) → 예치금(만원)
  incomeLimit?: number;
  incomeLimitPercent?: string;
  requireHomeless: boolean;
  requireHouseholdHead: boolean;
  requireAllMembersHomeless?: boolean;
  maxMarriageYears?: number;
  minChildren?: number;
  requireFirstTimeBuyer?: boolean;
  maxAge?: number;
  minAge?: number;
  notes?: string;
  /** 툴팁·상세설명에 쓰일 한글 완전문장 */
  description?: string;
  /** 요약 bullet 3~6개 */
  descriptionBullets?: string[];
}

/** 분양 공고 조건 */
export interface AnnouncementRequirements {
  complexName: string;
  supplyType: string; // 일반공급, 신혼부부, 생애최초, 다자녀, 노부모부양, 청년, 신생아
  housingType: string; // 민영주택, 국민주택
  region: string;
  exclusiveArea: number; // m²
  // 자격 조건 (기본값 / 공고문 미파싱 시 사용)
  minAge: number;
  requireHouseholdHead: boolean;
  requireHomeless: boolean;
  requireAllMembersHomeless: boolean;
  minSubscriptionMonths: number;
  minDepositCount: number;
  requiredDeposit: number; // 만원
  // 소득 기준
  incomeLimit: number; // 만원 (0이면 기준 없음)
  incomeLimitPercent: string; // 예: "130%", "140%"
  // 특별공급 조건
  maxMarriageYears: number; // 신혼부부: 7년
  minChildren: number; // 다자녀: 3명
  requireFirstTimeBuyer: boolean;
  maxAge: number; // 청년: 39세
  // 순위/지역/면적별 세부 조건
  conditions: SupplyCondition[];
  conditionsFetched: boolean; // 공고문에서 자격조건 파싱 성공 여부
  // PDF 파싱으로 추출된 추가 정보
  incomeTable?: Record<string, Record<string, number>>; // 가구원수 → 비율 → 금액(원)
  requiredDocuments?: RequiredDocumentChecklist;
  supplyTypes?: ParsedSupplyType[]; // 공급유형별 상세
  /** 공급대상 전용면적 목록 (m²) — PDF에서 추출, 드롭다운 옵션으로 사용 */
  exclusiveAreas?: number[];
  localRegion?: string;    // 해당지역 (예: "천안시")
  otherRegions?: string;   // 기타지역 설명
  announcementDate?: string; // 공고일
  isRegulated?: boolean;   // 규제지역 여부
  resaleRestriction?: string; // 전매제한
  rewinRestriction?: string;  // 재당첨제한
}

/** PDF 파싱된 공급유형별 상세 */
export interface ParsedSupplyType {
  type: string; // "일반공급" | "다자녀가구" | "신혼부부" | "생애최초" | "노부모부양" | "기관추천" | ...
  conditions: SupplyCondition[];
  incomeTable?: Record<string, Record<string, number>>;
  assetLimit?: number;
  carValueLimit?: number;
}

/** 필요서류 체크리스트 */
export interface RequiredDocumentChecklist {
  common: DocumentItem[];
  perSupplyType: Record<string, {
    required: DocumentItem[];
    conditional: ConditionalDocumentItem[];
  }>;
}

export interface DocumentItem {
  name: string;
  description: string;
  issuer?: string;
}

export interface ConditionalDocumentItem extends DocumentItem {
  condition: string;
}

/** 서류에서 확인된 실제 내용 */
export interface DocumentVerifiedData {
  // 주민등록등본
  등본_세대주: string;
  등본_세대주여부: boolean;
  등본_주소: string;
  등본_세대원수: number;
  등본_세대원목록: DocHouseholdMember[];

  // 주민등록초본
  초본_전입일: string;
  초본_거주기간개월: number;
  초본_주소이력: string[];

  // 가족관계증명서
  가족_구성원수: number;
  가족_배우자: string;
  가족_자녀수: number;
  가족_직계존속수: number;

  // 혼인관계증명서
  혼인_혼인일: string;
  혼인_상태: string; // 혼인중, 미혼, 이혼 등

  // 청약통장확인서
  통장_종류: string;
  통장_가입일: string;
  통장_납입횟수: number;
  통장_예치금: number; // 만원

  // 소득증빙
  소득_월평균: number; // 만원
  소득_연간: number;

  // 건강보험료납부확인서
  건보_월납부액: number;

  // 등기사항전부증명서
  등기_주택소유여부: boolean;
  등기_소유주택수: number;

  // 서류 제출 상태
  제출서류목록: string[];
}

export interface DocHouseholdMember {
  name: string;
  relation: string;
  birthDate: string;
}

// ============ 검증 결과 ============

export interface VerificationItem {
  id: string;
  category: '인적사항' | '무주택' | '청약통장' | '소득' | '가구구성' | '특별공급' | '가점' | '서류완비';
  label: string;
  applicantValue: string;  // 청약홈 신청 값
  documentValue: string;   // 서류 확인 값
  announcementRule: string; // 공고 기준
  status: 'match' | 'mismatch' | 'fail' | 'warning' | 'not_verified';
  detail: string;
  severity: 'critical' | 'major' | 'minor' | 'info';
}

export interface VerificationReport {
  timestamp: string;
  verdict: 'pass' | 'fail' | 'review';
  verdictLabel: string;
  totalItems: number;
  matchCount: number;
  mismatchCount: number;
  failCount: number;
  warningCount: number;
  items: VerificationItem[];
  summary: string[];
}

// ============ 교차 검증 함수 ============

export function runVerification(
  applicant: ApplicantInfo,
  announcement: AnnouncementRequirements,
  documents: DocumentVerifiedData,
): VerificationReport {
  const items: VerificationItem[] = [];

  // ─── 1. 인적사항 교차 검증 ───
  // 세대주 여부
  items.push({
    id: 'household_head',
    category: '인적사항',
    label: '세대주 여부',
    applicantValue: applicant.isHouseholdHead ? '세대주' : '세대원',
    documentValue: documents.등본_세대주여부 ? `세대주 (${documents.등본_세대주})` : '세대원',
    announcementRule: announcement.requireHouseholdHead ? '세대주 필수' : '제한 없음',
    status: applicant.isHouseholdHead === documents.등본_세대주여부
      ? (announcement.requireHouseholdHead && !documents.등본_세대주여부 ? 'fail' : 'match')
      : 'mismatch',
    detail: applicant.isHouseholdHead === documents.등본_세대주여부
      ? (announcement.requireHouseholdHead && !documents.등본_세대주여부
        ? '공고 조건: 세대주 필수이나 세대주 아님'
        : '신청 정보와 서류 일치')
      : `신청: ${applicant.isHouseholdHead ? '세대주' : '세대원'} / 서류: ${documents.등본_세대주여부 ? '세대주' : '세대원'} - 불일치`,
    severity: 'critical',
  });

  // 주소 일치
  if (applicant.address && documents.등본_주소) {
    const addressMatch = documents.등본_주소.includes(applicant.address) || applicant.address.includes(documents.등본_주소);
    items.push({
      id: 'address',
      category: '인적사항',
      label: '주소 일치 여부',
      applicantValue: applicant.address,
      documentValue: documents.등본_주소,
      announcementRule: '-',
      status: addressMatch ? 'match' : 'mismatch',
      detail: addressMatch ? '주소 일치' : '주소 불일치 - 확인 필요',
      severity: 'major',
    });
  }

  // 세대원 수
  items.push({
    id: 'household_count',
    category: '가구구성',
    label: '세대원 수',
    applicantValue: `${applicant.householdMembers.length}명`,
    documentValue: `${documents.등본_세대원수}명 (등본)`,
    announcementRule: '-',
    status: applicant.householdMembers.length === documents.등본_세대원수 ? 'match' : 'mismatch',
    detail: applicant.householdMembers.length === documents.등본_세대원수
      ? '세대원 수 일치'
      : `신청: ${applicant.householdMembers.length}명 / 등본: ${documents.등본_세대원수}명 - 불일치`,
    severity: 'major',
  });

  // ─── 2. 무주택 검증 ───
  if (announcement.requireHomeless) {
    // 무주택 여부: 신청 vs 등기부등본
    items.push({
      id: 'homeless_status',
      category: '무주택',
      label: '무주택 여부',
      applicantValue: applicant.isHomeless ? '무주택' : '유주택',
      documentValue: documents.등기_주택소유여부 ? `유주택 (${documents.등기_소유주택수}채)` : '무주택',
      announcementRule: '무주택 필수',
      status: (() => {
        if (applicant.isHomeless && !documents.등기_주택소유여부) return 'match';
        if (applicant.isHomeless && documents.등기_주택소유여부) return 'mismatch';
        if (!applicant.isHomeless) return 'fail';
        return 'match';
      })(),
      detail: (() => {
        if (applicant.isHomeless && !documents.등기_주택소유여부) return '무주택 확인 - 신청 정보와 서류 일치';
        if (applicant.isHomeless && documents.등기_주택소유여부)
          return '신청서에는 무주택으로 기재했으나, 등기부등본상 주택 소유 확인 - 부적격 사유';
        if (!applicant.isHomeless) return '유주택자 - 무주택 조건 미충족';
        return '';
      })(),
      severity: 'critical',
    });

    // 무주택 기간
    if (applicant.homelessPeriodYears > 0) {
      items.push({
        id: 'homeless_period',
        category: '무주택',
        label: '무주택 기간',
        applicantValue: `${applicant.homelessPeriodYears}년`,
        documentValue: documents.등기_주택소유여부 ? '주택 소유 이력 있음' : `${applicant.homelessPeriodYears}년 (초본 기준)`,
        announcementRule: '-',
        status: documents.등기_주택소유여부 ? 'mismatch' : 'match',
        detail: documents.등기_주택소유여부
          ? '등기부등본상 주택 소유 이력 확인 - 무주택 기간 산정 불가'
          : '무주택 기간 확인',
        severity: 'major',
      });
    }
  }

  // ─── 3. 청약통장 검증 ───
  // 통장 종류
  items.push({
    id: 'account_type',
    category: '청약통장',
    label: '청약통장 종류',
    applicantValue: applicant.subscriptionAccountType,
    documentValue: documents.통장_종류,
    announcementRule: announcement.housingType === '민영주택' ? '종합저축/예금/부금' : '종합저축/저축',
    status: applicant.subscriptionAccountType === documents.통장_종류 ? 'match' : 'mismatch',
    detail: applicant.subscriptionAccountType === documents.통장_종류
      ? '통장 종류 일치'
      : `신청: ${applicant.subscriptionAccountType} / 서류: ${documents.통장_종류} - 불일치`,
    severity: 'critical',
  });

  // 가입기간
  const accountMonthsMatch = Math.abs(applicant.subscriptionMonths - getMonthsDiff(documents.통장_가입일)) <= 1;
  items.push({
    id: 'account_period',
    category: '청약통장',
    label: '가입기간',
    applicantValue: `${applicant.subscriptionMonths}개월`,
    documentValue: `${getMonthsDiff(documents.통장_가입일)}개월 (가입일: ${documents.통장_가입일})`,
    announcementRule: `${announcement.minSubscriptionMonths}개월 이상`,
    status: (() => {
      const docMonths = getMonthsDiff(documents.통장_가입일);
      if (!accountMonthsMatch) return 'mismatch';
      if (docMonths < announcement.minSubscriptionMonths) return 'fail';
      return 'match';
    })(),
    detail: (() => {
      const docMonths = getMonthsDiff(documents.통장_가입일);
      if (!accountMonthsMatch)
        return `신청: ${applicant.subscriptionMonths}개월 / 서류: ${docMonths}개월 - 기간 불일치`;
      if (docMonths < announcement.minSubscriptionMonths)
        return `가입기간 ${docMonths}개월로 공고 기준 ${announcement.minSubscriptionMonths}개월 미달`;
      return `가입기간 충족 (${docMonths}개월 >= ${announcement.minSubscriptionMonths}개월)`;
    })(),
    severity: 'critical',
  });

  // 납입횟수
  items.push({
    id: 'deposit_count',
    category: '청약통장',
    label: '납입 횟수',
    applicantValue: `${applicant.depositCount}회`,
    documentValue: `${documents.통장_납입횟수}회`,
    announcementRule: announcement.minDepositCount > 0 ? `${announcement.minDepositCount}회 이상` : '-',
    status: (() => {
      if (applicant.depositCount !== documents.통장_납입횟수) return 'mismatch';
      if (announcement.minDepositCount > 0 && documents.통장_납입횟수 < announcement.minDepositCount) return 'fail';
      return 'match';
    })(),
    detail: (() => {
      if (applicant.depositCount !== documents.통장_납입횟수)
        return `신청: ${applicant.depositCount}회 / 서류: ${documents.통장_납입횟수}회 - 불일치`;
      if (announcement.minDepositCount > 0 && documents.통장_납입횟수 < announcement.minDepositCount)
        return `납입횟수 ${documents.통장_납입횟수}회로 공고 기준 ${announcement.minDepositCount}회 미달`;
      return '납입 횟수 일치';
    })(),
    severity: 'major',
  });

  // 예치금액
  if (announcement.requiredDeposit > 0) {
    items.push({
      id: 'total_deposit',
      category: '청약통장',
      label: '예치금액',
      applicantValue: `${applicant.totalDeposit.toLocaleString()}만원`,
      documentValue: `${documents.통장_예치금.toLocaleString()}만원`,
      announcementRule: `${announcement.requiredDeposit.toLocaleString()}만원 이상`,
      status: (() => {
        if (Math.abs(applicant.totalDeposit - documents.통장_예치금) > 10) return 'mismatch';
        if (documents.통장_예치금 < announcement.requiredDeposit) return 'fail';
        return 'match';
      })(),
      detail: (() => {
        if (Math.abs(applicant.totalDeposit - documents.통장_예치금) > 10)
          return `신청: ${applicant.totalDeposit.toLocaleString()}만원 / 서류: ${documents.통장_예치금.toLocaleString()}만원 - 불일치`;
        if (documents.통장_예치금 < announcement.requiredDeposit)
          return `예치금 ${documents.통장_예치금.toLocaleString()}만원으로 기준 ${announcement.requiredDeposit.toLocaleString()}만원 미달`;
        return '예치금액 충족';
      })(),
      severity: 'critical',
    });
  }

  // ─── 4. 소득 검증 ───
  // 가구원수별 소득 테이블이 있으면 정확한 기준 적용
  const applicableCondition = findApplicableCondition(announcement, applicant);
  const householdSize = String(applicant.householdMembers.length || documents.등본_세대원수 || 3);
  const incomeTableForType = getIncomeTableForSupplyType(announcement);
  const incomeThreshold = getIncomeThreshold(incomeTableForType, householdSize, announcement.incomeLimitPercent);
  const effectiveIncomeLimit = incomeThreshold > 0 ? Math.round(incomeThreshold / 10000) : announcement.incomeLimit;

  if (effectiveIncomeLimit > 0) {
    const incomeLimitDisplay = incomeThreshold > 0
      ? `${effectiveIncomeLimit.toLocaleString()}만원 (${householdSize}인 가구, ${announcement.incomeLimitPercent})`
      : `${effectiveIncomeLimit.toLocaleString()}만원 이하 (${announcement.incomeLimitPercent})`;

    items.push({
      id: 'income',
      category: '소득',
      label: '월평균 소득',
      applicantValue: `${applicant.totalHouseholdIncome.toLocaleString()}만원`,
      documentValue: `${documents.소득_월평균.toLocaleString()}만원`,
      announcementRule: incomeLimitDisplay,
      status: (() => {
        const diff = Math.abs(applicant.totalHouseholdIncome - documents.소득_월평균);
        if (diff > 30) return 'mismatch';
        if (documents.소득_월평균 > effectiveIncomeLimit) return 'fail';
        return 'match';
      })(),
      detail: (() => {
        const diff = Math.abs(applicant.totalHouseholdIncome - documents.소득_월평균);
        if (diff > 30)
          return `신청: ${applicant.totalHouseholdIncome.toLocaleString()}만원 / 서류: ${documents.소득_월평균.toLocaleString()}만원 - ${diff}만원 차이`;
        if (documents.소득_월평균 > effectiveIncomeLimit)
          return `소득 ${documents.소득_월평균.toLocaleString()}만원이 기준 ${effectiveIncomeLimit.toLocaleString()}만원 초과`;
        return `소득 기준 충족 (${documents.소득_월평균.toLocaleString()}만원 <= ${effectiveIncomeLimit.toLocaleString()}만원)`;
      })(),
      severity: 'critical',
    });
  }

  // ─── 5. 부양가족 검증 ───
  items.push({
    id: 'dependents',
    category: '가구구성',
    label: '부양가족 수',
    applicantValue: `${applicant.dependentsCount}명`,
    documentValue: `${documents.가족_구성원수 - 1}명 (가족관계증명서 기준, 본인 제외)`,
    announcementRule: '-',
    status: Math.abs(applicant.dependentsCount - (documents.가족_구성원수 - 1)) <= 1 ? 'match' : 'mismatch',
    detail: Math.abs(applicant.dependentsCount - (documents.가족_구성원수 - 1)) <= 1
      ? '부양가족 수 확인'
      : `신청: ${applicant.dependentsCount}명 / 서류: ${documents.가족_구성원수 - 1}명 - 불일치 (가점에 영향)`,
    severity: 'major',
  });

  // 자녀 수 (특별공급)
  if (announcement.minChildren > 0) {
    items.push({
      id: 'children_count',
      category: '가구구성',
      label: '자녀 수',
      applicantValue: `${applicant.childrenCount}명`,
      documentValue: `${documents.가족_자녀수}명 (가족관계증명서)`,
      announcementRule: `${announcement.minChildren}명 이상`,
      status: (() => {
        if (applicant.childrenCount !== documents.가족_자녀수) return 'mismatch';
        if (documents.가족_자녀수 < announcement.minChildren) return 'fail';
        return 'match';
      })(),
      detail: (() => {
        if (applicant.childrenCount !== documents.가족_자녀수)
          return `신청: ${applicant.childrenCount}명 / 서류: ${documents.가족_자녀수}명 - 불일치`;
        if (documents.가족_자녀수 < announcement.minChildren)
          return `자녀 ${documents.가족_자녀수}명으로 기준 ${announcement.minChildren}명 미달`;
        return '자녀 수 조건 충족';
      })(),
      severity: 'critical',
    });
  }

  // ─── 6. 특별공급 조건 검증 ───
  // 혼인 (신혼부부)
  if (announcement.maxMarriageYears > 0) {
    const applicantMarriageDate = applicant.marriageDate;
    const docMarriageDate = documents.혼인_혼인일;
    const datesMatch = applicantMarriageDate === docMarriageDate;

    let marriageYears = 0;
    if (docMarriageDate) {
      const md = new Date(docMarriageDate);
      marriageYears = Math.floor((Date.now() - md.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }

    items.push({
      id: 'marriage_date',
      category: '특별공급',
      label: '혼인일',
      applicantValue: applicantMarriageDate || '-',
      documentValue: docMarriageDate ? `${docMarriageDate} (${documents.혼인_상태})` : '미확인',
      announcementRule: `혼인 ${announcement.maxMarriageYears}년 이내`,
      status: (() => {
        if (!datesMatch) return 'mismatch';
        if (marriageYears > announcement.maxMarriageYears) return 'fail';
        return 'match';
      })(),
      detail: (() => {
        if (!datesMatch)
          return `신청: ${applicantMarriageDate} / 서류: ${docMarriageDate} - 혼인일 불일치`;
        if (marriageYears > announcement.maxMarriageYears)
          return `혼인 후 ${marriageYears}년 경과 - ${announcement.maxMarriageYears}년 기준 초과`;
        return `혼인 ${marriageYears}년 - 기준 이내`;
      })(),
      severity: 'critical',
    });
  }

  // 생애최초
  if (announcement.requireFirstTimeBuyer) {
    items.push({
      id: 'first_time_buyer',
      category: '특별공급',
      label: '생애최초 여부',
      applicantValue: applicant.isFirstTimeBuyer ? '생애최초' : '아님',
      documentValue: documents.등기_주택소유여부 ? '과거 주택 소유 이력 있음' : '주택 소유 이력 없음',
      announcementRule: '생애최초 필수',
      status: applicant.isFirstTimeBuyer && !documents.등기_주택소유여부 ? 'match' :
        applicant.isFirstTimeBuyer && documents.등기_주택소유여부 ? 'mismatch' : 'fail',
      detail: applicant.isFirstTimeBuyer && !documents.등기_주택소유여부
        ? '생애최초 주택구입 확인'
        : applicant.isFirstTimeBuyer && documents.등기_주택소유여부
          ? '신청서에는 생애최초로 기재, 등기부등본상 소유 이력 확인 - 부적격'
          : '생애최초 조건 미충족',
      severity: 'critical',
    });
  }

  // ─── 7. 가점 검증 ───
  if (applicant.claimedScore > 0) {
    const calcHomeless = calcHomelessScore(applicant.homelessPeriodYears);
    const calcDeps = calcDependentsScore(documents.가족_구성원수 - 1);
    const calcAccount = calcAccountScore(getMonthsDiff(documents.통장_가입일));
    const calculatedTotal = calcHomeless + calcDeps + calcAccount;

    items.push({
      id: 'score_homeless',
      category: '가점',
      label: '무주택기간 가점',
      applicantValue: `${applicant.claimedHomelessScore}점`,
      documentValue: `${calcHomeless}점 (${applicant.homelessPeriodYears}년 기준)`,
      announcementRule: '최대 32점',
      status: applicant.claimedHomelessScore === calcHomeless ? 'match' : 'mismatch',
      detail: applicant.claimedHomelessScore === calcHomeless
        ? '무주택기간 가점 일치'
        : `신청: ${applicant.claimedHomelessScore}점 / 산정: ${calcHomeless}점 - ${Math.abs(applicant.claimedHomelessScore - calcHomeless)}점 차이`,
      severity: 'major',
    });

    items.push({
      id: 'score_dependents',
      category: '가점',
      label: '부양가족 가점',
      applicantValue: `${applicant.claimedDependentsScore}점`,
      documentValue: `${calcDeps}점 (${documents.가족_구성원수 - 1}명 기준)`,
      announcementRule: '최대 35점',
      status: applicant.claimedDependentsScore === calcDeps ? 'match' : 'mismatch',
      detail: applicant.claimedDependentsScore === calcDeps
        ? '부양가족 가점 일치'
        : `신청: ${applicant.claimedDependentsScore}점 / 산정: ${calcDeps}점 - 불일치`,
      severity: 'major',
    });

    items.push({
      id: 'score_account',
      category: '가점',
      label: '청약통장 가점',
      applicantValue: `${applicant.claimedAccountScore}점`,
      documentValue: `${calcAccount}점 (${getMonthsDiff(documents.통장_가입일)}개월 기준)`,
      announcementRule: '최대 17점',
      status: applicant.claimedAccountScore === calcAccount ? 'match' : 'mismatch',
      detail: applicant.claimedAccountScore === calcAccount
        ? '청약통장 가점 일치'
        : `신청: ${applicant.claimedAccountScore}점 / 산정: ${calcAccount}점 - 불일치`,
      severity: 'major',
    });

    items.push({
      id: 'score_total',
      category: '가점',
      label: '총 가점',
      applicantValue: `${applicant.claimedScore}점`,
      documentValue: `${calculatedTotal}점 (산정)`,
      announcementRule: '84점 만점',
      status: applicant.claimedScore === calculatedTotal ? 'match' : 'mismatch',
      detail: applicant.claimedScore === calculatedTotal
        ? `총 가점 ${calculatedTotal}점 확인`
        : `신청: ${applicant.claimedScore}점 / 산정: ${calculatedTotal}점 - ${Math.abs(applicant.claimedScore - calculatedTotal)}점 차이`,
      severity: 'critical',
    });
  }

  // ─── 8. 서류 완비 검증 ───
  if (announcement.requiredDocuments) {
    const requiredDocs = getRequiredDocsForType(announcement.requiredDocuments, announcement.supplyType);
    for (const doc of requiredDocs) {
      const submitted = documents.제출서류목록.some(d =>
        d.includes(doc.name) || doc.name.includes(d)
      );
      items.push({
        id: `doc_${doc.name}`,
        category: '서류완비',
        label: doc.name,
        applicantValue: '-',
        documentValue: submitted ? '제출완료' : '미제출',
        announcementRule: '필수 제출',
        status: submitted ? 'match' : 'fail',
        detail: submitted ? `${doc.name} 제출 확인` : `${doc.name} 미제출 - ${doc.description}`,
        severity: 'major',
      });
    }
  }

  // ─── 결과 집계 ───
  const matchCount = items.filter(i => i.status === 'match').length;
  const mismatchCount = items.filter(i => i.status === 'mismatch').length;
  const failCount = items.filter(i => i.status === 'fail').length;
  const warningCount = items.filter(i => i.status === 'warning').length;

  const criticalFails = items.filter(i => (i.status === 'fail' || i.status === 'mismatch') && i.severity === 'critical');

  let verdict: 'pass' | 'fail' | 'review';
  let verdictLabel: string;

  if (criticalFails.length > 0) {
    verdict = 'fail';
    verdictLabel = '부적격';
  } else if (mismatchCount > 0 || warningCount > 0) {
    verdict = 'review';
    verdictLabel = '추가 확인 필요';
  } else {
    verdict = 'pass';
    verdictLabel = '적격';
  }

  const summary: string[] = [];
  if (criticalFails.length > 0) {
    summary.push(`치명적 불일치 ${criticalFails.length}건 발견`);
    criticalFails.forEach(f => summary.push(`- ${f.label}: ${f.detail}`));
  }
  if (mismatchCount > 0) {
    summary.push(`서류 불일치 총 ${mismatchCount}건 확인 필요`);
  }

  return {
    timestamp: new Date().toISOString(),
    verdict,
    verdictLabel,
    totalItems: items.length,
    matchCount,
    mismatchCount,
    failCount,
    warningCount,
    items,
    summary,
  };
}

// ============ 유틸리티 ============

function getMonthsDiff(dateStr: string): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

function calcHomelessScore(years: number): number {
  if (years < 1) return 2;
  const scores = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
  return scores[Math.min(years, 15)];
}

function calcDependentsScore(count: number): number {
  const scores = [5, 10, 15, 20, 25, 30, 35];
  return scores[Math.min(Math.max(count, 0), 6)];
}

function calcAccountScore(months: number): number {
  if (months < 6) return 1;
  if (months < 12) return 2;
  const year = Math.floor(months / 12);
  return Math.min(year + 2, 17);
}

// ============ 조건 매칭 ============

/** 신청자 상황에 맞는 공급 조건 찾기 */
function findApplicableCondition(
  announcement: AnnouncementRequirements,
  applicant: ApplicantInfo,
): SupplyCondition | null {
  if (!announcement.conditions || announcement.conditions.length === 0) return null;

  const isLocal = announcement.localRegion
    ? applicant.address.includes(announcement.localRegion)
    : false;
  const regionType = isLocal ? 'local' : 'other';
  const areaType = announcement.exclusiveArea <= 85 ? 'under85' : 'over85';

  // 정확한 매칭 우선
  let match = announcement.conditions.find(c =>
    c.rank === 1 &&
    (c.regionType === regionType || c.regionType === 'all') &&
    (c.areaType === areaType || c.areaType === 'all')
  );

  // 없으면 any condition with rank 1
  if (!match) match = announcement.conditions.find(c => c.rank === 1);
  // 없으면 첫 번째
  if (!match) match = announcement.conditions[0];

  return match;
}

/** 공급유형에 맞는 소득 테이블 가져오기 */
function getIncomeTableForSupplyType(
  announcement: AnnouncementRequirements,
): Record<string, Record<string, number>> {
  // supplyTypes에서 현재 유형 찾기
  if (announcement.supplyTypes) {
    const st = announcement.supplyTypes.find(s => s.type === announcement.supplyType);
    if (st?.incomeTable && Object.keys(st.incomeTable).length > 0) {
      return st.incomeTable;
    }
  }
  // 전체 incomeTable 폴백
  return announcement.incomeTable || {};
}

/** 소득 테이블에서 가구원수 + 비율에 맞는 한도 가져오기 (원 단위) */
function getIncomeThreshold(
  table: Record<string, Record<string, number>>,
  householdSize: string,
  percent: string,
): number {
  if (!table || Object.keys(table).length === 0) return 0;

  // 정확한 가구원수 매칭
  let sizeData = table[householdSize];
  if (!sizeData) {
    // 가구원수가 테이블보다 크면 최대값 사용
    const sizes = Object.keys(table).map(Number).sort((a, b) => a - b);
    const hs = parseInt(householdSize) || 3;
    const closestSize = sizes.find(s => s >= hs) || sizes[sizes.length - 1];
    sizeData = table[String(closestSize)];
  }
  if (!sizeData) return 0;

  // 비율 매칭 (예: "100%", "120%", "140%")
  const cleanPercent = percent.replace(/\s/g, '');
  if (sizeData[cleanPercent]) return sizeData[cleanPercent];

  // 비율 없으면 가장 낮은 기준 사용
  const values = Object.values(sizeData);
  return values.length > 0 ? Math.min(...values) : 0;
}

/** 필요서류 체크리스트에서 현재 공급유형에 맞는 서류 목록 */
function getRequiredDocsForType(
  checklist: RequiredDocumentChecklist,
  supplyType: string,
): DocumentItem[] {
  const docs: DocumentItem[] = [...(checklist.common || [])];

  const typeSpecific = checklist.perSupplyType?.[supplyType];
  if (typeSpecific?.required) {
    docs.push(...typeSpecific.required);
  }

  return docs;
}

// ============ 기본값 ============

export function getDefaultApplicant(): ApplicantInfo {
  return {
    name: '', residentNumber: '', birthDate: '', isHouseholdHead: true,
    address: '', householdMembers: [],
    isHomeless: true, homelessPeriodYears: 0, dependentsCount: 0,
    subscriptionAccountType: '주택청약종합저축', subscriptionOpenDate: '', subscriptionMonths: 0,
    depositCount: 0, totalDeposit: 0,
    monthlyIncome: 0, spouseIncome: 0, totalHouseholdIncome: 0,
    maritalStatus: '', marriageDate: '', childrenCount: 0, isFirstTimeBuyer: false,
    claimedScore: 0, claimedHomelessScore: 0, claimedDependentsScore: 0, claimedAccountScore: 0,
  };
}

export function getDefaultAnnouncement(): AnnouncementRequirements {
  return {
    complexName: '', supplyType: '일반공급', housingType: '민영주택', region: '',
    exclusiveArea: 84, minAge: 19, requireHouseholdHead: false,
    requireHomeless: true, requireAllMembersHomeless: false,
    minSubscriptionMonths: 12, minDepositCount: 0, requiredDeposit: 300,
    incomeLimit: 0, incomeLimitPercent: '',
    maxMarriageYears: 0, minChildren: 0, requireFirstTimeBuyer: false, maxAge: 0,
    conditions: [], conditionsFetched: false,
    incomeTable: {}, requiredDocuments: undefined, supplyTypes: [],
    localRegion: '', otherRegions: '', announcementDate: '',
    isRegulated: false, resaleRestriction: '', rewinRestriction: '',
  };
}

export function getDefaultDocuments(): DocumentVerifiedData {
  return {
    등본_세대주: '', 등본_세대주여부: false, 등본_주소: '', 등본_세대원수: 0, 등본_세대원목록: [],
    초본_전입일: '', 초본_거주기간개월: 0, 초본_주소이력: [],
    가족_구성원수: 0, 가족_배우자: '', 가족_자녀수: 0, 가족_직계존속수: 0,
    혼인_혼인일: '', 혼인_상태: '',
    통장_종류: '', 통장_가입일: '', 통장_납입횟수: 0, 통장_예치금: 0,
    소득_월평균: 0, 소득_연간: 0,
    건보_월납부액: 0,
    등기_주택소유여부: false, 등기_소유주택수: 0,
    제출서류목록: [],
  };
}
