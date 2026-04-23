/**
 * Gemini 2.5 Flash 기반 모집공고 PDF 추출 엔진
 *
 * 전략: Vercel Hobby 60s 한계 때문에 스키마를 둘로 쪼개 **병렬 호출**.
 *  - CORE: 기존 UI가 쓰는 필드 (제목/일정/공급유형/면적/규제)
 *  - EXTENDED: Phase A 신규 필드 (메타·지역우선·예치금·가점·서류상세)
 * 두 호출 모두 같은 PDF를 받지만 각각 출력 스키마가 작아 ~20~25s에 끝남.
 * 벽시계 = max(Core, Extended) ≈ 25s → Hobby 60s 내 안정 수용.
 */

import { GoogleGenAI, Type } from "@google/genai";
import type { AnnouncementParseResult, ParseEngineResult } from "../announcement-schema";

/* ──────────────────────────────────────────────────────────
 * 스키마 A: CORE (기존 UI에 직접 쓰이는 필드)
 * ────────────────────────────────────────────────────────── */
const GEMINI_SCHEMA_CORE: any = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, nullable: true },
    announcementNo: { type: Type.STRING, nullable: true },
    region: { type: Type.STRING, nullable: true },
    totalUnits: { type: Type.INTEGER, nullable: true },

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

    // Core supplyTypes — 출력량 최소화 위해 UI에 안 쓰이는 필드 제거.
    // 제거: priorityTier, maxAgeParent, requiredDocuments(상단 requiredDocuments와 중복),
    //       evidenceQuote(Core는 규모가 커서 per-item 인용 생략)
    supplyTypes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING },
          canonicalType: { type: Type.STRING, nullable: true },
          units: { type: Type.INTEGER, nullable: true },
          requireHomeless: { type: Type.BOOLEAN, nullable: true },
          minSubscriptionMonths: { type: Type.INTEGER, nullable: true },
          incomeLimitPercent: { type: Type.NUMBER, nullable: true },
          incomeLimitDualPercent: { type: Type.NUMBER, nullable: true },
          maxMarriageYears: { type: Type.NUMBER, nullable: true },
          minChildren: { type: Type.INTEGER, nullable: true },
          assetLimit: { type: Type.STRING, nullable: true },
          carValueLimit: { type: Type.STRING, nullable: true },
          conditions: { type: Type.ARRAY, items: { type: Type.STRING } },
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
        },
      },
    },

    assetLimit: { type: Type.STRING, nullable: true },
    carValueLimit: { type: Type.STRING, nullable: true },
    resaleRestriction: { type: Type.STRING, nullable: true },
    reWinRestriction: { type: Type.STRING, nullable: true },
    residenceObligation: { type: Type.STRING, nullable: true },
    priceCapApplied: { type: Type.BOOLEAN, nullable: true },
  },
};

const SYSTEM_PROMPT_CORE = `당신은 한국 청약 모집공고를 읽는 전문가입니다. PDF 공고문을 읽고 **핵심 필드만** JSON으로 추출합니다.

**규칙**
1. **확실히 확인된 정보만** 추출. 추측·환각 금지. 모르면 null.
2. \`type\`은 공고 원문 그대로. \`canonicalType\`은 표준 분류(일반공급/신혼부부/생애최초/다자녀가구/노부모부양/기관추천/신생아/이전기관/기타) 중 최근접.
3. 날짜는 모두 ISO 8601 (\`YYYY-MM-DDTHH:mm:ss\` 또는 \`YYYY-MM-DD\`).
4. 통합 \`applicationStart\`가 여러 개면 특별공급 접수일 우선.
5. \`regulation\`은 투기과열/청약과열/조정대상/비규제/알수없음 중 하나.
6. 금액은 원 단위 문자열(쉼표 허용).
7. 공급 세대수 합계가 안 맞으면 가장 신뢰할 수 있는 표의 값.

출력은 스키마에 맞는 JSON 하나만.`;

/* ──────────────────────────────────────────────────────────
 * 스키마 B: EXTENDED (Phase A 신규 필드만)
 * ────────────────────────────────────────────────────────── */
