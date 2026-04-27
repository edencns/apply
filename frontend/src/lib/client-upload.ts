"use client";

/**
 * 클라이언트 직접 업로드 헬퍼 (Vercel Blob client upload).
 *
 * 큰 파일(>4.5MB)은 서버리스 함수 본문 제한을 우회해 Blob CDN에 직접 업로드.
 * 우리 라우트는 토큰 발급(onBeforeGenerateToken)과 완료 콜백(onUploadCompleted)만 처리.
 *
 * 반환값은 기존 `/api/files/upload` 응답과 동일한 형태:
 *   { id, url, filename }
 * 그래서 호출부 코드를 거의 그대로 재사용 가능.
 */

import { upload } from "@vercel/blob/client";

export interface ClientUploadResult {
  id: number;
  url: string;        // 우리 프록시 URL (/api/files/{id}/download)
  filename: string;
}

export async function uploadFileViaClient(
  file: File,
  opts: {
    kind?: string;
    announcement_id?: number | null;
  } = {},
): Promise<ClientUploadResult> {
  const kind = opts.kind || "other";
  const announcementId = opts.announcement_id ?? null;

  // 파일명 정규화 — 서버에서 한 번 더 sanitize되지만 라우트 매칭이 깨지는 것 방지
  const safeName = (file.name || "file")
    .replace(/[\x00-\x1f\x7f]/g, "_")
    .slice(0, 200);

  const blob = await upload(safeName, file, {
    access: "public",
    handleUploadUrl: "/api/files/client-upload",
    contentType: file.type || undefined,
    clientPayload: JSON.stringify({
      kind,
      announcement_id: announcementId,
      filename: file.name,
    }),
  });

  // Blob CDN이 onUploadCompleted를 비동기로 호출 → DB에 files 레코드 INSERT됨.
  // 그 id를 알아내기 위해 url로 짧게 폴링.
  const lookup = await fetch(
    `/api/files/client-upload?url=${encodeURIComponent(blob.url)}`,
  );
  if (!lookup.ok) {
    const j = await lookup.json().catch(() => ({}));
    throw new Error(j?.error || `메타 조회 실패 (${lookup.status})`);
  }
  const data = await lookup.json();
  return {
    id: data.id,
    url: data.url,
    filename: data.filename,
  };
}
