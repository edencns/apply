import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, parseRowData, stringifyData } from "@/lib/db/turso";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const userId = Number(session.sub);
    const db = getDb();
    const res = await db.execute({
      sql: "SELECT data FROM announcements WHERE user_id=? ORDER BY id DESC",
      args: [userId],
    });
    return NextResponse.json(res.rows.map((r) => parseRowData<any>(r)));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const userId = Number(session.sub);
    const body = await req.json();
    if (!body?.title) return NextResponse.json({ error: "title 필수" }, { status: 400 });
    const db = getDb();
    const id = body.id ?? Date.now();
    const ann = { ...body, id };
    await db.execute({
      sql: `INSERT INTO announcements (id, user_id, site_id, title, announcement_no, status, data)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              site_id=excluded.site_id, title=excluded.title,
              announcement_no=excluded.announcement_no, status=excluded.status,
              data=excluded.data, updated_at=datetime('now')
            WHERE announcements.user_id = excluded.user_id`,
      args: [
        id, userId,
        ann.site_id ?? null, ann.title,
        ann.announcement_no ?? null, ann.status ?? "draft",
        stringifyData(ann),
      ],
    });
    return NextResponse.json(ann);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
