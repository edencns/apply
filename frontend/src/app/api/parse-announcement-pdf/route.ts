import { NextRequest, NextResponse } from 'next/server';
import { llmText, extractJson, hasLlmKey } from '@/lib/llm';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });

    const fileBytes = await file.arrayBuffer();

    // 1차: 백엔드 프록시 (있으면)
    try {
      const backendForm = new FormData();
      backendForm.append('file', new Blob([fileBytes], { type: 'application/pdf' }), file.name);
      const backendResp = await fetch(`${BACKEND_URL}/announcements/parse-pdf`, {
        method: 'POST',
        body: backendForm,
      });
      if (backendResp.ok) {
        const data = await backendResp.json();
        if (data.success) return NextResponse.json(data);
      }
    } catch {
      // 폴백
    }

    if (!hasLlmKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    // PDF 텍스트 추출 — 내부 lib 직접 import
    // @ts-expect-error - 내부 경로는 타입 정의 없음
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default as (b: Buffer) => Promise<{ text: string; numpages: number }>;
    const pdfData = await pdfParse(Buffer.from(fileBytes));
    const fullText = pdfData.text || '';

    if (!fullText.trim()) {
      return NextResponse.json({ error: 'PDF에서 텍스트를 추출할 수 없습니다.' }, { status: 422 });
    }

    // 섹션별 텍스트 추출 — 8b-instant 폴백시 TPM 6000 제한에 맞게 축소
    const basicText = extractRelevantSections(fullText, [
      '단지명', '주택유형', '주택형', '소재지', '공급규모', '공급대상', '전용면적',
      '공급위치', '입주자모집공고일', '입주예정일', '전매', '재당첨', '주택관리번호',
      '약식표기', '타입',
    ], 5000);

    const generalText = extractRelevantSections(fullText, [
      '일반공급', '1순위', '2순위', '청약통장', '예치금', '가입기간', '납입횟수',
      '순위별 청약자격', '가점제',
    ], 4500);

    const specialText = extractRelevantSections(fullText, [
      '특별공급', '특별 공급', '특별공급대상', '특별공급 자격', '기관추천',
      '다자녀가구', '다자녀 가구', '신혼부부', '노부모부양', '노부모 부양',
      '생애최초', '생애 최초', '신생아',
      '도시근로자', '월평균소득', '자산보유기준',
    ], 6000);

    const documentsText = extractRelevantSections(fullText, [
      '제출서류', '구비서류', '자격 확인', '자격검증서류', '당첨자 서류', '서류 제출',
    ], 3500);

    console.log('[parse-announcement-pdf] section sizes:', {
      basic: basicText.length,
      general: generalText.length,
      special: specialText.length,
      documents: documentsText.length,
      totalPages: pdfData.numpages,
    });

    // 공급대상 표(또는 특별공급 섹션)에 실제 등장하는 유형만 허용
    // 단, 감지 결과가 불안정(0~1개)하면 화이트리스트를 적용하지 않고 LLM에 위임
    const detected = detectPresentSpecialTypes(fullText);
    const allowedSpecialTypes = detected.length >= 2 ? detected : undefined;
    console.log('[parse-announcement-pdf] detected:', detected, 'applied whitelist:', allowedSpecialTypes || '(none)');

    // 4개 병렬 호출 (토큰 분산)
    const [basicResult, generalResult, specialResult, documentsResult] = await Promise.all([
      parseBasicInfo(basicText),
      parseGeneralSupply(generalText),
      parseSpecialSupply(specialText, allowedSpecialTypes),
      parseDocuments(documentsText),
    ]);

    console.log('[parse-announcement-pdf] parse results:', {
      basic: basicResult ? 'ok' : 'null',
      general: generalResult?.conditions?.length || 0,
      special: Array.isArray(specialResult) ? specialResult.length : (specialResult ? 'object' : 'null'),
      documents: documentsResult ? 'ok' : 'null',
    });
    if (Array.isArray(specialResult)) {
      console.log('[parse-announcement-pdf] special types:',
        specialResult.map((s: any) => ({
          type: s.type,
          name: s.name,
          keys: Object.keys(s),
          condLen: s.conditions?.length || 0,
          firstCond: s.conditions?.[0] ? Object.keys(s.conditions[0]) : null,
        }))
      );
    }

    const supplyTypes: any[] = [];
    if (generalResult?.conditions?.length) {
      supplyTypes.push({
        ...generalResult,
        type: generalResult.type || '일반공급',
      });
    }
    if (Array.isArray(specialResult)) {
      for (const item of specialResult) {
        if (!item || typeof item !== 'object') continue;
        // type 필드 정규화 — 영어/한글 키 모두 지원
        const type: string = (
          item.type || item.name || item.category || item.supplyType ||
          item['공급유형'] || item['유형'] || item['이름'] || item['구분'] || ''
        );
        // "없음"/"해당없음" 유형은 스킵
        if (!type || /^(없음|해당없음|N\/A)$/i.test(type.trim())) continue;

        // description / bullets 한글 키 fallback
        const descFromKo = item['설명'] || item['요건'] || item['자격'] || item['자격요건'];
        const bulletsFromKo = item['핵심요건'] || item['핵심_요건'] || item['요건목록'];

        // conditions 정규화
        let conditionsRaw = item.conditions || item.condition || item.criteria || item['조건'] || item['자격조건'];
        let conditions: any[] = [];
        if (Array.isArray(conditionsRaw)) {
          conditions = conditionsRaw.filter(c => c && typeof c === 'object');
        } else if (conditionsRaw && typeof conditionsRaw === 'object') {
          conditions = [conditionsRaw];
        }
        // "조건" 값이 문자열인 경우 description으로 승격
        const conditionString = typeof conditionsRaw === 'string' ? conditionsRaw : null;

        // 문자열 조건 또는 "없음" 취급
        if (conditionString && /^(없음|해당없음|N\/A)$/i.test(conditionString.trim())) continue;

        // conditions가 비었으면 평탄화된 필드 또는 description 기반으로 하나 생성
        if (conditions.length === 0) {
          const desc = descFromKo || item.description || conditionString || '';
          const hasAnyFlat = item.minSubscriptionMonths !== undefined || item.requireHomeless !== undefined || desc;
          if (!hasAnyFlat) continue;
          conditions = [{
            rank: 0,
            label: type,
            minSubscriptionMonths: item.minSubscriptionMonths || 0,
            minDepositCount: item.minDepositCount || 0,
            depositByArea: item.depositByArea || {},
            requireHomeless: !!item.requireHomeless,
            requireHouseholdHead: !!item.requireHouseholdHead,
            minChildren: item.minChildren,
            maxMarriageYears: item.maxMarriageYears,
            incomeLimitPercent: item.incomeLimitPercent,
            description: desc,
            descriptionBullets: Array.isArray(bulletsFromKo) ? bulletsFromKo : (item.descriptionBullets || []),
          }];
        } else {
          // 각 condition의 description/bullets도 한글 키 fallback
          conditions = conditions.map((c: any) => ({
            rank: c.rank ?? 0,
            label: c.label || c['라벨'] || type,
            minSubscriptionMonths: c.minSubscriptionMonths || 0,
            minDepositCount: c.minDepositCount || 0,
            depositByArea: c.depositByArea || c['예치금'] || {},
            requireHomeless: !!(c.requireHomeless ?? c['무주택']),
            requireHouseholdHead: !!(c.requireHouseholdHead ?? c['세대주']),
            minChildren: c.minChildren ?? c['자녀수'],
            maxMarriageYears: c.maxMarriageYears ?? c['혼인기간'],
            incomeLimitPercent: c.incomeLimitPercent || c['소득기준'],
            description: c.description || c['설명'] || c['요건'] || descFromKo || '',
            descriptionBullets: c.descriptionBullets || c['핵심요건'] || bulletsFromKo || [],
          }));
        }

        supplyTypes.push({
          type,
          conditions,
          incomeTable: item.incomeTable || item['소득기준'] || item['소득표'] || {},
          assetLimit: item.assetLimit || item['자산한도'] || 0,
        });
      }
    }

    // exclusiveAreas: LLM + regex 결과를 합집합으로 병합 (한쪽 누락 보강)
    const regexAreas = extractExclusiveAreasFromText(fullText);
    console.log('[parse-announcement-pdf] regex exclusive areas:', regexAreas);

    const llmAreasRaw = (basicResult as any)?.exclusiveAreas;
    const llmAreas: number[] = Array.isArray(llmAreasRaw)
      ? llmAreasRaw
          .map((v: any) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.]/g, ''))))
          .filter((n: number) => Number.isFinite(n) && n > 20 && n < 500)
      : [];
    console.log('[parse-announcement-pdf] llm exclusive areas:', llmAreas);

    // 병합: 소숫점 2자리 반올림 key로 중복 제거, 더 정밀한 값 우선
    const mergedMap = new Map<string, number>();
    const addToMerged = (n: number) => {
      const key = n.toFixed(2);
      const cur = mergedMap.get(key);
      if (cur === undefined || String(n).length > String(cur).length) {
        mergedMap.set(key, n);
      }
    };
    regexAreas.forEach(addToMerged);
    llmAreas.forEach(addToMerged);
    const mergedAreas = Array.from(mergedMap.values()).sort((a, b) => a - b);
    console.log('[parse-announcement-pdf] final exclusiveAreas:', mergedAreas);

    const result = {
      ...(basicResult || {}),
      exclusiveAreas: mergedAreas,
      supplyTypes,
      requiredDocuments: documentsResult || { common: [], perSupplyType: {} },
      totalPages: pdfData.numpages,
    };

    return NextResponse.json({ success: true, data: result });

  } catch (err: any) {
    console.error('parse-announcement-pdf error:', err);
    return NextResponse.json({ error: err.message || 'PDF 파싱 중 오류' }, { status: 500 });
  }
}

