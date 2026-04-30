/**
 * 공시가격 자동 조회 API (V-World)
 *
 * 입력: { address?, identifier?, usage?, year? }  — pnu 또는 주소 중 하나 + 가능하면 usage
 * 출력: { price, year, source, confidence, regionType, kind, error? }
 *
 * 데이터 출처: 국가공간정보포털 V-World
 *   - 공동주택(아파트·연립·다세대): https://api.vworld.kr/ned/data/getApartHousingPriceAttr
 *     인증키: DATA_GO_KR_API_KEY
 *     가격 필드: pblntfPc
 *   - 개별주택(단독·다가구): https://api.vworld.kr/ned/data/getIndvdHousingPriceAttr
 *     인증키: DATA_GO_KR_API_KEY_INDVD
 *     가격 필드: housePc
 *   둘 다 PNU 19자리(또는 8자리 이상) 필수.
 *
 * 호출 분기 로직:
 *   1) usage가 「아파트·연립·다세대·공동」 → 공동주택 API
 *   2) usage가 「단독·다가구」 → 개별주택 API
 *   3) 모르겠음 → 공동주택 우선 시도, NOT_FOUND 시 개별주택 fallback
 *
 * 테스트 모드: 키 미설정 시에도 body.mock===true 면 가짜 결과 반환해 UI 동작 확인 가능.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequestEdge } from "@/lib/auth-edge";
import { guardRequest } from "@/lib/rate-limit";
import {
  getCachedPrice,
  setCachedPrice,
  makePriceCacheKey,
} from "@/lib/official-price-cache";
import { classifyAddress, type RegionType } from "@/lib/region-classifier";
import { addressToPnu } from "@/lib/juso-pnu";

// Vercel serverless(Node.js) IP가 V-World에서 차단되는 문제 우회용으로 Edge Runtime 사용.
// Edge는 Cloudflare 기반이라 다른 IP 대역. 일반 fetch만 쓰는 코드라 호환성 문제 없음.
export const runtime = "edge";

interface LookupResult {
  price?: number;
  year?: number;
  /** "api" — 외부 API에서 조회 / "cache" — 캐시 / "mock" — 테스트 모드 */
  source: "api" | "cache" | "mock";
  /** "high" — 정확 매칭 / "med" — 주소 부분 매칭 / "low" — 추정값 */
  confidence: "high" | "med" | "low";
  regionType: RegionType;
  /** 공동(apt) | 개별(indvd) — 어느 API에서 응답이 왔는지 */
  kind?: "apt" | "indvd";
  /** 디버그용 — 매칭한 PNU */
  matchedIdentifier?: string;
  error?: string;
  errorCode?: "NO_API_KEY" | "NOT_FOUND" | "RATE_LIMITED" | "NETWORK" | "INVALID_INPUT" | "PNU_REQUIRED" | "ADDRESS_LOOKUP_FAILED" | "NO_JUSO_API_KEY";
  /** 주소→PNU 변환 단계가 사용됐는지, 그 결과 매칭된 주소 (디버그용) */
  resolvedFromAddress?: boolean;
  resolvedAddress?: string;
}

const APT_URL    = "https://api.vworld.kr/ned/data/getApartHousingPriceAttr";
const INDVD_URL  = "https://api.vworld.kr/ned/data/getIndvdHousingPriceAttr";

