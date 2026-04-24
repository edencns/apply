/**
 * 청약홈 전산 주택형 코드 ↔ 실제 면적·약식 변환
 *
 * 전산 코드 형식: 7자리 숫자(+ 선택적 알파벳)
 *   - 앞 2자리: 정수부 (m²)
 *   - 뒤 4자리: 소수부 (4자리)
 *   - 끝 알파벳: 동일 정수부 내 변형 구분 (A/B/C…)
 *
 * 예시:
 *   "0733949"  → 73.3949㎡, 약식 "73"   → 표시 "73.3949(73)"
 *   "0771066A" → 77.1066㎡, 약식 "77A"  → 표시 "77.1066(77A)"
 *   "0774779B" → 77.4779㎡, 약식 "77B"  → 표시 "77.4779(77B)"
 *   "0848636"  → 84.8636㎡, 약식 "84"   → 표시 "84.8636(84)"
 *   "084.8636" → 이미 소수 형태 → 그대로
 */

export interface HousingCodeParsed {
  /** 원본 코드 */
  raw: string;
  /** 전용면적(㎡, 소수 4자리까지) — 계산 가능할 때만 */
  area: number | null;
  /** 전용면적 문자열 — "84.8636" */
  areaStr: string;
  /** 약식 표기 — "84" 또는 "77A" */
  shortForm: string;
  /** 변형 알파벳 — "A" / "B" / "" */
  variant: string;
  /** 표시용 — "84.8636(84)", 해석 실패 시 원본 그대로 */
  display: string;
}

export function parseHousingCode(raw: string | null | undefined): HousingCodeParsed {
  const code = String(raw ?? "").trim();
  if (!code) {
    return { raw: "", area: null, areaStr: "", shortForm: "", variant: "", display: "" };
  }

  // 1) 이미 소수 포함 "84.8636" / "84.8636A" 형식
  const decimalMatch = code.match(/^(\d{2,3})\.(\d{1,4})([A-Za-z]?)$/);
  if (decimalMatch) {
    const whole = decimalMatch[1];
    const frac = decimalMatch[2].padEnd(4, "0").slice(0, 4);
    const variant = decimalMatch[3].toUpperCase();
    const area = Number(`${whole}.${frac}`);
    const areaStr = `${whole}.${frac}`.replace(/\.?0+$/, (m) => (m.startsWith(".") ? "" : m));
    const shortForm = `${whole}${variant}`;
    return { raw: code, area, areaStr, shortForm, variant, display: `${areaStr}(${shortForm})` };
  }

  // 2) 7자리 코드 "0848636" 또는 "0848636A"
  const codeMatch = code.match(/^(\d{2})(\d{4})([A-Za-z]?)$/) || code.match(/^0?(\d{2,3})(\d{4})([A-Za-z]?)$/);
  if (codeMatch) {
    const whole = codeMatch[1];
    const frac = codeMatch[2];
    const variant = codeMatch[3].toUpperCase();
    const area = Number(`${whole}.${frac}`);
    const areaStr = `${whole}.${frac}`;
    const shortForm = `${whole}${variant}`;
    return { raw: code, area, areaStr, shortForm, variant, display: `${areaStr}(${shortForm})` };
  }

  // 3) 이미 약식 "84" / "77A" 같은 경우 — 면적 불명
  const shortOnly = code.match(/^(\d{2,3})([A-Za-z]?)$/);
  if (shortOnly) {
    const whole = shortOnly[1];
    const variant = shortOnly[2].toUpperCase();
    return {
      raw: code, area: null, areaStr: "", variant,
      shortForm: `${whole}${variant}`,
      display: `${whole}${variant}`,
    };
  }

  // 파싱 실패 — 원본 그대로
  return { raw: code, area: null, areaStr: "", shortForm: code, variant: "", display: code };
}

/** "84.8636(84)" 같은 표시 문자열 반환 — 파싱 실패 시 원본 */
export function formatHousingCode(raw: string | null | undefined): string {
  return parseHousingCode(raw).display;
}

/** "84.8636㎡" — unit_area 컬럼용 */
export function housingAreaString(raw: string | null | undefined): string {
  const p = parseHousingCode(raw);
  return p.areaStr ? `${p.areaStr}㎡` : "";
}

/** 정렬용 — 소수 면적 숫자 (없으면 Infinity 반환해서 맨 뒤로) */
export function housingAreaNumber(raw: string | null | undefined): number {
  const p = parseHousingCode(raw);
  return p.area ?? Number.POSITIVE_INFINITY;
}

/**
 * 한국 전화번호 정규화 — "010 12345678" / "01012345678" / "010-1234-5678" 등 → "010-1234-5678"
 *
 * 규칙:
 *  - 02(서울): 9자리 "02-XXX-XXXX" · 10자리 "02-XXXX-XXXX"
 *  - 휴대전화 010/011/016/017/018/019: 11자리 "010-XXXX-XXXX", 10자리 "010-XXX-XXXX"
 *  - 기타 지역 0XX: 10자리 "0XX-XXX-XXXX", 11자리 "0XX-XXXX-XXXX"
 *  - 인식 실패 시 원본 그대로
 */
export function formatPhone(raw: string | null | undefined): string {
  const src = String(raw ?? "").trim();
  if (!src) return "";
  const digits = src.replace(/\D/g, "");
  if (!digits) return src;

  // 02 서울
  if (digits.startsWith("02")) {
    if (digits.length === 9) return `02-${digits.slice(2, 5)}-${digits.slice(5)}`;
    if (digits.length === 10) return `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
    return src;
  }
  // 010/011/016/017/018/019 휴대전화 + 0XX 지역번호 공통
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return src;
}

/**
 * 입력 중 실시간 포맷 — 타이핑하면서 하이픈이 자동 삽입됨
 * 완성 전이어도 부분 포맷 제공.
 *
 * 예시 (휴대전화):
 *   "0" → "0"
 *   "010" → "010"
 *   "0101" → "010-1"
 *   "01012345" → "010-1234-5"
 *   "01012345678" → "010-1234-5678"
 *
 * 예시 (서울 02):
 *   "02" → "02"
 *   "021234" → "02-1234"
 *   "02123456" → "02-1234-56"
 */
export function formatPhoneInput(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";

  // 02 서울 (2자리 지역번호)
  if (digits.startsWith("02")) {
    if (digits.length <= 2) return digits;
    // 중간 부분 3자리 vs 4자리는 전체 길이로 판단
    if (digits.length <= 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) {
      // 9자리: 02-XXX-XXXX
      return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    }
    // 10자리: 02-XXXX-XXXX
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }

  // 휴대전화 010/011/016/017/018/019 + 기타 3자리 지역번호 (0XX)
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  // 11자리: 010-XXXX-XXXX / 10자리: 010-XXX-XXXX
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  // 8~10자리 중간 상태 — 4자리 중간 가정 후 나머지
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}
