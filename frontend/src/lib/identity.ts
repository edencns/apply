/**
 * 동일인 판별 — 마스킹된 레코드에도 안정적으로 작동
 *
 * 실무 상황: PDF에는 이름(김*형) · 주민번호 뒷자리(1******)가 가려져 있고,
 * 엑셀에는 풀네임과 주민번호 13자리가 모두 있다.
 * 양쪽을 교차해 동일인을 찾으려면 **여러 신호를 복합**으로 봐야 한다.
 *
 * 쓰는 신호 (가중치):
 *   주민번호 13자리 일치 ......... 결정적 (일치=동일, 불일치=상이)
 *   주민번호 앞 6자리 일치 ...... +2  (생년월일 + 지역코드)
 *   성별 번호 일치 (7번째) ....... +1  (주민번호 뒷자리 첫 숫자)
 *   전화번호 일치 ................. +2
 *   이름 와일드카드 일치 ......... +1  (김*형 ↔ 김도형)
 *
 * 총점 ≥ 3 → 동일인으로 판정
 * 단, "conflict"(같은 자리에 다른 값)가 있으면 바로 상이한 사람으로 처리
 *   (예: 주민번호 앞자리가 다르면 같은 사람일 수 없음)
 */

/** 전화번호 정규화 — 비교는 숫자만 */
export function normalizePhoneForMatch(v?: string): string {
  if (!v) return "";
  return String(v).replace(/\D/g, "");
}

/** 이름 와일드카드 비교 — "김*형" ↔ "김도형" 같은 길이일 때만 매칭 */
export function nameWildcardMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const ta = a.trim();
  const tb = b.trim();
  if (ta === tb) return true;
  if (ta.length !== tb.length) return false;
  for (let i = 0; i < ta.length; i++) {
    const ca = ta[i];
    const cb = tb[i];
    if (ca === "*" || cb === "*") continue; // 마스킹 위치는 skip
    if (ca !== cb) return false;
  }
  return true;
}

/** 동일인 판별에 쓰는 식별자 후보 */
export interface IdentityCandidate {
  name?: string;
  rrn?: string;       // 13자리 (있으면 결정적)
  rrnFront?: string;  // 6자리
  rrnGender?: string; // 1자리 (7번째 — 성별)
  phone?: string;     // 숫자만
}

/** 주민번호 성별 digit 유효성 — 1~8만 실제 성별코드 (0/9/*는 placeholder/마스킹) */
function isValidGenderDigit(d?: string): boolean {
  return !!d && /^[1-8]$/.test(d);
}

/** 여러 원본 레코드 shape에서 IdentityCandidate 추출 */
export function toIdentity(
  r: {
    name?: string;
    rrn?: string;
    rrnMasked?: string;
    phone?: string;
    rrn_front?: string;
    rrn_back?: string;
  },
): IdentityCandidate {
  const id: IdentityCandidate = {
    name: r.name?.trim() || undefined,
    phone: normalizePhoneForMatch(r.phone) || undefined,
  };

  // 13자리 주민번호 있으면 그대로 분해
  if (r.rrn && /^\d{13}$/.test(r.rrn)) {
    id.rrn = r.rrn;
    id.rrnFront = r.rrn.slice(0, 6);
    const g = r.rrn.slice(6, 7);
    if (isValidGenderDigit(g)) id.rrnGender = g;
    return id;
  }

  // PDF 마스킹된 "880820-1******" 포맷
  if (r.rrnMasked) {
    const [front, back] = r.rrnMasked.split("-");
    if (/^\d{6}$/.test(front || "")) id.rrnFront = front;
    if (back) {
      const g = back.charAt(0);
      if (isValidGenderDigit(g)) id.rrnGender = g;
    }
    return id;
  }

  // LocalCustomer 필드
  if (r.rrn_front && /^\d{6}$/.test(r.rrn_front)) id.rrnFront = r.rrn_front;
  if (r.rrn_back) {
    // "1*****" 또는 "1234567" 중 첫 자리가 유효한 성별코드(1-8)일 때만 수집
    // "0000000" 같은 placeholder는 제외
    const g = r.rrn_back.charAt(0);
    if (isValidGenderDigit(g)) id.rrnGender = g;
  }

  return id;
}

export interface IdentityScoreResult {
  /** 총점 (≥ 3이면 동일인 간주) */
  score: number;
  /** 매칭된 신호 목록 — UI 디버깅/표시용 */
  matched: string[];
  /** 상호 모순 (예: 주민번호 앞자리가 다름) — true면 무조건 상이 */
  conflict: boolean;
  /** 완전 일치 여부 (주민번호 13자리 동일) */
  exact: boolean;
}

