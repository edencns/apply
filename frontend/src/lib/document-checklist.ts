/**
 * 공급유형별 필요서류 체크리스트
 * 공고문 PDF에서 파싱된 서류 목록이 있으면 사용, 없으면 표준 규칙 기반 기본값
 */

import type { RequiredDocumentChecklist, DocumentItem, ConditionalDocumentItem } from './verification-engine';

// ============ 표준 서류 기본값 ============
// 주택공급에 관한 규칙 기반 공통 + 유형별 서류 매핑

const COMMON_DOCUMENTS: DocumentItem[] = [
  { name: '주민등록등본', description: '세대원 성명, 주민번호, 세대구성사유 및 일자, 세대주 및 관계 등 "전체 포함" 발급' },
  { name: '주민등록초본', description: '주민번호, 과거 주소변동사항, 세대주 및 관계 등 "전체 포함" 발급' },
  { name: '혼인관계증명서', description: '성명 및 주민등록번호 포함 "상세"로 발급' },
  { name: '출입국사실증명원', description: '주민등록번호 전체표시, 생년월일~공고일까지, 출입국기록 "Y"로 발급' },
  { name: '인감증명서 또는 본인서명사실확인서', description: '용도: 주택공급신청(계약)용, 본인 발급용' },
  { name: '신분증', description: '주민등록증, 운전면허증 또는 여권 (모바일 신분증 불가)' },
  { name: '개인정보 수집 및 이용동의서', description: '견본주택에 비치' },
];