/**
 * PDF 본문에서 전용면적 값 추출.
 *
 * 전략:
 *  1) 약식표기 "40A5H", "61C3H" 류를 찾아 각 타입의 정수부(40, 61, ...) 수집
 *     — 이것이 공급대상 표에 실제로 존재하는 주택형의 ground-truth 집합
 *  2) 약식표기 직전/직후의 정밀 소숫점 값(40.5800)을 매칭하여 정밀 값 획득
 *  3) 0-패딩 패턴(040.5800)도 보조로 수집
 *  4) 약식표기 정수부 집합에 속하는 값만 최종 채택 (컬럼 간 noise 필터링)
 */
function extractExclusiveAreasFromText(fullText: string): number[] {
  const log = (...args: any[]) => console.log('[extractExclusiveAreas]', ...args);

  // ── Step 1: 약식표기 수집 ("40A5H", "61C3H", "84B2A" 등)
  //    패턴: 2~3자리 숫자 + 영문자 + 1자리 숫자 + 영문자 (+ 선택적 추가 영문자)
  const shortCodeRegex = /(\d{2,3})([A-Z]\d[A-Z]?)/g;
  const shortCodeInts = new Set<number>();
  const shortCodeMatches: Array<{ int: number; index: number; raw: string }> = [];
  let sm: RegExpExecArray | null;
  while ((sm = shortCodeRegex.exec(fullText)) !== null) {
    const n = parseInt(sm[1], 10);
    if (n >= 20 && n <= 500) {
      shortCodeInts.add(n);
      shortCodeMatches.push({ int: n, index: sm.index, raw: sm[0] });
    }
  }
  log('short-code integer parts:', Array.from(shortCodeInts).sort((a, b) => a - b));
  log('short-code match count:', shortCodeMatches.length);

  // ── Step 2: 모든 소숫점 숫자 수집 (원본 텍스트 인덱스 포함)
  const decimalRegex = /(\d{2,3}\.\d{1,4})/g;
  const decimalMatches: Array<{ val: number; index: number; raw: string }> = [];
  let dm: RegExpExecArray | null;
  while ((dm = decimalRegex.exec(fullText)) !== null) {
    const n = parseFloat(dm[1]);
    if (Number.isFinite(n) && n >= 20 && n <= 500) {
      decimalMatches.push({ val: n, index: dm.index, raw: dm[1] });
    }
  }
  log('decimal match count (20~500):', decimalMatches.length);

  // ── Step 3: 약식표기 앞뒤 60자 내의 소숫점 값을, 그 약식표기의 정수부에 매칭
  //    주택형 표에서 "040.5800   40A5H   40.5800" 처럼 가까이 붙어있음
  const areas = new Map<string, number>();
  const addArea = (n: number) => {
    const key = n.toFixed(2);
    const cur = areas.get(key);
    if (cur === undefined || String(n).length > String(cur).length) {
      areas.set(key, n);
    }
  };

  for (const sc of shortCodeMatches) {
    // 같은 정수부를 가진 소숫점 값 중 약식표기와 가장 가까운 것
    const nearby = decimalMatches
      .filter(d => Math.floor(d.val) === sc.int)
      .map(d => ({ ...d, dist: Math.abs(d.index - sc.index) }))
      .sort((a, b) => a.dist - b.dist);
    if (nearby.length > 0 && nearby[0].dist < 200) {
      // 여러 주택형이 동일 정수부를 가질 수 있음 (예: 66.2800과 66.4900)
      // → 200자 윈도우 내의 모든 매칭 수집
      nearby.filter(n => n.dist < 200).forEach(n => addArea(n.val));
    } else {
      // 정밀값 못 찾으면 정수부만이라도 (임시)
      addArea(sc.int);
    }
  }

  // ── Step 4: 0-패딩 패턴 "040.5800" 보조 수집 (이중 안전망)
  const paddedRegex = /0(\d{2}\.\d{1,4})/g;
  let pm: RegExpExecArray | null;
  while ((pm = paddedRegex.exec(fullText)) !== null) {
    const n = parseFloat(pm[1]);
    if (Number.isFinite(n) && n >= 20 && n <= 500) {
      // 약식표기 정수부가 있으면 그것과 일치할 때만 채택, 없으면 그대로
      if (shortCodeInts.size > 0) {
        if (shortCodeInts.has(Math.floor(n))) addArea(n);
      } else {
        addArea(n);
      }
    }
  }

  // ── Step 5: 아무 것도 못 찾았으면 공급대상 섹션 근처의 모든 소숫점 (최후 수단)
  if (areas.size === 0) {
    log('no matches via structured strategies, falling back to proximity scan');
    const lines = fullText.split('\n');
    const triggers = ['공급대상', '주택형', '전용면적'];
    for (let i = 0; i < lines.length; i++) {
      if (!triggers.some(t => lines[i].includes(t))) continue;
      const end = Math.min(lines.length, i + 30);
      for (let j = i; j < end; j++) {
        decimalRegex.lastIndex = 0;
        let rm: RegExpExecArray | null;
        while ((rm = decimalRegex.exec(lines[j])) !== null) {
          const n = parseFloat(rm[1]);
          if (Number.isFinite(n) && n >= 20 && n <= 200) addArea(n);
        }
      }
    }
  }

  const result = Array.from(areas.values()).sort((a, b) => a - b);
  log('final result:', result);
  return result;
}

