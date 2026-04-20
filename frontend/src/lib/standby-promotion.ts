/**
 * 예비 승계 (Standby Promotion) 헬퍼
 *
 * 당첨자가 부적합·포기할 때 같은 공고·같은 주택형의 예비입주자 중에서
 * 가장 높은 순위(작은 standby_rank 숫자)를 골라 자리를 이어받게 한다.
 *
 * 모든 함수는 **순수 함수** — 실제 저장은 호출측에서 `localCustomers.update`.
 */

import type { LocalCustomer } from "./local-store";

export interface PromotionCandidate {
  customer: LocalCustomer;
  rank: number;           // parseInt된 예비 순위 (1, 2, 3...)
  rankLabel: string;      // 원본 문자열 "1", "01" 등
}

/**
 * 승계 후보 탐색
 *
 * 기준:
 *  - 같은 공고 (announcement_id)
 *  - 같은 주택형 (unit_type) — 주택형이 다르면 다른 경쟁 풀
 *  - is_standby === true
 *  - 아직 본인이 다른 자리에 승계되지 않은 상태 (succeeded_from 없음)
 *
 * 반환은 standby_rank 숫자 오름차순.
 */
export function findStandbyCandidates(
  winner: LocalCustomer,
  allCustomers: LocalCustomer[],
): PromotionCandidate[] {
  if (winner.is_standby) return []; // 예비 본인은 승계 대상 아님
  const candidates: PromotionCandidate[] = [];
  for (const c of allCustomers) {
    if (c.id === winner.id) continue;
    if (c.announcement_id !== winner.announcement_id) continue;
    if (!c.is_standby) continue;
    // 이미 다른 자리로 올라간 예비는 제외
    if (c.succeeded_from !== undefined && c.succeeded_from !== null) continue;
    // 주택형 일치 — 양쪽 다 지정됐을 때만 비교 (누락 시 허용)
    if (winner.unit_type && c.unit_type && winner.unit_type !== c.unit_type) continue;
    const rawRank = (c.standby_rank || "").trim();
    const rank = parseInt(rawRank, 10);
    candidates.push({
      customer: c,
      rank: Number.isFinite(rank) ? rank : 9999,
      rankLabel: rawRank || "—",
    });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return candidates;
}

/**
 * 승계 실행 — 원당첨자와 승계받을 예비의 업데이트 페이로드를 반환.
 *
 * 호출측에서 이 두 patch로 `localCustomers.update(winner.id, winnerPatch)`,
 * `localCustomers.update(standby.id, standbyPatch)` 를 실행하면 승계 완료.
 */
export function buildPromotionUpdates(
  winner: LocalCustomer,
  standby: LocalCustomer,
  reason: string = "부적합 판정",
): {
  winnerPatch: Partial<LocalCustomer>;
  standbyPatch: Partial<LocalCustomer>;
} {
  const nowIso = new Date().toISOString();

  const winnerPatch: Partial<LocalCustomer> = {
    superseded: true,
    superseded_by: standby.id,
    supersede_reason: reason,
    supersede_at: nowIso,
    status: "withdrawn",
  };

  const standbyPatch: Partial<LocalCustomer> = {
    is_standby: false,
    standby_rank: undefined,
    succeeded_from: winner.id,
    supersede_at: nowIso,
    // 주택형·전용면적은 대체로 예비·당첨이 같은 값이지만, 혹시 누락 시 승계 전 당첨자 값 복사
    unit_type: standby.unit_type || winner.unit_type,
    unit_area: standby.unit_area || winner.unit_area,
    status: "applied",
  };

  return { winnerPatch, standbyPatch };
}
