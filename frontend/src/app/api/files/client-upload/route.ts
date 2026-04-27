/**
 * 클라이언트 직접 업로드 핸들러 (Vercel Blob client upload).
 *
 * Vercel 서버리스 함수의 본문 크기 제한(무료 플랜 ~4.5MB)을 우회하기 위해
 * 클라이언트가 Blob CDN에 직접 업로드하고, 이 라우트는 토큰 발급과
 * 업로드 완료 콜백만 처리한다 (요청·응답 본문은 작음).
 *
 * 흐름:
 *   1. 클라: `upload(...)` 호출 → 이 라우트로 작은 메타데이터 POST
 *   2. 서버: handleUpload가 onBeforeGenerateToken에서 권한·메타 검증 후 토큰 반환
 *   3. 클라: 받은 토큰으로 Blob CDN에 직접 업로드 (라우트 우회)
 *   4. Blob: 업로드 완료 시 onUploadCompleted 콜백으로 우리 서버에 통지 → DB 기록
 */

import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getSession } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db/turso";
import { broadcast } from "@/lib/realtime/ably-server";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — 묶음 PDF 23~30페이지 대응
const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/png", "image/jpeg", "image/jpg", "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/zip",
];

/**
 * tokenPayload에 담아 onUploadCompleted까지 가져갈 메타.
 * 클라이언트는 이를 임의로 변경할 수 없도록 onBeforeGenerateToken에서 우리가 직접 만든다.
 */
type TokenPayload = {
  userId: number;
  kind: string;
  announcementId: number | null;
  origFilename: string;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const userId = Number(session.sub);
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN 미설정" }, { status: 500 });
    }

    const body = (await req.json()) as HandleUploadBody;

    const json = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname: string, clientPayload?: string | null) => {
        // clientPayload는 클라가 보낸 hint(JSON: { kind, announcement_id, filename })
        let kind = "other";
        let announcementId: number | null = null;
        let origFilename = pathname;
        try {
          if (clientPayload) {
            const p = JSON.parse(clientPayload);
            if (p?.kind) kind = String(p.kind);
            if (p?.announcement_id) announcementId = Number(p.announcement_id) || null;
            if (p?.filename) origFilename = String(p.filename);
          }
        } catch { /* ignore — 기본값 사용 */ }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_FILE_SIZE,
          tokenPayload: JSON.stringify({
            userId,
            kind,
            announcementId,
            origFilename,
          } satisfies TokenPayload),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Blob CDN 업로드 완료 시 호출 — DB에 메타 기록
        if (!tokenPayload) return;
        let payload: TokenPayload;
        try {
          payload = JSON.parse(tokenPayload) as TokenPayload;
        } catch {
          return;
        }
        try {
          const db = getDb();
          const ins = await db.execute({
            sql: `INSERT INTO files (user_id, announcement_id, kind, filename, content_type, size, url)
                  VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
            args: [
              payload.userId,
              payload.announcementId,
              payload.kind,
              payload.origFilename,
              blob.contentType || null,
              null, // 클라 업로드라 정확한 size를 모를 수 있음 — 다운로드 시 Blob에서 조회 가능
              blob.url,
            ],
          });
          const id = Number(ins.rows[0]?.id);
          await logAudit({
            session,
            entity: "file",
            entity_id: id,
            action: "create",
            after: {
              filename: payload.origFilename,
              kind: payload.kind,
              announcement_id: payload.announcementId,
              client_upload: true,
            },
            req,
          });
          await broadcast("file:uploaded", {
            id,
            announcement_id: payload.announcementId ?? undefined,
            by: payload.userId,
          });
        } catch (err) {
          console.error("[client-upload] DB insert 실패", err);
        }
      },
    });

    return NextResponse.json(json);
  } catch (err: any) {
    console.error("[client-upload]", err);
    return NextResponse.json(
      { error: err?.message || "client upload 실패" },
      { status: 400 },
    );
  }
}

/**
 * 클라이언트가 Blob 업로드 완료 후, 방금 등록된 파일의 우리 DB id를
 * 알아내기 위한 작은 헬퍼. blob.url을 받아 files.id를 돌려준다.
 *
 * (handleUpload onUploadCompleted는 Blob CDN이 별도로 호출하므로 클라이언트는
 *  그 응답을 직접 받을 수 없음 — 그래서 url로 id를 다시 조회.)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const url = req.nextUrl.searchParams.get("url");
    if (!url) return NextResponse.json({ error: "url 파라미터 필요" }, { status: 400 });

    // 짧은 폴링: onUploadCompleted가 비동기라 잠시 기다려야 할 수 있음
    const db = getDb();
    let found: { id: number; filename: string } | null = null;
    for (let i = 0; i < 12; i++) {
      const r = await db.execute({
        sql: "SELECT id, filename FROM files WHERE url=? ORDER BY id DESC LIMIT 1",
        args: [url],
      });
      if (r.rows.length > 0) {
        found = { id: Number(r.rows[0].id), filename: String(r.rows[0].filename) };
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!found) return NextResponse.json({ error: "메타 기록 대기 시간 초과" }, { status: 504 });

    return NextResponse.json({
      id: found.id,
      filename: found.filename,
      url: `/api/files/${found.id}/download`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
