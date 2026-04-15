/**
 * LLM 헬퍼 — Groq API (OpenAI-compatible)
 *
 * 무료 티어: llama-3.3-70b 분당 30회 / 일 14,400회
 * 비전 모델: meta-llama/llama-4-scout-17b-16e-instruct
 */

import Groq from 'groq-sdk';

// 복수 API 키 지원 — 키별로 쿼터가 분리되므로 429 시 다음 키로 폴백
const apiKeys = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter((k): k is string => !!k);

export const hasLlmKey = apiKeys.length > 0;

const clients = apiKeys.map(key => new Groq({ apiKey: key }));

// 모델 선택 — 기본은 70B, 쿼터 초과시 8b-instant로 자동 폴백
const TEXT_MODEL = 'llama-3.3-70b-versatile';
const TEXT_FALLBACK = 'llama-3.1-8b-instant'; // 별도 쿼터, 더 빠름
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

function isRateLimit(err: any): boolean {
  const status = err?.status || err?.response?.status;
  const msg = String(err?.message || '');
  return status === 429 || msg.includes('rate_limit') || msg.includes('Rate limit');
}

function isRequestTooLarge(err: any): boolean {
  const status = err?.status || err?.response?.status;
  const msg = String(err?.message || '');
  return status === 413 || msg.includes('Request too large') || msg.includes('too large');
}

function isJsonValidateFailed(err: any): boolean {
  const code = err?.error?.code || err?.code || err?.response?.data?.error?.code;
  const msg = String(err?.message || '');
  return code === 'json_validate_failed' || msg.includes('json_validate_failed') || msg.includes('Failed to generate JSON');
}

/** Groq가 json_validate_failed로 400을 던질 때 — 실패 시 부분 텍스트를 복구 */
function extractFailedGeneration(err: any): string | null {
  const raw =
    err?.error?.failed_generation ||
    err?.failed_generation ||
    err?.response?.data?.error?.failed_generation;
  return typeof raw === 'string' ? raw : null;
}

/**
 * 키 × 모델 폴백 시퀀스로 시도
 * - 각 키에 대해 primary 모델 → 실패하면 다음 키
 * - 모든 키가 429면 fallback 모델로 동일하게 재시도
 */
async function callWithFallback<T>(
  primary: string,
  fn: (client: Groq, model: string) => Promise<T>,
): Promise<T> {
  if (clients.length === 0) throw new Error('GROQ_API_KEY가 설정되지 않았습니다.');

  const modelSequence = primary === TEXT_FALLBACK ? [TEXT_FALLBACK] : [primary, TEXT_FALLBACK];
  let lastErr: any = null;

  for (const model of modelSequence) {
    for (let i = 0; i < clients.length; i++) {
      try {
        return await fn(clients[i], model);
      } catch (err: any) {
        lastErr = err;
        if (!isRateLimit(err)) throw err;
        console.warn(`[llm] key#${i + 1} ${model} rate-limited, trying next…`);
      }
    }
  }
  throw lastErr;
}

/** 텍스트 전용 호출 */
export async function llmText(
  prompt: string,
  opts?: { model?: string; maxTokens?: number; jsonMode?: boolean },
): Promise<string> {
  const primary = opts?.model || TEXT_MODEL;
  let currentPrompt = prompt;
  let attempts = 0;
  let jsonReminderAdded = false;

  while (attempts < 4) {
    try {
      return await callWithFallback(primary, async (client, model) => {
        const req: any = {
          model,
          max_tokens: opts?.maxTokens || 4000,
          temperature: 0.1,
          messages: [{ role: 'user', content: currentPrompt }],
        };
        if (opts?.jsonMode) {
          req.response_format = { type: 'json_object' };
        }
        const res = await client.chat.completions.create(req);
        return res.choices[0]?.message?.content || '';
      });
    } catch (err: any) {
      if (isRequestTooLarge(err) && attempts < 3) {
        const newLen = Math.floor(currentPrompt.length * 0.66);
        console.warn(`[llmText] request too large, shrinking prompt ${currentPrompt.length} → ${newLen}`);
        currentPrompt = currentPrompt.slice(0, newLen) + '\n…(이하 생략)';
        attempts++;
        continue;
      }
      // Groq JSON mode validation failure — failed_generation 부분을 먼저 구제 시도
      if (isJsonValidateFailed(err)) {
        const partial = extractFailedGeneration(err);
        if (partial && attempts === 0) {
          console.warn(`[llmText] json_validate_failed — recovering from failed_generation (${partial.length} chars)`);
          // 복구된 텍스트를 반환 → 호출자의 extractJson이 가능한 부분을 추출
          return partial;
        }
        if (!jsonReminderAdded && attempts < 3) {
          console.warn('[llmText] json_validate_failed — retrying with strict reminder');
          currentPrompt = currentPrompt +
            '\n\nSTRICT REMINDER: Output must be ONE valid JSON object. ' +
            'No nested objects beyond the schema. ' +
            'No Korean text as keys — keys are strictly English as specified. ' +
            'Close all braces. Output nothing before or after the JSON.';
          jsonReminderAdded = true;
          attempts++;
          continue;
        }
      }
      throw err;
    }
  }
  throw new Error('llmText: exhausted retries');
}

