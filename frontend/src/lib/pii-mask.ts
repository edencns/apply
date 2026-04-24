/**
 * 개인정보(PII) 마스킹 유틸리티
 *
 * 절대 원칙:
 *  - 주민번호 뒷자리(13자리 중 뒷 7자리)는 로그·에러메시지에 절대 남기지 않음
 *  - 주민번호 앞자리도 마스킹 권장 (생년월일)
 *  - 전화번호 중간자리 마스킹
 *  - 이메일 앞부분 일부 마스킹
 *  - 주소 상세(동/호) 마스킹
 *
 * 사용:
 *   import { maskPII, safeLog } from '@/lib/pii-mask';
 *   safeLog("login attempt", { email, phone });
 */

const RRN_PATTERN = /\b(\d{6})-?(\d{7})\b/g;
const RRN_LOOSE = /\b(\d{6})[-\s]?(\d[1-4])\d{6}\b/g; // 주민번호 패턴 (뒷자리 시작 1~4)
const PHONE_PATTERN = /\b(01[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})\b/g;
const PHONE_SEOUL_PATTERN = /\b(02)[-\s]?(\d{3,4})[-\s]?(\d{4})\b/g;

/** 주민번호 마스킹: 900101-1****** → 900101-1****** */
export function maskRrn(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).replace(RRN_PATTERN, (_m, front, back) => {
    const g = back?.[0] ?? "*";
    return `${front}-${g}******`;
  });
}

/** 주민번호 앞자리까지 강마스킹: 90****-******* */
export function maskRrnStrong(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).replace(RRN_PATTERN, (_m, front) => {
    return `${front.slice(0, 2)}****-*******`;
  });
}

/** 전화번호 마스킹: 010-1234-5678 → 010-****-5678 */
export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw);
  s = s.replace(PHONE_PATTERN, (_m, p1, _p2, p3) => `${p1}-****-${p3}`);
  s = s.replace(PHONE_SEOUL_PATTERN, (_m, p1, _p2, p3) => `${p1}-****-${p3}`);
  return s;
}

/** 이메일 마스킹: user@example.com → u***@example.com */
export function maskEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw);
  const at = s.indexOf("@");
  if (at <= 0) return s;
  const local = s.slice(0, at);
  const domain = s.slice(at);
  if (local.length <= 1) return `*${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 1, 4))}${domain}`;
}

/** 주소 동/호수·번지까지 자르기: 서울시 강남구 테헤란로 123 456동 789호 → 서울시 강남구 테헤란로 *** */
export function maskAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim();
  // 도/시/군/구 + 읍/면/동/로/가 까지만 남기고 나머지 마스킹
  const parts = s.split(/\s+/);
  if (parts.length <= 3) return s;
  return parts.slice(0, 3).join(" ") + " ***";
}

/** 문자열 내 모든 PII 패턴 자동 마스킹 (로그용) */
export function maskAllPII(text: string): string {
  if (!text) return "";
  let s = String(text);
  s = maskRrn(s);
  s = s.replace(RRN_LOOSE, (_m, front, g) => `${front}-${g}******`);
  s = maskPhone(s);
  return s;
}

/** 객체를 재귀적으로 순회하며 PII 필드 마스킹 */
export function maskPII(obj: any, depth = 0): any {
  if (depth > 5) return "[deep]";
  if (obj == null) return obj;
  if (typeof obj === "string") return maskAllPII(obj);
  if (typeof obj === "number" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) return obj.map((v) => maskPII(v, depth + 1));
  if (typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const lk = k.toLowerCase();
      if (lk === "rrn_back" || lk === "rrnback") {
        out[k] = v ? "*******" : v;
      } else if (lk === "rrn_front" || lk === "rrnfront") {
        out[k] = typeof v === "string" && v.length >= 2 ? `${v.slice(0, 2)}****` : v;
      } else if (lk === "rrn") {
        out[k] = typeof v === "string" ? maskRrnStrong(v) : v;
      } else if (lk === "phone" || lk === "mobile" || lk === "tel" || lk.includes("phone")) {
        out[k] = typeof v === "string" ? maskPhone(v) : v;
      } else if (lk === "email") {
        out[k] = typeof v === "string" ? maskEmail(v) : v;
      } else if (lk === "address" || lk === "addr" || lk === "주소") {
        out[k] = typeof v === "string" ? maskAddress(v) : v;
      } else if (lk === "password" || lk === "password_hash" || lk === "token" || lk === "secret" || lk === "api_key" || lk === "authorization") {
        out[k] = v ? "[REDACTED]" : v;
      } else {
        out[k] = maskPII(v, depth + 1);
      }
    }
    return out;
  }
  return obj;
}

/** PII가 자동 마스킹된 안전 로그 함수 — console.log 대체 */
export function safeLog(prefix: string, ...args: any[]): void {
  const masked = args.map((a) => {
    if (typeof a === "string") return maskAllPII(a);
    return maskPII(a);
  });
  console.log(prefix, ...masked);
}

export function safeWarn(prefix: string, ...args: any[]): void {
  const masked = args.map((a) => {
    if (typeof a === "string") return maskAllPII(a);
    return maskPII(a);
  });
  console.warn(prefix, ...masked);
}

export function safeError(prefix: string, err: any, extra?: Record<string, any>): void {
  const message = err?.message || String(err);
  console.error(prefix, {
    message: maskAllPII(message),
    name: err?.name,
    extra: extra ? maskPII(extra) : undefined,
    stack: process.env.NODE_ENV !== "production" ? err?.stack : undefined,
  });
}
