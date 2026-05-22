// 담당별 검증 에이전트의 역할 지식 베이스 — 공급유형별 자격·서류·추출·대조 룰 정의

/**
 * 7개 담당 역할의 지식 베이스.
 *
 * 각 역할 = 한 공급유형 전문가. 자신이 담당하는 서류에서 값을 추출하고
 * 공고 조건과 대조해 「적합 의심 / 확인 필요」를 제안. 최종 판정은 사람.
 *
 * 지식의 두 층위:
 *   - 법령 기반 일반 룰 (이 파일에 고정 인코딩)
 *   - 공고별 수치 (announcement.eligibility_rules에서 주입 — 소득 한도·예치금·기준일 등)
 *
 * 출처: 사용자 제공 「청약 OOO.xlsx」 7개 파일 (주문진 삼부르네상스 오션포레 공고문 정리).
 */

export type RoleId =
  | "common"
  | "institution"
  | "multichild"
  | "newlywed"
  | "elderly"
  | "firstlife"
  | "general";

export type CheckSeverity = "must" | "verify" | "info";

/** 한 서류에서 추출할 값 */
export interface ExtractionTarget {
  /** 서류 종류 (페이지 분류 docType과 매칭) */
  docType: string;
  /** 추출할 필드들 */
  fields: Array<{
    key: string;
    label: string;
    /** LLM에게 무엇을 어떻게 뽑을지 지시 */
    instruction: string;
  }>;
}

/** 추출값 ↔ 공고조건 대조 규칙 */
export interface RuleCheck {
  key: string;
  label: string;
  /** 판정 제안 설명 — 어떤 조건을 만족해야 하는지 */
  description: string;
  severity: CheckSeverity;
  /** 이 체크에 필요한 추출 필드 키들 */
  usesFields: string[];
}

export interface ReviewerRole {
  id: RoleId;
  label: string;
  scope: "common" | "special" | "general";
  /** 이 역할이 적용되는 공급유형 (common은 전체) */
  appliesToSupplyTypes: string[];
  /** 이 담당이 검토하는 서류 목록 */
  requiredDocs: string[];
  extractionTargets: ExtractionTarget[];
  ruleChecks: RuleCheck[];
  /** LLM 프롬프트에 들어갈 배경 지식 (공고문 핵심 룰) */
  knowledge: string;
}

/* ─── ① 공통사항 ─────────────────────────────────── */

