/**
 * 감사 로그 조회 — 관리자 전용
 *
 * Query params:
 *   entity     customer | announcement | file | user
 *   entity_id  숫자
 *   user_id    숫자 (누가 한 액션인지)
 *   limit      기본 200, 최대 1000
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db/turso";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const guard = requireAdmin(session);
    if (!guard.ok) return guard.response;
    await ensureSchema();
    const sp = req.nextUrl.searchParams;
    const entity = sp.get("entity");
    const entityId = sp.get("entity_id");
    const userId = sp.get("user_id");
    const limit = Math.min(1000, Math.max(1, Number(sp.get("limit") || 200)));

    const where: string[] = [];
    const args: any[] = [];
    if (entity) {
      where.push("entity = ?");
      args.push(String(entity));
    }
    if (entityId) {
      where.push("entity_id = ?");
      args.push(Number(entityId));
    }
    if (userId) {
      where.push("user_id = ?");
      args.push(Number(userId));
    }
    const sql =
      "SELECT id, ts, user_id, user_email, entity, entity_id, action, before_json, after_json, ip, user_agent FROM audit_log" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY id DESC LIMIT ?";
    args.push(limit);

    const db = getDb();
    const r = await db.execute({ sql, args });
    // audit 조회 자체도 감사 로그에 기록 — 누가 감사 데이터를 열람했는지 추적
    await logAudit({
      session: guard.session,
      entity: "user",
      entity_id: Number(guard.session.sub),
      action: "update",
      after: { action_detail: "audit_read", filters: { entity, entity_id: entityId, user_id: userId }, limit },
      req,
    });
    return NextResponse.json(
      r.rows.map((row: any) => ({
        ...row,
        before: row.before_json ? safeParse(row.before_json) : null,
        after: row.after_json ? safeParse(row.after_json) : null,
      })),
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}
