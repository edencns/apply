/**
 * Ably Realtime 클라이언트용 토큰 발급.
 * 로그인한 사용자에게만 shared-data 채널 subscribe 권한 부여.
 */

import { NextResponse } from "next/server";
import * as Ably from "ably";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });

    const key = process.env.ABLY_API_KEY;
    if (!key) return NextResponse.json({ error: "ABLY_API_KEY 미설정" }, { status: 500 });

    const client = new Ably.Rest({ key });
    const tokenRequest = await client.auth.createTokenRequest({
      clientId: `user-${session.sub}`,
      capability: { "shared-data": ["subscribe", "history"] },
      ttl: 60 * 60 * 1000, // 1시간
    });
    return NextResponse.json(tokenRequest);
  } catch (err: any) {
    console.error("[ably/auth]", err);
    return NextResponse.json({ error: err?.message || "토큰 발급 실패" }, { status: 500 });
  }
}
