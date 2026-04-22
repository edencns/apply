import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db/turso";
import { getSession, hashPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    await ensureSchema();
    const id = Number(params.id);
    const db = getDb();
    await db.execute({ sql: "DELETE FROM users WHERE id=?", args: [id] });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

/** 비밀번호 재설정 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    await ensureSchema();
    const id = Number(params.id);
    const { password, name } = await req.json();
    const db = getDb();

    const updates: string[] = [];
    const args: any[] = [];
    if (password) {
      if (String(password).length < 6) {
        return NextResponse.json({ error: "비밀번호는 최소 6자" }, { status: 400 });
      }
      const hash = await hashPassword(password);
      updates.push("password_hash = ?");
      args.push(hash);
    }
    if (name) {
      updates.push("name = ?");
      args.push(name);
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: "수정할 내용 없음" }, { status: 400 });
    }
    args.push(id);
    await db.execute({
      sql: `UPDATE users SET ${updates.join(", ")} WHERE id=?`,
      args,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
