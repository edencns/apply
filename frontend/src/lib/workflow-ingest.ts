/**
 * 워크플로우 단계별 파일 업로드 공용 유틸
 *
 * 각 단계 페이지에서 PDF/엑셀 어느 쪽이든 올렸을 때,
 * winner-ingest.ingestFiles 로 자동 분류·파싱한 뒤
 * 그 단계에 해당하는 데이터만 꺼내 고객에 반영한다.
 *
 * 반환: 적용 결과 요약 + 에러 목록
 */

import { ingestFiles, type WinnerProfile } from "./winner-ingest";
import { localCustomers, type LocalAnnouncement, type LocalCustomer } from "./local-store";
import { toIdentity, sameIdentity } from "./identity";

export type WorkflowStage = "household" | "property" | "savings";

export interface WorkflowIngestResult {
  stage: WorkflowStage;
  attached: number;
  unmatched: number;
  totalRecords: number;
  errors: string[];
  /** 파일이 예상 단계와 다르면 발생 — 사용자에게 알림 */
  wrongStage?: WorkflowStage | null;
}

async function extractPdfText(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/extract-pdf-text", { method: "POST", body: fd });
  if (!res.ok) throw new Error((await res.json()).error || "PDF 텍스트 추출 실패");
  const d = await res.json();
  return d.text || "";
}

/** 고객 1명 + RRN 13자리 / identity 기반 매칭 */
function findCustomerByRrn(
  customers: LocalCustomer[],
  rrn: string,
  name?: string,
): LocalCustomer | undefined {
  if (/^\d{13}$/.test(rrn)) {
    const front = rrn.slice(0, 6);
    const back = rrn.slice(6);
    const exact = customers.find((c) => c.rrn_front === front && c.rrn_back === back);
    if (exact) return exact;
  }
  const ident = toIdentity({ name, rrn });
  return customers.find((c) => sameIdentity(ident, toIdentity(c as any)));
}

