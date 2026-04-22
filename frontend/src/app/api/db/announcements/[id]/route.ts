import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, parseRowData, stringifyData } from "@/lib/db/turso";
import { getSession } from "@/lib/auth";
import { broadcast } from "@/lib/realtime/ably-server";

export const runtime = "nodejs";

async function fetchOne(id: number) {
  const db = getDb();
  const res = await db.execute({
    sql: "SELECT data FROM announcements WHERE id=?",
    args: [id],
  });
  if (res.rows.length === 0) return null;
  return parseRowData<any>(res.rows[0]);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const ann = await fetchOne(Number(params.id));
    if (!ann) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(ann);
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
      sql: `UPDATE announcements SET
              site_id=?, title=?, announcement_no=?, status=?, data=?, updated_at=datetime('now')
            WHERE id=?`,
      args: [
        merged.site_id ?? null, merged.title,
        merged.announcement_no ?? null, merged.status ?? null,
        stringifyData(merged), id,
      ],
    });
    await broadcast("announcement:updated", { id, by: Number(session.sub) });
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
    const id = Number(params.id);
    const db = getDb();
    await db.execute({ sql: "DELETE FROM announcements WHERE id=?", args: [id] });
    await db.execute({ sql: "DELETE FROM customers WHERE announcement_id=?", args: [id] });
    await broadcast("announcement:deleted", { id, by: Number(session.sub) });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
