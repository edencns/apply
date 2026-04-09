export interface AptAnnouncement {
  id: string;
  name: string;
  shortName: string;
  location: string;
  totalUnits: number;
  generalUnits: number;
  specialUnits: number;
  moveIn: string;
  regulation: "투기과열" | "청약과열" | "비규제";
  landType: "공공택지" | "민간택지";
  priceCapApplied: boolean;
  resaleRestriction: string;
  reWinRestriction: string;
  residenceObligation: string;
  schedule: {
    announcement: string;
    specialApply: string;
    general1st: string;
    general2nd: string;
    winnerAnnounce: string;
    docSubmit: string;
    contract: string;
  };
  types: {
    name: string;
    area: number;
    units: number;
    priceRange: string;
  }[];
  region: {
    priority: string;
    other: string;
    priorityRatio?: string;
  };
  subscription: {
    period1st: string;
    deposit: { area: string; amount: string }[];
  };
  specialSupply: {
    institution: number;
    multiChild: number;
    newlywed: number;
    seniorParent: number;
    firstLife: number;
  };
  multiChildCriteria: string[];
  newlywedIncome: {
    single100: string;
    dual120: string;
    single140: string;
    dual160: string;
  };
  firstLifeIncome: {
    pct130: string;
    pct160: string;
  };
  assetLimit: string;
  generalPointSystem: {
    ratio: string;
    maxPoints: number;
    items: string[];
  };
  requiredDocs: {
    common: string[];
    multiChild: string[];
    newlywed: string[];
    seniorParent: string[];
    firstLife: string[];
    generalPoint: string[];
  };
  notes: string[];
}

