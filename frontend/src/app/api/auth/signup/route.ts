import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db/turso";
import { hashPassword, signSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const { email, password, name } = await req.json();
    if (!email || !password || !name) {
      return NextResponse.json({ error: "email·password·name 필수" }, { status: 400 });
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: "비밀번호는 최소 6자" }, { status: 400 });
    }
    const db = getDb();
    const exists = await db.execute({
      sql: "SELECT id FROM users WHERE email = ?",
      args: [email],
    });
    if (exists.rows.length > 0) {
      return NextResponse.json({ error: "이미 가입된 이메일" }, { status: 409 });
    }
    const hash = await hashPassword(password);
    const ins = await db.execute({
      sql: "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING id",
      args: [email, name, hash],
    });
    const id = Number(ins.rows[0]?.id);
    const token = await signSession({ sub: String(id), email, name });
    await setSessionCookie(token);
    return NextResponse.json({ user: { id, email, name } });
  } catch (err: any) {
    console.error("[signup]", err);
    return NextResponse.json({ error: err?.message || "가입 실패" }, { status: 500 });
  }
}
