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
 *
 * 진단을 위해 각 단계마다 console.log로 상황을 남깁니다 — 업로드가 멈추면
 * 브라우저 DevTools(F12) Console에서 어느 단계인지 확인 가능.
 */

import { upload } from "@vercel/blob/client";

export interface ClientUploadResult {
  id: number;
  url: string;        // 우리 프록시 URL (/api/files/{id}/download)
  filename: string;
}

const log = (...args: any[]) => {
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.log("[client-upload]", ...args);
  }
};

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

  // file.type이 비어 있거나 octet-stream인 경우 확장자로 보정 — 서버의
  // allowedContentTypes 검증을 통과시키기 위함.
  const guessTypeByExt = (name: string): string | undefined => {
    const m = name.toLowerCase().match(/\.(pdf|png|jpe?g|webp|xlsx|xls|csv|zip)$/);
    if (!m) return undefined;
    switch (m[1]) {
      case "pdf": return "application/pdf";
      case "png": return "image/png";
      case "jpg":
      case "jpeg": return "image/jpeg";
      case "webp": return "image/webp";
      case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      case "xls": return "application/vnd.ms-excel";
      case "csv": return "text/csv";
      case "zip": return "application/zip";
    }
    return undefined;
  };
  const explicitType = (() => {
    const t = file.type;
    if (t && t !== "application/octet-stream") return t;
    return guessTypeByExt(file.name) || "application/octet-stream";
  })();

  log(`▶ 업로드 시작: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`, {
    type: explicitType,
    kind,
    announcement_id: announcementId,
  });

  let blob;
  try {
    blob = await upload(safeName, file, {
      access: "public",
      handleUploadUrl: "/api/files/client-upload",
      contentType: explicitType,
      clientPayload: JSON.stringify({
        kind,
        announcement_id: announcementId,
        filename: file.name,
      }),
    });
  } catch (e: any) {
    log(`✕ Blob 업로드 단계 실패 (${file.name}):`, e);
    // Vercel Blob의 에러 메시지를 그대로 노출 — 토큰 권한, 크기, 타입 등 원인 식별
    throw new Error(`Blob 업로드 실패: ${e?.message || e}`);
  }

  log(`✓ Blob 업로드 완료: ${blob.url}`);

  // 클라이언트가 직접 PUT으로 메타 등록 — onUploadCompleted webhook에 의존하지 않음.
  // (webhook은 누락·지연되는 경우가 있어 폴링이 504로 끝나는 문제 발생)
  log(`▶ DB 등록 요청 (PUT): ${blob.url}`);
  const regStart = Date.now();
  const reg = await fetch("/api/files/client-upload", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: blob.url,
      filename: file.name,
      kind,
      announcement_id: announcementId,
      contentType: explicitType,
      size: file.size,
    }),
  });
  const regMs = Date.now() - regStart;
  log(`◆ DB 등록 응답: status=${reg.status} (${regMs}ms)`);

  if (!reg.ok) {
    let detail = "";
    try {
      const j = await reg.json();
      detail = j?.error || JSON.stringify(j);
    } catch {
      detail = await reg.text().catch(() => "");
    }
    log(`✕ DB 등록 실패: ${detail}`);
    throw new Error(detail || `DB 등록 실패 (HTTP ${reg.status})`);
  }
  const data = await reg.json();
  log(`✓ 등록 완료: id=${data.id}, url=${data.url}`);
  return {
    id: data.id,
    url: data.url,
    filename: data.filename,
  };
}
