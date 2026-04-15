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
const CUSTOMERS_KEY = "apply:customers";
const WINNERS_KEY = "apply:winners";
const CONTRACTS_KEY = "apply:contracts";

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

// ─── Customers ─────────────────────────────────────────
export interface LocalCustomer {
  id: number;
  announcement_id: number; // 공고 단위로 관리
  site_id: number;
  name: string;
  phone?: string;
  rrn_front?: string;
  rrn_back?: string;
  address?: string;
  no_home_years?: number;
  dependents_count?: number;
  subscription_months?: number;
  current_region?: string;
  income_monthly?: number | null;
  // 특별공급 분류 — 공고별 특별공급 유형에 맞춰 동적으로 추가됨
  special_types?: string[];
  total_score?: number;
  status?: string;
  created_at: string;
}

export const localCustomers = {
  listByAnnouncement(announcementId: number): LocalCustomer[] {
    return read<LocalCustomer>(CUSTOMERS_KEY).filter((c) => c.announcement_id === announcementId);
  },
  listAll(): LocalCustomer[] {
    return read<LocalCustomer>(CUSTOMERS_KEY);
  },
  get(id: number): LocalCustomer | null {
    return read<LocalCustomer>(CUSTOMERS_KEY).find((c) => c.id === id) || null;
  },
  create(input: Omit<LocalCustomer, "id" | "created_at" | "total_score" | "status"> & { total_score?: number; status?: string }): LocalCustomer {
    const items = read<LocalCustomer>(CUSTOMERS_KEY);
    const c: LocalCustomer = {
      id: nextId(items),
      announcement_id: input.announcement_id,
      site_id: input.site_id,
      name: input.name,
      phone: input.phone || "",
      rrn_front: input.rrn_front || "",
      rrn_back: input.rrn_back || "",
      address: input.address || "",
      no_home_years: input.no_home_years ?? 0,
      dependents_count: input.dependents_count ?? 0,
      subscription_months: input.subscription_months ?? 0,
      current_region: input.current_region || "",
      income_monthly: input.income_monthly ?? null,
      special_types: input.special_types ?? [],
      total_score: input.total_score ?? 0,
      status: input.status ?? "inquiry",
      created_at: new Date().toISOString(),
    };
    items.push(c);
    write(CUSTOMERS_KEY, items);
    return c;
  },
  update(id: number, patch: Partial<LocalCustomer>): LocalCustomer | null {
    const items = read<LocalCustomer>(CUSTOMERS_KEY);
    const idx = items.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    write(CUSTOMERS_KEY, items);
    return items[idx];
  },
  remove(id: number) {
    const items = read<LocalCustomer>(CUSTOMERS_KEY).filter((c) => c.id !== id);
    write(CUSTOMERS_KEY, items);
  },
};

// ─── Winners (당첨자) ───────────────────────────────────
export interface LocalWinner {
  id: number;
  announcement_id: number;
  customer_id?: number | null;
  customer_name: string;
  customer_phone?: string;
  unit_number?: string;
  unit_type?: string;
  supply_type?: string;
  is_preliminary?: boolean;
  doc_review_status: string; // pending | reviewing | eligible | ineligible | needs_review | needs_supplement
  contract_intent: string;   // pending | confirmed | declined
  total_score?: number;
  created_at: string;
}

export const localWinners = {
  listByAnnouncement(announcementId: number): LocalWinner[] {
    return read<LocalWinner>(WINNERS_KEY).filter((w) => w.announcement_id === announcementId);
  },
  create(input: Omit<LocalWinner, "id" | "created_at" | "doc_review_status" | "contract_intent"> & { doc_review_status?: string; contract_intent?: string }): LocalWinner {
    const items = read<LocalWinner>(WINNERS_KEY);
    const w: LocalWinner = {
      id: nextId(items),
      announcement_id: input.announcement_id,
      customer_id: input.customer_id ?? null,
      customer_name: input.customer_name,
      customer_phone: input.customer_phone || "",
      unit_number: input.unit_number || "",
      unit_type: input.unit_type || "",
      supply_type: input.supply_type || "일반공급",
      is_preliminary: input.is_preliminary ?? false,
      doc_review_status: input.doc_review_status ?? "pending",
      contract_intent: input.contract_intent ?? "pending",
      total_score: input.total_score ?? 0,
      created_at: new Date().toISOString(),
    };
    items.push(w);
    write(WINNERS_KEY, items);
    return w;
  },
  update(id: number, patch: Partial<LocalWinner>): LocalWinner | null {
    const items = read<LocalWinner>(WINNERS_KEY);
    const idx = items.findIndex((w) => w.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    write(WINNERS_KEY, items);
    return items[idx];
  },
};

// ─── Walk-in Contracts (방문 계약) ─────────────────────
export interface LocalContract {
  id: number;
  announcement_id: number;
  customer_id?: number | null;
  customer_name: string;
  unit_number?: string;
  unit_type?: string;
  contract_no?: string;
  total_price?: number;
  status: string; // draft | ready | signed
  signed_at?: string | null;
  created_at: string;
}

export const localContracts = {
  listByAnnouncement(announcementId: number): LocalContract[] {
    return read<LocalContract>(CONTRACTS_KEY).filter((c) => c.announcement_id === announcementId);
  },
  findByName(announcementId: number, name: string): LocalContract | null {
    return read<LocalContract>(CONTRACTS_KEY).find(
      (c) => c.announcement_id === announcementId && c.customer_name === name,
    ) || null;
  },
  create(input: Omit<LocalContract, "id" | "created_at" | "status"> & { status?: string }): LocalContract {
    const items = read<LocalContract>(CONTRACTS_KEY);
    const c: LocalContract = {
      id: nextId(items),
      announcement_id: input.announcement_id,
      customer_id: input.customer_id ?? null,
      customer_name: input.customer_name,
      unit_number: input.unit_number || "",
      unit_type: input.unit_type || "",
      contract_no: input.contract_no || `WI-${Date.now()}`,
      total_price: input.total_price ?? 0,
      status: input.status ?? "ready",
      signed_at: null,
      created_at: new Date().toISOString(),
    };
    items.push(c);
    write(CONTRACTS_KEY, items);
    return c;
  },
  update(id: number, patch: Partial<LocalContract>): LocalContract | null {
    const items = read<LocalContract>(CONTRACTS_KEY);
    const idx = items.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    write(CONTRACTS_KEY, items);
    return items[idx];
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
