/**
 * Gemini 2.5 Flash 기반 모집공고 PDF 추출 엔진
 *
 * 장점: 1M 컨텍스트, PDF 네이티브 입력(텍스트+레이아웃 동시 이해),
 *       responseSchema로 JSON 강제, 한국어 표 이해도 우수.
 *
 * 사용 조건: GEMINI_API_KEY 환경변수 필요.
 */

import { GoogleGenAI, Type } from "@google/genai";
import type { AnnouncementParseResult, ParseEngineResult } from "../announcement-schema";

/** Zod → Gemini responseSchema(JSON Schema 근사) 변환.
 *  복잡한 Zod 기능은 쓰지 않으므로 수동으로 작성. 스키마 진화 시 갱신 필요. */
const GEMINI_SCHEMA: any = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, nullable: true },
    announcementNo: { type: Type.STRING, nullable: true },
    region: { type: Type.STRING, nullable: true },
    totalUnits: { type: Type.INTEGER, nullable: true },

    // Phase A — 메타
    housingManagementNo: { type: Type.STRING, nullable: true },
    approvalNo: { type: Type.STRING, nullable: true },
    developer: { type: Type.STRING, nullable: true },
    builder: { type: Type.STRING, nullable: true },
    locationAddress: { type: Type.STRING, nullable: true },
    announcementBaseDate: { type: Type.STRING, nullable: true },

    // Phase A — 세대수 구성
    generalTotalUnits: { type: Type.INTEGER, nullable: true },
    specialTotalUnits: { type: Type.INTEGER, nullable: true },
    lowestFloorPriorityUnits: { type: Type.INTEGER, nullable: true },

    announcementDate: { type: Type.STRING, nullable: true },
    applicationStart: { type: Type.STRING, nullable: true },
    applicationEnd: { type: Type.STRING, nullable: true },
    specialApplyDate: { type: Type.STRING, nullable: true },
    general1stDate: { type: Type.STRING, nullable: true },
    general2ndDate: { type: Type.STRING, nullable: true },
    winnerAnnounceDate: { type: Type.STRING, nullable: true },
    docSubmitStart: { type: Type.STRING, nullable: true },
    docSubmitEnd: { type: Type.STRING, nullable: true },
    contractStart: { type: Type.STRING, nullable: true },
    contractEnd: { type: Type.STRING, nullable: true },
    moveInDate: { type: Type.STRING, nullable: true },

    noHomeRequired: { type: Type.BOOLEAN, nullable: true },
    minSubscriptionMonths: { type: Type.INTEGER, nullable: true },
    regulation: { type: Type.STRING, nullable: true },
    landType: { type: Type.STRING, nullable: true },

    // Phase A — 신청 대상
    minAge: { type: Type.INTEGER, nullable: true },
    minorHeadAllowed: { type: Type.BOOLEAN, nullable: true },
    eligibleRegions: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    foreignerAllowed: { type: Type.BOOLEAN, nullable: true },

    // Phase A — 지역 우선공급
    regionalPriority: {
      type: Type.ARRAY,
      nullable: true,
      items: {
        type: Type.OBJECT,
        properties: {
          region: { type: Type.STRING },
          minResidenceMonths: { type: Type.INTEGER, nullable: true },
          ratioPercent: { type: Type.NUMBER, nullable: true },
          supplyScope: { type: Type.STRING, nullable: true },
          evidenceQuote: { type: Type.STRING, nullable: true },
          evidencePage: { type: Type.INTEGER, nullable: true },
        },
      },
    },

    // Phase A — 예치금
    subscriptionDeposits: {
      type: Type.ARRAY,
      nullable: true,
      items: {
        type: Type.OBJECT,
        properties: {
          areaRange: { type: Type.STRING },
          region: { type: Type.STRING },
          minDeposit: { type: Type.STRING },
          evidenceQuote: { type: Type.STRING, nullable: true },
          evidencePage: { type: Type.INTEGER, nullable: true },
        },
      },
    },

    rank1Criteria: { type: Type.STRING, nullable: true },
    rank2Criteria: { type: Type.STRING, nullable: true },
    householdHeadRequired: { type: Type.BOOLEAN, nullable: true },
    homelessHouseholdRequired: { type: Type.BOOLEAN, nullable: true },
    singleHomeOwnerRank1Allowed: { type: Type.BOOLEAN, nullable: true },

    // Phase A — 가점·추첨
    pointLotteryRatios: {
      type: Type.ARRAY,
      nullable: true,
      items: {
        type: Type.OBJECT,
        properties: {
          area: { type: Type.STRING },
          pointPercent: { type: Type.NUMBER, nullable: true },
          lotteryPercent: { type: Type.NUMBER, nullable: true },
          evidenceQuote: { type: Type.STRING, nullable: true },
          evidencePage: { type: Type.INTEGER, nullable: true },
        },
      },
    },

    supplyTypes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING },
          canonicalType: { type: Type.STRING, nullable: true },
          priorityTier: { type: Type.STRING, nullable: true },
          units: { type: Type.INTEGER, nullable: true },
          requireHomeless: { type: Type.BOOLEAN, nullable: true },
          minSubscriptionMonths: { type: Type.INTEGER, nullable: true },
          incomeLimitPercent: { type: Type.NUMBER, nullable: true },
          incomeLimitDualPercent: { type: Type.NUMBER, nullable: true },
          maxMarriageYears: { type: Type.NUMBER, nullable: true },
          minChildren: { type: Type.INTEGER, nullable: true },
          maxAgeParent: { type: Type.INTEGER, nullable: true },
          assetLimit: { type: Type.STRING, nullable: true },
          carValueLimit: { type: Type.STRING, nullable: true },
          conditions: { type: Type.ARRAY, items: { type: Type.STRING } },
          requiredDocuments: { type: Type.ARRAY, items: { type: Type.STRING } },
          selectionMethod: { type: Type.STRING, nullable: true },
          ineligibleReasons: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
          evidenceQuote: { type: Type.STRING, nullable: true },
          evidencePage: { type: Type.INTEGER, nullable: true },
        },
      },
    },

    exclusiveAreas: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          area: { type: Type.STRING },
          squareMeters: { type: Type.NUMBER, nullable: true },
          totalUnits: { type: Type.INTEGER, nullable: true },
          generalUnits: { type: Type.INTEGER, nullable: true },
          specialUnits: { type: Type.INTEGER, nullable: true },
          price: { type: Type.STRING, nullable: true },
          priceMin: { type: Type.STRING, nullable: true },
          priceMax: { type: Type.STRING, nullable: true },
          evidenceQuote: { type: Type.STRING, nullable: true },
          evidencePage: { type: Type.INTEGER, nullable: true },
        },
      },
    },

    // Phase A — 필요 서류 상세
    requiredDocumentsDetailed: {
      type: Type.ARRAY,
      nullable: true,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          name: { type: Type.STRING },
          required: { type: Type.STRING, nullable: true },
          issuer: { type: Type.STRING, nullable: true },
          validityDays: { type: Type.INTEGER, nullable: true },
          detailedVersion: { type: Type.BOOLEAN, nullable: true },
          originalRequired: { type: Type.BOOLEAN, nullable: true },
          submitTiming: { type: Type.STRING, nullable: true },
          alternativeDocs: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
          evidenceQuote: { type: Type.STRING, nullable: true },
          evidencePage: { type: Type.INTEGER, nullable: true },
        },
      },
    },

    assetLimit: { type: Type.STRING, nullable: true },
    carValueLimit: { type: Type.STRING, nullable: true },
    resaleRestriction: { type: Type.STRING, nullable: true },
    reWinRestriction: { type: Type.STRING, nullable: true },
    residenceObligation: { type: Type.STRING, nullable: true },
    priceCapApplied: { type: Type.BOOLEAN, nullable: true },
    duplicateApplicationRule: { type: Type.STRING, nullable: true },
    passbookReuseBlocked: { type: Type.BOOLEAN, nullable: true },
    longTermOverseasRestriction: { type: Type.STRING, nullable: true },
  },
};

