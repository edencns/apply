/**
 * 관리자 전용 로그인.
 * Vercel 환경변수 STAFF_USERNAME / STAFF_PASSWORD 와 비교.
 * DB 의존성 없음.
 *
 * 이메일 필드에 STAFF_USERNAME 값(또는 STAFF_USERNAME@local) 입력해도 되고,
 * 이후 UI에서 자유롭게 바꾸려면 그냥 STAFF_USERNAME 문자열 매치로 처리.
 */

import { NextRequest, NextResponse } from "next/server";
import { signSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    const STAFF_USERNAME = process.env.STAFF_USERNAME;
    const STAFF_PASSWORD = process.env.STAFF_PASSWORD;

    if (!STAFF_USERNAME || !STAFF_PASSWORD) {
      return NextResponse.json(
        { error: "관리자 계정이 설정되지 않았습니다. (STAFF_USERNAME / STAFF_PASSWORD)" },
        { status: 500 },
      );
    }
    if (!email || !password) {
      return NextResponse.json({ error: "아이디·비밀번호 필수" }, { status: 400 });
    }

    // email 필드에 username을 입력해도, "username@..." 이메일 형태로 입력해도 허용
    const providedUser = String(email).trim().split("@")[0] || String(email).trim();
    const userOk = safeEqual(providedUser, STAFF_USERNAME);
    const passOk = safeEqual(String(password), STAFF_PASSWORD);

    if (!userOk || !passOk) {
      return NextResponse.json(
        { error: "아이디 또는 비밀번호가 틀렸습니다" },
        { status: 401 },
      );
    }

    const token = await signSession({
      sub: "1", // 고정 user_id (공유 계정)
      email: STAFF_USERNAME,
      name: "관리자",
    });
    await setSessionCookie(token);

    return NextResponse.json({
      user: { id: 1, email: STAFF_USERNAME, name: "관리자" },
    });
  } catch (err: any) {
    console.error("[login]", err);
    return NextResponse.json({ error: err?.message || "로그인 실패" }, { status: 500 });
  }
}
