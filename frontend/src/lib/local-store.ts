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
  /** 당첨자 서류접수 기간 */
  document_submit_start?: string | null;
  document_submit_end?: string | null;
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
  // 같은 탭 안의 다른 페이지·컴포넌트에 변경 알림
  // (브라우저 기본 StorageEvent는 "다른 탭에만" 발생하므로 자체 이벤트 추가)
  try {
    window.dispatchEvent(new CustomEvent("apply:local-store-changed", { detail: { key } }));
  } catch {
    /* 구형 브라우저 fallback */
  }
}

/**
 * 로컬 스토어 변경 구독 — 훅 내부에서 사용.
 * handler는 어떤 키(sites/announcements/customers 등)가 바뀌었는지 받음.
 */
export function onLocalStoreChange(
  handler: (key: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapper = (e: Event) => {
    const ce = e as CustomEvent<{ key: string }>;
    handler(ce.detail?.key || "");
  };
  window.addEventListener("apply:local-store-changed", wrapper);
  // 다른 탭 변경도 수신
  const storageWrapper = (e: StorageEvent) => {
    if (e.key) handler(e.key);
  };
  window.addEventListener("storage", storageWrapper);
  return () => {
    window.removeEventListener("apply:local-store-changed", wrapper);
    window.removeEventListener("storage", storageWrapper);
  };
}

function nextId(items: { id: number }[]): number {
  return items.length === 0 ? 1 : Math.max(...items.map((i) => i.id)) + 1;
}

/** 백그라운드로 Turso에 동기화 (fire-and-forget).
 *  localStorage 가 진짜 소스, DB는 백업/공유 용도. 네트워크 실패 시 무시. */
function syncBg(path: string, init: RequestInit) {
  if (typeof window === "undefined") return;
  fetch(path, init).catch(() => { /* offline OK */ });
}
function pushAnnouncementBg(a: LocalAnnouncement) {
  syncBg("/api/db/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(a),
  });
}
function patchAnnouncementBg(id: number, patch: Partial<LocalAnnouncement>) {
  syncBg(`/api/db/announcements/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
function deleteAnnouncementBg(id: number) {
  syncBg(`/api/db/announcements/${id}`, { method: "DELETE" });
}
function pushCustomerBg(c: LocalCustomer) {
  syncBg("/api/db/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(c),
  });
}
function patchCustomerBg(id: number, patch: Partial<LocalCustomer>) {
  syncBg(`/api/db/customers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
function deleteCustomerBg(ids: number[]) {
  syncBg(`/api/db/customers?ids=${ids.join(",")}`, { method: "DELETE" });
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
      document_submit_start: input.document_submit_start ?? null,
      document_submit_end: input.document_submit_end ?? null,
      eligibility_rules: input.eligibility_rules ?? {},
      status: input.status ?? "draft",
      created_at: new Date().toISOString(),
    };
    items.push(ann);
    write(ANNOUNCEMENTS_KEY, items);
    pushAnnouncementBg(ann);
    return ann;
  },
  remove(id: number) {
    const items = read<LocalAnnouncement>(ANNOUNCEMENTS_KEY).filter((a) => a.id !== id);
    write(ANNOUNCEMENTS_KEY, items);
    deleteAnnouncementBg(id);
  },
  update(id: number, patch: Partial<LocalAnnouncement>) {
    const items = read<LocalAnnouncement>(ANNOUNCEMENTS_KEY);
    const idx = items.findIndex((a) => a.id === id);
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...patch };
      write(ANNOUNCEMENTS_KEY, items);
      patchAnnouncementBg(id, patch);
    }
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
  // ── 공급 유형 및 평형 ──
  supply_type?: string;      // "일반공급" 또는 특별공급 유형명
  unit_type?: string;        // 주택형 코드 (예: "84A", "059.9660")
  unit_area?: string;        // 전용면적 (예: "59.99㎡")
  unit_dong?: string;        // 동 (예: "101")
  unit_ho?: string;          // 호수 (예: "1401")
  // ── 당첨자 / 예비 구분 ──
  is_standby?: boolean;      // true면 예비입주자 (빈자리 대기)
  standby_rank?: string;     // 예비 순위 (1,2,3...)
  /** 청약홈 전산추첨결과 Excel에서 들어온 원본 당첨자 메타 */
  winner_info?: {
    sheet_source?: string;          // 출처 시트 (일반공급당첨자, 신혼부부당첨자 등)
    building?: string;              // 동수
    unit_no?: string;               // 호수
    selection_method?: string;      // 가점제/추첨제/추첨/가점 등
    application_date?: string;      // 접수일자 (YYYYMMDD)
    savings_opened?: string;        // 청약통장개설일
    low_floor_apply?: boolean;      // 저층 신청 여부
    bank?: string;                  // 개설은행
    account_type?: string;          // 예금종목 (종합저축 등)
    account?: string;               // 계좌번호
    rank?: string;                  // 순위 (1/2)
    region_priority_kind?: string;  // (01)해당지역/(02)기타지역 등
    ga_score?: number;              // 가점
    penalty?: number;               // 감점
    total_score?: number;           // 총점
    housing_type_code?: string;     // 주택형 코드(0733949 등)
    ga_point_type?: string;         // 당첨구분 (가점제/추첨제)
  };
  // ── 예비 승계 체인 ──
  superseded?: boolean;          // true면 부적합/포기 후 다른 사람이 자리 승계 → 비활성
  superseded_by?: number;        // 이 자리를 승계한 고객 ID
  succeeded_from?: number;       // (예비→당첨 승계된 경우) 원래 당첨자 ID
  supersede_reason?: string;     // 포기·부적합 사유 요약
  supersede_at?: string;         // 승계 시각 ISO
  // ── 서류 검수 상태 ──
  documents_submitted?: Record<string, boolean>;
  verification_verdict?: "eligible" | "ineligible" | "pending";
  verification_score?: number;
  verification_checked_at?: string;
  verification_reasons?: string[];  // 부적합 사유 (없으면 적합)
  /** Phase #8 — 청약홈 당첨사실 확인서 기반 과거 당첨 이력 */
  past_winnings?: Array<{
    /** 당첨 공고명 */
    announcementTitle: string;
    /** 당첨일 (YYYY-MM-DD) */
    winDate: string;
    /** 공급유형 — 특공 평생 1회 제한 판정에 사용 */
    supplyType?: string;
    /** canonicalType 분류 */
    canonicalType?: string;
    /** 주택형 */
    unitType?: string;
    /** 재당첨 제한 기간 (년 단위, 숫자 또는 텍스트) */
    restrictionYears?: number;
    /** 재당첨 제한 해제일 */
    restrictionEndDate?: string;
    /** 참고 메모 */
    note?: string;
  }>;
  /** 당첨사실 확인서 업로드·검토 시각 */
  past_winnings_checked_at?: string;

  /** Phase #6 — 담당자 수동 승인 기록 */
  manual_review?: {
    /** 판정 확정 여부 — 담당자 서명 후 true */
    signed_off: boolean;
    /** 담당자 서명 시 체크한 항목들 */
    checklist: {
      announcement_original_confirmed: boolean;   // 공고 원문 재확인 완료
      family_cert_matched: boolean;               // 가족관계·혼인관계 증명서 대조 완료
      past_winning_checked: boolean;              // 청약홈 당첨사실 확인서 대조 완료
      boundary_cases_reviewed: boolean;           // 애매 케이스 상급자 결재
    };
    /** 서명한 담당자명 */
    reviewer_name: string;
    /** 서명 시각 ISO */
    signed_at: string;
    /** 특이사항 메모 */
    note?: string;
  };
  // ── 공적 검증 데이터 (파일 일괄 분석에서 채움) ──
  household_members?: Array<{
    name: string;
    rrn?: string;
    errorCode?: string;
  }>;
  properties?: Array<{
    ownerRrn: string;
    ownerName: string;
    address: string;
    areaM2?: number;
    acquiredDate?: string;
    transferredDate?: string;
    usage?: string;
  }>;
  /** 주택소유 전산검색 파일 업로드 시각 — 파일에 레코드 없으면 무주택으로 간주 */
  property_checked_at?: string;
  /** 분리세대원 (청약홈 자동 조회 대상이 아닌 별도 세대 가족) */
  separated_household_members?: Array<{
    name: string;
    rrn: string;               // 주민번호 (앞6-뒷7 형태)
    relation: string;          // 배우자·자녀·부모 등
    note?: string;             // 메모 (예: "등본확인 필요")
  }>;
  /** 분리세대 명단 업로드 시각 — 없으면 "분리세대 없음"으로 간주 */
  separated_checked_at?: string;
  /** 분리세대원 주택소유 결과 (청약홈 분리세대 회신 PDF 파싱) */
  separated_properties?: Array<{
    ownerRrn: string;
    ownerName: string;
    relation?: string;
    address: string;
    areaM2?: number;
    acquiredDate?: string;
    transferredDate?: string;
    usage?: string;
  }>;
  /** 분리세대 주택소유 PDF 업로드 시각 */
  separated_property_checked_at?: string;
  /**
   * 명의변경 이력 — 상속·증여·전매·이혼재산분할 등으로 계약자가 바뀐 경우.
   * 계약 체결 이후 발생하는 이벤트라 워크플로우 6단계에서 별도 처리.
   */
  title_transfer?: {
    reason: "상속" | "배우자증여" | "부모자녀증여" | "이혼재산분할" | "전매" | "기타";
    transferDate?: string;          // YYYY-MM-DD
    oldHolder?: {
      name?: string;
      rrn?: string;                 // 기존 명의자 주민번호
      address?: string;
    };
    newHolder?: {
      name?: string;
      rrn?: string;                 // 신 명의자 주민번호 (암호화 대상)
      address?: string;
      phone?: string;
      relation?: string;            // 배우자/자녀/부모/상속인 등
    };
    submittedDocuments?: string[];  // 제출된 서류 목록
    originalFileUrl?: string;       // 스캔본 PDF 프록시 URL
    originalFileName?: string;
    aiConfidence?: "high" | "med" | "low";
    aiNotes?: string;               // AI가 담당자에게 전달한 특이사항
    reviewedBy?: number;            // 승인한 담당자 user_id
    reviewedAt?: string;            // 승인 시각
    createdAt: string;              // 레코드 생성 시각
  };
  /**
   * 5단계 서류 판정용 — 각 서류별 제출된 파일.
   * key = 서류 이름 (예: "주민등록등본", "가족관계증명서").
   */
  document_files?: Record<string, {
    url: string;                  // Vercel Blob 프록시 URL
    filename: string;
    uploadedAt: string;
    uploadedBy?: number;
    /** files 테이블 ID (페이지 수 조회 등 API 호출용) */
    fileId?: number;
    /** 이 서류가 묶음 PDF 내에서 시작되는 페이지 번호 (단일 페이지 — 레거시 호환용) */
    page?: number;
    /** 이 서류가 묶음 PDF에서 차지하는 페이지들 (여러 장 가능) */
    pages?: number[];
    /** PDF 총 페이지 수 (자동 감지되면 저장) */
    totalPages?: number;
    checkpointResults?: Record<string, {
      status: "pass" | "fail" | "pending";
      note?: string;
    }>;
  }>;
  /**
   * 최종 계약 정보 — 청약홈 검증·계약 체결까지 완료된 계약자 상태.
   * (현 Phase에서는 사용 안 함 — 향후 6단계 명의변경용)
   */
  contract?: {
    status: "signed" | "occupancy" | "cancelled";
    contractDate?: string;          // 계약일 (YYYY-MM-DD)
    unitType?: string;              // 평형 (예: "84.8636")
    typeCode?: string;              // TYPE 컬럼
    totalPrice?: number;            // 총 분양가
    downPayment?: number;           // 계약금 합계
    midPayments?: number[];         // 중도금 1~6차
    finalPayment?: number;          // 잔금
    optionPrice?: number;           // 옵션 금액
    paymentScheduleText?: string;   // 자유 메모
    coContractor?: {                // 공동명의
      name?: string;
      phone?: string;
      code?: string;
    };
    residentAddress?: string;       // 주민등록 주소
    livingAddress?: string;         // 거주지 주소
    contractNo?: string;            // 계약서번호
    email?: string;
    /** 원본 서류 스캔본 (Vercel Blob 프록시 URL) */
    documentScanUrl?: string;
    documentScanFileName?: string;
    documentScanUploadedAt?: string;
    /** 일괄 등록 시각 */
    importedAt?: string;
  };
  savings_priority?: {
    verified: boolean;
    bankCode?: string;
    errorNote?: string;
    resultLength?: number;
  };
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
      // ── 주택형 / 공급유형 / 검수 상태 ──
      supply_type: input.supply_type,
      unit_type: input.unit_type,
      unit_area: input.unit_area,
      unit_dong: input.unit_dong,
      unit_ho: input.unit_ho,
      is_standby: input.is_standby,
      standby_rank: input.standby_rank,
      superseded: input.superseded,
      superseded_by: input.superseded_by,
      succeeded_from: input.succeeded_from,
      supersede_reason: input.supersede_reason,
      supersede_at: input.supersede_at,
      documents_submitted: input.documents_submitted,
      verification_verdict: input.verification_verdict,
      verification_score: input.verification_score,
      verification_checked_at: input.verification_checked_at,
      verification_reasons: input.verification_reasons,
      household_members: input.household_members,
      properties: input.properties,
      savings_priority: input.savings_priority,
      total_score: input.total_score ?? 0,
      status: input.status ?? "inquiry",
      created_at: new Date().toISOString(),
    };
    items.push(c);
    write(CUSTOMERS_KEY, items);
    pushCustomerBg(c);
    return c;
  },
  update(id: number, patch: Partial<LocalCustomer>): LocalCustomer | null {
    const items = read<LocalCustomer>(CUSTOMERS_KEY);
    const idx = items.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    write(CUSTOMERS_KEY, items);
    patchCustomerBg(id, patch);
    return items[idx];
  },
  remove(id: number) {
    const items = read<LocalCustomer>(CUSTOMERS_KEY).filter((c) => c.id !== id);
    write(CUSTOMERS_KEY, items);
    deleteCustomerBg([id]);
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
 * 공고가 완료 상태인지 판별.
 * - status === "closed" 이거나
 * - 모든 주요 일정 중 가장 늦은 날짜가 오늘보다 이전이면 완료
 */
export function isAnnouncementDone(ann: any): boolean {
  if (!ann) return false;
  if (ann.status === "closed") return true;
  const rules: any = ann.eligibility_rules || {};
  const candidates: string[] = [
    ann.contract_end,
    ann.application_end,
    ann.winner_announce_date,
    rules.doc_submit_end,
    rules.general_2nd_date,
    rules.general_1st_date,
    rules.special_apply_date,
  ].filter(Boolean);
  if (candidates.length === 0) return false;
  try {
    const latestMs = Math.max(
      ...candidates.map((d) => new Date(d).getTime()).filter((t) => !Number.isNaN(t)),
    );
    if (!Number.isFinite(latestMs)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return latestMs < today.getTime();
  } catch {
    return false;
  }
}

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
