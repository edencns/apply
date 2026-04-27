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
      console.error("[client-upload POST] BLOB_READ_WRITE_TOKEN 환경변수 미설정");
      return NextResponse.json(
        { error: "서버 설정 오류: BLOB_READ_WRITE_TOKEN이 Vercel 환경변수에 없습니다. (Settings → Environment Variables)" },
        { status: 500 },
      );
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
          // 같은 파일명을 다시 업로드해도 새로운 path를 받도록 — 이전 실패 업로드의
          // 잔여 메타와 충돌하지 않게 한다. 우리 DB는 url을 유니크 키처럼 사용.
          addRandomSuffix: true,
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
        console.log(`[client-upload onUploadCompleted] url=${blob.url} hasTokenPayload=${!!tokenPayload}`);
        if (!tokenPayload) {
          console.error("[client-upload onUploadCompleted] tokenPayload missing — INSERT 건너뜀");
          return;
        }
        let payload: TokenPayload;
        try {
          payload = JSON.parse(tokenPayload) as TokenPayload;
        } catch (e) {
          console.error("[client-upload onUploadCompleted] tokenPayload 파싱 실패", e);
          return;
        }
        try {
          const db = getDb();
          // 멱등성: 같은 url로 이미 row가 있으면 그대로 사용 (Vercel 콜백이 재시도되는
          // 케이스 안전망). addRandomSuffix=true로 충돌 자체는 거의 없지만,
          // Vercel이 같은 콜백을 재시도하면 중복 INSERT가 될 수 있어 가드.
          const dup = await db.execute({
            sql: "SELECT id FROM files WHERE url=? LIMIT 1",
            args: [blob.url],
          });
          let id: number;
          if (dup.rows.length > 0) {
            id = Number(dup.rows[0].id);
            console.log(`[client-upload onUploadCompleted] 기존 row 재사용 id=${id}`);
          } else {
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
            id = Number(ins.rows[0]?.id);
            console.log(`[client-upload onUploadCompleted] INSERT 성공 id=${id}`);
          }

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
 * Blob 업로드 완료 후 클라이언트가 직접 호출 — files 테이블에 메타 등록.
 *
 * 왜 onUploadCompleted 웹훅에 의존하지 않나:
 *   Vercel Blob의 onUploadCompleted는 Blob CDN → 우리 서버로 fire되는 webhook이라
 *   네트워크/콜드스타트로 인해 누락·지연되는 경우가 종종 있음 (배포·라우트 캐시,
 *   Edge → Region 라우팅 등). 그러면 클라가 GET 폴링으로 50초를 기다려도 INSERT가
 *   되지 않아 504. 클라이언트는 upload() 반환값으로 이미 url을 알고 있으므로
 *   직접 PUT 한 번으로 등록하는 편이 훨씬 안정적이다.
 *
 * GET ?url=... — 레거시 폴링 호환용 (혹시 onUploadCompleted가 먼저 끝났으면 사용)
 * PUT body:{url, filename, kind?, announcement_id?} — 정식 등록 경로
 */
async function registerBlobFile(params: {
  userId: number;
  url: string;
  filename: string;
  kind: string;
  announcementId: number | null;
  contentType: string | null;
  size: number | null;
}): Promise<{ id: number; filename: string }> {
  const db = getDb();
  // 멱등: 같은 url이 이미 있으면 그 id 재사용
  const dup = await db.execute({
    sql: "SELECT id, filename FROM files WHERE url=? LIMIT 1",
    args: [params.url],
  });
  if (dup.rows.length > 0) {
    return {
      id: Number(dup.rows[0].id),
      filename: String(dup.rows[0].filename),
    };
  }
  const ins = await db.execute({
    sql: `INSERT INTO files (user_id, announcement_id, kind, filename, content_type, size, url)
          VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [
      params.userId,
      params.announcementId,
      params.kind,
      params.filename,
      params.contentType,
      params.size,
      params.url,
    ],
  });
  return {
    id: Number(ins.rows[0]?.id),
    filename: params.filename,
  };
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const userId = Number(session.sub);

    const body = await req.json();
    const url = String(body?.url || "");
    const filename = String(body?.filename || "file");
    const kind = String(body?.kind || "other");
    const announcementId = body?.announcement_id != null ? Number(body.announcement_id) : null;
    const contentType = body?.contentType ? String(body.contentType) : null;
    const size = body?.size != null ? Number(body.size) : null;

    if (!url || !url.startsWith("https://")) {
      return NextResponse.json({ error: "잘못된 url" }, { status: 400 });
    }
    // 보안: 우리 Blob 도메인만 허용 — 외부 url 등록 차단
    if (!/\.blob\.vercel-storage\.com\//.test(url)) {
      return NextResponse.json({ error: "허용되지 않은 호스트" }, { status: 400 });
    }

    const result = await registerBlobFile({
      userId, url, filename, kind, announcementId, contentType, size,
    });

    // 부수효과 — fire-and-forget
    (async () => {
      try {
        await logAudit({
          session, entity: "file", entity_id: result.id, action: "create",
          after: { filename, kind, announcement_id: announcementId, client_upload: true },
          req,
        });
      } catch (e) { console.error("[client-upload PUT] audit 실패", e); }
      try {
        await broadcast("file:uploaded", {
          id: result.id,
          announcement_id: announcementId ?? undefined,
          by: userId,
        });
      } catch (e) { console.error("[client-upload PUT] broadcast 실패", e); }
    })();

    return NextResponse.json({
      id: result.id,
      filename: result.filename,
      url: `/api/files/${result.id}/download`,
    });
  } catch (err: any) {
    console.error("[client-upload PUT]", err);
    return NextResponse.json({ error: err?.message || "등록 실패" }, { status: 500 });
  }
}

/** 레거시 호환: onUploadCompleted webhook 정상 동작 시 폴링으로 id 조회 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const url = req.nextUrl.searchParams.get("url");
    if (!url) return NextResponse.json({ error: "url 파라미터 필요" }, { status: 400 });

    // 짧게만 폴링 (5초). 그래도 없으면 클라가 PUT으로 fallback 호출.
    const db = getDb();
    const delays = [0, 100, 200, 300, 500, 700, 1000, 1500, 2000];
    let elapsed = 0;
    let found: { id: number; filename: string } | null = null;
    for (let i = 0; elapsed < 5_000; i++) {
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
      // 클라가 PUT으로 직접 등록하도록 404 신호 — 504보다 의미 명확
      return NextResponse.json(
        { error: "메타 미기록 — 클라이언트에서 PUT으로 직접 등록 필요" },
        { status: 404 },
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
