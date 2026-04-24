/**
 * 최종 계약자 명단 엑셀 파서
 *
 * 청약홈 검증 → 계약 체결 → 명의변경(발생한 경우)까지 완료된
 * 확정 계약자 명단을 일괄 등록용으로 파싱.
 *
 * 일반적인 엑셀 컬럼 구조 (주문진 삼부르네상스 오션포레 "명의변경이후 최종계약자 명단.xlsx" 기준):
 *   sms | 순번 | 조합여부 | 동 | 호 | 평형 | TYPE | 계약일 | 주민번호 | 이름 |
 *   전화번호 × 2 | 핸드폰 | 우편번호 | 주민등록 주소 | 우편번호 | 거주지 주소 | E-Mail |
 *   계약서번호 | 비고 | 공동명의코드 | 공동명의자 | 공동명의자 핸드폰 |
 *   총분양금 | 계약금(1차) | 계약금(2차) | 1~6차 중도금 | 잔금 | 옵션금액
 *
 * 파서는 헤더 키워드로 컬럼 자동 인식 → 순서가 약간 달라도 동작.
 */

import * as XLSX from "xlsx";

export interface FinalContractRow {
  dong: string;                    // 동
  ho: string;                      // 호
  name: string;                    // 계약자 이름
  rrn: string;                     // 주민번호 (마스킹 포함)
  rrnFront: string;                // 앞 6자리
  unitType?: string;               // 평형 (84.8636)
  typeCode?: string;               // TYPE
  contractDate?: string;           // 계약일 YYYY-MM-DD
  phone?: string;
  residentAddress?: string;
  livingAddress?: string;
  email?: string;
  contractNo?: string;
  coContractorName?: string;
  coContractorPhone?: string;
  coContractorCode?: string;
  totalPrice?: number;
  downPayment?: number;            // 계약금(1차) + 계약금(2차) 합산
  midPayments?: number[];          // 1~6차
  finalPayment?: number;
  optionPrice?: number;
  note?: string;                   // 비고
}

export interface FinalContractIngestResult {
  rows: FinalContractRow[];
  errors: string[];
  totalRows: number;
  sheet: string;
}

function str(v: any): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function num(v: any): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function dateIso(v: any): string | undefined {
  if (!v) return undefined;
  // Excel 숫자 날짜인 경우
  if (typeof v === "number") {
    const dt = XLSX.SSF.parse_date_code(v);
    if (dt) {
      return `${dt.y}-${String(dt.m).padStart(2, "0")}-${String(dt.d).padStart(2, "0")}`;
    }
  }
  const s = String(v).trim();
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return undefined;
}

function rrnFrontOf(rrn: string): string {
  return rrn.replace(/[^\d]/g, "").slice(0, 6);
}

/** 헤더 배열에서 키워드 포함 컬럼 인덱스 찾기 (여러 후보 가능) */
function findCol(header: any[], ...keywords: Array<string | RegExp>): number {
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || "");
    for (const kw of keywords) {
      if (typeof kw === "string" ? h.includes(kw) : kw.test(h)) return i;
    }
  }
  return -1;
}

