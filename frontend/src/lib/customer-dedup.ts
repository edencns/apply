/**
 * 고객 일괄 등록 시 중복 탐지 + 변경사항 diff 헬퍼.
 *
 * 업로드(PDF/엑셀)한 고객 후보를 기존 고객 목록과 비교해 세 가지로 분류:
 *  - new:       신규 — 그대로 생성
 *  - duplicate: 완전 일치 — 스킵
 *  - conflict:  동일 인물인데 일부 필드가 다름 — 사용자 확인 필요
 *
 * 매칭 키: name + rrn_front (주민번호 앞자리)
 *   rrn_front 가 placeholder("0000000")이거나 없으면 name + phone 도 허용
 */

import type { LocalCustomer } from "./local-store";
import { toIdentity, sameIdentity, identityScore } from "./identity";

export type IncomingCustomer = Partial<LocalCustomer> & {
  name: string;
};

/** diff 대상 필드 + 라벨 */
const TRACKED_FIELDS: Array<{ key: keyof LocalCustomer; label: string }> = [
  { key: "phone", label: "연락처" },
  { key: "rrn_front", label: "주민번호 앞자리" },
  { key: "rrn_back", label: "주민번호 뒷자리" },
  { key: "address", label: "주소" },
  { key: "current_region", label: "거주 지역" },
  { key: "unit_type", label: "주택형" },
  { key: "unit_area", label: "전용면적" },
  { key: "supply_type", label: "공급 유형" },
  { key: "no_home_years", label: "무주택 기간" },
  { key: "dependents_count", label: "부양가족 수" },
  { key: "subscription_months", label: "통장 가입 개월" },
  { key: "income_monthly", label: "월소득" },
];

export interface FieldDiff {
  key: keyof LocalCustomer;
  label: string;
  oldValue: any;
  newValue: any;
}

export interface CustomerConflict {
  existing: LocalCustomer;
  incoming: IncomingCustomer;
  diffs: FieldDiff[];
}

export interface DedupResult {
  toCreate: IncomingCustomer[];
  duplicates: Array<{ existing: LocalCustomer; incoming: IncomingCustomer }>;
  conflicts: CustomerConflict[];
}

/**
 * 동일인 매칭 — 다중 신호 기반 (주민번호 앞자리 + 성별 + 전화 + 이름 와일드카드)
 * lib/identity.ts의 `sameIdentity`를 사용.
 *
 * 매칭 기준 (총점 ≥ 3):
 *   - 주민번호 13자리 일치 → 결정적
 *   - 앞자리 + 성별 일치 → +3
 *   - 앞자리 + 전화 일치 → +4
 *   - 앞자리 + 이름(마스킹 호환) 일치 → +3
 *   - 전화 + 이름 일치만으로도 → +3
 *   - 앞자리/성별/풀네임 모순 → 무조건 상이
 */
function findMatch(
  candidate: IncomingCustomer,
  existingList: LocalCustomer[],
): LocalCustomer | null {
  if (!(candidate.name || "").trim()) return null;
  const candIdentity = toIdentity(candidate as any);

  // 동점일 때는 점수 높은 쪽을 채택
  // 엄격 매칭: 생년월일 + 성별/이름/전화 중 양쪽 모두 확보된 신호 최소 1개 일치,
  //           한쪽이라도 모순(conflict) 있으면 즉시 제외.
  let best: { record: LocalCustomer; score: number } | null = null;
  for (const e of existingList) {
    const eIdentity = toIdentity(e as any);
    const s = identityScore(candIdentity, eIdentity);
    if (s.conflict) continue;
    if (s.exact) return e;
    if (sameIdentity(candIdentity, eIdentity)) {
      if (!best || s.score > best.score) best = { record: e, score: s.score };
    }
  }
  return best?.record || null;
}

// 외부 모듈(UI 등)에서도 동일 기준으로 매칭 여부만 알고 싶을 때 사용
export function isSameCustomer(a: Partial<LocalCustomer>, b: Partial<LocalCustomer>): boolean {
  return sameIdentity(toIdentity(a as any), toIdentity(b as any));
}

/** 기존값과 새값 중 "의미있게 다른" 필드만 diff로 기록 */
function diffCustomer(existing: LocalCustomer, incoming: IncomingCustomer): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const { key, label } of TRACKED_FIELDS) {
    const oldValue = (existing as any)[key];
    const newValue = (incoming as any)[key];

    // 새값이 비어있으면 스킵 (엑셀 빈칸으로 덮어쓰지 않기)
    if (newValue === undefined || newValue === null || newValue === "") continue;
    // rrn_back 이 placeholder 면 스킵
    if (key === "rrn_back" && newValue === "0000000") continue;
    // 기존값 정규화
    const oldNorm = oldValue ?? (typeof newValue === "number" ? 0 : "");
    // 숫자는 엄격 비교, 문자열은 trim
    const same = typeof newValue === "number"
      ? Number(oldNorm) === Number(newValue)
      : String(oldNorm).trim() === String(newValue).trim();
    if (!same) {
      diffs.push({ key, label, oldValue, newValue });
    }
  }
  // special_types 배열 비교
  const oldST = (existing.special_types || []).slice().sort().join(",");
  const newST = (incoming.special_types || []).slice().sort().join(",");
  if (incoming.special_types && newST && oldST !== newST) {
    diffs.push({
      key: "special_types" as any,
      label: "특별공급 유형",
      oldValue: existing.special_types,
      newValue: incoming.special_types,
    });
  }
  return diffs;
}

/** 업로드 후보 목록을 기존 고객 목록과 비교해 분류 */
export function classifyIncoming(
  incoming: IncomingCustomer[],
  existing: LocalCustomer[],
): DedupResult {
  const toCreate: IncomingCustomer[] = [];
  const duplicates: DedupResult["duplicates"] = [];
  const conflicts: CustomerConflict[] = [];

  for (const c of incoming) {
    const match = findMatch(c, existing);
    if (!match) {
      toCreate.push(c);
      continue;
    }
    const diffs = diffCustomer(match, c);
    if (diffs.length === 0) {
      duplicates.push({ existing: match, incoming: c });
    } else {
      conflicts.push({ existing: match, incoming: c, diffs });
    }
  }

  return { toCreate, duplicates, conflicts };
}

/** diff 표시용 포맷터 */
export function formatValue(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ") || "—";
  return String(v);
}
