/**
 * Edge runtime(middleware 등) 전용 세션 검증.
 * 비밀번호 해시(scrypt 등 Node crypto)는 포함하지 않음 — jose만 사용.
 */

import { jwtVerify } from "jose/jwt/verify";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "apply_session";

function secretKey(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET 환경변수 필요");
  return new TextEncoder().encode(s);
}

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
}

export async function verifySessionEdge(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) return null;
    return {
      sub: String(payload.sub),
      email: String(payload.email || ""),
      name: String(payload.name || ""),
    };
  } catch {
    return null;
  }
}

export async function getSessionFromRequestEdge(
  req: NextRequest,
): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return await verifySessionEdge(token);
}

export { SESSION_COOKIE };