/** 이미지 + 프롬프트 호출 (비전 모델) */
export async function llmVision(
  imageBase64: string,
  mimeType: string,
  prompt: string,
  opts?: { model?: string; maxTokens?: number },
): Promise<string> {
  if (clients.length === 0) throw new Error('GROQ_API_KEY가 설정되지 않았습니다.');
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  const model = opts?.model || VISION_MODEL;
  let lastErr: any = null;
  for (let i = 0; i < clients.length; i++) {
    try {
      const res = await clients[i].chat.completions.create({
        model,
        max_tokens: opts?.maxTokens || 2000,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: prompt },
            ] as any,
          },
        ],
      });
      return res.choices[0]?.message?.content || '';
    } catch (err: any) {
      lastErr = err;
      if (!isRateLimit(err)) throw err;
      console.warn(`[llmVision] key#${i + 1} rate-limited, trying next…`);
    }
  }
  throw lastErr;
}

/** 응답 텍스트에서 JSON 추출 — 객체 `{...}` 또는 배열 `[...]` 모두 지원 */
export function extractJson<T = any>(text: string): T | null {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // 가장 먼저 등장하는 { 또는 [ 위치 찾기
  let startIdx = -1;
  let startChar: '{' | '[' | null = null;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{' || cleaned[i] === '[') {
      startIdx = i;
      startChar = cleaned[i] as '{' | '[';
      break;
    }
  }
  if (startIdx < 0 || !startChar) return null;

  const closeChar = startChar === '{' ? '}' : ']';
  const raw = cleaned.slice(startIdx);

  // 전체 파싱 우선 시도
  try {
    return JSON.parse(raw);
  } catch {
    // 실패시 균형 잡힌 괄호까지만 잘라서 재시도 (문자열 내부 이스케이프 고려)
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === startChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end > 0) {
      try { return JSON.parse(raw.slice(0, end)); } catch { /* fall through */ }
    }
    // 마지막 수단: 누락된 닫는 괄호 자동 추가 (truncation 복구)
    try {
      let depth2 = 0;
      let inString2 = false;
      let escape2 = false;
      let lastSafe = -1; // 마지막으로 문자열 밖에서 안전하게 종료할 수 있는 위치
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (escape2) { escape2 = false; continue; }
        if (ch === '\\') { escape2 = true; continue; }
        if (ch === '"') { inString2 = !inString2; continue; }
        if (inString2) continue;
        if (ch === '{' || ch === '[') depth2++;
        else if (ch === '}' || ch === ']') depth2--;
        if (!inString2 && (ch === ',' || ch === '}' || ch === ']')) lastSafe = i;
      }
      // 문자열 안에서 잘린 경우 → 마지막 안전 위치까지만 사용
      const trimmed = inString2 && lastSafe > 0 ? raw.slice(0, lastSafe + 1) : raw;
      // 누락된 괄호 채우기
      let closing = '';
      let d = 0;
      let inS = false;
      let esc = false;
      const stack: string[] = [];
      for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inS = !inS; continue; }
        if (inS) continue;
        if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); d++; }
        else if (ch === '}' || ch === ']') { stack.pop(); d--; }
      }
      while (stack.length) closing += stack.pop();
      // trailing 쉼표 제거
      const cleanedTail = trimmed.replace(/,\s*$/, '');
      return JSON.parse(cleanedTail + closing);
    } catch {
      return null;
    }
  }
}
