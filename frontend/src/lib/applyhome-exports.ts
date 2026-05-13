/**
 * 청약홈 사업주체전용 송부 엑셀 출력기.
 *
 * 출력 양식은 한국부동산원 「청약업무 종합 준칙」 기반 일반 양식.
 * 실제 [01]/[05]/[08] 메뉴 공식 양식이 다를 경우 컬럼 정의만 수정하면 됨.
 *
 * 사용처:
 *   - household: [01] 당첨자 배우자 분리세대 세대원 검색요청
 *   - contracts: [05] 예비입주자 중 추가입주자 명단
 *   - documents: [08] 부적격당첨자 명단
 */

import type { LocalCustomer, LocalAnnouncement } from "./local-store";
import { ensureXlsx } from "./winner-ingest";
import { reasonLabel, type IneligibleReasonCode } from "./ineligible-reasons";

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function fmtRrn(front?: string, back?: string): string {
  if (!front && !back) return "";
  return `${front || ""}${back ? "-" + back : ""}`;
}

async function downloadXlsx(rows: Array<Record<string, any>>, sheetName: string, fileName: string) {
  const XLSX = await ensureXlsx();
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * [01] 당첨자 배우자 분리세대 세대원 검색요청 명단.
 * 분리세대원이 등록된 당첨자만 출력.
 * 한 분리세대원당 1행 (당첨자가 여러 명이면 같은 당첨자 정보가 반복됨).
 */
export async function exportSeparatedReportXlsx(
  customers: LocalCustomer[],
  announcement: LocalAnnouncement,
) {
  const rows: Array<Record<string, any>> = [];
  for (const c of customers) {
    const members = c.separated_household_members || [];
    if (members.length === 0) continue;
    for (const m of members) {
      rows.push({
        동: c.unit_dong || "",
        호수: c.unit_ho || "",
        주택형: c.unit_type || "",
        공급유형: c.supply_type || "",
        당첨자성명: c.name,
        당첨자주민번호: fmtRrn(c.rrn_front, c.rrn_back),
        세대주와의관계: m.relation || "",
        분리세대원성명: m.name,
        분리세대원주민번호: m.rrn || "",
        비고: m.note || "",
      });
    }
  }
  if (rows.length === 0) {
    alert("출력할 분리세대원 명단이 없습니다.");
    return;
  }
  await downloadXlsx(
    rows,
    "[01]당첨자명단",
    `[01]분리세대_세대원_검색요청_${announcement.title.replace(/[\\/:*?"<>|]/g, "_")}_${nowStamp()}.xlsx`,
  );
}

/**
 * [05] 예비입주자 중 추가입주자 명단.
 * succeeded_from 있는 고객만 출력.
 */
export async function exportAdditionalResidentXlsx(
  customers: LocalCustomer[],
  announcement: LocalAnnouncement,
) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const rows: Array<Record<string, any>> = [];
  for (const c of customers) {
    if (c.succeeded_from === undefined || c.succeeded_from === null) continue;
    if (c.superseded) continue;
    const original = byId.get(c.succeeded_from);
    rows.push({
      동: c.unit_dong || "",
      호수: c.unit_ho || "",
      주택형: c.unit_type || "",
      공급유형: c.supply_type || "",
      추가입주자성명: c.name,
      추가입주자주민번호: fmtRrn(c.rrn_front, c.rrn_back),
      추가입주자전화: c.phone || "",
      원당첨자성명: original?.name || "",
      원당첨자포기사유: original?.supersede_reason || "",
      예비순위: c.standby_rank || "",
      승계일: c.supersede_at ? new Date(c.supersede_at).toISOString().slice(0, 10) : "",
      계약일: c.contract_info?.contractDate || "",
    });
  }
  if (rows.length === 0) {
    alert("출력할 추가입주자 명단이 없습니다.");
    return;
  }
  await downloadXlsx(
    rows,
    "[05]추가입주자명단",
    `[05]예비_추가입주자_명단_${announcement.title.replace(/[\\/:*?"<>|]/g, "_")}_${nowStamp()}.xlsx`,
  );
}

/**
 * [08] 부적격당첨자 명단.
 * verification_verdict === "ineligible" 인 고객만 출력.
 */
export async function exportIneligibleXlsx(
  customers: LocalCustomer[],
  announcement: LocalAnnouncement,
) {
  const rows: Array<Record<string, any>> = [];
  for (const c of customers) {
    if (c.verification_verdict !== "ineligible") continue;
    if (c.superseded) continue;
    const codes = (c.verification_reason_codes || []) as IneligibleReasonCode[];
    rows.push({
      동: c.unit_dong || "",
      호수: c.unit_ho || "",
      주택형: c.unit_type || "",
      공급유형: c.supply_type || "",
      성명: c.name,
      주민번호: fmtRrn(c.rrn_front, c.rrn_back),
      전화: c.phone || "",
      부적격사유코드: codes.join(", "),
      부적격사유: codes.map((cd) => reasonLabel(cd)).join(", "),
      상세사유: (c.verification_reasons || []).join(" / "),
      판정일: c.verification_checked_at ? new Date(c.verification_checked_at).toISOString().slice(0, 10) : "",
      송부완료일: c.ineligible_reported_at ? new Date(c.ineligible_reported_at).toISOString().slice(0, 10) : "",
    });
  }
  if (rows.length === 0) {
    alert("출력할 부적격당첨자 명단이 없습니다.");
    return;
  }
  await downloadXlsx(
    rows,
    "[08]부적격명단",
    `[08]부적격당첨자_명단_${announcement.title.replace(/[\\/:*?"<>|]/g, "_")}_${nowStamp()}.xlsx`,
  );
}
