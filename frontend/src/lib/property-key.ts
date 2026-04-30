/**
 * 매물 동일성 판정 + 다가구주택 합산
 *
 * 같은 매물이 다른 포맷으로 들어와서 customer.properties[]에 두 번 쌓이는 문제 해결.
 *
 * 처리 케이스:
 *   1) 동·호 표기 차이 — "0204 00306" vs "204동 306호" → 같은 매물
 *   2) 단지명·도로명 차이 — "주공아파트(1)" vs "(1)주공아파트" / 신축명 vs 구명 → 같은 매물
 *   3) 단독주택 + 호 코드 — "...번지 0001 00101" vs "...번지" → 같은 매물 (usage 기반)
 *   4) 다가구주택 — 한 동의 N개 호 record를 1개로 병합, 창고는 제외 (consolidateDagagu)
 *
 * 정규화 단계:
 *   - 「N번지」 앞뒤로 분리 (앞=주소 본문, 뒤=동·호 토큰)
 *   - 본문: 「리/동/읍/면 + 비숫자 문자들 + 숫자번지」 → 「리/동/읍/면 + 숫자번지」
 *           (괄호·영문·하이픈 모두 stripping)
 *   - 꼬리: 숫자 추출 → 마지막=호, 그 앞=동
 *
 * 동일성 규칙:
 *   - front 일치 + (단독주택이면 즉시 동일 OR ho 일치+dong 호환)
 *   - 둘 다 ho=0이면 단독주택/지번 — front만 같으면 동일
 */

import type { PropertyOwnershipRecord } from "./winner-ingest";

export interface PropertyKey {
  front: string;
  dong: number;
  ho: number;
}

/**
 * 마지막 행정구역(리/동/읍/면) 다음부터 「N번지」 직전까지의 단지명·도로명을 모두 제거.
 *
 * 한국 주소 구조: ...시/군/구  ...읍/면(있으면)  ...동/리  [단지명·도로명]  N번지
 * 단지명에 또 「동/리」 글자가 포함될 수 있어 (예: "강릉시 교동 강릉 교동(1) 주공아파트")
 * 단순 정규식으로는 부정확. 「한글 뒤에 동/리/읍/면 + 공백」으로 행정구역 단어 경계를
 * 잡고, 그 중 마지막 위치를 기준으로 단지명을 잘라냄.
 */
function stripApartmentName(s: string): string {
  const bunjiMatch = s.match(/\d+(?:-\d+)?\s*번지/);
  if (!bunjiMatch || bunjiMatch.index === undefined) return s;
  const bunjiStart = bunjiMatch.index;
  const before = s.slice(0, bunjiStart);

  // 「한글 + 리|동|읍|면」 뒤에 공백이 오는 패턴 — 행정구역 단어 경계
  // 단지명 내의 "교동(" 처럼 공백이 안 따라오는 경우는 제외됨
  const adminPattern = /[가-힣](?:리|동|읍|면)(?=\s)/g;
  const matches: { index: number; len: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = adminPattern.exec(before)) !== null) {
    matches.push({ index: m.index, len: m[0].length });
  }
  if (matches.length === 0) return s;

  const last = matches[matches.length - 1];
  const adminEnd = last.index + last.len;
  return s.slice(0, adminEnd) + " " + s.slice(bunjiStart);
}

