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
  onLocalStoreChange,
  LocalAnnouncement,
  LocalCustomer,
} from "@/lib/local-store";
import {
  UserPlus, Search, ChevronRight, Calculator, FileSpreadsheet,
  Loader2, BookOpen, X, Trash2,
} from "lucide-react";
import AnnouncementPicker from "@/components/AnnouncementPicker";
import { getSampleAsLocalAnnouncements } from "@/lib/sample-adapter";
import { classifyIncoming, formatValue, IncomingCustomer, CustomerConflict } from "@/lib/customer-dedup";
import { formatHousingCode, housingAreaString, formatPhone, formatPhoneInput } from "@/lib/housing-code";
import { detectCrossIssues, crossCheckSummary, type CrossCheckIssue } from "@/lib/customer-cross-check";
import { APPLYHOME_AUTO_VERIFIED_DOCUMENTS } from "@/lib/document-checklist";

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
  /**
   * 폼이 열린 의도:
   *   "manual_winner" — 미달 등 사유로 청약홈을 거치지 않은 당첨자 추가 등록
   *                    (특별공급신청서·청약통장 순위확인서 자동 체크 안 함)
   *   "general"       — 일반 수동 등록 (status: inquiry 기본)
   */
  const [formMode, setFormMode] = useState<"manual_winner" | "general">("general");

  // 신규 고객 폼
  const [form, setForm] = useState({
    name: "", rrn_front: "", rrn_back: "", phone: "", address: "",
    no_home_years: 0, dependents_count: 0, subscription_months: 0,
    current_region: "", income_monthly: "",
    special_types: [] as string[],
    supply_type: "일반공급",
    unit_type: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [excelUploading, setExcelUploading] = useState(false);
  const [excelResult, setExcelResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [crossIssues, setCrossIssues] = useState<CrossCheckIssue[] | null>(null);

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
  // + 다른 페이지(공고 관리 등)에서 공고 변경 시 자동 재로드
  useEffect(() => {
    let cancelled = false;
    const initialLoad = async () => {
      const list = await loadAnnouncements();
      if (cancelled) return;
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
    };
    initialLoad();

    // 다른 페이지에서 공고 변경 시 (삭제·추가·수정) 자동 재로드
    const unsub = onLocalStoreChange(async (key) => {
      if (key !== "apply:announcements") return;
      const list = await loadAnnouncements();
      if (cancelled) return;
      // 현재 선택된 공고가 삭제됐다면 초기화
      setSelectedAnn((prev) => {
        if (!prev) return prev;
        const stillExists = list.find((a: LocalAnnouncement) => a.id === prev.id);
        return stillExists || (list.length > 0 ? list[0] : null);
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
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

  // ─── 공고별 주택형 목록 (동적) ────────────────────────
  const unitTypeOptions: Array<{ value: string; label: string }> = (() => {
    const raw = selectedAnn?.eligibility_rules?.exclusive_areas;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((a: any) => a?.area)
      .map((a: any) => {
        const area = String(a.area);
        const sqm = a.squareMeters != null ? `${a.squareMeters}㎡` : "";
        const units = a.totalUnits != null ? `총 ${a.totalUnits}세대` : "";
        const extra = [sqm, units].filter(Boolean).join(" · ");
        return { value: area, label: extra ? `${area} (${extra})` : area };
      });
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
      // 특공 선택 시 공급유형 자동 조정 (첫 번째 특공 타입 사용)
      const effectiveSupplyType = form.special_types.length > 0
        ? form.special_types[0]
        : form.supply_type || "일반공급";

      const isManualWinner = formMode === "manual_winner";
      const payload = {
        site_id: selectedAnn.site_id,
        announcement_id: selectedAnn.id,
        name: form.name.trim(),
        rrn_front: form.rrn_front,
        rrn_back: form.rrn_back,
        phone: formatPhone(form.phone),  // 저장 시 완성형 정규화
        address: form.address,
        no_home_years: form.no_home_years,
        dependents_count: form.dependents_count,
        subscription_months: form.subscription_months,
        is_first_time_buyer: form.special_types.includes("생애최초"),
        is_newlywed: form.special_types.includes("신혼부부"),
        current_region: form.current_region,
        income_monthly: form.income_monthly ? Number(form.income_monthly) : null,
        special_types: form.special_types,
        supply_type: effectiveSupplyType,
        unit_type: form.unit_type || undefined,
        unit_area: form.unit_type ? housingAreaString(form.unit_type) : undefined,
        // 추가 당첨자 등록은 곧바로 당첨자(winner)로, 청약홈을 거치지 않았으므로
        // 특별공급신청서·청약통장 순위확인서를 별도 검수 대상으로 둔다.
        ...(isManualWinner ? {
          status: "winner" as const,
          is_standby: false,
        } : {}),
      };

      try {
        await customersApi.create({
          ...payload,
          registration_source: isManualWinner ? "manual_winner" : "manual",
        } as any);
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
          supply_type: payload.supply_type,
          unit_type: payload.unit_type,
          unit_area: payload.unit_area,
          ...(isManualWinner ? {
            status: "winner" as any,
            is_standby: false,
            registration_source: "manual_winner" as const,
          } : {
            registration_source: "manual" as const,
          }),
        });
      }

      setShowForm(false);
      setForm({
        name: "", rrn_front: "", rrn_back: "", phone: "", address: "",
        no_home_years: 0, dependents_count: 0, subscription_months: 0,
        current_region: "", income_monthly: "", special_types: [],
        supply_type: "일반공급", unit_type: "",
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

  /**
   * 청약홈 전산추첨결과 Excel 파서.
   *
   * 파일 구조: 여러 시트로 구성되며, 시트 이름으로 공급유형·당첨/예비 구분.
   *  - 안내 시트 2개 → 건너뜀
   *  - 당첨자 시트: 다자녀당첨자, 신혼부부당첨자, 생애최초당첨자, 노부모부양당첨자,
   *    기관추천당첨자, 이전기관당첨자, 일반공급당첨자
   *  - 예비입주자 시트: 각 공급유형 + 예비입주자 (is_standby=true)
   *  - 잔여추첨명단: 무작위 추첨 당첨 (is_standby=false, 비고 사유 표시)
   *
   * 각 시트 헤더: 주택형 | 성명 | 주민번호(13자리) | 우편번호 | 주소 | 전화번호 |
   *  개설은행 | 예금종목 | 계좌번호 | 순위 | 당해여부(신청기준) | 당해여부(당첨기준) |
   *  접수일자 | 저층신청여부 | 청약통장개설일 | (가점제청약신청여부) | 주택소유구분 |
   *  (무주택기간) | (부양가족수) | (입주자저축가입기간) | … | 가점 | 감점 | 총점 |
   *  (장기복무군인…) | 당첨구분 | 동수 | 호수
   */
  const handleExcelUpload = async (file: File) => {
    if (!selectedAnn) { alert("먼저 공고를 선택해주세요"); return; }
    setExcelUploading(true);
    setExcelResult(null);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });

      /** 시트명 → 공급유형·대기여부 매핑.
       *  데이터가 없는 '안내'·'최저당첨정보' 같은 시트는 매핑하지 않음(자동 건너뜀). */
      const SHEET_MAP: Record<string, { canonical: string; isStandby: boolean }> = {
        "일반공급당첨자": { canonical: "일반공급", isStandby: false },
        "다자녀당첨자": { canonical: "다자녀가구", isStandby: false },
        "신혼부부당첨자": { canonical: "신혼부부", isStandby: false },
        "생애최초당첨자": { canonical: "생애최초", isStandby: false },
        "노부모부양당첨자": { canonical: "노부모부양", isStandby: false },
        "기관추천당첨자": { canonical: "기관추천", isStandby: false },
        "이전기관당첨자": { canonical: "이전기관", isStandby: false },
        "일반공급예비입주자": { canonical: "일반공급", isStandby: true },
        "다자녀예비입주자": { canonical: "다자녀가구", isStandby: true },
        "신혼부부예비입주자": { canonical: "신혼부부", isStandby: true },
        "생애최초예비입주자": { canonical: "생애최초", isStandby: true },
        "노부모부양예비입주자": { canonical: "노부모부양", isStandby: true },
        "기관추천예비입주자": { canonical: "기관추천", isStandby: true },
        "이전기관예비입주자": { canonical: "이전기관", isStandby: true },
      };

      const toStr = (v: any): string => (v === undefined || v === null ? "" : String(v).trim());
      const toNum = (v: any): number | undefined => {
        if (v === undefined || v === "" || v === null) return undefined;
        const n = Number(String(v).replace(/[^\d.-]/g, ""));
        return Number.isFinite(n) ? n : undefined;
      };
      /** 여러 후보 컬럼명에서 값 추출 — 일반공급과 특별공급 시트 헤더가 달라서 필요.
       *  예: 주민번호(일반) vs 주민등록번호(특공), 전화번호 vs 연락전화번호, 주소 vs 연락주소 */
      const pick = (row: Record<string, any>, ...keys: string[]): string => {
        for (const k of keys) {
          const v = row[k];
          if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
        }
        return "";
      };
      /** "강원도 강릉시 주문진읍 ..." → "강원도" */
      const extractRegion = (addr: string): string => {
        const m = addr.match(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주)/);
        return m ? m[1] : "";
      };
      /** "06[4년 이상 ~ 5년 미만]" → 4.5 (중간값) */
      const parseRangeYears = (raw: string): number => {
        if (!raw) return 0;
        const m = raw.match(/(\d+)년\s*이상.*?(\d+)년\s*미만/);
        if (m) return (Number(m[1]) + Number(m[2])) / 2;
        const m2 = raw.match(/(\d+)년\s*이상/);
        if (m2) return Number(m2[1]);
        if (/1년\s*미만/.test(raw)) return 0.5;
        return 0;
      };
      /** "20180108" → "2018-01-08" */
      const formatYmd = (raw: string): string => {
        const s = raw.replace(/\D/g, "").slice(0, 8);
        if (s.length !== 8) return raw;
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      };

      // ── 시트 순회 ──
      const candidates: IncomingCustomer[] = [];
      const sheetBreakdown: Record<string, number> = {};
      let parseFailed = 0;
      const parseErrors: string[] = [];

      for (const sheetName of wb.SheetNames) {
        const meta = SHEET_MAP[sheetName];
        if (!meta) continue; // 안내 시트 등 건너뜀
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const name = pick(row, "성명");
          if (!name) {
            // 완전 빈 행은 에러 아님 (이전기관당첨자 등은 헤더만 있고 데이터 없는 시트)
            const anyFilled = Object.values(row).some((v) => v !== "" && v !== null && v !== undefined);
            if (anyFilled) { parseFailed++; parseErrors.push(`[${sheetName}] ${i + 2}행 성명 누락`); }
            continue;
          }

          // 주민번호 (일반공급=주민번호 / 특별공급=주민등록번호)
          const rrnFull = pick(row, "주민번호", "주민등록번호").replace(/\D/g, "");
          const rrnFront = rrnFull.slice(0, 6);
          const rrnBack = rrnFull.slice(6, 13);
          if (!rrnFront || rrnFront.length < 6) { parseFailed++; parseErrors.push(`[${sheetName}] ${i + 2}행(${name}) 주민번호 불량`); continue; }

          // 주소 / 전화 (특별공급은 '연락주소', '연락전화번호')
          const address = pick(row, "주소", "연락주소");
          const phone = formatPhone(pick(row, "전화번호", "연락전화번호"));
          const housingCode = pick(row, "주택형");
          const noHomeRaw = pick(row, "무주택기간", "무주택기간 배점");
          const subPeriodRaw = pick(row, "입주자저축가입기간", "청약통장 가입기간 배점", "입주자저축 가입기간 배점");
          // 접수일자 (일반=접수일자 / 특공=청약신청일)
          const applicationDate = pick(row, "접수일자", "청약신청일");
          // 저층신청 (일반=저층신청여부 Y/N / 특공=최하층 신청구분 텍스트)
          const lowFloorRaw = pick(row, "저층신청여부", "최하층 신청구분", "최하층신청구분");
          const lowFloorApply = lowFloorRaw.toUpperCase() === "Y" || /우선|해당/.test(lowFloorRaw);
          // 총점 (특공 일부는 '가점제 총점')
          const totalScore = toNum(pick(row, "총점", "가점제 총점"));
          // 순위 — 일반공급은 '순위', 특공은 '선정순위' 또는 '예비순위'
          const rank = pick(row, "순위", "선정순위", "예비순위", "예비순번");
          // 당첨구분 — 일반공급만 존재 (가점제/추첨제)
          const selectionMethod = pick(row, "당첨구분");
          // 예비순위 — 예비입주자 시트만
          const standbyRank = meta.isStandby ? pick(row, "예비순위", "예비순번", "선정순위") : undefined;
          // 부양가족수 텍스트에서 숫자 추출 (다자녀 시트엔 없음)
          const dependentsRaw = pick(row, "부양가족수", "전체 미성년 자녀수(태아포함)");
          const dependents = dependentsRaw ? (toNum(dependentsRaw.match(/\d+/)?.[0]) ?? 0) : 0;

          // 동/호 — 5단계 배치 매칭(파일명 동-호수 자동 첨부)에 핵심이라
          // winner_info뿐 아니라 customer.unit_dong/unit_ho에도 동시 저장
          const dongRaw = pick(row, "동수");
          const hoRaw = pick(row, "호수");

          const cand: IncomingCustomer & { _winnerInfo?: LocalCustomer["winner_info"]; is_standby?: boolean; standby_rank?: string } = {
            name,
            phone,
            rrn_front: rrnFront,
            rrn_back: rrnBack || "0000000",
            address,
            current_region: extractRegion(address),
            no_home_years: Math.round(parseRangeYears(noHomeRaw)),
            dependents_count: dependents,
            subscription_months: Math.round(parseRangeYears(subPeriodRaw) * 12),
            income_monthly: null,
            special_types: meta.canonical === "일반공급" ? [] : [meta.canonical],
            supply_type: meta.canonical,
            // 주택형 — 전산 코드(0848636)를 "84.8636(84)" 형식으로 표시, 면적 문자열 별도 저장
            unit_type: formatHousingCode(housingCode) || housingCode,
            unit_area: housingAreaString(housingCode) || undefined,
            unit_dong: dongRaw || undefined,
            unit_ho: hoRaw || undefined,
            is_standby: meta.isStandby,
            standby_rank: standbyRank,
            _winnerInfo: {
              sheet_source: sheetName,
              building: dongRaw,
              unit_no: hoRaw,
              selection_method: selectionMethod,
              application_date: formatYmd(applicationDate),
              savings_opened: formatYmd(pick(row, "청약통장개설일")),
              low_floor_apply: lowFloorApply,
              bank: pick(row, "개설은행"),
              account_type: pick(row, "예금종목"),
              account: pick(row, "계좌번호"),
              rank,
              region_priority_kind: pick(row, "당해여부(신청기준)", "당해여부(당첨기준)"),
              ga_score: toNum(row["가점"]),
              penalty: toNum(row["감점"]),
              total_score: totalScore,
              housing_type_code: housingCode,
              ga_point_type: selectionMethod,
            } as any,
          } as any;

          candidates.push(cand);
          sheetBreakdown[sheetName] = (sheetBreakdown[sheetName] || 0) + 1;
        }
      }

      if (candidates.length === 0) {
        alert("청약홈 전산추첨결과 형식을 인식하지 못했습니다.\n시트 이름이 '일반공급당첨자', '신혼부부당첨자' 등 표준 포맷인지 확인해주세요.");
        setExcelResult({ success: 0, failed: parseFailed, errors: parseErrors.slice(0, 10) });
        return;
      }

      // 사용자 확인
      const summary = Object.entries(sheetBreakdown)
        .map(([s, n]) => `  · ${s}: ${n}명`)
        .join("\n");
      if (!confirm(`청약홈 전산추첨결과에서 ${candidates.length}명을 인식했습니다.\n\n${summary}\n\n이미 등록된 사람은 제외하고 신규만 추가합니다. 계속하시겠습니까?`)) {
        setExcelResult({ success: 0, failed: parseFailed, errors: [] });
        return;
      }

      // dedup
      const existing = localCustomers.listByAnnouncement(selectedAnn.id);
      const { toCreate, duplicates, conflicts: foundConflicts } = classifyIncoming(candidates, existing);

      // 청약홈 자동 검증 서류 (특별공급신청서·청약통장 순위확인서) 자동 체크 맵
      const applyhomePresubmitted: Record<string, boolean> = {};
      for (const d of APPLYHOME_AUTO_VERIFIED_DOCUMENTS) applyhomePresubmitted[d] = true;

      // 신규 등록
      let created = 0, createFailed = 0;
      const createErrors: string[] = [];
      for (const c of toCreate) {
        const anyC = c as any;
        try {
          const payload = {
            site_id: selectedAnn.site_id,
            announcement_id: selectedAnn.id,
            name: c.name,
            phone: c.phone || "",
            rrn_front: c.rrn_front || "",
            rrn_back: c.rrn_back || "0000000",
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
            unit_dong: (c as any).unit_dong,
            unit_ho: (c as any).unit_ho,
            is_standby: anyC.is_standby === true,
            standby_rank: anyC.standby_rank,
            winner_info: anyC._winnerInfo,
            // 청약홈을 통해 검증된 서류 자동 체크 (이미 검증되어 별도 제출 불필요)
            registration_source: "applyhome" as const,
            documents_submitted: { ...applyhomePresubmitted },
          };
          localCustomers.create(payload);
          created++;
        } catch (err: any) {
          createFailed++;
          createErrors.push(`${c.name}: ${err?.message || "등록 실패"}`);
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
    } catch (err: any) {
      alert(err?.message || "엑셀 파일 파싱 실패");
    } finally {
      setExcelUploading(false);
    }
  };

  /** 교차검증 실행 — 같은 공고 당첨자·예비 전체 대상 */
  const runCrossCheck = () => {
    if (!selectedAnn) { alert("먼저 공고를 선택해주세요"); return; }
    const all = localCustomers.listByAnnouncement(selectedAnn.id);
    const issues = detectCrossIssues(all as any, selectedAnn as any);
    setCrossIssues(issues);
    if (issues.length === 0) {
      alert("교차검증 완료 — 이상 징후 없음. 중복 주소·공유 계좌·세대원 교차 모두 정상.");
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
              청약홈 <strong>전산추첨결과 엑셀</strong>을 업로드하면 당첨자·예비입주자가 공급유형별로 자동 등록됩니다.
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
          {/* 청약홈 전산추첨결과 엑셀 업로드 */}
          <button
            onClick={() => excelInputRef.current?.click()}
            disabled={excelUploading || !selectedAnn}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="청약홈 전산추첨결과 엑셀 업로드 — 모든 당첨자/예비입주자 시트 자동 인식"
          >
            {excelUploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
            ) : (
              <><FileSpreadsheet className="w-4 h-4" /> 전산추첨결과 업로드</>
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

          {/* 추가 당첨자 등록 — 미달 등 사유로 청약홈을 거치지 않은 당첨자 직접 등록 */}
          <button
            onClick={() => {
              if (!selectedAnn) return;
              setFormError(null);
              setFormMode("manual_winner");
              setShowForm(true);
            }}
            disabled={!selectedAnn}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="미달 등으로 청약홈을 거치지 않은 당첨자를 직접 등록 — 특별공급신청서·청약통장 순위확인서를 별도 검수해야 합니다"
          >
            <UserPlus className="w-4 h-4" /> 추가 당첨자 등록
          </button>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Phase #3 교차검증 */}
          <button
            onClick={runCrossCheck}
            disabled={!selectedAnn || customers.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="동일 주소·계좌 공유·세대원 교차·공고 요건 위반 자동 감지"
          >
            🔍 교차검증
          </button>

          {/* 고객 등록 — 일반 수동 폼 (문의·예비 등) */}
          <button
            onClick={() => { setFormError(null); setFormMode("general"); setShowForm(true); }}
            disabled={!selectedAnn}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-accent hover:bg-accent shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="일반 수동 등록 (문의 등) — 당첨자 등록은 [추가 당첨자 등록] 버튼을 사용하세요"
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
                ? "bg-surface2 text-ink hover:bg-surface2"
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

      {/* Phase #3 교차검증 결과 배너 */}
      {crossIssues && crossIssues.length > 0 && (() => {
        const sum = crossCheckSummary(crossIssues);
        const borderCls = sum.error > 0 ? "border-red-200 bg-red-50"
          : sum.warning > 0 ? "border-amber-200 bg-amber-50"
          : "border-accent-line bg-accent-soft";
        return (
          <div className={`card mb-4 border ${borderCls}`}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">🔍 교차검증 결과 · {sum.total}건</span>
                {sum.error > 0 && <span className="text-xs text-red-700 font-semibold">🔴 오류 {sum.error}</span>}
                {sum.warning > 0 && <span className="text-xs text-amber-700 font-semibold">🟡 경고 {sum.warning}</span>}
                {sum.info > 0 && <span className="text-xs text-accent">🔵 정보 {sum.info}</span>}
              </div>
              <button onClick={() => setCrossIssues(null)} className="text-ink-4 hover:text-ink-2 text-sm">×</button>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {crossIssues.map((issue, i) => {
                const dot = issue.severity === "error" ? "🔴" : issue.severity === "warning" ? "🟡" : "🔵";
                const target = customers.find((c) => c.id === issue.customerId);
                return (
                  <div key={i} className="flex items-start gap-2 text-xs border-l-2 border-current pl-2 py-0.5">
                    <span className="flex-shrink-0">{dot}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-ink">
                        {target?.name || `#${issue.customerId}`} — {issue.message}
                      </div>
                      {issue.recommendation && (
                        <div className="text-ink-2 mt-0.5">→ {issue.recommendation}</div>
                      )}
                    </div>
                    {target && (
                      <a href={`/customers/${target.id}`} className="text-accent hover:underline flex-shrink-0">상세</a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

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
                      ? "bg-surface text-amber-700 shadow-sm"
                      : "bg-surface text-accent shadow-sm"
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
          className="px-2.5 py-1.5 rounded-lg border border-border bg-bg text-xs font-medium text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">주택형 전체</option>
          {unitOptions.map((u) => (
            <option key={u} value={u}>{formatHousingCode(u)}</option>
          ))}
        </select>
        <select
          value={supplyFilter}
          onChange={(e) => setSupplyFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-border bg-bg text-xs font-medium text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent"
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
                ? "bg-accent-soft text-accent"
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
                  <td className="px-4 py-3 text-ink-2">{c.phone ? formatPhone(c.phone) : "-"}</td>
                  <td className="px-4 py-3 text-ink-2">
                    {c.unit_type ? (
                      <span className="font-medium">{formatHousingCode(c.unit_type)}</span>
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
          <div className="bg-surface rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-border-soft flex items-center justify-between sticky top-0 bg-surface z-10">
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
                        ? "border-accent-line bg-accent-soft"
                        : decision === "keep"
                          ? "border-border bg-surface2"
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
                              : "bg-surface border border-accent-line text-accent hover:bg-accent-soft"
                          }`}
                        >
                          새 값으로 수정
                        </button>
                        <button
                          onClick={() => setConflictDecisions((p) => ({ ...p, [conflict.existing.id]: "keep" }))}
                          className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                            decision === "keep"
                              ? "bg-surface2 text-ink"
                              : "bg-surface border border-border text-ink-2 hover:bg-surface2"
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
                            <td className="py-1.5 pr-4 text-ink-2 line-through decoration-ink-3">
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
            <div className="sticky bottom-0 bg-surface border-t border-border-soft px-6 py-4 flex items-center justify-between gap-2">
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
          <div className="bg-surface rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-border-soft flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {formMode === "manual_winner" ? "추가 당첨자 등록" : "신규 고객 등록"}
                </h2>
                {selectedAnn && (
                  <p className="text-xs text-ink-3 mt-0.5">대상 공고: {selectedAnn.title}</p>
                )}
                {formMode === "manual_winner" && (
                  <p className="text-[11px] text-emerald-700 mt-1.5 leading-relaxed bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5">
                    💡 미달 등 사유로 청약홈을 거치지 않은 당첨자입니다. 5단계 서류 검수에서
                    <strong> 「특별공급신청서·무주택 서약서」와 「청약통장 순위(가입)확인서」</strong>를 별도로 제출·검수해야 합니다.
                  </p>
                )}
              </div>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-surface2 rounded-full">
                <X className="w-4 h-4 text-ink-3" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">성명 *</label>
                  <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">연락처</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: formatPhoneInput(e.target.value) }))}
                    onBlur={(e) => setForm((p) => ({ ...p, phone: formatPhone(e.target.value) }))}
                    placeholder="010-0000-0000"
                    maxLength={13}
                    className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">주민번호 앞 6자리 *</label>
                  <input required maxLength={6} value={form.rrn_front} onChange={(e) => setForm((p) => ({ ...p, rrn_front: e.target.value.replace(/\D/g,"") }))}
                    placeholder="800101"
                    className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-1">주민번호 뒷 7자리 *</label>
                  <input required type="password" maxLength={7} value={form.rrn_back} onChange={(e) => setForm((p) => ({ ...p, rrn_back: e.target.value.replace(/\D/g,"") }))}
                    placeholder="•••••••"
                    className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">주소</label>
                <input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                  placeholder="시·도 시·군·구 동·읍·면 번지 건물명 동·호"
                  className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              {/* 공급 관련 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">공급유형 *</label>
                  <select
                    value={form.supply_type === "일반공급" ? "일반공급" : "특별공급"}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "일반공급") {
                        setForm((p) => ({ ...p, supply_type: "일반공급", special_types: [] }));
                      } else {
                        // 특별공급 선택: 기본으로 첫 번째 특공 유형 세팅 (혹은 비움)
                        const first = specialTypeOptions[0] || "";
                        setForm((p) => ({
                          ...p,
                          supply_type: first || "특별공급",
                          special_types: first ? [first] : [],
                        }));
                      }
                    }}
                    className="w-full border border-border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="일반공급">일반공급</option>
                    <option value="특별공급">특별공급</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">
                    주택형 {unitTypeOptions.length === 0 && <span className="text-ink-4">(공고에 등록된 주택형 없음)</span>}
                  </label>
                  {unitTypeOptions.length > 0 ? (
                    <select
                      value={form.unit_type}
                      onChange={(e) => setForm((p) => ({ ...p, unit_type: e.target.value }))}
                      className="w-full border border-border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    >
                      <option value="">선택</option>
                      {unitTypeOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={form.unit_type}
                      onChange={(e) => setForm((p) => ({ ...p, unit_type: e.target.value }))}
                      placeholder="예: 84.8636 또는 68A"
                      className="w-full border border-border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  )}
                </div>
              </div>

              {/* 특별공급 유형 — 공급유형이 "특별공급"일 때만 표시 */}
              {form.supply_type !== "일반공급" && (
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">
                    특별공급 세부유형 *
                    <span className="text-[10px] text-ink-4 font-normal ml-2">
                      이 공고에서 모집하는 유형 중 선택
                    </span>
                  </label>
                  {specialTypeOptions.length === 0 ? (
                    <div className="text-xs text-ink-4 py-1">
                      이 공고는 특별공급 유형이 지정되어 있지 않습니다.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {specialTypeOptions.map((t) => {
                        const selected = form.special_types[0] === t;
                        return (
                          <button
                            type="button"
                            key={t}
                            onClick={() =>
                              setForm((p) => ({
                                ...p,
                                supply_type: t,
                                special_types: [t],
                              }))
                            }
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                              selected
                                ? "bg-purple-600 text-white border-purple-600"
                                : "bg-surface text-ink-2 border-border hover:border-purple-400"
                            }`}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 현재 거주 지역 */}
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">현재 거주 지역</label>
                <input
                  value={form.current_region}
                  onChange={(e) => setForm((p) => ({ ...p, current_region: e.target.value }))}
                  placeholder="예: 부산, 서울 등 (지역우선공급 판정용)"
                  className="w-full border border-border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">무주택 기간 (년)</label>
                  <input type="number" min={0} value={form.no_home_years} onChange={(e) => setForm((p) => ({ ...p, no_home_years: Number(e.target.value) }))}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">부양가족 수</label>
                  <input type="number" min={0} value={form.dependents_count} onChange={(e) => setForm((p) => ({ ...p, dependents_count: Number(e.target.value) }))}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">통장 납입 (개월)</label>
                  <input type="number" min={0} value={form.subscription_months} onChange={(e) => setForm((p) => ({ ...p, subscription_months: Number(e.target.value) }))}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
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
