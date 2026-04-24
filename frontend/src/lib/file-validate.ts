/**
 * 파일 매직 바이트 검증
 *
 * 확장자·MIME만 믿지 말고 실제 바이트로 파일 형식 확인.
 * 악성 실행 파일이 PDF로 위장해 업로드되는 상황 방지.
 */

export type DetectedFormat =
  | "pdf"
  | "png" | "jpeg" | "webp"
  | "zip-or-office" // xlsx, docx, pptx는 모두 ZIP
  | "ole-excel"     // 구 .xls
  | "text"
  | "unknown";

export function detectFileFormat(bytes: Uint8Array): DetectedFormat {
  if (!bytes || bytes.length < 4) return "unknown";

  // PDF: %PDF-
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) return "png";
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  // WebP: RIFF ... WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";
  // ZIP (xlsx/docx/pptx 포함): PK\x03\x04 or PK\x05\x06 or PK\x07\x08
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    return "zip-or-office";
  }
  // OLE Compound Document (구 xls/doc): D0 CF 11 E0 A1 B1 1A E1
  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
  ) return "ole-excel";

  // 텍스트: 제어문자 비율 검사 (거칠게)
  let printable = 0;
  const n = Math.min(bytes.length, 512);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if ((b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
    // UTF-8 멀티바이트
    else if (b >= 0xc0) printable++;
  }
  if (printable / n > 0.9) return "text";

  return "unknown";
}

/** 파일 종류별 허용 포맷 세트 */
export const ALLOWED_FORMATS_PER_KIND: Record<string, DetectedFormat[]> = {
  announcement: ["pdf"],
  customer: ["pdf", "zip-or-office", "ole-excel", "png", "jpeg", "webp", "text"],
  winner_excel: ["zip-or-office", "ole-excel", "text"],
  household_excel: ["zip-or-office", "ole-excel", "text"],
  property_excel: ["zip-or-office", "ole-excel", "text"],
  other: ["pdf", "png", "jpeg", "webp", "zip-or-office", "ole-excel", "text"],
};

/**
 * 파일 바이트와 kind(용도)를 받아 허용 포맷인지 검사.
 * 허용되지 않으면 {ok:false, reason}, 통과면 {ok:true, format}
 */
export function validateFileContent(
  bytes: Uint8Array,
  kind: string,
): { ok: true; format: DetectedFormat } | { ok: false; reason: string; format: DetectedFormat } {
  const format = detectFileFormat(bytes);
  const allowed = ALLOWED_FORMATS_PER_KIND[kind] || ALLOWED_FORMATS_PER_KIND.other;
  if (!allowed.includes(format)) {
    return {
      ok: false,
      format,
      reason: `파일 내용이 ${kind}에 적합하지 않습니다. 감지된 형식: ${format}`,
    };
  }
  return { ok: true, format };
}