const COMMON: ReviewerRole = {
  id: "common",
  label: "청약 공통사항",
  scope: "common",
  appliesToSupplyTypes: ["*"],
  requiredDocs: [
    "주민등록표등본",
    "주민등록표초본",
    "가족관계증명서",
    "출입국사실증명원",
    "청약통장 순위확인서",
    "인감증명서",
    "신분증",
    "개인정보 수집·이용 동의서",
    "특별공급신청서·무주택 서약서",
  ],
  extractionTargets: [
    {
      docType: "주민등록표등본",
      fields: [
        { key: "householdMembers", label: "세대원 명단", instruction: "세대주 포함 전 세대원 성명·관계·주민번호 앞6자리 목록" },
        { key: "isHead", label: "세대주 여부", instruction: "당첨자 본인이 세대주인지" },
        { key: "moveInDate", label: "전입일", instruction: "현 주소 전입일 (지역 거주기간 산정용)" },
        { key: "address", label: "주소", instruction: "현 거주지 주소" },
      ],
    },
    {
      docType: "주민등록표초본",
      fields: [
        { key: "addressHistory", label: "주소 이력", instruction: "과거 주소 변동 이력 (거주기간 산정용)" },
        { key: "registrationCancelled", label: "말소 이력", instruction: "주민등록 말소 사실 유무" },
      ],
    },
    {
      docType: "출입국사실증명원",
      fields: [
        { key: "overseasContinuous90", label: "90일 연속 초과 해외체류", instruction: "연속 90일 초과 해외 체류 구간 유무 (입국 후 7일 내 동일국 재출국은 연속 합산)" },
        { key: "overseasYearly183", label: "연간 183일 초과", instruction: "어느 연도든 합산 183일 초과 해외 체류한 연도 목록" },
      ],
    },
    {
      docType: "청약통장 순위확인서",
      fields: [
        { key: "joinMonths", label: "가입기간(개월)", instruction: "청약통장 가입 후 경과 개월 수" },
        { key: "depositAmount", label: "예치금", instruction: "현재 예치금액 (원)" },
        { key: "rank", label: "순위", instruction: "1순위/2순위" },
      ],
    },
    {
      docType: "인감증명서",
      fields: [
        { key: "issueDate", label: "발급일", instruction: "인감증명서 발급일 (공고일 2022.03.25 이후 발행분인지 판정용)" },
      ],
    },
    {
      docType: "신분증",
      fields: [
        { key: "name", label: "성명", instruction: "신분증상 성명" },
        { key: "rrnFront", label: "주민번호 앞자리", instruction: "주민번호 앞 6~7자리" },
        { key: "validUntil", label: "유효기간", instruction: "운전면허·여권 유효기간 (있으면)" },
      ],
    },
  ],
  ruleChecks: [
    { key: "household_homeless", label: "세대원 전원 무주택", description: "세대 구성원 전원이 주택 미소유여야 함 (특공). 분리 배우자·그 세대원 포함. (일반공급은 소형·저가 예외 별도)", severity: "must", usesFields: ["householdMembers"] },
    { key: "region_priority", label: "지역 우선 (강릉 6개월)", description: "강릉시 6개월 이상 계속 거주자 우선공급 (공고일 2022.03.25 기준 = 2021.09.25 이전부터 계속 거주). 잔여 시 강원 거주자. 전입일·주소이력으로 산정. (원문에 1년 기준 없음 — 6개월로 통일)", severity: "verify", usesFields: ["moveInDate", "addressHistory"] },
    { key: "overseas_90", label: "해외 90일 연속 초과", description: "연속 90일 초과 국외거주 기간은 국내거주로 미인정 → 해당지역(강릉) 우선공급 불인정 가능. 현재 해외체류 상태·기간에 따라 기타지역 청약까지 제한될 수 있음. 입국 후 7일내 동일국 재출국은 연속 합산. 단기체류·생업 직접종사(파견·취업 등 증빙)는 예외.", severity: "verify", usesFields: ["overseasContinuous90"] },
    { key: "overseas_183", label: "연간 183일 초과", description: "연간 183일 초과 국외거주는 그 기간 국내거주 미인정 → 거주기간 산정에서 차감.", severity: "verify", usesFields: ["overseasYearly183"] },
    { key: "duplicate_apply", label: "중복청약 무효 규칙", description: "당첨자발표일 동일 주택은 1인 1건만. 같은 단지 특공1건+일반1건 가능하나 특공 당첨 시 일반 제외. 특공 유형 간 중복청약은 둘 다 무효. 당첨 통장은 계약 여부 무관 재사용 불가.", severity: "info", usesFields: [] },
    { key: "subscription_6m", label: "청약통장 6개월+예치금", description: "가입 6개월 경과 + 지역·면적별 예치금 이상. (강릉/강원: 85㎡↓200만/102㎡↓300만/135㎡↓400만/전면적500만). 기관추천 일부(국가유공자·보훈·장애인·도시재생부지제공자·철거인) 면제.", severity: "must", usesFields: ["joinMonths", "depositAmount"] },
    { key: "doc_after_announce", label: "서류 공고일 이후 발행", description: "모든 증명서류(인감증명서 포함)는 최초 입주자모집공고일(2022.03.25) 이후 발행분이어야 함. (원문에 3개월 기준 없음)", severity: "verify", usesFields: ["issueDate"] },
    { key: "id_match", label: "신분증 본인 일치", description: "신분증(주민등록증·운전면허증·여권) 성명·주민번호가 신청 정보와 일치. 유효성은 운영 검증.", severity: "must", usesFields: ["name", "rrnFront", "validUntil"] },
  ],
  knowledge: `[공통 자격 — 모든 당첨자]
- 입주자모집공고일(2022.03.25) 기준으로 모든 자격 판정.
- 비투기과열·비청약과열 지역: 일반공급은 1주택자도 1순위 가능. 단 특별공급은 무주택 요건 별도 적용.
- 무주택세대구성원 = 신청자 + 배우자 + (세대별 주민등록표에 함께 등재된) 직계존속·직계비속·배우자 직계비속 전원이 무주택. 분리 배우자·그 세대원도 무주택이어야 함.
- 거주 우선: 강릉시 6개월 이상 계속 거주자 우선 (공고일 2022.03.25 기준 = 2021.09.25 이전부터 계속 거주). 잔여 시 강원 거주자. ★ 원문에 「1년」 기준 없음 — 6개월로 통일.
- 해외체류 (자격박탈로 단정 X): ① 연속 90일 초과 국외거주 = 국내거주 미인정 → 해당지역(강릉) 우선공급 불인정 가능, 현재 체류 상태·기간 따라 기타지역 청약까지 제한 가능. 입국 후 7일내 동일국 재출국은 연속 합산. ② 연간 183일 초과 = 그 기간 거주 미인정(차감). 단기체류·생업 직접종사(파견·취업 증빙)는 예외.
- 청약통장: 가입 6개월 경과 + 지역·면적별 예치금 이상이 1순위. 기관추천 일부 대상자(국가유공자·국가보훈대상자·장애인·도시재생 부지제공자·철거민) 면제.
- 중복청약: 당첨자발표일 동일 주택 1인 1건(2건+ 무효). 같은 단지 특공1건+일반1건 가능하나 특공 당첨 시 일반 제외. 특공 유형 간 중복은 둘 다 무효. 과거 2년내 가점제 당첨 세대는 일반 1순위 가점제 제외(추첨 포함). 당첨 통장 재사용 불가(계약 여부 무관).
- 분양권 등 주택소유 판정:
  · 신규 계약자 = 「공급계약 체결일」 기준 주택 소유. 단 미분양(선착순·잔여세대) 최초 공급받은 경우 제외.
  · 매수자 = 「매매대금 완납일」(부동산거래계약 신고서상) 기준 주택 소유. (매수자는 미분양 제외 혜택 없음)
  · 2018.12.11 이후 입주자모집공고·관리처분계획·사업계획 승인 신청 주택의 분양권부터 적용.
- 모든 증명서류는 공고일(2022.03.25) 이후 발행분. (원문에 인감 3개월 기준 없음)
- 제출서류는 특별공급 공통 / 일반공급 공통으로 구성이 다름. (특공: 특별공급신청서·무주택서약서·개인정보동의서 등 / 일반: 신분증·인감·등본·초본·가족관계증명서 등)`,
};

