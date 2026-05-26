import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, parseRowData, stringifyData } from "@/lib/db/turso";
import { getSession } from "@/lib/auth";
import { broadcast } from "@/lib/realtime/ably-server";
import { logAudit, logVerdictChange } from "@/lib/audit";
import { guardRequest } from "@/lib/rate-limit";
import { logSecurityEvent } from "@/lib/error-handler";
import { encryptField, decryptField } from "@/lib/field-crypto";

export const runtime = "nodejs";

type IdRouteContext = { params: Promise<{ id: string }> };

/** 저장·전달 시 rrn_back 암호화 마킹. 조회 시 복호화. */
function decryptCustomer(c: any): any {
  if (!c) return c;
  if (c.rrn_back) c.rrn_back = decryptField(c.rrn_back);
  if (Array.isArray(c.household_members)) {
    c.household_members = c.household_members.map((m: any) => {
      if (m && m.rrn_back) m.rrn_back = decryptField(m.rrn_back);
      return m;
    });
  }
  return c;
}

function encryptCustomer(c: any): any {
  if (!c) return c;
  const clone = { ...c };
  if (clone.rrn_back) clone.rrn_back = encryptField(String(clone.rrn_back));
  if (Array.isArray(clone.household_members)) {
    clone.household_members = clone.household_members.map((m: any) => {
      if (m && m.rrn_back) return { ...m, rrn_back: encryptField(String(m.rrn_back)) };
      return m;
    });
  }
  return clone;
}

async function fetchOne(id: number) {
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT data FROM customers WHERE id=?",
    args: [id],
  });
  if (r.rows.length === 0) return null;
  const parsed = parseRowData<any>(r.rows[0]);
  return decryptCustomer(parsed);
}

export async function GET(_req: NextRequest, { params }: IdRouteContext) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const { id: rawId } = await params;
    const c = await fetchOne(Number(rawId));
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(c);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: IdRouteContext) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const guard = guardRequest(req, "customer-mutation", { max: 120, windowMs: 60_000 }, String(session.sub));
    if (!guard.ok) return guard.response;
    const { id: rawId } = await params;
    const id = Number(rawId);
    const patch = await req.json();
    const existing = await fetchOne(id);
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    const merged = { ...existing, ...patch, id };
    const db = getDb();
    // 저장 시 rrn_back 암호화. rrn_front은 색인·검색용이라 평문 유지
    const encForStorage = encryptCustomer(merged);
    await db.execute({
      sql: `UPDATE customers SET
              announcement_id=?, site_id=?, name=?, rrn_front=?, rrn_back=?,
              is_standby=?, supply_type=?, unit_type=?,
              superseded=?, verification_verdict=?,
              data=?, updated_at=datetime('now')
            WHERE id=?`,
      args: [
        merged.announcement_id, merged.site_id ?? null,
        merged.name, merged.rrn_front ?? null, encForStorage.rrn_back ?? null,
        merged.is_standby ? 1 : 0,
        merged.supply_type ?? null, merged.unit_type ?? null,
        merged.superseded ? 1 : 0,
        merged.verification_verdict ?? null,
        stringifyData(encForStorage), id,
      ],
    });

    // 감사 기록 — 주요 필드만 before/after로 추려 기록
    // 실제 담당자가 수정하는 필드(이름·연락처·주소·주택형 등)와 판정·서명 상태
    const snapshot = (src: any) => ({
      name: src?.name ?? null,
      phone: src?.phone ?? null,
      address: src?.address ?? null,
      supply_type: src?.supply_type ?? null,
      unit_type: src?.unit_type ?? null,
      verification_verdict: src?.verification_verdict ?? null,
      superseded: !!src?.superseded,
      is_standby: !!src?.is_standby,
      manual_review_signed: !!src?.manual_review?.signed_off,
      reviewer_name: src?.manual_review?.reviewer_name ?? null,
      past_winnings_count: (src?.past_winnings || []).length,
    });
    await logAudit({
      session, entity: "customer", entity_id: id, action: "update",
      before: snapshot(existing),
      after: snapshot(merged),
      req,
    });
    await logVerdictChange(
      session, id,
      existing.verification_verdict ?? null,
      merged.verification_verdict ?? null,
      req,
    );
    // 판정이 "적합↔부적합"으로 뒤집힌 경우는 별도 security event
    const beforeV = String(existing.verification_verdict ?? "").toLowerCase();
    const afterV = String(merged.verification_verdict ?? "").toLowerCase();
    const flipped =
      (beforeV.includes("적합") && !beforeV.includes("부") && afterV.includes("부적합")) ||
      (beforeV.includes("부적합") && afterV.includes("적합") && !afterV.includes("부"));
    if (flipped) {
      logSecurityEvent("verdict_flip", {
        customer_id: id,
        by_user_id: Number(session.sub),
        by_email: session.email,
        before: existing.verification_verdict,
        after: merged.verification_verdict,
      });
    }
    if (
      !existing?.manual_review?.signed_off &&
      merged?.manual_review?.signed_off
    ) {
      await logAudit({
        session, entity: "customer", entity_id: id, action: "manual_sign",
        after: {
          reviewer_name: merged.manual_review.reviewer_name ?? null,
          signed_at: merged.manual_review.signed_at ?? null,
        },
        req,
      });
    }
    const beforePW = JSON.stringify(existing?.past_winnings || []);
    const afterPW = JSON.stringify(merged?.past_winnings || []);
    if (beforePW !== afterPW) {
      await logAudit({
        session, entity: "customer", entity_id: id, action: "past_winnings_change",
        before: existing?.past_winnings || [],
        after: merged?.past_winnings || [],
        req,
      });
    }

    // 명의변경 이력 — 신규 또는 갱신 시 별도 액션으로 기록
    const beforeTT = JSON.stringify(existing?.title_transfer || null);
    const afterTT = JSON.stringify(merged?.title_transfer || null);
    if (beforeTT !== afterTT) {
      await logAudit({
        session, entity: "customer", entity_id: id, action: "title_transfer",
        before: existing?.title_transfer ? {
          reason: existing.title_transfer.reason,
          newHolder: existing.title_transfer.newHolder?.name,
        } : null,
        after: merged?.title_transfer ? {
          reason: merged.title_transfer.reason,
          transferDate: merged.title_transfer.transferDate,
          newHolder: merged.title_transfer.newHolder?.name,
          relation: merged.title_transfer.newHolder?.relation,
          confidence: merged.title_transfer.aiConfidence,
        } : null,
        req,
      });
    }

    await broadcast("customer:updated", {
      id, announcement_id: merged.announcement_id, by: Number(session.sub),
    });
    return NextResponse.json(merged);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: IdRouteContext) {
  try {
    await ensureSchema();
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    const guard = guardRequest(req, "customer-mutation", { max: 120, windowMs: 60_000 }, String(session.sub));
    if (!guard.ok) return guard.response;
    const db = getDb();
    const { id: rawId } = await params;
    const id = Number(rawId);
    const existing = await fetchOne(id);
    await db.execute({
      sql: "DELETE FROM customers WHERE id=?",
      args: [id],
    });
    await logAudit({
      session, entity: "customer", entity_id: id, action: "delete",
      before: existing || null, req,
    });
    await broadcast("customer:deleted", { id, by: Number(session.sub) });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
