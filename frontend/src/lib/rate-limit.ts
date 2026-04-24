/**
 * Rate limiter — in-memory sliding window
 *
 * 주의사항:
 *  - Vercel serverless에서는 인스턴스마다 메모리가 분리되므로 완벽하진 않음
 *  - 그러나 기본적인 남용 방어(동일 IP·세션의 폭주 차단)에는 충분
 *  - 정확한 글로벌 제한이 필요하면 Upstash Redis로 업그레이드 가능
 *
 * 사용:
 *   const gate = rateLimit("parse-pdf", sessionKey, { max: 10, windowMs: 60_000 });
 *   if (!gate.allowed) return NextResponse.json({ error: "잠시 후 다시" }, { status: 429 });
 */

type Entry = { timestamps: number[] };
const buckets = new Map<string, Entry>();

export interface RateLimitOptions {
  max: number;      // 허용 요청 수
  windowMs: number; // 시간 창 (ms)
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;  // epoch ms when next slot frees up
}

/** 주어진 (scope, key) 조합에 대해 슬라이딩 윈도우 레이트 리밋 체크 */
export function rateLimit(
  scope: string,
  key: string,
  opts: RateLimitOptions,
): RateLimitResult {
  const bucketKey = `${scope}:${key}`;
  const now = Date.now();
  const cutoff = now - opts.windowMs;

  let entry = buckets.get(bucketKey);
  if (!entry) {
    entry = { timestamps: [] };
    buckets.set(bucketKey, entry);
  }

  // 오래된 타임스탬프 제거
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= opts.max) {
    const oldest = entry.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      resetAt: oldest + opts.windowMs,
    };
  }

  entry.timestamps.push(now);
  // 버킷이 너무 커지지 않도록 주기적 청소 (heuristic)
  if (buckets.size > 5000) {
    buckets.forEach((v, k) => {
      if (v.timestamps.length === 0) buckets.delete(k);
    });
  }
  return {
    allowed: true,
    remaining: opts.max - entry.timestamps.length,
    resetAt: now + opts.windowMs,
  };
}

/** IP 추출 (X-Forwarded-For → X-Real-IP → unknown) */
export function getClientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * CSRF 방어: Origin 헤더가 허용 목록에 있는지 확인.
 * GET/HEAD는 영향 없으므로 체크하지 않음.
 */
export function checkOrigin(req: Request): { ok: true } | { ok: false; reason: string } {
  if (req.method === "GET" || req.method === "HEAD") return { ok: true };
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin) {
    // Origin 없으면 server-to-server 호출일 수 있음 — 추가로 Referer 확인
    const referer = req.headers.get("referer");
    if (!referer) return { ok: true }; // 헤더 둘 다 없으면 브라우저 아님으로 간주
    try {
      const refUrl = new URL(referer);
      if (host && refUrl.host !== host) {
        return { ok: false, reason: `Referer host mismatch: ${refUrl.host} !== ${host}` };
      }
    } catch {
      return { ok: false, reason: "Malformed Referer" };
    }
    return { ok: true };
  }
  try {
    const u = new URL(origin);
    if (host && u.host !== host) {
      return { ok: false, reason: `Origin mismatch: ${u.host} !== ${host}` };
    }
  } catch {
    return { ok: false, reason: "Malformed Origin" };
  }
  return { ok: true };
}

/** 통합 가드: CSRF + rate limit을 한 줄로 */
export function guardRequest(
  req: Request,
  scope: string,
  opts: RateLimitOptions,
  keyHint?: string,
):
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: Response } {
  const originCheck = checkOrigin(req);
  if (!originCheck.ok) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "잘못된 요청 출처", detail: originCheck.reason }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    };
  }
  const key = keyHint || getClientIp(req);
  const rl = rateLimit(scope, key, opts);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요",
          retry_after_sec: retryAfter,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(retryAfter),
          },
        },
      ),
    };
  }
  return {
    ok: true,
    headers: {
      "x-ratelimit-remaining": String(rl.remaining),
      "x-ratelimit-reset": String(rl.resetAt),
    },
  };
}
