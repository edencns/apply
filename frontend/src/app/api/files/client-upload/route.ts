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
  // 일부 스캐너·OS는 PDF 파일에 application/octet-stream을 붙여 보냄 — 인증된 사용자의
  // 업로드만 들어오므로 안전망으로 허용. 실제 형식은 클라 측에서 확장자로 검증.
  "application/octet-stream",
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
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN 미설정" }, { status: 500 });
    }

    // 두 가지 요청이 들어옴:
    //  ① 토큰 발급 (블롭.generate-client-token)  ← 사용자 세션 보유
    //  ② 업로드 완료 통지 (blob.upload-completed) ← Vercel Blob 인프라가 직접 호출 — 세션 없음
    // 세션 체크는 onBeforeGenerateToken 안에서만 수행해야 ②가 401로 깨지지 않음.
    const body = (await req.json()) as HandleUploadBody;

    const json = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname: string, clientPayload?: string | null) => {
        // 인증·권한 검증 — 이 콜백 안에서만 사용자 세션 확인
        const session = await getSession();
        if (!session) throw new Error("로그인 필요");
        const userId = Number(session.sub);

        // clientPayload: { kind, announcement_id, filename }
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
        // Blob CDN 업로드 완료 통지 — Vercel 서버에서 호출 (사용자 세션 없음).
        // tokenPayload는 onBeforeGenerateToken에서 우리가 서명·발급한 값이라 신뢰 가능.
        // ★ INSERT는 즉시 실행, 부수효과(audit·broadcast)는 fire-and-forget으로 분리 →
        //   클라이언트의 폴링이 INSERT 직후 바로 결과를 받을 수 있게 함.
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
              null,
              blob.url,
            ],
          });
          const id = Number(ins.rows[0]?.id);

          // 부수효과는 INSERT 응답을 막지 않도록 비동기로 실행 (오류는 로그만)
          (async () => {
            try {
              await logAudit({
                session: {
                  sub: String(payload.userId),
                  email: "",
                  name: "",
                  role: "manager" as any,
                },
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
            } catch (e) { console.error("[client-upload] audit 실패", e); }
            try {
              await broadcast("file:uploaded", {
                id,
                announcement_id: payload.announcementId ?? undefined,
                by: payload.userId,
              });
            } catch (e) { console.error("[client-upload] broadcast 실패", e); }
          })();
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

    // 폴링: 첫 번째는 즉시(0ms 대기), 이후 점진 증가 — 대부분 1초 내 발견.
    // 최악(콜드스타트)에도 ~20초 안에 결과.
    const db = getDb();
    let found: { id: number; filename: string } | null = null;
    const delays = [0, 100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000];
    let elapsed = 0;
    for (let i = 0; elapsed < 25_000; i++) {
      const wait = delays[Math.min(i, delays.length - 1)];
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      elapsed += wait;
      const r = await db.execute({
        sql: "SELECT id, filename FROM files WHERE url=? ORDER BY id DESC LIMIT 1",
        args: [url],
      });
      if (r.rows.length > 0) {
        found = { id: Number(r.rows[0].id), filename: String(r.rows[0].filename) };
        break;
      }
    }
    if (!found) {
      return NextResponse.json(
        { error: "업로드 메타 기록 대기 시간 초과 — 다시 시도해 주세요" },
        { status: 504 },
      );
    }

    return NextResponse.json({
      id: found.id,
      filename: found.filename,
      url: `/api/files/${found.id}/download`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
