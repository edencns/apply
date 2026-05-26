/**
 * 행정구역 표기 흔들림 정규화.
 *
 * 주택소유 전산검색 결과에는 "강원도 강릉강릉시", "전라남도 전남광양시",
 * "서울특별시 서울시강서구"처럼 시도/시군구가 중복 결합된 주소가 종종 들어온다.
 * 이 상태로 juso/V-World 조회를 보내면 PNU 변환 실패가 크게 늘어나므로,
 * 조회·그룹핑 전에 보수적으로 행정구역 중복만 제거한다.
 */

const REGION_ALIASES: Array<[string, string[]]> = [
  ["서울특별시", ["서울특별시", "서울시", "서울"]],
  ["부산광역시", ["부산광역시", "부산시", "부산"]],
  ["대구광역시", ["대구광역시", "대구시", "대구"]],
  ["인천광역시", ["인천광역시", "인천시", "인천"]],
  ["광주광역시", ["광주광역시", "광주시", "광주"]],
  ["대전광역시", ["대전광역시", "대전시", "대전"]],
  ["울산광역시", ["울산광역시", "울산시", "울산"]],
  ["세종특별자치시", ["세종특별자치시", "세종시", "세종"]],
  ["경기도", ["경기도", "경기"]],
  ["강원특별자치도", ["강원특별자치도", "강원도", "강원"]],
  ["강원도", ["강원도", "강원"]],
  ["충청북도", ["충청북도", "충북"]],
  ["충청남도", ["충청남도", "충남"]],
  ["전북특별자치도", ["전북특별자치도", "전라북도", "전북"]],
  ["전라북도", ["전라북도", "전북"]],
  ["전라남도", ["전라남도", "전남"]],
  ["경상북도", ["경상북도", "경북"]],
  ["경상남도", ["경상남도", "경남"]],
  ["제주특별자치도", ["제주특별자치도", "제주도", "제주"]],
  ["제주도", ["제주도", "제주"]],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeAdministrativeAddress(raw: string): string {
  let address = (raw || "").replace(/\s+/g, " ").trim();
  if (!address) return "";

  for (const [region, aliases] of REGION_ALIASES) {
    for (const alias of aliases) {
      // 예: "전라남도 전남광양시" → "전라남도 광양시"
      address = address.replace(
        new RegExp(`^${escapeRegExp(region)}\\s+${escapeRegExp(alias)}(?=\\S)`),
        `${region} `,
      );
      // 예: "서울특별시 서울시 강서구" → "서울특별시 강서구"
      address = address.replace(
        new RegExp(`^${escapeRegExp(region)}\\s+${escapeRegExp(alias)}\\s+`),
        `${region} `,
      );
    }
  }

  // 예: "강원도 강릉강릉시" → "강원도 강릉시", "주문진주문진읍" → "주문진읍"
  address = address.replace(/([가-힣]{2,6})\1(시|군|구|읍|면|동|리)(?=\s|$)/g, "$1$2");

  return address.replace(/\s+/g, " ").trim();
}
