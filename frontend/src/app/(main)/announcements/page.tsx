"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { sitesApi, api } from "@/lib/api";
import { localSites, localAnnouncements, isNetworkError, isAnnouncementDone } from "@/lib/local-store";
import { Plus, BookOpen, CalendarDays, ChevronRight, ChevronUp, ChevronDown, FileUp, Loader2, CheckCircle2, Trash2, FileText, PenTool } from "lucide-react";
import { announcements as sampleAnnouncements } from "./compare/data";

interface Announcement {
  id: number | string;
  site_id?: number;
  title: string;
  announcement_no: string;
  status: string;
  application_start: string;
  contract_end?: string | null;
  created_at?: string;
  _isSample?: boolean;       // 샘플 공고 표시용
  _docSubmit?: string;        // 서류접수 일정
  _contract?: string;         // 계약체결 일정
  _location?: string;         // 위치
  _totalUnits?: number;       // 총 세대수
  _regulation?: string;       // 규제지역
}

type TabKey = "active" | "done";

const DEFAULT_RULES = {
  no_home_required: true,
  region_priority: [] as string[],
  region_full: "" as string,
  min_region_residence_months: 12,
  income_limit: "",
  min_subscription_period: 0,
  special_supply_types: [] as string[],
  // LLM 확장 필드
  supply_types_detail: null as any[] | null,
  exclusive_areas: null as any[] | null,
  required_documents: null as Record<string, string[]> | null,
  income_table: null as Record<string, Record<string, number>> | null,
  asset_limit: "" as string,
  car_value_limit: "" as string,
  doc_submit_start: "" as string,
  doc_submit_end: "" as string,
  total_units: 0 as number,
  // PDF 파싱 규제/제한/일정 필드
  resale_restriction: "" as string,
  rewin_restriction: "" as string,
  residence_obligation: "" as string,
  price_cap_applied: undefined as boolean | undefined,
  land_type: "" as string,
  move_in_date: "" as string,
  point_system: "" as string,
  announcement_date: "" as string,
  special_apply_date: "" as string,
  general_1st_date: "" as string,
  general_2nd_date: "" as string,
};

/** 공고가 완료 상태인지 판별 — 가장 늦은 일정이 오늘 이전이면 완료 */
const isDone = (ann: Announcement): boolean => isAnnouncementDone(ann);