/** 주소 본문 정규화 — 단지명·도로명·"-0번지"·행정구역 중복 prefix 처리 */
function normalizeFront(s: string): string {
  let out = stripApartmentName(s);
  out = out
    // -0번지 → 번지 (부번 0 표기 일관화)
    .replace(/-0번지/g, "번지")
    // 행정구역 중복 prefix 제거 (예: "강원도 강원속초시" → "강원도 속초시")
    .replace(
      /(강원|경기|충북|충남|전북|전남|경북|경남|제주|충청|전라|경상)도\s+\1(?=\S)/g,
      "$1도 ",
    )
    .replace(/(강원|전북|제주)특별자치도\s+\1(?=\S)/g, "$1특별자치도 ")
    // 다중 공백 → 단일 공백
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

export function getPropertyKey(p: PropertyOwnershipRecord): PropertyKey {
  const addr = (p.address || "").trim();

  // 「N번지」 위치로 본문/꼬리 분리
  const m = addr.match(/^(.*?\d+(?:-\d+)?\s*번지)(.*)$/);
  if (!m) {
    return { front: normalizeFront(addr), dong: 0, ho: 0 };
  }

  const beforeWithBunji = m[1];
  const afterBunji = (m[2] || "").trim();

  // 꼬리에서 숫자 모두 추출 — 마지막=호, 그 앞=동
  const nums = (afterBunji.match(/\d+/g) || []).map(Number);
  let dong = 0;
  let ho = 0;
  if (nums.length >= 2) {
    dong = nums[0];
    ho = nums[nums.length - 1];
  } else if (nums.length === 1) {
    ho = nums[0];
  }

  return {
    front: normalizeFront(beforeWithBunji),
    dong,
    ho,
  };
}

/** 단독주택 시그널 — usage가 단독주택이면 동·호 분할 개념 없음 */
function isSingleFamily(usage: string | undefined): boolean {
  return !!usage && /단독주택/.test(usage);
}

export function isSamePropertyKey(
  a: PropertyKey,
  ua: string | undefined,
  b: PropertyKey,
  ub: string | undefined,
): boolean {
  if (a.front !== b.front) return false;
  // 단독주택: 동·호 무시, 같은 지번이면 동일
  if (isSingleFamily(ua) || isSingleFamily(ub)) return true;
  // 둘 다 호 0 — 단독주택/지번 주소. front만 같으면 동일.
  if (a.ho === 0 && b.ho === 0) return true;
  // 한쪽만 호 0이면 정보 부족 — 동일로 보지 않음 (보수적)
  if (a.ho !== b.ho) return false;
  // ho 일치 — dong은 같거나 한쪽이 0(미상)이면 호환
  return a.dong === b.dong || a.dong === 0 || b.dong === 0;
}

/**
 * 두 record 병합 — 빈 필드를 incoming에서 채움.
 * 주소는 더 길고 정보가 많은 쪽 (단지명 포함된 표기) 유지.
 */
export function mergeProperty(
  existing: PropertyOwnershipRecord,
  incoming: PropertyOwnershipRecord,
): PropertyOwnershipRecord {
  const longerAddr =
    (existing.address || "").length >= (incoming.address || "").length
      ? existing.address
      : incoming.address;
  return {
    ...existing,
    address: longerAddr,
    areaM2: existing.areaM2 ?? incoming.areaM2,
    usage: existing.usage || incoming.usage,
    acquiredDate: existing.acquiredDate || incoming.acquiredDate,
    transferredDate: existing.transferredDate || incoming.transferredDate,
    saleReportDate: existing.saleReportDate || incoming.saleReportDate,
    contractDate: existing.contractDate || incoming.contractDate,
    paymentDate: existing.paymentDate || incoming.paymentDate,
    changeReason: existing.changeReason || incoming.changeReason,
    changeDate: existing.changeDate || incoming.changeDate,
    rightsType: existing.rightsType || incoming.rightsType,
    buySell: existing.buySell || incoming.buySell,
    zipCode: existing.zipCode || incoming.zipCode,
    identifier: existing.identifier || incoming.identifier,
    officialPrice: existing.officialPrice ?? incoming.officialPrice,
    officialPriceYear: existing.officialPriceYear ?? incoming.officialPriceYear,
    officialPriceSource: existing.officialPriceSource || incoming.officialPriceSource,
    regionType:
      existing.regionType && existing.regionType !== "unknown"
        ? existing.regionType
        : incoming.regionType,
  };
}

/**
 * properties 배열에 record 추가 또는 기존 항목과 병합.
 * 같은 매물(getPropertyKey + usage 비교)이 있으면 mergeProperty로 합침.
 */
export function addOrMergeProperty(
  arr: PropertyOwnershipRecord[],
  p: PropertyOwnershipRecord,
): void {
  const k = getPropertyKey(p);
  const idx = arr.findIndex((existing) =>
    isSamePropertyKey(getPropertyKey(existing), existing.usage, k, p.usage),
  );
  if (idx >= 0) {
    arr[idx] = mergeProperty(arr[idx], p);
  } else {
    arr.push(p);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 다가구주택 합산
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 거주용 다가구주택 — usage가 "다가구주택"이고 창고/부속 같은 비거주 키워드가 없음.
 * 예: "다가구주택" ✓, "다가구주택창고" ✗, "다가구주택부속" ✗
 */
function isDagaguResidence(usage: string | undefined): boolean {
  if (!usage || !/다가구주택/.test(usage)) return false;
  if (/창고|부속|기타|주차/.test(usage)) return false;
  return true;
}

/** 비거주 다가구 (창고·부속 등) — 무주택 판정에서 제외 */
function isDagaguNonResidence(usage: string | undefined): boolean {
  if (!usage || !/다가구주택/.test(usage)) return false;
  return /창고|부속|기타|주차/.test(usage);
}

/**
 * 다가구주택 호별 record를 1개로 병합 + 비거주(창고 등) 제거.
 *
 * 다가구주택은 법적으로 1동 1소유주 단독주택이므로:
 *   - 같은 ownerRrn + 같은 지번(front)인 거주용 record 그룹 → 1 record로 병합
 *   - 면적 = 합계 (호별 면적 합산)
 *   - 공시가격 = 합계 (호별 공시가격 합산, 누락된 호 있으면 미정으로 표기)
 *   - 창고·부속은 결과 배열에서 제거 (무주택 판정에 영향 X)
 *   - 다가구가 아닌 record는 그대로 유지
 *
 * 호출 시점: winner-ingest의 profile 구성 직후 (모든 record가 모인 뒤)
 */
export function consolidateDagagu(
  properties: PropertyOwnershipRecord[],
): PropertyOwnershipRecord[] {
  const result: PropertyOwnershipRecord[] = [];
  const dagaguGroups = new Map<string, PropertyOwnershipRecord[]>();

  for (const p of properties) {
    if (isDagaguNonResidence(p.usage)) {
      // 창고·부속 — 무주택 판정에서 제외
      continue;
    }
    if (isDagaguResidence(p.usage)) {
      // 거주용 다가구 — 같은 지번 그룹으로 모음
      const key = `${p.ownerRrn}|${getPropertyKey(p).front}`;
      const arr = dagaguGroups.get(key) || [];
      arr.push(p);
      dagaguGroups.set(key, arr);
    } else {
      // 다가구가 아닌 일반 매물 — 그대로 유지
      result.push(p);
    }
  }

  // 각 다가구 그룹을 1 record로 병합
  const groups = Array.from(dagaguGroups.values());
  for (const group of groups) {
    if (group.length === 0) continue;
    if (group.length === 1) {
      // 단일 호만 있으면 그대로
      result.push(group[0]);
      continue;
    }

    // 합산 record 생성 — 첫 record를 base로, 면적·가격 합계로 덮어쓰기
    const base = group.reduce(
      (longest: PropertyOwnershipRecord, p: PropertyOwnershipRecord) =>
        (p.address || "").length > (longest.address || "").length ? p : longest,
    );

    const totalArea = group.reduce(
      (sum: number, p: PropertyOwnershipRecord) => sum + (p.areaM2 ?? 0),
      0,
    );
    const priceParts: number[] = group
      .map((p: PropertyOwnershipRecord) => p.officialPrice)
      .filter((v: number | undefined): v is number => typeof v === "number");
    const allPricesPresent = priceParts.length === group.length;
    const totalPrice = allPricesPresent
      ? priceParts.reduce((s: number, v: number) => s + v, 0)
      : undefined;

    // 주소에서 호 표기 제거 — "...번지 0001 00203" → "...번지"
    const addr = (base.address || "")
      .replace(/\s*\d+(?:동\s*)?\s*\d+\s*호?\s*$/, "")
      .trim();

    const yearFromGroup = group.find(
      (p: PropertyOwnershipRecord) => p.officialPriceYear != null,
    )?.officialPriceYear;

    result.push({
      ...base,
      address: addr,
      areaM2: totalArea > 0 ? totalArea : undefined,
      usage: "다가구주택",
      officialPrice: totalPrice,
      officialPriceYear: base.officialPriceYear ?? yearFromGroup,
      officialPriceSource: allPricesPresent
        ? base.officialPriceSource || "api"
        : undefined,
    });
  }

  return result;
}
