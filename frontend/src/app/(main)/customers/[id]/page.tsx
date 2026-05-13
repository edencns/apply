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
  parseDocumentName,
  APPLYHOME_AUTO_VERIFIED_DOCUMENTS,
} from "@/lib/document-checklist";
import { calculateSubscriptionScore } from "@/lib/score-calculator";
import { formatPhoneInput, formatPhone } from "@/lib/housing-code";
import { evaluateFinal } from "@/lib/verification-rules";
import { getCheckpointsForDocument } from "@/lib/document-checkpoints";
import { getDocumentGuide } from "@/lib/document-guides";
import { findStandbyCandidates, buildPromotionUpdates, PromotionCandidate } from "@/lib/standby-promotion";
import { pullAll } from "@/lib/cloud-sync";
import { uploadFileViaClient } from "@/lib/client-upload";
import { useRealtimeSync } from "@/lib/realtime/useRealtimeSync";
import StageSidebar from "@/components/verification/StageSidebar";
import { parseStageParam, STAGE_NUMBER, StageKey } from "@/components/verification/stage-utils";
import { HouseholdPanel, PropertyPanel, SavingsPanel } from "@/components/verification/panels";
import ManualReviewBlock from "@/components/ManualReviewBlock";
import PastWinningsBlock from "@/components/PastWinningsBlock";
import TitleTransferBlock from "@/components/TitleTransferBlock";
import DocumentPageMapper from "@/components/DocumentPageMapper";
import {
  ArrowLeft, User, Phone, Calculator, Loader2, AlertCircle, Trash2, Edit2, Save, X,
  Home, Baby, CreditCard, Landmark, BookOpen, ChevronRight, FileText, CheckCircle2,
  XCircle, Users, ClipboardCheck, ArrowUpCircle, UserX,
} from "lucide-react";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  inquiry: { label: "문의", cls: "bg-amber-100 text-amber-700" },
  applied: { label: "청약 접수", cls: "bg-accent-soft text-accent" },
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

  // 실시간: 이 고객·관련 공고가 바뀌면 자동 재조회
  useRealtimeSync({
    announcementId: customer?.announcement_id,
    onCustomerChange: async () => {
      await pullAll().catch(() => {});
      const fresh = localCustomers.get(customerId);
      if (fresh) setCustomer(fresh);
    },
    onAnnouncementChange: async () => {
      await pullAll().catch(() => {});
      if (customer) {
        const ann = localAnnouncements.get(customer.announcement_id);
        if (ann) setAnnouncement(ann);
      }
    },
  });

  // 서류 리스트 (Stage 5 + 최종 판정에 쓰임)
  const supplyType = customer?.supply_type
    || (customer?.special_types?.[0])
    || "일반공급";
  const documentList = useMemo(() => {
    if (!customer) return [];
    const parsedDocs: Record<string, string[]> = announcement?.eligibility_rules?.required_documents || {};
    const items: Array<{
      name: string;
      shortName: string;
      condition?: string;
      category: string;
      conditional: boolean;
    }> = [];
    // shortName으로 중복 제거 + 업그레이드:
    //   - 같은 서류가 공통(추가) + 공급유형(필수)에 동시에 있으면 공급유형 필수 버전이 이김
    //   - 둘 다 같은 conditional 상태면 먼저 들어온 쪽(공통)을 유지
    const indexByShort = new Map<string, number>();
    const pushOrUpgrade = (raw: string, category: string) => {
      const { shortName, condition, isConditional } = parseDocumentName(raw);
      const existingIdx = indexByShort.get(shortName);
      if (existingIdx === undefined) {
        indexByShort.set(shortName, items.length);
        items.push({ name: raw, shortName, condition, category, conditional: isConditional });
        return;
      }
      const existing = items[existingIdx];
      // 기존이 추가(해당자)인데 새 항목이 필수면 업그레이드
      if (existing.conditional && !isConditional) {
        items[existingIdx] = { name: raw, shortName, condition, category, conditional: isConditional };
      }
      // 그 외(둘 다 필수, 둘 다 추가, 또는 기존이 필수): 무시
    };

    const common = (parsedDocs["공통"] && parsedDocs["공통"].length >= 3) ? parsedDocs["공통"] : COMMON_DOCUMENTS;
    for (const doc of common) pushOrUpgrade(doc, "공통");

    const typeDocs = (parsedDocs[supplyType] && parsedDocs[supplyType].length >= 2)
      ? parsedDocs[supplyType]
      : (SUPPLY_TYPE_DOCUMENTS[supplyType] || SUPPLY_TYPE_DOCUMENTS["일반공급"] || []);
    for (const doc of typeDocs) pushOrUpgrade(doc, supplyType);

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
        <div className="card text-center py-16 text-ink-4">
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-60" />
          <p>고객 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !customer || !finalVerdict) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <button onClick={() => router.push("/workflow/registration")} className="text-sm text-ink-2 hover:text-ink flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> 목록으로 돌아가기
        </button>
        <div className="card text-center py-16">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-400" />
          <p className="text-ink-2 font-medium">{error || "고객을 찾을 수 없습니다"}</p>
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
      <a href="/workflow/registration" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> 당첨자 목록
      </a>

      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className={`text-2xl font-bold ${customer.superseded ? "text-ink-4 line-through" : "text-ink"}`}>{customer.name}</h1>
            {customer.superseded ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-200 text-ink-2">
                포기·승계 완료
              </span>
            ) : customer.succeeded_from ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                예비 승계
              </span>
            ) : customer.is_standby ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700 border border-amber-200">
                예비 {customer.standby_rank || ""}순위
              </span>
            ) : (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status.cls}`}>
                {status.label}
              </span>
            )}
            {customer.supply_type && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                {customer.supply_type}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-ink-3 flex-wrap">
            {((customer as any).unit_dong || customer.winner_info?.building || (customer as any).unit_ho || customer.winner_info?.unit_no) && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-900 font-mono text-[13px] font-bold"
                title="당첨 동·호수"
              >
                🏠 {(customer as any).unit_dong || customer.winner_info?.building || "?"}동 {(customer as any).unit_ho || customer.winner_info?.unit_no || "?"}호
              </span>
            )}
            <span>{fmtRRN(customer.rrn_front, customer.rrn_back)}</span>
            {customer.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {formatPhone(customer.phone)}</span>}
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
            <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-accent font-medium mb-0.5">작업 공고</div>
              <p className="text-sm font-semibold text-ink truncate">{announcement.title}</p>
              <div className="flex items-center gap-3 text-[11px] text-ink-3 mt-0.5 flex-wrap">
                {regulation && <span>규제: <strong>{regulation}</strong></span>}
                {typeof minSubscription === "number" && minSubscription > 0 && (
                  <span>최소 통장 <strong>{minSubscription}개월</strong></span>
                )}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-ink-4 flex-shrink-0" />
          </div>
        </div>
      )}

      {/* 2열 그리드: 좌측 단계 탭 + 우측 콘텐츠 */}
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5">
        <div>
          <StageSidebar
            current={stage}
            finalVerdict={finalVerdict}
            onSelect={setStage}
            customer={customer}
          />
        </div>

        <div className="min-w-0 space-y-4">
          {stage === "registration" && (
            <RegistrationStage customer={customer} onUpdate={setCustomer} />
          )}
          {stage === "household" && (
            <HouseholdPanel customer={customer} verdict={finalVerdict.stages.household} />
          )}
          {stage === "property" && (
            <PropertyPanel customer={customer} verdict={finalVerdict.stages.property} regulation={regulation} onUpdate={setCustomer} />
          )}
          {stage === "savings" && (
            <SavingsPanel customer={customer} verdict={finalVerdict.stages.savings} minSubscriptionMonths={minSubscription} />
          )}
          {stage === "documents" && (
            <DocumentsStage
              customer={customer}
              announcement={announcement}
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
    router.push("/workflow/registration");
  };

  return (
    <>
      {customer.superseded && (
        <div className="card border-2 border-gray-300 bg-surface2">
          <div className="flex items-start gap-3">
            <UserX className="w-5 h-5 text-ink-3 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-ink">이 고객은 포기·승계 완료 상태입니다</p>
              <p className="text-xs text-ink-2 mt-1">
                사유: {customer.supersede_reason || "부적합 판정"}
                {customer.supersede_at && ` · ${fmtDate(customer.supersede_at)}`}
              </p>
              <p className="text-[11px] text-ink-3 mt-2">
                정보는 읽기 전용으로만 열람됩니다. 검증 단계는 더 이상 유효하지 않습니다.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <User className="w-4 h-4 text-ink-3" />
          <h2 className="font-semibold text-ink">기본 정보</h2>
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
          <Field
            label="연락처"
            value={form.phone}
            editable={editMode}
            placeholder="010-0000-0000"
            format={formatPhoneInput}
            displayFormat={formatPhone}
            inputMode="tel"
            maxLength={13}
            onChange={(v) => setForm((p) => ({ ...p, phone: v }))}
          />
          <div>
            <label className="text-xs text-ink-3 block mb-1">주민번호</label>
            <p className="font-medium text-ink font-mono text-xs">{fmtRRN(customer.rrn_front, customer.rrn_back)}</p>
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
          <Calculator className="w-4 h-4 text-ink-3" />
          <h2 className="font-semibold text-ink">청약 가점 입력</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <NumField label="무주택 기간 (년)" icon={Home} value={form.no_home_years ?? 0} editable={editMode}
            onChange={(v) => setForm((p) => ({ ...p, no_home_years: v }))} />
          <NumField label="부양가족 수" icon={Baby} value={form.dependents_count ?? 0} editable={editMode}
            onChange={(v) => setForm((p) => ({ ...p, dependents_count: v }))} />
          <NumField label="통장 가입 (개월)" icon={CreditCard} value={form.subscription_months ?? 0} editable={editMode}
            onChange={(v) => setForm((p) => ({ ...p, subscription_months: v }))} />
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-soft">
          <span className="text-xs text-ink-3">총 가점 (적합 판정 시 자동 계산)</span>
          <span className="font-bold text-lg text-accent">{customer.total_score ?? 0}<span className="text-xs text-ink-4 font-normal"> / 84점</span></span>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Landmark className="w-4 h-4 text-ink-3" />
          <h2 className="font-semibold text-ink">소득</h2>
        </div>
        <div>
          <label className="text-xs text-ink-3 block mb-1">월소득 (원)</label>
          {editMode ? (
            <input
              type="number"
              value={form.income_monthly ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, income_monthly: e.target.value ? Number(e.target.value) : null }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent text-sm"
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
  announcement,
  documentList,
  submitted,
  finalVerdict,
  onUpdate,
}: {
  customer: LocalCustomer;
  announcement: LocalAnnouncement | null;
  documentList: Array<{
    name: string;
    shortName: string;
    condition?: string;
    category: string;
    conditional: boolean;
  }>;
  submitted: Record<string, boolean>;
  finalVerdict: ReturnType<typeof evaluateFinal>;
  onUpdate: (c: LocalCustomer) => void;
}) {
  const [localSubmitted, setLocalSubmitted] = useState<Record<string, boolean>>(submitted);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(customer.verification_checked_at || null);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [mapperOpen, setMapperOpen] = useState(false);
  const [mapperInitialPage, setMapperInitialPage] = useState(1);

  useEffect(() => { setLocalSubmitted(submitted); }, [customer.id]); // eslint-disable-line

  const docFiles = customer.document_files || {};
  const bundle = docFiles["서류 묶음(통합)"];

  /** 매퍼 열기 — 특정 서류의 기존 지정 페이지에서 시작 */
  const openMapperFor = (docName?: string) => {
    if (docName && docFiles[docName]) {
      const f: any = docFiles[docName];
      const pages: number[] | undefined = f.pages;
      const startPage = (pages && pages.length > 0) ? pages[0] : (f.page || 1);
      setMapperInitialPage(startPage);
    } else {
      setMapperInitialPage(1);
    }
    setMapperOpen(true);
  };

  /**
   * 페이지 토글:
   *   page=number → 기존 pages에 토글 (있으면 제거, 없으면 추가)
   *   page=undefined → 해당 서류의 페이지 지정 전체 해제
   */
  const handleAssignPage = (docName: string, page: number | undefined) => {
    // ★ stale state 회피 — 매번 localStorage에서 최신 customer 읽기.
    //   applyAllSuggestionsForDoc 처럼 동기 루프로 여러 번 호출될 때 React state는
    //   아직 갱신 전이라 누락 발생. localStorage는 즉시 반영됨.
    const latest = localCustomers.get(customer.id) || customer;
    const nextFiles = { ...(latest.document_files || {}) };
    const prev: any = nextFiles[docName] || {};
    if (page === undefined) {
      // 전체 해제 — 메타데이터(파일/체크포인트)는 유지하되 페이지 매핑만 제거
      const keepCheckpoints = prev.checkpointResults;
      const keepFile = prev.url ? { url: prev.url, filename: prev.filename, uploadedAt: prev.uploadedAt, fileId: prev.fileId } : null;
      if (keepFile || keepCheckpoints) {
        nextFiles[docName] = {
          ...(keepFile || { url: "", filename: "", uploadedAt: new Date().toISOString() }),
          ...(keepCheckpoints ? { checkpointResults: keepCheckpoints } : {}),
        };
      } else {
        delete nextFiles[docName];
      }
      setLocalSubmitted((p) => ({ ...p, [docName]: false }));
    } else {
      // 토글 — 다페이지 지원. 레거시 page 필드는 pages로 흡수.
      const existingPages: number[] = Array.isArray(prev.pages)
        ? [...prev.pages]
        : (prev.page ? [prev.page] : []);
      const idx = existingPages.indexOf(page);
      let nextPages: number[];
      if (idx >= 0) {
        nextPages = existingPages.filter((p) => p !== page);
      } else {
        nextPages = [...existingPages, page].sort((a, b) => a - b);
      }
      const meta = prev.url
        ? { url: prev.url, filename: prev.filename, uploadedAt: prev.uploadedAt, uploadedBy: prev.uploadedBy, fileId: prev.fileId }
        : { url: "", filename: "", uploadedAt: new Date().toISOString() };
      nextFiles[docName] = {
        ...meta,
        ...(prev.checkpointResults ? { checkpointResults: prev.checkpointResults } : {}),
        // 첫 페이지를 page에도 넣어 기존 코드(file.page) 호환
        ...(nextPages.length > 0
          ? { pages: nextPages, page: nextPages[0] }
          : {}),
      };
      setLocalSubmitted((p) => ({ ...p, [docName]: nextPages.length > 0 }));
    }
    const isNowSubmitted = !!(nextFiles[docName] as any)?.pages?.length;
    // documents_submitted도 latest 기준으로 갱신 (stale localSubmitted 회피)
    const latestSubmitted = { ...(latest.documents_submitted || {}) };
    latestSubmitted[docName] = isNowSubmitted;
    const updated = localCustomers.update(customer.id, {
      document_files: nextFiles,
      documents_submitted: latestSubmitted,
    } as any);
    if (updated) onUpdate(updated);
  };

  /** 특정 서류에 PDF/이미지 업로드 → Blob → customer.document_files에 저장
   *  Vercel 함수 본문 제한(~4.5MB) 우회를 위해 클라이언트 직접 업로드 사용. */
  const handleUploadDoc = async (docName: string, file: File) => {
    setUploadingDoc(docName);
    try {
      const json = await uploadFileViaClient(file, {
        kind: "other",
        announcement_id: customer.announcement_id || null,
      });

      // 업로드 직후 customer state는 stale일 수 있음 — localStorage에서 latest 읽기
      const latest = localCustomers.get(customer.id) || customer;
      const nextFiles = { ...(latest.document_files || {}) };
      nextFiles[docName] = {
        url: json.url,
        filename: file.name,
        uploadedAt: new Date().toISOString(),
        fileId: json.id,
      };
      const submittedNow = latest.documents_submitted || {};
      const updated = localCustomers.update(customer.id, {
        document_files: nextFiles,
        documents_submitted: { ...submittedNow, [docName]: true },
      } as any);
      if (updated) onUpdate(updated);

      // 업로드와 동시에 체크박스 자동 체크 (UI state도 동기화)
      setLocalSubmitted((p) => ({ ...p, [docName]: true }));
    } catch (err: any) {
      alert(err?.message || "업로드 실패");
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleRemoveDoc = (docName: string) => {
    if (!confirm(`${docName} 파일 연결을 해제할까요? (원본은 유지됩니다)`)) return;
    const nextFiles = { ...(customer.document_files || {}) };
    delete nextFiles[docName];
    const updated = localCustomers.update(customer.id, {
      document_files: nextFiles,
    } as any);
    if (updated) onUpdate(updated);
  };

  /** 체크포인트 상태 변경 (pass/fail/pending) + 메모 저장 */
  const handleCheckpointChange = (
    docName: string,
    cpKey: string,
    next: { status?: "pass" | "fail" | "pending"; note?: string },
  ) => {
    const nextFiles = { ...(customer.document_files || {}) };
    const entry = nextFiles[docName] || {
      url: "",
      filename: "",
      uploadedAt: new Date().toISOString(),
    };
    const prevResults = entry.checkpointResults || {};
    const prev = prevResults[cpKey] || { status: "pending" as const };
    nextFiles[docName] = {
      ...entry,
      checkpointResults: {
        ...prevResults,
        [cpKey]: {
          status: next.status ?? prev.status,
          note: next.note !== undefined ? next.note : prev.note,
        },
      },
    };
    const updated = localCustomers.update(customer.id, {
      document_files: nextFiles,
    } as any);
    if (updated) onUpdate(updated);
  };

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
    "공통": "bg-surface2 text-ink-2",
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
            : "border-border bg-surface2"
      }`}>
        <div className="flex items-start gap-3">
          {finalVerdict.verdict === "eligible" ? (
            <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
          ) : finalVerdict.verdict === "ineligible" ? (
            <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
          ) : (
            <ClipboardCheck className="w-6 h-6 text-ink-3 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <h3 className={`font-bold text-lg ${
              finalVerdict.verdict === "eligible" ? "text-green-900"
                : finalVerdict.verdict === "ineligible" ? "text-red-900"
                : "text-ink"
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
              <p className="text-[10px] text-ink-3 mt-2">마지막 저장 {fmtDate(lastSaved)}</p>
            )}
          </div>
        </div>
      </div>

      {/* 예비 승계 섹션 — 당첨자가 부적합이거나 이미 포기/승계 완료된 경우 */}
      {/* Phase #5 — 판정 결과 면책 디스클레이머 */}
      <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-[11px] text-red-800 flex items-start gap-1.5">
        <span>⚠️</span>
        <span>
          이 판정은 자동 로직 기준이며 <strong>최종 결정은 담당자</strong>가
          공고 원문·법령·서류 원본을 직접 확인 후 내립니다. 정책 개정은 수시 발생.
        </span>
      </div>

      {/* Phase #8 — 청약홈 과거 당첨 이력 */}
      <PastWinningsBlock customer={customer} onUpdate={(c) => c && onUpdate(c)} />

      {/* 명의변경 이력 — 계약 체결 이후 상속·증여·전매 발생 시 */}
      <TitleTransferBlock customer={customer} onUpdate={(c) => c && onUpdate(c)} />

      {/* Phase #6 — 담당자 승인 체크리스트 + 서명 */}
      <ManualReviewBlock customer={customer} onUpdate={(c) => c && onUpdate(c)} />

      <StandbyPromotionBlock
        customer={customer}
        verdict={finalVerdict.verdict}
        onUpdate={onUpdate}
      />

      {/* 진행률 */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-ink-2">서류 제출 진행률</span>
          <span className="text-sm font-bold text-accent">
            {submittedRequired} / {required.length}
            <span className="text-ink-4 font-normal ml-1">(필수)</span>
          </span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${percent === 100 ? "bg-green-500" : "bg-accent-soft0"}`}
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* 서류 묶음 PDF 매퍼 진입점 */}
        {bundle?.url && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => openMapperFor()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm"
            >
              📋 페이지 매퍼 열기
            </button>
            <span className="text-[11px] text-ink-3">
              묶음 PDF를 페이지별로 넘기며 각 서류 위치를 한 번에 지정합니다
            </span>
            <a
              href={bundle.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-accent hover:underline ml-auto"
            >
              📄 전체 PDF 원본 ({bundle.filename || "열기"})
            </a>
          </div>
        )}
      </div>

      {/* 서류 체크리스트 */}
      {Object.entries(grouped).map(([category, docs]) => (
        <div key={category} className="card">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-ink-3" />
            <h2 className="font-semibold text-ink">{category} 서류</h2>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${SUPPLY_COLORS[category] || SUPPLY_COLORS["공통"]}`}>
              {category === "공통" ? "전원 공통" : `${category} 전용`}
            </span>
          </div>
          <ul className="space-y-2">
            {docs.map((d) => {
              const isSubmitted = !!localSubmitted[d.name];
              const file = docFiles[d.name];
              const checkpoints = getCheckpointsForDocument(d.name, customer, announcement || undefined);
              const isUploading = uploadingDoc === d.name;
              // 청약홈을 통해 자동 검증된 서류인지 (청약홈 신청자만 해당)
              const isApplyhomeAuto = customer.registration_source === "applyhome"
                && APPLYHOME_AUTO_VERIFIED_DOCUMENTS.includes(d.name);
              return (
                <li key={d.name} className={`p-3 rounded-lg border transition-colors ${
                  isSubmitted
                    ? "border-green-200 bg-green-50/60"
                    : d.conditional
                      ? "border-amber-200 bg-amber-50/40"
                      : "border-border"
                }`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSubmitted}
                      onChange={() => handleToggle(d.name)}
                      className="mt-0.5 w-4 h-4 accent-green-600 flex-shrink-0 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-1.5">
                        <span className={`text-sm ${isSubmitted ? "text-green-800 font-medium" : "text-ink-2 font-medium"}`}>
                          {d.shortName || d.name}
                        </span>
                        {d.conditional ? (
                          <span
                            className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-semibold"
                            title={d.condition ? `해당자 — ${d.condition}만 제출` : "해당자만 제출"}
                          >
                            추가(해당자)
                          </span>
                        ) : (
                          d.name !== "서류 묶음(통합)" && (
                            <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-semibold">
                              필수
                            </span>
                          )
                        )}
                        {isApplyhomeAuto && (
                          <span
                            className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-0.5"
                            title="청약홈을 통해 청약 신청 시 이미 검증된 서류 — 별도 제출 불필요"
                          >
                            ✓ 청약홈 자동확인
                          </span>
                        )}
                        {/* 묶음 PDF 내 지정된 페이지 표시 — 다페이지 지원 */}
                        {(() => {
                          if (!bundle?.url || d.name === "서류 묶음(통합)") return null;
                          const pages = (file as any)?.pages as number[] | undefined;
                          const list = pages && pages.length > 0
                            ? pages
                            : (file?.page ? [file.page] : []);
                          if (list.length === 0) return null;
                          return (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium">
                              📄 {list.join(", ")}p
                            </span>
                          );
                        })()}
                        {/* 개별 업로드된 파일 (드물게) */}
                        {file?.url && d.name !== "서류 묶음(통합)" && !bundle?.url && (
                          <a
                            href={file.page && file.page > 1 ? `${file.url}#page=${file.page}` : file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline"
                          >
                            📄 개별 파일 열기
                          </a>
                        )}
                        {/* 묶음 PDF 자체의 경우 원본 열기 */}
                        {d.name === "서류 묶음(통합)" && file?.url && (
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline"
                            title={file.filename}
                          >
                            📄 전체 PDF 열기
                          </a>
                        )}
                      </div>

                      {/* 조건 / 해당자 안내 */}
                      {d.condition && (
                        <div className={`mt-0.5 text-[10.5px] ${
                          d.conditional ? "text-amber-800" : "text-ink-3"
                        }`}>
                          {d.conditional ? <strong>해당 시:</strong> : "📝 "}
                          {" "}{d.condition}
                        </div>
                      )}

                      {/* 검토 가이드 — 서류별 법령·규칙 설명 (담당자가 처음 봐도 검토 가능) */}
                      {(() => {
                        const guide = getDocumentGuide(d.shortName || d.name);
                        if (!guide) return null;
                        return (
                          <details
                            className="mt-1.5 rounded border border-indigo-100 bg-indigo-50/40 text-[11px]"
                            open={!isSubmitted}
                          >
                            <summary className="cursor-pointer px-2 py-1 text-[10.5px] font-semibold text-indigo-900 select-none flex items-center gap-1">
                              <span>📖 검토 가이드 — {d.shortName || d.name}</span>
                              <span className="text-[9.5px] font-normal text-indigo-700">
                                (이 서류로 무엇을 어떻게 확인하는지)
                              </span>
                            </summary>
                            <div className="px-2.5 pb-2 pt-0.5 space-y-1.5 text-ink-2">
                              <div>
                                <span className="text-[9.5px] font-semibold text-indigo-800 uppercase tracking-wide">
                                  목적
                                </span>
                                <div className="mt-0.5 leading-snug">{guide.purpose}</div>
                              </div>
                              <div>
                                <span className="text-[9.5px] font-semibold text-indigo-800 uppercase tracking-wide">
                                  검토 기준 (법령·공고)
                                </span>
                                <ul className="mt-0.5 space-y-0.5 list-disc list-outside ml-3.5 leading-snug">
                                  {guide.rules.map((r, i) => (
                                    <li key={i}>{r}</li>
                                  ))}
                                </ul>
                              </div>
                              {guide.pitfalls && guide.pitfalls.length > 0 && (
                                <div>
                                  <span className="text-[9.5px] font-semibold text-amber-800 uppercase tracking-wide">
                                    ⚠ 자주 놓치는 함정
                                  </span>
                                  <ul className="mt-0.5 space-y-0.5 list-disc list-outside ml-3.5 leading-snug text-amber-900">
                                    {guide.pitfalls.map((p, i) => (
                                      <li key={i}>{p}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {guide.validity && (
                                <div className="text-[10.5px] text-ink-3">
                                  <span className="font-semibold">유효기간·발급:</span>{" "}
                                  {guide.validity}
                                </div>
                              )}
                            </div>
                          </details>
                        );
                      })()}

                      {/* 체크포인트 */}
                      {checkpoints.length > 0 && (
                        <div className="mt-1.5 p-2 rounded bg-white/60 border border-blue-100 text-[11px] space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-semibold text-blue-900">
                              💡 담당자 확인 포인트
                            </div>
                            <div className="text-[9.5px] text-ink-4">
                              {(() => {
                                const results = file?.checkpointResults || {};
                                const done = checkpoints.filter((c) => results[c.key]?.status === "pass").length;
                                return `${done}/${checkpoints.length} 확인`;
                              })()}
                            </div>
                          </div>
                          {checkpoints.map((cp) => {
                            const result = file?.checkpointResults?.[cp.key];
                            const status = result?.status || "pending";
                            return (
                              <div key={cp.key} className={`flex items-start gap-1.5 p-1 rounded ${
                                status === "pass" ? "bg-green-50" : status === "fail" ? "bg-red-50" : ""
                              }`}>
                                <span className={`flex-shrink-0 mt-0.5 ${
                                  cp.severity === "must"
                                    ? "text-red-600"
                                    : cp.severity === "verify"
                                      ? "text-amber-600"
                                      : "text-ink-3"
                                }`}>
                                  {cp.severity === "must" ? "●" : cp.severity === "verify" ? "◉" : "◯"}
                                </span>
                                <div className="flex-1 text-ink-2">
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <span>{cp.label}</span>
                                    {cp.expected && (
                                      <span className="font-semibold text-ink">
                                        {cp.expected}
                                      </span>
                                    )}
                                    <span className="text-[9px] text-ink-4">
                                      [{cp.source}]
                                    </span>
                                  </div>
                                  {cp.hint && (
                                    <div className="text-[10px] text-ink-4 mt-0.5">
                                      ↳ {cp.hint}
                                    </div>
                                  )}
                                  {/* 메모 입력 */}
                                  {(status !== "pending" || result?.note) && (
                                    <input
                                      value={result?.note || ""}
                                      onChange={(e) => handleCheckpointChange(d.name, cp.key, { note: e.target.value })}
                                      placeholder="메모 (선택)"
                                      className="mt-1 w-full border border-gray-200 rounded px-1.5 py-0.5 text-[10px] bg-white"
                                    />
                                  )}
                                </div>
                                {/* 상태 토글 */}
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleCheckpointChange(d.name, cp.key, { status: "pass" })}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition ${
                                      status === "pass"
                                        ? "bg-green-600 text-white"
                                        : "bg-gray-100 text-ink-3 hover:bg-green-100"
                                    }`}
                                    title="확인 완료 (일치)"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCheckpointChange(d.name, cp.key, { status: "fail" })}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition ${
                                      status === "fail"
                                        ? "bg-red-600 text-white"
                                        : "bg-gray-100 text-ink-3 hover:bg-red-100"
                                    }`}
                                    title="불일치 (문제 있음)"
                                  >
                                    ✕
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCheckpointChange(d.name, cp.key, { status: "pending" })}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition ${
                                      status === "pending"
                                        ? "bg-ink-4 text-white"
                                        : "bg-gray-100 text-ink-3 hover:bg-gray-200"
                                    }`}
                                    title="미확인"
                                  >
                                    ?
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 액션 영역 — 묶음 PDF 있으면 페이지 점프/지정, 없으면 개별 업로드 */}
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      {d.name === "서류 묶음(통합)" ? (
                        // 서류 묶음 행: 파일 업로드 & 교체
                        <label className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition ${
                          file
                            ? "bg-gray-100 text-ink-2 hover:bg-gray-200"
                            : "bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
                        } ${isUploading ? "opacity-50 pointer-events-none" : ""}`}>
                          {isUploading ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> 업로드</>
                          ) : file ? (
                            <>🔄 교체</>
                          ) : (
                            <>📎 묶음 PDF</>
                          )}
                          <input
                            type="file"
                            accept=".pdf"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleUploadDoc(d.name, f);
                            }}
                          />
                        </label>
                      ) : bundle?.url ? (
                        // 개별 서류 행 (묶음 있음): 페이지 열기/지정
                        (() => {
                          const f: any = file;
                          const pages: number[] = (f?.pages && f.pages.length > 0)
                            ? f.pages
                            : (f?.page ? [f.page] : []);
                          return pages.length > 0;
                        })() ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const f: any = file;
                                const pages: number[] = (f?.pages && f.pages.length > 0) ? f.pages : (f?.page ? [f.page] : []);
                                const url = `${bundle.url}#page=${pages[0]}`;
                                window.open(url, "_blank", "noopener,noreferrer");
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                              title={(() => {
                                const f: any = file;
                                const pages: number[] = (f?.pages && f.pages.length > 0) ? f.pages : (f?.page ? [f.page] : []);
                                return `묶음 PDF ${pages.join(", ")}페이지`;
                              })()}
                            >
                              {(() => {
                                const f: any = file;
                                const pages: number[] = (f?.pages && f.pages.length > 0) ? f.pages : (f?.page ? [f.page] : []);
                                return `📄 ${pages.length > 1 ? `${pages.length}장 (첫 ${pages[0]}p)` : `${pages[0]}p`} 열기`;
                              })()}
                            </button>
                            <button
                              type="button"
                              onClick={() => openMapperFor(d.name)}
                              className="text-[10px] text-accent hover:underline"
                            >
                              🔄 페이지 변경
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openMapperFor(d.name)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
                            title="묶음 PDF에서 이 서류가 있는 페이지를 지정"
                          >
                            📌 페이지 지정
                          </button>
                        )
                      ) : (
                        // 묶음 PDF 없음: 기존 개별 업로드 fallback
                        <label className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition ${
                          file
                            ? "bg-gray-100 text-ink-2 hover:bg-gray-200"
                            : "bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
                        } ${isUploading ? "opacity-50 pointer-events-none" : ""}`}>
                          {isUploading ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> 업로드</>
                          ) : file ? (
                            <>🔄 교체</>
                          ) : (
                            <>📎 개별 파일</>
                          )}
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleUploadDoc(d.name, f);
                            }}
                          />
                        </label>
                      )}
                      {(() => {
                        const f: any = file;
                        const has = (f?.pages && f.pages.length > 0) || !!f?.page;
                        return has && d.name !== "서류 묶음(통합)";
                      })() && (
                        <button
                          type="button"
                          onClick={() => handleAssignPage(d.name, undefined)}
                          className="text-[10px] text-red-500 hover:text-red-700"
                        >
                          지정 해제
                        </button>
                      )}
                      {isSubmitted && <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mx-auto" />}
                    </div>
                  </div>
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

      {/* 페이지 매퍼 모달 */}
      {bundle?.url && (
        <DocumentPageMapper
          isOpen={mapperOpen}
          onClose={() => setMapperOpen(false)}
          bundleUrl={bundle.url}
          bundleFilename={bundle.filename}
          bundleFileId={(bundle as any).fileId}
          totalPages={(bundle as any).totalPages}
          documents={documentList}
          fileMap={docFiles}
          onAssignPage={handleAssignPage}
          initialPage={mapperInitialPage}
          applyhomeAutoVerified={
            customer.registration_source === "applyhome"
              ? APPLYHOME_AUTO_VERIFIED_DOCUMENTS
              : []
          }
          // 페이지 매핑 중에 동시에 담당자 확인 포인트 검수 가능
          customer={customer}
          announcement={announcement || undefined}
          onCheckpointChange={handleCheckpointChange}
        />
      )}
    </>
  );
}

/* ─── Sub components ──────────────────────────────────── */

function Field({
  label, value, editable, placeholder, onChange,
  format, displayFormat, inputMode, maxLength,
}: {
  label: string;
  value: any;
  editable: boolean;
  placeholder?: string;
  onChange: (v: string) => void;
  /** 입력 중 값 변환 함수 (예: 전화번호 하이픈 자동 삽입) */
  format?: (raw: string) => string;
  /** 비편집 모드 display 포맷 (예: 저장된 raw phone → 하이픈 포함) */
  displayFormat?: (raw: string) => string;
  inputMode?: "numeric" | "tel" | "email" | "text";
  maxLength?: number;
}) {
  const displayed = value
    ? (displayFormat ? displayFormat(String(value)) : String(value))
    : "—";
  return (
    <div>
      <label className="text-xs text-ink-3 block mb-1">{label}</label>
      {editable ? (
        <input
          type={inputMode === "tel" ? "tel" : "text"}
          inputMode={inputMode}
          maxLength={maxLength}
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(format ? format(e.target.value) : e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent text-sm"
        />
      ) : (
        <p className="font-medium text-ink text-sm">{displayed}</p>
      )}
    </div>
  );
}

function NumField({
  label, icon: Icon, value, editable, onChange,
}: { label: string; icon: typeof Home; value: number; editable: boolean; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-ink-3 flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3" /> {label}
      </label>
      {editable ? (
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent text-sm"
        />
      ) : (
        <p className="font-medium text-ink text-sm">{value}</p>
      )}
    </div>
  );
}

/* ─── 예비 승계 블록 ─────────────────────────────────── */

function StandbyPromotionBlock({
  customer,
  verdict,
  onUpdate,
}: {
  customer: LocalCustomer;
  verdict: "eligible" | "ineligible" | "pending";
  onUpdate: (c: LocalCustomer) => void;
}) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<PromotionCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reason, setReason] = useState("부적합 판정");
  const [promoting, setPromoting] = useState(false);
  const [predecessor, setPredecessor] = useState<LocalCustomer | null>(null);
  const [successor, setSuccessor] = useState<LocalCustomer | null>(null);

  // 예비에서 올라온 고객이라면 원래 당첨자 정보를 보여주기
  useEffect(() => {
    if (customer.succeeded_from) {
      const pre = localCustomers.get(customer.succeeded_from);
      if (pre) setPredecessor(pre);
    }
    if (customer.superseded_by) {
      const suc = localCustomers.get(customer.superseded_by);
      if (suc) setSuccessor(suc);
    }
  }, [customer.succeeded_from, customer.superseded_by, customer.id]);

  // 이미 승계된 당첨자
  if (customer.superseded) {
    return (
      <div className="card border-2 border-gray-300 bg-surface2">
        <div className="flex items-start gap-3">
          <UserX className="w-5 h-5 text-ink-3 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-ink">
              이 당첨자는 포기·승계 완료되었습니다
            </p>
            <p className="text-xs text-ink-2 mt-1">
              사유: {customer.supersede_reason || "부적합 판정"}
              {customer.supersede_at && ` · ${fmtDate(customer.supersede_at)}`}
            </p>
            {successor && (
              <button
                onClick={() => router.push(`/customers/${successor.id}`)}
                className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                승계자: {successor.name} (예비에서 이동) <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 예비에서 올라온 고객
  if (customer.succeeded_from && predecessor) {
    return (
      <div className="card border-2 border-emerald-200 bg-emerald-50">
        <div className="flex items-start gap-3">
          <ArrowUpCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-emerald-900">
              예비 승계로 당첨 자리에 이동됨
            </p>
            <p className="text-xs text-emerald-800 mt-1">
              원 당첨자: {predecessor.name}
              {predecessor.supersede_reason && ` (${predecessor.supersede_reason})`}
              {customer.supersede_at && ` · ${fmtDate(customer.supersede_at)}`}
            </p>
            <button
              onClick={() => router.push(`/customers/${predecessor.id}`)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
            >
              원 당첨자 상세 <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 당첨자이고 부적합 판정 → 승계 후보 제시
  if (!customer.is_standby && verdict === "ineligible") {
    const openPicker = () => {
      const all = localCustomers.listByAnnouncement(customer.announcement_id);
      const cands = findStandbyCandidates(customer, all);
      setCandidates(cands);
      setSelectedId(cands[0]?.customer.id ?? null);
      setPickerOpen(true);
    };

    const executePromotion = () => {
      if (!selectedId) return;
      const standby = candidates.find((c) => c.customer.id === selectedId)?.customer;
      if (!standby) return;
      if (!confirm(`${standby.name}(예비 ${standby.standby_rank}순위)을(를) 승계하시겠습니까?\n${customer.name}은(는) 포기 상태로 전환됩니다.`)) return;

      setPromoting(true);
      try {
        const { winnerPatch, standbyPatch } = buildPromotionUpdates(customer, standby, reason);
        const updatedWinner = localCustomers.update(customer.id, winnerPatch);
        localCustomers.update(standby.id, standbyPatch);
        if (updatedWinner) onUpdate(updatedWinner);
        setPickerOpen(false);
        alert(`${standby.name}이(가) 승계됐습니다. 해당 고객 페이지로 이동합니다.`);
        router.push(`/customers/${standby.id}`);
      } finally {
        setPromoting(false);
      }
    };

    return (
      <>
        <div className="card border-2 border-amber-300 bg-amber-50">
          <div className="flex items-start gap-3">
            <UserX className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-amber-900">예비 승계 가능</p>
              <p className="text-xs text-amber-800 mt-1">
                이 당첨자가 부적합 판정을 받아, 같은 주택형({customer.unit_type || "미지정"})의
                예비 중에서 자리를 이어받을 후보를 선정할 수 있습니다.
              </p>
              <button
                onClick={openPicker}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
              >
                <ArrowUpCircle className="w-4 h-4" /> 예비에서 승계 후보 보기
              </button>
            </div>
          </div>
        </div>

        {pickerOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-5 border-b border-border-soft flex items-center justify-between flex-shrink-0">
                <div>
                  <h2 className="text-lg font-semibold">예비 승계 후보</h2>
                  <p className="text-xs text-ink-3 mt-0.5">
                    주택형 {customer.unit_type || "미지정"} · 총 {candidates.length}명 · 순위 오름차순
                  </p>
                </div>
                <button
                  onClick={() => setPickerOpen(false)}
                  className="p-1 hover:bg-surface2 rounded-full"
                >
                  <X className="w-4 h-4 text-ink-3" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {candidates.length === 0 ? (
                  <div className="p-8 text-center text-sm text-ink-4 border border-dashed border-gray-300 rounded-lg">
                    같은 주택형의 가능한 예비 후보가 없습니다.
                    <br />
                    <span className="text-xs">
                      "당첨자 파일 일괄 분석"에서 예비입주자 명단이 포함된 파일을 업로드했는지 확인하세요.
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="mb-4">
                      <label className="text-xs text-ink-3 block mb-1">승계 사유</label>
                      <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="예: 부적합 판정, 계약 포기 등"
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                      />
                    </div>

                    <ul className="space-y-2">
                      {candidates.map((c) => {
                        const picked = selectedId === c.customer.id;
                        return (
                          <li key={c.customer.id}>
                            <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                              picked
                                ? "border-amber-400 bg-amber-50"
                                : "border-border hover:border-gray-300"
                            }`}>
                              <input
                                type="radio"
                                checked={picked}
                                onChange={() => setSelectedId(c.customer.id)}
                                className="accent-amber-600 w-4 h-4"
                              />
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex-shrink-0">
                                {c.rankLabel}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-ink">{c.customer.name}</span>
                                  {c.customer.supply_type && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                                      {c.customer.supply_type}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-ink-3 mt-0.5 font-mono">
                                  {c.customer.rrn_front && (
                                    <span>
                                      {c.customer.rrn_front}-{c.customer.rrn_back?.slice(0, 1) || "•"}••••••
                                    </span>
                                  )}
                                  {c.customer.phone && <span className="ml-2">{c.customer.phone}</span>}
                                </p>
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>

              <div className="p-4 border-t border-border-soft flex items-center justify-end gap-2 flex-shrink-0">
                <button
                  onClick={() => setPickerOpen(false)}
                  className="btn-secondary text-sm"
                >
                  취소
                </button>
                <button
                  onClick={executePromotion}
                  disabled={!selectedId || promoting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
                >
                  {promoting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> 승계 중...</>
                  ) : (
                    <><ArrowUpCircle className="w-4 h-4" /> 승계 실행</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

export default function CustomerDetailPage() {
  return (
    <Suspense fallback={<div className="p-6 text-ink-4">로딩 중...</div>}>
      <CustomerDetailInner />
    </Suspense>
  );
}
