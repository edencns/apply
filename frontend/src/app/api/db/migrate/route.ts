/**
 * Turso 스키마 확인 + 선택적으로 localStorage 데이터 일괄 이관
 * POST /api/db/migrate
 *   body: { sites?, announcements?, customers? }
 *   → 기존 레코드는 id 기준 UPSERT (현재 사용자에게만)
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, stringifyData } from "@/lib/db/turso";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const userId = Number(session.sub);

    const body = await req.json().catch(() => ({}));
    const db = getDb();
    const counts = { sites: 0, announcements: 0, customers: 0 };

    if (Array.isArray(body.sites)) {
      for (const s of body.sites) {
        if (!s?.id) continue;
        await db.execute({
          sql: `INSERT INTO sites (id, user_id, name, data) VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  user_id=excluded.user_id, name=excluded.name, data=excluded.data,
                  updated_at=datetime('now')
                WHERE sites.user_id = excluded.user_id`,
          args: [s.id, userId, s.name || "", stringifyData(s)],
        });
        counts.sites++;
      }
    }

    if (Array.isArray(body.announcements)) {
      for (const a of body.announcements) {
        if (!a?.id || !a?.title) continue;
        await db.execute({
          sql: `INSERT INTO announcements (id, user_id, site_id, title, announcement_no, status, data)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  site_id=excluded.site_id, title=excluded.title,
                  announcement_no=excluded.announcement_no, status=excluded.status,
                  data=excluded.data, updated_at=datetime('now')
                WHERE announcements.user_id = excluded.user_id`,
          args: [
            a.id, userId,
            a.site_id ?? null,
            a.title,
            a.announcement_no ?? null,
            a.status ?? null,
            stringifyData(a),
          ],
        });
        counts.announcements++;
      }
    }

    if (Array.isArray(body.customers)) {
      for (const c of body.customers) {
        if (!c?.id || !c?.announcement_id || !c?.name) continue;
        await db.execute({
          sql: `INSERT INTO customers (id, user_id, announcement_id, site_id, name, rrn_front, rrn_back,
                  is_standby, supply_type, unit_type, superseded, verification_verdict, data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  announcement_id=excluded.announcement_id,
                  site_id=excluded.site_id, name=excluded.name,
                  rrn_front=excluded.rrn_front, rrn_back=excluded.rrn_back,
                  is_standby=excluded.is_standby, supply_type=excluded.supply_type,
                  unit_type=excluded.unit_type, superseded=excluded.superseded,
                  verification_verdict=excluded.verification_verdict,
                  data=excluded.data, updated_at=datetime('now')
                WHERE customers.user_id = excluded.user_id`,
          args: [
            c.id, userId, c.announcement_id,
            c.site_id ?? null, c.name,
            c.rrn_front ?? null, c.rrn_back ?? null,
            c.is_standby ? 1 : 0,
            c.supply_type ?? null, c.unit_type ?? null,
            c.superseded ? 1 : 0,
            c.verification_verdict ?? null,
            stringifyData(c),
          ],
        });
        counts.customers++;
      }
    }

    return NextResponse.json({ success: true, counts });
  } catch (err: any) {
    console.error("[db/migrate]", err);
    return NextResponse.json({ error: err?.message || "DB 마이그레이션 실패" }, { status: 500 });
  }
}

export async function GET() {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ ok: false, error: "로그인 필요" }, { status: 401 });
    const userId = Number(session.sub);
    const db = getDb();
    const [sites, anns, custs] = await Promise.all([
      db.execute({ sql: "SELECT COUNT(*) AS n FROM sites WHERE user_id=?", args: [userId] }),
      db.execute({ sql: "SELECT COUNT(*) AS n FROM announcements WHERE user_id=?", args: [userId] }),
      db.execute({ sql: "SELECT COUNT(*) AS n FROM customers WHERE user_id=?", args: [userId] }),
    ]);
    return NextResponse.json({
      ok: true,
      counts: {
        sites: Number(sites.rows[0]?.n ?? 0),
        announcements: Number(anns.rows[0]?.n ?? 0),
        customers: Number(custs.rows[0]?.n ?? 0),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
