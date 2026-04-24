/**
 * PDF 텍스트 추출 전용 엔드포인트
 * - 한글 CMap 로드된 unpdf로 텍스트만 뽑아 반환
 * - 클라이언트 쪽 winner-ingest 파서가 이 텍스트를 소비
 */

import { NextRequest, NextResponse } from "next/server";
import { extractKoreanPdfText } from "@/lib/pdf-helper";
import { getSession } from "@/lib/auth";
import { guardRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const guard = guardRequest(
      req, "extract-pdf-text",
      { max: 30, windowMs: 60_000 },
      String(session.sub),
    );
    if (!guard.ok) return guard.response;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "file 필드가 필요합니다" }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "PDF가 너무 큽니다 (최대 20MB)" }, { status: 413 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const text = await extractKoreanPdfText(buf);
    return NextResponse.json({
      text,
      length: text.length,
      fileName: file.name,
    });
  } catch (err: any) {
    console.error("[extract-pdf-text] error", err);
    return NextResponse.json(
      { error: err?.message || "PDF 텍스트 추출 실패" },
      { status: 500 },
    );
  }
}