const GEMINI_SCHEMA_EXTENDED: any = {
  type: Type.OBJECT,
  properties: {
    housingManagementNo: { type: Type.STRING, nullable: true },
    approvalNo: { type: Type.STRING, nullable: true },
    developer: { type: Type.STRING, nullable: true },
    builder: { type: Type.STRING, nullable: true },
    locationAddress: { type: Type.STRING, nullable: true },
    announcementBaseDate: { type: Type.STRING, nullable: true },

    generalTotalUnits: { type: Type.INTEGER, nullable: true },
    specialTotalUnits: { type: Type.INTEGER, nullable: true },
    lowestFloorPriorityUnits: { type: Type.INTEGER, nullable: true },

    minAge: { type: Type.INTEGER, nullable: true },
    minorHeadAllowed: { type: Type.BOOLEAN, nullable: true },
    eligibleRegions: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    foreignerAllowed: { type: Type.BOOLEAN, nullable: true },

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
          evidencePage: { type: Type.INTEGER, nullable: true },
        },
      },
    },

    subscriptionDeposits: {
      type: Type.ARRAY,
      nullable: true,
      items: {
        type: Type.OBJECT,
        properties: {
          areaRange: { type: Type.STRING },
          region: { type: Type.STRING },
          minDeposit: { type: Type.STRING },
          evidencePage: { type: Type.INTEGER, nullable: true },
        },
      },
    },

    rank1Criteria: { type: Type.STRING, nullable: true },
    rank2Criteria: { type: Type.STRING, nullable: true },
    householdHeadRequired: { type: Type.BOOLEAN, nullable: true },
    homelessHouseholdRequired: { type: Type.BOOLEAN, nullable: true },
    singleHomeOwnerRank1Allowed: { type: Type.BOOLEAN, nullable: true },

    pointLotteryRatios: {
      type: Type.ARRAY,
      nullable: true,
      items: {
        type: Type.OBJECT,
        properties: {
          area: { type: Type.STRING },
          pointPercent: { type: Type.NUMBER, nullable: true },
          lotteryPercent: { type: Type.NUMBER, nullable: true },
          evidencePage: { type: Type.INTEGER, nullable: true },
        },
      },
    },

    // 서류 상세 — 공고마다 20~40건씩 나오므로 필드는 실제 UI가 쓰는 것만 유지.
    // Phase C: validityDays 복구 (공고 기준일 + 유효기간 자동 계산에 필요).
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
          submitTiming: { type: Type.STRING, nullable: true },
          evidencePage: { type: Type.INTEGER, nullable: true },
        },
      },
    },

    duplicateApplicationRule: { type: Type.STRING, nullable: true },
    passbookReuseBlocked: { type: Type.BOOLEAN, nullable: true },
    longTermOverseasRestriction: { type: Type.STRING, nullable: true },
  },
};

