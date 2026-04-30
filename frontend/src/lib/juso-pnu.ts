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

/**
 * "...103동 403호" 또는 "...103동 403" 또는 「동·호 키워드 없는 NNNN NNNNN」 패턴까지 처리.
 *
 * 청약홈/국토부 엑셀에는 두 종류 표기가 섞여 있음:
 *   A. "...번지 204동 308호"     — 정상 표기
 *   B. "...번지 0204 00308"      — 동·호 키워드 없이 숫자만 (leading 0 padded)
 *   C. "...번지 0504 00108"      — 4·5자리 숫자
 *
 * 모두 동·호로 추출.
 */
function extractDongHo(address: string): { dongNm?: string; hoNm?: string; stripped: string } {
  // 패턴 A: 204동 308호 / 204동 308
  let m = address.match(/(\d{1,4})\s*동\s*(\d{1,5})\s*호?\s*$/);
  if (m) {
    return {
      dongNm: String(Number(m[1])), // leading 0 제거
      hoNm: String(Number(m[2])),
      stripped: address.replace(m[0], "").trim(),
    };
  }
  // 패턴 B/C: 끝에 「숫자 숫자」 (동·호 키워드 없음). 「번지」 뒤에 등장하는 경우만.
  m = address.match(/번지\s*[\s,]?\s*(\d{2,5})\s+(\d{2,5})\s*$/);
  if (m) {
    return {
      dongNm: String(Number(m[1])),
      hoNm: String(Number(m[2])),
      stripped: address.replace(/\s*\d{2,5}\s+\d{2,5}\s*$/, "").trim(),
    };
  }
  return { stripped: address };
}

/**
 * juso.go.kr keyword 검색용으로 주소 정제.
 *
 * 노이즈 제거:
 *   1) 행정구역 중복 prefix: "강원도 강원속초시" → "강원도 속초시"
 *      "경기도 경기수원시" → "경기도 수원시" 등
 *   2) 단지명 (지번 앞에 끼어있는 한글): "교항리 주문진벽산블루밍오션힐스 1269-0번지" → "교항리 1269-0번지"
 *   3) -0번지 → 번지 (부번 0은 표기 생략)
 *   4) "도로명" 명칭이 의심스러운 토큰("부영5", "부업사람으로" 등)도 단지명으로 보고 제거
 */
function normalizeForJuso(address: string): string {
  let kw = address.trim();

  // (1) 행정구역 중복 prefix
  kw = kw.replace(
    /(강원|경기|충북|충남|전북|전남|경북|경남|제주|충청|전라|경상)도\s+\1(?=\S)/g,
    "$1도 ",
  );
  // 「강원특별자치도」 같은 변형도 처리
  kw = kw.replace(
    /(강원|전북|제주)특별자치도\s+\1(?=\S)/g,
    "$1특별자치도 ",
  );

  // (2) 단지명 제거: 「리/동/읍/면 + 한글단어 + 숫자번지」 → 「리/동/읍/면 + 숫자번지」
  //   예: "주문진읍 교항리 주문진벽산블루밍오션힐스 1269-0번지" → "주문진읍 교항리 1269-0번지"
  //   예: "임암동 임암8주공아파트 709-1번지" → "임암동 709-1번지"
  kw = kw.replace(
    /((?:리|동|읍|면))\s+[가-힣0-9]+(?:[가-힣0-9\s]*?[가-힣]+)\s+(\d+(?:-\d+)?\s*번지)/g,
    "$1 $2",
  );

  // (3) -0번지 → 번지
  kw = kw.replace(/-0번지/g, "번지");

  // 다중 공백 정리
  kw = kw.replace(/\s+/g, " ").trim();
  return kw;
}

/** juso.go.kr 단일 호출 */
async function callJuso(apiKey: string, keyword: string): Promise<any[]> {
  const url = new URL("https://business.juso.go.kr/addrlink/addrLinkApi.do");
  url.searchParams.set("confmKey", apiKey);
  url.searchParams.set("currentPage", "1");
  url.searchParams.set("countPerPage", "1");
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("resultType", "json");

  const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
  if (!res.ok) throw new Error(`JUSO_HTTP_${res.status}`);

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JUSO_INVALID_RESPONSE");
  }
  const common = data?.results?.common;
  if (common?.errorCode && common.errorCode !== "0") {
    throw new Error(`JUSO_ERR_${common.errorCode}_${(common.errorMessage || "").slice(0, 50)}`);
  }
  return data?.results?.juso || [];
}

/**
 * keyword 검색이 망할 만한 케이스를 단계적으로 시도해서 첫 매칭 반환.
 *   1) 정규화된 전체 주소
 *   2) 시·군·구 + 읍·면·동·리 + 지번만 추출
 *   3) 시·군·구 + 지번만 추출
 */
async function tryAddressVariations(apiKey: string, address: string): Promise<{ list: any[]; tried: string }> {
  const variations: string[] = [];

  // 1) 정규화 결과
  const v1 = normalizeForJuso(address);
  variations.push(v1);

  // 2) 시·군·구·읍·면·동·리 + 지번 (단지명 완전 제거)
  //    "강원도 강릉시 주문진읍 교항리 1269-0번지" 같은 형태
  const m2 = v1.match(
    /(\S+(?:시|도|특별자치도))\s+(\S+(?:시|군|구))\s+(?:(\S+(?:읍|면|동))\s+)?(?:(\S+(?:리|동))\s+)?(\d+(?:-\d+)?\s*번지)/,
  );
  if (m2) {
    const parts = [m2[1], m2[2], m2[3], m2[4], m2[5]].filter(Boolean);
    const v2 = parts.join(" ").replace(/-0번지/g, "번지");
    if (v2 !== v1) variations.push(v2);
  }

  // 3) 시·군·구 + 지번만 (읍·면·동·리 제거)
  const m3 = v1.match(/(\S+(?:시|도|특별자치도))\s+(\S+(?:시|군|구))\s+.*?(\d+(?:-\d+)?\s*번지)/);
  if (m3) {
    const v3 = `${m3[1]} ${m3[2]} ${m3[3]}`.replace(/-0번지/g, "번지");
    if (!variations.includes(v3)) variations.push(v3);
  }

  let lastErr: any = null;
  for (const kw of variations) {
    try {
      const list = await callJuso(apiKey, kw);
      if (list.length > 0) return { list, tried: kw };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("JUSO_NOT_FOUND");
}

/** 주소 → PNU. juso.go.kr API 호출. 실패 시 throw. */
export async function addressToPnu(address: string): Promise<AddressLookupResult> {
  const apiKey = process.env.JUSO_GO_KR_API_KEY;
  if (!apiKey) throw new Error("NO_JUSO_API_KEY");

  const { dongNm, hoNm, stripped } = extractDongHo(address.trim());

  const { list, tried } = await tryAddressVariations(apiKey, stripped);

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
    matchedAddress: `${item?.roadAddr || item?.jibunAddr || ""} (검색: ${tried})`,
  };
}
