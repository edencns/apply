import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, parseRowData, stringifyData } from "@/lib/db/turso";
import { getSession } from "@/lib/auth";
import { broadcast } from "@/lib/realtime/ably-server";
import { logAudit } from "@/lib/audit";
import { guardRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";

type IdRouteContext = { params: Promise<{ id: string }> };

async function fetchOne(id: number) {
  const db = getDb();
  const res = await db.execute({
    sql: "SELECT data FROM announcements WHERE id=?",
    args: [id],
  });
  if (res.rows.length === 0) return null;
  return parseRowData<any>(res.rows[0]);
}

export async function GET(_req: NextRequest, { params }: IdRouteContext) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const { id: rawId } = await params;
    const ann = await fetchOne(Number(rawId));
    if (!ann) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(ann);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: IdRouteContext) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const guard = guardRequest(req, "announcement-mutation", { max: 60, windowMs: 60_000 }, String(session.sub));
    if (!guard.ok) return guard.response;
    const { id: rawId } = await params;
    const id = Number(rawId);
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
    await logAudit({
      session, entity: "announcement", entity_id: id, action: "update",
      before: { title: existing.title, status: existing.status },
      after: { title: merged.title, status: merged.status },
      req,
    });
    await broadcast("announcement:updated", { id, by: Number(session.sub) });
    return NextResponse.json(merged);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: IdRouteContext) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const guard = guardRequest(req, "announcement-mutation", { max: 20, windowMs: 60_000 }, String(session.sub));
    if (!guard.ok) return guard.response;
    const { id: rawId } = await params;
    const id = Number(rawId);
    const existing = await fetchOne(id);
    const db = getDb();
    await db.execute({ sql: "DELETE FROM announcements WHERE id=?", args: [id] });
    await db.execute({ sql: "DELETE FROM customers WHERE announcement_id=?", args: [id] });
    await logAudit({
      session, entity: "announcement", entity_id: id, action: "delete",
      before: existing ? { title: existing.title, status: existing.status } : null,
      req,
    });
    await broadcast("announcement:deleted", { id, by: Number(session.sub) });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
