// 워크플로우 단계별 「작업 내용」만 초기화하는 헬퍼 — 고객 레코드는 유지하고 해당 단계 결과 필드만 비움

import { LocalCustomer, localCustomers } from "./local-store";

/**
 * 초기화 가능한 단계 키.
 *
 * 1단계(당첨자 등록)는 「고객 레코드 자체」를 다루므로 이 모듈 대상이 아님.
 * (1단계 페이지는 기존 `localCustomers.remove()` 사용)
 *
 * 6단계(명의변경)·7단계(최종 계약자)는 각자 별도 데이터를 다루므로 필요 시 추가.
 */
export type StageResetKey = "household" | "property" | "savings" | "documents";

/**
 * 각 단계에서 「이번 단계 작업으로 생긴 결과 필드」 목록.
 *
 * - 5단계(documents)는 verification_verdict까지 비움 (사용자 결정: 최종 판정 다시 실행 가능 상태로 되돌림).
 * - unit_dong/unit_ho는 「고객 식별」 정보이므로 어느 단계에서도 비우지 않음.
 * - subscription_months는 1단계 등록 시 이미 들어올 수 있어 4단계 리셋 대상에서 제외.
 */
export const STAGE_RESET_FIELDS: Record<StageResetKey, Array<keyof LocalCustomer>> = {
  household: [
    "household_members",
  ],
  property: [
    "properties",
    "property_checked_at",
    "separated_household_members",
    "separated_checked_at",
    "separated_properties",
    "separated_property_checked_at",
  ],
  savings: [
    "savings_priority",
  ],
  documents: [
    "document_files",
    "documents_submitted",
    "verification_verdict",
    "verification_reasons",
    "verification_checked_at",
    "verification_score",
  ],
};

/** 사이드바·확인창에 표시할 단계 한글명 */
export const STAGE_RESET_LABEL: Record<StageResetKey, string> = {
  household: "세대·가족관계",
  property: "주택소유 조회",
  savings: "청약통장 검증",
  documents: "서류검토·판정",
};

/** 확인창에 보여줄, 사람이 읽기 좋은 항목 설명 */
export const STAGE_RESET_DESCRIPTION: Record<StageResetKey, string[]> = {
  household: [
    "세대원 명단 (주민등록등본 파싱 결과)",
  ],
  property: [
    "주택소유 명세",
    "분리세대원 명단",
    "분리세대 주택소유 명세",
    "공시가격·취득일 등 부가 정보",
  ],
  savings: [
    "청약통장 순위확인 결과 (개설은행 / 검증 상태)",
  ],
  documents: [
    "업로드된 서류 파일 메타",
    "서류 제출 체크 상태",
    "최종 적합·부적합 판정 및 사유",
  ],
};

/**
 * 한 명의 단계 데이터 초기화.
 *
 * ※ 클라우드 sync까지 가려면 `undefined`가 아니라 `null`을 보내야 함.
 *   PUT 라우트의 `JSON.stringify(patch)`가 undefined 필드를 누락시키기 때문.
 *   localCustomers.update는 spread merge라 null도 그대로 들어가 read 시 nullish 체크로 처리됨.
 */
export function resetStageDataFor(customerId: number, stage: StageResetKey): void {
  const fields = STAGE_RESET_FIELDS[stage];
  const patch: Record<string, null> = {};
  for (const f of fields) {
    patch[f as string] = null;
  }
  localCustomers.update(customerId, patch as unknown as Partial<LocalCustomer>);
}

/** 여러 명 한 번에 초기화 — UI는 결과 카운트만 보여주면 됨 */
export function resetStageDataBulk(customerIds: number[], stage: StageResetKey): number {
  let n = 0;
  for (const id of customerIds) {
    resetStageDataFor(id, stage);
    n++;
  }
  return n;
}
