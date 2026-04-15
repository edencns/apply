"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { customersApi, eligibilityApi, api } from "@/lib/api";
import {
  localAnnouncements,
  localCustomers,
  activeAnnouncement,
  isNetworkError,
  LocalAnnouncement,
  LocalCustomer,
} from "@/lib/local-store";
import {
  UserPlus, Search, ChevronRight, Calculator, FileSpreadsheet,
  Loader2, Download, BookOpen, X,
} from "lucide-react";

interface Customer {
  id: number;
  name: string;
  phone: string;
  total_score: number;
  status: string;
  special_types?: string[];
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

  // 가점 계산기
  const [calcInput, setCalcInput] = useState({ no_home_years: 0, dependents_count: 0, subscription_months: 0 });
  const [calcResult, setCalcResult] = useState<any>(null);
  const [showCalc, setShowCalc] = useState(false);

  // 신규 고객 폼
  const [form, setForm] = useState({
    name: "", rrn_front: "", rrn_back: "", phone: "", address: "",
    no_home_years: 0, dependents_count: 0, subscription_months: 0,
    current_region: "", income_monthly: "",
    special_types: [] as string[],
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 엑셀 업로드
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [excelUploading, setExcelUploading] = useState(false);
  const [excelResult, setExcelResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);

  // ─── 공고 목록 로딩 ────────────────────────────────────
  const loadAnnouncements = useCallback(async () => {
    try {
      const r = await api.get(`/announcements/`);
      setAnnouncements(r.data);
      return r.data;
    } catch (err: any) {
      if (isNetworkError(err)) {
        const local = localAnnouncements.listAll();
        setAnnouncements(local);
        return local;
      }
      // 기타 오류: 로컬 저장소라도 보여준다
      const local = localAnnouncements.listAll();
      setAnnouncements(local);
      return local;
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

  const handleCalc = async () => {
    try {
      const r = await eligibilityApi.calculateScore(calcInput);
      setCalcResult(r.data);
    } catch (err: any) {
      if (isNetworkError(err)) {
        // 로컬 간이 계산
        const home = Math.min(calcInput.no_home_years, 15) * 2;
        const dep  = Math.min(calcInput.dependents_count, 6) * 5 + 5;
        const sub  = Math.min(Math.floor(calcInput.subscription_months / 6), 17);
        setCalcResult({
          "무주택_가점": home,
          "부양가족_가점": dep,
          "청약통장_가점": sub,
          "총_가점": home + dep + sub,
        });
      }
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

  /** 엑셀 템플릿 다운로드 */
  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet([
      {
        성명: "홍길동",
        연락처: "010-1234-5678",
        주민번호앞: "800101",
        주민번호뒤: "1234567",
        주소: "서울 강남구 역삼동",
        무주택기간_년: 10,
        부양가족수: 2,
        통장개월: 120,
        특별공급: "신혼부부",
        월소득_원: 5000000,
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "고객등록");
    XLSX.writeFile(wb, "고객등록_템플릿.xlsx");
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

      let success = 0, failed = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const name = toStr(pick(row, "성명", "이름", "name"));
          if (!name) { failed++; errors.push(`${i + 2}행: 성명 누락`); continue; }
          const rrnFront = toStr(pick(row, "주민번호앞", "rrn_front")).replace(/\D/g, "").slice(0, 6);
          const rrnBack = toStr(pick(row, "주민번호뒤", "rrn_back")).replace(/\D/g, "").slice(0, 7);
          if (!rrnFront || !rrnBack) { failed++; errors.push(`${i + 2}행(${name}): 주민번호 누락`); continue; }

          // 특별공급 컬럼 — 공고에 등록된 유형명과 매칭
          const specialRaw = toStr(pick(row, "특별공급", "special_types"));
          const special_types = specialRaw
            ? specialRaw.split(/[,·/]/).map((s) => s.trim()).filter(Boolean)
            : [];

          const payload = {
            site_id: selectedAnn.site_id,
            announcement_id: selectedAnn.id,
            name,
            phone: toStr(pick(row, "연락처", "전화", "phone")),
            rrn_front: rrnFront,
            rrn_back: rrnBack,
            address: toStr(pick(row, "주소", "address")),
            no_home_years: toNum(pick(row, "무주택기간_년", "무주택년", "no_home_years")),
            dependents_count: toNum(pick(row, "부양가족수", "dependents_count")),
            subscription_months: toNum(pick(row, "통장개월", "subscription_months")),
            is_first_time_buyer: special_types.includes("생애최초"),
            is_newlywed: special_types.includes("신혼부부"),
            current_region: toStr(pick(row, "지역", "current_region")),
            income_monthly: (() => {
              const n = toNum(pick(row, "월소득_원", "월소득", "income_monthly"));
              return n > 0 ? n : null;
            })(),
            special_types,
          };

          try {
            await customersApi.create(payload as any);
          } catch (netErr: any) {
            if (!isNetworkError(netErr)) throw netErr;
            localCustomers.create({
              announcement_id: selectedAnn.id,
              site_id: selectedAnn.site_id,
              name: payload.name,
              phone: payload.phone,
              rrn_front: payload.rrn_front,
              rrn_back: payload.rrn_back,
              address: payload.address,
              no_home_years: payload.no_home_years,
              dependents_count: payload.dependents_count,
              subscription_months: payload.subscription_months,
              current_region: payload.current_region,
              income_monthly: payload.income_monthly,
              special_types,
            });
          }
          success++;
        } catch (err: any) {
          failed++;
          const msg = err?.response?.data?.detail || err?.message || "등록 실패";
          const name = String(pick(row, "성명", "이름", "name") || "(이름없음)");
          errors.push(`${i + 2}행(${name}): ${msg}`);
        }
      }

      setExcelResult({ success, failed, errors: errors.slice(0, 10) });
      if (success > 0) loadCustomers();
    } catch (err: any) {
      alert(err?.message || "엑셀 파일 파싱 실패");
    } finally {
      setExcelUploading(false);
      if (excelInputRef.current) excelInputRef.current.value = "";
    }
  };

  const filtered = customers.filter((c) =>
    c.name.includes(search) || c.phone?.includes(search)
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* ─── 공고 선택 배너 ───────────────────────────────── */}
      <div className="mb-5 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-blue-600 font-medium">현재 작업 공고</div>
            {announcements.length > 0 ? (
              <select
                value={selectedAnn?.id ?? ""}
                onChange={(e) => {
                  const ann = announcements.find((a) => a.id === Number(e.target.value));
                  if (ann) setSelectedAnn(ann);
                }}
                className="w-full text-sm font-semibold text-gray-900 bg-transparent border-0 focus:outline-none focus:ring-0 p-0"
              >
                {announcements.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}{a.announcement_no ? ` (#${a.announcement_no})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-gray-600">등록된 공고가 없습니다 — 먼저 모집공고를 등록해 주세요.</div>
            )}
          </div>
          {selectedAnn && (
            <button
              onClick={() => router.push(`/announcements/${selectedAnn.id}`)}
              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-medium"
            >
              공고 상세 <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">고객 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            {selectedAnn ? `「${selectedAnn.title}」 청약 신청자 등록 및 관리` : "공고를 먼저 선택해주세요"}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCalc(!showCalc)} className="btn-secondary flex items-center gap-2">
            <Calculator className="w-4 h-4" /> 가점 계산기
          </button>
          <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-2" title="엑셀 템플릿 다운로드">
            <Download className="w-4 h-4" /> 템플릿
          </button>
          <button
            onClick={() => excelInputRef.current?.click()}
            disabled={excelUploading || !selectedAnn}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50"
          >
            {excelUploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 등록 중…</>
            ) : (
              <><FileSpreadsheet className="w-4 h-4" /> 엑셀 업로드</>
            )}
          </button>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleExcelUpload(f);
            }}
          />
          <button
            onClick={() => { setFormError(null); setShowForm(true); }}
            disabled={!selectedAnn}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <UserPlus className="w-4 h-4" /> 고객 등록
          </button>
        </div>
      </div>

      {/* 엑셀 업로드 결과 */}
      {excelResult && (
        <div className={`card mb-4 ${excelResult.failed === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-800">엑셀 일괄 등록 결과</div>
              <div className="mt-1 text-sm text-gray-700">
                성공 <strong className="text-green-700">{excelResult.success}건</strong>
                {excelResult.failed > 0 && <> · 실패 <strong className="text-red-700">{excelResult.failed}건</strong></>}
              </div>
              {excelResult.errors.length > 0 && (
                <ul className="mt-2 text-xs text-red-700 space-y-0.5 list-disc list-inside">
                  {excelResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  {excelResult.failed > excelResult.errors.length && (
                    <li className="text-gray-500">…외 {excelResult.failed - excelResult.errors.length}건 더</li>
                  )}
                </ul>
              )}
            </div>
            <button onClick={() => setExcelResult(null)} className="text-gray-400 hover:text-gray-600 text-sm">×</button>
          </div>
        </div>
      )}

      {/* 검색 */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 또는 연락처 검색"
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* 가점 계산기 패널 */}
      {showCalc && (
        <div className="card mb-4 bg-blue-50 border-blue-200">
          <h3 className="font-semibold text-blue-900 mb-3">청약 가점 계산기</h3>
          <div className="grid grid-cols-3 gap-4 mb-3">
            {[
              { key: "no_home_years", label: "무주택 기간 (년)", max: 15 },
              { key: "dependents_count", label: "부양가족 수 (명)", max: 6 },
              { key: "subscription_months", label: "청약통장 납입 (개월)", max: 200 },
            ].map(({ key, label, max }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-blue-800 mb-1">{label}</label>
                <input
                  type="number" min={0} max={max}
                  value={(calcInput as any)[key]}
                  onChange={(e) => setCalcInput((p) => ({ ...p, [key]: Number(e.target.value) }))}
                  className="w-full border border-blue-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleCalc} className="btn-primary text-sm px-4 py-1.5">계산하기</button>
            {calcResult && (
              <div className="flex gap-4 text-sm">
                <span>무주택 <strong>{calcResult["무주택_가점"]}점</strong></span>
                <span>부양가족 <strong>{calcResult["부양가족_가점"]}점</strong></span>
                <span>통장 <strong>{calcResult["청약통장_가점"]}점</strong></span>
                <span className="text-blue-700 font-bold text-base">총 {calcResult["총_가점"]}점 / 84점</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 고객 목록 */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">성명</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">연락처</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">특별공급</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">청약 가점</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">상태</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {!selectedAnn ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">먼저 공고를 선택해주세요</td></tr>
            ) : loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">불러오는 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">이 공고에 등록된 고객이 없습니다</td></tr>
            ) : filtered.map((c) => {
              const s = STATUS_LABEL[c.status] || { label: c.status, cls: "badge-pending" };
              return (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.phone || "-"}</td>
                  <td className="px-4 py-3">
                    {(c.special_types && c.special_types.length > 0) ? (
                      <div className="flex flex-wrap gap-1">
                        {c.special_types.map((t) => (
                          <span key={t} className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">{t}</span>
                        ))}
                      </div>
                    ) : <span className="text-xs text-gray-400">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-blue-700">{c.total_score}점</span>
                    <span className="text-gray-400 text-xs ml-1">/ 84점</span>
                  </td>
                  <td className="px-4 py-3"><span className={s.cls}>{s.label}</span></td>
                  <td className="px-4 py-3 text-right">
                    <a href={`/customers/${c.id}`} className="text-blue-600 hover:underline flex items-center gap-1 justify-end">
                      상세 <ChevronRight className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 text-right">
            총 {filtered.length}명
          </div>
        )}
      </div>

      {/* 고객 등록 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">신규 고객 등록</h2>
                {selectedAnn && (
                  <p className="text-xs text-gray-500 mt-0.5">대상 공고: {selectedAnn.title}</p>
                )}
              </div>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded-full">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">성명 *</label>
                  <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                  <input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="010-0000-0000"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">주민번호 앞 6자리 *</label>
                  <input required maxLength={6} value={form.rrn_front} onChange={(e) => setForm((p) => ({ ...p, rrn_front: e.target.value.replace(/\D/g,"") }))}
                    placeholder="800101"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">주민번호 뒷 7자리 *</label>
                  <input required type="password" maxLength={7} value={form.rrn_back} onChange={(e) => setForm((p) => ({ ...p, rrn_back: e.target.value.replace(/\D/g,"") }))}
                    placeholder="•••••••"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">주소</label>
                <input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">무주택 기간 (년)</label>
                  <input type="number" min={0} value={form.no_home_years} onChange={(e) => setForm((p) => ({ ...p, no_home_years: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">부양가족 수</label>
                  <input type="number" min={0} value={form.dependents_count} onChange={(e) => setForm((p) => ({ ...p, dependents_count: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">통장 납입 (개월)</label>
                  <input type="number" min={0} value={form.subscription_months} onChange={(e) => setForm((p) => ({ ...p, subscription_months: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
              </div>

              {/* 공고별 동적 특별공급 체크박스 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  특별공급 유형
                  <span className="text-xs text-gray-400 font-normal ml-2">
                    (이 공고에서 모집하는 유형)
                  </span>
                </label>
                {specialTypeOptions.length === 0 ? (
                  <div className="text-xs text-gray-400 py-1">이 공고는 특별공급 유형이 지정되어 있지 않습니다</div>
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
                              : "bg-white text-gray-600 border-gray-300 hover:border-purple-400"
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
    </div>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">로딩 중...</div>}>
      <CustomersPageInner />
    </Suspense>
  );
}
