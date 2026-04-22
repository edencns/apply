import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * 오픈 가입 차단.
 * 계정은 Vercel 환경변수 STAFF_USERNAME / STAFF_PASSWORD 에서 관리.
 */
export async function POST() {
  return NextResponse.json(
    { error: "계정 생성이 제한됩니다. 관리자에게 문의하세요." },
    { status: 403 },
  );
}