const SUPPLY_TYPE_DOCUMENTS: Record<string, {
  required: DocumentItem[];
  conditional: ConditionalDocumentItem[];
}> = {
  '일반공급': {
    required: [],
    conditional: [
      { name: '배우자 순위확인서', condition: '가점제 청약 시 배우자 통장 가입기간 점수 합산한 경우', description: '청약홈 > 청약자격확인 > 순위확인서 발급' },
      { name: '배우자 당첨사실확인서', condition: '가점제 청약 시 배우자 통장 가입기간 점수 합산한 경우', description: '청약홈 > 청약소통방 > APT당첨사실 조회' },
      { name: '국민건강보험 요양급여 내역', condition: '가점제 피부양 직계존비속 부양가족 인정 시', description: '직계존속: 3년간, 직계비속(30세 이상): 1년간 내역' },
    ],
  },
  '신혼부부': {
    required: [
      { name: '건강보험자격득실 확인서', description: '본인 및 만19세 이상 세대원 전원, 과거 변동사항 전부 표기' },
      { name: '소득증빙서류', description: '본인 및 만19세 이상 세대원 전원 (배우자 분리세대 포함)' },
    ],
    conditional: [
      { name: '비사업자 확인각서', condition: '근로자 및 자영업자가 아닌 경우', description: '견본주택에 비치' },
      { name: '임신진단서 또는 출산증명서', condition: '임신한 태아를 자녀수에 포함한 경우', description: '의료기관 발행, 담당의사명·면허번호·출산예정일 기재' },
      { name: '입양관계증명서', condition: '입양한 자녀를 자녀 수에 포함한 경우', description: '입양관계증명서 또는 친양자입양관계증명서' },
      { name: '부동산 소유현황', condition: '소득 초과 + 부동산가액 기준으로 신청한 경우', description: '대법원 인터넷등기소, 주민등록번호 공개 체크' },
      { name: '가족관계증명서', condition: '재혼가정 자녀 포함 또는 혼인신고일 전 자녀 출산 시', description: '"상세"로 발급' },
      { name: '직계존속 주민등록초본', condition: '직계존속을 소득 산정 가구원수에 포함하는 경우', description: '1년 이상 동일 등본 등재 확인, "전체 포함" 발급' },
    ],
  },
  '생애최초': {
    required: [
      { name: '소득세 납부 입증 서류', description: '입주자모집공고일 이전 5개년도 소득세 납부 증빙 (근로소득원천징수영수증 등)' },
      { name: '건강보험자격득실 확인서', description: '본인 및 만19세 이상 세대원 전원' },
      { name: '소득증빙서류', description: '본인 및 만19세 이상 세대원 전원 (배우자 분리세대 포함)' },
    ],
    conditional: [
      { name: '비사업자 확인각서', condition: '근로자 및 자영업자가 아닌 경우', description: '견본주택에 비치' },
      { name: '임신진단서 또는 출산증명서', condition: '임신한 태아를 자녀수에 포함한 경우', description: '의료기관 발행' },
      { name: '부동산 소유현황', condition: '소득 초과 + 부동산가액 기준으로 신청한 경우', description: '대법원 인터넷등기소' },
      { name: '직계존속 주민등록초본', condition: '직계존속을 소득 산정 가구원수에 포함하는 경우', description: '1년 이상 동일 등본 등재 확인' },
      { name: '피부양 직계비속 혼인관계증명서', condition: '만18세 이상 미혼 자녀를 인정받는 경우', description: '"상세"로 발급' },
    ],
  },
  '다자녀가구': {
    required: [
      { name: '다자녀 배점 기준표', description: '견본주택에 비치' },
    ],
    conditional: [
      { name: '가족관계증명서', condition: '배우자 직계존속 포함 3세대 또는 재혼가정 자녀 포함 시', description: '배우자 기준, "상세"로 발급' },
      { name: '한부모가족증명서', condition: '한부모 가족으로 5년 경과한 경우', description: '성평등가족부 장관 확인' },
      { name: '임신진단서 또는 출산증명서', condition: '임신한 태아를 자녀수에 포함한 경우', description: '의료기관 발행' },
      { name: '입양관계증명서', condition: '입양한 자녀를 자녀 수에 포함한 경우', description: '' },
      { name: '피부양 직계비속 혼인관계증명서', condition: '만18세 이상 미혼 자녀를 부양가족으로 인정받는 경우', description: '"상세"로 발급' },
      { name: '피부양 직계존속 주민등록초본', condition: '3세대 구성 배점을 인정받으나 3년 동거 미확인 시', description: '3년 이상 주소변동사항, "전체 포함" 발급' },
    ],
  },
  '노부모부양': {
    required: [
      { name: '청약 가점내용 확인서', description: '견본주택에 비치' },
    ],
    conditional: [
      { name: '직계존속 주민등록초본', condition: '3년 이상 동일 등본 등재 미확인 시', description: '3년 이상 주소변동사항, "전체 포함" 발급' },
      { name: '가족관계증명서', condition: '직계존속과의 관계 미확인 또는 배우자와 세대 분리 시', description: '"상세"로 발급' },
      { name: '직계존속 출입국사실증명원', condition: '부양기간 내 해외거주기간 확인', description: '3년 이내 90일 초과 해외 체류 시 신청 불가' },
      { name: '국민건강보험 요양급여 내역', condition: '피부양 직계존속 부양가족 인정 시', description: '3년간 내역, 국민건강보험공단 방문 발급' },
      { name: '재혼배우자 가족관계증명서', condition: '재혼배우자 자녀를 부양가족으로 산정한 경우', description: '"상세"로 발급' },
      { name: '피부양 직계비속 혼인관계증명서', condition: '만18세 이상 미혼 직계비속을 부양가족으로 인정받는 경우', description: '"상세"로 발급' },
    ],
  },
  '기관추천': {
    required: [
      { name: '해당 기관장의 추천서', description: '인터넷 청약(청약Home) 청약한 경우 생략 가능' },
    ],
    conditional: [],
  },
};

// ============ 공개 함수 ============

export interface ChecklistItem {
  name: string;
  description: string;
  type: 'required' | 'conditional';
  condition?: string;
  submitted: boolean;
}

/**
 * 공급유형에 맞는 필요서류 체크리스트 반환
 * @param supplyType 공급유형 (일반공급, 신혼부부, 생애최초, ...)
 * @param submittedDocs 이미 제출된 서류 목록
 * @param parsedChecklist 공고문에서 파싱된 서류 목록 (있으면 우선 사용)
 */
