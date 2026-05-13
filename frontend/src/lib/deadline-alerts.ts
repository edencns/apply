/**
 * 공고 일정 기반 마감일 알림 엔진
 *
 * 각 공고의 주요 일정(서류제출·계약체결) 마감까지 D-N 계산.
 * 대시보드·공고 목록·상세 페이지 상단에 표시.
 */

import type { LocalAnnouncement, LocalCustomer } from "./local-store";

export type AlertLevel = "critical" | "warning" | "info" | "past";

export interface DeadlineAlert {
  announcementId: number | string;
  announcementTitle: string;
  label: string;        // "서류 제출 마감", "계약 체결 마감"
  dueDate: Date;
  daysLeft: number;     // 음수 = 이미 지남
  level: AlertLevel;
  /** 미처리 고객 수 (있으면) */
  pendingCount?: number;
  totalCount?: number;
}

function parseDate(s: any): Date | null {
  if (!s || typeof s !== "string") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** D-N에 따른 심각도 */
function classifyLevel(daysLeft: number, label: string): AlertLevel {
  if (daysLeft < 0) return "past";
  if (daysLeft <= 1) return "critical";  // D-Day/D-1
  if (daysLeft <= 3) return "warning";   // D-3까지
  if (daysLeft <= 7) return "info";      // 1주일 전부터
  return "info"; // (표시는 하되 별로 긴급 아님)
}

/** 단일 공고에서 모든 마감 알림 생성 */
export function alertsForAnnouncement(
  ann: LocalAnnouncement,
  customers: LocalCustomer[],
  now: Date = new Date(),
): DeadlineAlert[] {
  const alerts: DeadlineAlert[] = [];
  const rules = ann.eligibility_rules || {};
  const active = customers.filter((c) => !c.superseded);

  // 서류 제출 마감 (doc_submit_end)
  const docEnd = parseDate(rules.doc_submit_end);
  if (docEnd) {
    const days = daysBetween(now, docEnd);
    if (days >= -7 && days <= 30) {  // 지난 1주일 ~ 앞 1달만 알림
      // 미제출 고객 수 — documents_submitted가 비어있거나 일부만 체크된 경우
      const pending = active.filter((c) => {
        const s = c.documents_submitted || {};
        return Object.keys(s).length === 0 || Object.values(s).some((v) => !v);
      }).length;
      alerts.push({
        announcementId: ann.id,
        announcementTitle: ann.title,
        label: "서류 제출 마감",
        dueDate: docEnd,
        daysLeft: days,
        level: classifyLevel(days, "서류"),
        pendingCount: pending,
        totalCount: active.length,
      });
    }
  }

  // 계약 체결 마감 (contract_end)
  const contractEnd = parseDate(ann.contract_end);
  if (contractEnd) {
    const days = daysBetween(now, contractEnd);
    if (days >= -7 && days <= 30) {
      alerts.push({
        announcementId: ann.id,
        announcementTitle: ann.title,
        label: "계약 체결 마감",
        dueDate: contractEnd,
        daysLeft: days,
        level: classifyLevel(days, "계약"),
        totalCount: active.length,
      });
    }
  }

  // 서류 제출 시작일 임박 (doc_submit_start — 아직 시작 전 + 3일 이내)
  const docStart = parseDate(rules.doc_submit_start);
  if (docStart) {
    const days = daysBetween(now, docStart);
    if (days >= 0 && days <= 3) {
      alerts.push({
        announcementId: ann.id,
        announcementTitle: ann.title,
        label: "서류 제출 시작",
        dueDate: docStart,
        daysLeft: days,
        level: days === 0 ? "warning" : "info",
        totalCount: active.length,
      });
    }
  }

  // 당첨자 발표 임박
  const winnerDate = parseDate(ann.winner_announce_date);
  if (winnerDate) {
    const days = daysBetween(now, winnerDate);
    if (days >= 0 && days <= 3) {
      alerts.push({
        announcementId: ann.id,
        announcementTitle: ann.title,
        label: "당첨자 발표",
        dueDate: winnerDate,
        daysLeft: days,
        level: days === 0 ? "warning" : "info",
      });
    }
  }

  return alerts;
}

/** 여러 공고 대상 일괄 — 모든 active 알림 반환, 심각도·일자 순 정렬 */
export function allDeadlineAlerts(
  announcements: LocalAnnouncement[],
  customersByAnn: Map<number | string, LocalCustomer[]>,
  now: Date = new Date(),
): DeadlineAlert[] {
  const all: DeadlineAlert[] = [];
  for (const ann of announcements) {
    const customers = customersByAnn.get(ann.id) || [];
    all.push(...alertsForAnnouncement(ann, customers, now));
  }
  // 정렬: critical > warning > info > past, 그 안에선 마감 가까운 순
  const levelOrder: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2, past: 3 };
  all.sort((a, b) => {
    if (levelOrder[a.level] !== levelOrder[b.level]) return levelOrder[a.level] - levelOrder[b.level];
    return a.daysLeft - b.daysLeft;
  });
  return all;
}