/* ─── ② 기관추천 ─────────────────────────────────── */

const INSTITUTION: ReviewerRole = {
  id: "institution",
  label: "기관추천 특별공급",
  scope: "special",
  appliesToSupplyTypes: ["기관추천"],
  requiredDocs: ["기관추천서 또는 인증서", "복무확인서 (해당자: 해당지역 외 거주 10년+ 장기복무군인)"],
  extractionTargets: [
    {
      docType: "기관추천서",
      fields: [
        { key: "issuer", label: "발행기관", instruction: "추천서 발행 기관명 (국군복지단·강원도청·보훈지청·중기청 등)" },
        { key: "recommendType", label: "추천 유형", instruction: "장기복무군인/장애인/국가유공자/중소기업근로자 등" },
        { key: "inNotifiedList", label: "통보 명단 포함", instruction: "해당 기관이 사업주체에 통보한 추천 명단에 포함되는지" },
        { key: "issueDate", label: "발행일", instruction: "추천서 발행일 (공고일 이후)" },
      ],
    },
  ],
  ruleChecks: [
    { key: "recommend_valid", label: "기관 추천 유효", description: "해당 추천 기관장이 발행한 추천서·인증서 있고, 사업주체 통보 명단에 포함(추천명부=기관추천 명단 확인으로 갈음). 통보 명단 포함이 핵심.", severity: "must", usesFields: ["issuer", "recommendType", "inNotifiedList"] },
    { key: "subscription_exempt", label: "청약통장 면제 대상 확인", description: "국가유공자·국가보훈대상자·장애인·도시재생 부지제공자(+철거인)는 청약통장 불필요. 그 외(중소기업 근로자 등)는 6개월+예치금 필요.", severity: "verify", usesFields: ["recommendType"] },
    { key: "no_prior_special", label: "과거 특공 당첨 없음", description: "과거 특별공급에 당첨된 사실이 있으면 제외.", severity: "must", usesFields: [] },
  ],
  knowledge: `[기관추천 특별공급 — 22세대]
- 대상: 주택공급에 관한 규칙 제36조 해당자 중 공고일 현재 무주택세대구성원으로 기관장 추천·인정서류 받은 자.
- 거주요건·우선순위는 기관장이 정함. 과거 특별공급 당첨 사실 있으면 제외.
- 청약통장: 6개월+예치금 필요. 단 국가유공자·보훈대상자·장애인·도시재생 부지제공자는 불필요.
- 추천기관: 10년이상 장기복무군인=국군복지단 / 장애인=강원도청 경로장애인과 / 장기복무제대군인·국가유공자·보훈대상=강원동부보훈지청 / 중소기업근로자=강원지방중기부 강원영동사무소.
- 세대주 요건 X, 소득·자산 기준 X.
- 출입국사실증명원 제출 제외 대상 (기관추천만 면제).
- 해당 기관이 사업주체에 통보한 명단에 있어야 신청 가능.`,
};

/* ─── ③ 다자녀 ─────────────────────────────────── */

