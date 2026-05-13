/**
 * 부적격자 서류검수 엑셀 파싱.
 *
 * 사업자(현장사무소) 측 「서류검수」 엑셀의 「오류내용」/「결과」 컬럼에서
 * 부적격 처리된 당첨자 목록을 추출. 시스템의 verification_verdict로 자동 반영.
 *
 * 예상 컬럼:
 *   - 동, 호수, 성명, 주민번호 (매칭용)
 *   - 오류내용 (부적격 사유 — 예: '특공 이중신청', '세대원 주택 보유')
 *   - 결과 (예: '부적격', '적합', '예비')
 */

import type { LocalCustomer } from "./local-store";
import { ensureXlsx } from "./winner-ingest";
import { classifyIneligibleReason, type IneligibleReasonCode } from "./ineligible-reasons";

export interface IneligibleRecord {
  dong?: string;
  ho?: string;
  name: string;
  rrn?: string;
  errorReason?: string;            // "오류내용" 컬럼
  result?: string;                 // "결과" 컬럼 (부적격/적합 등)
  reasonCodes: IneligibleReasonCode[]; // 자동 분류된 사유 코드
  rawRow: Record<string, string>;
}

/** 헤더 행에서 컬럼명 인덱스 맵 생성 */
function findHeaderRow(sheet: any[][], headerHints: string[]): { row: number; cols: Record<string, number> } | null {
  const limit = Math.min(10, sheet.length);
  for (let r = 0; r < limit; r++) {
    const row = sheet[r] || [];
    const cols: Record<string, number> = {};
    for (let c = 0; c < row.length; c++) {
      const v = String(row[c] || "").trim().replace(/\s+/g, "");
      if (!v) continue;
      cols[v] = c;
    }
    // 최소 「동」 「호수」 「성명」 「오류내용」 또는 「결과」 셋 이상 매칭되면 헤더 행
    const matched = headerHints.filter((h) => cols[h] !== undefined).length;
    if (matched >= 3) return { row: r, cols };
  }
  return null;
}

function cell(sheet: any[][], r: number, c: number | undefined): string {
  if (c == null) return "";
  const v = sheet[r]?.[c];
  return v == null ? "" : String(v).trim();
}

/**
 * 엑셀 → 부적격자 레코드 배열.
 * 「결과 = 부적격」 또는 「오류내용 != 빈값」 인 행만 추출.
 */
export async function parseIneligibleExcel(buf: ArrayBuffer): Promise<{
  records: IneligibleRecord[];
  totalRows: number;
  sheetName: string;
}> {
  const XLSX = await ensureXlsx();
  const wb = XLSX.read(buf, { type: "array" });

  // 「당첨자(특공 포함)」 시트 우선, 없으면 첫 시트
  const sheetName = wb.SheetNames.find((n: string) => /당첨자/.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return { records: [], totalRows: 0, sheetName: "" };

  const sheet: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
  const hints = ["동", "호수", "성명", "주민번호", "오류내용", "결과"];
  const header = findHeaderRow(sheet, hints);
  if (!header) return { records: [], totalRows: 0, sheetName };

  const { row: hRow, cols } = header;
  const cDong = cols["동"];
  const cHo = cols["호수"] ?? cols["호"];
  const cName = cols["성명"];
  const cRrn = cols["주민번호"];
  const cError = cols["오류내용"];
  const cResult = cols["결과"];

  const records: IneligibleRecord[] = [];
  let totalRows = 0;
  for (let r = hRow + 1; r < sheet.length; r++) {
    const name = cell(sheet, r, cName);
    if (!name) continue;
    totalRows++;

    const errorReason = cell(sheet, r, cError);
    const result = cell(sheet, r, cResult);
    const isIneligible =
      /부적격|부적합|탈락|취소/.test(result) ||
      (errorReason && errorReason.length > 0 && !/적합|정상/.test(errorReason));
    if (!isIneligible) continue;

    records.push({
      dong: cell(sheet, r, cDong) || undefined,
      ho: cell(sheet, r, cHo) || undefined,
      name,
      rrn: (cell(sheet, r, cRrn) || "").replace(/\D/g, "") || undefined,
      errorReason: errorReason || undefined,
      result: result || undefined,
      reasonCodes: classifyIneligibleReason(`${errorReason} ${result}`),
      rawRow: Object.fromEntries(
        Object.entries(cols).map(([k, c]) => [k, cell(sheet, r, c)]),
      ),
    });
  }
  return { records, totalRows, sheetName };
}

/**
 * 부적격 레코드를 당첨자에게 매칭.
 *   1순위: 주민번호 13자리 일치
 *   2순위: 동·호 일치
 *   3순위: 이름 일치
 */
export function matchIneligibleToCustomer(
  rec: IneligibleRecord,
  customers: LocalCustomer[],
): LocalCustomer | undefined {
  if (rec.rrn && /^\d{13}$/.test(rec.rrn)) {
    const byRrn = customers.find(
      (c) => (c.rrn_front || "") + (c.rrn_back || "") === rec.rrn,
    );
    if (byRrn) return byRrn;
  }
  if (rec.dong && rec.ho) {
    const byDH = customers.find((c) => {
      const cd = String((c as any).unit_dong || c.winner_info?.building || "").trim();
      const ch = String((c as any).unit_ho || c.winner_info?.unit_no || "").trim();
      return cd === rec.dong && ch === rec.ho;
    });
    if (byDH && byDH.name === rec.name) return byDH;
    if (byDH) return byDH; // 이름이 다르면 약한 매칭이지만 시도
  }
  return customers.find((c) => c.name === rec.name);
}
