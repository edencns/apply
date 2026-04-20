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
    name: r.name?.trim(),
    phone: normalizePhoneForMatch(r.phone),
  };

  // 13자리 주민번호 있으면 그대로 분해
  if (r.rrn && /^\d{13}$/.test(r.rrn)) {
    id.rrn = r.rrn;
    id.rrnFront = r.rrn.slice(0, 6);
    id.rrnGender = r.rrn.slice(6, 7);
    return id;
  }

  // PDF 마스킹된 "880820-1******" 포맷
  if (r.rrnMasked) {
    const [front, back] = r.rrnMasked.split("-");
    if (/^\d{6}$/.test(front || "")) id.rrnFront = front;
    if (back && /^\d/.test(back)) id.rrnGender = back.charAt(0);
    return id;
  }

  // LocalCustomer 필드
  if (r.rrn_front && /^\d{6}$/.test(r.rrn_front)) id.rrnFront = r.rrn_front;
  if (r.rrn_back) {
    // "1*****" 또는 "1234567" 등 첫 자리만 수집
    const g = r.rrn_back.charAt(0);
    if (/^\d$/.test(g)) id.rrnGender = g;
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

/** 두 후보를 비교해 점수 계산 */
export function identityScore(a: IdentityCandidate, b: IdentityCandidate): IdentityScoreResult {
  // 결정적: 13자리 RRN 양쪽 다 있으면 그걸로 끝
  if (a.rrn && b.rrn) {
    return a.rrn === b.rrn
      ? { score: 100, matched: ["rrn13"], conflict: false, exact: true }
      : { score: 0, matched: [], conflict: true, exact: false };
  }

  const matched: string[] = [];
  let score = 0;
  let conflict = false;

  // 주민번호 앞 6자리 (생년월일+지역코드) — 가장 안정적
  if (a.rrnFront && b.rrnFront) {
    if (a.rrnFront === b.rrnFront) {
      score += 2;
      matched.push("rrn_front");
    } else {
      conflict = true; // 앞자리 다르면 다른 사람
    }
  }

  // 성별 번호
  if (a.rrnGender && b.rrnGender) {
    if (a.rrnGender === b.rrnGender) {
      score += 1;
      matched.push("gender");
    } else {
      conflict = true; // 성별 다르면 다른 사람
    }
  }

  // 전화번호
  if (a.phone && b.phone) {
    if (a.phone === b.phone) {
      score += 2;
      matched.push("phone");
    }
    // 전화 불일치는 conflict로 보지 않음 (번호 변경 가능)
  }

  // 이름 — 와일드카드 매칭
  if (a.name && b.name) {
    if (nameWildcardMatch(a.name, b.name)) {
      score += 1;
      matched.push("name");
    } else {
      // 양쪽 다 마스킹 없이 다른 이름이면 conflict
      if (!a.name.includes("*") && !b.name.includes("*")) {
        conflict = true;
      }
    }
  }

  return { score, matched, conflict, exact: false };
}

/** 임계치 3점 이상 동일인으로 간주 */
export function sameIdentity(a: IdentityCandidate, b: IdentityCandidate): boolean {
  const r = identityScore(a, b);
  if (r.conflict) return false;
  return r.exact || r.score >= 3;
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
