/**
 * 로그인 — 두 경로 모두 수용
 *  1. ENV STAFF_USERNAME / STAFF_PASSWORD 와 일치 → 마스터 관리자
 *  2. Turso users 테이블의 username + 비밀번호 일치 → 관리자가 생성한 계정
 *
 * DB 실패해도 1번은 동작하도록 설계.
 */

import { NextRequest, NextResponse } from "next/server";
import { signSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db/turso";

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
    if (!email || !password) {
      return NextResponse.json({ error: "아이디·비밀번호 필수" }, { status: 400 });
    }
    const username = String(email).trim().split("@")[0] || String(email).trim();

    // 1) 마스터 관리자 (ENV)
    const STAFF_USERNAME = process.env.STAFF_USERNAME;
    const STAFF_PASSWORD = process.env.STAFF_PASSWORD;
    if (STAFF_USERNAME && STAFF_PASSWORD) {
      if (safeEqual(username, STAFF_USERNAME) && safeEqual(String(password), STAFF_PASSWORD)) {
        const token = await signSession({
          sub: "1",
          email: STAFF_USERNAME,
          name: "관리자",
        });
        await setSessionCookie(token);
        return NextResponse.json({
          user: { id: 1, email: STAFF_USERNAME, name: "관리자", role: "master" },
        });
      }
    }

    // 2) DB users 테이블 (관리자가 /settings에서 생성한 계정)
    try {
      await ensureSchema();
      const db = getDb();
      const r = await db.execute({
        sql: "SELECT id, email, name, password_hash FROM users WHERE email = ?",
        args: [username],
      });
      if (r.rows.length > 0) {
        const row = r.rows[0] as any;
        const ok = await verifyPassword(String(password), String(row.password_hash));
        if (ok) {
          const token = await signSession({
            sub: String(row.id),
            email: String(row.email),
            name: String(row.name),
          });
          await setSessionCookie(token);
          return NextResponse.json({
            user: { id: Number(row.id), email: row.email, name: row.name, role: "staff" },
          });
        }
      }
    } catch (e: any) {
      console.warn("[login] DB check skipped:", e?.message);
      // DB 오류 시 ENV 계정 실패했으면 그대로 아래에서 401
    }

    return NextResponse.json(
      { error: "아이디 또는 비밀번호가 틀렸습니다" },
      { status: 401 },
    );
  } catch (err: any) {
    console.error("[login]", err);
    return NextResponse.json({ error: err?.message || "로그인 실패" }, { status: 500 });
  }
}
