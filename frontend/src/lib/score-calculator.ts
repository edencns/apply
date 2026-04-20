/**
 * 청약 가점제 계산 (총 84점 만점)
 *
 * - 무주택 기간: 최대 32점 (15년 이상, 1년당 2점, 무주택 1년 미만은 2점)
 * - 부양가족 수: 최대 35점 (0명 5점, 이후 1명당 5점, 최대 6명까지)
 * - 청약통장 가입: 최대 17점 (6개월당 1점, 최소 15년 = 17점)
 */

export interface ScoreBreakdown {
  noHomePoints: number;
  dependentsPoints: number;
  subscriptionPoints: number;
  total: number;
  maxTotal: 84;
}

export function calculateSubscriptionScore(input: {
  noHomeYears: number;
  dependentsCount: number;
  subscriptionMonths: number;
}): ScoreBreakdown {
  const years = Math.max(0, Math.floor(input.noHomeYears || 0));
  const deps = Math.max(0, Math.floor(input.dependentsCount || 0));
  const months = Math.max(0, Math.floor(input.subscriptionMonths || 0));

  // 무주택 기간: 무주택 1년 미만 2점, 1년당 2점 추가, 최대 32점
  const noHomePoints = Math.min(32, years <= 0 ? 2 : 2 + years * 2);

  // 부양가족: 0명 5점, 1명당 5점 추가, 최대 35점 (6명까지)
  const dependentsPoints = Math.min(35, 5 + Math.min(deps, 6) * 5);

  // 청약통장: 6개월당 1점, 최대 17점
  const subscriptionPoints = Math.min(17, Math.floor(months / 6));

  return {
    noHomePoints,
    dependentsPoints,
    subscriptionPoints,
    total: noHomePoints + dependentsPoints + subscriptionPoints,
    maxTotal: 84,
  };
}
