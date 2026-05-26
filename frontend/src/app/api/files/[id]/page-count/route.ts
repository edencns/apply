/**
 * 파일 ID → PDF 총 페이지 수 반환
 *
 * Vercel Blob에 저장된 PDF를 fetch한 뒤 unpdf로 pagination 정보만 추출.
 * 실제 텍스트 추출은 하지 않아 가볍다 (약 1~2초 내).
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db/turso";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    }
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const db = getDb();
    const r = await db.execute({
      sql: "SELECT url, content_type FROM files WHERE id=?",
      args: [id],
    });
    if (r.rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const row = r.rows[0] as any;
    const contentType = String(row.content_type || "");
    if (!/pdf/i.test(contentType) && !/\.pdf$/i.test(String(row.url))) {
      return NextResponse.json({ error: "PDF 파일이 아님" }, { status: 400 });
    }

    const upstream = await fetch(String(row.url));
    if (!upstream.ok) {
      return NextResponse.json({ error: "Blob fetch 실패" }, { status: 502 });
    }
    const buf = new Uint8Array(await upstream.arrayBuffer());

    // unpdf를 사용해 pagination만 추출 (텍스트 추출 X — 빠름)
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buf);
    const totalPages = pdf.numPages;

    return NextResponse.json({ totalPages });
  } catch (err: any) {
    console.error("[files/page-count]", err?.message);
    return NextResponse.json(
      { error: err?.message || "페이지 수 조회 실패" },
      { status: 500 },
    );
  }
}
