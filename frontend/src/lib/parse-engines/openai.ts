/**
 * OpenAI GPT-4.1 기반 모집공고 PDF 교차검증 엔진
 *
 * Gemini와 다른 모델 패밀리로 동시 추출 → mergeByConsensus로 합의 여부 측정.
 * OpenAI는 현재 PDF 직접 첨부를 지원하지 않으므로 텍스트 전문을 전달한다.
 *
 * 사용 조건: OPENAI_API_KEY 환경변수 필요.
 */

import OpenAI from "openai";
import type { AnnouncementParseResult, ParseEngineResult } from "../announcement-schema";

const SYSTEM_PROMPT = `당신은 한국 청약 모집공고 전문 분석가입니다. 공고문 텍스트 전문을 읽고 구조화된 JSON으로 추출합니다.

**규칙**
1. 확실히 확인된 값만. 추측·환각 금지. 확인 못 하면 null.
2. \`type\`은 공고 원문 표현 그대로, \`canonicalType\`은 표준 분류(일반공급/신혼부부/생애최초/다자녀가구/노부모부양/기관추천/신생아/이전기관/기타).
3. 모든 날짜는 ISO 8601 (YYYY-MM-DDTHH:mm:ss 또는 YYYY-MM-DD).
4. 각 supplyTypes/exclusiveAreas에 evidenceQuote(근거 원문 1~2줄) 필수.
5. applicationStart는 특별공급 접수일 우선.
6. regulation은 투기과열/청약과열/조정대상/비규제/알수없음 중 하나.
7. 금액은 원 단위 문자열(쉼표 허용).
8. 출력은 스키마에 맞는 JSON 하나만.`;

/** OpenAI JSON Schema — Zod를 쓰면 strict=true와 호환 문제가 있어 수동 작성.
 *  Gemini 스키마와 동일 필드 구성. */
const OPENAI_JSON_SCHEMA: any = {
  name: "announcement_parse_result",
  strict: false, // evidenceQuote 등 nullable 필드가 많아 strict는 과도한 제약
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: ["string", "null"] },
      announcementNo: { type: ["string", "null"] },
      region: { type: ["string", "null"] },
      totalUnits: { type: ["integer", "null"] },

      announcementDate: { type: ["string", "null"] },
      applicationStart: { type: ["string", "null"] },
      applicationEnd: { type: ["string", "null"] },
      specialApplyDate: { type: ["string", "null"] },
      general1stDate: { type: ["string", "null"] },
      general2ndDate: { type: ["string", "null"] },
      winnerAnnounceDate: { type: ["string", "null"] },
      docSubmitStart: { type: ["string", "null"] },
      docSubmitEnd: { type: ["string", "null"] },
      contractStart: { type: ["string", "null"] },
      contractEnd: { type: ["string", "null"] },
      moveInDate: { type: ["string", "null"] },

      noHomeRequired: { type: ["boolean", "null"] },
      minSubscriptionMonths: { type: ["integer", "null"] },
      regulation: { type: ["string", "null"] },
      landType: { type: ["string", "null"] },

      supplyTypes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string" },
            canonicalType: { type: ["string", "null"] },
            priorityTier: { type: ["string", "null"] },
            units: { type: ["integer", "null"] },
            requireHomeless: { type: ["boolean", "null"] },
            minSubscriptionMonths: { type: ["integer", "null"] },
            incomeLimitPercent: { type: ["number", "null"] },
            incomeLimitDualPercent: { type: ["number", "null"] },
            maxMarriageYears: { type: ["number", "null"] },
            minChildren: { type: ["integer", "null"] },
            maxAgeParent: { type: ["integer", "null"] },
            assetLimit: { type: ["string", "null"] },
            carValueLimit: { type: ["string", "null"] },
            conditions: { type: "array", items: { type: "string" } },
            requiredDocuments: { type: "array", items: { type: "string" } },
            evidenceQuote: { type: ["string", "null"] },
          },
        },
      },

      exclusiveAreas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            area: { type: "string" },
            squareMeters: { type: ["number", "null"] },
            totalUnits: { type: ["integer", "null"] },
            generalUnits: { type: ["integer", "null"] },
            specialUnits: { type: ["integer", "null"] },
            price: { type: ["string", "null"] },
            evidenceQuote: { type: ["string", "null"] },
          },
        },
      },

      assetLimit: { type: ["string", "null"] },
      carValueLimit: { type: ["string", "null"] },
      resaleRestriction: { type: ["string", "null"] },
      reWinRestriction: { type: ["string", "null"] },
      residenceObligation: { type: ["string", "null"] },
      priceCapApplied: { type: ["boolean", "null"] },
    },
  },
};

export async function extractWithOpenAI(
  fullText: string,
  fileName: string,
): Promise<ParseEngineResult> {
  const started = Date.now();
  const apiKey = process.env.OPENAI_API_KEY || process.env.GPT_API_KEY;
  if (!apiKey) {
    return {
      engine: "openai",
      data: {},
      durationMs: 0,
      error: "OPENAI_API_KEY 미설정",
    };
  }

  try {
    const openai = new OpenAI({ apiKey });

    // 너무 길면 앞·뒤 중 앞쪽 250K 문자 유지(GPT-4.1 1M 토큰 ≈ 한글 500K 문자 수준이나 안전 마진)
    const text = fullText.length > 250_000 ? fullText.slice(0, 250_000) : fullText;

    const resp = await openai.chat.completions.create({
      model: "gpt-4.1",
      temperature: 0,
      response_format: { type: "json_schema", json_schema: OPENAI_JSON_SCHEMA },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `파일명: ${fileName}\n\n--- 공고 본문 시작 ---\n${text}\n--- 공고 본문 끝 ---\n\n위 공고문을 규칙에 따라 JSON으로 추출하세요.`,
        },
      ],
    });

    const content = resp.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as Partial<AnnouncementParseResult>;

    return {
      engine: "openai",
      data: parsed,
      durationMs: Date.now() - started,
    };
  } catch (err: any) {
    return {
      engine: "openai",
      data: {},
      durationMs: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}