/**
 * 공고 전체 텍스트에서 실제로 존재하는 특별공급 유형 감지.
 * — 허용 목록: 유형 이름이 PDF 본문에 2회 이상 등장하면 인정 (표 + 자격 섹션에 나올 것)
 * — 명시적 "유형명 해당없음"이 바로 붙어있으면 제외
 */
function detectPresentSpecialTypes(fullText: string): string[] {
  const candidates: Array<{ type: string; aliases: string[] }> = [
    { type: '다자녀가구', aliases: ['다자녀가구', '다자녀 가구'] },
    { type: '신혼부부', aliases: ['신혼부부'] },
    { type: '생애최초', aliases: ['생애최초'] },
    { type: '노부모부양', aliases: ['노부모부양', '노부모 부양'] },
    { type: '기관추천', aliases: ['기관추천', '기관 추천'] },
    { type: '신생아', aliases: ['신생아'] },
  ];
  const text = fullText.replace(/\s+/g, ' ');
  const present: string[] = [];
  for (const { type, aliases } of candidates) {
    // 등장 횟수 집계 (모든 alias 합산)
    let count = 0;
    for (const a of aliases) {
      const re = new RegExp(a.replace(/\s/g, '\\s*'), 'g');
      count += (text.match(re) || []).length;
    }
    if (count === 0) continue;
    // "유형명 ... 해당없음" (유형명 직후 20자 이내에 해당없음) 명시적 제외 패턴
    const primary = aliases[0].replace(/\s/g, '\\s*');
    const negRe = new RegExp(`${primary}[^가-힣]{0,15}(해당\\s*없음|미시행|미실시|미적용)`);
    if (negRe.test(text)) {
      console.log(`[detectPresentSpecialTypes] ${type}: excluded (explicit 해당없음)`);
      continue;
    }
    // 1회만 등장하면 보조 제도 설명일 가능성 → 2회 이상 요구
    if (count >= 2) {
      present.push(type);
    } else {
      console.log(`[detectPresentSpecialTypes] ${type}: only ${count} mention, skipped`);
    }
  }
  return present;
}