const SYSTEM_PROMPT = `당신은 한국 청약 모집공고를 읽는 전문가입니다. 제공된 PDF 공고문 전체를 읽고 다음 지침에 따라 JSON으로 구조화합니다.

**규칙**
1. 공고문에서 **확실히 확인된 정보만** 추출합니다. 추측·환각 금지.
2. 확인 안 되는 값은 반드시 **null** (빈 문자열 X).
3. **enum 강제 없음** — \`type\`은 원문 표현을 그대로 보존. 예: "신생아 우선공급", "기관추천(추가)".
   \`canonicalType\`에만 표준 분류(일반공급/신혼부부/생애최초/다자녀가구/노부모부양/기관추천/신생아/이전기관/기타) 중 가장 가까운 것을 지정.
4. 날짜는 모두 **ISO 8601** (\`YYYY-MM-DDTHH:mm:ss\` 또는 \`YYYY-MM-DD\`).
5. 표·리스트는 행 단위로 정확히 읽습니다. 면적별 세대수는 일반/특별 구분해 각각 집계.
6. 각 항목에 **evidenceQuote**(판단 근거 원문 1~2줄)와 **evidencePage**(해당 내용이 나오는 공고문 페이지 번호, 1부터 시작)를 반드시 포함. 페이지 번호를 확신할 수 없으면 null.
7. 공급 세대수 합계가 안 맞으면 가장 신뢰할 수 있는 표의 값을 채택.
8. 통합 \`applicationStart\`가 여러 개면 특별공급 접수일을 우선 사용.
9. \`regulation\`은 투기과열/청약과열/조정대상/비규제/알수없음 중 하나.
10. 금액은 원 단위 문자열(예: "215,000,000" 또는 "215000000"). 쉼표 허용.

**Phase A — 추가 추출 규칙**
11. \`housingManagementNo\`: 주택관리번호(보통 10자리, 예: 2026000049). 공고 표지/개요에 명시.
12. \`approvalNo\`: 공고 승인번호(시·군·구청 승인). 없으면 null.
13. \`developer\`/\`builder\`: 사업주체(시행사)·시공사를 별도로 기재.
14. \`locationAddress\`: "○○시 ○○구 ○○동 ○○-○" 형식 지번까지 포함.
15. \`announcementBaseDate\`: "자격 확인 기준일" 또는 "입주자모집공고일" — 보통 공고일 자체.
16. \`generalTotalUnits\`/\`specialTotalUnits\`: 일반공급·특별공급 세대수 합계. 집계표 우선.
17. \`lowestFloorPriorityUnits\`: 최하층 우선배정 세대수. 해당 조항 없으면 null.
18. \`regionalPriority\`: "양주시 1년 이상 30%, 경기도 6개월 이상 20%, 수도권 기타 50%" 같은 비율 구조를 배열로 분해.
19. \`subscriptionDeposits\`: 지역·면적별 청약예치금표를 행 단위로 파싱.
20. \`pointLotteryRatios\`: 주택형별 가점제·추첨제 비율 (예: 84형 40/60, 128형 0/100).
21. \`rank1Criteria\`/\`rank2Criteria\`: 1순위·2순위 요건을 간결히 1~3문장으로 요약.
22. \`requiredDocumentsDetailed\`: 각 서류마다 category(공통/신혼부부 등), 필수/해당시 구분, 발급처, 유효기간(일수), 상세본 여부, 원본 필요 여부를 파악.
23. \`supplyTypes[].selectionMethod\`: 해당 유형의 선정 방식(예: "1순위 중 가점 순, 동점 시 추첨").
24. \`supplyTypes[].ineligibleReasons\`: 자격 박탈 사유(예: "세대원 주택 소유", "소득 초과", "혼인기간 7년 초과").
25. \`duplicateApplicationRule\`: 중복청약 제한 규칙을 요약(예: "1인 1건, 세대 내 중복 시 전원 무효").
26. \`passbookReuseBlocked\`: 당첨 확정 시 청약통장 재사용 불가하면 true.
27. \`longTermOverseasRestriction\`: 장기 해외체류자 우선공급 제한 규칙을 요약. 없으면 null.

출력은 반드시 스키마에 맞는 유효한 JSON 하나.`;

