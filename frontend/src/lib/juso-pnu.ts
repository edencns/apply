/**
 * 주소 → PNU(필지고유번호 19자리) 변환 — juso.go.kr 도로명주소 API 활용
 *
 * juso.go.kr 응답에서 다음 필드 사용:
 *   - admCd: 법정동코드 (10자리)
 *   - mtYn: 산 여부 (Y=산, N=일반)
 *   - lnbrMnnm: 지번 본번 (정수)
 *   - lnbrSlno: 지번 부번 (정수)
 *
 * PNU 구성 (19자리):
 *   법정동코드(10) + 산구분(1) + 본번(4 zero-padded) + 부번(4 zero-padded)
 *
 * 입력 예: "강원도 강릉시 주문진읍 교항리 1269-0번지 103동 403"
 * 출력: { pnu: "4215025020100126900000", dongNm: "103", hoNm: "403" }
 *
 * 추가로 동·호 정보를 정규식으로 추출해 V-World 공동주택가격조회에 함께 전달.
 */

export interface AddressLookupResult {
  pnu: string;
  dongNm?: string;
  hoNm?: string;
  /** juso.go.kr 응답의 정규화된 도로명주소 (디버그용) */
  matchedAddress?: string;
}

/** "...103동 403" 또는 "...103동 403호" 같은 동·호 suffix 추출 */
function extractDongHo(address: string): { dongNm?: string; hoNm?: string; stripped: string } {
  const m = address.match(/(\d{1,4})\s*동\s*(\d{1,4})\s*호?\s*$/);
  if (!m) return { stripped: address };
  return {
    dongNm: m[1],
    hoNm: m[2],
    stripped: address.replace(m[0], "").trim(),
  };
}

/** 주소 → PNU. juso.go.kr API 호출. 실패 시 throw. */
export async function addressToPnu(address: string): Promise<AddressLookupResult> {
  const apiKey = process.env.JUSO_GO_KR_API_KEY;
  if (!apiKey) throw new Error("NO_JUSO_API_KEY");

  const { dongNm, hoNm, stripped } = extractDongHo(address.trim());

  // 단지명·"번지"·"-N번지" 등 노이즈 제거 — 핵심 키워드만 보냄.
  // juso API는 keyword 기반이라 일정 수준 fuzzy matching 가능.
  let keyword = stripped;
  // "1234-0번지" 같은 표기에서 "-0" 제거 (부번 0 표기)
  keyword = keyword.replace(/-0번지/g, "번지");
  // 행정구역 중복 ("강원도 강원강릉시" → "강원도 강릉시") 등 명확 패턴 정정
  keyword = keyword.replace(/(\S+도)\s+\1(?=\S)/g, "$1 ");

  const url = new URL("https://business.juso.go.kr/addrlink/addrLinkApi.do");
  url.searchParams.set("confmKey", apiKey);
  url.searchParams.set("currentPage", "1");
  url.searchParams.set("countPerPage", "1");
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("resultType", "json");

  const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
  if (!res.ok) throw new Error(`JUSO_HTTP_${res.status}`);

  // juso.go.kr는 종종 application/x-javascript content-type 으로 JSON 반환 → text 후 parse
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JUSO_INVALID_RESPONSE");
  }

  // 응답: { results: { common: { errorCode, errorMessage, ... }, juso: [{ admCd, mtYn, lnbrMnnm, lnbrSlno, ... }] } }
  const common = data?.results?.common;
  if (common?.errorCode && common.errorCode !== "0") {
    throw new Error(`JUSO_ERR_${common.errorCode}_${common.errorMessage || ""}`);
  }
  const list: any[] = data?.results?.juso || [];
  if (list.length === 0) throw new Error("JUSO_NOT_FOUND");

  const item = list[0];
  const admCd = String(item?.admCd || "").padStart(10, "0");
  if (admCd.length !== 10 || !/^\d{10}$/.test(admCd)) throw new Error("JUSO_INVALID_ADMCD");

  const mtFlag = String(item?.mtYn || "N").toUpperCase() === "Y" ? "2" : "1";
  const mainNo = String(item?.lnbrMnnm || "0").padStart(4, "0");
  const subNo  = String(item?.lnbrSlno || "0").padStart(4, "0");

  const pnu = `${admCd}${mtFlag}${mainNo}${subNo}`;

  return {
    pnu,
    dongNm,
    hoNm,
    matchedAddress: item?.roadAddr || item?.jibunAddr || undefined,
  };
}
