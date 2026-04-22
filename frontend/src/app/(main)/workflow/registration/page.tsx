"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { customersApi, api } from "@/lib/api";
import { pullAll } from "@/lib/cloud-sync";
import { useRealtimeSync } from "@/lib/realtime/useRealtimeSync";
import {
  localAnnouncements,
  localCustomers,
  activeAnnouncement,
  isNetworkError,
  LocalAnnouncement,
  LocalCustomer,
} from "@/lib/local-store";
import {
  UserPlus, Search, ChevronRight, Calculator, FileText, FileSpreadsheet,
  Loader2, BookOpen, X, Trash2, Upload,
} from "lucide-react";
import AnnouncementPicker from "@/components/AnnouncementPicker";
import { getSampleAsLocalAnnouncements } from "@/lib/sample-adapter";
import { classifyIncoming, formatValue, IncomingCustomer, CustomerConflict } from "@/lib/customer-dedup";

interface Customer {
  id: number;
  name: string;
  phone: string;
  total_score: number;
  status: string;
  special_types?: string[];
  supply_type?: string;
  unit_type?: string;
  unit_area?: string;
  verification_verdict?: "eligible" | "ineligible" | "pending";
  is_standby?: boolean;
  standby_rank?: string;
  superseded?: boolean;
  succeeded_from?: number;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  inquiry:    { label: "문의",    cls: "badge-pending" },
  applied:    { label: "청약 접수", cls: "badge-review" },
  winner:     { label: "당첨",    cls: "bg-purple-100 text-purple-700 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" },
  contracted: { label: "계약 완료", cls: "badge-eligible" },
};

/** 공고 PDF 파싱 결과에 `special_supply_types`가 없으면 전체 목록 노출 */
const DEFAULT_SPECIAL_TYPES = ["신혼부부", "생애최초", "다자녀", "노부모부양", "기관추천"];

function CustomersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryAnnId = searchParams.get("announcementId");

  // ─── 공고 상태 ─────────────────────────────────────────
  const [announcements, setAnnouncements] = useState<LocalAnnouncement[]>([]);
  const [selectedAnn, setSelectedAnn] = useState<LocalAnnouncement | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // 신규 고객 폼
  const [form, setForm] = useState({
    name: "", rrn_front: "", rrn_back: "", phone: "", address: "",
    no_home_years: 0, dependents_count: 0, subscription_months: 0,
    current_region: "", income_monthly: "",
    special_types: [] as string[],
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [excelUploading, setExcelUploading] = useState(false);
  const [excelResult, setExcelResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);

  // PDF 업로드 (주민등록등본 등 → 고객 정보 자동 추출)
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfFilled, setPdfFilled] = useState<string[]>([]);

  // 선택 삭제 모드
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 업로드 dedup 결과 (충돌 확인 모달)
  const [conflicts, setConflicts] = useState<CustomerConflict[]>([]);
  const [conflictDecisions, setConflictDecisions] = useState<Record<number, "update" | "keep">>({});

  // 리스트 탭: 당첨자 / 예비 / 전체
  const [listTab, setListTab] = useState<"winners" | "standbys" | "all">("winners");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [supplyFilter, setSupplyFilter] = useState<string>("all");

  // ─── 공고 목록 로딩 ────────────────────────────────────
  const loadAnnouncements = useCallback(async () => {
    const local = localAnnouncements.listAll();
    const samples = getSampleAsLocalAnnouncements();
    try {
      const r = await api.get(`/announcements/`);
      const backend = Array.isArray(r.data) ? r.data : [];
      const merged: LocalAnnouncement[] = [...backend];
      for (const l of local) {
        if (!merged.some((a: any) => a.id === l.id)) merged.push(l);
      }
      for (const s of samples) {
        if (!merged.some((a: any) => a.id === s.id)) merged.push(s);
      }
      setAnnouncements(merged);
      return merged;
    } catch {
      const combined = [...local, ...samples];
      setAnnouncements(combined);
      return combined;
    }
  }, []);

  // 초기: 공고 목록 + 쿼리파라미터/activeAnnouncement에서 선택 복원
  useEffect(() => {
    (async () => {
      const list = await loadAnnouncements();
      const active = activeAnnouncement.get();
      let target: LocalAnnouncement | null = null;
      if (queryAnnId) {
        target = list.find((a: LocalAnnouncement) => a.id === Number(queryAnnId)) || null;
      }
      if (!target && active) {
        target = list.find((a: LocalAnnouncement) => a.id === active.id) || (active.snapshot as LocalAnnouncement | null);
      }
      if (!target && list.length > 0) {
        target = list[0];
      }
      if (target) setSelectedAnn(target);
    })();
  }, [loadAnnouncements, queryAnnId]);

  // 선택된 공고가 바뀌면 activeAnnouncement 갱신
  useEffect(() => {
    if (selectedAnn) {
      activeAnnouncement.set(
        { id: selectedAnn.id, title: selectedAnn.title, announcement_no: selectedAnn.announcement_no },
        "local",
        selectedAnn,
      );
    }
  }, [selectedAnn]);

  // ─── 고객 목록 로딩 (공고 단위) ─────────────────────────
  const loadCustomers = useCallback(async () => {
    if (!selectedAnn) { setCustomers([]); return; }
    setLoading(true);
    try {
      // 백엔드에 공고별 고객 API가 있다면 사용, 없으면 site_id로 fallback
      let list: Customer[] = [];
      try {
        const r = await api.get(`/customers/announcement/${selectedAnn.id}`);
        list = r.data;
      } catch (e404: any) {
        if (e404?.response?.status === 404) {
          const r2 = await customersApi.list(selectedAnn.site_id);
          list = r2.data;
        } else {
          throw e404;
        }
      }
      setCustomers(list);
    } catch (err: any) {
      if (isNetworkError(err)) {
        const local = localCustomers.listByAnnouncement(selectedAnn.id);
        setCustomers(local.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "",
          total_score: c.total_score ?? 0,
          status: c.status ?? "inquiry",
          special_types: c.special_types,
          supply_type: c.supply_type,
          unit_type: c.unit_type,
          unit_area: c.unit_area,
          verification_verdict: c.verification_verdict,
          is_standby: c.is_standby,
          standby_rank: c.standby_rank,
          superseded: c.superseded,
          succeeded_from: c.succeeded_from,
        })));
      } else {
        console.error("[customers] load failed", err);
        setCustomers([]);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedAnn]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // 실시간: 다른 사용자 변경 시 자동 재동기·재조회
  useRealtimeSync({
    announcementId: selectedAnn?.id,
    onCustomerChange: async () => {
      await pullAll().catch(() => {});
      loadCustomers();
    },
    onFileUploaded: async () => {
      await pullAll().catch(() => {});
      loadCustomers();
    },
  });

  // ─── 공고별 특별공급 유형 (동적) ────────────────────────
  const specialTypeOptions: string[] = (() => {
    const raw = selectedAnn?.eligibility_rules?.special_supply_types;
    if (Array.isArray(raw) && raw.length > 0) return raw;
    return DEFAULT_SPECIAL_TYPES;
  })();

  // ─── 고객 등록 ────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedAnn) {
      setFormError("먼저 상단에서 공고를 선택해 주세요.");
      return;
    }
    if (!form.name.trim()) {
      setFormError("성명을 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        site_id: selectedAnn.site_id,
        announcement_id: selectedAnn.id,
        name: form.name.trim(),
        rrn_front: form.rrn_front,
        rrn_back: form.rrn_back,
        phone: form.phone,
        address: form.address,
        no_home_years: form.no_home_years,
        dependents_count: form.dependents_count,
        subscription_months: form.subscription_months,
        is_first_time_buyer: form.special_types.includes("생애최초"),
        is_newlywed: form.special_types.includes("신혼부부"),
        current_region: form.current_region,
        income_monthly: form.income_monthly ? Number(form.income_monthly) : null,
        special_types: form.special_types,
      };

      try {
        await customersApi.create(payload as any);
      } catch (backendErr: any) {
        if (!isNetworkError(backendErr)) throw backendErr;
        // 네트워크 에러 → 로컬 저장
        localCustomers.create({
          announcement_id: selectedAnn.id,
          site_id: selectedAnn.site_id,
          name: payload.name,
          rrn_front: payload.rrn_front,
          rrn_back: payload.rrn_back,
          phone: payload.phone,
          address: payload.address,
          no_home_years: payload.no_home_years,
          dependents_count: payload.dependents_count,
          subscription_months: payload.subscription_months,
          current_region: payload.current_region,
          income_monthly: payload.income_monthly,
          special_types: payload.special_types,
        });
      }

      setShowForm(false);
      setForm({
        name: "", rrn_front: "", rrn_back: "", phone: "", address: "",
        no_home_years: 0, dependents_count: 0, subscription_months: 0,
        current_region: "", income_monthly: "", special_types: [],
      });
      loadCustomers();
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        (Array.isArray(err?.response?.data) ? JSON.stringify(err.response.data) : null) ||
        err?.message || "등록 실패";
      setFormError(typeof detail === "string" ? detail : JSON.stringify(detail));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSpecial = (t: string) => {
    setForm((p) => ({
      ...p,
      special_types: p.special_types.includes(t)
        ? p.special_types.filter((x) => x !== t)
        : [...p.special_types, t],
    }));
  };

  const handleExcelUpload = async (file: File) => {
    if (!selectedAnn) { alert("먼저 공고를 선택해주세요"); return; }
    setExcelUploading(true);
    setExcelResult(null);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

      const pick = (row: Record<string, any>, ...keys: string[]): any => {
        for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k];
        return undefined;
      };
      const toNum = (v: any): number => {
        if (v === undefined || v === "" || v === null) return 0;
        const n = Number(String(v).replace(/[^\d.-]/g, ""));
        return Number.isFinite(n) ? n : 0;
      };
      const toStr = (v: any): string => (v === undefined || v === null ? "" : String(v).trim());

      // 1) 엑셀 행 → IncomingCustomer 후보 목록
      const candidates: IncomingCustomer[] = [];
      let parseFailed = 0;
      const parseErrors: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = toStr(pick(row, "성명", "이름", "name"));
        if (!name) { parseFailed++; parseErrors.push(`${i + 2}행: 성명 누락`); continue; }
        const rrnFront = toStr(pick(row, "주민번호앞", "rrn_front")).replace(/\D/g, "").slice(0, 6);
        const rrnBack = toStr(pick(row, "주민번호뒤", "rrn_back")).replace(/\D/g, "").slice(0, 7);
        if (!rrnFront || !rrnBack) { parseFailed++; parseErrors.push(`${i + 2}행(${name}): 주민번호 누락`); continue; }

        const specialRaw = toStr(pick(row, "특별공급", "special_types"));
        const special_types = specialRaw
          ? specialRaw.split(/[,·/]/).map((s) => s.trim()).filter(Boolean)
          : [];

        candidates.push({
          name,
          phone: toStr(pick(row, "연락처", "전화", "phone")),
          rrn_front: rrnFront,
          rrn_back: rrnBack,
          address: toStr(pick(row, "주소", "address")),
          no_home_years: toNum(pick(row, "무주택기간_년", "무주택년", "no_home_years")),
          dependents_count: toNum(pick(row, "부양가족수", "dependents_count")),
          subscription_months: toNum(pick(row, "통장개월", "subscription_months")),
          current_region: toStr(pick(row, "지역", "current_region")),
          income_monthly: (() => {
            const n = toNum(pick(row, "월소득_원", "월소득", "income_monthly"));
            return n > 0 ? n : null;
          })(),
          special_types,
          supply_type: special_types[0] || "일반공급",
        });
      }

      // 2) 기존 고객과 대조 → 신규/중복/충돌 분류
      const existing = localCustomers.listByAnnouncement(selectedAnn.id);
      const { toCreate, duplicates, conflicts: foundConflicts } = classifyIncoming(candidates, existing);

      // 3) 신규 고객만 즉시 등록 (배치는 로컬 저장만 — 백엔드 지연 회피)
      let created = 0, createFailed = 0;
      const createErrors: string[] = [];
      for (const c of toCreate) {
        try {
          const payload = {
            site_id: selectedAnn.site_id,
            announcement_id: selectedAnn.id,
            name: c.name,
            phone: c.phone || "",
            rrn_front: c.rrn_front || "",
            rrn_back: c.rrn_back || "",
            address: c.address || "",
            no_home_years: c.no_home_years ?? 0,
            dependents_count: c.dependents_count ?? 0,
            subscription_months: c.subscription_months ?? 0,
            current_region: c.current_region || "",
            income_monthly: c.income_monthly ?? null,
            special_types: c.special_types || [],
            supply_type: c.supply_type,
            unit_type: c.unit_type,
            unit_area: c.unit_area,
          };
          localCustomers.create(payload);
          created++;
        } catch (err: any) {
          createFailed++;
          const msg = err?.message || "등록 실패";
          createErrors.push(`${c.name}: ${msg}`);
        }
      }

      // 4) 결과 배너 + 충돌 검토 모달
      setExcelResult({
        success: created,
        failed: parseFailed + createFailed,
        errors: [...parseErrors, ...createErrors].slice(0, 10),
      });
      if (created > 0) loadCustomers();

      if (foundConflicts.length > 0) {
        setConflicts(foundConflicts);
        setConflictDecisions({});
      }
      if (duplicates.length > 0 && foundConflicts.length === 0 && created === 0) {
        alert(`모든 고객(${duplicates.length}명)이 이미 등록되어 있습니다.`);
      }
    } catch (err: any) {
      alert(err?.message || "엑셀 파일 파싱 실패");
    } finally {
      setExcelUploading(false);
    }
  };

  /** PDF 업로드 → 고객 정보 자동 추출. 단일 문서 / 당첨자 명단(배치) 둘 다 처리. */
  const handlePdfUpload = async (file: File) => {
    if (!selectedAnn) { alert("먼저 공고를 선택해주세요"); return; }
    setPdfUploading(true);
    setPdfFilled([]);
    setExcelResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-customer-pdf", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || "PDF 파싱 실패");
      const d = await res.json();

      // ── 배치 모드: 당첨자 명단 PDF ──
      if (d.mode === "batch" && Array.isArray(d.customers) && d.customers.length > 0) {
        const counts = d.counts || {};
        const breakdown =
          counts.spWin !== undefined
            ? `\n특별공급 당첨 ${counts.spWin}명 + 예비 ${counts.spStd}명`
              + `\n일반공급 당첨 ${counts.genWin}명 + 예비 ${counts.genStd}명`
            : "";
        const confirmMsg = `당첨자 명단 PDF에서 ${d.count}명을 인식했습니다.${breakdown}\n\n이미 등록된 사람은 제외하고 신규만 추가합니다. 계속하시겠습니까?`;
        if (!confirm(confirmMsg)) return;

        // 1) 파싱 결과 → IncomingCustomer
        const candidates: IncomingCustomer[] = [];
        let parseFailed = 0;
        const parseErrors: string[] = [];
        for (let i = 0; i < d.customers.length; i++) {
          const c = d.customers[i];
          if (!c.name || !c.rrnFront) {
            parseFailed++;
            parseErrors.push(`${i + 1}번: 필수 정보 부족`);
            continue;
          }
          const specialTypes = Array.isArray(c.specialTypes) ? c.specialTypes : [];
          const housingCode: string | undefined = c.housingType || c.unitType;
          let unitArea = c.unitArea as string | undefined;
          if (!unitArea && housingCode) {
            const m = housingCode.match(/^0?(\d{2,3})(?:\.(\d{2,4}))?/);
            if (m) {
              const whole = parseInt(m[1], 10);
              const frac = m[2] ? Number(`0.${m[2]}`) : 0;
              const area = whole + frac;
              unitArea = `${area.toFixed(2)}㎡`;
            }
          }
          // supply_type 결정: 예비는 상위 공급 구분 유지
          const supplyType =
            c.supplyCategory === "일반공급"
              ? "일반공급"
              : (specialTypes[0] || "일반공급");
          candidates.push({
            name: c.name,
            phone: c.phone || "",
            rrn_front: c.rrnFront,
            rrn_back: c.rrnBack || "0000000",
            special_types: specialTypes,
            supply_type: supplyType,
            unit_type: housingCode || undefined,
            unit_area: unitArea,
            is_standby: c.isStandby === true,
            standby_rank: c.standbyRank,
          });
        }

        // 2) dedup 분류
        const existing = localCustomers.listByAnnouncement(selectedAnn.id);
        const { toCreate, duplicates, conflicts: foundConflicts } = classifyIncoming(candidates, existing);

        // 3) 신규 등록 (로컬 저장 — PDF 배치는 고객 수가 많아 네트워크 왕복 회피)
        let created = 0, createFailed = 0;
        const createErrors: string[] = [];
        for (const cand of toCreate) {
          const anyCand = cand as any;
          const payload = {
            site_id: selectedAnn.site_id,
            announcement_id: selectedAnn.id,
            name: cand.name,
            phone: cand.phone || "",
            rrn_front: cand.rrn_front || "",
            rrn_back: cand.rrn_back || "0000000",
            address: "",
            no_home_years: 0,
            dependents_count: 0,
            subscription_months: 0,
            current_region: "",
            income_monthly: null,
            special_types: cand.special_types || [],
            supply_type: cand.supply_type,
            unit_type: cand.unit_type,
            unit_area: cand.unit_area,
            is_standby: anyCand.is_standby === true,
            standby_rank: anyCand.standby_rank,
          };
          try {
            localCustomers.create(payload);
            created++;
          } catch (err: any) {
            createFailed++;
            const msg = err?.message || "등록 실패";
            createErrors.push(`${cand.name}: ${msg}`);
          }
        }

        setExcelResult({
          success: created,
          failed: parseFailed + createFailed,
          errors: [...parseErrors, ...createErrors].slice(0, 10),
        });
        if (created > 0) loadCustomers();

        if (foundConflicts.length > 0) {
          setConflicts(foundConflicts);
          setConflictDecisions({});
        } else if (duplicates.length > 0 && created === 0) {
          alert(`모든 당첨자(${duplicates.length}명)가 이미 등록되어 있습니다.`);
        }
        return;
      }

      // ── 단일 모드: 주민등록등본 등 ──
      const filled: string[] = [];
      setForm((p) => {
        const next = { ...p };
        if (d.name) { next.name = d.name; filled.push("성명"); }
        if (d.rrnFront) { next.rrn_front = d.rrnFront; filled.push("주민번호 앞자리"); }
        if (d.rrnBack) { next.rrn_back = d.rrnBack; filled.push("주민번호 뒷자리"); }
        if (d.phone) { next.phone = d.phone; filled.push("연락처"); }
        if (d.address) { next.address = d.address; filled.push("주소"); }
        if (typeof d.dependentsCount === "number") { next.dependents_count = d.dependentsCount; filled.push("부양가족 수"); }
        if (typeof d.noHomeYears === "number") { next.no_home_years = d.noHomeYears; filled.push("무주택 기간"); }
        if (typeof d.subscriptionMonths === "number") { next.subscription_months = d.subscriptionMonths; filled.push("통장 가입 개월"); }
        if (d.currentRegion) { next.current_region = d.currentRegion; filled.push("거주 지역"); }
        if (Array.isArray(d.specialTypes) && d.specialTypes.length > 0) {
          next.special_types = d.specialTypes;
          filled.push(`특별공급(${d.specialTypes.length}종)`);
        }
        return next;
      });
      setPdfFilled(filled);
      setShowForm(true);
      if (filled.length === 0) {
        alert("PDF에서 인식된 정보가 없습니다. 수동으로 입력해주세요.");
      }
    } catch (err: any) {
      alert(err?.message || "PDF 파싱 실패");
    } finally {
      setPdfUploading(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  const winnersCount = customers.filter((c) => !c.is_standby).length;
  const standbysCount = customers.filter((c) => c.is_standby).length;

  const unitOptions = Array.from(
    new Set(customers.map((c) => c.unit_type).filter(Boolean) as string[]),
  ).sort();
  const supplyOptions = Array.from(
    new Set(customers.map((c) => c.supply_type).filter(Boolean) as string[]),
  ).sort();

  const filtered = customers.filter((c) => {
    // 탭 필터
    if (listTab === "winners" && c.is_standby) return false;
    if (listTab === "standbys" && !c.is_standby) return false;
    if (unitFilter !== "all" && (c.unit_type || "") !== unitFilter) return false;
    if (supplyFilter !== "all" && (c.supply_type || "") !== supplyFilter) return false;
    // 검색 필터
    const q = search.trim();
    if (!q) return true;
    return c.name.includes(q) || (c.phone || "").includes(q);
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* 단계 헤더 */}
      <div className="mb-5">
        <div className="flex items-center gap-2 text-xs text-ink-4 mb-1">
          <span>서류 검수 단계</span>
          <ChevronRight className="w-3 h-3" />
          <span>1 / 5</span>
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent text-white text-sm font-bold">
                1
              </span>
              당첨자 등록
            </h1>
            <p className="text-sm text-ink-3 mt-1 max-w-2xl">
              전산추첨결과·당첨자현황 PDF·예비입주자 명단 등 당첨자 원본 파일을 올려 이 공고에 등록합니다.
            </p>
          </div>
          {/* 다음 단계 */}
          <a
            href="/workflow/household"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-accent bg-accent-soft hover:bg-accent-soft transition-colors"
          >
            다음 단계 <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* ─── 공고 선택 배너 ───────────────────────────────── */}
      <AnnouncementPicker
        announcements={announcements as any}
        selected={selectedAnn as any}
        onSelect={(a) => setSelectedAnn(a as any)}
        onOpenDetail={(a) => router.push(`/announcements/${a.id}`)}
      />

      {/* 액션 바 */}
      <div className="mb-6">
        <div className="flex items-baseline gap-3 flex-wrap mb-4">
          <p className="text-sm text-ink-3">
            {selectedAnn ? `「${selectedAnn.title}」에 신청자/당첨자/예비 등록 · 관리` : "공고를 먼저 선택해주세요"}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* PDF 업로드 */}
          <button
            onClick={() => pdfInputRef.current?.click()}
            disabled={pdfUploading || excelUploading || !selectedAnn}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="당첨자현황 PDF 업로드"
          >
            {pdfUploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
            ) : (
              <><FileText className="w-4 h-4" /> PDF 업로드</>
            )}
          </button>
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePdfUpload(f);
              if (pdfInputRef.current) pdfInputRef.current.value = "";
            }}
          />

          {/* 엑셀 업로드 */}
          <button
            onClick={() => excelInputRef.current?.click()}
            disabled={pdfUploading || excelUploading || !selectedAnn}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="전산추첨결과 엑셀 업로드"
          >
            {excelUploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
            ) : (
              <><FileSpreadsheet className="w-4 h-4" /> 엑셀 업로드</>
            )}
          </button>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleExcelUpload(f);
              if (excelInputRef.current) excelInputRef.current.value = "";
            }}
          />

          <div className="w-px h-6 bg-border mx-1" />

          {/* 고객 등록 — 수동 폼 */}
          <button
            onClick={() => { setFormError(null); setShowForm(true); }}
            disabled={!selectedAnn}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-accent hover:bg-accent shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <UserPlus className="w-4 h-4" /> 고객 등록
          </button>

          {/* 삭제 — 선택 모드 토글 */}
          <button
            onClick={() => {
              setSelectMode((prev) => {
                if (prev) setSelectedIds(new Set());
                return !prev;
              });
            }}
            disabled={!selectedAnn || customers.length === 0}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              selectMode
                ? "bg-gray-700 text-white hover:bg-gray-800"
                : "text-red-600 hover:bg-red-50"
            }`}
          >
            <Trash2 className="w-4 h-4" />
            {selectMode ? "선택 취소" : "삭제"}
          </button>
        </div>
      </div>

      {/* 선택 삭제 바 */}
      {selectMode && (
        <div className="mb-4 flex items-center justify-between p-3 rounded-lg bg-red-50 border border-red-200">
          <div className="text-sm text-red-800">
            <strong>{selectedIds.size}명</strong> 선택됨
            {selectedIds.size === 0 && <span className="text-red-500 ml-2">— 삭제할 고객을 체크하세요</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (selectedIds.size === filtered.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(filtered.map((c) => c.id)));
                }
              }}
              className="text-xs text-red-700 hover:underline"
            >
              {selectedIds.size === filtered.length ? "전체 선택 해제" : "전체 선택"}
            </button>
            <button
              onClick={() => {
                if (selectedIds.size === 0) return;
                if (!confirm(`선택한 ${selectedIds.size}명의 고객을 삭제하시겠습니까?`)) return;
                Array.from(selectedIds).forEach((id) => localCustomers.remove(id));
                setSelectedIds(new Set());
                setSelectMode(false);
                loadCustomers();
              }}
              disabled={selectedIds.size === 0}
              className="px-3 py-1.5 rounded-md bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              선택 삭제 ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {/* 엑셀 업로드 결과 */}
      {excelResult && (
        <div className={`card mb-4 ${excelResult.failed === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink">엑셀 일괄 등록 결과</div>
              <div className="mt-1 text-sm text-ink-2">
                성공 <strong className="text-green-700">{excelResult.success}건</strong>
                {excelResult.failed > 0 && <> · 실패 <strong className="text-red-700">{excelResult.failed}건</strong></>}
              </div>
              {excelResult.errors.length > 0 && (
                <ul className="mt-2 text-xs text-red-700 space-y-0.5 list-disc list-inside">
                  {excelResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  {excelResult.failed > excelResult.errors.length && (
                    <li className="text-ink-3">…외 {excelResult.failed - excelResult.errors.length}건 더</li>
                  )}
                </ul>
              )}
            </div>
            <button onClick={() => setExcelResult(null)} className="text-ink-4 hover:text-ink-2 text-sm">×</button>
          </div>
        </div>
      )}

      {/* 당첨자 / 예비 / 전체 탭 + 검색 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="inline-flex rounded-lg bg-surface2 p-0.5">
          {[
            { key: "winners" as const, label: "당첨자", count: winnersCount },
            { key: "standbys" as const, label: "예비", count: standbysCount },
            { key: "all" as const, label: "전체", count: customers.length },
          ].map((t) => {
            const active = listTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setListTab(t.key);
                  setSelectedIds(new Set());
                }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  active
                    ? t.key === "standbys"
                      ? "bg-white text-amber-700 shadow-sm"
                      : "bg-white text-accent shadow-sm"
                    : "text-ink-2 hover:text-ink"
                }`}
              >
                {t.label}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  active
                    ? t.key === "standbys"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-accent-soft text-accent"
                    : "bg-border text-ink-2"
                }`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
        <select
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-border bg-white text-xs font-medium text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">주택형 전체</option>
          {unitOptions.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <select
          value={supplyFilter}
          onChange={(e) => setSupplyFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-border bg-white text-xs font-medium text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">공급유형 전체</option>
          {supplyOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-4" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 또는 연락처 검색"
            className="w-full pl-9 pr-4 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        {listTab === "standbys" && (
          <span className="text-xs text-amber-700 flex items-center gap-1">
            당첨자가 부적합·포기 시 이 목록에서 승계 후보를 선정합니다
          </span>
        )}
      </div>


      {/* 고객 목록 */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface2 border-b border-border-soft">
            <tr>
              {selectMode && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={() => {
                      if (selectedIds.size === filtered.length) {
                        setSelectedIds(new Set());
                      } else {
                        setSelectedIds(new Set(filtered.map((c) => c.id)));
                      }
                    }}
                    className="w-4 h-4 accent-red-600"
                  />
                </th>
              )}
              <th className="text-left px-4 py-3 font-medium text-ink-2">성명</th>
              <th className="text-left px-4 py-3 font-medium text-ink-2">연락처</th>
              <th className="text-left px-4 py-3 font-medium text-ink-2">주택형</th>
              <th className="text-left px-4 py-3 font-medium text-ink-2">공급 유형</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {!selectedAnn ? (
              <tr><td colSpan={selectMode ? 6 : 5} className="text-center py-8 text-ink-4">먼저 공고를 선택해주세요</td></tr>
            ) : loading ? (
              <tr><td colSpan={selectMode ? 6 : 5} className="text-center py-8 text-ink-4">불러오는 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={selectMode ? 6 : 5} className="text-center py-8 text-ink-4">이 공고에 등록된 고객이 없습니다</td></tr>
            ) : filtered.map((c) => {
              const displaySupply = c.supply_type || (c.special_types && c.special_types.length > 0 ? c.special_types[0] : "일반공급");
              const supplyCls = displaySupply === "일반공급"
                ? "bg-indigo-50 text-indigo-700"
                : "bg-purple-50 text-purple-700";
              const isChecked = selectedIds.has(c.id);
              return (
                <tr
                  key={c.id}
                  className={`transition-colors ${
                    selectMode
                      ? isChecked
                        ? "bg-red-50 hover:bg-red-100"
                        : "hover:bg-surface2 cursor-pointer"
                      : "hover:bg-surface2"
                  }`}
                  onClick={selectMode ? () => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    });
                  } : undefined}
                >
                  {selectMode && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id);
                            else next.add(c.id);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 accent-red-600"
                      />
                    </td>
                  )}
                  <td className={`px-4 py-3 font-medium ${c.superseded ? "text-ink-4 line-through" : "text-ink"}`}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{c.name}</span>
                      {c.is_standby && (
                        <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                          예비 {c.standby_rank || ""}
                        </span>
                      )}
                      {c.superseded && (
                        <span className="text-[9px] bg-border text-ink-2 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                          포기
                        </span>
                      )}
                      {c.succeeded_from && (
                        <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                          승계 완료
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-2">{c.phone || "-"}</td>
                  <td className="px-4 py-3 text-ink-2">
                    {c.unit_type ? (
                      <>
                        <span className="font-medium">{c.unit_type}</span>
                        {c.unit_area && <span className="text-ink-4 text-xs ml-1">{c.unit_area}</span>}
                      </>
                    ) : (
                      <span className="text-xs text-ink-4">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${supplyCls}`}>{displaySupply}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-3 justify-end">
                      <a
                        href={`/customers/${c.id}`}
                        className="text-accent hover:underline flex items-center gap-0.5 text-xs"
                      >
                        상세 <ChevronRight className="w-3 h-3" />
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-border-soft text-xs text-ink-4 text-right">
            총 {filtered.length}명
          </div>
        )}
      </div>

      {/* 업로드 충돌 검토 모달 */}
      {conflicts.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-border-soft flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h2 className="text-lg font-semibold">변경사항 검토</h2>
                <p className="text-xs text-ink-3 mt-0.5">
                  {conflicts.length}명의 기존 고객과 업로드 내용이 다릅니다. 각각 수정할지 유지할지 선택해 주세요.
                </p>
              </div>
              <button
                onClick={() => { setConflicts([]); setConflictDecisions({}); }}
                className="p-1 hover:bg-surface2 rounded-full"
              >
                <X className="w-4 h-4 text-ink-3" />
              </button>
            </div>

            {/* 일괄 액션 */}
            <div className="px-6 py-3 bg-surface2 border-b border-border-soft flex items-center gap-2 flex-wrap">
              <span className="text-xs text-ink-2">일괄 선택:</span>
              <button
                onClick={() => {
                  const next: Record<number, "update" | "keep"> = {};
                  conflicts.forEach((c) => { next[c.existing.id] = "update"; });
                  setConflictDecisions(next);
                }}
                className="text-xs px-2.5 py-1 rounded-md bg-accent-soft text-accent hover:bg-accent-soft font-medium"
              >
                모두 새 값으로 수정
              </button>
              <button
                onClick={() => {
                  const next: Record<number, "update" | "keep"> = {};
                  conflicts.forEach((c) => { next[c.existing.id] = "keep"; });
                  setConflictDecisions(next);
                }}
                className="text-xs px-2.5 py-1 rounded-md bg-surface2 text-ink-2 hover:bg-border font-medium"
              >
                모두 기존 값 유지
              </button>
              <span className="text-xs text-ink-4 ml-auto">
                선택됨 {Object.keys(conflictDecisions).length} / {conflicts.length}
              </span>
            </div>

            {/* 충돌 목록 */}
            <div className="p-6 space-y-4">
              {conflicts.map((conflict) => {
                const decision = conflictDecisions[conflict.existing.id];
                return (
                  <div
                    key={conflict.existing.id}
                    className={`border-2 rounded-lg p-4 transition-colors ${
                      decision === "update"
                        ? "border-blue-300 bg-accent-soft"
                        : decision === "keep"
                          ? "border-gray-300 bg-surface2"
                          : "border-amber-200 bg-amber-50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <div>
                        <span className="font-semibold text-ink">{conflict.existing.name}</span>
                        {conflict.existing.rrn_front && (
                          <span className="text-xs text-ink-3 ml-2 font-mono">
                            {conflict.existing.rrn_front}-{conflict.existing.rrn_back?.slice(0, 1) || "•"}••••••
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConflictDecisions((p) => ({ ...p, [conflict.existing.id]: "update" }))}
                          className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                            decision === "update"
                              ? "bg-accent text-white"
                              : "bg-white border border-blue-300 text-accent hover:bg-accent-soft"
                          }`}
                        >
                          새 값으로 수정
                        </button>
                        <button
                          onClick={() => setConflictDecisions((p) => ({ ...p, [conflict.existing.id]: "keep" }))}
                          className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                            decision === "keep"
                              ? "bg-gray-700 text-white"
                              : "bg-white border border-gray-300 text-ink-2 hover:bg-surface2"
                          }`}
                        >
                          기존 값 유지
                        </button>
                      </div>
                    </div>
                    {/* Diff 테이블 */}
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-ink-3">
                          <th className="text-left py-1.5 pr-4 font-normal w-32">항목</th>
                          <th className="text-left py-1.5 pr-4 font-normal">기존 값</th>
                          <th className="text-left py-1.5 font-normal">새 값 (파일)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conflict.diffs.map((d) => (
                          <tr key={String(d.key)} className="border-b border-border-soft last:border-0">
                            <td className="py-1.5 pr-4 font-medium text-ink-2">{d.label}</td>
                            <td className="py-1.5 pr-4 text-ink-2 line-through decoration-gray-400">
                              {formatValue(d.oldValue)}
                            </td>
                            <td className="py-1.5 text-accent font-medium">
                              {formatValue(d.newValue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>

            {/* 하단 액션 */}
            <div className="sticky bottom-0 bg-white border-t border-border-soft px-6 py-4 flex items-center justify-between gap-2">
              <span className="text-xs text-ink-3">
                미선택 항목은 기존 값 유지로 처리됩니다.
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setConflicts([]); setConflictDecisions({}); }}
                  className="btn-secondary text-sm"
                >
                  취소
                </button>
                <button
                  onClick={() => {
                    let updated = 0;
                    for (const conflict of conflicts) {
                      const decision = conflictDecisions[conflict.existing.id] ?? "keep";
                      if (decision !== "update") continue;
                      // incoming의 non-empty 필드만 적용 (빈 값으로 덮어쓰지 않기)
                      const patch: any = {};
                      for (const diff of conflict.diffs) {
                        const v = diff.newValue;
                        if (v === undefined || v === null || v === "") continue;
                        patch[diff.key] = v;
                      }
                      if (Object.keys(patch).length > 0) {
                        localCustomers.update(conflict.existing.id, patch);
                        updated++;
                      }
                    }
                    setConflicts([]);
                    setConflictDecisions({});
                    loadCustomers();
                    if (updated > 0) {
                      alert(`${updated}명의 정보가 업데이트되었습니다.`);
                    }
                  }}
                  className="btn-primary text-sm"
                >
                  적용
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 고객 등록 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-border-soft flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">신규 고객 등록</h2>
                {selectedAnn && (
                  <p className="text-xs text-ink-3 mt-0.5">대상 공고: {selectedAnn.title}</p>
                )}
              </div>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-surface2 rounded-full">
                <X className="w-4 h-4 text-ink-3" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              {pdfFilled.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-accent-soft border border-blue-200 rounded-lg text-sm text-accent">
                  <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <strong>PDF에서 자동 추출된 항목:</strong>{" "}
                    {pdfFilled.join(" · ")}
                    <div className="text-xs text-accent mt-0.5">내용을 확인한 뒤 필요 시 수정해주세요.</div>
                  </div>
                  <button type="button" onClick={() => setPdfFilled([])} className="text-blue-400 hover:text-accent">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">성명 *</label>
                  <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">연락처</label>
                  <input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="010-0000-0000"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">주민번호 앞 6자리 *</label>
                  <input required maxLength={6} value={form.rrn_front} onChange={(e) => setForm((p) => ({ ...p, rrn_front: e.target.value.replace(/\D/g,"") }))}
                    placeholder="800101"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">주민번호 뒷 7자리 *</label>
                  <input required type="password" maxLength={7} value={form.rrn_back} onChange={(e) => setForm((p) => ({ ...p, rrn_back: e.target.value.replace(/\D/g,"") }))}
                    placeholder="•••••••"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">주소</label>
                <input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">무주택 기간 (년)</label>
                  <input type="number" min={0} value={form.no_home_years} onChange={(e) => setForm((p) => ({ ...p, no_home_years: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">부양가족 수</label>
                  <input type="number" min={0} value={form.dependents_count} onChange={(e) => setForm((p) => ({ ...p, dependents_count: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">통장 납입 (개월)</label>
                  <input type="number" min={0} value={form.subscription_months} onChange={(e) => setForm((p) => ({ ...p, subscription_months: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
              </div>

              {/* 공고별 동적 특별공급 체크박스 */}
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">
                  특별공급 유형
                  <span className="text-xs text-ink-4 font-normal ml-2">
                    (이 공고에서 모집하는 유형)
                  </span>
                </label>
                {specialTypeOptions.length === 0 ? (
                  <div className="text-xs text-ink-4 py-1">이 공고는 특별공급 유형이 지정되어 있지 않습니다</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {specialTypeOptions.map((t) => {
                      const checked = form.special_types.includes(t);
                      return (
                        <label
                          key={t}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border cursor-pointer transition-colors ${
                            checked
                              ? "bg-purple-600 text-white border-purple-600"
                              : "bg-white text-ink-2 border-gray-300 hover:border-purple-400"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSpecial(t)}
                            className="sr-only"
                          />
                          {t}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} disabled={submitting} className="btn-secondary flex-1 disabled:opacity-50">취소</button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                  {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /> 등록 중…</>) : "등록"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 하단 다음 단계 CTA */}
      {selectedAnn && customers.length > 0 && (
        <div className="mt-8 flex justify-end">
          <a
            href="/workflow/household"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent transition-colors shadow-sm"
          >
            다음 단계 (세대원 확인) 로 진행
            <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      )}
    </div>
  );
}

export default function RegistrationPage() {
  return (
    <Suspense fallback={<div className="p-6 text-ink-4">로딩 중...</div>}>
      <CustomersPageInner />
    </Suspense>
  );
}