const MULTICHILD: ReviewerRole = {
  id: "multichild",
  label: "다자녀가구 특별공급",
  scope: "special",
  appliesToSupplyTypes: ["다자녀가구", "다자녀"],
  requiredDocs: ["가족관계증명서", "다자녀 배점기준표", "임신진단서", "입양관계증명서", "한부모가족증명서", "주민등록표등본"],
  extractionTargets: [
    {
      docType: "가족관계증명서",
      fields: [
        { key: "minorChildren", label: "미성년 자녀 수", instruction: "공고일 기준 만19세 미만 자녀 수 (태아·입양·전혼자녀 포함)" },
        { key: "infantChildren", label: "영유아 수", instruction: "만6세 미만 자녀 수" },
        { key: "childBirthDates", label: "자녀 생년월일", instruction: "각 자녀 생년월일 목록" },
      ],
    },
    {
      docType: "다자녀 배점기준표",
      fields: [
        { key: "declaredScore", label: "신고 배점", instruction: "신청자가 작성한 총 배점 (100점 만점)" },
        { key: "scoreBreakdown", label: "배점 내역", instruction: "미성년자녀수·영유아·세대구성·무주택기간·거주기간·통장 항목별 점수" },
      ],
    },
  ],
  ruleChecks: [
    { key: "min3_children", label: "미성년 자녀 3명 이상", description: "공고일 현재 만19세 미만 자녀 3명 이상 (태아·입양·전혼자녀 포함). 핵심 자격. 다른 지역 거주 자녀는 가족관계증명서로 미성년 입증.", severity: "must", usesFields: ["minorChildren"] },
    { key: "score_match", label: "배점 신고값 검증", description: "신고 배점이 가족관계·등본·초본·통장 실제값과 일치하는가. 미성년자녀수(40)→영유아(15)→세대구성(5)→무주택기간(20)→시도거주(15)→통장(5).", severity: "verify", usesFields: ["declaredScore", "scoreBreakdown", "minorChildren", "infantChildren"] },
    { key: "sido_residence", label: "시·도 거주기간 = 강원도", description: "배점표 15점 항목은 강릉시가 아니라 「해당 시·도(강원도)」 계속 거주기간. (강릉 6개월은 별개 — 해당지역 우선공급 판단). 등본·초본으로 확인.", severity: "verify", usesFields: ["scoreBreakdown"] },
    { key: "three_gen", label: "3세대 배점", description: "3세대 이상 배점(5점)은 직계존속(배우자 직계존속 포함, 무주택)과 공고일 기준 과거 3년 이상 계속 동일 주민등록표등본 등재.", severity: "info", usesFields: ["scoreBreakdown"] },
    { key: "single_parent", label: "한부모 배점", description: "한부모 배점(5점)은 한부모가족증명서 + 한부모가족지원법상 5년 경과 요건 확인.", severity: "info", usesFields: ["scoreBreakdown"] },
  ],
  knowledge: `[다자녀가구 특별공급 — 22세대]
- 대상: 규칙 제40조. 공고일 현재 강릉/강원 거주 + 만19세 미만 자녀 3명(태아 포함) 이상 무주택세대구성원.
- 자녀 전원 민법상 미성년(만19세 미만)이어야 함. 다른 지역 거주 자녀는 가족관계증명서로 미성년 입증.
- 태아·입양 자녀 포함 (출산/입양 유지 조건).
- 선정: 강릉시 6개월+ 우선 → 100점 배점표 점수순. 동점 시 ①미성년자녀수 많은 자 ②연령(연월일) 많은 자.
- 배점(100점): 미성년자녀수(40: 5명+40/4명35/3명30) + 영유아수(15: 3명+15/2명10/1명5) + 세대구성(5: 3세대이상 또는 한부모) + 무주택기간(20: 10년+20/5~10년15/1~5년10) + 시·도거주(15: 10년+15/5~10년10/1~5년5) + 통장가입(5: 10년+).
- ★ 시·도 거주(15점) = 「강원도」 계속 거주기간 (강릉 6개월은 해당지역 우선공급 판단으로 별개). 등본·초본으로 확인.
- 영유아 = 만6세 미만. 3세대 = 직계존속(무주택)과 공고일 기준 과거 3년 이상 동일 등본. 한부모 = 한부모가족증명서 + 5년 경과.
- 무주택기간·거주기간은 등본/초본으로, 통장은 가입확인서로 확인.
- 세대주 요건 X, 소득·자산 X.`,
};

/* ─── ④ 신혼부부 ─────────────────────────────────── */