/**
 * 두 후보 비교 (엄격 매칭)
 *
 * 규칙:
 *  - 13자리 RRN 양쪽 일치 → 결정적 동일인
 *  - 그 외에는 모든 가용 신호가 **상호 모순 없어야** 동일인 후보
 *    · 생년월일(RRN 앞 6자리) 다르면 → 상이
 *    · 성별 digit 다르면 → 상이 (둘 다 유효할 때만)
 *    · 이름 와일드카드 패턴 불일치 (첫/마지막 글자 등) → 상이
 *    · 전화번호 있는데 다르면 → 상이
 *  - 추가로 "신호 품질" 요건:
 *    · 생년월일 + 최소 1개의 다른 신호(이름/전화/성별)가 양쪽 모두 있어 일치해야 함
 *    · 생년월일만 같고 나머지 신호가 전부 없거나 한쪽만 있으면 동일인으로 단정 못함
 */
export function identityScore(a: IdentityCandidate, b: IdentityCandidate): IdentityScoreResult {
  // 13자리 RRN 양쪽 다 있으면 결정적
  if (a.rrn && b.rrn) {
    return a.rrn === b.rrn
      ? { score: 100, matched: ["rrn13"], conflict: false, exact: true }
      : { score: 0, matched: [], conflict: true, exact: false };
  }

  const matched: string[] = [];
  let score = 0;
  let conflict = false;

  // (1) 생년월일 — 양쪽 모두 있고 일치해야 함. 한쪽이라도 없으면 동일인 판정 불가
  if (a.rrnFront && b.rrnFront) {
    if (a.rrnFront === b.rrnFront) {
      score += 2;
      matched.push("rrn_front");
    } else {
      conflict = true;
    }
  }

  // (2) 성별 digit — 양쪽 다 유효(1-8)할 때만 비교
  if (a.rrnGender && b.rrnGender) {
    if (a.rrnGender === b.rrnGender) {
      score += 1;
      matched.push("gender");
    } else {
      conflict = true;
    }
  }

  // (3) 이름 — 와일드카드 패턴 비교 (첫/마지막 글자 포함)
  //     사용자 요구: "맨 앞 글자랑 맨 뒷 글자를 비교"
  //     양쪽 모두 있으면 nameWildcardMatch 실패 시 무조건 conflict
  //     (양쪽 다 마스킹이라도 드러난 글자가 다르면 다른 사람)
  if (a.name && b.name) {
    if (nameWildcardMatch(a.name, b.name)) {
      score += 1;
      matched.push("name");
    } else {
      conflict = true;
    }
  }

  // (4) 전화번호 — 양쪽 다 있을 때만 비교. 다르면 conflict.
  if (a.phone && b.phone) {
    if (a.phone === b.phone) {
      score += 2;
      matched.push("phone");
    } else {
      conflict = true;
    }
  }

  return { score, matched, conflict, exact: false };
}

/**
 * 엄격 동일인 판정
 *  - conflict 신호 하나라도 있으면 상이
 *  - 생년월일 일치는 필수
 *  - 생년월일 외 추가로 (이름·전화·성별 중) **양쪽이 모두 확보된** 최소 1개 신호가 일치해야 함
 */
export function sameIdentity(a: IdentityCandidate, b: IdentityCandidate): boolean {
  const r = identityScore(a, b);
  if (r.exact) return true;
  if (r.conflict) return false;

  // 생년월일 필수
  if (!r.matched.includes("rrn_front")) return false;

  // 생년월일 외 검증 신호 최소 1개 (양쪽 모두 확보되고 일치한 것)
  const hasSecondSignal =
    r.matched.includes("name") ||
    r.matched.includes("phone") ||
    r.matched.includes("gender");
  return hasSecondSignal;
}

/** 디버그/표시용 요약 — "주민번호 앞자리 + 성별 + 전화 일치" */
export function describeMatch(score: IdentityScoreResult): string {
  if (score.exact) return "주민번호 13자리 일치";
  if (score.conflict) return "상이";
  if (score.score === 0) return "일치 신호 없음";
  const label: Record<string, string> = {
    rrn_front: "주민번호 앞자리",
    gender: "성별",
    phone: "전화",
    name: "이름",
  };
  return score.matched.map((m) => label[m] || m).join(" + ");
}
