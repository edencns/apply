/**
 * 원본 파일(공고 PDF 등)을 Vercel Blob에 저장하고 메타를 Turso files 테이블에 기록.
 *
 * POST /api/files/upload
 *   FormData: file, kind ('announcement'|'customer'|'other'), announcement_id?
 */

import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db/turso";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const userId = Number(session.sub);

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN 미설정" }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const kind = String(form.get("kind") || "other");
    const annIdRaw = form.get("announcement_id");
    const announcementId = annIdRaw ? Number(annIdRaw) : null;
    if (!file) return NextResponse.json({ error: "file 없음" }, { status: 400 });

    const safeName = file.name.replace(/[^\w\.\-가-힣]/g, "_");
    const key = `${userId}/${kind}/${Date.now()}_${safeName}`;
    const blob = await put(key, file, { access: "public", contentType: file.type || "application/octet-stream" });

    const db = getDb();
    const ins = await db.execute({
      sql: `INSERT INTO files (user_id, announcement_id, kind, filename, content_type, size, url)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      args: [
        userId, announcementId, kind,
        file.name, file.type || null, file.size || null,
        blob.url,
      ],
    });
    const id = Number(ins.rows[0]?.id);

    return NextResponse.json({
      id, url: blob.url, filename: file.name,
      contentType: file.type, size: file.size, kind,
    });
  } catch (err: any) {
    console.error("[files/upload]", err);
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const userId = Number(session.sub);
    const annIdRaw = req.nextUrl.searchParams.get("announcement_id");

    const db = getDb();
    const res = annIdRaw
      ? await db.execute({
          sql: "SELECT id, kind, filename, content_type, size, url, uploaded_at FROM files WHERE announcement_id=? ORDER BY id DESC",
          args: [Number(annIdRaw)],
        })
      : await db.execute("SELECT id, kind, filename, content_type, size, url, uploaded_at FROM files ORDER BY id DESC LIMIT 200");
    return NextResponse.json(res.rows);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
