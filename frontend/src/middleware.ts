/**
 * 전역 인증 가드
 *
 * 페이지: 세션 없으면 /login 리다이렉트
 * API: 세션 없으면 401 즉시 반환 (각 라우트에 세션 체크 누락되어도 미들웨어가 1차 방어)
 *
 * public 엔드포인트:
 *   /login, /signup, /api/auth/*, /api/ably/auth 만 인증 없이 접근 가능
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequestEdge } from "@/lib/auth-edge";

const PUBLIC_PAGE_PATHS = ["/login", "/signup"];
const PUBLIC_API_PREFIXES = ["/api/auth/"];
const PUBLIC_EXACT = ["/api/ably/auth"]; // Pusher/Ably 인증 콜백
const INTERNAL_PREFIXES = ["/_next", "/favicon"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Next 내부·정적 리소스는 통과
  if (INTERNAL_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/");
  const isPublicPage = PUBLIC_PAGE_PATHS.includes(pathname);
  const isPublicApi =
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_EXACT.includes(pathname);

  if (isPublicPage || isPublicApi) {
    return NextResponse.next();
  }

  const session = await getSessionFromRequestEdge(req);

  if (!session) {
    if (isApi) {
      // API: JSON 401 반환 (세션 누락된 라우트에 대한 1차 방어)
      return new NextResponse(
        JSON.stringify({ error: "로그인 필요" }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }
    // 페이지: 로그인 화면으로
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