const SYSTEM_PROMPT_EXTENDED = `당신은 한국 청약 모집공고 분석가입니다. PDF 공고문에서 **다음 추가 정보만** JSON으로 추출합니다. 기본 정보(제목/일정/공급유형 등)는 다른 파이프라인이 처리하므로 여기서는 다루지 않습니다.

**공통 규칙**
- 확실히 확인된 값만. 추측 금지. 모르면 null.
- 모든 배열 항목에 \`evidencePage\`(1부터 시작하는 페이지 번호, 확신 없으면 null) 기재.

**추출 필드 지침**
1. \`housingManagementNo\`: 주택관리번호(보통 10자리, 예: 2026000049). 공고 표지/개요에 명시.
2. \`approvalNo\`: 공고 승인번호(시·군·구청 승인). 없으면 null.
3. \`developer\`/\`builder\`: 사업주체(시행사)·시공사를 별도로 기재.
4. \`locationAddress\`: "○○시 ○○구 ○○동 ○○-○" 형식 지번까지 포함.
5. \`announcementBaseDate\`: "자격 확인 기준일" 또는 "입주자모집공고일" — 보통 공고일 자체. ISO 8601.
6. \`generalTotalUnits\`/\`specialTotalUnits\`/\`lowestFloorPriorityUnits\`: 세대수 집계표 우선.
7. \`minAge\`/\`minorHeadAllowed\`/\`foreignerAllowed\`: 신청 가능 대상 자격.
8. \`eligibleRegions\`: 신청 가능 지역 목록.
9. \`regionalPriority\`: "양주시 1년 이상 30%, 경기도 6개월 이상 20%, 수도권 기타 50%" 같은 비율 구조를 배열로 분해.
10. \`subscriptionDeposits\`: 지역·면적별 청약예치금표를 행 단위로 파싱.
11. \`rank1Criteria\`/\`rank2Criteria\`: 1·2순위 요건을 1~3문장 요약.
12. \`householdHeadRequired\`/\`homelessHouseholdRequired\`/\`singleHomeOwnerRank1Allowed\`: 세대주·무주택·1주택자 조건.
13. \`pointLotteryRatios\`: 주택형별 가점제/추첨제 비율 (예: 84형 40/60).
14. \`requiredDocumentsDetailed\`: 각 서류마다 category(공통/신혼부부/생애최초/다자녀가구/노부모부양/기관추천/신생아/일반공급), name, required(필수|해당시|null), issuer(발급처), validityDays(유효기간, 예: "최근 3개월 이내"→90, "1개월 이내"→30), submitTiming(제출 시점). 그 외는 생략.
15. \`duplicateApplicationRule\`: 중복청약 제한 규칙 1~2문장 요약.
16. \`passbookReuseBlocked\`: 당첨 확정 시 통장 재사용 불가하면 true.
17. \`longTermOverseasRestriction\`: 장기 해외체류자 우선공급 제한 규칙. 없으면 null.

금액은 원 단위 문자열(쉼표 허용). 날짜는 ISO 8601.
출력은 스키마에 맞는 JSON 하나만.`;

/* ──────────────────────────────────────────────────────────
 * 재시도 헬퍼
 * ────────────────────────────────────────────────────────── */
function isRetryableError(err: any): boolean {
  const msg = String(err?.message || err || "");
  if (/\b(503|429|500|502|504)\b/.test(msg)) return true;
  if (/UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|overloaded|try again|socket hang up|ECONNRESET|ETIMEDOUT/i.test(msg)) return true;
  return false;
}

/** Vercel Hobby 60s 제약.
 *  Core는 supplyTypes/exclusiveAreas 배열 때문에 생성량이 많아 ~50s까지 걸림.
 *  Extended는 더 짧음(~28s).
 *  한 호출 당 52s까지 허용, 한 번 시도 후 실패 시 즉시 폴백으로. */
async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: { maxAttempts?: number; perAttemptTimeoutMs?: number; overallDeadlineMs?: number; tag?: string } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 1;
  // Core는 Flash Lite(~15-25s), Extended는 Flash(~25-40s). 둘 다 별도 60s 함수이므로
  // per-attempt 45s면 여유. Vercel 60s 함수 한계 안에서 응답 직렬화까지 안전하게 수용.
  const perAttemptTimeoutMs = opts.perAttemptTimeoutMs ?? 45_000;
  const overallDeadlineMs = opts.overallDeadlineMs ?? 50_000;
  const tag = opts.tag ?? "gemini";
  const deadline = Date.now() + overallDeadlineMs;
  let lastErr: any;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 2000) break;
    const attemptBudget = Math.min(perAttemptTimeoutMs, remaining);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error(`attempt timeout ${attemptBudget}ms`)), attemptBudget);
    try {
      return await fn(ac.signal);
    } catch (err: any) {
      lastErr = err;
      if (attempt === maxAttempts - 1 || !isRetryableError(err)) throw err;
      const waitMs = 500 + Math.floor(Math.random() * 300);
      const remainAfterWait = deadline - Date.now() - waitMs;
      if (remainAfterWait <= 2000) throw err;
      console.warn(
        `[${tag}] retry ${attempt + 1}/${maxAttempts - 1} after ${waitMs}ms — ${String(err?.message || err).slice(0, 160)}`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/* ──────────────────────────────────────────────────────────
 * 단일 호출 헬퍼
 * ────────────────────────────────────────────────────────── */
async function runGemini(
  ai: GoogleGenAI,
  base64: string,
  schema: any,
  systemPrompt: string,
  userPrompt: string,
  tag: string,
  model?: string,
  budget?: { perAttemptTimeoutMs?: number; overallDeadlineMs?: number },
): Promise<any> {
  const response = await withRetry(
    async (signal) => {
      const callP = ai.models.generateContent({
        model: model || process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "application/pdf", data: base64 } },
              { text: userPrompt },
            ],
          },
        ],
        config: {
          systemInstruction: systemPrompt,
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: schema,
          // 내부 reasoning 비활성화 — Hobby 60s 안에 들어가기 위해 필수
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      return await Promise.race([
        callP,
        new Promise<never>((_, rej) => {
          if (signal.aborted) rej(signal.reason);
          else signal.addEventListener("abort", () => rej(signal.reason), { once: true });
        }),
      ]);
    },
    { tag, ...budget },
  );

  const text = (response as any).text ?? "";
  return JSON.parse(text);
}

