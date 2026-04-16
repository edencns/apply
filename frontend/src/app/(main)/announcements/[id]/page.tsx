"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { localAnnouncements, isNetworkError } from "@/lib/local-store";
import {
  ArrowLeft, Building2, CalendarDays, MapPin, Users, Shield, Heart,
  FileText, Loader2, AlertCircle, Banknote, Scale,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
  Baby, UserCheck,
} from "lucide-react";

/* ─── Types ──────────────────────────────────────────── */

interface AnnouncementDetail {
  id: number;
  title: string;
  announcement_no?: string | null;
  status: string;
  application_start?: string | null;
  application_end?: string | null;
  winner_announce_date?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  eligibility_rules?: Record<string, any>;
}

type Tab = "overview" | "eligibility" | "special" | "income" | "documents";

const TABS: { key: Tab; label: string; icon: typeof Building2 }[] = [
  { key: "overview", label: "단지 개요", icon: Building2 },
  { key: "eligibility", label: "청약 자격", icon: Shield },
  { key: "special", label: "특별공급", icon: Heart },
  { key: "income", label: "소득·자산", icon: Banknote },
  { key: "documents", label: "필요 서류", icon: FileText },
];

const REG_COLOR: Record<string, string> = {
  "투기과열": "bg-red-100 text-red-800",
  "청약과열": "bg-orange-100 text-orange-800",
  "비규제": "bg-green-100 text-green-800",
};

/* ─── Shared Components ──────────────────────────────── */

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{text}</span>;
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="font-semibold text-gray-800 text-sm">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

function YesNo({ value, label }: { value: string; label?: string }) {
  const isNone = value === "없음" || value === "해당 없음";
  return (
    <div className="flex items-center gap-1.5 text-sm">
      {isNone ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
      )}
      <span className={isNone ? "text-green-700" : "text-amber-700"}>
        {label ? `${label}: ` : ""}{value}
      </span>
    </div>
  );
}

/* ─── Date Helpers ───────────────────────────────────── */

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  } catch { return String(s); }
}

function fmtRange(start?: string | null, end?: string | null): string {
  const s = fmtDate(start);
  const e = fmtDate(end);
  if (s === "—" && e === "—") return "—";
  if (s === "—") return e;
  if (e === "—" || e === s) return s;
  const [sy] = s.split(".");
  const [ey, ...rest] = e.split(".");
  if (sy === ey) return `${s}~${rest.join(".")}`;
  return `${s} ~ ${e}`;
}

/* ─── Tab: Overview ──────────────────────────────────── */