/** 재시도 대상 판별 — 503(UNAVAILABLE), 429(RESOURCE_EXHAUSTED), 500, 504, 일시적 네트워크 오류 */
function isRetryableError(err: any): boolean {
  const msg = String(err?.message || err || "");
  if (/\b(503|429|500|502|504)\b/.test(msg)) return true;
  if (/UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|overloaded|try again|socket hang up|ECONNRESET|ETIMEDOUT/i.test(msg)) return true;
  return false;
}

/** Vercel Hobby maxDuration=60s. thinking 비활성화 시 Gemini 2.5 Flash는
 *  대부분 15~30s 내 완료되므로 한 번만 제대로 시도 + 아주 짧은 재시도 1회.
 *  - maxAttempts=2: 즉시 재시도 (백오프 없음 또는 0.5s)
 *  - perAttemptTimeoutMs=40s: 한 번 호출 예산
 *  - overallDeadlineMs=50s: Groq 폴백 여지 남김 */
async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: { maxAttempts?: number; perAttemptTimeoutMs?: number; overallDeadlineMs?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 2;
  const perAttemptTimeoutMs = opts.perAttemptTimeoutMs ?? 40_000;
  const overallDeadlineMs = opts.overallDeadlineMs ?? 50_000;
  const deadline = Date.now() + overallDeadlineMs;
  let lastErr: any;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 2000) break; // 2초도 안 남으면 포기
    const attemptBudget = Math.min(perAttemptTimeoutMs, remaining);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error(`attempt timeout ${attemptBudget}ms`)), attemptBudget);
    try {
      return await fn(ac.signal);
    } catch (err: any) {
      lastErr = err;
      if (attempt === maxAttempts - 1 || !isRetryableError(err)) throw err;
      // Hobby 예산이 빡빡해 백오프 짧게 (0.5s + jitter)
      const waitMs = 500 + Math.floor(Math.random() * 300);
      const remainAfterWait = deadline - Date.now() - waitMs;
      if (remainAfterWait <= 2000) throw err; // 대기하고 나면 시간 없음
      console.warn(
        `[gemini] retry ${attempt + 1}/${maxAttempts - 1} after ${waitMs}ms — ${String(err?.message || err).slice(0, 160)}`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function extractWithGemini(
  pdfBuffer: Uint8Array,
): Promise<ParseEngineResult> {
  const started = Date.now();
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return {
      engine: "gemini",
      data: {},
      durationMs: 0,
      error: "GEMINI_API_KEY 미설정",
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // inlineData로 PDF 직접 전송 (작은 파일은 업로드 API 안 써도 됨)
    const base64 = Buffer.from(pdfBuffer).toString("base64");

    const response = await withRetry(async (signal) => {
      const callP = ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "application/pdf", data: base64 } },
              { text: "위 PDF는 한국 청약 모집공고입니다. 시스템 규칙에 따라 JSON으로 구조화해 주세요." },
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: GEMINI_SCHEMA,
          // 2.5 Flash 내부 reasoning 비활성화 → 레이턴시 절반 이하로 감소.
          // Vercel Hobby 60s 제약 하에서 필수.
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      // SDK가 AbortSignal을 직접 지원하지 않아도 race로 budget 제한
      return await Promise.race([
        callP,
        new Promise<never>((_, rej) => {
          if (signal.aborted) rej(signal.reason);
          else signal.addEventListener("abort", () => rej(signal.reason), { once: true });
        }),
      ]);
    });

    const text = response.text ?? "";
    const parsed = JSON.parse(text) as Partial<AnnouncementParseResult>;

    return {
      engine: "gemini",
      data: parsed,
      durationMs: Date.now() - started,
    };
  } catch (err: any) {
    return {
      engine: "gemini",
      data: {},
      durationMs: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}
