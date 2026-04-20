"use client";

/**
 * 고객 서류 검수 페이지
 *
 * 기능:
 *  1. 고객의 공급 유형(일반공급/특별공급)에 따라 필요한 서류 목록을 자동 산정
 *  2. 공고의 required_documents(파싱된 것) 우선, 없으면 document-checklist 표준값 사용
 *  3. 체크리스트로 각 서류 제출 여부 기록
 *  4. 저장 시 적합/부적합 판정 + 일반공급 시 총 가점 계산
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  localCustomers,
  localAnnouncements,
  LocalCustomer,
  LocalAnnouncement,
} from "@/lib/local-store";
import {
  COMMON_DOCUMENTS,
  SUPPLY_TYPE_DOCUMENTS,
} from "@/lib/document-checklist";
import { calculateSubscriptionScore } from "@/lib/score-calculator";
import {
  ArrowLeft, FileText, CheckCircle2, XCircle, AlertTriangle, Loader2,
  User, Home, Save, BookOpen, ChevronRight, ClipboardCheck, Calculator,
} from "lucide-react";

interface DocumentItem {
  name: string;
  category: "공통" | string; // "공통" 또는 특별공급 유형
  conditional: boolean;
}

export default function CustomerDocumentsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const customerId = Number(params?.id);

  const [customer, setCustomer] = useState<LocalCustomer | null>(null);
  const [announcement, setAnnouncement] = useState<LocalAnnouncement | null>(null);
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [resultBanner, setResultBanner] = useState<null | {
    verdict: "eligible" | "ineligible";
    missing: string[];
    score?: number;
  }>(null);

  useEffect(() => {
    if (!customerId || Number.isNaN(customerId)) return;
    const c = localCustomers.get(customerId);
    if (c) {
      setCustomer(c);
      setSubmitted(c.documents_submitted || {});
      const ann = localAnnouncements.get(c.announcement_id);
      if (ann) setAnnouncement(ann);
    }
  }, [customerId]);

  // ── 공급 유형 판별 ──
  const supplyType = useMemo(() => {
    if (!customer) return "일반공급";
    if (customer.supply_type) return customer.supply_type;
    if (customer.special_types && customer.special_types.length > 0) {
      return customer.special_types[0];
    }
    return "일반공급";
  }, [customer]);

  const isGeneralSupply = supplyType === "일반공급";

  // ── 필요 서류 목록 산정 ──
  const documentList = useMemo<DocumentItem[]>(() => {
    const parsedDocs: Record<string, string[]> = announcement?.eligibility_rules?.required_documents || {};
    const items: DocumentItem[] = [];

    // 1) 공통 서류 — 공고 파싱값 우선 (3개 이상일 때), 없으면 표준값
    const common = (parsedDocs["공통"] && parsedDocs["공통"].length >= 3)
      ? parsedDocs["공통"]
      : COMMON_DOCUMENTS;
    for (const doc of common) {
      items.push({ name: doc, category: "공통", conditional: /해당\s*시|해당자/.test(doc) });
    }

    // 2) 공급 유형별 서류
    const typeDocs = (parsedDocs[supplyType] && parsedDocs[supplyType].length >= 2)
      ? parsedDocs[supplyType]
      : (SUPPLY_TYPE_DOCUMENTS[supplyType] || SUPPLY_TYPE_DOCUMENTS["일반공급"] || []);
    for (const doc of typeDocs) {
      // 공통과 중복되는 문서는 제외
      if (items.some((it) => it.name === doc)) continue;
      items.push({ name: doc, category: supplyType, conditional: /해당\s*시|해당자|임신|기혼자/.test(doc) });
    }
    return items;
  }, [announcement, supplyType]);

  // ── 진행 통계 ──
  const stats = useMemo(() => {
    const required = documentList.filter((d) => !d.conditional);
    const requiredCount = required.length;
    const submittedRequiredCount = required.filter((d) => submitted[d.name]).length;
    const conditionalCount = documentList.length - requiredCount;
    const submittedConditionalCount = documentList.filter((d) => d.conditional && submitted[d.name]).length;
    return {
      requiredCount, submittedRequiredCount,
      conditionalCount, submittedConditionalCount,
      percent: requiredCount === 0 ? 100 : Math.round((submittedRequiredCount / requiredCount) * 100),
    };
  }, [documentList, submitted]);

  const handleToggle = (name: string) => {
    setSubmitted((p) => ({ ...p, [name]: !p[name] }));
    setResultBanner(null);
  };

  const handleSave = async () => {
    if (!customer) return;
    setSaving(true);
    try {
      const missing = documentList
        .filter((d) => !d.conditional && !submitted[d.name])
        .map((d) => d.name);
      const verdict: "eligible" | "ineligible" = missing.length === 0 ? "eligible" : "ineligible";

      let score: number | undefined = undefined;
      if (isGeneralSupply && verdict === "eligible") {
        const breakdown = calculateSubscriptionScore({
          noHomeYears: customer.no_home_years ?? 0,
          dependentsCount: customer.dependents_count ?? 0,
          subscriptionMonths: customer.subscription_months ?? 0,
        });
        score = breakdown.total;
      }

      localCustomers.update(customer.id, {
        documents_submitted: submitted,
        verification_verdict: verdict,
        verification_score: score,
        verification_checked_at: new Date().toISOString(),
        status: verdict === "eligible" ? "applied" : customer.status,
        ...(score !== undefined ? { total_score: score } : {}),
      });

      setResultBanner({ verdict, missing, score });
    } finally {
      setSaving(false);
    }
  };

  if (!customer) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="card text-center py-16 text-gray-400">
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-60" />
          <p>고객 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // 카테고리별 그룹핑
  const grouped: Record<string, DocumentItem[]> = {};
  for (const it of documentList) {
    if (!grouped[it.category]) grouped[it.category] = [];
    grouped[it.category].push(it);
  }

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
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <a
        href={`/customers/${customer.id}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> 고객 상세
      </a>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-blue-600" />
          서류 검수
        </h1>
        <div className="flex items-center gap-3 text-sm text-gray-500 mt-1 flex-wrap">
          <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {customer.name}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SUPPLY_COLORS[supplyType] || SUPPLY_COLORS["공통"]}`}>
            {supplyType}
          </span>
          {customer.unit_type && (
            <span className="flex items-center gap-1"><Home className="w-3.5 h-3.5" /> {customer.unit_type}{customer.unit_area ? ` · ${customer.unit_area}` : ""}</span>
          )}
        </div>
      </div>

      {/* 연결된 공고 */}
      {announcement && (
        <div
          onClick={() => router.push(`/announcements/${announcement.id}`)}
          className="card mb-4 cursor-pointer hover:border-blue-300 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-blue-600 font-medium">신청 공고</div>
              <p className="text-sm font-semibold text-gray-900 truncate">{announcement.title}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </div>
        </div>
      )}

      {/* 진행 바 */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">제출 진행률</span>
          <span className="text-sm font-bold text-blue-700">
            {stats.submittedRequiredCount} / {stats.requiredCount}
            <span className="text-gray-400 font-normal ml-1">(필수)</span>
          </span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${stats.percent === 100 ? "bg-green-500" : "bg-blue-500"}`}
            style={{ width: `${stats.percent}%` }}
          />
        </div>
        {stats.conditionalCount > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            조건부 서류 {stats.submittedConditionalCount} / {stats.conditionalCount} 제출됨
          </p>
        )}
      </div>

      {/* 서류 체크리스트 */}
      <div className="space-y-4 mb-6">
        {Object.entries(grouped).map(([category, docs]) => (
          <div key={category} className="card">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-gray-500" />
              <h2 className="font-semibold text-gray-800">{category} 서류</h2>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${SUPPLY_COLORS[category] || SUPPLY_COLORS["공통"]}`}>
                {category === "공통" ? "모든 신청자 공통" : `${supplyType} 전용`}
              </span>
            </div>
            <ul className="space-y-2">
              {docs.map((d) => {
                const isSubmitted = !!submitted[d.name];
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
      </div>

      {/* 결과 배너 */}
      {resultBanner && (
        <div className={`card mb-4 border-2 ${
          resultBanner.verdict === "eligible"
            ? "border-green-300 bg-green-50"
            : "border-red-300 bg-red-50"
        }`}>
          <div className="flex items-start gap-3">
            {resultBanner.verdict === "eligible" ? (
              <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <h3 className={`font-bold text-lg ${
                resultBanner.verdict === "eligible" ? "text-green-900" : "text-red-900"
              }`}>
                {resultBanner.verdict === "eligible" ? "적합" : "부적합"}
              </h3>
              {resultBanner.verdict === "eligible" ? (
                <p className="text-sm text-green-800 mt-1">
                  필수 서류가 모두 제출되었습니다.
                  {isGeneralSupply && typeof resultBanner.score === "number" && (
                    <>
                      <br />
                      <span className="flex items-center gap-1 mt-2 text-base font-bold">
                        <Calculator className="w-4 h-4" /> 청약 가점 총 {resultBanner.score}점 / 84점
                      </span>
                    </>
                  )}
                  {!isGeneralSupply && (
                    <span className="block mt-1 text-xs text-green-700">
                      특별공급({supplyType})은 가점제가 아닌 자격 심사로 진행됩니다.
                    </span>
                  )}
                </p>
              ) : (
                <div className="text-sm text-red-800 mt-1">
                  <p className="mb-2">다음 필수 서류가 누락되었습니다:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-xs">
                    {resultBanner.missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <button
              onClick={() => setResultBanner(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* 저장 버튼 */}
      <div className="sticky bottom-4 flex justify-end">
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
    </div>
  );
}