const NEWLYWED: ReviewerRole = {
  id: "newlywed",
  label: "신혼부부 특별공급",
  scope: "special",
  appliesToSupplyTypes: ["신혼부부"],
  requiredDocs: ["혼인관계증명서", "가족관계증명서", "건강보험자격득실확인서", "소득증빙서류", "부동산소유현황 (해당자: 추첨·자산기준 신청)", "비사업자 확인각서 (해당자)", "임신진단서", "출생증명서", "입양관계증명서"],
  extractionTargets: [
    {
      docType: "혼인관계증명서",
      fields: [
        { key: "marriageDate", label: "혼인신고일", instruction: "현 배우자와의 혼인신고일 (재혼이면 현 혼인 기준)" },
        { key: "divorceHistory", label: "이혼 이력", instruction: "과거 이혼·재혼 이력 유무" },
      ],
    },
    {
      docType: "가족관계증명서",
      fields: [
        { key: "minorChildren", label: "미성년 자녀 수", instruction: "혼인 중 출산·입양 자녀 수 (전혼자녀 포함 조건)" },
      ],
    },
    {
      docType: "소득증빙서류",
      fields: [
        { key: "incomeMonthly", label: "월평균 소득", instruction: "근로소득원천징수영수증 총급여(21번) 또는 사업소득 과세대상급여 ÷ 근무월수" },
        { key: "dualIncome", label: "맞벌이 여부", instruction: "부부 모두 소득 있는지" },
      ],
    },
  ],
  ruleChecks: [
    { key: "marriage_7y", label: "혼인 7년 이내", description: "혼인신고일이 공고일 기준 7년 이내. 사실혼 불인정. 재혼도 현 혼인 7년 기준.", severity: "must", usesFields: ["marriageDate"] },
    { key: "homeless_since_marriage", label: "혼인 후 계속 무주택", description: "혼인신고일부터 공고일까지 계속 무주택 (예외: 2018.12.11 전 처분+무주택 2년 경과 시 2순위).", severity: "must", usesFields: [] },
    { key: "income_limit", label: "소득 기준 (밴드별 금액)", description: "추출 월평균소득을 공고 금액표(가구원수별)와 정확한 밴드로 대조. 외벌이: 우선 ≤100% / 일반 100%초과~140% / 추첨 >140%+자산. 맞벌이: 우선 합산≤120% AND 1인≤100% / 일반 합산 120%초과~160% AND 1인≤140% / 추첨 >160%+자산. %가 아니라 해당 금액 이하 여부로 판정.", severity: "must", usesFields: ["incomeMonthly", "dualIncome"] },
    { key: "asset_for_chumcheom", label: "추첨·자산기준 부동산", description: "추첨제 또는 자산기준 신청 시 부동산소유현황으로 부동산가액 3.31억 이하 확인.", severity: "verify", usesFields: [] },
    { key: "child_priority", label: "자녀 우선순위", description: "1순위=현 혼인 중 자녀 출산(임신·입양 포함). 2순위=1순위에 해당하지 않는 자(무자녀 또는 2018.12.11 전 처분+무주택 2년 특례). 미성년 자녀수(태아·전혼자녀 포함)로 동순위 경쟁.", severity: "verify", usesFields: ["minorChildren"] },
  ],
  knowledge: `[신혼부부 특별공급 — 46세대]
- 대상: 공고일 현재 강릉/강원 거주, 혼인기간 7년 이내(혼인신고일, 재혼 포함) 무주택세대구성원. 혼인신고일부터 공고일까지 계속 무주택.
- 특례: 혼인 중 주택 소유 이력 있어도 2018.12.11 전 처분 + 공고일까지 무주택 유지 + 무주택 2년 경과 시 2순위 청약 가능.

[소득 기준 — % 가 아니라 「해당 금액 이하」로 판정. 공고 금액표(2021 도시근로자 가구원수별) 사용]
정확한 밴드 (이상~이하 경계 주의):
- 외벌이(배우자 소득 없음):
  · 우선공급(50%): 100% 이하 (3인이하 6,208,934원 이하)
  · 일반공급(20%): 100% 초과 ~ 140% 이하 (3인이하 6,208,935 ~ 8,692,508원)
  · 추첨(30%): 140% 초과 + 부동산 3.31억 이하
- 맞벌이(부부 모두 소득):
  · 우선공급(50%): 부부합산 120% 이하 AND 1인 100% 이하 (3인이하 합산 ~7,450,721원)
  · 일반공급(20%): 120% 초과 ~ 160% 이하 AND 1인 140% 이하 (3인이하 7,450,722 ~ 9,934,294원)
  · 추첨(30%): 160% 초과 + 부동산 3.31억 이하
※ 가구원수별 금액은 공고문 소득표에 4·5·6·7·8인 각각 기재. 그 금액과 직접 대조.
※ 월평균소득 = 연간소득 ÷ 근무월수. 근로자는 원천징수 총급여(21번), 사업자는 종합소득세 과세대상.

- 선정: 우선 50% → 일반 20% → 추첨 30%. 1순위=현 혼인 중 자녀 출산(임신·입양 포함). 2순위=그 외.
- 동순위: ①강릉 6개월+ ②미성년자녀수(태아·전혼자녀 포함, 등본 등재 조건) ③추첨.
- 임신은 임신진단서, 입양은 입양관계증명서(입양신고일 적용). 계약 시 출산 관련자료 제출 의무.
- 세대주 요건 X, 소득·자산 O.`,
};

/* ─── ⑤ 노부모부양 ─────────────────────────────────── */

