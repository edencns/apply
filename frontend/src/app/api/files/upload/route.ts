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
import { broadcast } from "@/lib/realtime/ably-server";
import { guardRequest } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { validateFileContent } from "@/lib/file-validate";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png", "image/jpeg", "image/jpg", "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.ms-excel", // xls
  "text/csv",
  "application/zip",
]);

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const userId = Number(session.sub);

    // CSRF + rate limit (세션당 분당 30회)
    const guard = guardRequest(req, "files-upload", { max: 30, windowMs: 60_000 }, String(userId));
    if (!guard.ok) return guard.response;

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN 미설정" }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const kind = String(form.get("kind") || "other");
    const annIdRaw = form.get("announcement_id");
    const announcementId = annIdRaw ? Number(annIdRaw) : null;
    if (!file) return NextResponse.json({ error: "file 없음" }, { status: 400 });

    // 파일 크기·MIME 검증
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `파일이 너무 큽니다. 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 413 },
      );
    }
    if (file.type && !ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: `지원하지 않는 파일 형식: ${file.type}` },
        { status: 415 },
      );
    }

    // 매직 바이트로 실제 파일 종류 검증 (확장자·MIME 위조 방어)
    const headerBytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    const contentCheck = validateFileContent(headerBytes, kind);
    if (!contentCheck.ok) {
      return NextResponse.json(
        { error: contentCheck.reason },
        { status: 415 },
      );
    }

    // 파일명 보안 강화: 제어문자·경로 문자 제거, 한글만 허용
    const rawName = file.name || "file";
    const safeName = rawName
      .replace(/\.\./g, "_")             // path traversal
      .replace(/[\x00-\x1f\x7f]/g, "_")  // 제어문자
      .replace(/[^\w\.\-가-힣]/g, "_")    // 허용 외 문자
      .slice(0, 200);                     // 길이 제한
    // 충돌 방지용 짧은 hash를 prefix로
    const rand = Math.random().toString(36).slice(2, 10);
    const key = `${userId}/${kind}/${Date.now()}_${rand}_${safeName}`;
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
    await logAudit({
      session, entity: "file", entity_id: id, action: "create",
      after: { filename: file.name, size: file.size, kind, announcement_id: announcementId },
      req,
    });
    await broadcast("file:uploaded", {
      id, announcement_id: announcementId ?? undefined, by: userId,
    });

    // 클라이언트에는 Blob 직접 URL 대신 인증된 프록시 경로만 노출
    const proxyUrl = `/api/files/${id}/download`;
    return NextResponse.json({
      id, url: proxyUrl, filename: file.name,
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
    // 공유 모드: announcement_id가 지정되면 해당 공고의 모든 파일 반환 (업무 공유 목적)
    // announcement_id 없으면 본인 업로드만 — 무차별 덤프 방지
    const res = annIdRaw
      ? await db.execute({
          sql: "SELECT id, user_id, kind, filename, content_type, size, uploaded_at FROM files WHERE announcement_id=? ORDER BY id DESC",
          args: [Number(annIdRaw)],
        })
      : await db.execute({
          sql: "SELECT id, user_id, kind, filename, content_type, size, uploaded_at FROM files WHERE user_id=? ORDER BY id DESC LIMIT 200",
          args: [userId],
        });
    // 원본 Blob URL은 응답에서 제외. 클라이언트는 프록시 URL만 사용
    const mapped = res.rows.map((row: any) => ({
      ...row,
      url: `/api/files/${row.id}/download`,
    }));
    return NextResponse.json(mapped);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
