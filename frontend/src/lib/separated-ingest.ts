/**
 * 분리세대 명단 엑셀 파서
 *
 * 청약홈 자동 조회 대상이 아닌 분리세대원(배우자 분리세대 등)을
 * 담당자가 수기로 정리한 엑셀을 파싱.
 *
 * 엑셀 포맷 (주문진삼부르네상스오션포레 분리세대 명단 기준):
 *  Row 0: 제목
 *  Row 1: 헤더
 *  Row 2+: 데이터
 *    A: 타입(일반1순위/신혼부부특공 등)
 *    B: 동
 *    C: 호수
 *    D: 당첨자 이름
 *    E: 당첨자 주민번호
 *    F: 전화번호
 *    G-K: 계좌/은행/통장명/지역
 *    L: 세대주와의 관계 (헤더상, 실제 내용은 우측 컬럼)
 *    M: 분리세대원 성명
 *    N: 분리세대원 주민번호
 *    O: 관계 (배우자/자녀/부모 등)
 *    P: 메모 ("등본확인" 등)
 *
 * 한 당첨자에 분리세대원이 여러 명이면 첫 행에만 당첨자 정보가 있고
 * 나머지 행은 분리세대원 정보만 채워져 있음.
 */

import * as XLSX from "xlsx";

export interface SeparatedRow {
  winnerName: string;          // 당첨자 이름
  winnerRrnFront: string;      // 당첨자 주민번호 앞 6자리 (매칭용)
  winnerRrnFull?: string;      // 당첨자 전체 주민번호
  winnerDong?: string;
  winnerHo?: string;
  winnerSupplyType?: string;   // 일반1순위, 신혼부부특공 등
  memberName: string;          // 분리세대원 이름
  memberRrn: string;           // 분리세대원 주민번호 (앞6-뒷7)
  memberRrnFront: string;      // 앞 6자리만
  relation: string;            // 배우자/자녀/부모 등
  note?: string;
}

export interface SeparatedIngestResult {
  totalRows: number;
  byWinnerRrn: Map<string, SeparatedRow[]>; // key: winner rrn front 6
  allRows: SeparatedRow[];
  errors: string[];
}

function pick(row: any[], i: number): string {
  const v = row?.[i];
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function normalizeRrn(s: string): string {
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 13) return `${digits.slice(0, 6)}-${digits.slice(6, 13)}`;
  if (digits.length >= 6) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return s;
}

function rrnFront(s: string): string {
  const digits = s.replace(/\D/g, "");
  return digits.slice(0, 6);
}

/**
 * 분리세대 엑셀 버퍼를 파싱.
 * 헤더 위치를 자동 감지 (여러 템플릿 호환)
 */
export function parseSeparatedExcel(buf: ArrayBuffer): SeparatedIngestResult {
  const wb = XLSX.read(buf, { type: "array" });
  const result: SeparatedIngestResult = {
    totalRows: 0,
    byWinnerRrn: new Map(),
    allRows: [],
    errors: [],
  };

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
    if (grid.length < 3) continue;

    // 헤더 행 찾기 — "타입" 또는 "당첨자" 같은 키워드 포함 행
    let headerIdx = -1;
    for (let i = 0; i < Math.min(grid.length, 8); i++) {
      const row = grid[i];
      const joined = row.map((v) => String(v || "")).join("|");
      if (/타입.*이름.*주민|세대원|분리세대|성명.*주민등록/.test(joined)) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) {
      // 헤더 못 찾으면 2행(기본)을 가정
      headerIdx = 1;
    }

    // 컬럼 맵 해석 — 헤더 내용으로 인덱스 결정
    const header = grid[headerIdx] || [];
    const findCol = (predicate: (s: string) => boolean): number =>
      header.findIndex((v: any) => predicate(String(v || "")));

    // 기본 레이아웃 (주문진 삼부르네상스 오션포레 기준)
    //   D: 이름, E: 주민번호, M: 분리세대원 성명, N: 분리세대원 주민번호, O: 관계, P: 메모
    let cType = findCol((s) => /^타입/.test(s));
    let cDong = findCol((s) => /^동$/.test(s));
    let cHo = findCol((s) => /^호수?$/.test(s));
    let cWinnerName = findCol((s) => /이름|당첨자.*성명/.test(s) && !/세대원|분리/.test(s));
    let cWinnerRrn = -1;
    // 주민번호가 두 번 나오므로 첫 번째만 잡음
    for (let i = 0; i < header.length; i++) {
      if (/주민(등록)?번호/.test(String(header[i] || ""))) {
        cWinnerRrn = i;
        break;
      }
    }
    // 분리세대원 성명·주민번호는 두 번째 블록
    let cMemberName = -1;
    let cMemberRrn = -1;
    for (let i = (cWinnerRrn >= 0 ? cWinnerRrn + 1 : 0); i < header.length; i++) {
      const s = String(header[i] || "");
      if (/성명/.test(s) && cMemberName < 0) cMemberName = i;
      if (/주민(등록)?번호/.test(s) && cMemberRrn < 0 && i !== cWinnerRrn) cMemberRrn = i;
    }
    let cRelation = findCol((s) => /^관계/.test(s) || /세대주.*관계/.test(s));
    let cNote = header.length - 1; // 메모는 보통 마지막 열

    // 기본값 fallback
    if (cWinnerName < 0) cWinnerName = 3;
    if (cWinnerRrn < 0) cWinnerRrn = 4;
    if (cMemberName < 0) cMemberName = 12;
    if (cMemberRrn < 0) cMemberRrn = 13;
    if (cRelation < 0) cRelation = 14;

    // 데이터 행 순회 — 당첨자 정보는 "캐리" (빈 칸이면 이전 행 것 사용)
    let currentWinner: {
      name: string;
      rrn: string;
      dong?: string;
      ho?: string;
      supplyType?: string;
    } | null = null;

    for (let i = headerIdx + 1; i < grid.length; i++) {
      const row = grid[i];
      if (!row) continue;

      const winnerNameRaw = pick(row, cWinnerName);
      const winnerRrnRaw = pick(row, cWinnerRrn);
      if (winnerNameRaw && winnerRrnRaw) {
        currentWinner = {
          name: winnerNameRaw,
          rrn: normalizeRrn(winnerRrnRaw),
          dong: pick(row, cDong) || undefined,
          ho: pick(row, cHo) || undefined,
          supplyType: pick(row, cType) || undefined,
        };
      }

      const memberName = pick(row, cMemberName);
      const memberRrnRaw = pick(row, cMemberRrn);
      if (!memberName || !memberRrnRaw) continue;
      if (!currentWinner) {
        result.errors.push(`${i + 1}행: 당첨자 정보 없이 분리세대원만 기재됨`);
        continue;
      }

      const memberRrn = normalizeRrn(memberRrnRaw);
      const sep: SeparatedRow = {
        winnerName: currentWinner.name,
        winnerRrnFront: rrnFront(currentWinner.rrn),
        winnerRrnFull: currentWinner.rrn,
        winnerDong: currentWinner.dong,
        winnerHo: currentWinner.ho,
        winnerSupplyType: currentWinner.supplyType,
        memberName,
        memberRrn,
        memberRrnFront: rrnFront(memberRrn),
        relation: pick(row, cRelation) || "관계 미상",
        note: pick(row, cNote) || undefined,
      };
      result.allRows.push(sep);
      result.totalRows++;

      const key = sep.winnerRrnFront;
      if (!result.byWinnerRrn.has(key)) result.byWinnerRrn.set(key, []);
      result.byWinnerRrn.get(key)!.push(sep);
    }
  }

  return result;
}
