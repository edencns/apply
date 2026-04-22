/**
 * localStorage ↔ Turso 양방향 동기화 유틸
 *
 * 사용자가 명시적으로 버튼을 눌렀을 때만 동기화한다 (자동 동기 X).
 * - push: localStorage → Turso
 * - pull: Turso → localStorage
 */

import {
  localSites, localAnnouncements, localCustomers,
  type LocalAnnouncement, type LocalCustomer,
} from "./local-store";

export type SyncResult = {
  ok: boolean;
  direction: "push" | "pull";
  counts: { sites: number; announcements: number; customers: number };
  error?: string;
};

/** localStorage에 있는 전체 데이터를 Turso로 업로드 */
export async function pushAll(): Promise<SyncResult> {
  try {
    const sites = localSites.list();
    const announcements = localAnnouncements.listAll();
    const customers = localCustomers.listAll();
    const res = await fetch("/api/db/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sites, announcements, customers }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "upload 실패");
    return {
      ok: true,
      direction: "push",
      counts: json.counts,
    };
  } catch (err: any) {
    return {
      ok: false,
      direction: "push",
      counts: { sites: 0, announcements: 0, customers: 0 },
      error: err?.message,
    };
  }
}

/** Turso의 전체 데이터를 localStorage로 덮어쓰기 */
export async function pullAll(): Promise<SyncResult> {
  try {
    const [annRes, custRes] = await Promise.all([
      fetch("/api/db/announcements"),
      fetch("/api/db/customers"),
    ]);
    if (!annRes.ok) throw new Error(`announcements fetch 실패: ${annRes.status}`);
    if (!custRes.ok) throw new Error(`customers fetch 실패: ${custRes.status}`);
    const anns = (await annRes.json()) as LocalAnnouncement[];
    const custs = (await custRes.json()) as LocalCustomer[];

    // 로컬 덮어쓰기 (현재 로컬은 삭제)
    window.localStorage.setItem("apply:announcements", JSON.stringify(anns));
    window.localStorage.setItem("apply:customers", JSON.stringify(custs));

    return {
      ok: true,
      direction: "pull",
      counts: { sites: 0, announcements: anns.length, customers: custs.length },
    };
  } catch (err: any) {
    return {
      ok: false,
      direction: "pull",
      counts: { sites: 0, announcements: 0, customers: 0 },
      error: err?.message,
    };
  }
}

/** 클라우드 DB 상태 조회 */
export async function checkCloudStatus(): Promise<{
  ok: boolean;
  counts?: { sites: number; announcements: number; customers: number };
  error?: string;
}> {
  try {
    const res = await fetch("/api/db/migrate");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "상태 조회 실패");
    return { ok: true, counts: json.counts };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}
