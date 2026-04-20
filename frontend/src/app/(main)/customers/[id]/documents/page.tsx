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
  Users, Banknote,
} from "lucide-react";

/** 주거용 용도 판별 — 주택소유 레코드의 '용도 등' 필드 기준 */
function isResidentialUse(usage?: string): boolean {
  if (!usage) return true;
  if (/토지|임야|전|답|상가|사무실|공장|창고/.test(usage)) return false;
  return true;
}

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
    reasons: string[];    // 부적합 사유들 (빈 배열이면 적합)
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
      // 1) 필수 서류 누락 체크
      const missingDocs = documentList
        .filter((d) => !d.conditional && !submitted[d.name])
        .map((d) => d.name);

      // 2) 세대 주택 보유 체크 (주거용·현재 보유만)
      const ownedResidential = (customer.properties || []).filter(
        (p) => !p.transferredDate && isResidentialUse(p.usage),
      );

      // 3) 청약통장 검증 체크
      const savings = customer.savings_priority;
      const savingsIssue = savings && !savings.verified;

      // 4) 세대원 오류코드 체크
      const householdIssues = (customer.household_members || []).filter((m) => m.errorCode);

      // 사유 집계
      const reasons: string[] = [];
      if (missingDocs.length > 0) {
        reasons.push(`필수 서류 ${missingDocs.length}건 미제출: ${missingDocs.slice(0, 3).join(", ")}${missingDocs.length > 3 ? " 외" : ""}`);
      }
      if (ownedResidential.length > 0) {
        const first = ownedResidential[0];
        reasons.push(
          `세대 주택 보유 ${ownedResidential.length}건 (${first.ownerName} · ${first.address.slice(0, 40)}${first.address.length > 40 ? "…" : ""})`,
        );
      }
      if (savingsIssue) {
        reasons.push(`청약통장 순위확인 오류: ${savings?.errorNote || savings?.resultLength + ")" || "검증 실패"}`);
      }
      if (householdIssues.length > 0) {
        reasons.push(`세대원 오류코드 ${householdIssues.length}건 (재확인 필요)`);
      }

      const verdict: "eligible" | "ineligible" = reasons.length === 0 ? "eligible" : "ineligible";

      // 일반공급 가점 계산 — 적합일 때만
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
        verification_reasons: reasons,
        verification_checked_at: new Date().toISOString(),
        status: verdict === "eligible" ? "applied" : customer.status,
        ...(score !== undefined ? { total_score: score } : {}),
      });

      setResultBanner({ verdict, reasons, score });
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

      {/* 공적 검증 패널 3종 — 파일 일괄 분석에서 데이터가 수집된 경우에만 표시 */}
      <VerificationPanels customer={customer} />

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
                  <p className="mb-2">다음 사유로 부적합 판정됩니다:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-xs">
                    {resultBanner.reasons.map((r, i) => <li key={i}>{r}</li>)}
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

/* ─── 공적 검증 3패널 (세대원 · 주택소유 · 청약통장) ─────────────── */