const ELDERLY: ReviewerRole = {
  id: "elderly",
  label: "노부모부양 특별공급",
  scope: "special",
  appliesToSupplyTypes: ["노부모부양", "노부모"],
  requiredDocs: ["주민등록표등본", "가족관계증명서", "직계존속 출입국사실증명원", "84점 가점표"],
  extractionTargets: [
    {
      docType: "주민등록표등본",
      fields: [
        { key: "elderlyDependents", label: "직계존속 부양", instruction: "만65세 이상 직계존속(배우자 직계존속 포함) + 동일 등본 등재 기간" },
        { key: "isHead", label: "세대주 여부", instruction: "당첨자 본인이 세대주인지 (노부모는 세대주 필수)" },
        { key: "dependYears", label: "부양 기간", instruction: "직계존속과 동일 등본 계속 등재 기간 (3년 이상 요건)" },
      ],
    },
    {
      docType: "84점 가점표",
      fields: [
        { key: "declaredScore", label: "신고 가점", instruction: "무주택기간+부양가족수+통장가입기간 = 84점 만점 신고값" },
      ],
    },
  ],
  ruleChecks: [
    { key: "head_required", label: "무주택 세대주 필수", description: "당첨자 본인이 무주택 세대주여야 함 (노부모만 세대주 필수). 피부양자(노부모)의 배우자도 무주택.", severity: "must", usesFields: ["isHead"] },
    { key: "elderly_65_3y", label: "만65세 직계존속 3년 부양", description: "만65세 이상 직계존속(배우자 직계존속 포함)을 3년 이상 계속 동일 세대별 주민등록표등본에 등재(부양). 핵심 자격. 등본 부족 시 직계존속 초본으로 3년 동일등본 확인.", severity: "must", usesFields: ["elderlyDependents", "dependYears"] },
    { key: "elderly_60_owns", label: "만60세+ 직계존속 무주택", description: "만60세 이상 직계존속(피부양자 및 피부양자 배우자 포함)이 주택 소유 시 유주택자 → 노부모부양 부적격. 신청자가 무주택 세대주여야 하므로 필수 검증.", severity: "must", usesFields: ["elderlyDependents"] },
    { key: "elderly_overseas", label: "피부양 직계존속 해외체류", description: "피부양 직계존속 출입국증명서로 부양기간 내 해외거주 확인 필수. 공고일 기준 최근 3년 내 연속 90일 초과 해외체류 시 노부모부양 신청 불가.", severity: "must", usesFields: ["elderlyDependents"] },
    { key: "gajeom_match", label: "84점 가점 검증", description: "신고 가점이 무주택기간(32)+부양가족수(35)+통장(17) 실제값과 일치.", severity: "verify", usesFields: ["declaredScore"] },
  ],
  knowledge: `[노부모부양 특별공급 — 5세대]
- 대상: 규칙 제46조. 공고일 현재 강릉/강원 거주, 만65세 이상 직계존속(배우자 직계존속 포함)을 3년 이상 계속 부양(같은 세대별 주민등록표등본에 등재된 경우에 한정)하는 무주택 세대주. 피부양자 배우자도 무주택.
- 무주택기간 산정: 신청자·배우자·피부양자(노부모)·그 배우자 기준. 피부양자가 주택 소유했던 기간은 신청자 무주택기간에서 제외.
- ★ 만60세 이상 직계존속(피부양자 및 피부양자 배우자 포함)이 주택 소유 시 유주택자 → 부적격. 신청자가 무주택 세대주여야 하므로 필수 검증.
- 피부양 직계존속 출입국증명서: 공고일 기준 최근 3년 내 연속 90일 초과 해외체류 시 노부모부양 신청 불가.
- 부양기간(3년) 확인은 등본 부족 시 직계존속 초본으로 동일등본 등재 확인.
- 청약통장 1순위 자격 필요.
- 선정: 강릉 6개월+ 우선 → 84점 가점제 → 동점 추첨.
- 가점(84점): 무주택기간(32: 만30세/혼인일부터, 1년당+2, 15년+32) + 부양가족수(35: 본인제외, 0명5/1명10/.../6명+35) + 통장가입(17: 6개월미만1/6개월~1년2/2년당+1/15년+17).
- 과거 2년내 가점제 당첨 세대는 1순위 가점제 제외(추첨제로).
- 세대주 요건 O (유일), 소득·자산 X.`,
};

/* ─── ⑥ 생애최초 ─────────────────────────────────── */