/** 키워드 윈도우 추출 */
function extractRelevantSections(fullText: string, keywords: string[], maxChars = 8000): string {
  const lines = fullText.split('\n');
  const picked = new Set<number>();
  const windowSize = 25;

  for (let i = 0; i < lines.length; i++) {
    if (keywords.some(kw => lines[i].includes(kw))) {
      const start = Math.max(0, i - 3);
      const end = Math.min(lines.length, i + windowSize);
      for (let j = start; j < end; j++) picked.add(j);
    }
  }

  const sorted = Array.from(picked).sort((a, b) => a - b);
  const combined = sorted.map(i => lines[i]).join('\n');
  return combined.length > maxChars ? combined.slice(0, maxChars) + '\n…(생략)' : combined;
}

/** 공고 기본정보 + 공급대상(면적 목록) */
async function parseBasicInfo(text: string) {
  if (!text.trim()) return null;
  const prompt = `다음은 아파트 입주자모집공고문 텍스트입니다. 기본정보와 공급대상 면적 목록을 JSON으로 추출하세요.

${text}

반드시 아래 JSON 형식만 반환 (설명 없이):
{
  "announcementName": "정확한 단지명",
  "housingType": "민영주택 또는 국민주택",
  "region": "광역 시/도 (예: 경기도)",
  "localRegion": "해당지역 시/군/구 (예: 안양시)",
  "otherRegions": "기타지역 설명",
  "isRegulated": false,
  "resaleRestriction": "전매제한 기간 또는 '없음'",
  "rewinRestriction": "재당첨제한 또는 '없음'",
  "announcementDate": "YYYY-MM-DD",
  "exclusiveAreas": [59.9821, 74.9534, 84.9876],
  "totalUnits": 500
}

주의:
- exclusiveAreas는 공급대상 표의 "주택형 전용면적기준" 컬럼 또는 "주거 전용면적" 컬럼에 나오는
  모든 주택형의 면적을 빠짐없이 숫자 배열로 반환. 표에 10개 row가 있으면 10개 값 모두 포함.
- 소수점 정확히 보존 (예: 40.5800, 42.6600, 61.1400, 66.4900)
- 주거공용면적/계약면적/소계/대지지분 등 다른 컬럼은 절대 포함 금지
- 66.28과 66.49처럼 소수점이 다르면 별개 값으로 취급
- 없는 값은 빈 문자열 또는 0`;
  const res = await llmText(prompt, { maxTokens: 1200, jsonMode: true });
  return extractJson(res);
}

