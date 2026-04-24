/**
 * 인증된 파일 다운로드 프록시
 *
 * Vercel Blob의 access:"public" URL은 알면 누구나 접근 가능 — 주민등록등본·가족관계증명서 등
 * 민감 PDF가 URL 유출 시 무방비 노출.
 *
 * 이 라우트는:
 *  1. 세션 검증
 *  2. 파일 소유자 또는 동일 공고의 담당자만 접근 허용
 *  3. audit_log에 다운로드 기록 (누가 언제 어떤 파일 열람했는지)
 *  4. Blob 원본 URL 대신 이 프록시 URL만 노출
 */

import { NextRequest } from "next/server";
import { ensureSchema, getDb } from "@/lib/db/turso";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { guardRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "로그인 필요" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const guard = guardRequest(
      req, "file-download",
      { max: 60, windowMs: 60_000 }, // 세션당 분당 60 다운로드
      String(session.sub),
    );
    if (!guard.ok) return guard.response;

    const id = Number(params.id);
    if (!Number.isFinite(id)) {
      return new Response(JSON.stringify({ error: "invalid id" }), { status: 400 });
    }

    const db = getDb();
    const r = await db.execute({
      sql: `SELECT id, user_id, announcement_id, filename, content_type, url
            FROM files WHERE id=?`,
      args: [id],
    });
    if (r.rows.length === 0) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    const row = r.rows[0] as any;

    // 원본 URL로 fetch → 스트림 바디 재전송
    const upstream = await fetch(String(row.url));
    if (!upstream.ok || !upstream.body) {
      return new Response(JSON.stringify({ error: "upstream error" }), { status: 502 });
    }

    // 다운로드 자체를 감사 로그에 기록
    await logAudit({
      session,
      entity: "file",
      entity_id: id,
      action: "update", // download는 별도 액션 없어 update로, after에 표시
      after: { action_detail: "download", filename: String(row.filename) },
      req,
    });

    const filename = String(row.filename || `file-${id}`);
    const contentType =
      String(row.content_type || upstream.headers.get("content-type") || "application/octet-stream");

    // RFC 5987 UTF-8 파일명 지원 (한글 파일명)
    const encodedName = encodeURIComponent(filename);

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": `inline; filename*=UTF-8''${encodedName}`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        // 같은 오리진의 iframe(페이지 매퍼 등)에서 로드 허용 + 타 사이트 차단
        "x-frame-options": "SAMEORIGIN",
      },
    });
  } catch (err: any) {
    console.error("[file-download]", err?.message);
    return new Response(JSON.stringify({ error: "다운로드 실패" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