/* ──────────────────────────────────────────────────────────
 * 공개 API
 *
 * Hobby 60s 제약 하에서 안정적으로 작동하도록 **두 함수로 분리**:
 *  - extractWithGemini         : Core 스키마만 — 기본 업로드 시 자동 호출
 *  - extractExtendedWithGemini : Phase A 확장 스키마만 — "고급 분석" 버튼
 *
 * 각각 벽시계 ~20s 안에 끝나 60s 함수 예산에 안전.
 * ────────────────────────────────────────────────────────── */
export async function extractWithGemini(
  pdfBuffer: Uint8Array,
): Promise<ParseEngineResult> {
  const started = Date.now();
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return { engine: "gemini", data: {}, durationMs: 0, error: "GEMINI_API_KEY 미설정" };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const base64 = Buffer.from(pdfBuffer).toString("base64");
    // Core는 Flash Lite로 — 속도 우선(Hobby 60s 안에 확실히 수용)
    // 환경변수 GEMINI_CORE_MODEL로 오버라이드 가능
    const coreModel = process.env.GEMINI_CORE_MODEL || "gemini-2.5-flash-lite";
    const data = await runGemini(
      ai,
      base64,
      GEMINI_SCHEMA_CORE,
      SYSTEM_PROMPT_CORE,
      "위 PDF는 한국 청약 모집공고입니다. 핵심 필드(제목/일정/공급유형/면적/규제)를 JSON으로 추출하세요.",
      "gemini-core",
      coreModel,
    );
    return { engine: "gemini", data, durationMs: Date.now() - started };
  } catch (err: any) {
    return {
      engine: "gemini",
      data: {},
      durationMs: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}

export async function extractExtendedWithGemini(
  pdfBuffer: Uint8Array,
): Promise<ParseEngineResult> {
  const started = Date.now();
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return { engine: "gemini", data: {}, durationMs: 0, error: "GEMINI_API_KEY 미설정" };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const base64 = Buffer.from(pdfBuffer).toString("base64");
    // Extended는 품질 유지 위해 full Flash 사용 — 예치금표·서류상세 같은 복잡한 표 때문에
    const extModel = process.env.GEMINI_EXT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    // Extended는 /extended 전용 60s 함수라 regex/텍스트추출 부담 없음 → 55s까지 여유
    const data = await runGemini(
      ai,
      base64,
      GEMINI_SCHEMA_EXTENDED,
      SYSTEM_PROMPT_EXTENDED,
      "위 PDF는 한국 청약 모집공고입니다. 주택관리번호·사업주체·지역우선공급·예치금·가점추첨비율·서류상세 등 확장 필드를 JSON으로 추출하세요.",
      "gemini-ext",
      extModel,
      { perAttemptTimeoutMs: 55_000, overallDeadlineMs: 56_000 },
    );
    return { engine: "gemini", data, durationMs: Date.now() - started };
  } catch (err: any) {
    return {
      engine: "gemini",
      data: {},
      durationMs: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}
