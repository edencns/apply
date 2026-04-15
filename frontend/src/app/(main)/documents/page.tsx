"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { documentsApi, eligibilityApi, customersApi, api } from "@/lib/api";
import {
  localAnnouncements, localCustomers, activeAnnouncement,
  isNetworkError, LocalAnnouncement, LocalCustomer,
} from "@/lib/local-store";
import {
  Upload, FileText, CheckCircle, XCircle, AlertTriangle,
  RefreshCw, Plus, X, BookOpen, ChevronDown, ChevronUp,
  Users, CheckSquare, Square, Play, ChevronRight,
} from "lucide-react";

// ─── 서류 정의 ─────────────────────────────────────────────
interface DocDef {
  type: string;
  reason: string;
  verifies: string;
  required: boolean;
  categories: string[];
}

const DOC_DEFINITIONS: DocDef[] = [
  { type: "주민등록등본",     reason: "현재 세대 구성원 및 주소 확인", verifies: "무주택 세대주 여부, 세대원 수, 현 거주지 확인", required: true,  categories: ["일반공급", "신혼부부", "생애최초", "다자녀", "노부모부양"] },
  { type: "주민등록초본",     reason: "주소 변동 이력 확인",           verifies: "지역 거주 기간, 해당 지역 우선공급 자격 여부",   required: true,  categories: ["일반공급", "신혼부부", "생애최초", "다자녀", "노부모부양"] },
  { type: "가족관계증명서",    reason: "법적 가족 관계 확인",           verifies: "부양가족 수 산정, 가점제 점수 계산",             required: true,  categories: ["일반공급", "신혼부부", "생애최초", "다자녀", "노부모부양"] },
  { type: "소득증빙",         reason: "소득 수준 확인",                verifies: "도시근로자 월평균소득 기준 충족 여부",            required: false, categories: ["신혼부부", "생애최초", "다자녀"] },
  { type: "건강보험료납부확인서", reason: "소득 간접 증빙",             verifies: "소득 기준 대체 확인",                          required: false, categories: ["신혼부부", "생애최초", "다자녀"] },
  { type: "등기사항전부증명서", reason: "주택 소유 이력 확인",          verifies: "과거 주택 소유 여부, 무주택 기간 산정",           required: false, categories: ["일반공급", "생애최초"] },
  { type: "혼인관계증명서",    reason: "혼인 여부 및 기간 확인",        verifies: "신혼부부 특별공급 자격",                        required: false, categories: ["신혼부부"] },
  { type: "청약통장확인서",    reason: "청약 납입 기간 확인",          verifies: "청약통장 납입 월수, 1순위 자격",                  required: true,  categories: ["일반공급", "신혼부부", "생애최초", "다자녀", "노부모부양"] },
];

const DEFAULT_CATEGORIES = ["일반공급", "신혼부부", "생애최초", "다자녀", "노부모부양"];

interface CustomerRow {
  id: number;
  name: string;
  phone?: string;
  special_types?: string[];
  doc_count?: number;
}

interface BatchResult {
  customer_id: number;
  customer_name: string;
  verdict: string;
  verdict_label: string;
  score?: number;
  issues: string[];
  supplement_docs: string[];
}

function DocumentsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryAnnId = searchParams.get("announcementId");

  // ─── 공고 상태 ─────────────────────────────────────────
  const [announcements, setAnnouncements] = useState<LocalAnnouncement[]>([]);
  const [selectedAnn, setSelectedAnn] = useState<LocalAnnouncement | null>(null);

  // ─── 모드: 'bulk' (공고 전체 일괄) | 'picked' (특정 선택) | 'single' (개별 업로드) ─
  const [mode, setMode] = useState<"bulk" | "picked" | "single">("bulk");

  // ─── 고객 목록 (공고 단위) ─────────────────────────────
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ─── 개별 업로드 상태 ─────────────────────────────────
  const [singleCustomerId, setSingleCustomerId] = useState<number | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, { file: File; uploaded: boolean }>>({});
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("일반공급");
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [showGuide, setShowGuide] = useState(false);

  // ─── 일괄 검수 결과 ───────────────────────────────────
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  // ─── 공고 목록 로딩 ────────────────────────────────────
  const loadAnnouncements = useCallback(async () => {
    try {
      const r = await api.get(`/announcements/`);
      setAnnouncements(r.data);
      return r.data;
    } catch (err: any) {
      const local = localAnnouncements.listAll();
      setAnnouncements(local);
      return local;
    }
  }, []);

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
      if (!target && list.length > 0) target = list[0];
      if (target) setSelectedAnn(target);
    })();
  }, [loadAnnouncements, queryAnnId]);

  useEffect(() => {
    if (selectedAnn) {
      activeAnnouncement.set(
        { id: selectedAnn.id, title: selectedAnn.title, announcement_no: selectedAnn.announcement_no },
        "local", selectedAnn,
      );
    }
  }, [selectedAnn]);

  // ─── 고객 목록 로딩 (공고 단위) ─────────────────────────
  const loadCustomers = useCallback(async () => {
    if (!selectedAnn) { setCustomers([]); return; }
    setLoadingCustomers(true);
    try {
      let list: CustomerRow[] = [];
      try {
        const r = await api.get(`/customers/announcement/${selectedAnn.id}`);
        list = r.data;
      } catch (e404: any) {
        if (e404?.response?.status === 404) {
          const r2 = await customersApi.list(selectedAnn.site_id);
          list = r2.data;
        } else throw e404;
      }
      setCustomers(list);
    } catch (err: any) {
      if (isNetworkError(err)) {
        const local = localCustomers.listByAnnouncement(selectedAnn.id);
        setCustomers(local.map((c) => ({
          id: c.id, name: c.name, phone: c.phone, special_types: c.special_types, doc_count: 0,
        })));
      } else {
        setCustomers([]);
      }
    } finally {
      setLoadingCustomers(false);
    }
  }, [selectedAnn]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // 공고 바뀌면 선택 초기화
  useEffect(() => {
    setSelectedIds(new Set());
    setBatchResults([]);
    setSingleCustomerId(null);
    setDocs([]);
    setUploadedFiles({});
  }, [selectedAnn?.id]);

  // ─── 공고 기반 카테고리 ───────────────────────────────
  const availableCategories: string[] = (() => {
    const raw = selectedAnn?.eligibility_rules?.special_supply_types;
    if (Array.isArray(raw) && raw.length > 0) {
      const list = ["일반공급", ...raw];
      return Array.from(new Set(list));
    }
    return DEFAULT_CATEGORIES;
  })();

  useEffect(() => {
    if (!availableCategories.includes(selectedCategory)) {
      setSelectedCategory(availableCategories[0] || "일반공급");
    }
  }, [availableCategories.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 선택 토글 ────────────────────────────────────────
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === customers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(customers.map((c) => c.id)));
    }
  };

  // ─── 일괄 검수 실행 ───────────────────────────────────
  const runBatchCheck = async () => {
    if (!selectedAnn) return;
    const targets = mode === "bulk"
      ? customers
      : customers.filter((c) => selectedIds.has(c.id));
    if (targets.length === 0) {
      alert("검수할 고객이 없습니다");
      return;
    }
    setBatchRunning(true);
    setBatchResults([]);
    setBatchProgress({ done: 0, total: targets.length });

    const results: BatchResult[] = [];
    for (const c of targets) {
      try {
        let data: any;
        try {
          const r = await api.post(`/eligibility/check-customer/${c.id}`, {
            announcement_id: selectedAnn.id,
          });
          data = r.data;
        } catch (err: any) {
          if (isNetworkError(err) || err?.response?.status === 404) {
            // 로컬 폴백: 간단한 규칙 기반 판정
            const local = localCustomers.get(c.id);
            const rules = selectedAnn.eligibility_rules || {};
            const issues: string[] = [];
            if (rules.no_home_required && (local?.no_home_years ?? 0) === 0) {
              issues.push("무주택 기간이 확인되지 않았습니다");
            }
            if (rules.min_subscription_period && (local?.subscription_months ?? 0) < rules.min_subscription_period) {
              issues.push(`청약통장 납입기간 부족 (${local?.subscription_months ?? 0}개월 / 기준 ${rules.min_subscription_period}개월)`);
            }
            if (rules.income_limit && local?.income_monthly && local.income_monthly > rules.income_limit) {
              issues.push(`월소득 초과 (${local.income_monthly.toLocaleString()}원 / 기준 ${rules.income_limit.toLocaleString()}원)`);
            }
            const verdict = issues.length === 0 ? "eligible" : "ineligible";
            data = {
              verdict,
              verdict_label: verdict === "eligible" ? "적격" : "부적격",
              total_score: local?.total_score ?? 0,
              issues,
              supplement_docs: [],
            };
          } else { throw err; }
        }
        results.push({
          customer_id: c.id,
          customer_name: c.name,
          verdict: data.verdict,
          verdict_label: data.verdict_label,
          score: data.total_score,
          issues: data.issues || [],
          supplement_docs: data.supplement_docs || [],
        });
      } catch (err: any) {
        results.push({
          customer_id: c.id,
          customer_name: c.name,
          verdict: "error",
          verdict_label: "오류",
          issues: [err?.response?.data?.detail || err?.message || "판정 실패"],
          supplement_docs: [],
        });
      }
      setBatchProgress((p) => ({ ...p, done: p.done + 1 }));
      setBatchResults([...results]);
    }
    setBatchRunning(false);
  };

  // ─── 개별 업로드 ──────────────────────────────────────
  const loadDocs = useCallback(async (cid: number) => {
    setLoadingDocs(true);
    try {
      const res = await customersApi.listDocuments(cid);
      setDocs(res.data);
    } catch {
      setDocs([]);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  const openSingleCustomer = (id: number) => {
    setMode("single");
    setSingleCustomerId(id);
    setUploadedFiles({});
    loadDocs(id);
  };

  const handleFileUpload = async (docType: string, file: File) => {
    if (!singleCustomerId) return;
    setUploading(docType);
    try {
      await documentsApi.upload(singleCustomerId, file, docType);
      setUploadedFiles((prev) => ({ ...prev, [docType]: { file, uploaded: true } }));
      await loadDocs(singleCustomerId);
    } catch (err: any) {
      alert(err.response?.data?.detail || "업로드 실패");
    } finally {
      setUploading(null);
    }
  };

  const handleFileChange = (docType: string) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFileUpload(docType, file);
    e.target.value = "";
  };

  const filteredDocs = DOC_DEFINITIONS.filter((d) => d.categories.includes(selectedCategory));
  const singleCustomer = customers.find((c) => c.id === singleCustomerId);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* ─── 공고 선택 배너 ───────────────────────────────── */}
      <div className="mb-5 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-blue-600 font-medium">현재 검수 공고</div>
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
          <h1 className="text-2xl font-bold text-gray-900">서류 검수 및 적격 판정</h1>
          <p className="text-sm text-gray-500 mt-1">
            {selectedAnn
              ? `「${selectedAnn.title}」 · 고객 ${customers.length}명`
              : "공고를 먼저 선택해주세요"}
          </p>
        </div>
        <button
          onClick={() => setShowGuide(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors text-sm font-medium"
        >
          <BookOpen className="w-4 h-4" /> 필요 서류 목록
        </button>
      </div>

      {/* ─── 모드 탭 ──────────────────────────────────────── */}
      <div className="flex gap-2 mb-5 border-b border-gray-200">
        {[
          { key: "bulk",   label: "공고 전체 일괄 검수", icon: Play },
          { key: "picked", label: "특정 고객 선택 검수",  icon: CheckSquare },
          { key: "single", label: "개별 서류 업로드",     icon: Upload },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setMode(key as any)}
            className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
              mode === key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ─── 모드별 컨텐츠 ───────────────────────────────── */}
      {mode !== "single" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
          {/* 좌측: 고객 목록 */}
          <div className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-500" />
                <span className="font-semibold text-sm">
                  {mode === "bulk" ? "검수 대상 고객" : "검수할 고객 선택"}
                </span>
                <span className="text-xs text-gray-400">
                  {mode === "picked"
                    ? `${selectedIds.size}명 선택 / 총 ${customers.length}명`
                    : `총 ${customers.length}명`}
                </span>
              </div>
              {mode === "picked" && customers.length > 0 && (
                <button
                  onClick={toggleAll}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                >
                  {selectedIds.size === customers.length
                    ? (<><Square className="w-3 h-3" /> 전체 해제</>)
                    : (<><CheckSquare className="w-3 h-3" /> 전체 선택</>)}
                </button>
              )}
            </div>

            <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
              {!selectedAnn ? (
                <div className="p-6 text-center text-gray-400 text-sm">공고를 선택해주세요</div>
              ) : loadingCustomers ? (
                <div className="p-6 text-center text-gray-400 text-sm">불러오는 중...</div>
              ) : customers.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">이 공고에 등록된 고객이 없습니다</div>
              ) : customers.map((c) => {
                const isChecked = selectedIds.has(c.id);
                return (
                  <div
                    key={c.id}
                    className={`px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors ${
                      mode === "picked" && isChecked ? "bg-blue-50/50" : ""
                    }`}
                  >
                    {mode === "picked" && (
                      <button
                        onClick={() => toggleSelect(c.id)}
                        className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                          isChecked ? "bg-blue-600 border-blue-600" : "bg-white border-gray-300"
                        }`}
                      >
                        {isChecked && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{c.name}</span>
                        {c.special_types?.map((t) => (
                          <span key={t} className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">{t}</span>
                        ))}
                      </div>
                      <div className="text-xs text-gray-400">{c.phone || "-"}</div>
                    </div>
                    <button
                      onClick={() => openSingleCustomer(c.id)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      서류 업로드
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
              <button
                onClick={runBatchCheck}
                disabled={batchRunning || !selectedAnn || customers.length === 0 || (mode === "picked" && selectedIds.size === 0)}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {batchRunning ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> 검수 중... ({batchProgress.done}/{batchProgress.total})</>
                ) : (
                  <><Play className="w-4 h-4" /> {mode === "bulk" ? `전체 ${customers.length}명 일괄 검수` : `선택 ${selectedIds.size}명 검수 시작`}</>
                )}
              </button>
            </div>
          </div>

          {/* 우측: 검수 결과 */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">검수 결과</h2>
              {batchResults.length > 0 && (
                <button
                  onClick={() => setBatchResults([])}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  초기화
                </button>
              )}
            </div>

            {batchResults.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                아직 검수 결과가 없습니다
              </div>
            ) : (
              <>
                {/* 요약 통계 */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { label: "적격",  value: batchResults.filter(r => r.verdict === "eligible").length,   color: "text-green-600 bg-green-50" },
                    { label: "부적격", value: batchResults.filter(r => r.verdict === "ineligible").length, color: "text-red-600 bg-red-50" },
                    { label: "오류",  value: batchResults.filter(r => r.verdict === "error").length,      color: "text-gray-600 bg-gray-50" },
                  ].map((s) => (
                    <div key={s.label} className={`rounded-lg p-2 text-center ${s.color}`}>
                      <div className="text-xl font-bold">{s.value}</div>
                      <div className="text-[10px]">{s.label}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {batchResults.map((r) => (
                    <div key={r.customer_id} className={`p-3 rounded-lg border ${
                      r.verdict === "eligible" ? "border-green-200 bg-green-50" :
                      r.verdict === "ineligible" ? "border-red-200 bg-red-50" :
                      "border-gray-200 bg-gray-50"
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {r.verdict === "eligible" ? <CheckCircle className="w-4 h-4 text-green-600" /> :
                           r.verdict === "ineligible" ? <XCircle className="w-4 h-4 text-red-600" /> :
                           <AlertTriangle className="w-4 h-4 text-gray-500" />}
                          <span className="text-sm font-medium text-gray-900">{r.customer_name}</span>
                        </div>
                        <span className={`text-xs font-medium ${
                          r.verdict === "eligible" ? "text-green-700" :
                          r.verdict === "ineligible" ? "text-red-700" : "text-gray-600"
                        }`}>{r.verdict_label}</span>
                      </div>
                      {r.issues.length > 0 && (
                        <ul className="mt-1 text-xs text-red-600 space-y-0.5">
                          {r.issues.map((is, i) => <li key={i}>• {is}</li>)}
                        </ul>
                      )}
                      {r.supplement_docs.length > 0 && (
                        <div className="mt-1 text-xs text-amber-700">
                          보완서류: {r.supplement_docs.join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── 개별 업로드 모드 ──────────────────────────────── */}
      {mode === "single" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">
                {singleCustomer ? `${singleCustomer.name}님 서류` : "고객 선택"}
              </h2>
              {singleCustomerId && (
                <button
                  onClick={() => { setSingleCustomerId(null); setDocs([]); setUploadedFiles({}); }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  다른 고객 선택
                </button>
              )}
            </div>

            {!singleCustomerId ? (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {customers.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">등록된 고객이 없습니다</div>
                ) : customers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openSingleCustomer(c.id)}
                    className="w-full px-3 py-2 text-left border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50/50 transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-sm">{c.name}</div>
                      <div className="text-xs text-gray-400">{c.phone || "-"}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </button>
                ))}
              </div>
            ) : (
              <>
                {/* 공급 유형 선택 */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-700 mb-1">공급 유형</label>
                  <div className="flex flex-wrap gap-2">
                    {availableCategories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          selectedCategory === cat
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 서류 체크리스트 */}
                <div className="space-y-2">
                  {filteredDocs.map((docDef) => {
                    const uploaded = uploadedFiles[docDef.type];
                    const isUploading = uploading === docDef.type;
                    const isExpanded = expandedDoc === docDef.type;
                    const submittedDoc = docs.find((d: any) => d.doc_type === docDef.type);

                    return (
                      <div
                        key={docDef.type}
                        className={`border rounded-lg overflow-hidden transition-all ${
                          uploaded?.uploaded || submittedDoc
                            ? "border-green-200 bg-green-50"
                            : docDef.required
                            ? "border-gray-200 bg-white"
                            : "border-dashed border-gray-200 bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          {uploaded?.uploaded || submittedDoc ? (
                            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                          ) : (
                            <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 ${docDef.required ? "border-blue-400" : "border-gray-300"}`} />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-800">{docDef.type}</span>
                              {docDef.required && <span className="text-xs text-red-500 font-medium">필수</span>}
                            </div>
                            <p className="text-xs text-gray-500 truncate">{docDef.reason}</p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => setExpandedDoc(isExpanded ? null : docDef.type)}
                              className="p-1 text-gray-400 hover:text-gray-600 rounded"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            <button
                              type="button"
                              disabled={isUploading}
                              onClick={() => fileInputRefs.current[docDef.type]?.click()}
                              className={`p-1.5 rounded-md transition-colors flex items-center justify-center ${
                                isUploading ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                              }`}
                            >
                              {isUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            </button>
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              className="hidden"
                              disabled={isUploading}
                              ref={(el) => { fileInputRefs.current[docDef.type] = el; }}
                              onChange={handleFileChange(docDef.type)}
                            />
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="px-3 pb-2.5 pt-0 border-t border-gray-100 bg-white">
                            <p className="text-xs text-gray-600 mt-2">
                              <span className="font-medium text-gray-700">확인 내용: </span>{docDef.verifies}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold mb-3">진행 현황</h2>
            <div className="text-sm text-gray-600">
              개별 서류 업로드 후 좌측 상단 탭에서 「공고 전체 일괄 검수」 또는 「특정 고객 선택 검수」로 이동하여 적격 판정을 실행하세요.
            </div>
          </div>
        </div>
      )}

      {/* ─── 필요 서류 목록 모달 ─────────────────────────── */}
      {showGuide && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">필요 서류 목록</h2>
              </div>
              <button onClick={() => setShowGuide(false)} className="p-1 hover:bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex gap-1 px-6 pt-4 overflow-x-auto">
              {availableCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    selectedCategory === cat ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-3">
              {DOC_DEFINITIONS.filter((d) => d.categories.includes(selectedCategory)).map((doc) => (
                <div key={doc.type} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      <span className="font-semibold text-gray-900">{doc.type}</span>
                    </div>
                    {doc.required
                      ? <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">필수</span>
                      : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">선택</span>}
                  </div>
                  <p className="text-sm text-gray-600 mb-1.5">
                    <span className="font-medium text-gray-700">제출 이유: </span>{doc.reason}
                  </p>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium text-gray-700">확인 내용: </span>{doc.verifies}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">로딩 중...</div>}>
      <DocumentsPageInner />
    </Suspense>
  );
}
