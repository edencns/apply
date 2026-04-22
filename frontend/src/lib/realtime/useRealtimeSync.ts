"use client";

import { useEffect, useRef } from "react";
import { subscribe } from "./ably-client";

type Payload = {
  id?: number;
  ids?: number[];
  announcement_id?: number;
  by: number;
  at?: number;
};

interface Opts {
  /** 특정 공고에 한정한 고객 변경만 수신. 미지정 시 전체 수신 */
  announcementId?: number;
  /** 고객 CRUD 이벤트 수신 콜백 */
  onCustomerChange?: () => void;
  /** 공고 CRUD 이벤트 수신 콜백 */
  onAnnouncementChange?: () => void;
  /** 파일 업로드 이벤트 수신 콜백 */
  onFileUploaded?: () => void;
}

/**
 * 실시간 이벤트를 받아 콜백으로 연결해주는 훅.
 * 자기(현재 로그인 사용자) 이벤트는 skip — 로컬은 이미 업데이트됨.
 */
export function useRealtimeSync(opts: Opts) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const myId = typeof window !== "undefined"
      ? Number(localStorage.getItem("user_id") || 0)
      : 0;

    const matchesScope = (p: Payload): boolean => {
      if (optsRef.current.announcementId == null) return true;
      // 공고 지정된 경우 해당 공고의 이벤트만 수신
      if (p.announcement_id != null) {
        return p.announcement_id === optsRef.current.announcementId;
      }
      return true;
    };

    const handleCustomer = (p: Payload) => {
      if (p.by === myId) return;
      if (!matchesScope(p)) return;
      optsRef.current.onCustomerChange?.();
    };
    const handleAnnouncement = (p: Payload) => {
      if (p.by === myId) return;
      optsRef.current.onAnnouncementChange?.();
    };
    const handleFile = (p: Payload) => {
      if (p.by === myId) return;
      if (!matchesScope(p)) return;
      optsRef.current.onFileUploaded?.();
    };

    const unsubs = [
      subscribe<Payload>("customer:created", handleCustomer),
      subscribe<Payload>("customer:updated", handleCustomer),
      subscribe<Payload>("customer:deleted", handleCustomer),
      subscribe<Payload>("announcement:created", handleAnnouncement),
      subscribe<Payload>("announcement:updated", handleAnnouncement),
      subscribe<Payload>("announcement:deleted", handleAnnouncement),
      subscribe<Payload>("file:uploaded", handleFile),
    ];
    return () => unsubs.forEach((u) => u());
    // 공고 ID 바뀌면 재구독 (옵션 ref로 그 외 props는 safe)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.announcementId]);
}