/** 일반공급 조건 */
async function parseGeneralSupply(text: string) {
  if (!text.trim()) return null;
  const prompt = `다음은 아파트 입주자모집공고문의 일반공급 관련 내용입니다.
일반공급 1순위/2순위 자격 조건을 JSON으로 추출하세요.

${text}

반드시 아래 JSON 형식만 반환 (설명 없이):
{
  "type": "일반공급",
  "conditions": [
    {
      "rank": 1,
      "label": "1순위",
      "minSubscriptionMonths": 12,
      "minDepositCount": 0,
      "depositByArea": {"60": 300, "85": 600, "102": 1000, "135": 1500},
      "requireHomeless": true,
      "requireHouseholdHead": false,
      "description": "해당 순위의 전체 자격요건을 한글 문장으로 자세히 서술. 청약통장 가입기간, 예치금, 무주택 여부, 세대주 여부, 지역 거주 요건 등을 모두 포함. 마우스오버 툴팁에 표시됨.",
      "descriptionBullets": [
        "청약통장 12개월 이상 가입",
        "지역별·면적별 예치금 충족",
        "무주택세대구성원"
      ]
    },
    {
      "rank": 2,
      "label": "2순위",
      "minSubscriptionMonths": 0,
      "minDepositCount": 0,
      "depositByArea": {},
      "requireHomeless": false,
      "requireHouseholdHead": false,
      "description": "2순위는 1순위 외 청약통장 가입자",
      "descriptionBullets": ["1순위 외 청약통장 가입자"]
    }
  ]
}

주의:
- depositByArea 키는 면적 구간 상한(m², 숫자 문자열), 값은 예치금(만원)
  예: "60" = 60m²이하, "85" = 85m²이하, "102" = 102m²이하, "135" = 135m²이하, "999" = 135m²초과
- 공고에 명시된 예치금 표를 그대로 복사
- description은 반드시 한글 완전 문장으로 상세 설명
- descriptionBullets는 핵심 요건 3-6개`;
  const res = await llmText(prompt, { maxTokens: 1500, jsonMode: true });
  return extractJson(res);
}