const FIRSTLIFE: ReviewerRole = {
  id: "firstlife",
  label: "생애최초 특별공급",
  scope: "special",
  appliesToSupplyTypes: ["생애최초"],
  requiredDocs: ["혼인관계증명서", "건강보험자격득실확인서", "소득세 납부 입증서류", "소득증빙서류", "부동산소유현황", "비사업자 확인각서"],
  extractionTargets: [
    {
      docType: "소득세 납부 입증서류",
      fields: [
        { key: "taxYears", label: "소득세 납부 연수", instruction: "소득세 납부한 누적 연수 (5년 이상 요건). 납부의무액 0원도 포함" },
      ],
    },
    {
      docType: "혼인관계증명서",
      fields: [
        { key: "marriedOrChild", label: "혼인/자녀 유무", instruction: "혼인 중이거나 미혼 자녀 있음, 또는 1인 가구 여부" },
      ],
    },
    {
      docType: "소득증빙서류",
      fields: [
        { key: "incomeMonthly", label: "월평균 소득", instruction: "세대 월평균 소득 (도시근로자 대비 %)" },
      ],
    },
    {
      docType: "부동산소유현황",
      fields: [
        { key: "everOwnedHome", label: "생애 주택소유 이력", instruction: "세대 전원이 과거 주택 소유 사실이 전혀 없는지" },
      ],
    },
  ],
  ruleChecks: [
    { key: "never_owned", label: "생애 무주택", description: "세대에 속한 모든 자가 과거 주택 소유 사실 전무 (생애최초 핵심).", severity: "must", usesFields: ["everOwnedHome"] },
    { key: "tax_5y", label: "5년 이상 소득세 납부 (본인)", description: "★ 청약자 본인 기준 5년 이상 소득세 납부 (배우자·세대원 납부실적 대체 불가). 소득세 납부의무자이나 소득공제·세액공제·세액감면으로 납부의무액 없는 0원은 인정. 소득 없음·납부의무 없음·무신고 0원은 불인정.", severity: "must", usesFields: ["taxYears"] },
    { key: "married_or_child", label: "혼인 또는 자녀 또는 1인가구", description: "혼인 중이거나 미혼 자녀(입양 포함) 있음. 또는 1인 가구. 1인 가구는 추첨제로만 청약 가능, 단독세대는 「전용면적 60㎡ 이하 주택형」에 한해 청약 가능.", severity: "must", usesFields: ["marriedOrChild"] },
    { key: "rank1_required", label: "1순위 요건 필요", description: "비규제라도 생애최초 자체의 제28조제1항 1순위 요건 필요 (이 공고: 청약통장 6개월+예치금). 투기/청약과열 추가요건(통장 2년·세대주·과거5년 당첨제한)만 미적용.", severity: "must", usesFields: [] },
    { key: "income_or_asset", label: "소득 기준 (밴드별 금액)", description: "추출 월평균소득을 공고 금액표와 정확한 밴드로 대조. 우선 130% 이하 / 일반 130% 초과~160% 이하 / 추첨 160% 초과+부동산 3.31억 이하. 1인가구는 소득기준 또는 자산기준 중 하나만 충족하면 자격 충족(추첨제). %가 아니라 해당 금액 이하 여부로 판정.", severity: "must", usesFields: ["incomeMonthly"] },
  ],
  knowledge: `[생애최초 특별공급 — 22세대]
- 대상: 규칙 제43조. 공고일 현재 강릉/강원 거주, 생애최초(세대 전원 과거 주택소유 사실 없음)로 주택 구입, 제28조제1항 1순위 무주택세대구성원.
- 추가 요건 모두 충족: ① 혼인 중이거나 미혼 자녀(입양 포함) 있음, 또는 1인 가구. ② ★ 청약자 본인이 근로자/자영업자로 5년 이상 소득세 납부 (배우자·세대원 대체 불가).
  · 0원 인정: 소득세 납부의무자이나 소득공제·세액공제·세액감면으로 납부의무액이 없는 경우.
  · 0원 불인정: 소득 없음·납부의무 없음·무신고 상태의 0원.
- 1인 가구: 추첨제로만 청약 가능. 단독세대(동거인·형제자매 등 세대구성원 아닌 자와 같은 세대 포함)는 「전용면적 60㎡ 이하 주택형」에 한해. 1인가구는 소득기준 또는 자산기준 중 하나만 충족하면 자격 충족.

[소득 기준 — % 가 아니라 「해당 금액 이하」로 판정. 공고 금액표(가구원수별) 사용]
- 우선공급(50%): 130% 이하
- 일반공급(20%): 130% 초과 ~ 160% 이하
- 추첨(30%): 160% 초과 + 부동산 3.31억 이하

- ★ 1순위 요건: 비규제지역이라도 생애최초 자체의 제28조제1항 1순위 요건 필요. 이 공고는 청약통장 6개월 이상+지역·면적별 예치금. 단 투기과열·청약과열의 추가 1순위 요건(통장 2년·세대주·과거 5년 당첨제한)은 미적용.
- 선정: 우선 50% → 일반 20% → 추첨 30%.
- 세대주 요건 X, 소득·자산 O.`,
};

/* ─── ⑦ 일반공급 ─────────────────────────────────── */

