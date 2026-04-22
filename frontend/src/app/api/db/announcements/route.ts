import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, parseRowData, stringifyData } from "@/lib/db/turso";

export const runtime = "nodejs";

/** GET /api/db/announcements → 모든 공고 */
export async function GET() {
  try {
    await ensureSchema();
    const db = getDb();
    const res = await db.execute("SELECT data FROM announcements ORDER BY id DESC");
    const rows = res.rows.map((r) => parseRowData<any>(r));
    return NextResponse.json(rows);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

/** POST /api/db/announcements — 신규 등록 (id 자동/수동) */
export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json();
    if (!body?.title) return NextResponse.json({ error: "title 필수" }, { status: 400 });
    const db = getDb();

    const id = body.id ?? Date.now();
    const ann = { ...body, id };
    await db.execute({
      sql: `INSERT INTO announcements (id, site_id, title, announcement_no, status, data)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              site_id=excluded.site_id, title=excluded.title,
              announcement_no=excluded.announcement_no, status=excluded.status,
              data=excluded.data, updated_at=datetime('now')`,
      args: [
        id,
        ann.site_id ?? null,
        ann.title,
        ann.announcement_no ?? null,
        ann.status ?? "draft",
        stringifyData(ann),
      ],
    });
    return NextResponse.json(ann);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