export function alertLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}일 경과`;
  if (days === 0) return "D-Day";
  return `D-${days}`;
}

/**
 * 부적격 당첨자 [08]명단 송부 기한 — 「주택공급에 관한 규칙」 제58조제1항.
 * 부적격 마킹(verification_checked_at)으로부터 7일 이내에 청약홈 [08] 메뉴로 송부.
 * 송부 완료(ineligible_reported_at) 시 알림 종료.
 */
export interface IneligibleReportAlert {
  customerId: number;
  customerName: string;
  announcementId: number;
  markedAt: Date;
  dueDate: Date;
  daysLeft: number;
  level: AlertLevel;
}

export function ineligibleReportAlerts(
  customers: LocalCustomer[],
  now: Date = new Date(),
): IneligibleReportAlert[] {
  const alerts: IneligibleReportAlert[] = [];
  for (const c of customers) {
    if (c.verification_verdict !== "ineligible") continue;
    if (c.ineligible_reported_at) continue; // 이미 송부 완료
    if (c.superseded) continue;             // 이미 승계로 처리된 자리
    const marked = parseDate(c.verification_checked_at || null);
    if (!marked) continue;
    const due = new Date(marked.getTime() + 7 * 24 * 60 * 60 * 1000);
    const days = daysBetween(now, due);
    alerts.push({
      customerId: c.id,
      customerName: c.name,
      announcementId: c.announcement_id,
      markedAt: marked,
      dueDate: due,
      daysLeft: days,
      level: classifyLevel(days, "부적격송부"),
    });
  }
  alerts.sort((a, b) => a.daysLeft - b.daysLeft);
  return alerts;
}

/**
 * 60일 경과 예비입주자 개인정보 파기 알림 — 「주택공급에 관한 규칙」 제26조제9항·제26조의2제6항.
 * 공급계약체결일(announcement.contract_end)로부터 60일 경과 시 지위가 소멸되어
 * 식별자(이름·주민번호·전화·주소)를 마스킹해야 함. pii_purged_at 기록 시 알림 종료.
 */
export interface PiiPurgeAlert {
  announcementId: number;
  announcementTitle: string;
  contractEnd: Date;
  dueDate: Date;       // contractEnd + 60일
  daysLeft: number;
  level: AlertLevel;
  pendingCount: number; // 아직 파기 안된 예비입주자 수
  totalStandby: number;
}

export function piiPurgeAlerts(
  announcements: LocalAnnouncement[],
  customersByAnn: Map<number | string, LocalCustomer[]>,
  now: Date = new Date(),
): PiiPurgeAlert[] {
  const alerts: PiiPurgeAlert[] = [];
  for (const ann of announcements) {
    const contractEnd = parseDate(ann.contract_end);
    if (!contractEnd) continue;
    const due = new Date(contractEnd.getTime() + 60 * 24 * 60 * 60 * 1000);
    const days = daysBetween(now, due);
    if (days > 30) continue; // 너무 먼 미래는 표시 안 함
    const customers = customersByAnn.get(ann.id) || [];
    const standby = customers.filter((c) => c.is_standby && !c.succeeded_from);
    const pending = standby.filter((c) => !c.pii_purged_at);
    if (standby.length === 0) continue;
    alerts.push({
      announcementId: typeof ann.id === "string" ? parseInt(ann.id, 10) || 0 : ann.id,
      announcementTitle: ann.title,
      contractEnd,
      dueDate: due,
      daysLeft: days,
      level: classifyLevel(days, "60일파기"),
      pendingCount: pending.length,
      totalStandby: standby.length,
    });
  }
  alerts.sort((a, b) => a.daysLeft - b.daysLeft);
  return alerts;
}

export function alertColorClass(level: AlertLevel): string {
  switch (level) {
    case "critical": return "bg-red-50 border-red-300 text-red-900";
    case "warning": return "bg-amber-50 border-amber-300 text-amber-900";
    case "info": return "bg-blue-50 border-blue-200 text-blue-900";
    case "past": return "bg-gray-50 border-gray-200 text-gray-700";
  }
}
