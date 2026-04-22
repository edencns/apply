import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, parseRowData, stringifyData } from "@/lib/db/turso";
import { getSession } from "@/lib/auth";
import { broadcast } from "@/lib/realtime/ably-server";

export const runtime = "nodejs";

async function fetchOne(id: number) {
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT data FROM customers WHERE id=?",
    args: [id],
  });
  if (r.rows.length === 0) return null;
  return parseRowData<any>(r.rows[0]);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const c = await fetchOne(Number(params.id));
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(c);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const id = Number(params.id);
    const patch = await req.json();
    const existing = await fetchOne(id);
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    const merged = { ...existing, ...patch, id };
    const db = getDb();
    await db.execute({
      sql: `UPDATE customers SET
              announcement_id=?, site_id=?, name=?, rrn_front=?, rrn_back=?,
              is_standby=?, supply_type=?, unit_type=?,
              superseded=?, verification_verdict=?,
              data=?, updated_at=datetime('now')
            WHERE id=?`,
      args: [
        merged.announcement_id, merged.site_id ?? null,
        merged.name, merged.rrn_front ?? null, merged.rrn_back ?? null,
        merged.is_standby ? 1 : 0,
        merged.supply_type ?? null, merged.unit_type ?? null,
        merged.superseded ? 1 : 0,
        merged.verification_verdict ?? null,
        stringifyData(merged), id,
      ],
    });
    await broadcast("customer:updated", {
      id, announcement_id: merged.announcement_id, by: Number(session.sub),
    });
    return NextResponse.json(merged);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const db = getDb();
    const id = Number(params.id);
    await db.execute({
      sql: "DELETE FROM customers WHERE id=?",
      args: [id],
    });
    await broadcast("customer:deleted", { id, by: Number(session.sub) });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
