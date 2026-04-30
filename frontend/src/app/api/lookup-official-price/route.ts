/**
 * 공시가격 자동 조회 API
 *
 * 입력: { address?, identifier?, year? }  — 둘 중 하나 이상 필요
 * 출력: { price, year, source, confidence, regionType, error? }
 *
 * 데이터 출처: 공공데이터포털(data.go.kr) 공동주택·개별주택 공시가격 정보 API.
 *   - 공동주택(아파트·연립·다세대): 단지코드 또는 PNU 필요
 *   - 개별주택(단독): PNU 필요
 *   - 주소 → PNU 변환은 도로명주소(juso.go.kr) API 또는 V-World API
 *
 * 현 구현은 「식별번호(엑셀에 저장됨) 우선」 → 「주소만 있으면 PNU 변환 시도」 → 「실패 시 manual 안내」
 * 의 단계적 fallback. 외부 API 키 없거나 실패하면 명확한 에러 코드 반환해 클라이언트가
 * fallback UI(공시가격 알리미 새 탭 열기)를 보여줄 수 있게 한다.
 *
 * 테스트 모드: DATA_GO_KR_API_KEY 미설정 시에도 「mock=true」 쿼리로 호출하면
 * 가짜 결과 반환해 UI 동작 확인 가능.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardRequest } from "@/lib/rate-limit";
import {
  getCachedPrice,
  setCachedPrice,
  makePriceCacheKey,
} from "@/lib/official-price-cache";
import { classifyAddress, type RegionType } from "@/lib/region-classifier";

export const runtime = "nodejs";

interface LookupResult {
  price?: number;
  year?: number;
  /** "api" — 외부 API에서 조회 / "cache" — 캐시 / "mock" — 테스트 모드 */
  source: "api" | "cache" | "mock";
  /** "high" — 정확 매칭 / "med" — 주소 부분 매칭 / "low" — 추정값 */
  confidence: "high" | "med" | "low";
  regionType: RegionType;
  /** 디버그용 — 외부 API에서 매칭한 식별자 */
  matchedIdentifier?: string;
  error?: string;
  errorCode?: "NO_API_KEY" | "NOT_FOUND" | "RATE_LIMITED" | "NETWORK" | "INVALID_INPUT";
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "로그인 필요" } satisfies Partial<LookupResult>,
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
        matchedIdentifier: identifier || `mock-${Date.now()}`,
      };
      if (cacheKey) setCachedPrice(cacheKey, result);
      return NextResponse.json<LookupResult>(result);
    }

    // 실제 외부 API 조회
    const apiKey = process.env.DATA_GO_KR_API_KEY;
    if (!apiKey) {
      return NextResponse.json<LookupResult>(
        {
          source: "api",
          confidence: "low",
          regionType,
          error:
            "DATA_GO_KR_API_KEY 미설정. data.go.kr 에서 API 키를 발급받아 .env.local 에 추가하거나, body에 mock:true 로 테스트하세요.",
          errorCode: "NO_API_KEY",
        },
        { status: 503 },
      );
    }

    // 본격 외부 API 호출 — 공동주택 공시가격 정보 (대다수 케이스 커버)
    // 공공데이터포털 「공동주택공시가격정보」 v3:
    //   https://apis.data.go.kr/1611000/AptHousPriceInfoService_v3/getApthusPriceInfo
    //   필수 파라미터: bjdongCd(법정동코드)+bun(번지)+ji(필지)+danjiCd(단지코드)+dongNm(동)+hoNm(호)
    //   또는 PNU(필지고유번호) 19자리
    //
    // identifier가 19자리 PNU면 그것으로, 아니면 주소 → PNU 변환 후 호출.
    try {
      const result = await lookupViaPublicApi({
        apiKey,
        address,
        identifier,
        year,
      });
      if (result.price != null && cacheKey) {
        setCachedPrice(cacheKey, { ...result, regionType });
      }
      return NextResponse.json<LookupResult>({ ...result, regionType });
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      // 외부 API의 한도 초과·인증 실패는 명확히 구분해 UI가 다음 액션 결정 가능하게.
      if (/429|RATE_LIMIT/i.test(msg)) {
        return NextResponse.json<LookupResult>(
          {
            source: "api",
            confidence: "low",
            regionType,
            error: "공공데이터포털 API 호출 한도 초과 — 다음 시간대에 재시도하거나 트래픽 한도 상향 신청 필요",
            errorCode: "RATE_LIMITED",
          },
          { status: 429 },
        );
      }
      if (/NOT_FOUND|404|0건/i.test(msg)) {
        return NextResponse.json<LookupResult>(
          {
            source: "api",
            confidence: "low",
            regionType,
            error: "해당 주소·식별번호로 공시가격을 찾을 수 없습니다 — 주소 정규화 또는 수동 입력 필요",
            errorCode: "NOT_FOUND",
          },
          { status: 404 },
        );
      }
      return NextResponse.json<LookupResult>(
        {
          source: "api",
          confidence: "low",
          regionType,
          error: `외부 API 호출 실패: ${msg.slice(0, 200)}`,
          errorCode: "NETWORK",
        },
        { status: 502 },
      );
    }
  } catch (err: any) {
    console.error("[lookup-official-price]", err?.message);
    return NextResponse.json<LookupResult>(
      {
        source: "api",
        confidence: "low",
        regionType: "unknown",
        error: err?.message || "서버 오류",
        errorCode: "NETWORK",
      },
      { status: 500 },
    );
  }
}

