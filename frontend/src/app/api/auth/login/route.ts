import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db/turso";
import { verifyPassword, signSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "email·password 필수" }, { status: 400 });
    }
    const db = getDb();
    const r = await db.execute({
      sql: "SELECT id, email, name, password_hash FROM users WHERE email = ?",
      args: [email],
    });
    if (r.rows.length === 0) {
      return NextResponse.json({ error: "이메일 또는 비밀번호가 틀렸습니다" }, { status: 401 });
    }
    const row = r.rows[0] as any;
    const ok = await verifyPassword(password, String(row.password_hash));
    if (!ok) {
      return NextResponse.json({ error: "이메일 또는 비밀번호가 틀렸습니다" }, { status: 401 });
    }
    const token = await signSession({
      sub: String(row.id),
      email: String(row.email),
      name: String(row.name),
    });
    await setSessionCookie(token);
    return NextResponse.json({
      user: { id: Number(row.id), email: row.email, name: row.name },
    });
  } catch (err: any) {
    console.error("[login]", err);
    return NextResponse.json({ error: err?.message || "로그인 실패" }, { status: 500 });
  }
}
