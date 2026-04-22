"use client";

/**
 * 브라우저용 Ably Realtime 싱글톤.
 * 토큰 발급 엔드포인트(/api/ably/auth) 경유로 API 키를 브라우저에 노출하지 않음.
 */

import * as Ably from "ably";

let _client: Ably.Realtime | null = null;

export function getAblyClient(): Ably.Realtime | null {
  if (typeof window === "undefined") return null;
  if (_client) return _client;
  try {
    _client = new Ably.Realtime({
      authUrl: "/api/ably/auth",
      authMethod: "GET",
      echoMessages: false, // 자기가 보낸 것도 안 받음 (페이지는 낙관적 갱신 중)
    });
    return _client;
  } catch (e) {
    console.error("[ably] init fail", e);
    return null;
  }
}

export type Unsubscribe = () => void;

/** 'shared-data' 채널에서 특정 이벤트 구독. 언구독 함수 반환. */
export function subscribe<T = any>(
  event: string,
  handler: (payload: T) => void,
): Unsubscribe {
  const client = getAblyClient();
  if (!client) return () => {};
  const channel = client.channels.get("shared-data");
  const listener = (msg: any) => handler(msg.data as T);
  channel.subscribe(event, listener);
  return () => {
    try { channel.unsubscribe(event, listener); } catch {}
  };
}
