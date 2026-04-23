/**
 * 고급 분석 엔드포인트 — Phase A 확장 필드 전용
 *
 * /api/parse-announcement-pdf(기본 Core 파서)와 분리.
 * 사용자가 "고급 분석" 버튼을 누르면 동일 PDF를 다시 보내서
 * 확장 필드(주택관리번호/사업주체/지역우선공급/예치금/가점추첨비율/서류상세 등)만 추출.
 *
 * Vercel Hobby 60s 예산 안에서 단일 Gemini 호출만 하므로 안전.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractExtendedWithGemini } from "@/lib/parse-engines/gemini";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Pro 기본.

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "PDF 파일이 필요합니다" }, { status: 400 });
    }
    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    const result = await extractExtendedWithGemini(new Uint8Array(buf));

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error, durationMs: result.durationMs },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      durationMs: result.durationMs,
    });
  } catch (err: any) {
    console.error("[parse-announcement-pdf/extended] error", err);
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
