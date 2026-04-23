/**
 * 공고 당첨자 전원에 대한 교차검증 엔진
 *
 * 한 명씩의 verification-rules.ts와 달리, 이 파일은 "여러 당첨자 사이의 관계"에서만
 * 드러나는 이상 징후를 찾는다. 담당자가 눈으로 놓치기 쉬운 패턴 자동 감지.
 *
 * 주요 감지 카테고리:
 *   - 동일 주소 중복 당첨 (부부 중복 당첨 가능성)
 *   - 동일 계좌번호 공유 (차명 의심)
 *   - 세대원에서 다른 당첨자 주민번호 발견 (중복 세대)
 *   - 공고 요건 위반 (혼인기간 초과, 자녀수 부족 등 — supply_types_detail 조건 대조)
 *   - 특공 유형별 자격 교차
 */

import type { LocalAnnouncement, LocalCustomer } from "./local-store";

export interface CrossCheckIssue {
  severity: "error" | "warning" | "info";
  category:
    | "duplicate-household"
    | "duplicate-account"
    | "household-overlap"
    | "supply-requirement"
    | "age-boundary"
    | "timing";
  /** 대표 당첨자 id (주로 먼저 접수된 쪽) */
  customerId: number;
  /** 관련 당첨자 ids (1명 이상) */
  relatedIds?: number[];
  /** 사람이 읽는 메시지 */
  message: string;
  /** 담당자 조치 안내 */
  recommendation?: string;
}

function digitsOf(s: any): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** 주소 정규화 — 비교용으로 공백·특수문자 제거 */
function normalizeAddress(raw?: string): string {
  if (!raw) return "";
  return raw
    .replace(/\s+/g, "")
    .replace(/[()\-·,]/g, "")
    .replace(/\d+층|\d+호/g, "")  // 층·호 차이는 같은 집일 수 있어 무시
    .toLowerCase();
}

/** 생년월일 계산 — rrn_front "YYMMDD" → 연도(boolean 앞자리로) */
function getBirthYear(rrnFront: string, rrnBackFirst: string): number | null {
  if (!rrnFront || rrnFront.length < 6) return null;
  const yy = parseInt(rrnFront.slice(0, 2), 10);
  if (Number.isNaN(yy)) return null;
  const genderDigit = rrnBackFirst ? parseInt(rrnBackFirst.charAt(0), 10) : 3;
  // 1·2: 1900년대, 3·4: 2000년대, 9·0: 1800년대
  if (genderDigit === 1 || genderDigit === 2 || genderDigit === 5 || genderDigit === 6) {
    return 1900 + yy;
  }
  if (genderDigit === 3 || genderDigit === 4 || genderDigit === 7 || genderDigit === 8) {
    return 2000 + yy;
  }
  return yy >= 50 ? 1900 + yy : 2000 + yy;
}

/** 공고 기준일 + 생년월일 → 만나이 */
function ageOn(birthDate: Date, refDate: Date): number {
  let age = refDate.getFullYear() - birthDate.getFullYear();
  const m = refDate.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < birthDate.getDate())) age--;
  return age;
}

/**
 * 교차검증 실행 — 공고의 당첨자·예비입주자 전원을 대상으로
 */