export async function ingestForStage(
  file: File,
  announcement: LocalAnnouncement,
  stage: WorkflowStage,
): Promise<WorkflowIngestResult> {
  const consolidated = await ingestFiles([file], extractPdfText);
  const customers = localCustomers.listByAnnouncement(announcement.id);
  const errors: string[] = [];

  // 파일이 가진 데이터 중 어떤 단계의 것인지 감지
  const totalsByStage: Record<WorkflowStage, number> = {
    household: 0,
    property: 0,
    savings: 0,
  };
  for (const p of consolidated.profiles) {
    if (p.householdMembers) totalsByStage.household += p.householdMembers.length;
    if (p.properties) totalsByStage.property += p.properties.length;
    if (p.savingsPriority) totalsByStage.savings += 1;
  }
  const bestStage = (Object.entries(totalsByStage) as Array<[WorkflowStage, number]>)
    .sort((a, b) => b[1] - a[1])[0][0];

  if (totalsByStage[stage] === 0) {
    // 이 단계의 데이터가 없으면 에러 — 사용자가 잘못된 파일 올림
    return {
      stage,
      attached: 0,
      unmatched: 0,
      totalRecords: 0,
      errors: [
        `이 파일에서 ${stageLabel(stage)} 데이터를 찾지 못했습니다. (파일 종류: ${
          totalsByStage[bestStage] > 0 ? stageLabel(bestStage) + " — 해당 단계에서 업로드하세요" : "인식 불가"
        })`,
      ],
      wrongStage: totalsByStage[bestStage] > 0 ? bestStage : null,
    };
  }

  let attached = 0;
  let unmatched = 0;
  let totalRecords = 0;

  if (stage === "household") {
    for (const p of consolidated.profiles) {
      if (!p.householdMembers || p.householdMembers.length === 0) continue;
      totalRecords += p.householdMembers.length;
      const target = findCustomerByRrn(customers, p.rrn || "", p.name);
      if (!target) {
        unmatched++;
        errors.push(`${p.name || "(이름 없음)"}: 당첨자와 매칭 실패`);
        continue;
      }
      const members = p.householdMembers.map((m) => ({
        name: m.memberName || m.requesterName,
        rrn: m.memberRrn || undefined,
        errorCode: m.errorCode,
      }));
      try {
        localCustomers.update(target.id, { household_members: members });
        attached++;
      } catch (e: any) {
        errors.push(`${target.name}: 저장 실패 (${e?.message || ""})`);
      }
    }
  } else if (stage === "property") {
    // 공고 전원에게 'checked' 마킹
    const checkedAt = new Date().toISOString();
    for (const c of customers) {
      if (c.superseded) continue;
      try { localCustomers.update(c.id, { property_checked_at: checkedAt }); } catch {}
    }
    // 각 프로필의 properties 저장
    for (const p of consolidated.profiles) {
      if (!p.properties || p.properties.length === 0) continue;
      totalRecords += p.properties.length;
      const target = findCustomerByRrn(customers, p.rrn || "", p.name);
      if (!target) {
        unmatched++;
        errors.push(`${p.name || "(이름 없음)"}: 당첨자와 매칭 실패`);
        continue;
      }
      try {
        localCustomers.update(target.id, {
          properties: p.properties.map((x) => ({
            ownerRrn: x.ownerRrn,
            ownerName: x.ownerName,
            address: x.address,
            areaM2: x.areaM2,
            acquiredDate: x.acquiredDate,
            transferredDate: x.transferredDate,
            usage: x.usage,
          })),
        });
        attached++;
      } catch (e: any) {
        errors.push(`${target.name}: 저장 실패 (${e?.message || ""})`);
      }
    }
  } else if (stage === "savings") {
    for (const p of consolidated.profiles) {
      if (!p.savingsPriority) continue;
      totalRecords++;
      const target = findCustomerByRrn(customers, p.rrn || "", p.name);
      if (!target) {
        unmatched++;
        errors.push(`${p.name || "(이름 없음)"}: 당첨자와 매칭 실패`);
        continue;
      }
      try {
        localCustomers.update(target.id, {
          savings_priority: {
            verified: p.savingsPriority.verified,
            bankCode: p.savingsPriority.bankCode,
            errorNote: p.savingsPriority.errorNote,
            resultLength: p.savingsPriority.resultLength,
          },
        });
        attached++;
      } catch (e: any) {
        errors.push(`${target.name}: 저장 실패 (${e?.message || ""})`);
      }
    }
  }

  return {
    stage,
    attached,
    unmatched,
    totalRecords,
    errors: errors.slice(0, 10),
  };
}

export function stageLabel(s: WorkflowStage): string {
  return (
    { household: "세대원", property: "주택소유", savings: "청약통장" } as const
  )[s];
}

/** 파일 내용으로 단계 자동 판별 후 반영 (문서·판정 단계 등 범용) */
export async function ingestAutoStage(
  file: File,
  announcement: LocalAnnouncement,
): Promise<WorkflowIngestResult> {
  const consolidated = await ingestFiles([file], extractPdfText);
  const totals: Record<WorkflowStage, number> = {
    household: 0,
    property: 0,
    savings: 0,
  };
  for (const p of consolidated.profiles) {
    if (p.householdMembers) totals.household += p.householdMembers.length;
    if (p.properties) totals.property += p.properties.length;
    if (p.savingsPriority) totals.savings += 1;
  }
  const best = (Object.entries(totals) as Array<[WorkflowStage, number]>)
    .sort((a, b) => b[1] - a[1])[0];
  if (best[1] === 0) {
    return {
      stage: "household",
      attached: 0,
      unmatched: 0,
      totalRecords: 0,
      errors: ["파일에서 세대원/주택소유/청약통장 데이터를 찾지 못했습니다."],
    };
  }
  return ingestForStage(file, announcement, best[0]);
}
