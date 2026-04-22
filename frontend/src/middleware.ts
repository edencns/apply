/**
 * 세션 쿠키가 없는 사용자를 /login으로 리다이렉트.
 * API 라우트는 각자 getSession()으로 자체 검사하므로 미들웨어에서는
 * 페이지 경로만 가드한다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/signup"];
const PUBLIC_PREFIXES = ["/api/auth", "/_next", "/favicon"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // 페이지 라우트(api 외)만 세션 가드
  if (!pathname.startsWith("/api/")) {
    const session = await getSessionFromRequest(req);
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // 모든 경로. 미들웨어 내부에서 public 판별.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