/** usage 문자열 → 어느 API를 우선 호출할지 결정 */
function decideKind(usage?: string): "apt" | "indvd" | "unknown" {
  const u = (usage || "").trim();
  if (!u) return "unknown";
  if (/단독주택|다가구주택/.test(u)) return "indvd";
  if (/아파트|연립|다세대|공동주택/.test(u)) return "apt";
  return "unknown";
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequestEdge(req);
    if (!session) {
      return NextResponse.json(
        { source: "api", confidence: "low", regionType: "unknown", error: "로그인 필요" } satisfies LookupResult,
        { status: 401 },
      );
    }

    const guard = guardRequest(
      req,
      "lookup-official-price",
      { max: 200, windowMs: 60_000 }, // 분당 200건 (일괄 조회 고려)
      String(session.sub),
    );
    if (!guard.ok) return guard.response;

    const body = await req.json().catch(() => ({}));
    const address = String(body?.address || "").trim();
    const identifier = String(body?.identifier || "").trim();
    const usage = String(body?.usage || "").trim();
    const year = Number(body?.year) || new Date().getFullYear();
    const mock = body?.mock === true || req.nextUrl?.searchParams.get("mock") === "1";

    if (!address && !identifier) {
      return NextResponse.json<LookupResult>(
        {
          source: "api",
          confidence: "low",
          regionType: "unknown",
          error: "주소 또는 식별번호 중 하나는 필요합니다",
          errorCode: "INVALID_INPUT",
        },
        { status: 400 },
      );
    }

    const regionType = classifyAddress(address);
    const cacheKey = makePriceCacheKey({ address, identifier, year });

    // 캐시 확인
    if (cacheKey) {
      const cached = getCachedPrice<LookupResult>(cacheKey);
      if (cached) {
        return NextResponse.json<LookupResult>({
          ...cached,
          source: "cache",
        });
      }
    }

    // 테스트 모드 — 가짜 결과 반환
    if (mock) {
      const mockPrice = address.includes("서울") ? 240_000_000
                      : address.includes("강원") ? 80_000_000
                      : 150_000_000;
      const result: LookupResult = {
        price: mockPrice,
        year,
        source: "mock",
        confidence: "high",
        regionType,
        kind: "apt",
        matchedIdentifier: identifier || `mock-${Date.now()}`,
      };
      if (cacheKey) setCachedPrice(cacheKey, result);
      return NextResponse.json<LookupResult>(result);
    }

    // PNU(19자리)가 없거나 짧으면 주소 → PNU 변환 시도 (juso.go.kr)
    let pnu = "";
    let dongNm: string | undefined;
    let hoNm: string | undefined;
    let resolvedFromAddress = false;
    let resolvedAddress: string | undefined;

    if (identifier && /^\d{8,}$/.test(identifier)) {
      pnu = identifier;
    } else if (address) {
      try {
        const lookup = await addressToPnu(address);
        pnu = lookup.pnu;
        dongNm = lookup.dongNm;
        hoNm = lookup.hoNm;
        resolvedFromAddress = true;
        resolvedAddress = lookup.matchedAddress;
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (/NO_JUSO_API_KEY/.test(msg)) {
          return NextResponse.json<LookupResult>(
            {
              source: "api",
              confidence: "low",
              regionType,
              error: "JUSO_GO_KR_API_KEY 미설정. juso.go.kr 도로명주소 API 키를 Vercel에 추가해주세요.",
              errorCode: "NO_JUSO_API_KEY",
            },
            { status: 503 },
          );
        }
        return NextResponse.json<LookupResult>(
          {
            source: "api",
            confidence: "low",
            regionType,
            error: `주소 → PNU 변환 실패: ${msg.slice(0, 200)}. 「공시가격 알리미」 새 탭으로 직접 확인 권장.`,
            errorCode: "ADDRESS_LOOKUP_FAILED",
          },
          { status: 404 },
        );
      }
    } else {
      return NextResponse.json<LookupResult>(
        { source: "api", confidence: "low", regionType, error: "주소 또는 PNU 필요", errorCode: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    // 어느 API부터 시도할지 결정
    const kind = decideKind(usage);

    try {
      let result: LookupResult | null = null;

      // 단계적 시도:
      //   1) 동·호 매칭 → 정확 가격
      //   2) 동·호 빼고 PNU만 → 단지 첫 매칭 (단지 평균가에 가까움, 정확도 ↓)
      //   3) 공동주택→개별주택 fallback
      const tryApt = async (withDongHo: boolean) =>
        callVworld({
          url: APT_URL, keyEnv: "DATA_GO_KR_API_KEY", priceField: "pblntfPc",
          pnu, dongNm: withDongHo ? dongNm : undefined, hoNm: withDongHo ? hoNm : undefined,
          year, kindLabel: "apt",
        });
      const tryIndvd = async () =>
        callVworld({
          url: INDVD_URL, keyEnv: "DATA_GO_KR_API_KEY_INDVD", priceField: "housePc",
          pnu, year, kindLabel: "indvd",
        });

      if (kind === "apt") {
        try {
          result = await tryApt(true);
        } catch (e: any) {
          if (/NOT_FOUND/.test(String(e?.message)) && (dongNm || hoNm)) {
            // 동·호 매칭 실패 시 PNU만으로 재시도 — confidence를 med로 낮춤
            result = await tryApt(false);
            if (result) result.confidence = "med";
          } else throw e;
        }
      } else if (kind === "indvd") {
        result = await tryIndvd();
      } else {
        // unknown — 공동주택(동호) → 공동주택(PNU만) → 개별주택 순으로 폴백
        try {
          result = await tryApt(true);
        } catch (e1: any) {
          if (/NOT_FOUND/.test(String(e1?.message))) {
            try {
              if (dongNm || hoNm) {
                result = await tryApt(false);
                if (result) result.confidence = "med";
              } else {
                throw e1;
              }
            } catch (e2: any) {
              if (/NOT_FOUND/.test(String(e2?.message))) {
                result = await tryIndvd();
              } else throw e2;
            }
          } else throw e1;
        }
      }
      if (result) {
        result.resolvedFromAddress = resolvedFromAddress;
        result.resolvedAddress = resolvedAddress;
      }

      if (result && result.price != null && cacheKey) {
        setCachedPrice(cacheKey, { ...result, regionType });
      }
      return NextResponse.json<LookupResult>({ ...(result as LookupResult), regionType });
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      if (/NO_API_KEY/.test(msg)) {
        return NextResponse.json<LookupResult>(
          {
            source: "api",
            confidence: "low",
            regionType,
            error:
              "API 키 미설정. Vercel(또는 .env.local)에 DATA_GO_KR_API_KEY (공동주택용), DATA_GO_KR_API_KEY_INDVD (단독주택용) 추가 필요. 임시로 body에 mock:true 로 테스트 가능.",
            errorCode: "NO_API_KEY",
          },
          { status: 503 },
        );
      }
      if (/429|RATE_LIMIT/i.test(msg)) {
        return NextResponse.json<LookupResult>(
          { source: "api", confidence: "low", regionType, error: "V-World API 호출 한도 초과 — 잠시 후 재시도", errorCode: "RATE_LIMITED" },
          { status: 429 },
        );
      }
      if (/NOT_FOUND|404|0건/i.test(msg)) {
        return NextResponse.json<LookupResult>(
          { source: "api", confidence: "low", regionType, error: "해당 PNU로 공시가격을 찾을 수 없습니다 — PNU 정확성 또는 주택종류(공동/단독) 확인 필요", errorCode: "NOT_FOUND" },
          { status: 404 },
        );
      }
      return NextResponse.json<LookupResult>(
        { source: "api", confidence: "low", regionType, error: `V-World 호출 실패: ${msg.slice(0, 200)}`, errorCode: "NETWORK" },
        { status: 502 },
      );
    }
  } catch (err: any) {
    console.error("[lookup-official-price]", err?.message);
    return NextResponse.json<LookupResult>(
      { source: "api", confidence: "low", regionType: "unknown", error: err?.message || "서버 오류", errorCode: "NETWORK" },
      { status: 500 },
    );
  }
}

/**
 * V-World 속성 API 호출 헬퍼.
 *
 * 응답 구조 (JSON):
 *   {
 *     numOfRows: ..., pageNo: ..., totalCount: ...,
 *     fields: { field: { pnu, stdrYear, ..., pblntfPc | housePc, lastUpdtDt } | [...] }
 *   }
 *
 * V-World는 응답 루트가 「response」가 아니라 그냥 평면 구조라는 점이 data.go.kr과 다름.
 */
async function callVworld(opts: {
  url: string;
  keyEnv: "DATA_GO_KR_API_KEY" | "DATA_GO_KR_API_KEY_INDVD";
  priceField: "pblntfPc" | "housePc";
  pnu: string;
  dongNm?: string;
  hoNm?: string;
  year: number;
  kindLabel: "apt" | "indvd";
}): Promise<LookupResult> {
  const apiKey = process.env[opts.keyEnv];
  if (!apiKey) throw new Error("NO_API_KEY");

  const url = new URL(opts.url);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("pnu", opts.pnu);
  url.searchParams.set("format", "json");
  url.searchParams.set("numOfRows", "1");
  // 공동주택은 같은 PNU 안에 여러 동·호가 있어 정확 매칭 위해 동·호도 같이 전달
  if (opts.dongNm) url.searchParams.set("dongNm", opts.dongNm);
  if (opts.hoNm) url.searchParams.set("hoNm", opts.hoNm);
  // domain 파라미터는 V-World 직접 테스트 시 비어있어도 동작해서 의도적으로 미전송.
  // 등록 도메인 매칭은 Origin/Referer 헤더로 처리 (아래 fetch 옵션).
  // stdrYear는 옵션. 없으면 가장 최근 발표분 반환.
  // 명시하면 그 해 기준 가격을 받지만 미발표 연도면 빈 응답이라 기본은 미지정.

  // V-World fetch 옵션 — 헤더 명시.
  //   - User-Agent: 브라우저처럼 보이게 (Node.js 기본 UA 차단 회피)
  //   - Origin/Referer: V-World가 등록 도메인 검증할 때 매칭되도록 세팅 (V-World 키
  //     발급 시 등록한 URL = apply-flax.vercel.app)
  //   환경변수 VWORLD_DOMAIN 으로 override 가능.
  const vworldDomain = process.env.VWORLD_DOMAIN || "apply-flax.vercel.app";
  const fetchOpts: RequestInit = {
    method: "GET",
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Origin": `https://${vworldDomain}`,
      "Referer": `https://${vworldDomain}/`,
    },
  };

  // V-World는 종종 502/503/504 transient 오류 + UND_ERR_SOCKET 자체 끊김 → 최대 2회 재시도
  let res: Response | null = null;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url.toString(), fetchOpts);
      if (res.ok) break;
      if ([502, 503, 504].includes(res.status)) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      break; // 그 외 4xx 에러는 재시도 무의미
    } catch (e: any) {
      lastErr = e;
      const cause = e?.cause?.code || e?.cause?.message || e?.code || "";
      // 소켓 끊김·timeout만 재시도. DNS·TLS 실패는 retry해도 같음.
      if (/UND_ERR_SOCKET|ETIMEDOUT|ECONNRESET/i.test(String(cause))) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw new Error(`FETCH_FAILED:${cause || "UNKNOWN"}`);
    }
  }
  if (!res) {
    const cause = lastErr?.cause?.code || lastErr?.cause?.message || "RETRY_EXHAUSTED";
    throw new Error(`FETCH_FAILED:${cause}`);
  }
  if (!res.ok) {
    if (res.status === 429) throw new Error("RATE_LIMIT");
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json().catch(() => null) as any;
  // V-World 응답 루트는 서비스마다 다름:
  //   공동주택: data.apartHousingPrices.field[]
  //   개별주택: data.indvdHousingPrices.field[] (추정)
  //   레거시:   data.fields.field, data.response.fields.field
  const fieldRaw =
    data?.apartHousingPrices?.field ??
    data?.indvdHousingPrices?.field ??
    data?.individualHousingPrices?.field ??
    data?.fields?.field ??
    data?.response?.fields?.field;
  const item = Array.isArray(fieldRaw) ? fieldRaw[0] : fieldRaw;
  if (!item) throw new Error("NOT_FOUND");

  const priceVal = item?.[opts.priceField];
  const price = Number(priceVal);
  if (!price || !Number.isFinite(price)) throw new Error("NOT_FOUND");

  const stdrYear = Number(item?.stdrYear) || opts.year;
  const matched = String(item?.pnu || opts.pnu);

  return {
    price,
    year: stdrYear,
    source: "api",
    confidence: "high",
    regionType: "unknown", // 호출 측에서 덮어씀
    kind: opts.kindLabel,
    matchedIdentifier: matched,
  };
}
