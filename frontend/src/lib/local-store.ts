/**
 * 브라우저 로컬 저장소 기반 데이터 스토어.
 * 백엔드가 없는 상태에서도 공고/현장 등록·목록이 동작하도록 하기 위한 fallback.
 *
 * - 저장 포맷: JSON
 * - 키: `apply:<collection>`
 * - ID: timestamp 기반 자동 생성
 */

export interface LocalSite {
  id: number;
  name: string;
  address: string;
  total_units: number;
  status?: string;
  created_at: string;
}

export interface LocalAnnouncement {
  id: number;
  site_id: number;
  title: string;
  announcement_no?: string | null;
  status: "draft" | "published" | "closed";
  application_start?: string | null;
  application_end?: string | null;
  winner_announce_date?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  eligibility_rules?: Record<string, any>;
  created_at: string;
}

const SITES_KEY = "apply:sites";
const ANNOUNCEMENTS_KEY = "apply:announcements";
const ACTIVE_ANN_KEY = "apply:activeAnnouncement";

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function nextId(items: { id: number }[]): number {
  return items.length === 0 ? 1 : Math.max(...items.map((i) => i.id)) + 1;
}

// ─── Sites ─────────────────────────────────────────────
export const localSites = {
  list(): LocalSite[] {
    return read<LocalSite>(SITES_KEY);
  },
  create(input: { name: string; address?: string; total_units?: number }): LocalSite {
    const items = read<LocalSite>(SITES_KEY);
    const site: LocalSite = {
      id: nextId(items),
      name: input.name,
      address: input.address || "미입력",
      total_units: input.total_units ?? 0,
      status: "active",
      created_at: new Date().toISOString(),
    };
    items.push(site);
    write(SITES_KEY, items);
    return site;
  },
};

// ─── Announcements ─────────────────────────────────────
export const localAnnouncements = {
  listBySite(siteId: number): LocalAnnouncement[] {
    return read<LocalAnnouncement>(ANNOUNCEMENTS_KEY).filter((a) => a.site_id === siteId);
  },
  listAll(): LocalAnnouncement[] {
    return read<LocalAnnouncement>(ANNOUNCEMENTS_KEY);
  },
  get(id: number): LocalAnnouncement | null {
    return read<LocalAnnouncement>(ANNOUNCEMENTS_KEY).find((a) => a.id === id) || null;
  },
  create(input: Omit<LocalAnnouncement, "id" | "status" | "created_at"> & { status?: "draft" | "published" | "closed" }): LocalAnnouncement {
    const items = read<LocalAnnouncement>(ANNOUNCEMENTS_KEY);
    const ann: LocalAnnouncement = {
      id: nextId(items),
      site_id: input.site_id,
      title: input.title,
      announcement_no: input.announcement_no ?? null,
      application_start: input.application_start ?? null,
      application_end: input.application_end ?? null,
      winner_announce_date: input.winner_announce_date ?? null,
      contract_start: input.contract_start ?? null,
      contract_end: input.contract_end ?? null,
      eligibility_rules: input.eligibility_rules ?? {},
      status: input.status ?? "draft",
      created_at: new Date().toISOString(),
    };
    items.push(ann);
    write(ANNOUNCEMENTS_KEY, items);
    return ann;
  },
};

// ─── Active Announcement (현재 작업 중인 공고) ────────────
/** 다른 페이지(고객 관리, 서류 검수, 공고 비교)에서 끌어다 쓰기 위해 현재 선택된 공고를 보관 */
export interface ActiveAnnouncementSnapshot {
  id: number;
  title: string;
  announcement_no?: string | null;
  source: "backend" | "local";
  snapshot: LocalAnnouncement | null;
  selected_at: string;
}

export const activeAnnouncement = {
  set(ann: { id: number; title: string; announcement_no?: string | null }, source: "backend" | "local" = "local", snapshot: LocalAnnouncement | null = null) {
    if (typeof window === "undefined") return;
    const payload: ActiveAnnouncementSnapshot = {
      id: ann.id,
      title: ann.title,
      announcement_no: ann.announcement_no ?? null,
      source,
      snapshot,
      selected_at: new Date().toISOString(),
    };
    window.localStorage.setItem(ACTIVE_ANN_KEY, JSON.stringify(payload));
  },
  get(): ActiveAnnouncementSnapshot | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(ACTIVE_ANN_KEY);
      return raw ? (JSON.parse(raw) as ActiveAnnouncementSnapshot) : null;
    } catch {
      return null;
    }
  },
  clear() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(ACTIVE_ANN_KEY);
  },
};

/**
 * 백엔드 호출에서 "Network Error"가 났는지 판별.
 * axios는 서버와 연결 자체가 실패했을 때 `err.message === "Network Error"`로 떨어진다.
 */
export function isNetworkError(err: any): boolean {
  if (!err) return false;
  if (err.message === "Network Error") return true;
  if (err.code === "ERR_NETWORK" || err.code === "ECONNREFUSED") return true;
  // axios는 no response이면 response가 undefined
  if (err.request && !err.response) return true;
  return false;
}
