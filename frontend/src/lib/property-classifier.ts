// 주택소유 레코드를 「판정기준」에 따라 분류·정규화하고 주택 수를 산정하는 모듈

/**
 * 주택 분류·주택수 산정 — 사용자 「주택소유정보_주소유형_검토.xlsx / 판정기준」 시트 기준.
 *
 * 핵심 룰:
 *   1. 주소 정규화 — 시도명 중복("강원도 강원강릉시")·약칭·공백·-0번지·동/호 선행 0 정리.
 *   2. 공동주택(아파트·연립·다세대) — 「지번 + 동 + 호」 단위. 같은 지번·동·호 = 1물건.
 *      "103동 1006호"와 "0103 01006"은 동일. 동/호 빠지면 수동확인.
 *   3. 단독계열(단독주택·다가구주택·전업농어가주택) — 「지번/건물」 단위. 호실 표기로 자동 분리 금지.
 *      같은 지번 = 1물건. 다른 지번이면 별도 주택.
 *   4. 다세대=공동주택 / 다가구=단독계열 (원본 「용도 등」 값 우선).
 *   5. 비주택·부속(사무용 오피스텔·지하대피소·창고) — 자동 제외 금지, 수동확인 플래그.
 *   6. 「(전용면적 부분)」 중복 표기는 같은 물건으로 dedup.
 *
 * ※ 1차 검토용. 최종 판정은 건축물대장·등기·소명·공고문 함께 확인.
 */

export type HousingCategory = "공동주택" | "단독계열" | "비주택후보" | "부속기타" | "미분류";

export interface ClassifiedProperty {
  /** 원본 주소 (보존) */
  rawAddress: string;
  /** 정규화 주소 */
  normalizedAddress: string;
  /** 지번키 (지번까지) */
  jibunKey: string;
  /** 동 (공동주택) */
  dong?: string;
  /** 호 (공동주택) */
  ho?: string;
  /** 물건 식별키 — 공동주택은 지번+동+호, 단독계열은 지번 */
  propertyKey: string;
  category: HousingCategory;
  /** 원본 용도 등 */
  usage: string;
  /** 수동 확인 필요 사유 (있으면) */
  manualReview?: string;
}

/* ─── 주소 정규화 ─────────────────────────────────── */

/** 시도명 중복·약칭·공백·-0번지·동호 선행 0 정리 → 정규화 문자열 */
export function normalizeAddress(raw: string): string {
  let s = (raw || "").trim();
  // 행정구역 중복 prefix: "강원도 강원강릉시" → "강원도 강릉시"
  s = s.replace(/(강원|경기|충북|충남|전북|전남|경북|경남|제주|충청|전라|경상)도\s+\1(?=\S)/g, "$1도 ");
  // "-0번지" → "번지"
  s = s.replace(/-0번지/g, "번지");
  // 동·호 선행 0 제거: "0103" → "103", "01006" → "1006" (동/호 토큰)
  s = s.replace(/(\d{1,4})\s*동\s*0*(\d{1,5})\s*호?/g, (_m, d, h) => `${Number(d)}동${Number(h)}호`);
  // 공백 제거 (키 생성용)
  s = s.replace(/\s+/g, "");
  return s;
}

/** 지번키 추출 — 정규화 주소에서 "...번지"까지 */
export function extractJibunKey(normalized: string): string {
  const m = normalized.match(/^(.*?\d+(?:-\d+)?번지)/);
  if (m) return m[1];
  // "번지" 없으면 동·호 토큰 직전까지
  const m2 = normalized.match(/^(.*?)(?:\d{1,4}동|\d{1,5}호)/);
  if (m2 && m2[1]) return m2[1];
  return normalized;
}

/** 동·호 추출 — 다양한 표기 */
export function extractDongHo(rawOrNorm: string): { dong?: string; ho?: string } {
  const s = rawOrNorm || "";
  // "103동 1006호" / "103동1006호"
  let m = s.match(/(\d{1,4})\s*동\s*0*(\d{1,5})\s*호/);
  if (m) return { dong: String(Number(m[1])), ho: String(Number(m[2])) };
  // "103동 403" (호 키워드 없음)
  m = s.match(/(\d{1,4})\s*동\s*0*(\d{1,5})\s*$/);
  if (m) return { dong: String(Number(m[1])), ho: String(Number(m[2])) };
  // "0103 01006" (동·호 키워드 없이 코드+호)
  m = s.match(/번지\s*0*(\d{2,4})\s+0*(\d{2,5})\s*$/);
  if (m) return { dong: String(Number(m[1])), ho: String(Number(m[2])) };
  // 호만: "514호"
  m = s.match(/0*(\d{2,5})\s*호\s*$/);
  if (m) return { ho: String(Number(m[1])) };
  return {};
}

/* ─── 용도 → 카테고리 ─────────────────────────────── */

