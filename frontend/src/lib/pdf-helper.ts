/**
 * 한국어 PDF 파싱을 위한 공용 헬퍼.
 *
 * 많은 한국 공공 PDF(OZ Report Viewer, 한글 기반 출력)는 비표준 폰트를 사용해
 * CMap(character map) 없이는 텍스트 추출이 불가능하다.
 * pdfjs-dist가 번들한 cmaps 디렉토리를 file system 경로로 제공해
 * NodeBinaryDataFactory가 읽을 수 있도록 한다.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { cwd } from 'process';

/**
 * pdfjs-dist/cmaps 경로 해석.
 * 로컬/Vercel/여러 monorepo 구조에서 모두 동작하도록 여러 후보를 시도한다.
 */
function getCMapPath(): string {
  const candidates: string[] = [];

  // 1) require.resolve 로 pdfjs-dist 위치 정확히 파악 (가장 안정적)
  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('pdfjs-dist/package.json');
    candidates.push(resolve(dirname(pkgPath), 'cmaps') + '/');
  } catch {
    // fall through
  }

  // 2) Next.js 서버 working directory 기준
  candidates.push(resolve(cwd(), 'node_modules/pdfjs-dist/cmaps') + '/');

  // 3) Vercel serverless: outputFileTracingIncludes 로 번들된 경로
  candidates.push(resolve(cwd(), '.next/server/node_modules/pdfjs-dist/cmaps') + '/');

  for (const p of candidates) {
    // 트레일링 슬래시 제거한 디렉토리로 존재 확인
    if (existsSync(p.replace(/[\/\\]$/, ''))) return p;
  }

  // 어디도 없으면 첫 번째 후보를 반환 (에러는 호출측에서 표면화됨)
  return candidates[0] || '';
}

/** 한국어 CMap을 로드한 상태로 PDF 텍스트를 추출 */
export async function extractKoreanPdfText(
  buffer: Buffer,
  options: { mergePages?: boolean } = {},
): Promise<string> {
  const cMapUrl = getCMapPath();
  const cmapExists = existsSync(cMapUrl.replace(/[\/\\]$/, ''));
  if (!cmapExists) {
    console.warn('[pdf-helper] CMap directory not found:', cMapUrl);
  }

  const doc = await getDocumentProxy(new Uint8Array(buffer), {
    cMapUrl,
    cMapPacked: true,
  });
  const { text } = await extractText(doc, { mergePages: true });
  const result = Array.isArray(text) ? text.join('\n') : String(text);

  if (result.trim().length < 10 && !cmapExists) {
    console.error('[pdf-helper] extracted empty text — CMap likely missing. Tried:', cMapUrl);
  }
  return result;
}
