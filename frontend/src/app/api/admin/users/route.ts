import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db/turso";
import { getSession, hashPassword, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { validatePassword } from "@/lib/password-policy";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getSession();
    const guard = requireAdmin(session);
    if (!guard.ok) return guard.response;
    await ensureSchema();
    const db = getDb();
    const r = await db.execute(
      "SELECT id, email, name, role, created_at FROM users ORDER BY id DESC",
    );
    return NextResponse.json(r.rows);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const guard = requireAdmin(session);
    if (!guard.ok) return guard.response;
    await ensureSchema();
    const { email, name, password, role } = await req.json();
    if (!email || !name || !password) {
      return NextResponse.json({ error: "email·name·password 필수" }, { status: 400 });
    }
    const pwCheck = validatePassword(String(password), { email, name });
    if (!pwCheck.ok) {
      return NextResponse.json(
        { error: "비밀번호 정책 위반", detail: pwCheck.issues },
        { status: 400 },
      );
    }
    const safeRole: "admin" | "staff" = role === "admin" ? "admin" : "staff";
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
      sql: "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id",
      args: [email, name, hash, safeRole],
    });
    const newId = Number(ins.rows[0]?.id);
    await logAudit({
      session: guard.session, entity: "user", entity_id: newId, action: "create",
      after: { email, name, role: safeRole }, req,
    });
    return NextResponse.json({
      id: newId,
      email, name, role: safeRole,
      created_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[admin/users POST]", err);
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

/** 사용자 role 변경 — 관리자 전용 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession();
    const guard = requireAdmin(session);
    if (!guard.ok) return guard.response;
    await ensureSchema();
    const { id, role } = await req.json();
    if (!id || !role) {
      return NextResponse.json({ error: "id·role 필수" }, { status: 400 });
    }
    const safeRole: "admin" | "staff" = role === "admin" ? "admin" : "staff";
    const db = getDb();
    const before = await db.execute({
      sql: "SELECT role FROM users WHERE id=?",
      args: [Number(id)],
    });
    if (before.rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    await db.execute({
      sql: "UPDATE users SET role=? WHERE id=?",
      args: [safeRole, Number(id)],
    });
    await logAudit({
      session: guard.session, entity: "user", entity_id: Number(id), action: "role_change",
      before: { role: String((before.rows[0] as any).role) },
      after: { role: safeRole }, req,
    });
    return NextResponse.json({ ok: true, id: Number(id), role: safeRole });
  } catch (err: any) {
    console.error("[admin/users PATCH]", err);
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