export default function AnnouncementsPage() {
  const [sites, setSites] = useState<any[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<TabKey>("active");
  const [form, setForm] = useState({
    title: "",
    announcement_no: "",
    application_start: "",
    application_end: "",
    winner_announce_date: "",
    document_submit_start: "",
    document_submit_end: "",
    contract_start: "",
    contract_end: "",
    rules: { ...DEFAULT_RULES },
    regionInput: "",
  });
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfFilled, setPdfFilled] = useState<string[]>([]);
  /** 최근 업로드한 PDF 파일 — "고급 분석" 버튼에서 재사용 */
  const [lastPdfFile, setLastPdfFile] = useState<File | null>(null);
  const [extendedParsing, setExtendedParsing] = useState(false);
  const [extendedFilled, setExtendedFilled] = useState<string[]>([]);
  /** 상세 설정 토글 — Phase D */
  const [advancedMode, setAdvancedMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const [deleting, setDeleting] = useState<number | string | null>(null);

  const [sitesError, setSitesError] = useState<string | null>(null);

  const reloadSites = useCallback(async () => {
    try {
      const r = await sitesApi.list();
      setSites(r.data);
      if (r.data.length > 0) {
        setSiteId(r.data[0].id);
        setSitesError(null);
      }
      return r.data;
    } catch (err: any) {
      if (isNetworkError(err)) {
        const local = localSites.list();
        setSites(local);
        if (local.length > 0) setSiteId(local[0].id);
        setSitesError(null);
        return local;
      }
      console.error("[announcements] sites load failed", err);
      setSitesError(err?.message || "현장 목록을 불러오지 못했습니다.");
      return null;
    }
  }, []);

  useEffect(() => { reloadSites(); }, [reloadSites]);

  /** "YYYY.MM.DD~MM.DD" 또는 "YYYY.MM.DD ~ YYYY.MM.DD" 형식에서 끝 날짜를 ISO로 추출 */
  function extractEndDateISO(range?: string): string | null {
    if (!range) return null;
    const parts = range.split("~").map((s) => s.trim());
    if (parts.length < 2) return null;
    const [startStr, endStr] = parts;
    const startMatch = startStr.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
    if (!startMatch) return null;
    const startYear = startMatch[1];
    // 끝이 "MM.DD"만 있는 경우 → 시작 연도 사용
    const endShort = endStr.match(/^(\d{1,2})[.\-](\d{1,2})$/);
    if (endShort) {
      return `${startYear}-${endShort[1].padStart(2, "0")}-${endShort[2].padStart(2, "0")}`;
    }
    // 끝이 "YYYY.MM.DD"인 경우
    const endFull = endStr.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
    if (endFull) {
      return `${endFull[1]}-${endFull[2].padStart(2, "0")}-${endFull[3].padStart(2, "0")}`;
    }
    return null;
  }

  /** 샘플 공고를 Announcement 형태로 변환 */
  const sampleAsAnnouncements: Announcement[] = sampleAnnouncements.map((s) => ({
    id: `sample-${s.id}`,
    title: s.shortName,
    announcement_no: "",
    status: "published",
    application_start: s.schedule.specialApply || "",
    contract_end: extractEndDateISO(s.schedule.contract),
    _isSample: true,
    _docSubmit: s.schedule.docSubmit,
    _contract: s.schedule.contract,
    _location: s.location,
    _totalUnits: s.totalUnits,
    _regulation: s.regulation,
  }));

  /** 날짜 문자열 → "YYYY.MM.DD" 형식 */
  function fmtShortDate(s?: string | null): string {
    if (!s) return "";
    try {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return "";
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    } catch { return ""; }
  }

  /** "YYYY.MM.DD~YYYY.MM.DD" → 같은 연도면 "YYYY.MM.DD~MM.DD" */
  function fmtRange(start: string, end: string): string {
    if (!start) return "";
    if (!end || end === start) return start;
    // 같은 연도면 뒤쪽 연도 생략
    const [sy] = start.split(".");
    const [ey, ...rest] = end.split(".");
    if (sy === ey) return `${start}~${rest.join(".")}`;
    return `${start}~${end}`;
  }

  /** 등록된 공고(backend/local)에도 표시용 메타 추가 */
  function enrichRegistered(ann: any): any {
    const rules = ann.eligibility_rules || {};
    // 전체 주소: region_full > region_priority 조합
    const location = rules.region_full || (rules.region_priority || []).join(" ") || null;
    // 세대수: PDF에서 직접 추출한 값 우선, 없으면 exclusive_areas 합산
    const areas: any[] = rules.exclusive_areas || [];
    const areasSum = areas.reduce((s: number, a: any) => s + (a.totalUnits || 0), 0);
    const totalUnits = rules.total_units || areasSum;
    // 규제지역
    const regulation = rules.regulation || (rules.no_home_required ? "비규제" : null);
    // 서류접수 날짜
    const docStart = fmtShortDate(rules.doc_submit_start);
    const docEnd = fmtShortDate(rules.doc_submit_end);
    const docSubmit = fmtRange(docStart, docEnd);
    // 계약 날짜
    const conStart = fmtShortDate(ann.contract_start);
    const conEnd = fmtShortDate(ann.contract_end);
    const contractDate = fmtRange(conStart, conEnd);

    return {
      ...ann,
      _location: location,
      _totalUnits: totalUnits,
      _regulation: regulation,
      _docSubmit: docSubmit || null,
      _contract: contractDate || null,
    };
  }

  const loadAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/announcements/`);
      const data = Array.isArray(r.data) ? r.data.map(enrichRegistered) : [];
      const local = localAnnouncements.listAll().map(enrichRegistered);
      const merged = [...data];
      for (const l of local) {
        if (!merged.some((a: any) => a.id === l.id)) merged.push(l as any);
      }
      // 샘플 공고 추가 (삭제된 것 제외)
      const deletedSamples = getDeletedSamples();
      for (const s of sampleAsAnnouncements) {
        if (!deletedSamples.includes(String(s.id))) merged.push(s as any);
      }
      setAnnouncements(
        merged.sort((a: any, b: any) => {
          const ad = a.created_at || a.application_start || "";
          const bd = b.created_at || b.application_start || "";
          return bd.localeCompare(ad);
        }) as any,
      );
    } catch (err: any) {
      const deletedSamples = getDeletedSamples();
      const activeSamples = sampleAsAnnouncements.filter((s) => !deletedSamples.includes(String(s.id)));
      if (isNetworkError(err)) {
        const local = localAnnouncements.listAll().map(enrichRegistered) as any[];
        setAnnouncements([...local, ...activeSamples] as any);
      } else {
        console.error("[announcements] load failed", err);
        const local = localAnnouncements.listAll().map(enrichRegistered) as any[];
        setAnnouncements([...local, ...activeSamples] as any);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

  // 브라우저 뒤로가기(bfcache) 시 — 캐시된 옛 번들이 보이지 않도록 강제 새로고침
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const normalizeDateTime = (v: string): string | null => {
    if (!v) return null;
    return /\d{2}:\d{2}:\d{2}/.test(v) ? v : `${v}:00`;
  };

  /** 삭제된 샘플 id 기억 (새로고침 후에도 유지) */
  const DELETED_SAMPLES_KEY = "apply:deleted_samples";
  function getDeletedSamples(): string[] {
    try { return JSON.parse(localStorage.getItem(DELETED_SAMPLES_KEY) || "[]"); } catch { return []; }
  }
  function addDeletedSample(id: string) {
    const list = getDeletedSamples();
    if (!list.includes(id)) { list.push(id); localStorage.setItem(DELETED_SAMPLES_KEY, JSON.stringify(list)); }
  }

  /** 공고 삭제 */
  const handleDelete = async (ann: Announcement) => {
    if (!confirm(`"${ann.title}" 공고를 삭제하시겠습니까?\n삭제하면 복구할 수 없습니다.`)) return;
    setDeleting(ann.id);
    try {
      if (typeof ann.id === "string" && ann.id.startsWith("sample-")) {
        // 샘플 공고 삭제 — localStorage에 기록
        addDeletedSample(ann.id);
      } else {
        try {
          await api.delete(`/announcements/${ann.id}`);
        } catch (err: any) {
          if (!isNetworkError(err) && err?.response?.status !== 404) throw err;
        }
        if (typeof ann.id === "number") localAnnouncements.remove(ann.id);
      }
      setAnnouncements((prev) => prev.filter((a) => a.id !== ann.id));
    } catch (err: any) {
      alert(err?.message || "삭제 실패");
    } finally {
      setDeleting(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.title.trim()) {
      setFormError("공고명을 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const eligibilityRules: Record<string, any> = {
        no_home_required: form.rules.no_home_required,
        region_priority: form.rules.region_priority,
        region_full: form.rules.region_full || "",
        min_region_residence_months: form.rules.min_region_residence_months,
        income_limit: form.rules.income_limit ? Number(form.rules.income_limit) : null,
        min_subscription_period: form.rules.min_subscription_period,
        special_supply_types: form.rules.special_supply_types,
      };
      if (form.rules.supply_types_detail) eligibilityRules.supply_types_detail = form.rules.supply_types_detail;
      if (form.rules.exclusive_areas) eligibilityRules.exclusive_areas = form.rules.exclusive_areas;
      if (form.rules.required_documents) eligibilityRules.required_documents = form.rules.required_documents;
      if (form.rules.income_table) eligibilityRules.income_table = form.rules.income_table;
      if (form.rules.asset_limit) eligibilityRules.asset_limit = form.rules.asset_limit;
      if (form.rules.car_value_limit) eligibilityRules.car_value_limit = form.rules.car_value_limit;
      if (form.rules.doc_submit_start) eligibilityRules.doc_submit_start = form.rules.doc_submit_start;
      if (form.rules.doc_submit_end) eligibilityRules.doc_submit_end = form.rules.doc_submit_end;
      if (form.rules.total_units) eligibilityRules.total_units = form.rules.total_units;
      // 규제 + 제한 + 일정
      if (form.rules.resale_restriction) eligibilityRules.resale_restriction = form.rules.resale_restriction;
      if (form.rules.rewin_restriction) eligibilityRules.rewin_restriction = form.rules.rewin_restriction;
      if (form.rules.residence_obligation) eligibilityRules.residence_obligation = form.rules.residence_obligation;
      if (typeof form.rules.price_cap_applied === "boolean") eligibilityRules.price_cap_applied = form.rules.price_cap_applied;
      if (form.rules.land_type) eligibilityRules.land_type = form.rules.land_type;
      if (form.rules.move_in_date) eligibilityRules.move_in_date = form.rules.move_in_date;
      if (form.rules.point_system) eligibilityRules.point_system = form.rules.point_system;
      if (form.rules.announcement_date) eligibilityRules.announcement_date = form.rules.announcement_date;
      if (form.rules.special_apply_date) eligibilityRules.special_apply_date = form.rules.special_apply_date;
      if (form.rules.general_1st_date) eligibilityRules.general_1st_date = form.rules.general_1st_date;
      if (form.rules.general_2nd_date) eligibilityRules.general_2nd_date = form.rules.general_2nd_date;
      // Phase A 확장 필드 — 고급 분석 또는 상세 설정에서 입력한 값 pass-through
      const PHASE_A_KEYS = [
        "housing_management_no", "approval_no", "developer", "builder",
        "location_address", "announcement_base_date",
        "general_total_units", "special_total_units", "lowest_floor_priority_units",
        "min_age", "minor_head_allowed", "eligible_regions", "foreigner_allowed",
        "regional_priority", "subscription_deposits",
        "rank1_criteria", "rank2_criteria",
        "household_head_required", "homeless_household_required", "single_home_owner_rank1_allowed",
        "point_lottery_ratios", "required_documents_detailed",
        "duplicate_application_rule", "passbook_reuse_blocked", "long_term_overseas_restriction",
      ];
      for (const k of PHASE_A_KEYS) {
        const v = (form.rules as any)[k];
        if (v === undefined || v === null || v === "") continue;
        if (Array.isArray(v) && v.length === 0) continue;
        eligibilityRules[k] = v;
      }
      const annPayload = {
        title: form.title.trim(),
        announcement_no: form.announcement_no || null,
        application_start: normalizeDateTime(form.application_start),
        application_end: normalizeDateTime(form.application_end),
        winner_announce_date: normalizeDateTime(form.winner_announce_date),
        contract_start: normalizeDateTime(form.contract_start),
        contract_end: normalizeDateTime(form.contract_end),
        document_submit_start: normalizeDateTime(form.document_submit_start),
        document_submit_end: normalizeDateTime(form.document_submit_end),
      };

      let useSiteId = siteId;
      let usedLocal = false;

      try {
        if (!useSiteId) {
          try {
            const latest = await sitesApi.list();
            if (latest.data.length > 0) {
              useSiteId = latest.data[0].id;
              setSites(latest.data);
              setSiteId(useSiteId);
              setSitesError(null);
            }
          } catch (e) {
            if (isNetworkError(e)) throw e;
          }

          if (!useSiteId) {
            const created = await sitesApi.create({
              name: form.title.trim(),
              address: "미입력",
              total_units: 0,
            });
            useSiteId = (created.data as { id: number }).id;
            reloadSites().catch(() => {});
          }
        }

        await api.post("/announcements/", {
          site_id: useSiteId,
          ...annPayload,
          eligibility_rules: eligibilityRules,
          status: "published",
        });
      } catch (backendErr: any) {
        if (!isNetworkError(backendErr)) throw backendErr;

        usedLocal = true;
        let localSiteId = useSiteId;
        if (!localSiteId) {
          const existing = localSites.list();
          if (existing.length > 0) {
            localSiteId = existing[0].id;
          } else {
            const s = localSites.create({ name: form.title.trim() });
            localSiteId = s.id;
          }
          setSites(localSites.list());
          setSiteId(localSiteId);
          setSitesError(null);
        }
        localAnnouncements.create({
          site_id: localSiteId,
          ...annPayload,
          eligibility_rules: eligibilityRules,
          status: "published",
        });
      }

      setShowForm(false);
      setPdfFilled([]);
      setForm({ title: "", announcement_no: "", application_start: "", application_end: "", winner_announce_date: "", document_submit_start: "", document_submit_end: "", contract_start: "", contract_end: "", rules: { ...DEFAULT_RULES }, regionInput: "" });
      loadAnnouncements();
    } catch (err: any) {
      console.error("[announcements] create failed", err);
      const detail =
        err?.response?.data?.detail ||
        (Array.isArray(err?.response?.data) ? JSON.stringify(err.response.data) : null) ||
        err?.message ||
        "등록 실패";
      setFormError(typeof detail === "string" ? detail : JSON.stringify(detail));
    } finally {
      setSubmitting(false);
    }
  };

  const addRegion = () => {
    if (!form.regionInput.trim()) return;
    setForm((p) => ({ ...p, rules: { ...p.rules, region_priority: [...p.rules.region_priority, p.regionInput.trim()] }, regionInput: "" }));
  };

  const removeRegion = (i: number) => {
    setForm((p) => ({ ...p, rules: { ...p.rules, region_priority: p.rules.region_priority.filter((_, idx) => idx !== i) } }));
  };

  /** PDF 업로드 → 서버 Core 파싱 → 폼 자동 채우기 + 원본 Blob 백업 */
  const handlePdfUpload = async (file: File) => {
    setPdfParsing(true);
    setPdfFilled([]);
    setExtendedFilled([]);
    setLastPdfFile(file);
    try {
      // 원본 파일을 Blob에 저장(실패해도 무시) — 결과 URL을 폼에 기록
      const blobFd = new FormData();
      blobFd.append("file", file);
      blobFd.append("kind", "announcement");
      fetch("/api/files/upload", { method: "POST", body: blobFd })
        .then((r) => r.ok ? r.json() : null)
        .then((j) => {
          if (j?.url) {
            setForm((p) => ({ ...p, rules: { ...p.rules, original_file_url: j.url, original_file_name: j.filename } }));
          }
        })
        .catch(() => { /* Blob 실패 무시 */ });

      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-announcement-pdf", { method: "POST", body: fd });
      // Vercel 함수 타임아웃/크래시 시 본문이 JSON이 아닐 수 있음 → 방어적 파싱
      const raw = await res.text();
      let json: any = null;
      try { json = JSON.parse(raw); } catch { /* plain-text error */ }
      if (!res.ok || !json?.success) {
        const snippet = (raw || "").slice(0, 200).trim();
        const reason = json?.error
          || (snippet.startsWith("{") ? "파싱 실패" : `서버 오류(${res.status}): ${snippet || "응답 없음"}`);
        throw new Error(reason);
      }
      const d = json.data as Record<string, any>;
      // HTML datetime-local 입력은 'YYYY-MM-DDTHH:mm' 정확히 요구.
      // 파서가 ISO 8601 다양한 변형('YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm' 등)을 돌려줄 수 있으니 여기서 통일.
      const toDateInput = (raw: any): string => {
        if (!raw || typeof raw !== "string") return "";
        const s = raw.trim().replace(" ", "T");
        // 날짜만 있으면 기본 시간 00:00 붙임
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`;
        // HH:mm:ss면 초 제거
        const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
        return m ? m[1] : "";
      };
      const filled: string[] = [];
      setForm((p) => {
        const next = { ...p, rules: { ...p.rules } };
        if (d.title && !p.title) { next.title = d.title; filled.push("공고명"); }
        if (d.announcementNo && !p.announcement_no) { next.announcement_no = d.announcementNo; filled.push("공고번호"); }
        const appStart = toDateInput(d.applicationStart);
        const appEnd = toDateInput(d.applicationEnd);
        const winDate = toDateInput(d.winnerAnnounceDate);
        const cStart = toDateInput(d.contractStart);
        const cEnd = toDateInput(d.contractEnd);
        const dStart = toDateInput(d.docSubmitStart);
        const dEnd = toDateInput(d.docSubmitEnd);
        const spApply = toDateInput(d.specialApplyDate);
        const g1 = toDateInput(d.general1stDate);
        const g2 = toDateInput(d.general2ndDate);
        if (appStart && !p.application_start) { next.application_start = appStart; filled.push("청약 접수 시작일"); }
        if (appEnd && !p.application_end) { next.application_end = appEnd; filled.push("청약 접수 종료일"); }
        if (winDate && !p.winner_announce_date) { next.winner_announce_date = winDate; filled.push("당첨자 발표일"); }
        if (cStart && !p.contract_start) { next.contract_start = cStart; filled.push("계약 시작일"); }
        if (cEnd) { next.contract_end = cEnd; filled.push("계약 종료일"); }
        if (dStart && !p.document_submit_start) { next.document_submit_start = dStart; filled.push("서류접수 시작일"); }
        if (dEnd && !p.document_submit_end) { next.document_submit_end = dEnd; filled.push("서류접수 종료일"); }
        if (d.totalUnits) { next.rules.total_units = d.totalUnits; filled.push(`총 ${d.totalUnits}세대`); }
        if (typeof d.noHomeRequired === "boolean") { next.rules.no_home_required = d.noHomeRequired; filled.push("무주택 필수"); }
        if (d.minSubscriptionMonths) { next.rules.min_subscription_period = d.minSubscriptionMonths; filled.push("통장 납입 기간"); }
        if (Array.isArray(d.specialTypes) && d.specialTypes.length > 0) { next.rules.special_supply_types = d.specialTypes; filled.push(`특별공급(${d.specialTypes.length}종)`); }
        if (d.region) {
          next.rules.region_full = d.region; // 전체 주소 저장
          if (p.rules.region_priority.length === 0) {
            const firstRegion = d.region.split(/\s+/)[0];
            if (firstRegion) { next.rules.region_priority = [firstRegion]; filled.push("지역 우선순위"); }
          }
        }
        // ── LLM 확장 필드 저장 ──
        if (d.supplyTypes && Array.isArray(d.supplyTypes) && d.supplyTypes.length > 0) {
          next.rules.supply_types_detail = d.supplyTypes;
          filled.push(`공급유형 상세(${d.supplyTypes.length}종)`);
        }
        if (d.exclusiveAreas && Array.isArray(d.exclusiveAreas) && d.exclusiveAreas.length > 0) {
          next.rules.exclusive_areas = d.exclusiveAreas;
          filled.push(`전용면적(${d.exclusiveAreas.length}종)`);
        }
        if (d.requiredDocuments && typeof d.requiredDocuments === "object") {
          next.rules.required_documents = d.requiredDocuments;
          filled.push("제출서류 목록");
        }
        if (d.incomeTable && typeof d.incomeTable === "object") {
          next.rules.income_table = d.incomeTable;
          filled.push("소득기준표");
        }
        if (d.assetLimit) { next.rules.asset_limit = d.assetLimit; filled.push("자산한도"); }
        if (d.carValueLimit) { next.rules.car_value_limit = d.carValueLimit; filled.push("자동차가액 한도"); }
        // ── 규제 + 제한 + 일정 필드 저장 ──
        if (d.resaleRestriction) { next.rules.resale_restriction = d.resaleRestriction; filled.push("전매제한"); }
        if (d.reWinRestriction) { next.rules.rewin_restriction = d.reWinRestriction; filled.push("재당첨제한"); }
        if (d.residenceObligation) { next.rules.residence_obligation = d.residenceObligation; filled.push("거주의무"); }
        if (typeof d.priceCapApplied === "boolean") { next.rules.price_cap_applied = d.priceCapApplied; filled.push("분양가상한제"); }
        if (d.landType) { next.rules.land_type = d.landType; filled.push("택지유형"); }
        if (d.moveInDate) { next.rules.move_in_date = d.moveInDate; filled.push("입주예정"); }
        if (d.pointSystemRatio) { next.rules.point_system = d.pointSystemRatio; filled.push("가점제/추첨제"); }
        if (d.announcementDate) { next.rules.announcement_date = toDateInput(d.announcementDate); }
        if (spApply) { next.rules.special_apply_date = spApply; filled.push("특별공급 접수일"); }
        if (g1) { next.rules.general_1st_date = g1; filled.push("일반 1순위"); }
        if (g2) { next.rules.general_2nd_date = g2; filled.push("일반 2순위"); }
        return next;
      });
      // 엔진별 성공 여부 배지
      if (Array.isArray(json.engines)) {
        const activeEngines = json.engines.filter((e: any) => e.error !== "disabled");
        const successEngines = activeEngines.filter((e: any) => e.success).map((e: any) => e.engine);
        if (successEngines.length > 0) {
          filled.push(`🤖 ${successEngines.join(" + ")} 추출 성공`);
        }
        const failedEngines = json.engines.filter((e: any) => !e.success && e.error !== "skipped" && e.error !== "disabled");
        for (const f of failedEngines) {
          filled.push(`⚠️ ${f.engine} 실패: ${(f.error || "").slice(0, 40)}`);
        }
      } else if (json.llmUsed) {
        filled.push("✅ AI 분석 완료");
      } else {
        filled.push("⚠️ 기본 파싱만 적용");
      }
      if (json.groqFallback) filled.push("↩️ Groq 폴백 사용됨");
      if (json.claudeVerified) filled.push("🔒 Claude 최종 검증 완료");
      // 신뢰도 요약 — 추출 대상(Core 필드만) 기준. unknown은 "해당 없음"으로 별도 표시.
      if (json.confidence && typeof json.confidence === "object") {
        const conf = json.confidence as Record<string, string>;
        const counts: Record<string, number> = { high: 0, med: 0, low: 0, unknown: 0 };
        for (const v of Object.values(conf)) counts[v] = (counts[v] || 0) + 1;
        const extracted = counts.high + counts.med + counts.low;
        const total = extracted + counts.unknown;
        filled.push(`📊 추출 ${extracted}/${total} — 高 ${counts.high} · 中 ${counts.med} · 低 ${counts.low}${counts.unknown > 0 ? ` · 해당없음 ${counts.unknown}` : ""}`);
      }
      setPdfFilled(filled);
    } catch (err: any) {
      alert(err.message || "PDF 파싱 실패");
    } finally {
      setPdfParsing(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  /** 고급 분석: Phase A 확장 필드 추출 — 마지막 업로드한 PDF 재사용 */
  const handleExtendedAnalyze = async () => {
    if (!lastPdfFile) {
      alert("먼저 PDF를 업로드하세요.");
      return;
    }
    setExtendedParsing(true);
    setExtendedFilled([]);
    try {
      const fd = new FormData();
      fd.append("file", lastPdfFile);
      const res = await fetch("/api/parse-announcement-pdf/extended", { method: "POST", body: fd });
      const raw = await res.text();
      let json: any = null;
      try { json = JSON.parse(raw); } catch { /* plain-text */ }
      if (!res.ok || !json?.success) {
        const snippet = (raw || "").slice(0, 200).trim();
        const reason = json?.error
          || (snippet.startsWith("{") ? "고급 분석 실패" : `서버 오류(${res.status}): ${snippet || "응답 없음"}`);
        throw new Error(reason);
      }
      const d = (json.data || {}) as Record<string, any>;
      const filled: string[] = [];
      // 확장 필드를 rules 객체에 저장 (현재 폼 구조와 느슨하게 결합)
      setForm((p) => {
        const next = { ...p, rules: { ...p.rules } as any };
        const put = (key: string, label: string, val: any) => {
          if (val === null || val === undefined || val === "") return;
          if (Array.isArray(val) && val.length === 0) return;
          next.rules[key] = val;
          filled.push(label);
        };
        put("housing_management_no", "주택관리번호", d.housingManagementNo);
        put("approval_no", "승인번호", d.approvalNo);
        put("developer", "사업주체", d.developer);
        put("builder", "시공사", d.builder);
        put("location_address", "공급위치", d.locationAddress);
        put("announcement_base_date", "공고기준일", d.announcementBaseDate);
        put("general_total_units", "일반공급 세대수", d.generalTotalUnits);
        put("special_total_units", "특별공급 세대수", d.specialTotalUnits);
        put("lowest_floor_priority_units", "최하층 우선배정", d.lowestFloorPriorityUnits);
        put("min_age", "최소나이", d.minAge);
        put("minor_head_allowed", "미성년세대주", d.minorHeadAllowed);
        put("eligible_regions", "신청가능지역", d.eligibleRegions);
        put("foreigner_allowed", "외국인 가능", d.foreignerAllowed);
        put("regional_priority", `지역우선공급(${(d.regionalPriority || []).length}행)`, d.regionalPriority);
        put("subscription_deposits", `청약예치금(${(d.subscriptionDeposits || []).length}행)`, d.subscriptionDeposits);
        put("rank1_criteria", "1순위 요건", d.rank1Criteria);
        put("rank2_criteria", "2순위 요건", d.rank2Criteria);
        put("household_head_required", "세대주 요건", d.householdHeadRequired);
        put("homeless_household_required", "무주택세대구성원", d.homelessHouseholdRequired);
        put("single_home_owner_rank1_allowed", "1주택자 1순위", d.singleHomeOwnerRank1Allowed);
        put("point_lottery_ratios", `가점/추첨(${(d.pointLotteryRatios || []).length}행)`, d.pointLotteryRatios);
        put("required_documents_detailed", `서류상세(${(d.requiredDocumentsDetailed || []).length}건)`, d.requiredDocumentsDetailed);
        put("duplicate_application_rule", "중복청약 규칙", d.duplicateApplicationRule);
        put("passbook_reuse_blocked", "통장 재사용 불가", d.passbookReuseBlocked);
        put("long_term_overseas_restriction", "해외체류 제한", d.longTermOverseasRestriction);
        return next;
      });
      if (filled.length === 0) filled.push("확장 필드 추출 결과 없음");
      filled.unshift(`⏱️ ${Math.round((json.durationMs || 0) / 100) / 10}s 소요`);
      setExtendedFilled(filled);
    } catch (err: any) {
      alert(err.message || "고급 분석 실패");
    } finally {
      setExtendedParsing(false);
    }
  };

  // ── 탭별 필터 ──
  const activeAnns = announcements.filter((a) => !isDone(a));
  const doneAnns = announcements.filter((a) => isDone(a));
  const visibleAnns = tab === "active" ? activeAnns : doneAnns;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">모집공고 관리</h1>
          <p className="text-sm text-ink-3 mt-1">
            등록한 공고는 자동으로 공고 비교 · 고객 관리 · 서류 검수 · 당첨자 · 방문 계약에 연동됩니다
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> 공고 등록
        </button>
      </div>

      {sitesError && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {sitesError}
        </div>
      )}

      {/* 진행 중 / 완료 탭 */}
      <div className="flex gap-1 mb-5 bg-surface2 rounded-lg p-1">
        {([
          { key: "active" as TabKey, label: "진행 중", count: activeAnns.length },
          { key: "done" as TabKey, label: "완료", count: doneAnns.length },
        ]).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex-1 ${
              tab === key
                ? "bg-white text-accent shadow-sm"
                : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              tab === key ? "bg-accent-soft text-accent" : "bg-gray-200 text-ink-3"
            }`}>{count}</span>
          </button>
        ))}
      </div>

      {/* 공고 목록 */}
      {loading ? (
        <div className="card text-center py-10 text-ink-4">불러오는 중...</div>
      ) : visibleAnns.length === 0 ? (
        <div className="card text-center py-16 text-ink-4">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{tab === "active" ? "진행 중인 공고가 없습니다" : "완료된 공고가 없습니다"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleAnns.map((ann) => {
            const isSample = !!(ann as any)._isSample;
            const linkHref = `/announcements/${ann.id}`;
            const regulation = (ann as any)._regulation || (ann as any).eligibility_rules?.regulation || null;
            const location = (ann as any)._location || null;
            const totalUnits = (ann as any)._totalUnits || 0;
            const docSubmit = (ann as any)._docSubmit || null;
            const contractDate = (ann as any)._contract || null;

            return (
            <div
              key={ann.id}
              className="card hover:shadow-md hover:border-blue-300 transition-all group border-l-4 border-l-blue-200"
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <a
                  href={linkHref}
                  className="flex items-center gap-3 min-w-0 flex-1"
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                    tab === "done" ? "bg-surface2 group-hover:bg-gray-200" : "bg-accent-soft group-hover:bg-accent-soft"
                  }`}>
                    <BookOpen className={`w-5 h-5 ${tab === "done" ? "text-ink-4" : "text-blue-500"}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink truncate">{ann.title}</span>
                      {regulation && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          regulation === "투기과열" ? "bg-red-100 text-red-700"
                          : regulation === "청약과열" ? "bg-orange-100 text-orange-700"
                          : "bg-green-100 text-green-700"
                        }`}>{regulation}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-ink-4 mt-0.5 flex-wrap">
                      {location && (
                        <span className="text-ink-3">{location}</span>
                      )}
                      {totalUnits > 0 && (
                        <span>{totalUnits}세대</span>
                      )}
                      {docSubmit && (
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3" /> 서류 {docSubmit}
                        </span>
                      )}
                      {contractDate && (
                        <span className="flex items-center gap-1">
                          <PenTool className="w-3 h-3" /> 계약 {contractDate}
                        </span>
                      )}
                      {!docSubmit && ann.application_start && (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          {new Date(ann.application_start).toLocaleDateString("ko-KR")}
                        </span>
                      )}
                      {tab === "done" && (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="w-3 h-3" /> 완료
                        </span>
                      )}
                    </div>
                  </div>
                </a>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(ann); }}
                    disabled={deleting === ann.id}
                    className="p-2 rounded-lg text-ink-4 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                    title="삭제"
                  >
                    {deleting === ann.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                  <a href={linkHref} className="flex-shrink-0">
                    <ChevronRight className="w-4 h-4 text-ink-4 group-hover:text-blue-500 transition-colors" />
                  </a>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* 공고 등록 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-border-soft sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-lg font-semibold">모집공고 등록</h2>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-5">
              {/* PDF 자동 입력 */}
              <div className="rounded-lg border border-dashed border-blue-300 bg-accent-soft/50 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center flex-shrink-0">
                    <FileUp className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-accent">공고 PDF 자동 입력</div>
                    <p className="text-xs text-accent mt-0.5 mb-2">
                      입주자모집공고문 PDF를 업로드하면 제목·번호·일정·자격 기준을 자동으로 채워넣습니다.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pdfParsing}
                        onClick={() => pdfInputRef.current?.click()}
                        className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
                      >
                        {pdfParsing ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> 분석 중…</>
                        ) : (
                          <><FileUp className="w-3 h-3" /> PDF 선택</>
                        )}
                      </button>
                      {pdfFilled.length > 0 && !pdfParsing && (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700">
                          <CheckCircle2 className="w-3 h-3" />
                          {pdfFilled.length}개 항목 자동 입력됨
                        </span>
                      )}
                      {/* 고급 분석 — 기본 업로드 이후에만 노출 */}
                      {lastPdfFile && !pdfParsing && (
                        <button
                          type="button"
                          disabled={extendedParsing}
                          onClick={handleExtendedAnalyze}
                          className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
                          title="주택관리번호·사업주체·지역우선공급·예치금표·가점추첨비율 등 Phase A 확장 필드 추가 추출"
                        >
                          {extendedParsing ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> 고급 분석 중…</>
                          ) : (
                            <>🔬 고급 분석</>
                          )}
                        </button>
                      )}
                    </div>
                    {pdfFilled.length > 0 && !pdfParsing && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {pdfFilled.map((f) => (
                          <span key={f} className="inline-block text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{f}</span>
                        ))}
                      </div>
                    )}
                    {extendedFilled.length > 0 && !extendedParsing && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <span className="inline-block text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-semibold">고급</span>
                        {extendedFilled.map((f) => (
                          <span key={f} className="inline-block text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">{f}</span>
                        ))}
                      </div>
                    )}
                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handlePdfUpload(f);
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* 기본 정보 */}
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">공고명 *</label>
                <input required value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="예: 힐스테이트 광진 1차 모집공고"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">공고번호 (부동산원)</label>
                <input value={form.announcement_no} onChange={(e) => setForm((p) => ({ ...p, announcement_no: e.target.value }))}
                  placeholder="예: 2026-서울-0001"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>

              {/* 일정 */}
              <div className="space-y-5">
                {/* 청약 접수 시작일 — 특별/일반1/일반2 분리 */}
                <div>
                  <div className="text-sm font-medium text-ink-2 mb-2">청약 접수 시작일</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-ink-3 mb-1">특별공급</label>
                      <input type="datetime-local"
                        value={form.rules.special_apply_date}
                        onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, special_apply_date: e.target.value } }))}
                        className="w-full border border-border rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-3 mb-1">일반 1순위</label>
                      <input type="datetime-local"
                        value={form.rules.general_1st_date}
                        onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, general_1st_date: e.target.value } }))}
                        className="w-full border border-border rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-3 mb-1">일반 2순위</label>
                      <input type="datetime-local"
                        value={form.rules.general_2nd_date}
                        onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, general_2nd_date: e.target.value } }))}
                        className="w-full border border-border rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
                    </div>
                  </div>
                </div>

                {/* 당첨자 발표 날짜 */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">당첨자 발표 날짜</label>
                  <input type="datetime-local"
                    value={form.winner_announce_date}
                    onChange={(e) => setForm((p) => ({ ...p, winner_announce_date: e.target.value }))}
                    className="w-full max-w-sm border border-border rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>

                {/* 당첨자 서류접수 기간 */}
                <div>
                  <div className="text-sm font-medium text-ink-2 mb-2">당첨자 서류접수 기간</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-ink-3 mb-1">시작</label>
                      <input type="datetime-local"
                        value={form.document_submit_start}
                        onChange={(e) => setForm((p) => ({ ...p, document_submit_start: e.target.value }))}
                        className="w-full border border-border rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-3 mb-1">종료</label>
                      <input type="datetime-local"
                        value={form.document_submit_end}
                        onChange={(e) => setForm((p) => ({ ...p, document_submit_end: e.target.value }))}
                        className="w-full border border-border rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
                    </div>
                  </div>
                </div>

                {/* 계약체결 기간 */}
                <div>
                  <div className="text-sm font-medium text-ink-2 mb-2">계약체결 기간</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-ink-3 mb-1">시작</label>
                      <input type="datetime-local"
                        value={form.contract_start}
                        onChange={(e) => setForm((p) => ({ ...p, contract_start: e.target.value }))}
                        className="w-full border border-border rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-3 mb-1">종료</label>
                      <input type="datetime-local"
                        value={form.contract_end}
                        onChange={(e) => setForm((p) => ({ ...p, contract_end: e.target.value }))}
                        className="w-full border border-border rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
                    </div>
                  </div>
                </div>
              </div>

              {/* 자격 기준 */}
              <div className="border border-border rounded-lg p-4 space-y-4">
                <h3 className="font-medium text-ink">청약 자격 기준</h3>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.rules.no_home_required}
                    onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, no_home_required: e.target.checked } }))} />
                  무주택 필수
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-ink-2 mb-1">최소 거주기간 (개월)</label>
                    <input type="number" min={0}
                      value={form.rules.min_region_residence_months}
                      onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, min_region_residence_months: Number(e.target.value) } }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-2 mb-1">청약통장 최소 납입 (개월)</label>
                    <input type="number" min={0}
                      value={form.rules.min_subscription_period}
                      onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, min_subscription_period: Number(e.target.value) } }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-2 mb-1">소득 상한 (월, 원)</label>
                    <input type="number" min={0}
                      value={form.rules.income_limit}
                      onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, income_limit: e.target.value } }))}
                      placeholder="미설정 시 제한 없음"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                </div>

                {/* 지역 우선순위 */}
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">지역 우선순위</label>
                  <div className="flex gap-2 mb-2">
                    <input value={form.regionInput}
                      onChange={(e) => setForm((p) => ({ ...p, regionInput: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRegion())}
                      placeholder="예: 서울특별시"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                    <button type="button" onClick={addRegion} className="btn-secondary text-sm px-3">추가</button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {form.rules.region_priority.map((r, i) => (
                      <span key={i} className="inline-flex items-center gap-1 bg-accent-soft text-accent text-xs px-2 py-1 rounded-full">
                        {r}
                        <button type="button" onClick={() => removeRegion(i)} className="hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Phase D — 상세 설정 토글 */}
              <button
                type="button"
                onClick={() => setAdvancedMode((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 border border-dashed border-accent/50 rounded-lg bg-accent-soft/30 hover:bg-accent-soft/50 transition-colors text-sm font-medium text-accent"
              >
                <span className="flex items-center gap-2">
                  ⚙️ 상세 설정 (Phase A 확장 필드)
                  {advancedMode ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
                <span className="text-xs text-accent/70">
                  {advancedMode ? "접기" : "공고 메타·자격 상세·규제 상세 수동 편집"}
                </span>
              </button>

              {advancedMode && (
                <div className="space-y-4">
                  {/* 8.1 공고 메타 */}
                  <div className="border border-border rounded-lg p-4 space-y-3">
                    <h3 className="font-medium text-ink text-sm">공고 메타</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">주택관리번호</label>
                        <input value={(form.rules as any).housing_management_no || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, housing_management_no: e.target.value } as any }))}
                          placeholder="예: 2026000049"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">승인번호</label>
                        <input value={(form.rules as any).approval_no || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, approval_no: e.target.value } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">사업주체</label>
                        <input value={(form.rules as any).developer || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, developer: e.target.value } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">시공사</label>
                        <input value={(form.rules as any).builder || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, builder: e.target.value } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-ink-2 mb-1">공급위치 (지번 포함)</label>
                        <input value={(form.rules as any).location_address || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, location_address: e.target.value } as any }))}
                          placeholder="예: 경기도 양주시 옥정동 962-9"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-ink-2 mb-1">공고 기준일 (자격 판정)</label>
                        <input type="datetime-local"
                          value={(form.rules as any).announcement_base_date || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, announcement_base_date: e.target.value } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                    </div>
                  </div>

                  {/* 8.2 세대수 구성 */}
                  <div className="border border-border rounded-lg p-4 space-y-3">
                    <h3 className="font-medium text-ink text-sm">세대수 구성</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">일반공급 세대수</label>
                        <input type="number" min={0}
                          value={(form.rules as any).general_total_units ?? ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, general_total_units: e.target.value === "" ? null : Number(e.target.value) } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">특별공급 세대수</label>
                        <input type="number" min={0}
                          value={(form.rules as any).special_total_units ?? ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, special_total_units: e.target.value === "" ? null : Number(e.target.value) } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">최하층 우선배정</label>
                        <input type="number" min={0}
                          value={(form.rules as any).lowest_floor_priority_units ?? ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, lowest_floor_priority_units: e.target.value === "" ? null : Number(e.target.value) } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                    </div>
                  </div>

                  {/* 8.4 자격 상세 */}
                  <div className="border border-border rounded-lg p-4 space-y-3">
                    <h3 className="font-medium text-ink text-sm">신청 자격 상세</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">최소 나이 (만)</label>
                        <input type="number" min={0} max={99}
                          value={(form.rules as any).min_age ?? ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, min_age: e.target.value === "" ? null : Number(e.target.value) } as any }))}
                          placeholder="예: 19"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div className="flex flex-col gap-1.5 pt-4">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={!!(form.rules as any).minor_head_allowed}
                            onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, minor_head_allowed: e.target.checked } as any }))} />
                          세대주인 미성년자 허용
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={!!(form.rules as any).foreigner_allowed}
                            onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, foreigner_allowed: e.target.checked } as any }))} />
                          외국인/재외동포 가능
                        </label>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer border border-border rounded-lg px-3 py-2">
                        <input type="checkbox" checked={!!(form.rules as any).household_head_required}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, household_head_required: e.target.checked } as any }))} />
                        <span>세대주 필수</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer border border-border rounded-lg px-3 py-2">
                        <input type="checkbox" checked={!!(form.rules as any).homeless_household_required}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, homeless_household_required: e.target.checked } as any }))} />
                        <span>무주택세대 필수</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer border border-border rounded-lg px-3 py-2">
                        <input type="checkbox" checked={!!(form.rules as any).single_home_owner_rank1_allowed}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, single_home_owner_rank1_allowed: e.target.checked } as any }))} />
                        <span>1주택자 1순위 가능</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">1순위 요건 요약</label>
                        <textarea rows={2}
                          value={(form.rules as any).rank1_criteria || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, rank1_criteria: e.target.value } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">2순위 요건 요약</label>
                        <textarea rows={2}
                          value={(form.rules as any).rank2_criteria || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, rank2_criteria: e.target.value } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" />
                      </div>
                    </div>
                  </div>

                  {/* 8.5 규제 상세 */}
                  <div className="border border-border rounded-lg p-4 space-y-3">
                    <h3 className="font-medium text-ink text-sm">규제·제한 상세</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">전매제한 기간</label>
                        <input value={(form.rules as any).resale_restriction || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, resale_restriction: e.target.value } as any }))}
                          placeholder="예: 3년 또는 '없음'"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">재당첨 제한</label>
                        <input value={(form.rules as any).rewin_restriction || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, rewin_restriction: e.target.value } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-2 mb-1">거주의무 기간</label>
                        <input value={(form.rules as any).residence_obligation || ""}
                          onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, residence_obligation: e.target.value } as any }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                      <div className="flex items-center gap-3 pt-4">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={!!(form.rules as any).price_cap_applied}
                            onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, price_cap_applied: e.target.checked } as any }))} />
                          분양가 상한제
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={!!(form.rules as any).passbook_reuse_blocked}
                            onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, passbook_reuse_blocked: e.target.checked } as any }))} />
                          통장 재사용 불가
                        </label>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-2 mb-1">중복청약 규칙</label>
                      <textarea rows={2}
                        value={(form.rules as any).duplicate_application_rule || ""}
                        onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, duplicate_application_rule: e.target.value } as any }))}
                        placeholder="예: 1인 1건, 세대 내 중복 시 전원 무효"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-2 mb-1">장기 해외체류 제한</label>
                      <textarea rows={2}
                        value={(form.rules as any).long_term_overseas_restriction || ""}
                        onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, long_term_overseas_restriction: e.target.value } as any }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" />
                    </div>
                  </div>

                  {/* 고급 분석 자동 추출 배열 미리보기 — 읽기전용 */}
                  {(() => {
                    const r = form.rules as any;
                    const rows: Array<{ key: string; label: string; count: number }> = [
                      { key: "regional_priority", label: "지역 우선공급", count: (r.regional_priority || []).length },
                      { key: "subscription_deposits", label: "청약예치금", count: (r.subscription_deposits || []).length },
                      { key: "point_lottery_ratios", label: "가점/추첨 비율", count: (r.point_lottery_ratios || []).length },
                      { key: "required_documents_detailed", label: "서류 상세", count: (r.required_documents_detailed || []).length },
                      { key: "supply_types_detail", label: "공급유형 상세", count: (r.supply_types_detail || []).length },
                      { key: "exclusive_areas", label: "주택형 상세", count: (r.exclusive_areas || []).length },
                    ];
                    const has = rows.some((x) => x.count > 0);
                    if (!has) return null;
                    return (
                      <div className="border border-indigo-200 bg-indigo-50/50 rounded-lg p-4 space-y-2">
                        <h3 className="font-medium text-indigo-800 text-sm flex items-center gap-2">
                          🤖 자동 추출된 상세 데이터 (읽기전용)
                        </h3>
                        <p className="text-xs text-indigo-700">
                          아래는 PDF 업로드·고급 분석으로 자동 추출된 배열 데이터입니다. 수정이 필요하면 PDF를 다시 업로드하세요.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {rows.filter((x) => x.count > 0).map((x) => (
                            <span key={x.key} className="inline-flex items-center gap-1.5 text-xs bg-white border border-indigo-200 text-indigo-700 px-2.5 py-1 rounded-full">
                              {x.label}
                              <span className="inline-block bg-indigo-100 text-indigo-700 px-1.5 rounded font-semibold">{x.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {formError}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setFormError(null); }}
                  disabled={submitting}
                  className="btn-secondary flex-1 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /> 등록 중…</>) : "등록"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
