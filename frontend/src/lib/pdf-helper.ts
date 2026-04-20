/**
 * 한국어 PDF 파싱을 위한 공용 헬퍼.
 *
 * 많은 한국 공공 PDF(OZ Report Viewer, 한글 기반 출력)는 비표준 폰트를 사용해
 * CMap(character map) 없이는 텍스트 추출이 불가능하다.
 * pdfjs-dist가 번들한 cmaps 디렉토리를 file system 경로로 제공해
 * NodeBinaryDataFactory가 읽을 수 있도록 한다.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import { resolve } from 'path';
import { cwd } from 'process';

/** pdfjs-dist/cmaps 경로 — Next.js 서버 환경에서 working dir 기준 */
function getCMapPath(): string {
  return resolve(cwd(), 'node_modules/pdfjs-dist/cmaps/') + '/';
}

/** 한국어 CMap을 로드한 상태로 PDF 텍스트를 추출 */
export async function extractKoreanPdfText(
  buffer: Buffer,
  options: { mergePages?: boolean } = {},
): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(buffer), {
    cMapUrl: getCMapPath(),
    cMapPacked: true,
  });
  const { text } = await extractText(doc, { mergePages: true });
  return Array.isArray(text) ? text.join('\n') : String(text);
}