function OverviewTab({ ann, rules }: { ann: AnnouncementDetail; rules: Record<string, any> }) {
  const regionFull: string = rules.region_full || (rules.region_priority || []).join(" ") || "—";
  const exclusiveAreas: any[] = rules.exclusive_areas || [];
  const areasSum = exclusiveAreas.reduce((s: number, a: any) => s + (a.totalUnits || 0), 0);
  const totalUnits = rules.total_units || areasSum;
  const generalSum = exclusiveAreas.reduce((s: number, a: any) => s + (a.generalUnits || 0), 0);
  const specialSum = exclusiveAreas.reduce((s: number, a: any) => s + (a.specialUnits || 0), 0);
  const regulation: string = rules.regulation || (rules.no_home_required ? "비규제" : "—");

  return (
    <div className="space-y-4">
      <Section title="단지 기본 정보">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">단지명</p>
            <p className="text-sm font-semibold">{ann.title}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">위치</p>
            <p className="text-sm">{regionFull}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">규제지역</p>
            <Badge text={regulation} cls={REG_COLOR[regulation] || "bg-gray-100 text-gray-700"} />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">총 세대수</p>
            <p className="text-sm font-semibold">{totalUnits > 0 ? `${totalUnits}세대` : "—"}
              {generalSum > 0 || specialSum > 0 ? (
                <span className="text-gray-400 font-normal"> (일반 {generalSum} / 특별 {specialSum})</span>
              ) : null}
            </p>
          </div>
        </div>
      </Section>

      {exclusiveAreas.length > 0 && (
        <Section title="주택형별 정보">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">타입</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500">전용면적</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500">총 세대</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500">일반</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500">특별</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500">분양가</th>
                </tr>
              </thead>
              <tbody>
                {exclusiveAreas.map((a: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">{a.area || `타입${i + 1}`}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{a.squareMeters ? `${a.squareMeters}㎡` : "—"}</td>
                    <td className="py-2 px-2 text-right">{a.totalUnits ?? "—"}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{a.generalUnits ?? "—"}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{a.specialUnits ?? "—"}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{a.price || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="공급 일정">
        <div className="space-y-2">
          {[
            { label: "청약 접수", value: fmtRange(ann.application_start, ann.application_end) },
            { label: "당첨자 발표", value: fmtDate(ann.winner_announce_date) },
            { label: "서류 제출", value: fmtRange(rules.doc_submit_start, rules.doc_submit_end) },
            { label: "계약 체결", value: fmtRange(ann.contract_start, ann.contract_end) },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between text-sm">
              <span className="text-gray-500">{item.label}</span>
              <span className="font-medium">{item.value}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ─── Tab: Eligibility ───────────────────────────────── */

function EligibilityTab({ rules }: { rules: Record<string, any> }) {
  const regionPriority: string[] = rules.region_priority || [];

  return (
    <div className="space-y-4">
      <Section title="거주지역 요건">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-blue-600 mb-1">해당지역 (우선공급)</p>
            <p className="text-sm font-semibold">{regionPriority[0] || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">기타지역</p>
            <p className="text-sm">{regionPriority.slice(1).join(", ") || "—"}</p>
          </div>
        </div>
      </Section>

      <Section title="청약통장 요건">
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1">최소 가입기간</p>
          <p className="text-sm font-bold text-blue-700">
            {rules.min_subscription_period ? `${rules.min_subscription_period}개월 이상` : "—"}
          </p>
        </div>
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1">최소 거주기간</p>
          <p className="text-sm font-medium">
            {rules.min_region_residence_months ? `${rules.min_region_residence_months}개월` : "—"}
          </p>
        </div>
      </Section>

      <Section title="규제 현황">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">규제지역</p>
            <Badge text={rules.regulation || (rules.no_home_required ? "비규제" : "—")} cls={REG_COLOR[rules.regulation] || "bg-gray-100 text-gray-700"} />
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">무주택 요건</p>
            <p className="text-sm font-medium mt-1">{rules.no_home_required ? "필수" : "해당 없음"}</p>
          </div>
        </div>
      </Section>
    </div>
  );
}

/* ─── Tab: Special Supply ────────────────────────────── */

function SpecialTab({ rules }: { rules: Record<string, any> }) {
  const supplyTypes: any[] = rules.supply_types_detail || [];
  const specialTypes: string[] = rules.special_supply_types || [];
  const specialOnly = supplyTypes.filter((st: any) => st.type !== "일반공급");

  const TYPE_COLORS: Record<string, string> = {
    "기관추천": "bg-purple-500",
    "다자녀가구": "bg-pink-500",
    "신혼부부": "bg-red-500",
    "노부모부양": "bg-amber-500",
    "생애최초": "bg-emerald-500",
    "신생아": "bg-sky-500",
  };

  const TYPE_ICONS: Record<string, typeof Heart> = {
    "기관추천": UserCheck,
    "다자녀가구": Baby,
    "신혼부부": Heart,
    "노부모부양": Users,
    "생애최초": CheckCircle2,
    "신생아": Baby,
  };

  return (
    <div className="space-y-4">
      {specialTypes.length > 0 && (
        <Section title="특별공급 유형">
          <div className="flex flex-wrap gap-2">
            {specialTypes.map((t) => (
              <div key={t} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50">
                <div className={`w-2.5 h-2.5 rounded-full ${TYPE_COLORS[t] || "bg-gray-400"}`} />
                <span className="text-sm text-gray-700">{t}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {specialOnly.length > 0 ? (
        specialOnly.map((st: any, i: number) => {
          const Icon = TYPE_ICONS[st.type] || Heart;
          return (
            <Section key={i} title={st.type}>
              <div className="space-y-3">
                {st.requireHomeless && (
                  <div className="flex items-center gap-1.5 text-sm">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-red-700 font-medium">무주택세대구성원 필수</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {st.incomeLimitPercent && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">소득기준 (외벌이)</p>
                      <p className="text-sm font-bold text-blue-700 mt-1">{st.incomeLimitPercent}%</p>
                    </div>
                  )}
                  {st.incomeLimitDualPercent && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">소득기준 (맞벌이)</p>
                      <p className="text-sm font-bold text-blue-700 mt-1">{st.incomeLimitDualPercent}%</p>
                    </div>
                  )}
                  {st.minSubscriptionMonths && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">통장 가입기간</p>
                      <p className="text-sm font-medium mt-1">{st.minSubscriptionMonths}개월</p>
                    </div>
                  )}
                  {st.maxMarriageYears && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">혼인기간</p>
                      <p className="text-sm font-medium mt-1">{st.maxMarriageYears}년 이내</p>
                    </div>
                  )}
                  {st.minChildren && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">자녀수</p>
                      <p className="text-sm font-medium mt-1">{st.minChildren}명 이상</p>
                    </div>
                  )}
                  {st.assetLimit && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">자산한도</p>
                      <p className="text-sm font-medium mt-1">{st.assetLimit}</p>
                    </div>
                  )}
                </div>
                {st.conditions && st.conditions.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {st.conditions.map((c: string, ci: number) => (
                      <div key={ci} className="flex items-start gap-2 text-sm">
                        <span className="text-blue-500 mt-0.5">&#8226;</span>
                        <span>{c}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          );
        })
      ) : (
        <div className="text-center py-10 text-gray-400">
          <Heart className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>특별공급 상세 조건이 아직 추출되지 않았습니다</p>
          <p className="text-xs mt-1">PDF를 다시 업로드하면 AI가 자동 분석합니다</p>
        </div>
      )}
    </div>
  );
}

/* ─── Tab: Income ────────────────────────────────────── */

function IncomeTab({ rules }: { rules: Record<string, any> }) {
  const incomeTable: Record<string, any> = rules.income_table || {};
  const hasIncome = Object.keys(incomeTable).length > 0;

  return (
    <div className="space-y-4">
      {hasIncome ? (
        <Section title="소득기준표 (도시근로자 월평균소득)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-xs font-medium text-gray-500">가구원수</th>
                  {(() => {
                    const firstKey = Object.keys(incomeTable)[0];
                    const percents = firstKey ? Object.keys(incomeTable[firstKey]) : [];
                    return percents.map((p) => (
                      <th key={p} className="text-right py-2 text-xs font-medium text-gray-500">{p}</th>
                    ));
                  })()}
                </tr>
              </thead>
              <tbody>
                {Object.entries(incomeTable).map(([size, vals]: [string, any]) => (
                  <tr key={size} className="border-b border-gray-50">
                    <td className="py-2.5 font-medium">{size}</td>
                    {Object.values(vals).map((v: any, i: number) => (
                      <td key={i} className="py-2.5 text-right text-gray-700">
                        {typeof v === "number" ? `${v.toLocaleString("ko-KR")}원` : String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : (
        <div className="text-center py-10 text-gray-400">
          <Banknote className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>소득기준표가 아직 추출되지 않았습니다</p>
          <p className="text-xs mt-1">PDF를 다시 업로드하면 AI가 자동 분석합니다</p>
        </div>
      )}

      {(rules.asset_limit || rules.car_value_limit) && (
        <Section title="자산기준">
          <div className="bg-amber-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Scale className="w-4 h-4 text-amber-600" />
              <p className="font-semibold text-amber-900">{rules.asset_limit || "—"}</p>
            </div>
            {rules.car_value_limit && (
              <div className="text-sm text-amber-800">
                자동차가액: {rules.car_value_limit}
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

/* ─── Tab: Documents ─────────────────────────────────── */

function DocumentsTab({ rules }: { rules: Record<string, any> }) {
  const requiredDocuments: Record<string, string[]> = rules.required_documents || {};
  const hasDocuments = Object.keys(requiredDocuments).length > 0;

  const DOC_COLORS: Record<string, string> = {
    "공통": "blue",
    "신혼부부": "red",
    "생애최초": "emerald",
    "다자녀가구": "pink",
    "노부모부양": "amber",
    "기관추천": "purple",
    "신생아": "sky",
    "일반공급": "indigo",
  };

  if (!hasDocuments) {
    return (
      <div className="text-center py-10 text-gray-400">
        <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p>제출서류 목록이 아직 추출되지 않았습니다</p>
        <p className="text-xs mt-1">PDF를 다시 업로드하면 AI가 자동 분석합니다</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(requiredDocuments).map(([category, docs]) => (
        <Section key={category} title={`${category} 서류`} defaultOpen={category === "공통"}>
          <ul className="space-y-2">
            {docs.map((doc, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <div className={`w-5 h-5 rounded-full bg-${DOC_COLORS[category] || "gray"}-100 flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  <FileText className={`w-3 h-3 text-${DOC_COLORS[category] || "gray"}-600`} />
                </div>
                <span>{doc}</span>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────── */

export default function AnnouncementDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params?.id);

  const [ann, setAnn] = useState<AnnouncementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    if (!id || Number.isNaN(id)) {
      setError("잘못된 공고 ID입니다.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/announcements/${id}`);
        if (!cancelled) setAnn(r.data);
      } catch (err: any) {
        const local = localAnnouncements.get(id);
        if (!cancelled) {
          if (local) {
            setAnn(local as unknown as AnnouncementDetail);
          } else {
            setError(
              isNetworkError(err)
                ? "해당 공고를 찾을 수 없습니다."
                : err?.response?.data?.detail || "공고를 불러오지 못했습니다."
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="card text-center py-16 text-gray-400">
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-60" />
          <p>공고 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !ann) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <button onClick={() => router.push("/announcements")} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> 목록으로 돌아가기
        </button>
        <div className="card text-center py-16">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-400" />
          <p className="text-gray-700 font-medium">{error || "공고를 찾을 수 없습니다"}</p>
        </div>
      </div>
    );
  }

  const rules = ann.eligibility_rules || {};
  const regionFull: string = rules.region_full || (rules.region_priority || []).join(" ") || "";
  const regulation: string = rules.regulation || (rules.no_home_required ? "비규제" : "");
  const totalUnits = rules.total_units || (rules.exclusive_areas || []).reduce((s: number, a: any) => s + (a.totalUnits || 0), 0);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <a href="/announcements" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> 모집공고 목록
      </a>

      <div className="mb-6">
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <h1 className="text-2xl font-bold text-gray-900">{ann.title}</h1>
          {regulation && <Badge text={regulation} cls={REG_COLOR[regulation] || "bg-gray-100 text-gray-700"} />}
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          {regionFull && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> {regionFull}
            </span>
          )}
          {totalUnits > 0 && (
            <span className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> {totalUnits}세대
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
              tab === key
                ? "bg-white text-blue-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[500px]">
        {tab === "overview" && <OverviewTab ann={ann} rules={rules} />}
        {tab === "eligibility" && <EligibilityTab rules={rules} />}
        {tab === "special" && <SpecialTab rules={rules} />}
        {tab === "income" && <IncomeTab rules={rules} />}
        {tab === "documents" && <DocumentsTab rules={rules} />}
      </div>
    </div>
  );
}
