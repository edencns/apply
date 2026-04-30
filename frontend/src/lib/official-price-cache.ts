/**
 * 공시가격 조회 결과 캐시 (메모리)
 *
 * 같은 주소·식별번호를 여러 번 조회할 때 외부 API 재호출 방지용.
 * 공시가격은 연 1회 갱신되므로 TTL은 길게(1년) 잡는다.
 *
 * Vercel serverless라 인스턴스별 분리되지만 한 사이클(공고 검수 기간 며칠~몇주)
 * 안에서는 충분히 효과적. 정확한 글로벌 정확도가 필요하면 Upstash로 업그레이드.
 */

interface CacheEntry {
  value: any;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1년

export function getCachedPrice<T = any>(key: string): T | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    CACHE.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCachedPrice(key: string, value: any, ttlMs = DEFAULT_TTL_MS): void {
  CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
  // 메모리 폭주 방지 — 1만 건 넘으면 만료된 것부터 정리
  if (CACHE.size > 10_000) {
    const now = Date.now();
    CACHE.forEach((e, k) => {
      if (e.expiresAt < now) CACHE.delete(k);
    });
    if (CACHE.size > 10_000) {
      const sorted = Array.from(CACHE.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      for (const [k] of sorted.slice(0, CACHE.size - 8_000)) CACHE.delete(k);
    }
  }
}

/**
 * 캐시 키 생성 — 주소+식별번호 조합. 둘 다 없으면 null 반환(캐시 불가).
 */
export function makePriceCacheKey(opts: {
  address?: string;
  identifier?: string;
  year?: number;
}): string | null {
  const id = (opts.identifier || "").trim();
  const addr = (opts.address || "").trim().replace(/\s+/g, " ");
  if (!id && !addr) return null;
  const yr = opts.year ?? new Date().getFullYear();
  return `price:${yr}:${id}|${addr}`;
}