function VerificationPanels({ customer }: { customer: LocalCustomer }) {
  const members = customer.household_members || [];
  const properties = customer.properties || [];
  const savings = customer.savings_priority;
  const hasAny = members.length > 0 || properties.length > 0 || !!savings;

  if (!hasAny) {
    return (
      <div className="card mb-4 bg-gray-50">
        <div className="flex items-start gap-2 text-sm text-gray-600">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-gray-400 flex-shrink-0" />
          <div>
            <strong className="text-gray-800">공적 검증 데이터 없음</strong>
            <p className="text-xs text-gray-500 mt-0.5">
              세대원·주택소유·청약통장 검증을 하려면 고객 관리 &gt; <strong>파일 일괄 분석</strong>에서
              세대원내역·주택소유 전산검색·입주자저축 순위확인 파일을 함께 업로드해 주세요.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 mb-6">
      {/* 세대원 패널 */}
      {members.length > 0 && <HouseholdPanel members={members} />}

      {/* 주택소유 패널 */}
      {properties.length > 0 && <PropertyPanel properties={properties} />}

      {/* 청약통장 패널 */}
      {savings && <SavingsPanel savings={savings} />}
    </div>
  );
}

function HouseholdPanel({ members }: { members: NonNullable<LocalCustomer["household_members"]> }) {
  const issues = members.filter((m) => m.errorCode);
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-amber-600" />
        <h2 className="font-semibold text-gray-800">세대원 확인</h2>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          issues.length > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
        }`}>
          {members.length}명 {issues.length > 0 ? `· 오류 ${issues.length}건` : "· 정상"}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500">
            <th className="text-left py-1.5 font-medium">성명</th>
            <th className="text-left py-1.5 font-medium">주민번호</th>
            <th className="text-left py-1.5 font-medium">비고</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => (
            <tr key={i} className={`border-b border-gray-50 ${m.errorCode ? "bg-red-50/50" : ""}`}>
              <td className="py-2 font-medium">{m.name}</td>
              <td className="py-2 font-mono text-xs text-gray-600">
                {m.rrn ? `${m.rrn.slice(0, 6)}-${m.rrn.slice(6, 7)}••••••` : "—"}
              </td>
              <td className="py-2">
                {m.errorCode ? (
                  <span className="text-[11px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                    오류 {m.errorCode}
                  </span>
                ) : (
                  <span className="text-[11px] text-gray-400">정상</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {issues.length > 0 && (
        <p className="text-xs text-red-700 mt-3">
          ⚠ 세대원 오류가 있습니다. 주민번호 불일치·사망·출국 등 원인을 재확인해 주세요.
        </p>
      )}
    </div>
  );
}

function PropertyPanel({ properties }: { properties: NonNullable<LocalCustomer["properties"]> }) {
  // 소유자별 그룹핑
  const byOwner: Record<string, typeof properties> = {};
  for (const p of properties) {
    const key = `${p.ownerName}|${p.ownerRrn}`;
    if (!byOwner[key]) byOwner[key] = [];
    byOwner[key].push(p);
  }
  const currentResidentialCount = properties.filter(
    (p) => !p.transferredDate && isResidentialUse(p.usage),
  ).length;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Home className="w-4 h-4 text-orange-600" />
        <h2 className="font-semibold text-gray-800">주택소유 전산검색</h2>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          currentResidentialCount === 0 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
        }`}>
          {currentResidentialCount === 0 ? "무주택" : `현재 보유 ${currentResidentialCount}건`}
        </span>
      </div>

      <div className="space-y-3">
        {Object.entries(byOwner).map(([key, owned]) => {
          const [name] = key.split("|");
          return (
            <div key={key} className="border border-gray-200 rounded-lg p-3">
              <div className="text-sm font-medium text-gray-700 mb-2">{name}</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500">
                    <th className="text-left py-1 font-normal">주소</th>
                    <th className="text-right py-1 font-normal">면적</th>
                    <th className="text-left py-1 font-normal pl-2">용도</th>
                    <th className="text-left py-1 font-normal pl-2">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {owned.map((p, i) => {
                    const isCurrent = !p.transferredDate;
                    const isRes = isResidentialUse(p.usage);
                    const statusCls = !isCurrent
                      ? "text-gray-400"
                      : isRes
                        ? "text-amber-700 font-medium"
                        : "text-gray-500";
                    const statusLabel = !isCurrent
                      ? `양도 (${p.transferredDate})`
                      : isRes
                        ? "현재 보유"
                        : "비주거";
                    return (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="py-1.5 text-gray-700 truncate max-w-xs" title={p.address}>
                          {p.address}
                        </td>
                        <td className="py-1.5 text-right text-gray-600">
                          {p.areaM2 ? `${p.areaM2}㎡` : "—"}
                        </td>
                        <td className="py-1.5 pl-2 text-gray-600">{p.usage || "—"}</td>
                        <td className={`py-1.5 pl-2 ${statusCls}`}>{statusLabel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-500 mt-3">
        * "현재 보유 + 주거용"만 무주택 판정에 영향을 미칩니다. 양도 완료·비주거는 무주택 판정에 포함되지 않습니다.
      </p>
    </div>
  );
}

function SavingsPanel({ savings }: { savings: NonNullable<LocalCustomer["savings_priority"]> }) {
  // 은행코드 매핑
  const BANK_MAP: Record<string, string> = {
    "003": "기업", "004": "국민", "007": "수협", "011": "농협", "020": "우리",
    "023": "SC", "027": "씨티", "031": "아이엠뱅크", "032": "부산", "034": "광주",
    "035": "제주", "037": "전북", "039": "경남", "081": "KEB하나", "088": "신한",
  };
  const bankName = savings.bankCode ? (BANK_MAP[savings.bankCode] || savings.bankCode) : "—";

  const errorHint =
    savings.resultLength === 63
      ? "은행코드 또는 신청구분 오류 — 은행 재조회 필요"
      : savings.resultLength === 62
        ? "특별공급 신청구분 불일치 — 신청자 재확인"
        : savings.resultLength === 61
          ? "성명 불일치 — 명의 확인 필요"
          : null;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Banknote className="w-4 h-4 text-teal-600" />
        <h2 className="font-semibold text-gray-800">청약통장 순위확인</h2>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          savings.verified ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}>
          {savings.verified ? "검증완료" : `오류 (${savings.resultLength})`}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500">은행</p>
          <p className="font-medium mt-0.5">{bankName} {savings.bankCode && `(${savings.bankCode})`}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500">결과 코드</p>
          <p className={`font-medium mt-0.5 ${savings.verified ? "text-green-700" : "text-red-700"}`}>
            {savings.resultLength ? `${savings.resultLength})` : "—"} {savings.verified ? "검증완료" : "오류"}
          </p>
        </div>
      </div>
      {!savings.verified && errorHint && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          <strong>⚠ {errorHint}</strong>
          {savings.errorNote && <p className="mt-1">{savings.errorNote}</p>}
        </div>
      )}
    </div>
  );
}