export function getDocumentChecklist(
  supplyType: string,
  submittedDocs: string[],
  parsedChecklist?: RequiredDocumentChecklist,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  // 공통 서류
  const commonDocs = parsedChecklist?.common?.length
    ? parsedChecklist.common
    : COMMON_DOCUMENTS;

  for (const doc of commonDocs) {
    items.push({
      name: doc.name,
      description: doc.description,
      type: 'required',
      submitted: isDocSubmitted(doc.name, submittedDocs),
    });
  }

  // 유형별 서류
  const typeSpecific = parsedChecklist?.perSupplyType?.[supplyType]
    || SUPPLY_TYPE_DOCUMENTS[supplyType]
    || SUPPLY_TYPE_DOCUMENTS['일반공급'];

  if (typeSpecific) {
    for (const doc of typeSpecific.required || []) {
      items.push({
        name: doc.name,
        description: doc.description,
        type: 'required',
        submitted: isDocSubmitted(doc.name, submittedDocs),
      });
    }

    for (const doc of typeSpecific.conditional || []) {
      items.push({
        name: doc.name,
        description: doc.description,
        type: 'conditional',
        condition: (doc as ConditionalDocumentItem).condition,
        submitted: isDocSubmitted(doc.name, submittedDocs),
      });
    }
  }

  return items;
}

/** 서류가 제출되었는지 퍼지 매칭 */
function isDocSubmitted(docName: string, submittedDocs: string[]): boolean {
  const normalizedName = docName.replace(/\s+/g, '');
  return submittedDocs.some(d => {
    const normalizedSubmitted = d.replace(/\s+/g, '');
    return normalizedSubmitted.includes(normalizedName) ||
      normalizedName.includes(normalizedSubmitted) ||
      // 부분 매칭: 주요 키워드
      getDocKeywords(docName).some(kw => d.includes(kw));
  });
}

/** 서류명에서 핵심 키워드 추출 */
function getDocKeywords(name: string): string[] {
  const keywordMap: Record<string, string[]> = {
    '주민등록등본': ['등본'],
    '주민등록초본': ['초본'],
    '가족관계증명서': ['가족관계'],
    '혼인관계증명서': ['혼인관계'],
    '건강보험자격득실': ['건강보험', '자격득실'],
    '소득증빙서류': ['소득증빙', '원천징수'],
    '소득세 납부': ['소득세', '납세'],
    '임신진단서': ['임신', '출산'],
    '청약통장확인서': ['청약통장', '납입확인'],
    '등기사항전부증명서': ['등기사항', '등기부'],
    '부동산 소유현황': ['부동산소유'],
    '인감증명서': ['인감'],
    '본인서명사실확인서': ['본인서명'],
    '출입국사실증명원': ['출입국'],
    '입양관계증명서': ['입양'],
    '한부모가족증명서': ['한부모'],
    '배우자 순위확인서': ['순위확인'],
    '당첨사실확인서': ['당첨사실'],
    '국민건강보험 요양급여': ['요양급여'],
    '비사업자 확인각서': ['비사업자'],
    '해당 기관장의 추천서': ['추천서'],
  };

  for (const [key, keywords] of Object.entries(keywordMap)) {
    if (name.includes(key)) return keywords;
  }
  return [name.slice(0, 4)]; // 앞 4글자 폴백
}

/** 체크리스트 요약 통계 */
export function getChecklistSummary(items: ChecklistItem[]): {
  total: number;
  submitted: number;
  missing: number;
  requiredMissing: number;
  conditionalMissing: number;
} {
  const total = items.length;
  const submitted = items.filter(i => i.submitted).length;
  const missing = total - submitted;
  const requiredMissing = items.filter(i => i.type === 'required' && !i.submitted).length;
  const conditionalMissing = items.filter(i => i.type === 'conditional' && !i.submitted).length;
  return { total, submitted, missing, requiredMissing, conditionalMissing };
}