/**
 * 공공데이터포털 API 호출.
 *
 * 1차 시도: identifier가 PNU(19자리)면 직접 호출.
 * 2차 시도: 주소만 있으면 「도로명주소 → PNU 변환」 단계가 추가로 필요.
 *   현재는 그 단계를 미구현 — NOT_FOUND를 반환해 사용자가 수동 입력 또는
 *   알리미 새 탭으로 가도록 유도. 추후 V-World API 연동 시 확장.
 */
async function lookupViaPublicApi(opts: {
  apiKey: string;
  address: string;
  identifier: string;
  year: number;
}): Promise<Omit<LookupResult, "regionType">> {
  const { apiKey, identifier, year } = opts;

  // PNU(필지고유번호) — 시도1자리·시군구4자리·읍면동3자리·리2자리·필지번호 등 총 19자리
  const isPnu = /^\d{19}$/.test(identifier);

  if (isPnu) {
    // 공동주택 공시가격 — 단지·동·호 단위 조회는 별도 파라미터 필요해서
    // 여기서는 「개별주택 공시가격」용 PNU 매핑 단순 케이스만 시연.
    // 실제 운영 시 「공동주택」(AptHousPriceInfo)와 「개별주택」(IndvdHousPriceInfo)을
    // PNU 형식·접미사로 구분해 호출 분기 필요.
    const url = new URL(
      "https://apis.data.go.kr/1611000/IndvdHousPriceInfoService/getIndvdHousPriceInfo",
    );
    url.searchParams.set("serviceKey", apiKey);
    url.searchParams.set("pnu", identifier);
    url.searchParams.set("stdrYear", String(year));
    url.searchParams.set("_type", "json");
    url.searchParams.set("numOfRows", "1");

    const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => null);
    // 공공데이터포털 응답 구조: response.body.items.item[]
    const item =
      data?.response?.body?.items?.item?.[0] ??
      data?.response?.body?.items?.item ??
      null;
    if (!item) {
      throw new Error("NOT_FOUND");
    }
    const price = Number(item?.housPc || item?.indvdHousPrice || 0);
    if (!price) throw new Error("NOT_FOUND");
    return {
      price,
      year,
      source: "api",
      confidence: "high",
      matchedIdentifier: identifier,
    };
  }

  // PNU 없을 때 — 주소만으로는 직접 호출 불가, NOT_FOUND 처리.
  // (추후) 도로명주소·V-World로 PNU 변환 단계 추가.
  throw new Error("NOT_FOUND");
}
