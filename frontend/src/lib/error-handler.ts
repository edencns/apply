/**
 * API 에러 응답 표준화
 *
 * 목적:
 *  - 운영 환경에서 스택 트레이스·내부 메시지·DB 스키마가 클라이언트에 노출되는 것 방지
 *  - 동시에 서버 로그에는 상세 정보 남기기
 *  - 구조화된 로그로 나중에 Sentry/Datadog 연동 용이
 */

import { maskAllPII, maskPII } from "./pii-mask";

export interface ErrorLogContext {
  route: string;
  method?: string;
  user_id?: string | number;
  entity?: string;
  entity_id?: string | number;
  extra?: Record<string, any>;
}

/**
 * 에러를 서버 로그에 기록하고, 클라이언트에 안전한 에러 메시지 반환.
 * 운영(production)에서는 내부 메시지 숨김, 개발에서는 그대로 반환.
 * 로그 내용에 PII가 섞여도 자동 마스킹됨.
 */
export function handleError(
  err: any,
  context: ErrorLogContext,
  status = 500,
): Response {
  const isDev = process.env.NODE_ENV !== "production";
  const message = err?.message || "Unknown error";
  const stack = err?.stack;

  // 서버 로그 — PII 마스킹 후 기록
  console.error("[api-error]", {
    ts: new Date().toISOString(),
    ...maskPII(context),
    message: maskAllPII(message),
    stack: isDev ? stack : undefined,
  });

  // 클라이언트 응답 — 운영에서는 일반화된 메시지 (PII 포함 여부와 무관하게 안전)
  const safeMessage = isDev
    ? maskAllPII(message)
    : status >= 500
    ? "서버 처리 중 문제가 발생했습니다"
    : maskAllPII(message);

  return new Response(JSON.stringify({ error: safeMessage }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * 중요 이벤트(의심 행동, 예외적 변경 등)를 구조화 로그로 남김.
 * 나중에 알림 시스템 연동할 때 이 함수에서 webhook 호출 추가하면 됨.
 */
export function logSecurityEvent(
  event:
    | "auth_failure"
    | "rate_limit_hit"
    | "admin_action"
    | "verdict_flip"
    | "signature_tampering"
    | "suspicious_access",
  detail: Record<string, any>,
): void {
  console.warn("[security]", {
    ts: new Date().toISOString(),
    event,
    ...detail,
  });
  // TODO: 운영 배포 후 아래 항목 추가 고려
  //   - Slack webhook (process.env.SLACK_SECURITY_WEBHOOK)
  //   - Sentry.captureMessage
  //   - Datadog / Vercel Log Drain
}
