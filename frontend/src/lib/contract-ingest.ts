/**
 * 「계약자명단(분양금 포함)」 엑셀 파싱.
 *
 * 7단계 「최종 계약자」에서 사용. 사업자 발급 엑셀의 컬럼:
 *   - 동, 호, 평형, TYPE, 계약일, 고객명, 전화번호, 주소, 분양금 등
 *
 * 출력: 계약 기록 배열. 시스템 customer와 동·호로 매칭하거나, 매칭 안 되면
 * 「선착순」 공급유형으로 신규 등록 대상으로 분류.
 */

import { ensureXlsx } from "./winner-ingest";
import type { LocalCustomer } from "./local-store";

export interface ContractRecord {
  dong?: string;
  ho?: string;
  unitType?: string;          // 평형 (예: "84.8636")
  contractDate?: string;      // 계약일 YYYY-MM-DD
  customerName: string;
  rrnFrontMasked?: string;    // "380515-1******" 등
  phone?: string;
  registeredAddress?: string; // 주민등록 주소
  residenceAddress?: string;  // 거주지 주소
  contractPrice?: number;     // 분양금 (원)
  downPayment?: number;       // 계약금
  rawRow: Record<string, string>;
}

function findHeaderRow(sheet: any[][]): { row: number; cols: Record<string, number> } | null {
  const limit = Math.min(15, sheet.length);
  const norm = (s: string) => String(s || "").replace(/\s+/g, "").replace(/[^가-힣A-Za-z0-9]/g, "");
  for (let r = 0; r < limit; r++) {
    const row = sheet[r] || [];
    const cols: Record<string, number> = {};
    for (let c = 0; c < row.length; c++) {
      const v = norm(row[c] as any);
      if (!v) continue;
      cols[v] = c;
    }
    // 최소 「동」「호」「고객명」 매칭
    const has = (k: string) => Object.keys(cols).some((kk) => kk.includes(k));
    if (has("동") && has("호") && (has("고객명") || has("성명") || has("계약자"))) {
      return { row: r, cols };
    }
  }
  return null;
}

/** 컬럼명에 부분 일치하는 인덱스 반환 */
function pickCol(cols: Record<string, number>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const found = Object.keys(cols).find((kk) => kk.includes(k));
    if (found !== undefined) return cols[found];
  }
  return undefined;
}

function cell(sheet: any[][], r: number, c: number | undefined): string {
  if (c == null) return "";
  const v = sheet[r]?.[c];
  return v == null ? "" : String(v).trim();
}

function parseDate(s: string): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  const m = t.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return undefined;
}

function parseMoney(s: string): number | undefined {
  if (!s) return undefined;
  const num = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

export async function parseContractExcel(buf: ArrayBuffer): Promise<{
  records: ContractRecord[];
  totalRows: number;
  sheetName: string;
}> {
  const XLSX = await ensureXlsx();
  const wb = XLSX.read(buf, { type: "array" });

  // 시트 우선순위: TabReport > 계약자명단 > 첫 시트
  const sheetName =
    wb.SheetNames.find((n: string) => /TabReport/i.test(n)) ||
    wb.SheetNames.find((n: string) => /계약/.test(n)) ||
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return { records: [], totalRows: 0, sheetName: "" };

  const sheet: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
  const header = findHeaderRow(sheet);
  if (!header) return { records: [], totalRows: 0, sheetName };

  const { row: hRow, cols } = header;
  const cDong = pickCol(cols, "동");
  const cHo = pickCol(cols, "호");
  const cUnit = pickCol(cols, "평형", "전용면적", "TYPE");
  const cDate = pickCol(cols, "계약일");
  const cName = pickCol(cols, "고객명", "성명", "계약자");
  const cRrn = pickCol(cols, "주민", "고객코드");
  const cPhone = pickCol(cols, "핸드폰", "휴대폰", "전화");
  const cRegAddr = pickCol(cols, "주민등록주소", "등록주소");
  const cResAddr = pickCol(cols, "거주지주소", "주소");
  const cPrice = pickCol(cols, "분양금", "총분양", "공급가");
  const cDown = pickCol(cols, "계약금");

  const records: ContractRecord[] = [];
  let totalRows = 0;
  for (let r = hRow + 1; r < sheet.length; r++) {
    const name = cell(sheet, r, cName);
    if (!name || /^(고객명|성명|계약자)$/.test(name)) continue;
    totalRows++;

    records.push({
      dong: cell(sheet, r, cDong) || undefined,
      ho: cell(sheet, r, cHo) || undefined,
      unitType: cell(sheet, r, cUnit) || undefined,
      contractDate: parseDate(cell(sheet, r, cDate)),
      customerName: name,
      rrnFrontMasked: cell(sheet, r, cRrn) || undefined,
      phone: cell(sheet, r, cPhone) || undefined,
      registeredAddress: cell(sheet, r, cRegAddr) || undefined,
      residenceAddress: cell(sheet, r, cResAddr) || undefined,
      contractPrice: parseMoney(cell(sheet, r, cPrice)),
      downPayment: parseMoney(cell(sheet, r, cDown)),
      rawRow: Object.fromEntries(
        Object.entries(cols).map(([k, c]) => [k, cell(sheet, r, c)]),
      ),
    });
  }
  return { records, totalRows, sheetName };
}

/**
 * 계약 레코드를 기존 customer와 매칭.
 * 1순위: 동·호 일치 + (이름 일치 OR 동명이인 없음)
 * 2순위: 동·호만 일치 (이름 다름 — 명의변경 가능성)
 * 매칭 없음 → 신규 등록 대상
 */
export interface MatchResult {
  matched?: LocalCustomer;
  nameChanged?: boolean;       // 동·호는 같은데 이름이 다른 경우 (선착순일 가능성)
}

export function matchContractToCustomer(
  rec: ContractRecord,
  customers: LocalCustomer[],
): MatchResult {
  if (!rec.dong || !rec.ho) return {};
  const byDH = customers.filter((c) => {
    const cd = String((c as any).unit_dong || c.winner_info?.building || "").trim();
    const ch = String((c as any).unit_ho || c.winner_info?.unit_no || "").trim();
    return cd === rec.dong && ch === rec.ho;
  });
  if (byDH.length === 0) return {};
  const sameName = byDH.find((c) => c.name === rec.customerName);
  if (sameName) return { matched: sameName, nameChanged: false };
  // 동·호 있는데 이름 다름 → 선착순 또는 명의변경
  return { matched: byDH[0], nameChanged: true };
}
