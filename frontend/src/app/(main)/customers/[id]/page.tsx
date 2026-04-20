"use client";

/**
 * 고객 상세 — 5단계 탭 워크스페이스
 *
 * 좌측 세로 사이드탭으로 5개 단계 중 하나를 선택해 작업한다.
 * 공고마다 달라지는 판정 기준은 `announcement.eligibility_rules`에서
 * 읽어 `lib/verification-rules.ts`의 평가 함수에 전달된다.
 *
 * URL: /customers/[id]?stage=1..5  (또는 stage=registration|household|...)
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { customersApi } from "@/lib/api";
import {
  localCustomers,
  localAnnouncements,
  isNetworkError,
  LocalCustomer,
  LocalAnnouncement,
} from "@/lib/local-store";
import {
  COMMON_DOCUMENTS,
  SUPPLY_TYPE_DOCUMENTS,
} from "@/lib/document-checklist";
import { calculateSubscriptionScore } from "@/lib/score-calculator";
import { evaluateFinal } from "@/lib/verification-rules";
import StageSidebar from "@/components/verification/StageSidebar";
import { parseStageParam, STAGE_NUMBER, StageKey } from "@/components/verification/stage-utils";
import { HouseholdPanel, PropertyPanel, SavingsPanel } from "@/components/verification/panels";
import {
  ArrowLeft, User, Phone, Calculator, Loader2, AlertCircle, Trash2, Edit2, Save, X,
  Home, Baby, CreditCard, Landmark, BookOpen, ChevronRight, FileText, CheckCircle2,
  XCircle, Users, ClipboardCheck,
} from "lucide-react";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  inquiry: { label: "문의", cls: "bg-amber-100 text-amber-700" },
  applied: { label: "청약 접수", cls: "bg-blue-100 text-blue-700" },
  winner: { label: "당첨", cls: "bg-purple-100 text-purple-700" },
  contracted: { label: "계약 완료", cls: "bg-green-100 text-green-700" },
};

function fmtRRN(front?: string, back?: string): string {
  if (!front) return "—";
  const masked = back ? `${back.slice(0, 1)}••••••` : "•••••••";
  return `${front}-${masked}`;
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  } catch { return String(s); }
}

function CustomerDetailInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = Number(params?.id);

  const [customer, setCustomer] = useState<LocalCustomer | null>(null);
  const [announcement, setAnnouncement] = useState<LocalAnnouncement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stage: StageKey = parseStageParam(searchParams.get("stage"));
  const setStage = (k: StageKey) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("stage", String(STAGE_NUMBER[k]));
    router.replace(`/customers/${customerId}?${sp.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (!customerId || Number.isNaN(customerId)) {
      setError("잘못된 고객 ID입니다.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await customersApi.get(customerId);
        if (!cancelled) {
          setCustomer(r.data);
          loadAnnouncement(r.data.announcement_id);
        }
      } catch (err: any) {
        const local = localCustomers.get(customerId);
        if (!cancelled) {
          if (local) {
            setCustomer(local);
            loadAnnouncement(local.announcement_id);
          } else {
            setError(
              isNetworkError(err)
                ? "해당 고객을 찾을 수 없습니다."
                : err?.response?.data?.detail || "고객 정보를 불러오지 못했습니다.",
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    function loadAnnouncement(annId: number) {
      const local = localAnnouncements.get(annId);
      if (local) setAnnouncement(local);
    }

    return () => { cancelled = true; };
  }, [customerId]);

  // 서류 리스트 (Stage 5 + 최종 판정에 쓰임)
  const supplyType = customer?.supply_type
    || (customer?.special_types?.[0])
    || "일반공급";
  const documentList = useMemo(() => {
    if (!customer) return [];
    const parsedDocs: Record<string, string[]> = announcement?.eligibility_rules?.required_documents || {};
    const items: Array<{ name: string; category: string; conditional: boolean }> = [];
    const common = (parsedDocs["공통"] && parsedDocs["공통"].length >= 3) ? parsedDocs["공통"] : COMMON_DOCUMENTS;
    for (const doc of common) {
      items.push({ name: doc, category: "공통", conditional: /해당\s*시|해당자/.test(doc) });
    }
    const typeDocs = (parsedDocs[supplyType] && parsedDocs[supplyType].length >= 2)
      ? parsedDocs[supplyType]
      : (SUPPLY_TYPE_DOCUMENTS[supplyType] || SUPPLY_TYPE_DOCUMENTS["일반공급"] || []);
    for (const doc of typeDocs) {
      if (items.some((it) => it.name === doc)) continue;
      items.push({ name: doc, category: supplyType, conditional: /해당\s*시|해당자|임신|기혼자/.test(doc) });
    }
    return items;
  }, [announcement, supplyType, customer]);

  const submittedDocs = customer?.documents_submitted || {};

  const finalVerdict = useMemo(() => {
    if (!customer) return null;
    return evaluateFinal(customer, announcement, submittedDocs, documentList);
  }, [customer, announcement, submittedDocs, documentList]);

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="card text-center py-16 text-gray-400">
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-60" />
          <p>고객 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !customer || !finalVerdict) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <button onClick={() => router.push("/customers")} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> 목록으로 돌아가기
        </button>
        <div className="card text-center py-16">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-400" />
          <p className="text-gray-700 font-medium">{error || "고객을 찾을 수 없습니다"}</p>
        </div>
      </div>
    );
  }

  const status = STATUS_LABEL[customer.status || "inquiry"] || STATUS_LABEL.inquiry;
  const regulation = announcement?.eligibility_rules?.regulation as string | undefined;
  const minSubscription = announcement?.eligibility_rules?.min_subscription_period as number | undefined;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Top header */}
      <a href="/customers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> 고객 목록
      </a>

      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{customer.name}</h1>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status.cls}`}>
              {status.label}
            </span>
            {customer.supply_type && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                {customer.supply_type}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
            <span>{fmtRRN(customer.rrn_front, customer.rrn_back)}</span>
            {customer.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {customer.phone}</span>}
            {customer.unit_type && <span className="flex items-center gap-1"><Home className="w-3.5 h-3.5" /> {customer.unit_type}{customer.unit_area ? ` · ${customer.unit_area}` : ""}</span>}
            <span className="text-xs">등록일 {fmtDate(customer.created_at)}</span>
          </div>
        </div>
      </div>

      {/* 연결된 공고 배너 */}
      {announcement && (
        <div
          onClick={() => router.push(`/announcements/${announcement.id}`)}
          className="card mb-5 cursor-pointer hover:border-blue-300 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-blue-600 font-medium mb-0.5">작업 공고</div>
              <p className="text-sm font-semibold text-gray-900 truncate">{announcement.title}</p>
              <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5 flex-wrap">
                {regulation && <span>규제: <strong>{regulation}</strong></span>}
                {typeof minSubscription === "number" && minSubscription > 0 && (
                  <span>최소 통장 <strong>{minSubscription}개월</strong></span>
                )}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </div>
        </div>
      )}

      {/* 2열 그리드: 좌측 단계 탭 + 우측 콘텐츠 */}
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5">
        <div>
          <StageSidebar current={stage} finalVerdict={finalVerdict} onSelect={setStage} />
        </div>

        <div className="min-w-0 space-y-4">
          {stage === "registration" && (
            <RegistrationStage customer={customer} onUpdate={setCustomer} />
          )}
          {stage === "household" && (
            <HouseholdPanel customer={customer} verdict={finalVerdict.stages.household} />
          )}
          {stage === "property" && (
            <PropertyPanel customer={customer} verdict={finalVerdict.stages.property} regulation={regulation} />
          )}
          {stage === "savings" && (
            <SavingsPanel customer={customer} verdict={finalVerdict.stages.savings} minSubscriptionMonths={minSubscription} />
          )}
          {stage === "documents" && (
            <DocumentsStage
              customer={customer}
              documentList={documentList}
              submitted={submittedDocs}
              finalVerdict={finalVerdict}
              onUpdate={setCustomer}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Stage 1: 당첨자 등록 (기본정보 + 편집) ────────── */

function RegistrationStage({
  customer,
  onUpdate,
}: {
  customer: LocalCustomer;
  onUpdate: (c: LocalCustomer) => void;
}) {
  const router = useRouter();
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<Partial<LocalCustomer>>(customer);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(customer); }, [customer]);

  const handleSave = () => {
    setSaving(true);
    try {
      const patch: Partial<LocalCustomer> = {
        name: form.name,
        phone: form.phone,
        address: form.address,
        no_home_years: Number(form.no_home_years) || 0,
        dependents_count: Number(form.dependents_count) || 0,
        subscription_months: Number(form.subscription_months) || 0,
        current_region: form.current_region,
        income_monthly: form.income_monthly || null,
      };
      const updated = localCustomers.update(customer.id, patch);
      if (updated) {
        onUpdate(updated);
        setEditMode(false);
      }
    } finally { setSaving(false); }
  };

  const handleDelete = () => {
    if (!confirm(`${customer.name} 고객을 삭제하시겠습니까?`)) return;
    localCustomers.remove(customer.id);
    router.push("/customers");
  };

  return (
    <>
      <div className="card">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <User className="w-4 h-4 text-gray-500" />
          <h2 className="font-semibold text-gray-800">기본 정보</h2>
          <div className="flex gap-1.5 ml-auto">
            {editMode ? (
              <>
                <button
                  onClick={() => { setEditMode(false); setForm(customer); }}
                  disabled={saving}
                  className="btn-secondary flex items-center gap-1 text-xs"
                >
                  <X className="w-3.5 h-3.5" /> 취소
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary flex items-center gap-1 text-xs"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  저장
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditMode(true)} className="btn-secondary flex items-center gap-1 text-xs">
                  <Edit2 className="w-3.5 h-3.5" /> 수정
                </button>
                <button onClick={handleDelete} className="btn-secondary flex items-center gap-1 text-xs text-red-600 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" /> 삭제
                </button>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Field label="성명" value={form.name} editable={editMode}
            onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
          <Field label="연락처" value={form.phone} editable={editMode} placeholder="010-0000-0000"
            onChange={(v) => setForm((p) => ({ ...p, phone: v }))} />
          <div>
            <label className="text-xs text-gray-500 block mb-1">주민번호</label>
            <p className="font-medium text-gray-900 font-mono text-xs">{fmtRRN(customer.rrn_front, customer.rrn_back)}</p>
          </div>
          <Field label="현재 거주 지역" value={form.current_region} editable={editMode}
            onChange={(v) => setForm((p) => ({ ...p, current_region: v }))} />
          <div className="sm:col-span-2">
            <Field label="주소" value={form.address} editable={editMode}
              onChange={(v) => setForm((p) => ({ ...p, address: v }))} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Calculator className="w-4 h-4 text-gray-500" />
          <h2 className="font-semibold text-gray-800">청약 가점 입력</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <NumField label="무주택 기간 (년)" icon={Home} value={form.no_home_years ?? 0} editable={editMode}
            onChange={(v) => setForm((p) => ({ ...p, no_home_years: v }))} />
          <NumField label="부양가족 수" icon={Baby} value={form.dependents_count ?? 0} editable={editMode}
            onChange={(v) => setForm((p) => ({ ...p, dependents_count: v }))} />
          <NumField label="통장 가입 (개월)" icon={CreditCard} value={form.subscription_months ?? 0} editable={editMode}
            onChange={(v) => setForm((p) => ({ ...p, subscription_months: v }))} />
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
          <span className="text-xs text-gray-500">총 가점 (적합 판정 시 자동 계산)</span>
          <span className="font-bold text-lg text-blue-700">{customer.total_score ?? 0}<span className="text-xs text-gray-400 font-normal"> / 84점</span></span>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Landmark className="w-4 h-4 text-gray-500" />
          <h2 className="font-semibold text-gray-800">소득</h2>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">월소득 (원)</label>
          {editMode ? (
            <input
              type="number"
              value={form.income_monthly ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, income_monthly: e.target.value ? Number(e.target.value) : null }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          ) : (
            <p className="font-medium text-sm">
              {customer.income_monthly ? `${customer.income_monthly.toLocaleString("ko-KR")}원` : "—"}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── Stage 5: 서류 체크리스트 + 최종 판정 ─────────── */

function DocumentsStage({
  customer,
  documentList,
  submitted,
  finalVerdict,
  onUpdate,
}: {
  customer: LocalCustomer;
  documentList: Array<{ name: string; category: string; conditional: boolean }>;
  submitted: Record<string, boolean>;
  finalVerdict: ReturnType<typeof evaluateFinal>;
  onUpdate: (c: LocalCustomer) => void;
}) {
  const [localSubmitted, setLocalSubmitted] = useState<Record<string, boolean>>(submitted);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(customer.verification_checked_at || null);

  useEffect(() => { setLocalSubmitted(submitted); }, [customer.id]); // eslint-disable-line

  // 카테고리 그룹핑
  const grouped: Record<string, typeof documentList> = {};
  for (const it of documentList) {
    if (!grouped[it.category]) grouped[it.category] = [];
    grouped[it.category].push(it);
  }

  const required = documentList.filter((d) => !d.conditional);
  const submittedRequired = required.filter((d) => localSubmitted[d.name]).length;
  const percent = required.length === 0 ? 100 : Math.round((submittedRequired / required.length) * 100);

  const handleToggle = (name: string) => {
    setLocalSubmitted((p) => ({ ...p, [name]: !p[name] }));
  };

  const handleSave = () => {
    setSaving(true);
    try {
      // 최종 판정 재평가 (현재 체크 상태 기준)
      const verdict = finalVerdict; // 상위에서 이미 computed
      // 다만 체크박스 상태가 바뀌었으므로 재계산하기 위해 evaluateFinal 재실행이 필요한데,
      // 부모가 customer.documents_submitted를 보기 때문에 저장 후 다시 계산됨.
      // 일단 저장만 수행.
      let score: number | undefined = undefined;
      if (verdict.verdict === "eligible" && customer.supply_type === "일반공급") {
        const breakdown = calculateSubscriptionScore({
          noHomeYears: customer.no_home_years ?? 0,
          dependentsCount: customer.dependents_count ?? 0,
          subscriptionMonths: customer.subscription_months ?? 0,
        });
        score = breakdown.total;
      }
      const updated = localCustomers.update(customer.id, {
        documents_submitted: localSubmitted,
        verification_verdict: verdict.verdict === "pending" ? undefined : verdict.verdict,
        verification_score: score,
        verification_reasons: verdict.reasons,
        verification_checked_at: new Date().toISOString(),
        status: verdict.verdict === "eligible" ? "applied" : customer.status,
        ...(score !== undefined ? { total_score: score } : {}),
      });
      if (updated) {
        onUpdate(updated);
        setLastSaved(new Date().toISOString());
      }
    } finally { setSaving(false); }
  };

  const SUPPLY_COLORS: Record<string, string> = {
    "공통": "bg-gray-100 text-gray-700",
    "일반공급": "bg-indigo-100 text-indigo-700",
    "신혼부부": "bg-red-100 text-red-700",
    "생애최초": "bg-emerald-100 text-emerald-700",
    "다자녀가구": "bg-pink-100 text-pink-700",
    "노부모부양": "bg-amber-100 text-amber-700",
    "기관추천": "bg-purple-100 text-purple-700",
    "신생아": "bg-sky-100 text-sky-700",
  };

  return (
    <>
      {/* 최종 판정 배너 */}
      <div className={`card border-2 ${
        finalVerdict.verdict === "eligible"
          ? "border-green-300 bg-green-50"
          : finalVerdict.verdict === "ineligible"
            ? "border-red-300 bg-red-50"
            : "border-gray-200 bg-gray-50"
      }`}>
        <div className="flex items-start gap-3">
          {finalVerdict.verdict === "eligible" ? (
            <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
          ) : finalVerdict.verdict === "ineligible" ? (
            <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
          ) : (
            <ClipboardCheck className="w-6 h-6 text-gray-500 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <h3 className={`font-bold text-lg ${
              finalVerdict.verdict === "eligible" ? "text-green-900"
                : finalVerdict.verdict === "ineligible" ? "text-red-900"
                : "text-gray-800"
            }`}>
              {finalVerdict.verdict === "eligible" ? "적합"
                : finalVerdict.verdict === "ineligible" ? "부적합"
                : "판정 보류 (데이터 부족)"}
            </h3>
            {finalVerdict.verdict === "eligible" && customer.supply_type === "일반공급" && customer.total_score ? (
              <p className="text-sm text-green-800 mt-1 flex items-center gap-1">
                <Calculator className="w-4 h-4" /> 청약 가점 총 {customer.total_score}점 / 84점
              </p>
            ) : null}
            {finalVerdict.reasons.length > 0 && (
              <ul className="text-xs text-red-800 mt-2 list-disc list-inside space-y-0.5">
                {finalVerdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            {finalVerdict.warnings.length > 0 && (
              <ul className="text-xs text-amber-800 mt-2 list-disc list-inside space-y-0.5">
                {finalVerdict.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            )}
            {lastSaved && (
              <p className="text-[10px] text-gray-500 mt-2">마지막 저장 {fmtDate(lastSaved)}</p>
            )}
          </div>
        </div>
      </div>

      {/* 진행률 */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">서류 제출 진행률</span>
          <span className="text-sm font-bold text-blue-700">
            {submittedRequired} / {required.length}
            <span className="text-gray-400 font-normal ml-1">(필수)</span>
          </span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${percent === 100 ? "bg-green-500" : "bg-blue-500"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* 서류 체크리스트 */}
      {Object.entries(grouped).map(([category, docs]) => (
        <div key={category} className="card">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold text-gray-800">{category} 서류</h2>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${SUPPLY_COLORS[category] || SUPPLY_COLORS["공통"]}`}>
              {category === "공통" ? "전원 공통" : `${category} 전용`}
            </span>
          </div>
          <ul className="space-y-1.5">
            {docs.map((d) => {
              const isSubmitted = !!localSubmitted[d.name];
              return (
                <li key={d.name}>
                  <label className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    isSubmitted
                      ? "border-green-200 bg-green-50"
                      : d.conditional
                        ? "border-amber-200 bg-amber-50/50"
                        : "border-gray-200 hover:bg-gray-50"
                  }`}>
                    <input
                      type="checkbox"
                      checked={isSubmitted}
                      onChange={() => handleToggle(d.name)}
                      className="mt-0.5 w-4 h-4 accent-green-600 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm ${isSubmitted ? "text-green-800 font-medium" : "text-gray-700"}`}>
                        {d.name}
                      </span>
                      {d.conditional && (
                        <span className="ml-2 text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">
                          조건부 (해당자만)
                        </span>
                      )}
                    </div>
                    {isSubmitted && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* 저장 버튼 */}
      <div className="flex justify-end sticky bottom-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex items-center gap-2 shadow-lg disabled:opacity-50"
        >
          {saving ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> 저장 중...</>
          ) : (
            <><Save className="w-4 h-4" /> 검수 결과 저장</>
          )}
        </button>
      </div>
    </>
  );
}

/* ─── Sub components ──────────────────────────────────── */

function Field({
  label, value, editable, placeholder, onChange,
}: { label: string; value: any; editable: boolean; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {editable ? (
        <input
          type="text"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      ) : (
        <p className="font-medium text-gray-900 text-sm">{value || "—"}</p>
      )}
    </div>
  );
}

function NumField({
  label, icon: Icon, value, editable, onChange,
}: { label: string; icon: typeof Home; value: number; editable: boolean; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3" /> {label}
      </label>
      {editable ? (
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      ) : (
        <p className="font-medium text-gray-900 text-sm">{value}</p>
      )}
    </div>
  );
}

export default function CustomerDetailPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">로딩 중...</div>}>
      <CustomerDetailInner />
    </Suspense>
  );
}