export const announcements: AptAnnouncement[] = [
  {
    id: "busan",
    name: "e편한세상 범일 국제금융시티",
    shortName: "부산 국제금융",
    location: "부산광역시 동구 범일2동",
    totalUnits: 384,
    generalUnits: 192,
    specialUnits: 192,
    moveIn: "2028년 06월",
    regulation: "비규제",
    landType: "민간택지",
    priceCapApplied: false,
    resaleRestriction: "당첨발표일로부터 6개월",
    reWinRestriction: "없음",
    residenceObligation: "없음",
    schedule: {
      announcement: "2024.05.31",
      specialApply: "2024.06.10",
      general1st: "2024.06.11",
      general2nd: "2024.06.12",
      winnerAnnounce: "2024.06.19",
      docSubmit: "2024.06.23~06.26",
      contract: "2024.06.30~07.02",
    },
    types: [
      { name: "59", area: 59.97, units: 22, priceRange: "-" },
      { name: "68A", area: 68.97, units: 94, priceRange: "-" },
      { name: "68B", area: 68.91, units: 60, priceRange: "-" },
      { name: "77A", area: 77.83, units: 82, priceRange: "-" },
      { name: "77B", area: 77.89, units: 101, priceRange: "-" },
      { name: "84", area: 84.98, units: 25, priceRange: "-" },
    ],
    region: {
      priority: "부산광역시",
      other: "울산광역시, 경상남도",
    },
    subscription: {
      period1st: "6개월 이상",
      deposit: [
        { area: "85㎡ 이하", amount: "300만원 (부산)" },
        { area: "102㎡ 이하", amount: "600만원" },
        { area: "135㎡ 이하", amount: "1,000만원" },
      ],
    },
    specialSupply: {
      institution: 38,
      multiChild: 38,
      newlywed: 69,
      seniorParent: 12,
      firstLife: 35,
    },
    multiChildCriteria: [
      "만19세 미만 자녀 2명 이상 (태아·입양 포함)",
      "배점 100점: 자녀수(40) + 영유아(15) + 세대구성(5) + 무주택기간(20) + 거주기간(15) + 저축기간(5)",
    ],
    newlywedIncome: {
      single100: "~7,004,509원 (3인이하)",
      dual120: "~8,405,411원 (3인이하)",
      single140: "~9,806,313원 (3인이하)",
      dual160: "~11,207,214원 (3인이하)",
    },
    firstLifeIncome: {
      pct130: "~9,105,862원 (3인이하)",
      pct160: "~11,207,214원 (3인이하)",
    },
    assetLimit: "부동산 3억 3,100만원 이하",
    generalPointSystem: {
      ratio: "가점제 40% / 추첨제 60%",
      maxPoints: 84,
      items: ["무주택기간 (32점)", "부양가족수 (35점)", "저축가입기간 (17점)"],
    },
    requiredDocs: {
      common: [
        "신분증 (주민등록증/운전면허증)",
        "인감증명서 또는 본인서명사실확인서",
        "주민등록표등본 (전체포함, 세대원 전원)",
        "주민등록표초본 (주소변동사항 포함)",
        "가족관계증명서 (상세, 주민번호 전부공개)",
        "출입국사실증명원 (생년월일~공고일)",
        "혼인관계증명서 (상세)",
      ],
      multiChild: [
        "우선순위 배점기준표",
        "직계존속 주민등록표초본 (3세대 구성 시)",
        "한부모가족증명서 (해당 시)",
        "임신진단서/입양관계증명서 (해당 시)",
      ],
      newlywed: [
        "건강보험자격득실확인서 (19세 이상 세대원 전원)",
        "소득증빙서류 + 재직증명서",
        "혼인관계증명서 (상세)",
        "임신진단서/출생증명서 (해당 시)",
        "비사업자 확인각서 (해당 시)",
        "부동산소유현황 (자산기준 해당자)",
      ],
      seniorParent: [
        "피부양 직계존속 주민등록표초본 (3년이상 부양 입증)",
        "피부양 직계존속 출입국사실증명원",
        "피부양 직계존속 가족관계증명서",
        "가점산정기준표",
      ],
      firstLife: [
        "건강보험자격득실확인서 (19세 이상 세대원 전원)",
        "소득세 납부 입증서류 (5개년도)",
        "소득증빙서류 + 재직증명서",
        "비사업자 확인각서 (해당 시)",
        "부동산소유현황 (자산기준 해당자)",
      ],
      generalPoint: [
        "배우자 청약통장 순위확인서 (배우자 통장 합산 시)",
        "배우자 당첨사실 확인서",
      ],
    },
    notes: [
      "비규제지역 - 재당첨 제한 없음",
      "중도금 무이자 조건",
      "1인 1건 원칙 (중복 시 전부 무효)",
      "전매제한: 당첨발표일로부터 6개월",
    ],
  },
  {
    id: "okjeong",
    name: "옥정중앙역 대방 디에트르",
    shortName: "옥정 디에트르",
    location: "경기도 양주시 옥정동 (옥정지구)",
    totalUnits: 2807,
    generalUnits: 1371,
    specialUnits: 1436,
    moveIn: "2030년 06월",
    regulation: "비규제",
    landType: "공공택지",
    priceCapApplied: true,
    resaleRestriction: "당첨발표일로부터 3년",
    reWinRestriction: "10년",
    residenceObligation: "없음 (분양가 100% 이상)",
    schedule: {
      announcement: "2026.04.09",
      specialApply: "2026.04.20",
      general1st: "2026.04.21",
      general2nd: "2026.04.22",
      winnerAnnounce: "2026.04.28",
      docSubmit: "2026.04.30~05.07",
      contract: "2026.05.10~05.13",
    },
    types: [
      { name: "84A", area: 84.73, units: 1034, priceRange: "5.2~5.9억" },
      { name: "84B", area: 84.93, units: 1027, priceRange: "5.5~6.2억" },
      { name: "128A", area: 128.85, units: 368, priceRange: "8.2~9.2억" },
      { name: "128B", area: 128.64, units: 378, priceRange: "7.1~7.9억" },
    ],
    region: {
      priority: "양주시 1년 이상 거주",
      other: "경기도 6개월 이상 / 수도권 (서울·인천·경기)",
      priorityRatio: "양주시 30% / 경기도 20% / 수도권 50%",
    },
    subscription: {
      period1st: "12개월 이상",
      deposit: [
        { area: "85㎡ 이하", amount: "200만원" },
        { area: "102㎡ 이하", amount: "300만원" },
        { area: "135㎡ 이하", amount: "400만원" },
        { area: "모든 면적", amount: "500만원" },
      ],
    },
    specialSupply: {
      institution: 206,
      multiChild: 280,
      newlywed: 475,
      seniorParent: 84,
      firstLife: 391,
    },
    multiChildCriteria: [
      "만19세 미만 자녀 2명 이상 (태아·입양 포함)",
      "배점 100점: 자녀수(40) + 영유아(15) + 세대구성(5) + 무주택기간(20) + 거주기간(15) + 저축기간(5)",
    ],
    newlywedIncome: {
      single100: "~7,533,763원 (3인이하)",
      dual120: "~9,040,516원 (3인이하)",
      single140: "~10,547,268원 (3인이하)",
      dual160: "~12,054,021원 (3인이하)",
    },
    firstLifeIncome: {
      pct130: "~9,793,892원 (3인이하)",
      pct160: "~12,054,021원 (3인이하)",
    },
    assetLimit: "부동산 3억 3,100만원 이하",
    generalPointSystem: {
      ratio: "84타입: 가점 40%/추첨 60% | 128타입: 추첨 100%",
      maxPoints: 84,
      items: ["무주택기간 (32점)", "부양가족수 (35점)", "저축가입기간 (17점, 배우자 +3점)"],
    },
    requiredDocs: {
      common: [
        "신분증",
        "인감증명서 또는 본인서명사실확인서",
        "주민등록표등본 (상세)",
        "주민등록표초본 (상세)",
        "가족관계증명서 (상세)",
        "출입국사실증명원",
      ],
      multiChild: [
        "입양관계증명서 (해당 시)",
        "한부모가족증명서 (해당 시)",
        "임신진단서/출생증명서 (해당 시)",
        "기존주택 처분 관련 서약서 (해당 시)",
      ],
      newlywed: [
        "혼인관계증명서 (상세)",
        "건강보험자격득실확인서 (19세 이상 전원)",
        "소득증빙서류",
        "비사업자 확인각서 (해당 시)",
        "부동산소유현황 (소득초과 시)",
        "기존주택 처분 관련 서약서 (해당 시)",
      ],
      seniorParent: [
        "국민건강보험 요양급여 내역 (3년간)",
        "피부양 직계존속 주민등록표초본",
        "피부양 직계존속 가족관계증명서",
        "기존주택 처분 관련 서약서 (해당 시)",
      ],
      firstLife: [
        "건강보험자격득실확인서 (19세 이상 전원)",
        "소득세 납부 입증서류 (5개년도)",
        "소득증빙서류",
        "비사업자 확인각서 (해당 시)",
        "부동산소유현황 (소득초과 시)",
      ],
      generalPoint: [
        "배우자 청약통장 순위확인서 (합산 시)",
        "배우자 당첨사실 확인서",
        "국민건강보험 요양급여 내역 (직계존속 3년간)",
      ],
    },
    notes: [
      "공공택지 분양가상한제 적용",
      "전매제한 3년, 재당첨 제한 10년",
      "128타입은 신혼·생애최초 특별공급 대상 아님",
      "1주택 소유자도 1순위 추첨 가능 (비규제)",
    ],
  },
  {
    id: "raclache",
    name: "라클라체자이드파인",
    shortName: "라클라체자이",
    location: "서울특별시 동작구 노량진동",
    totalUnits: 369,
    generalUnits: 180,
    specialUnits: 189,
    moveIn: "2028년 12월",
    regulation: "투기과열",
    landType: "민간택지",
    priceCapApplied: false,
    resaleRestriction: "소유권이전등기일까지 (최대 3년)",
    reWinRestriction: "10년",
    residenceObligation: "없음",
    schedule: {
      announcement: "2026.04.03",
      specialApply: "2026.04.13",
      general1st: "2026.04.14~15",
      general2nd: "2026.04.16",
      winnerAnnounce: "2026.04.22",
      docSubmit: "2026.04.25~04.27",
      contract: "2026.05.04~05.06",
    },
    types: [
      { name: "59A", area: 59.91, units: 132, priceRange: "19.6~21.5억" },
      { name: "59B", area: 59.81, units: 9, priceRange: "19.9~21.9억" },
      { name: "59C", area: 59.95, units: 28, priceRange: "20.1~22.1억" },
      { name: "84A", area: 84.96, units: 65, priceRange: "23.9억~" },
      { name: "84B", area: 85.0, units: 91, priceRange: "22.9~25.1억" },
      { name: "84C", area: 84.97, units: 20, priceRange: "23.9~25.8억" },
      { name: "106A", area: 106.95, units: 24, priceRange: "26.9~30.1억" },
    ],
    region: {
      priority: "서울특별시 2년 이상 거주",
      other: "수도권 (경기도, 인천광역시)",
    },
    subscription: {
      period1st: "24개월 이상",
      deposit: [
        { area: "85㎡ 이하", amount: "300만원" },
        { area: "102㎡ 이하", amount: "600만원" },
        { area: "135㎡ 이하", amount: "1,000만원" },
        { area: "모든 면적", amount: "1,500만원" },
      ],
    },
    specialSupply: {
      institution: 31,
      multiChild: 37,
      newlywed: 79,
      seniorParent: 11,
      firstLife: 31,
    },
    multiChildCriteria: [
      "만19세 미만 자녀 2명 이상 (태아·입양 포함)",
      "배점 100점: 자녀수(40) + 영유아(15) + 세대구성(5) + 무주택기간(20) + 거주기간(15) + 저축기간(5)",
    ],
    newlywedIncome: {
      single100: "~7,533,763원 (3인이하)",
      dual120: "~9,040,516원 (3인이하)",
      single140: "~10,547,268원 (3인이하)",
      dual160: "~12,054,021원 (3인이하)",
    },
    firstLifeIncome: {
      pct130: "~9,793,892원 (3인이하)",
      pct160: "~12,054,021원 (3인이하)",
    },
    assetLimit: "부동산 3억 3,100만원 이하",
    generalPointSystem: {
      ratio: "60㎡이하: 40/60 | 60~85㎡: 70/30 | 85㎡초과: 80/20",
      maxPoints: 84,
      items: ["무주택기간 (32점)", "부양가족수 (35점)", "저축가입기간 (17점, 배우자 +3점)"],
    },
    requiredDocs: {
      common: [
        "신분증",
        "인감증명서 또는 본인서명사실확인서",
        "주민등록표등본 (전체포함)",
        "주민등록표초본 (전체포함)",
        "가족관계증명서 (상세)",
        "혼인관계증명서 (상세)",
        "출입국사실증명원 (생년월일~공고일)",
      ],
      multiChild: [
        "임신진단서/출산증명서 (해당 시)",
        "임신증명 및 출산이행확인각서",
        "입양관계증명서 (해당 시)",
        "한부모가족증명서 (해당 시)",
        "기존주택 처분 관련 서약서 (출산특례 시)",
      ],
      newlywed: [
        "건강보험자격득실확인서 (19세 이상 전원)",
        "소득증빙서류",
        "부동산소유현황 (자산기준 시)",
        "기존주택 처분 관련 서약서 (해당 시)",
      ],
      seniorParent: [
        "직계존속 주민등록표초본 (3년 이상)",
        "직계존속 가족관계증명서",
        "국민건강보험 요양급여 내역 (3년간)",
      ],
      firstLife: [
        "건강보험자격득실확인서 (19세 이상 전원)",
        "소득세 납부 입증서류 (5개년도)",
        "소득증빙서류",
        "부동산소유현황 (자산기준 시)",
      ],
      generalPoint: [
        "배우자 청약통장 순위확인서",
        "배우자 당첨사실 확인서",
        "직계존속 국민건강보험 요양급여 내역 (3년간)",
      ],
    },
    notes: [
      "투기과열지구 + 토지거래허가구역 (동작구)",
      "1순위: 세대주 + 과거 5년 내 당첨 세대원 아닐 것",
      "1주택 이상 소유 세대 가점제 불가",
      "전매 시 토지거래허가 필요",
      "분양가 19.6~30.1억 (고가 단지)",
    ],
  },
  {
    id: "upseong",
    name: "업성 푸르지오 레이크시티",
    shortName: "업성 푸르지오",
    location: "충남 천안시 서북구 업성동",
    totalUnits: 1460,
    generalUnits: 806,
    specialUnits: 654,
    moveIn: "2029년 09월",
    regulation: "비규제",
    landType: "민간택지",
    priceCapApplied: false,
    resaleRestriction: "없음",
    reWinRestriction: "없음",
    residenceObligation: "없음",
    schedule: {
      announcement: "2026.04.03",
      specialApply: "2026.04.13",
      general1st: "2026.04.14",
      general2nd: "2026.04.15",
      winnerAnnounce: "2026.04.22",
      docSubmit: "2026.04.24~04.30",
      contract: "2026.05.04~05.07",
    },
    types: [
      { name: "72A", area: 72.76, units: 484, priceRange: "4.6~5.1억" },
      { name: "72B", area: 72.85, units: 189, priceRange: "-" },
      { name: "84A", area: 84.96, units: 184, priceRange: "5.2~5.7억" },
      { name: "84C", area: 84.98, units: 113, priceRange: "-" },
      { name: "95A", area: 95.79, units: 227, priceRange: "6.6~7.7억" },
      { name: "95B", area: 95.79, units: 75, priceRange: "-" },
    ],
    region: {
      priority: "천안시",
      other: "충청남도, 대전광역시, 세종특별자치시",
    },
    subscription: {
      period1st: "6개월 이상",
      deposit: [
        { area: "85㎡ 이하", amount: "200만원" },
        { area: "102㎡ 이하", amount: "300만원" },
        { area: "135㎡ 이하", amount: "400만원" },
        { area: "모든 면적", amount: "500만원" },
      ],
    },
    specialSupply: {
      institution: 111,
      multiChild: 140,
      newlywed: 262,
      seniorParent: 40,
      firstLife: 101,
    },
    multiChildCriteria: [
      "만19세 미만 자녀 2명 이상 (태아·입양 포함)",
      "배점 100점 동일 기준",
    ],
    newlywedIncome: {
      single100: "~7,533,763원 (3인이하)",
      dual120: "~9,040,516원 (3인이하)",
      single140: "~10,547,268원 (3인이하)",
      dual160: "~12,054,021원 (3인이하)",
    },
    firstLifeIncome: {
      pct130: "~9,793,892원 (3인이하)",
      pct160: "~12,054,021원 (3인이하)",
    },
    assetLimit: "부동산 3억 3,100만원 이하",
    generalPointSystem: {
      ratio: "72·84타입: 가점 40%/추첨 60% | 95타입: 추첨 100%",
      maxPoints: 84,
      items: ["무주택기간 (32점)", "부양가족수 (35점)", "저축가입기간 (17점, 배우자 +3점)"],
    },
    requiredDocs: {
      common: [
        "신분증",
        "인감증명서 또는 본인서명사실확인서",
        "주민등록표등본 (상세)",
        "주민등록표초본 (상세)",
        "혼인관계증명서 (상세)",
        "출입국사실증명원",
      ],
      multiChild: [
        "다자녀 배점기준표",
        "가족관계증명서 (상세)",
        "한부모가족증명서 (해당 시)",
        "임신진단서/입양관계증명서 (해당 시)",
      ],
      newlywed: [
        "건강보험자격득실확인서 (19세 이상 전원)",
        "소득증빙서류",
        "비사업자 확인각서 (해당 시)",
        "부동산소유현황 (추첨 신청자)",
        "임신진단서/출생증명서 (해당 시)",
      ],
      seniorParent: [
        "피부양 직계존속 주민등록표초본",
        "피부양 직계존속 가족관계증명서 (상세)",
        "피부양 직계존속 출입국사실증명원",
        "국민건강보험 요양급여 내역 (3년간)",
      ],
      firstLife: [
        "소득세 납부 입증서류 (5개년도)",
        "건강보험자격득실확인서 (19세 이상 전원)",
        "소득증빙서류",
        "비사업자 확인각서 (해당 시)",
        "부동산소유현황 (추첨 신청자)",
      ],
      generalPoint: [
        "배우자 청약통장 순위확인서 (합산 시)",
        "배우자 당첨사실 확인서",
      ],
    },
    notes: [
      "비규제지역 - 전매/재당첨 제한 없음",
      "95타입은 신혼·생애최초 특별공급 미적용",
      "계약금 5% (1차 1,000만원 정액)",
      "정정공고 (2026.04.07 / 2026.04.09)",
    ],
  },
  {
    id: "rene",
    name: "르네오션 고성 퍼스트뷰",
    shortName: "고성 퍼스트뷰",
    location: "강원특별자치도 고성군 토성면",
    totalUnits: 263,
    generalUnits: 147,
    specialUnits: 116,
    moveIn: "2029년 03월",
    regulation: "비규제",
    landType: "민간택지",
    priceCapApplied: false,
    resaleRestriction: "없음",
    reWinRestriction: "없음",
    residenceObligation: "없음",
    schedule: {
      announcement: "2026.04.03",
      specialApply: "2026.04.13",
      general1st: "2026.04.14",
      general2nd: "2026.04.15",
      winnerAnnounce: "2026.04.21",
      docSubmit: "2026.04.24~05.03",
      contract: "2026.05.06~05.08",
    },
    types: [
      { name: "74", area: 74.83, units: 28, priceRange: "~4.5억" },
      { name: "84A", area: 84.98, units: 34, priceRange: "~4.8억" },
      { name: "84B", area: 84.98, units: 149, priceRange: "~4.8억" },
      { name: "109", area: 109.83, units: 26, priceRange: "~6.5억" },
      { name: "117~183", area: 117, units: 9, priceRange: "16.7~23.5억 (펜트)" },
    ],
    region: {
      priority: "고성군",
      other: "강원특별자치도",
    },
    subscription: {
      period1st: "6개월 이상",
      deposit: [
        { area: "85㎡ 이하", amount: "200만원" },
        { area: "102㎡ 이하", amount: "300만원" },
        { area: "135㎡ 이하", amount: "400만원" },
        { area: "모든 면적", amount: "500만원" },
      ],
    },
    specialSupply: {
      institution: 20,
      multiChild: 22,
      newlywed: 50,
      seniorParent: 5,
      firstLife: 19,
    },
    multiChildCriteria: [
      "만19세 미만 자녀 2명 이상 (태아·입양 포함)",
      "배점 100점 동일 기준",
    ],
    newlywedIncome: {
      single100: "~7,533,763원 (3인이하)",
      dual120: "~9,040,516원 (3인이하)",
      single140: "~10,547,268원 (3인이하)",
      dual160: "~12,054,021원 (3인이하)",
    },
    firstLifeIncome: {
      pct130: "~9,793,892원 (3인이하)",
      pct160: "~12,054,021원 (3인이하)",
    },
    assetLimit: "부동산 3억 3,100만원 이하",
    generalPointSystem: {
      ratio: "84㎡이하: 가점 40%/추첨 60% | 85㎡초과: 추첨 100%",
      maxPoints: 84,
      items: ["무주택기간 (32점)", "부양가족수 (35점)", "저축가입기간 (17점, 배우자 +3점)"],
    },
    requiredDocs: {
      common: [
        "신분증",
        "인감증명서 또는 본인서명사실확인서",
        "주민등록표등본 (전체포함)",
        "주민등록표초본 (전체포함)",
        "가족관계증명서 (상세)",
        "혼인관계증명서 (상세)",
        "출입국사실증명원",
      ],
      multiChild: [
        "배점기준표",
        "직계존속 주민등록표초본 (3세대 구성 시)",
        "한부모가족증명서 (해당 시)",
        "임신진단서/입양관계증명서 (해당 시)",
      ],
      newlywed: [
        "건강보험자격득실확인서",
        "소득증빙서류 (19세 이상 전원)",
        "부동산소유현황 (추첨 신청자)",
        "임신진단서 (해당 시)",
      ],
      seniorParent: [
        "가점산정기준표",
        "피부양 직계존속 주민등록표초본 (3년 이상)",
        "피부양 직계존속 가족관계증명서 (상세)",
        "피부양 직계존속 출입국사실증명원",
        "국민건강보험 요양급여 내역 (3년간)",
      ],
      firstLife: [
        "소득세 납부 입증서류 (5개년도)",
        "건강보험자격득실확인서",
        "소득증빙서류",
        "부동산소유현황 (해당 시)",
      ],
      generalPoint: [
        "배우자 청약통장 순위확인서 (합산 시)",
        "배우자 당첨사실 확인서",
      ],
    },
    notes: [
      "비규제지역 - 전매/재당첨 제한 없음",
      "펜트하우스 (117~183㎡): 16.7~23.5억",
      "계약금 5%, 중도금 60%, 잔금 35%",
      "견본주택: 속초시 조양동",
    ],
  },
  {
    id: "jeonju",
    name: "북전주 광신프로그레스",
    shortName: "북전주 광신",
    location: "전북특별자치도 전주시 덕진구",
    totalUnits: 352,
    generalUnits: 163,
    specialUnits: 189,
    moveIn: "2028년 02월",
    regulation: "비규제",
    landType: "민간택지",
    priceCapApplied: false,
    resaleRestriction: "없음",
    reWinRestriction: "없음",
    residenceObligation: "없음",
    schedule: {
      announcement: "2026.04.03",
      specialApply: "2026.04.13",
      general1st: "2026.04.14",
      general2nd: "2026.04.15",
      winnerAnnounce: "2026.04.22",
      docSubmit: "2026.04.23~04.30",
      contract: "2026.05.06~05.08",
    },
    types: [
      { name: "84A", area: 84.54, units: 315, priceRange: "4.3~4.5억" },
      { name: "84B", area: 84.0, units: 37, priceRange: "4.3~4.5억" },
    ],
    region: {
      priority: "전주시 1년 이상 거주",
      other: "전북특별자치도",
    },
    subscription: {
      period1st: "6개월 이상",
      deposit: [
        { area: "85㎡ 이하", amount: "200만원" },
        { area: "102㎡ 이하", amount: "300만원" },
      ],
    },
    specialSupply: {
      institution: 34,
      multiChild: 34,
      newlywed: 80,
      seniorParent: 10,
      firstLife: 31,
    },
    multiChildCriteria: [
      "만19세 미만 자녀 2명 이상 (태아·입양 포함)",
      "배점 100점 동일 기준",
    ],
    newlywedIncome: {
      single100: "~7,533,763원 (3인이하)",
      dual120: "~9,040,516원 (3인이하)",
      single140: "~10,547,268원 (3인이하)",
      dual160: "~12,054,021원 (3인이하)",
    },
    firstLifeIncome: {
      pct130: "~9,793,892원 (3인이하)",
      pct160: "~12,054,021원 (3인이하)",
    },
    assetLimit: "부동산 3억 3,100만원 이하",
    generalPointSystem: {
      ratio: "가점제 40% / 추첨제 60%",
      maxPoints: 84,
      items: ["무주택기간 (32점)", "부양가족수 (35점)", "저축가입기간 (17점, 배우자 +3점)"],
    },
    requiredDocs: {
      common: [
        "신분증",
        "인감증명서 또는 본인서명사실확인서",
        "주민등록표등본 (전체포함)",
        "주민등록표초본 (전체포함)",
        "가족관계증명서 (상세)",
        "혼인관계증명서 (상세)",
        "출입국사실증명원",
      ],
      multiChild: [
        "배점기준표",
        "한부모가족증명서 (해당 시)",
        "임신진단서/입양관계증명서 (해당 시)",
        "배우자 가족관계증명서 (재혼가정 시)",
      ],
      newlywed: [
        "건강보험자격득실확인서 (19세 이상 전원)",
        "소득증빙서류",
        "비사업자 확인각서 (해당 시)",
        "부동산소유현황 (추첨 신청자)",
        "임신진단서/입양관계증명서 (해당 시)",
      ],
      seniorParent: [
        "가점산정기준표",
        "피부양 직계존속 주민등록표초본 (3년 이상)",
        "국민건강보험 요양급여 내역 (3년간)",
        "피부양 직계존속 가족관계증명서 (상세)",
        "출입국사실증명원 (직계존속)",
      ],
      firstLife: [
        "소득세 납부 입증서류 (5개년도)",
        "건강보험자격득실확인서 (19세 이상 전원)",
        "소득증빙서류",
        "비사업자 확인각서 (해당 시)",
        "부동산소유현황 (추첨 신청자)",
      ],
      generalPoint: [
        "배우자 청약통장 순위확인서 (합산 시)",
        "배우자 당첨사실 확인서",
      ],
    },
    notes: [
      "비규제지역 - 전매/재당첨 제한 없음",
      "전 타입 84㎡ (84A 315세대 + 84B 37세대)",
      "계약금 10% (1차 1,000만원 정액 + 잔여)",
      "분양가 4.3~4.5억 (합리적 가격대)",
    ],
  },
];