/** 원본 「용도 등」 값으로 주택 카테고리 판정 */
export function classifyUsage(usage: string): { category: HousingCategory; manualReview?: string } {
  const u = (usage || "").trim();

  // 비주택·부속 (자동 제외 금지 — 수동확인)
  if (/사무용\s*오피스텔/.test(u)) {
    return { category: "비주택후보", manualReview: "공부상 사무용이면 주택 제외 후보 — 주거용 여부 용도 확인 필요" };
  }
  if (/지하대피소|창고/.test(u)) {
    return { category: "부속기타", manualReview: "부속·기타(지하대피소·창고 등) — 독립 주택 여부 수동확인" };
  }
  // 오피스텔 일반 (사무용 외) — 주거용일 수 있으나 공부 확인
  if (/오피스텔/.test(u)) {
    return { category: "비주택후보", manualReview: "오피스텔 — 주거용/업무용 공부상 용도 확인 필요" };
  }

  // 공동주택 (호 단위 별도 주택)
  if (/아파트|연립주택|다세대주택|공동주택/.test(u)) {
    return { category: "공동주택" };
  }

  // 단독계열 (지번 단위 1주택, 다가구 포함)
  if (/단독주택|다가구주택|전업농어가주택|농어가주택/.test(u)) {
    return { category: "단독계열" };
  }

  return { category: "미분류", manualReview: `용도 「${u}」 수동확인 필요` };
}

/* ─── 단일 레코드 분류 ─────────────────────────────── */

export function classifyProperty(rawAddress: string, usage: string): ClassifiedProperty {
  const normalizedAddress = normalizeAddress(rawAddress);
  const jibunKey = extractJibunKey(normalizedAddress);
  const { dong, ho } = extractDongHo(rawAddress);
  const { category, manualReview } = classifyUsage(usage);

  let propertyKey: string;
  let mr = manualReview;
  if (category === "공동주택") {
    // 공동주택은 지번+동+호. 동/호 없으면 수동확인.
    if (dong || ho) {
      propertyKey = `${jibunKey}|D${dong || "?"}|H${ho || "?"}`;
    } else {
      propertyKey = jibunKey; // 동호 미완성
      mr = mr || "공동주택 동·호 미완성 — 같은 물건 판정에 동·호 필요 (수동확인)";
    }
  } else {
    // 단독계열·비주택·부속·미분류는 지번 단위
    propertyKey = jibunKey;
  }

  return { rawAddress, normalizedAddress, jibunKey, dong, ho, propertyKey, category, usage, manualReview: mr };
}

/* ─── 주택 수 산정 ─────────────────────────────────── */

export interface HouseCountResult {
  /** 산정된 주택 수 (공동주택은 지번+동+호 unique, 단독계열은 지번 unique) */
  count: number;
  /** 카테고리별 물건키 그룹 */
  groups: {
    공동주택: Set<string>;
    단독계열: Set<string>;
  };
  /** 수동확인 필요 항목 */
  manualReviewItems: Array<{ address: string; usage: string; reason: string }>;
  /** 분류된 전체 레코드 */
  classified: ClassifiedProperty[];
}

/**
 * 주택 레코드 배열 → 주택 수 산정.
 *
 * - 공동주택: unique (지번+동+호) 개수
 * - 단독계열: unique 지번 개수 (다가구 포함, 호실 분리 안 함)
 * - 비주택후보·부속기타·미분류: 카운트 제외하고 수동확인 플래그
 *
 * @param props { address, usage } 배열 (이미 「현재 보유 + 주거용」 필터된 것 권장)
 */
export function countHouses(
  props: Array<{ address: string; usage?: string }>,
): HouseCountResult {
  const classified = props.map((p) => classifyProperty(p.address, p.usage || ""));

  const 공동주택 = new Set<string>();
  const 단독계열 = new Set<string>();
  const manualReviewItems: Array<{ address: string; usage: string; reason: string }> = [];

  for (const c of classified) {
    if (c.category === "공동주택") {
      공동주택.add(c.propertyKey);
    } else if (c.category === "단독계열") {
      단독계열.add(c.propertyKey);
    } else {
      // 비주택후보·부속기타·미분류 = 카운트 제외 + 수동확인
      manualReviewItems.push({
        address: c.rawAddress,
        usage: c.usage,
        reason: c.manualReview || "수동확인 필요",
      });
      continue;
    }
    // 공동주택 동호 미완성 등도 수동확인 목록에 추가 (카운트는 유지)
    if (c.manualReview) {
      manualReviewItems.push({ address: c.rawAddress, usage: c.usage, reason: c.manualReview });
    }
  }

  return {
    count: 공동주택.size + 단독계열.size,
    groups: { 공동주택, 단독계열 },
    manualReviewItems,
    classified,
  };
}
