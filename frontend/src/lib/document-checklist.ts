/**
 * 공급유형별 필요 서류 체크리스트
 *
 * 공고 PDF에서 파싱된 서류 목록이 있으면 우선 사용하고,
 * 없으면 이 기본 매핑을 적용합니다.
 */

/**
 * 청약홈에서 청약 신청 시 자동으로 검증·생략되는 서류 목록.
 *
 * 전산추첨결과 엑셀로 등록된 당첨자(청약홈 신청)는 이 서류들을 제출하지 않아도 됩니다.
 * 미달 등의 사유로 담당자가 직접 추가 등록한 당첨자(추가 당첨자 등록)는
 * 청약홈을 거치지 않았으므로 별도 제출·검수 필요.
 */
export const APPLYHOME_AUTO_VERIFIED_DOCUMENTS = [
  '특별공급신청서, 무주택 서약서',
  '청약통장 순위(가입)확인서',
];

/**
 * 공통 제출서류 (모든 유형 공통).
 *
 * 공고 표 「공통서류」 컬럼 구분:
 *   필수 ─ 본인 발급 9종 (입주자모집공고 표준 양식 기준)
 *   추가(해당자) ─ "(해당 시 — 조건)"으로 표기. parseDocumentName이 "해당 시"를
 *     인식해 conditional 플래그를 자동으로 켭니다.
 */
export const COMMON_DOCUMENTS = [
  // ─── 필수 ───
  '특별공급신청서, 무주택 서약서',
  '인감증명서 또는 본인서명사실확인서',
  '신분증',
  '청약통장 순위(가입)확인서',
  '개인정보 수집·이용 동의서',
  '주민등록등본 (상세, 본인)',
  '주민등록초본 (상세, 본인)',
  '가족관계증명서 (상세, 본인)',
  '출입국사실증명원 (본인)',
  // ─── 추가(해당자) ───
  '혼인관계증명서 (해당 시 — 단독세대 또는 만30세 이전 혼인 인정받고자 하는 경우)',
  '배우자 주민등록등본 (해당 시 — 배우자 분리세대인 경우)',
  '배우자·직계존비속 출입국사실증명원 (해당 시 — 해외체류 등으로 부양가족 인정받고자 하는 경우)',
];

/**
 * 공급유형별 추가 필요서류.
 * 공통서류 외에 각 유형 신청자만 추가 제출하는 항목.
 *   "(해당 시 — 조건)" 표기는 추가(해당자)로 자동 분류됩니다.
 */
export const SUPPLY_TYPE_DOCUMENTS: Record<string, string[]> = {
  '신혼부부': [
    // 필수
    '신혼부부 특별공급 우선순위 배점 기준표 (본인)',
    '혼인관계증명서 (상세, 본인)',
    '건강보험자격득실확인서 (부부 각각)',
    '소득증빙서류 (근로소득원천징수영수증 등)',
    '건강보험료 납부확인서 (최근 6개월)',
    // 추가(해당자)
    '임신진단서 (해당 시 — 임신 중인 경우)',
    '출생증명서 (해당 시 — 2세 이내 자녀)',
    '입양관계증명서 (해당 시 — 입양한 자녀가 있는 경우)',
    '한부모가족증명서 (해당 시 — 한부모가족 5년 경과)',
  ],
  '생애최초': [
    // 필수
    '소득세 납세증명서 (5년간)',
    '건강보험자격득실확인서',
    '건강보험료 납부확인서 (최근 6개월)',
    '소득증빙서류 (근로소득원천징수영수증, 소득금액증명원 등)',
    '주택 소유 이력 확인서',
    // 추가(해당자)
    '혼인관계증명서 (해당 시 — 기혼자)',
  ],
  '다자녀가구': [
    // 필수
    '다자녀 특별공급 우선순위 배점 기준표 (본인)',
    // 추가(해당자) — 공고 표 「다자녀가구」 추가서류
    '혼인관계증명서 (해당 시 — 만30세 이전 혼인 인정받고자 하는 경우)',
    '한부모가족증명서 (해당 시 — 한부모가족 지원법 5년 경과)',
    '임신증명서류 또는 출산증명서 (해당 시 — 임신 중인 경우)',
    '입양관계증명서 또는 친양자 입양관계 증명서 (해당 시 — 입양의 경우)',
    '임신증명 및 출산이행 확인각서 (해당 시 — 임신 제증명서류와 함께 제출)',
    '재혼 배우자 자녀 가족관계증명서 (해당 시 — 재혼 배우자 자녀 인정)',
    '자녀 주민등록등본 (해당 시 — 자녀 일부가 본인 등본에 미등재)',
    '미성년자녀 혼인관계증명서 (해당 시 — 만18세 직계비속 미성년 인정)',
    '피부양 직계존속 주민등록초본 (해당 시 — 3세대 이상 세대구성 배점)',
  ],
  '노부모부양': [
    // 필수
    '직계존속 주민등록초본 (3년 이상 계속 거주 확인)',
    '직계존속 가족관계증명서',
    '직계존속 출입국사실증명원',
    '건강보험 피부양자 확인서 또는 요양급여내역',
  ],
  '기관추천': [
    '기관추천서 (해당 기관 발급)',
    '자격확인서 (해당 기관)',
  ],
  '신생아': [
    // 필수
    '신생아 특별공급 우선순위 배점 기준표 (본인)',
    '출생증명서 또는 자녀 기본증명서',
    '혼인관계증명서 (상세)',
    '건강보험자격득실확인서',
    '소득증빙서류',
    '건강보험료 납부확인서 (최근 6개월)',
    // 추가(해당자)
    '임신진단서 (해당 시 — 임신 중인 경우)',
  ],
  '일반공급': [
    // 필수
    '청약통장 가입확인서',
    '무주택기간 확인 서류',
    // 추가(해당자)
    '배우자 청약 당첨사실 확인서 (해당 시 — 가점제 신청자)',
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

/**
 * 서류 이름에서 짧은 핵심 이름과 조건 문구를 분리합니다.
 *
 * 예:
 *   "주민등록등본 (세대원 전원, 주민등록번호 뒷자리 포함)"
 *     → { shortName: "주민등록등본", condition: "세대원 전원, 주민등록번호 뒷자리 포함", isConditional: false }
 *   "임신진단서 (임신 중인 경우)"
 *     → { shortName: "임신진단서", condition: "임신 중인 경우", isConditional: true }
 *   "혼인관계증명서 (기혼자)"
 *     → { shortName: "혼인관계증명서", condition: "기혼자", isConditional: true }
 */
export function parseDocumentName(rawName: string): {
  shortName: string;
  condition?: string;
  isConditional: boolean;
} {
  const m = rawName.match(/^([^(]+)\(([^)]+)\)\s*$/);
  if (!m) {
    return {
      shortName: rawName.trim(),
      isConditional: /해당\s*시|해당자/.test(rawName),
    };
  }
  const shortName = m[1].trim();
  const condition = m[2].trim();
  const isConditional =
    /해당\s*시|해당자|기혼자|임신|이내\s*자녀|중인\s*경우|발생\s*시/.test(condition);
  return { shortName, condition, isConditional };
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
