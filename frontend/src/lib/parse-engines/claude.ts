/**
 * Claude Sonnet 4.5 기반 고정밀 검증 엔진 (기본 비활성)
 *
 * PDF document block + citations 기능으로 기존 결과 대조·수정.
 * Claude 사용량 한도 때문에 사용자가 "최종 검증" 버튼을 누를 때만 호출.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AnnouncementParseResult, ParseEngineResult } from "../announcement-schema";

const VERIFY_PROMPT = `첨부된 PDF는 한국 청약 모집공고입니다. 아래 이전 파싱 결과(JSON)를 공고 원문과 대조해 **틀렸거나 누락된 필드만** JSON으로 반환하세요.

**규칙**
- 동일한 필드명 유지. 값은 공고 원문 기준 정확한 값.
- 문제없는 필드는 결과에 포함하지 마세요.
- 날짜는 ISO 8601. 금액은 원 단위 문자열.
- 근거가 불확실하면 포함하지 마세요.

이전 결과:
\`\`\`json
{{PRIOR}}
\`\`\`

출력은 JSON 하나만, 수정할 필드만 포함.`;

export async function verifyWithClaude(
  pdfBuffer: Uint8Array,
  prior: Partial<AnnouncementParseResult>,
): Promise<ParseEngineResult> {
  const started = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      engine: "claude",
      data: {},
      durationMs: 0,
      error: "ANTHROPIC_API_KEY 미설정",
    };
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const base64 = Buffer.from(pdfBuffer).toString("base64");
    const promptText = VERIFY_PROMPT.replace("{{PRIOR}}", JSON.stringify(prior, null, 2));

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            { type: "text", text: promptText },
          ],
        },
      ],
    });

    // Claude 응답 텍스트에서 JSON 블록 추출
    const textBlock = msg.content.find((c: any) => c.type === "text") as any;
    const text = textBlock?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude 응답에 JSON 없음");
    const patch = JSON.parse(jsonMatch[0]) as Partial<AnnouncementParseResult>;

    return {
      engine: "claude",
      data: patch,
      durationMs: Date.now() - started,
    };
  } catch (err: any) {
    return {
      engine: "claude",
      data: {},
      durationMs: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}