export function parseFinalContractExcel(buf: ArrayBuffer): FinalContractIngestResult {
  const wb = XLSX.read(buf, { type: "array" });
  const errors: string[] = [];

  // 가장 많은 행을 가진 시트를 기본으로
  let best: { name: string; grid: any[][]; headerIdx: number } | null = null;
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
    if (grid.length < 2) continue;

    // 헤더 위치 자동 감지 (첫 행이 보통)
    let headerIdx = -1;
    for (let i = 0; i < Math.min(grid.length, 5); i++) {
      const row = grid[i];
      const joined = row.map((v) => String(v || "")).join("|");
      if (/고객명|계약일|주민|전화|분양금|동.*호/.test(joined)) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) headerIdx = 0;

    if (!best || grid.length - headerIdx > best.grid.length - best.headerIdx) {
      best = { name, grid, headerIdx };
    }
  }

  if (!best) {
    return { rows: [], errors: ["유효한 시트를 찾지 못했습니다"], totalRows: 0, sheet: "" };
  }

  const { name: sheet, grid, headerIdx } = best;
  const header = grid[headerIdx] || [];

  const col = {
    dong: findCol(header, /^동/, "동(호"),
    ho: findCol(header, /^호/, "호수", "구좌"),
    unitType: findCol(header, "평형", "주택형", /type/i),
    typeCode: findCol(header, /^TYPE/, "타입"),
    contractDate: findCol(header, "계약일"),
    rrn: findCol(header, "주민", "고객코드"),
    name: findCol(header, "고객명", "계약자", "성명"),
    phone: findCol(header, "핸드폰", "휴대폰", /전화번호/),
    addr1: findCol(header, "주민등록.*주소"),
    addr2: findCol(header, "거주지", "주소"),
    email: findCol(header, "E-Mail", "이메일"),
    contractNo: findCol(header, "계약서번호"),
    note: findCol(header, "비고"),
    coCode: findCol(header, "공동명의코드"),
    coName: findCol(header, "공동명의자$", /공동명의자 성명/),
    coPhone: findCol(header, "공동명의자 핸드폰"),
    totalPrice: findCol(header, "총분양금"),
    down1: findCol(header, "계약금(1차)", /계약금1/),
    down2: findCol(header, "계약금(2차)", /계약금2/),
    mid1: findCol(header, /1차 중도금/),
    mid2: findCol(header, /2차 중도금/),
    mid3: findCol(header, /3차 중도금/),
    mid4: findCol(header, /4차 중도금/),
    mid5: findCol(header, /5차 중도금/),
    mid6: findCol(header, /6차 중도금/),
    finalPay: findCol(header, /^잔금$/, "잔금액"),
    option: findCol(header, "옵션", "옵션금액"),
  };

  const rows: FinalContractRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r) continue;

    const name = str(r[col.name]);
    const rrn = str(r[col.rrn]);
    if (!name && !rrn) continue;

    const dong = str(r[col.dong]).replace(/\s/g, "");
    const ho = str(r[col.ho]).replace(/\s/g, "");
    if (!dong || !ho) {
      errors.push(`${i + 1}행: 동/호 누락 (이름=${name})`);
      continue;
    }

    const midPayments: number[] = [];
    for (const k of [col.mid1, col.mid2, col.mid3, col.mid4, col.mid5, col.mid6]) {
      if (k < 0) continue;
      const v = num(r[k]);
      if (v !== undefined) midPayments.push(v);
    }

    const d1 = num(r[col.down1]) || 0;
    const d2 = num(r[col.down2]) || 0;
    const downPayment = d1 + d2 || undefined;

    rows.push({
      dong,
      ho,
      name,
      rrn,
      rrnFront: rrnFrontOf(rrn),
      unitType: str(r[col.unitType]) || undefined,
      typeCode: str(r[col.typeCode]) || undefined,
      contractDate: dateIso(r[col.contractDate]),
      phone: str(r[col.phone]) || undefined,
      residentAddress: str(r[col.addr1]) || undefined,
      livingAddress: str(r[col.addr2]) || undefined,
      email: str(r[col.email]) || undefined,
      contractNo: str(r[col.contractNo]) || undefined,
      note: str(r[col.note]) || undefined,
      coContractorCode: str(r[col.coCode]) || undefined,
      coContractorName: str(r[col.coName]) || undefined,
      coContractorPhone: str(r[col.coPhone]) || undefined,
      totalPrice: num(r[col.totalPrice]),
      downPayment,
      midPayments: midPayments.length > 0 ? midPayments : undefined,
      finalPayment: num(r[col.finalPay]),
      optionPrice: num(r[col.option]),
    });
  }

  return { rows, errors, totalRows: rows.length, sheet };
}
