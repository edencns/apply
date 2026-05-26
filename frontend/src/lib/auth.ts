/**
 * JWT + 비밀번호 해시 + 세션 쿠키 관리
 *
 * - 비밀번호: Node crypto.scrypt (별도 의존성 불필요)
 * - JWT: jose (edge runtime 호환)
 * - 세션: httpOnly Secure 쿠키 'apply_session'
 */

import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = "apply_session";
const DAY = 60 * 60 * 24;
// 30일 → 7일로 축소 (개인정보 민감도 고려). 매 요청마다 갱신되진 않으므로 사용자가 자주 로그인 필요.
const SESSION_TTL = DAY * 7;

function secretKey(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET 환경변수 필요");
  return new TextEncoder().encode(s);
}

/** 비밀번호 → 해시(solt:hex$hash:hex) */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(pw, salt, 64)) as Buffer;
  return `${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** 비밀번호 검증 */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const [saltHex, hashHex] = stored.split("$");
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = (await scryptAsync(pw, salt, expected.length)) as Buffer;
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export type UserRole = "staff" | "admin";

export interface SessionPayload {
  sub: string;       // user id
  email: string;
  name: string;
  role: UserRole;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return await new SignJWT({
    email: payload.email,
    name: payload.name,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.sub))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) return null;
    const rawRole = String(payload.role || "staff");
    const role: UserRole = rawRole === "admin" ? "admin" : "staff";
    return {
      sub: String(payload.sub),
      email: String(payload.email || ""),
      name: String(payload.name || ""),
      role,
    };
  } catch {
    return null;
  }
}

/** 관리자 권한 필요 — 아니면 403 응답 객체 반환 */
export function requireAdmin(session: SessionPayload | null):
  | { ok: true; session: SessionPayload }
  | { ok: false; response: Response } {
  if (!session) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "로그인 필요" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  if (session.role !== "admin") {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "관리자 권한 필요" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  return { ok: true, session };
}

/** 서버 컴포넌트/API 라우트에서 현재 세션 */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return await verifySession(token);
}

/** NextRequest에서 세션 읽기(미들웨어 등) */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return await verifySession(token);
}

/** 로그인 쿠키 세팅 — API 라우트에서 호출 */
export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export { SESSION_COOKIE };
