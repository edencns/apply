/**
 * 주소 → 수도권/비수도권 분류
 *
 * 「소형·저가주택 무주택 예외」의 공시가격 한도가 수도권(서울·인천·경기) 1.6억,
 * 그 외(비수도권) 1억으로 다르므로, 주소로 자동 분류해 적절한 한도를 적용한다.
 *
 * 출처: 주택공급에 관한 규칙 별표 등에서 「수도권」 정의는 서울특별시·인천광역시·경기도
 * 전 지역. 그 외 광역시·도는 비수도권.
 */

export type RegionType = "metro" | "non_metro" | "unknown";

const METRO_PREFIXES = [
  "서울",         // 서울특별시
  "인천",         // 인천광역시
  "경기",         // 경기도
];

/**
 * 주소 문자열의 가장 앞 시·도 토큰으로 수도권 여부 판정.
 *
 * 예:
 *   "서울특별시 강남구..."        → "metro"
 *   "경기도 성남시 분당구..."      → "metro"
 *   "강원특별자치도 춘천시..."     → "non_metro"
 *   "부산광역시 해운대구..."       → "non_metro"
 *   ""                          → "unknown"
 */
export function classifyAddress(address?: string | null): RegionType {
  const a = (address || "").trim();
  if (!a) return "unknown";
  // 광역시·특별시 명을 포함한 prefix 체크 (괄호·공백 정규화 후)
  const head = a.replace(/^\s+/, "").slice(0, 8);
  for (const p of METRO_PREFIXES) {
    if (head.startsWith(p)) return "metro";
  }
  return "non_metro";
}

/**
 * 한 당첨자의 properties를 수도권 vs 비수도권으로 분류해
 * 각 그룹별 가격 한도를 다르게 적용할 수 있게 한다.
 *
 * 사용 예 (verification-rules):
 *   const region = classifyAddress(p.address);
 *   const priceMax = region === "metro" ? METRO_MAX : NON_METRO_MAX;
 */
export function isMetro(address?: string | null): boolean {
  return classifyAddress(address) === "metro";
}
