/**
 * 공급유형별 필요 서류 체크리스트
 *
 * 공고 PDF에서 파싱된 서류 목록이 있으면 우선 사용하고,
 * 없으면 이 기본 매핑을 적용합니다.
 */

/** 공통 제출서류 (모든 유형 공통) */
export const COMMON_DOCUMENTS = [
  '주민등록등본 (세대원 전원, 주민등록번호 뒷자리 포함)',
  '주민등록초본 (주소변동사항 전체, 주민등록번호 뒷자리 포함)',
  '가족관계증명서 (상세)',
  '혼인관계증명서 (상세)',
  '출입국사실증명서 (세대원 전원)',
  '인감증명서 또는 본인서명사실확인서',
  '주택소유여부 확인 동의서',
  '개인정보 수집·이용 동의서',
];

/** 공급유형별 추가 필요서류 */
export const SUPPLY_TYPE_DOCUMENTS: Record<string, string[]> = {
  '신혼부부': [
    '혼인관계증명서 (상세)',
    '건강보험자격득실확인서 (부부 각각)',
    '소득증빙서류 (근로소득원천징수영수증 등)',
    '건강보험료 납부확인서 (최근 6개월)',
    '비사업자확인각서 (해당 시)',
    '임신진단서 (임신 중인 경우)',
    '출생증명서 (2세 이내 자녀)',
  ],
  '생애최초': [
    '소득세 납세증명서 (5년간)',
    '건강보험자격득실확인서',
    '건강보험료 납부확인서 (최근 6개월)',
    '소득증빙서류 (근로소득원천징수영수증, 소득금액증명원 등)',
    '주택 소유 이력 확인서',
    '혼인관계증명서 (기혼자)',
  ],
  '다자녀가구': [
    '가족관계증명서 (상세, 자녀 확인)',
    '미성년 자녀 주민등록등본',
    '한부모가족증명서 (해당 시)',
    '입양관계증명서 (해당 시)',
  ],
  '노부모부양': [
    '직계존속 주민등록초본 (3년 이상 계속 거주 확인)',
    '직계존속 가족관계증명서',
    '직계존속 출입국사실증명서',
    '건강보험 피부양자 확인서 또는 요양급여내역',
  ],
  '기관추천': [
    '기관추천서 (해당 기관 발급)',
    '자격확인서 (해당 기관)',
  ],
  '신생아': [
    '출생증명서 또는 자녀 기본증명서',
    '혼인관계증명서 (상세)',
    '건강보험자격득실확인서',
    '소득증빙서류',
    '건강보험료 납부확인서 (최근 6개월)',
    '임신진단서 (임신 중인 경우)',
  ],
  '일반공급': [
    '청약통장 가입확인서',
    '배우자 청약 당첨사실 확인서 (가점제)',
    '무주택기간 확인 서류',
  ],
};

/**
 * 공급유형에 필요한 전체 서류 목록을 반환합니다.
 *
 * @param supplyType - 공급유형명 (예: "신혼부부")
 * @param announcementDocs - 공고에서 파싱된 서류 목록 (있으면 우선 사용)
 * @returns 공통 + 유형별 서류 목록
 */
export function getRequiredDocuments(
  supplyType: string,
  announcementDocs?: Record<string, string[]> | null
): { common: string[]; typeSpecific: string[]; all: string[] } {
  // 1) 공고에서 파싱된 목록이 있으면 우선 사용
  const parsedCommon = announcementDocs?.['공통'] ?? null;
  const parsedType = announcementDocs?.[supplyType] ?? null;

  const common = parsedCommon && parsedCommon.length >= 3
    ? parsedCommon
    : COMMON_DOCUMENTS;

  const typeSpecific = parsedType && parsedType.length >= 2
    ? parsedType
    : SUPPLY_TYPE_DOCUMENTS[supplyType] ?? [];

  // 중복 제거
  const allSet = new Set([...common, ...typeSpecific]);
  return {
    common,
    typeSpecific,
    all: Array.from(allSet),
  };
}

/**
 * 모든 공급유형에 대해 필요 서류를 일괄 반환합니다.
 */
export function getAllRequiredDocuments(
  supplyTypes: string[],
  announcementDocs?: Record<string, string[]> | null
): Record<string, { common: string[]; typeSpecific: string[]; all: string[] }> {
  const result: Record<string, ReturnType<typeof getRequiredDocuments>> = {};
  for (const type of supplyTypes) {
    result[type] = getRequiredDocuments(type, announcementDocs);
  }
  return result;
}

/** 서류 제출 상태 */
export type DocumentStatus = 'submitted' | 'missing' | 'conditional';

export interface DocumentCheckItem {
  name: string;
  status: DocumentStatus;
  category: 'common' | 'type_specific';
  note?: string;
}

/**
 * 제출된 서류 목록과 필요 서류를 대조하여 체크리스트를 생성합니다.
 */
export function checkDocuments(
  supplyType: string,
  submittedDocNames: string[],
  announcementDocs?: Record<string, string[]> | null
): DocumentCheckItem[] {
  const { common, typeSpecific } = getRequiredDocuments(supplyType, announcementDocs);
  const submitted = new Set(submittedDocNames.map(n => n.trim()));

  function match(required: string): boolean {
    // 정확한 매칭 또는 부분 매칭
    if (submitted.has(required)) return true;
    const shortName = required.split('(')[0].trim();
    const submittedArr = Array.from(submitted);
    for (const s of submittedArr) {
      if (s.includes(shortName) || shortName.includes(s)) return true;
    }
    return false;
  }

  const result: DocumentCheckItem[] = [];

  for (const doc of common) {
    result.push({
      name: doc,
      status: match(doc) ? 'submitted' : 'missing',
      category: 'common',
    });
  }

  for (const doc of typeSpecific) {
    const isConditional = doc.includes('해당 시') || doc.includes('해당자');
    result.push({
      name: doc,
      status: match(doc) ? 'submitted' : isConditional ? 'conditional' : 'missing',
      category: 'type_specific',
      note: isConditional ? '해당자만 제출' : undefined,
    });
  }

  return result;
}
