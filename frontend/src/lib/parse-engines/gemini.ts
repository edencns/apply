/**
 * Gemini 2.5 Pro 기반 모집공고 PDF 추출 엔진
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
          evidenceQuote: { type: Type.STRING, nullable: true },
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
          evidenceQuote: { type: Type.STRING, nullable: true },
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

const SYSTEM_PROMPT = `당신은 한국 청약 모집공고를 읽는 전문가입니다. 제공된 PDF 공고문 전체를 읽고 다음 지침에 따라 JSON으로 구조화합니다.

**규칙**
1. 공고문에서 **확실히 확인된 정보만** 추출합니다. 추측·환각 금지.
2. 확인 안 되는 값은 반드시 **null** (빈 문자열 X).
3. **enum 강제 없음** — \`type\`은 원문 표현을 그대로 보존. 예: "신생아 우선공급", "기관추천(추가)".
   \`canonicalType\`에만 표준 분류(일반공급/신혼부부/생애최초/다자녀가구/노부모부양/기관추천/신생아/이전기관/기타) 중 가장 가까운 것을 지정.
4. 날짜는 모두 **ISO 8601** (\`YYYY-MM-DDTHH:mm:ss\` 또는 \`YYYY-MM-DD\`).
5. 표·리스트는 행 단위로 정확히 읽습니다. 면적별 세대수는 일반/특별 구분해 각각 집계.
6. 각 \`supplyTypes\`/\`exclusiveAreas\` 항목에는 **evidenceQuote**로 판단 근거 원문 1~2줄을 반드시 포함.
7. 공급 세대수 합계가 안 맞으면 가장 신뢰할 수 있는 표의 값을 채택.
8. 통합 \`applicationStart\`가 여러 개면 특별공급 접수일을 우선 사용.
9. \`regulation\`은 투기과열/청약과열/조정대상/비규제/알수없음 중 하나.
10. 금액은 원 단위 문자열(예: "215,000,000" 또는 "215000000"). 쉼표 허용.

출력은 반드시 스키마에 맞는 유효한 JSON 하나.`;

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

    const response = await ai.models.generateContent({
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
      },
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