const GENERAL: ReviewerRole = {
  id: "general",
  label: "일반공급",
  scope: "general",
  appliesToSupplyTypes: ["일반공급"],
  // 일반공급 제출서류 = 신분증·인감·등본·초본·가족관계증명서 (공통 일반공급 표).
  // 주택소유·소형저가 증빙은 부적격 통보 후 「소명 단계」 서류라 별도.
  requiredDocs: ["신분증", "인감증명서", "주민등록표등본", "주민등록표초본", "가족관계증명서"],
  extractionTargets: [
    {
      docType: "청약통장 순위확인서",
      fields: [
        { key: "rank", label: "순위", instruction: "1순위/2순위 (자격검증 항목 — 제출서류 목록과 별개)" },
        { key: "joinMonths", label: "가입기간", instruction: "가입 경과 개월" },
        { key: "depositAmount", label: "예치금", instruction: "예치금액" },
      ],
    },
    {
      docType: "부동산소유현황",
      fields: [
        { key: "ownedHomes", label: "보유 주택", instruction: "보유 주택 (소명 단계 자료). 소형·저가 예외 판정 대상 포함" },
        { key: "smallLowHouse", label: "소형·저가 해당", instruction: "전용 60㎡ 이하 + 공시가격 비수도권 8천만/수도권 1.3억 이하 주택 1호만 보유 여부" },
      ],
    },
  ],
  ruleChecks: [
    { key: "subscription_rank", label: "청약 순위·예치금 (자격검증)", description: "1순위 = 가입 6개월 경과 + 지역·면적별 예치금 충족. 2순위 = 입주자저축 가입자(★예치금 무관 — 1순위 규칙 적용 금지). 자격검증 항목이며 일반공급 제출서류 목록과는 구분.", severity: "must", usesFields: ["rank", "joinMonths", "depositAmount"] },
    { key: "gajeom_chumcheom", label: "가점제·추첨제 비율", description: "전용 85㎡ 이하: 가점제 40% + 추첨제 60%. 가점제 낙첨자는 추첨제로 자동 전환.", severity: "info", usesFields: [] },
    { key: "small_low_exempt", label: "소형·저가 무주택 인정 (소명)", description: "전용 60㎡ 이하 + 공시가격 한도 이하 주택 1호만 보유 = 일반공급에선 무주택 인정 (특공은 불인정). 부적격 통보 후 소명 단계 서류로 증빙.", severity: "verify", usesFields: ["smallLowHouse", "ownedHomes"] },
    { key: "region_priority", label: "지역 우선", description: "강릉시 6개월 이상 거주자 우선. 잔여 시 강원 거주자.", severity: "verify", usesFields: [] },
  ],
  knowledge: `[일반공급 — 117세대]
- 대상: 공고일 현재 강릉/강원 거주 만19세 이상(또는 세대주 미성년자) 중 청약통장 순위 자격 갖춘 자. 재외동포·외국인 포함.
- 우선: 강릉시 6개월 이상 거주자. 잔여 시 강릉 6개월 미만·강원 거주자.
- 1순위: 가입 6개월 경과 + 지역·면적별 예치금 이상. ★ 2순위: 입주자저축 가입자(예치금 무관 — 1순위와 같은 6개월+예치금 규칙 적용하면 안 됨).
- 가점제·추첨제: 전용 85㎡ 이하 가점제 40% + 추첨제 60%. 가점제 낙첨자는 추첨제로 자동 전환.
- 소형·저가 특례 (일반공급만 무주택 인정): 전용 60㎡ 이하 + 공시가격 수도권 1.3억(비수도권 8천만) 이하 주택/분양권 1호 또는 1세대만 소유한 세대는 보유기간 동안 무주택으로 봄. 공시가격은 공고일에 가장 가까운 날 기준.
- 공유지분 주택도 전체 면적 기준으로 소유 판정.
- 1순위 청약 시 과거 2년내 가점제 당첨 세대는 추첨제로 접수.
- 비규제라 1주택자도 1순위 가능.
- ★ 제출서류 vs 자격검증 분리: 일반공급 제출서류 표는 신분증·인감·등본·초본·가족관계증명서. 청약통장 순위·주택소유는 자격검증 항목이나 제출서류 목록에는 별도(주택 관련은 소명 단계).
- 세대주 요건 X, 소득·자산 X.`,
};

/* ─── 레지스트리 + 라우팅 ─────────────────────────── */

export const REVIEWER_ROLES: Record<RoleId, ReviewerRole> = {
  common: COMMON,
  institution: INSTITUTION,
  multichild: MULTICHILD,
  newlywed: NEWLYWED,
  elderly: ELDERLY,
  firstlife: FIRSTLIFE,
  general: GENERAL,
};

/**
 * 공급유형 → 적용할 역할 목록.
 * 항상 common 먼저, 그 다음 공급유형별 1명.
 * 선착순·잔여세대는 자격 검증 대상 아님 → common만(또는 빈 배열).
 */
export function routeRoles(supplyType: string | undefined | null): RoleId[] {
  const supply = (supplyType || "").trim();

  // 선착순·잔여세대는 청약 자격 검증 X (계약 서류만)
  if (supply === "선착순" || supply === "잔여세대") return [];

  const roles: RoleId[] = ["common"]; // 항상 먼저

  if (/일반공급/.test(supply) || supply === "") {
    roles.push("general");
  } else if (/기관추천/.test(supply)) {
    roles.push("institution");
  } else if (/다자녀/.test(supply)) {
    roles.push("multichild");
  } else if (/신혼부부/.test(supply)) {
    roles.push("newlywed");
  } else if (/노부모/.test(supply)) {
    roles.push("elderly");
  } else if (/생애최초/.test(supply)) {
    roles.push("firstlife");
  } else {
    // 알 수 없는 특공 → 일반공급 룰로 fallback
    roles.push("general");
  }

  return roles;
}
