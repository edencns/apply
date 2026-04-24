import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, parseRowData, stringifyData } from "@/lib/db/turso";
import { getSession } from "@/lib/auth";
import { broadcast } from "@/lib/realtime/ably-server";
import { logAudit } from "@/lib/audit";
import { guardRequest } from "@/lib/rate-limit";
import { encryptField, decryptField } from "@/lib/field-crypto";

export const runtime = "nodejs";

/** 공유 모드: user_id 필터 없음 */

export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const annIdRaw = req.nextUrl.searchParams.get("announcement_id");
    const db = getDb();
    const res = annIdRaw
      ? await db.execute({
          sql: "SELECT data FROM customers WHERE announcement_id=? ORDER BY id DESC",
          args: [Number(annIdRaw)],
        })
      : await db.execute("SELECT data FROM customers ORDER BY id DESC LIMIT 2000");
    return NextResponse.json(res.rows.map((r) => {
      const c = parseRowData<any>(r);
      if (c?.rrn_back) c.rrn_back = decryptField(c.rrn_back);
      if (Array.isArray(c?.household_members)) {
        c.household_members = c.household_members.map((m: any) => {
          if (m?.rrn_back) return { ...m, rrn_back: decryptField(m.rrn_back) };
          return m;
        });
      }
      return c;
    }));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const guard = guardRequest(req, "customer-mutation", { max: 120, windowMs: 60_000 }, String(session.sub));
    if (!guard.ok) return guard.response;
    const userId = Number(session.sub);
    const body = await req.json();
    if (!body?.announcement_id || !body?.name) {
      return NextResponse.json({ error: "announcement_id, name 필수" }, { status: 400 });
    }
    const db = getDb();
    const id = body.id ?? Date.now();
    const cust = { ...body, id };
    // 저장 직전 rrn_back 암호화
    const custForStorage: any = { ...cust };
    if (custForStorage.rrn_back) custForStorage.rrn_back = encryptField(String(custForStorage.rrn_back));
    if (Array.isArray(custForStorage.household_members)) {
      custForStorage.household_members = custForStorage.household_members.map((m: any) =>
        m?.rrn_back ? { ...m, rrn_back: encryptField(String(m.rrn_back)) } : m,
      );
    }
    await db.execute({
      sql: `INSERT INTO customers (id, user_id, announcement_id, site_id, name, rrn_front, rrn_back,
              is_standby, supply_type, unit_type, superseded, verification_verdict, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              announcement_id=excluded.announcement_id, name=excluded.name,
              data=excluded.data, updated_at=datetime('now')`,
      args: [
        id, userId, cust.announcement_id,
        cust.site_id ?? null, cust.name,
        cust.rrn_front ?? null, custForStorage.rrn_back ?? null,
        cust.is_standby ? 1 : 0,
        cust.supply_type ?? null, cust.unit_type ?? null,
        cust.superseded ? 1 : 0,
        cust.verification_verdict ?? null,
        stringifyData(custForStorage),
      ],
    });
    const isNew = !body.id;
    await logAudit({
      session, entity: "customer", entity_id: Number(id),
      action: isNew ? "create" : "update",
      after: { name: cust.name, announcement_id: cust.announcement_id, verdict: cust.verification_verdict ?? null },
      req,
    });
    await broadcast(isNew ? "customer:created" : "customer:updated", {
      id, announcement_id: cust.announcement_id, by: userId,
    });
    return NextResponse.json(cust);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const guard = guardRequest(req, "customer-mutation", { max: 30, windowMs: 60_000 }, String(session.sub));
    if (!guard.ok) return guard.response;
    const idsParam = req.nextUrl.searchParams.get("ids") || "";
    const ids = idsParam.split(",").map((s) => Number(s)).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return NextResponse.json({ error: "ids 필요" }, { status: 400 });
    const db = getDb();
    const placeholders = ids.map(() => "?").join(",");
    await db.execute({
      sql: `DELETE FROM customers WHERE id IN (${placeholders})`,
      args: ids,
    });
    // 대량 삭제도 감사 — 각 id별로 기록
    for (const delId of ids) {
      await logAudit({
        session, entity: "customer", entity_id: delId, action: "delete",
        after: { bulk: true, total_in_request: ids.length },
        req,
      });
    }
    await broadcast("customer:deleted", { ids, by: Number(session.sub) });
    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
