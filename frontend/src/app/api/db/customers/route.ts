import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, parseRowData, stringifyData } from "@/lib/db/turso";

export const runtime = "nodejs";

/** GET /api/db/customers?announcement_id=123 → 해당 공고 고객 전체 */
export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    const annIdRaw = req.nextUrl.searchParams.get("announcement_id");
    const db = getDb();
    const res = annIdRaw
      ? await db.execute({
          sql: "SELECT data FROM customers WHERE announcement_id = ? ORDER BY id DESC",
          args: [Number(annIdRaw)],
        })
      : await db.execute("SELECT data FROM customers ORDER BY id DESC LIMIT 1000");
    const rows = res.rows.map((r) => parseRowData<any>(r));
    return NextResponse.json(rows);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

/** POST /api/db/customers — 신규 고객 등록 */
export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json();
    if (!body?.announcement_id || !body?.name) {
      return NextResponse.json({ error: "announcement_id, name 필수" }, { status: 400 });
    }
    const db = getDb();
    const id = body.id ?? Date.now();
    const cust = { ...body, id };
    await db.execute({
      sql: `INSERT INTO customers (id, announcement_id, site_id, name, rrn_front, rrn_back,
              is_standby, supply_type, unit_type, superseded, verification_verdict, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              announcement_id=excluded.announcement_id,
              name=excluded.name, data=excluded.data, updated_at=datetime('now')`,
      args: [
        id,
        cust.announcement_id,
        cust.site_id ?? null,
        cust.name,
        cust.rrn_front ?? null,
        cust.rrn_back ?? null,
        cust.is_standby ? 1 : 0,
        cust.supply_type ?? null,
        cust.unit_type ?? null,
        cust.superseded ? 1 : 0,
        cust.verification_verdict ?? null,
        stringifyData(cust),
      ],
    });
    return NextResponse.json(cust);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

/** DELETE /api/db/customers?ids=1,2,3 — 일괄 삭제 */
export async function DELETE(req: NextRequest) {
  try {
    await ensureSchema();
    const idsParam = req.nextUrl.searchParams.get("ids") || "";
    const ids = idsParam.split(",").map((s) => Number(s)).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return NextResponse.json({ error: "ids 필요" }, { status: 400 });
    const db = getDb();
    const placeholders = ids.map(() => "?").join(",");
    await db.execute({
      sql: `DELETE FROM customers WHERE id IN (${placeholders})`,
      args: ids,
    });
    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
