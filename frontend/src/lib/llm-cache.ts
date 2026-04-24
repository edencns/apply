/**
 * LLM 파싱 결과 캐시 (메모리)
 *
 * 같은 PDF를 여러 번 업로드할 때 Gemini 재호출 방지용.
 * 파일 SHA-256 해시를 키로 하고 파싱 결과를 일정 시간 메모리에 유지.
 *
 * Vercel serverless라 인스턴스별 분리되지만 부분적 절감 효과는 유의미.
 * 전역 정확도가 필요하면 Redis/Upstash로 업그레이드 고려.
 */

import { createHash } from "crypto";

interface CacheEntry {
  value: any;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30분

export async function sha256Base64(buf: ArrayBuffer | Uint8Array): Promise<string> {
  const hash = createHash("sha256");
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  hash.update(Buffer.from(bytes));
  return hash.digest("base64").replace(/=+$/, "");
}

export function getCached<T = any>(key: string): T | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    CACHE.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCached(key: string, value: any, ttlMs = DEFAULT_TTL_MS): void {
  CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
  // 사이즈 방어 (메모리 폭주 방지)
  if (CACHE.size > 200) {
    const now = Date.now();
    CACHE.forEach((e, k) => {
      if (e.expiresAt < now) CACHE.delete(k);
    });
    // 그래도 크면 가장 오래된 것부터 제거
    if (CACHE.size > 200) {
      const sorted = Array.from(CACHE.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      for (const [k] of sorted.slice(0, CACHE.size - 150)) CACHE.delete(k);
    }
  }
}

export function makeCacheKey(scope: string, hash: string): string {
  return `${scope}:${hash}`;
}
