/**
 * 예비입주자 개인정보 파기 — 「주택공급에 관한 규칙」 제26조제9항·제26조의2제6항.
 *
 * 예비입주자로 선정 후 「공급계약체결일」(announcement.contract_end)로부터 60일이 경과하여
 * 해당 지위가 소멸된 자(=계약체결로 이어지지 못한 예비)는 식별자 정보를 파기해야 함.
 *
 * 정책:
 *   - 식별자(이름·주민번호·전화·주소·소유자명 등) 마스킹
 *   - 통계/감사용 메타데이터(공고ID·주택형·예비순위·당첨일·상태)는 보존
 *   - pii_purged_at 시각 기록 → 재실행 방지 + 감사 추적
 *
 * 대상 제외:
 *   - is_standby = false (당첨자 본인)
 *   - succeeded_from 있음 (예비 → 당첨자로 승계됨, 지위 유효)
 *   - pii_purged_at 이미 있음
 */

import type { LocalCustomer } from "./local-store";

/** 마스킹 대체값 */
const REDACT_NAME = "***";
const REDACT_EMPTY = undefined as unknown as string; // type-safe undefined

/**
 * 파기 대상인지 판정 — 공급계약체결마감 + 60일 경과한 미승계 예비.
 */
export function shouldPurge(
  c: LocalCustomer,
  contractEnd: Date | null,
  now: Date = new Date(),
): boolean {
  if (!c.is_standby) return false;
  if (c.succeeded_from !== undefined && c.succeeded_from !== null) return false;
  if (c.pii_purged_at) return false;
  if (!contractEnd) return false;
  const due = new Date(contractEnd.getTime() + 60 * 24 * 60 * 60 * 1000);
  return now.getTime() >= due.getTime();
}

/**
 * 마스킹 패치 빌드. 식별자만 제거하고 다른 데이터는 유지.
 */
export function buildPurgePatch(c: LocalCustomer): Partial<LocalCustomer> {
  return {
    name: REDACT_NAME,
    phone: REDACT_EMPTY,
    address: REDACT_EMPTY,
    rrn_front: REDACT_EMPTY,
    rrn_back: REDACT_EMPTY,
    marriage_date: REDACT_EMPTY,
    household_members: c.household_members?.map((m) => ({
      name: REDACT_NAME,
      rrn: REDACT_EMPTY,
      errorCode: m.errorCode,
    })),
    separated_household_members: c.separated_household_members?.map((m) => ({
      name: REDACT_NAME,
      rrn: "",
      relation: m.relation,
      note: m.note,
    })),
    properties: c.properties?.map((p) => ({
      ...p,
      ownerName: REDACT_NAME,
      ownerRrn: REDACT_NAME,
      address: REDACT_NAME,
    })),
    separated_properties: c.separated_properties?.map((p) => ({
      ...p,
      ownerName: REDACT_NAME,
      ownerRrn: REDACT_NAME,
      address: REDACT_NAME,
    })),
    winner_info: c.winner_info ? {
      ...c.winner_info,
      account: REDACT_EMPTY,
    } : undefined,
    contract_info: c.contract_info ? {
      ...c.contract_info,
      customerPhone: REDACT_EMPTY,
      residenceAddress: REDACT_EMPTY,
      registeredAddress: REDACT_EMPTY,
    } : undefined,
    pii_purged_at: new Date().toISOString(),
  };
}
