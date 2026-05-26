import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db/turso";
import { getSession, hashPassword, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { validatePassword } from "@/lib/password-policy";

export const runtime = "nodejs";

type IdRouteContext = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: IdRouteContext) {
  try {
    const session = await getSession();
    const guard = requireAdmin(session);
    if (!guard.ok) return guard.response;
    await ensureSchema();
    const { id: rawId } = await params;
    const id = Number(rawId);
    // 자기 자신 삭제 방지 (관리자 lockout 예방)
    if (String(guard.session.sub) === String(id)) {
      return NextResponse.json({ error: "자기 자신은 삭제할 수 없습니다" }, { status: 400 });
    }
    const db = getDb();
    const before = await db.execute({
      sql: "SELECT email, name, role FROM users WHERE id=?",
      args: [id],
    });
    await db.execute({ sql: "DELETE FROM users WHERE id=?", args: [id] });
    await logAudit({
      session: guard.session, entity: "user", entity_id: id, action: "delete",
      before: before.rows[0] || null, req,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

/** 비밀번호 재설정 / 이름 변경 — 관리자 전용 */
export async function PUT(req: NextRequest, { params }: IdRouteContext) {
  try {
    const session = await getSession();
    const guard = requireAdmin(session);
    if (!guard.ok) return guard.response;
    await ensureSchema();
    const { id: rawId } = await params;
    const id = Number(rawId);
    const { password, name } = await req.json();
    const db = getDb();

    const updates: string[] = [];
    const args: any[] = [];
    const auditAfter: any = {};
    if (password) {
      const pwCheck = validatePassword(String(password), { name });
      if (!pwCheck.ok) {
        return NextResponse.json(
          { error: "비밀번호 정책 위반", detail: pwCheck.issues },
          { status: 400 },
        );
      }
      const hash = await hashPassword(password);
      updates.push("password_hash = ?");
      args.push(hash);
      auditAfter.password_changed = true;
    }
    if (name) {
      updates.push("name = ?");
      args.push(name);
      auditAfter.name = name;
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: "수정할 내용 없음" }, { status: 400 });
    }
    args.push(id);
    await db.execute({
      sql: `UPDATE users SET ${updates.join(", ")} WHERE id=?`,
      args,
    });
    await logAudit({
      session: guard.session, entity: "user", entity_id: id, action: "update",
      after: auditAfter, req,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
