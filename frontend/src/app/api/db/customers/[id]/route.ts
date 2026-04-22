import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, parseRowData, stringifyData } from "@/lib/db/turso";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await ensureSchema();
    const id = Number(params.id);
    const db = getDb();
    const res = await db.execute({
      sql: "SELECT data FROM customers WHERE id=?",
      args: [id],
    });
    if (res.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(parseRowData<any>(res.rows[0]));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await ensureSchema();
    const id = Number(params.id);
    const patch = await req.json();
    const db = getDb();
    const existingRes = await db.execute({
      sql: "SELECT data FROM customers WHERE id=?",
      args: [id],
    });
    if (existingRes.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    const existing = parseRowData<any>(existingRes.rows[0]);
    const merged = { ...existing, ...patch, id };
    await db.execute({
      sql: `UPDATE customers SET
              announcement_id=?, site_id=?, name=?, rrn_front=?, rrn_back=?,
              is_standby=?, supply_type=?, unit_type=?,
              superseded=?, verification_verdict=?,
              data=?, updated_at=datetime('now')
            WHERE id=?`,
      args: [
        merged.announcement_id,
        merged.site_id ?? null,
        merged.name,
        merged.rrn_front ?? null,
        merged.rrn_back ?? null,
        merged.is_standby ? 1 : 0,
        merged.supply_type ?? null,
        merged.unit_type ?? null,
        merged.superseded ? 1 : 0,
        merged.verification_verdict ?? null,
        stringifyData(merged),
        id,
      ],
    });
    return NextResponse.json(merged);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await ensureSchema();
    const id = Number(params.id);
    const db = getDb();
    await db.execute({ sql: "DELETE FROM customers WHERE id=?", args: [id] });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
