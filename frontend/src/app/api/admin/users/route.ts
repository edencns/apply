import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db/turso";
import { getSession, hashPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    await ensureSchema();
    const db = getDb();
    const r = await db.execute("SELECT id, email, name, created_at FROM users ORDER BY id DESC");
    return NextResponse.json(r.rows);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    await ensureSchema();
    const { email, name, password } = await req.json();
    if (!email || !name || !password) {
      return NextResponse.json({ error: "email·name·password 필수" }, { status: 400 });
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
      return NextResponse.json({ error: "이미 존재하는 아이디입니다" }, { status: 409 });
    }
    const hash = await hashPassword(password);
    const ins = await db.execute({
      sql: "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING id",
      args: [email, name, hash],
    });
    return NextResponse.json({
      id: Number(ins.rows[0]?.id),
      email, name,
      created_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[admin/users POST]", err);
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
