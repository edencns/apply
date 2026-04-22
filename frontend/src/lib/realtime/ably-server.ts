/**
 * 서버(API 라우트)에서 Ably 채널로 이벤트 발행.
 * REST 클라이언트 사용 — 연결 유지 없이 단발성 publish만.
 */

import * as Ably from "ably";

let _client: Ably.Rest | null = null;

function getClient(): Ably.Rest | null {
  const key = process.env.ABLY_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Ably.Rest({ key });
  return _client;
}

export type RealtimeEvent =
  | "announcement:created"
  | "announcement:updated"
  | "announcement:deleted"
  | "customer:created"
  | "customer:updated"
  | "customer:deleted"
  | "file:uploaded";

export interface RealtimePayload {
  /** 대상 엔티티 ID (공고 또는 고객) */
  id?: number;
  /** 대상 엔티티의 ID 배열 (일괄 삭제 등) */
  ids?: number[];
  /** 해당 공고 ID (고객·파일 이벤트) */
  announcement_id?: number;
  /** 이벤트 발생시킨 사용자 ID — 자기 이벤트 skip 용 */
  by: number;
  /** 타임스탬프 */
  at?: number;
}

export async function broadcast(event: RealtimeEvent, payload: RealtimePayload) {
  const client = getClient();
  if (!client) return;
  try {
    const channel = client.channels.get("shared-data");
    await channel.publish(event, { ...payload, at: payload.at ?? Date.now() });
  } catch (e) {
    console.error("[ably] broadcast fail", event, e);
  }
}
