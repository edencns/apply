/**
 * 감사 로그(audit_log) 기록 헬퍼
 *
 * 목적:
 *  - 당첨자 판정·공고 수정·파일 삭제 등 모든 중요 변경을 영구 기록
 *  - "누가 언제 무엇을 어떻게 바꿨는가"를 추후 추적·감사 가능하도록
 *  - 공유 모드에서 발생할 수 있는 내부 부정·실수를 적발하기 위한 최소 장치
 *
 * 실패 시에도 메인 요청을 막지 않는 best-effort 설계.
 */

import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db/turso";
import type { SessionPayload } from "@/lib/auth";

export type AuditEntity = "customer" | "announcement" | "file" | "user";
export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "update_verdict"
  | "manual_sign"
  | "past_winnings_change"
  | "role_change";

export interface AuditParams {
  session: SessionPayload;
  entity: AuditEntity;
  entity_id: number;
  action: AuditAction;
  before?: any;
  after?: any;
  req?: NextRequest | Request;
}

function extractIp(req?: NextRequest | Request): string | null {
  if (!req) return null;
  const h = (req as any).headers;
  if (!h?.get) return null;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null
  );
}

function extractUA(req?: NextRequest | Request): string | null {
  if (!req) return null;
  const h = (req as any).headers;
  if (!h?.get) return null;
  return h.get("user-agent") || null;
}

/** 변경 내용을 audit_log에 INSERT. 실패해도 조용히 경고만. */
export async function logAudit(params: AuditParams): Promise<void> {
  const { session, entity, entity_id, action, before, after, req } = params;
  try {
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO audit_log
              (user_id, user_email, entity, entity_id, action, before_json, after_json, ip, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        Number(session.sub),
        session.email || null,
        entity,
        entity_id,
        action,
        before !== undefined ? JSON.stringify(before) : null,
        after !== undefined ? JSON.stringify(after) : null,
        extractIp(req),
        extractUA(req),
      ],
    });
  } catch (e: any) {
    console.warn("[audit_log] insert failed:", e?.message);
  }
}

/** 판정 변경만 특화된 편의 함수 (before/after verdict만) */
export async function logVerdictChange(
  session: SessionPayload,
  customerId: number,
  beforeVerdict: string | null,
  afterVerdict: string | null,
  req?: NextRequest | Request,
): Promise<void> {
  if (beforeVerdict === afterVerdict) return;
  await logAudit({
    session,
    entity: "customer",
    entity_id: customerId,
    action: "update_verdict",
    before: { verification_verdict: beforeVerdict },
    after: { verification_verdict: afterVerdict },
    req,
  });
}
