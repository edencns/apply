/**
 * 매물 동일성 판정 (winner-ingest용)
 *
 * 같은 매물이 다른 포맷으로 들어와서 customer.properties[]에 두 번 쌓이는 문제 해결.
 * 예: "...12-0번지 0204 00306" vs "...12-0번지 204동 306" → 같은 매물
 *     "...772-0번지 808호"     vs "...772-0번지 0000 00808" → 같은 매물
 *     "...국민주택 67-0번지 0001 00103" vs "...67-0번지 103호" → 같은 매물
 *
 * 정규화 단계:
 *   1) 「N번지」 앞뒤로 분리 — 앞은 행정구역+지번(주소 본문), 뒤는 동·호 토큰
 *   2) 주소 본문: 단지명·도로명 잡음 제거, "-0번지"→"번지", 공백 정규화
 *   3) 뒤 토큰: 모든 숫자 추출 → 마지막 = 호, 그 앞 = 동 (없으면 0)
 *
 * 동일성 규칙:
 *   - front(정규화 주소) 일치 + ho 일치 + (dong 일치 OR 한쪽이 0)
 *   - ho가 둘 다 0이면 단독주택/지번주소 — front만 같으면 동일
 */

import type { PropertyOwnershipRecord } from "./winner-ingest";

export interface PropertyKey {
  front: string;
  dong: number;
  ho: number;
}

/** 주소 본문 정규화 — 단지명·도로명 제거, 행정구역 중복 제거, "-0번지"→"번지" */
function normalizeFront(s: string): string {
  return s
    // 단지명·도로명 제거: 「리/동/읍/면 + 한글토큰들 + 숫자번지」 → 「리/동/읍/면 + 숫자번지」
    .replace(
      /((?:리|동|읍|면))\s+[가-힣0-9]+(?:[가-힣0-9\s]*?[가-힣]+)\s+(\d+(?:-\d+)?\s*번지)/g,
      "$1 $2",
    )
    // -0번지 → 번지 (부번 0 표기 일관화)
    .replace(/-0번지/g, "번지")
    // 행정구역 중복 prefix 제거
    .replace(
      /(강원|경기|충북|충남|전북|전남|경북|경남|제주|충청|전라|경상)도\s+\1(?=\S)/g,
      "$1도 ",
    )
    .replace(/(강원|전북|제주)특별자치도\s+\1(?=\S)/g, "$1특별자치도 ")
    // 다중 공백 → 단일 공백
    .replace(/\s+/g, " ")
    .trim();
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

export function isSamePropertyKey(a: PropertyKey, b: PropertyKey): boolean {
  if (a.front !== b.front) return false;
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
 * 같은 매물(getPropertyKey 비교)이 있으면 mergeProperty로 합침.
 */
export function addOrMergeProperty(
  arr: PropertyOwnershipRecord[],
  p: PropertyOwnershipRecord,
): void {
  const k = getPropertyKey(p);
  const idx = arr.findIndex((existing) => isSamePropertyKey(getPropertyKey(existing), k));
  if (idx >= 0) {
    arr[idx] = mergeProperty(arr[idx], p);
  } else {
    arr.push(p);
  }
}
