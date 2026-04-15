"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { localAnnouncements, isNetworkError, LocalAnnouncement } from "@/lib/local-store";
import {
  ArrowLeft, BookOpen, CalendarDays, MapPin, Users, Home, Shield,
  FileCheck, Clock, BadgeCheck, AlertCircle, Loader2,
} from "lucide-react";

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
  eligibility_rules?: {
    no_home_required?: boolean;
    region_priority?: string[];
    min_region_residence_months?: number;
    income_limit?: number | null;
    min_subscription_period?: number;
    special_supply_types?: string[];
  };
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: "준비 중", cls: "bg-gray-100 text-gray-700" },
  published: { label: "공고 중", cls: "bg-green-100 text-green-700" },
  closed: { label: "마감", cls: "bg-red-100 text-red-700" },
};

const SPECIAL_TYPE_LABELS: Record<string, string> = {
  "신혼부부": "신혼부부",
  "생애최초": "생애 최초",
  "다자녀가구": "다자녀 가구",
  "노부모부양": "노부모 부양",
  "기관추천": "기관 추천",
  "신생아": "신생아",
};

function formatDate(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return "—";
  if (start && !end) return formatDate(start);
  if (!start && end) return formatDate(end);
  return `${formatDate(start)} ~ ${formatDate(end)}`;
}

export default function AnnouncementDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params?.id);

  const [ann, setAnn] = useState<AnnouncementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"backend" | "local">("backend");

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
        if (!cancelled) {
          setAnn(r.data);
          setSource("backend");
        }
      } catch (err: any) {
        if (isNetworkError(err)) {
          const local = localAnnouncements.get(id);
          if (!cancelled) {
            if (local) {
              setAnn(local as unknown as AnnouncementDetail);
              setSource("local");
            } else {
              setError("해당 공고를 찾을 수 없습니다.");
            }
          }
        } else {
          // 404 등 백엔드가 응답은 했는데 못 찾은 경우에도 로컬에서 한 번 더 시도
          const local = localAnnouncements.get(id);
          if (!cancelled) {
            if (local) {
              setAnn(local as unknown as AnnouncementDetail);
              setSource("local");
            } else {
              setError(err?.response?.data?.detail || "공고를 불러오지 못했습니다.");
            }
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

  const s = STATUS_MAP[ann.status] || STATUS_MAP.draft;
  const rules = ann.eligibility_rules || {};
  const specialTypes = rules.special_supply_types || [];
  const regionPriority = rules.region_priority || [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 헤더 */}
      <button
        onClick={() => router.push("/announcements")}
        className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> 목록으로 돌아가기
      </button>

      <div className="card mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div className="w-14 h-14 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-7 h-7 text-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-xl font-bold text-gray-900">{ann.title}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
                {source === "local" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                    로컬 저장
                  </span>
                )}
              </div>
              {ann.announcement_no && (
                <p className="text-sm text-gray-500">공고번호: {ann.announcement_no}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 일정 */}
      <section className="card mb-5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="w-5 h-5 text-blue-500" />
          <h2 className="font-semibold text-gray-900">청약 일정</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScheduleItem icon={Clock} label="청약 접수" value={formatDateRange(ann.application_start, ann.application_end)} />
          <ScheduleItem icon={BadgeCheck} label="당첨자 발표" value={formatDate(ann.winner_announce_date)} />
          <ScheduleItem icon={FileCheck} label="계약 체결" value={formatDateRange(ann.contract_start, ann.contract_end)} />
        </div>
      </section>

      {/* 자격 기준 */}
      <section className="card mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-indigo-500" />
          <h2 className="font-semibold text-gray-900">청약 자격 기준</h2>
        </div>

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <RuleRow
            icon={Home}
            label="무주택 필수"
            value={rules.no_home_required ? "필수" : "해당 없음"}
            highlight={rules.no_home_required}
          />
          <RuleRow
            icon={Clock}
            label="최소 거주기간"
            value={rules.min_region_residence_months ? `${rules.min_region_residence_months}개월` : "—"}
          />
          <RuleRow
            icon={Clock}
            label="청약통장 최소 납입"
            value={rules.min_subscription_period ? `${rules.min_subscription_period}개월` : "—"}
          />
          <RuleRow
            icon={Users}
            label="소득 상한 (월)"
            value={rules.income_limit ? `${rules.income_limit.toLocaleString("ko-KR")}원` : "제한 없음"}
          />
        </dl>

        {regionPriority.length > 0 && (
          <div className="mt-5 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">지역 우선순위</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {regionPriority.map((r, i) => (
                <span key={i} className="inline-block text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                  {i + 1}순위 · {r}
                </span>
              ))}
            </div>
          </div>
        )}

        {specialTypes.length > 0 && (
          <div className="mt-5 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <BadgeCheck className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">특별공급 유형</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {specialTypes.map((t) => (
                <span key={t} className="inline-block text-xs bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full">
                  {SPECIAL_TYPE_LABELS[t] || t}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ScheduleItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
      <Icon className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-500 mb-0.5">{label}</div>
        <div className="text-sm font-medium text-gray-900">{value}</div>
      </div>
    </div>
  );
}

function RuleRow({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: typeof Home;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${highlight ? "text-red-500" : "text-gray-400"}`} />
      <div className="flex-1">
        <dt className="text-xs text-gray-500">{label}</dt>
        <dd className={`text-sm mt-0.5 ${highlight ? "font-semibold text-red-700" : "text-gray-900"}`}>{value}</dd>
      </div>
    </div>
  );
}
