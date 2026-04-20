/**
 * PDF 텍스트 추출 전용 엔드포인트
 * - 한글 CMap 로드된 unpdf로 텍스트만 뽑아 반환
 * - 클라이언트 쪽 winner-ingest 파서가 이 텍스트를 소비
 */

import { NextRequest, NextResponse } from "next/server";
import { extractKoreanPdfText } from "@/lib/pdf-helper";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "file 필드가 필요합니다" }, { status: 400 });
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
