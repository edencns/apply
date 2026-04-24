/**
 * CSV/Excel DDE (Dynamic Data Exchange) 인젝션 방지
 *
 * Excel은 셀 값이 =, +, -, @ 로 시작하면 수식으로 해석.
 * 공격자가 당첨자 이름에 `=cmd|'/C calc'!A1` 같은 값을 넣고
 * 우리가 그 값을 포함한 CSV/XLSX를 다운로드하면 수신자 PC에서 실행 위험.
 *
 * 수출(export) 경로에서 각 셀 문자열을 이 함수로 감싸 무력화.
 */

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

/** 셀 값 안전화: 위험 prefix면 선행 작은따옴표 추가해 수식으로 해석되지 않게 함 */
export function sanitizeCsvCell(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  if (DANGEROUS_PREFIX.test(s)) return `'${s}`;
  return s;
}

/** 객체 배열의 모든 문자열 값 안전화 */
export function sanitizeRowsForCsv<T extends Record<string, any>>(rows: T[]): T[] {
  return rows.map((row) => {
    const out: any = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = typeof v === "string" ? sanitizeCsvCell(v) : v;
    }
    return out as T;
  });
}