/** 특별공급 유형별 조건 */
async function parseSpecialSupply(text: string, allowedTypes?: string[]) {
  if (!text.trim()) return null;
  const allowList = allowedTypes && allowedTypes.length > 0
    ? allowedTypes.join(', ')
    : '다자녀가구, 신혼부부, 생애최초, 노부모부양, 기관추천, 신생아';
  const prompt = `Extract Korean housing special supply eligibility as JSON.

TEXT:
${text}

Return a JSON object with this exact shape:

{
  "types": [
    {
      "type": "다자녀가구",
      "description": "공고에 명시된 다자녀가구 특별공급 자격요건을 한글 완전 문장으로 서술. 거주지, 자녀수, 무주택, 청약통장, 소득 기준 포함.",
      "bullets": ["안양시 거주 무주택세대구성원", "만 19세 미만 자녀 2명 이상", "청약통장 6개월 이상", "면적별 예치금 충족"],
      "minSubscriptionMonths": 6,
      "minChildren": 2,
      "requireHomeless": true,
      "incomeLimitPercent": "120%"
    }
  ]
}

CRITICAL RULES:
- ONLY include these exact types (whitelist): ${allowList}
- DO NOT include any type not in the whitelist above. This is the final list verified from the 공급대상 table.
- DO NOT invent, guess, or add types like 신생아/청년/일반공급 unless they are in the whitelist.
- If the whitelist has 4 types, return exactly 4 types. If 5, return 5. Do not add extras.
- Skip any type the document explicitly marks as 없음/해당없음/미적용.
- description and bullets values must be in Korean. All JSON keys in English.
- bullets should be 3-6 concise items quoted from the text.
- Do NOT include markdown, explanation text, or numbered lists outside the JSON.`;
  const res = await llmText(prompt, { maxTokens: 2000, jsonMode: true });
  console.log('[parseSpecialSupply] raw response (first 600):', res.slice(0, 600));
  const parsed = extractJson<any>(res);
  console.log('[parseSpecialSupply] parsed kind:', Array.isArray(parsed) ? `array[${parsed.length}]` : (parsed ? Object.keys(parsed).join(',') : 'null'));
  if (!parsed) return null;

  // 래퍼 객체에서 배열 추출
  let arr: any[] | null = null;
  if (Array.isArray(parsed)) arr = parsed;
  else if (Array.isArray(parsed.types)) arr = parsed.types;
  else if (Array.isArray(parsed.supplyTypes)) arr = parsed.supplyTypes;
  else if (Array.isArray(parsed.specialSupply)) arr = parsed.specialSupply;
  else if (typeof parsed === 'object') {
    // {"다자녀가구": {...}, "신혼부부": {...}} 형태
    const entries = Object.entries(parsed).filter(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v) && /[가-힣]/.test(k)
    );
    if (entries.length > 0) {
      arr = entries.map(([k, v]: [string, any]) => ({ type: k, ...v }));
    }
  }
  if (!arr) return null;

  // 화이트리스트 강제 필터 — LLM이 hallucinate한 유형(예: PDF에 없는 신생아) 제거
  if (allowedTypes && allowedTypes.length > 0) {
    const before = arr.length;
    arr = arr.filter((item: any) => {
      const t = item?.type || item?.name || item?.['이름'] || item?.['유형'] || '';
      const norm = String(t).replace(/\s+/g, '');
      return allowedTypes.some(a => norm.includes(a.replace(/\s+/g, '')) || a.replace(/\s+/g, '').includes(norm));
    });
    console.log(`[parseSpecialSupply] whitelist filter: ${before} → ${arr.length} (allowed: ${allowedTypes.join(',')})`);
  }

  // flat 스키마 {type, description, bullets, ...flags}를 정상 conditions 구조로 변환
  return arr.map((item: any) => {
    if (!item || typeof item !== 'object') return null;
    const type = item.type || item.name || item['이름'] || item['유형'];
    if (!type) return null;
    // 이미 conditions 배열이 있으면 그대로
    if (Array.isArray(item.conditions) && item.conditions.length > 0) {
      return item;
    }
    // flat → conditions 한 개로 승격
    return {
      type,
      conditions: [{
        rank: 0,
        label: type,
        minSubscriptionMonths: item.minSubscriptionMonths || 0,
        minDepositCount: item.minDepositCount || 0,
        depositByArea: item.depositByArea || {},
        requireHomeless: !!item.requireHomeless,
        requireHouseholdHead: !!item.requireHouseholdHead,
        minChildren: item.minChildren,
        maxMarriageYears: item.maxMarriageYears,
        incomeLimitPercent: item.incomeLimitPercent,
        description: item.description || '',
        descriptionBullets: item.bullets || item.descriptionBullets || [],
      }],
      incomeTable: item.incomeTable || {},
    };
  }).filter(Boolean);
}

async function parseDocuments(text: string) {
  if (!text.trim()) return null;
  const prompt = `다음은 아파트 입주자모집공고문의 당첨자 서류 제출 관련 내용입니다.
공급유형별 필요 서류 목록을 JSON으로 추출하세요.

${text}

반드시 아래 JSON 형식만 반환 (설명 없이):
{
  "common": [
    {"name": "서류명", "description": "발급 조건 및 유의사항"}
  ],
  "perSupplyType": {
    "일반공급": {
      "required": [{"name": "서류명", "description": "설명"}],
      "conditional": [{"name": "서류명", "condition": "해당 조건", "description": "설명"}]
    },
    "신혼부부": { "required": [], "conditional": [] },
    "생애최초": { "required": [], "conditional": [] },
    "다자녀가구": { "required": [], "conditional": [] },
    "노부모부양": { "required": [], "conditional": [] },
    "기관추천": { "required": [], "conditional": [] }
  }
}

주의:
- common은 모든 당첨자 공통 제출 서류
- 해당 공고에 없는 유형은 생략`;
  const res = await llmText(prompt, { maxTokens: 1500, jsonMode: true });
  return extractJson(res);
}