export function detectCrossIssues(
  customers: LocalCustomer[],
  announcement: LocalAnnouncement | null | undefined,
): CrossCheckIssue[] {
  const issues: CrossCheckIssue[] = [];
  const active = customers.filter((c) => !c.superseded);

  // ─── 1. 동일 주소 중복 당첨 ───
  const byAddr = new Map<string, LocalCustomer[]>();
  for (const c of active) {
    const key = normalizeAddress(c.address);
    if (!key) continue;
    if (!byAddr.has(key)) byAddr.set(key, []);
    byAddr.get(key)!.push(c);
  }
  for (const [, group] of Array.from(byAddr.entries())) {
    if (group.length < 2) continue;
    const first = group[0];
    const others = group.slice(1);
    issues.push({
      severity: "warning",
      category: "duplicate-household",
      customerId: first.id,
      relatedIds: others.map((c) => c.id),
      message: `같은 주소에 당첨자 ${group.length}명 — ${group.map((c) => c.name).join(", ")}`,
      recommendation: "부부 중복 당첨·세대 분리 여부 확인. 둘 다 당첨이면 선접수자 1건만 유효.",
    });
  }

  // ─── 2. 동일 계좌번호 공유 (차명 의심) ───
  const byAccount = new Map<string, LocalCustomer[]>();
  for (const c of active) {
    const acc = digitsOf(c.winner_info?.account);
    if (!acc || acc.length < 8) continue;
    if (!byAccount.has(acc)) byAccount.set(acc, []);
    byAccount.get(acc)!.push(c);
  }
  for (const [acc, group] of Array.from(byAccount.entries())) {
    if (group.length < 2) continue;
    issues.push({
      severity: "error",
      category: "duplicate-account",
      customerId: group[0].id,
      relatedIds: group.slice(1).map((c) => c.id),
      message: `동일 계좌번호(${acc.slice(0, 4)}***) 공유 — ${group.map((c) => c.name).join(", ")}`,
      recommendation: "차명 통장 의심. 각자 본인 명의 통장인지 원본 대조 필요.",
    });
  }

  // ─── 3. 세대원 교차 — 다른 당첨자의 주민번호가 이 당첨자 세대원에 포함 ───
  const rrnToId = new Map<string, number>();
  for (const c of active) {
    const rrn = (c.rrn_front || "") + (c.rrn_back || "");
    if (rrn.length === 13) rrnToId.set(rrn, c.id);
  }
  for (const c of active) {
    for (const m of c.household_members || []) {
      const rrn = digitsOf(m.rrn);
      if (rrn.length !== 13) continue;
      const otherId = rrnToId.get(rrn);
      if (otherId && otherId !== c.id) {
        const other = active.find((x) => x.id === otherId);
        if (!other) continue;
        issues.push({
          severity: "warning",
          category: "household-overlap",
          customerId: c.id,
          relatedIds: [otherId],
          message: `${c.name}의 세대원 ${m.name}(${rrn.slice(0, 6)}-***)이 다른 당첨자 ${other.name}와 동일 주민번호`,
          recommendation: "같은 세대인지 재확인. 중복 당첨이면 선접수자 1건만 유효.",
        });
      }
    }
  }

  // ─── 4. 공고 요건 교차 — supply_types_detail 조건 대조 ───
  const baseDateStr: string =
    (announcement?.eligibility_rules?.announcement_base_date as string)
    || (announcement?.eligibility_rules?.announcement_date as string)
    || "";
  const baseDate = baseDateStr ? new Date(baseDateStr) : null;
  const supplyTypes = (announcement?.eligibility_rules?.supply_types_detail as any[]) || [];

  for (const c of active) {
    const st = supplyTypes.find((s: any) =>
      s.canonicalType === c.supply_type || s.type === c.supply_type
    );
    if (!st) continue;

    // 나이 경계 — 신청자 본인
    if (baseDate && c.rrn_front && c.rrn_back) {
      const yy = parseInt(c.rrn_front.slice(0, 2), 10);
      const mm = parseInt(c.rrn_front.slice(2, 4), 10);
      const dd = parseInt(c.rrn_front.slice(4, 6), 10);
      const year = getBirthYear(c.rrn_front, c.rrn_back);
      if (year && !Number.isNaN(mm) && !Number.isNaN(dd)) {
        const birth = new Date(year, mm - 1, dd);
        const age = ageOn(birth, baseDate);

        // 최소 나이
        const minAge = announcement?.eligibility_rules?.min_age as number | undefined;
        if (typeof minAge === "number" && age < minAge) {
          issues.push({
            severity: "error",
            category: "age-boundary",
            customerId: c.id,
            message: `${c.name} 만 ${age}세 — 최소 ${minAge}세 미달`,
            recommendation: "세대주 미성년자 허용 여부·특례 확인.",
          });
        }
        // 노부모부양 본인 나이 (일반적 제약은 없으나 정보)
        if (c.supply_type === "노부모부양" && age < 30) {
          issues.push({
            severity: "info",
            category: "age-boundary",
            customerId: c.id,
            message: `${c.name}(만 ${age}세) 노부모부양 특공 — 대상자 조건 재확인`,
          });
        }
      }
    }

    // 공고 유형의 minChildren vs 실제 자녀수 (세대원에서 미성년 추정)
    if (typeof st.minChildren === "number" && st.minChildren > 0) {
      const members = c.household_members || [];
      // 세대원 중 20세 미만 추정 (기준일 기준)
      let childCount = 0;
      if (baseDate) {
        for (const m of members) {
          const rrn = digitsOf(m.rrn);
          if (rrn.length < 13) continue;
          const year = getBirthYear(rrn.slice(0, 6), rrn.slice(6, 7));
          const mm = parseInt(rrn.slice(2, 4), 10);
          const dd = parseInt(rrn.slice(4, 6), 10);
          if (year && !Number.isNaN(mm) && !Number.isNaN(dd)) {
            const birth = new Date(year, mm - 1, dd);
            if (ageOn(birth, baseDate) < 20) childCount++;
          }
        }
      }
      if (childCount < st.minChildren) {
        issues.push({
          severity: "warning",
          category: "supply-requirement",
          customerId: c.id,
          message: `${c.name} (${c.supply_type}) — 요구 자녀 ${st.minChildren}명 이상, 세대원 중 20세 미만 ${childCount}명만 확인됨`,
          recommendation: "태아·임신 확인서, 자녀 주민등록등본 대조 필요.",
        });
      }
    }
  }

  // ─── 5. 특공 평생 1회 제한 + 재당첨 제한 감지 (past_winnings 기반) ───
  const SPECIAL_CANONICAL = new Set([
    "신혼부부", "생애최초", "다자녀가구", "노부모부양", "기관추천", "신생아", "이전기관",
  ]);
  for (const c of active) {
    const pasts = c.past_winnings || [];
    if (pasts.length === 0) continue;

    // (a) 특공 평생 1회 — 현재 특공 신청인데 과거에도 특공 당첨 이력이 있으면
    if (c.supply_type && SPECIAL_CANONICAL.has(c.supply_type)) {
      const pastSpecials = pasts.filter((p) =>
        p.canonicalType && SPECIAL_CANONICAL.has(p.canonicalType),
      );
      if (pastSpecials.length > 0) {
        const past = pastSpecials[0];
        issues.push({
          severity: "error",
          category: "supply-requirement",
          customerId: c.id,
          message: `${c.name} (${c.supply_type}) — 과거 특공 당첨 이력 존재: ${past.announcementTitle} (${past.winDate}, ${past.canonicalType})`,
          recommendation: "특별공급은 1세대 평생 1회 제한. 당첨 취소 대상 가능성 높음.",
        });
      }
    }

    // (b) 재당첨 제한 기간 내 신청
    if (baseDate) {
      for (const p of pasts) {
        if (!p.restrictionEndDate) continue;
        const endDate = new Date(p.restrictionEndDate);
        if (Number.isNaN(endDate.getTime())) continue;
        if (endDate > baseDate) {
          issues.push({
            severity: "error",
            category: "supply-requirement",
            customerId: c.id,
            message: `${c.name} — 재당첨 제한 기간(${p.restrictionEndDate}까지) 중 당첨. 과거 당첨: ${p.announcementTitle} (${p.winDate})`,
            recommendation: "재당첨 제한 규정 위반 — 당첨 취소 검토 필요.",
          });
        }
      }
    }
  }

  // ─── 6. 시간 경계 — 부부 중복 당첨 시 선접수 판별 ───
  // (주소 기반 그룹에 대해 winner_info.application_date 비교)
  for (const [, group] of Array.from(byAddr.entries())) {
    if (group.length < 2) continue;
    const withDate = group
      .map((c) => ({ c, dt: c.winner_info?.application_date || "" }))
      .filter((x) => x.dt);
    if (withDate.length < 2) continue;
    withDate.sort((a, b) => a.dt.localeCompare(b.dt));
    const first = withDate[0].c;
    const later = withDate.slice(1);
    for (const { c: cL, dt } of later) {
      issues.push({
        severity: "warning",
        category: "timing",
        customerId: cL.id,
        relatedIds: [first.id],
        message: `${cL.name} 접수일(${dt}) > ${first.name} 접수일(${withDate[0].dt}) — 선접수자 ${first.name}만 유효, ${cL.name} 실격 검토`,
        recommendation: "2024.03 개정 규칙: 부부 중복 당첨 시 선접수 1건만 유효. 후접수자는 부적격·청약제한기간 발생.",
      });
    }
  }

  return issues;
}

/** 카테고리별 요약 카운트 */
export function crossCheckSummary(issues: CrossCheckIssue[]) {
  return {
    error: issues.filter((i) => i.severity === "error").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
    total: issues.length,
  };
}
