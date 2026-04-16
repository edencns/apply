"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { localAnnouncements, isNetworkError } from "@/lib/local-store";
import {
  ArrowLeft, BookOpen, CalendarDays, MapPin, Users, Home, Shield,
  FileCheck, Clock, BadgeCheck, AlertCircle, Loader2, FileText, PenTool,
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
  eligibility_rules?: Record<string, any>;
}

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

  const rules = ann.eligibility_rules || {};
  const specialTypes: string[] = rules.special_supply_types || [];
  const regionPriority: string[] = rules.region_priority || [];
  const regionFull: string = rules.region_full || regionPriority.join(" ") || "";
  const regulation: string = rules.regulation || (rules.no_home_required ? "비규제" : "");
  const exclusiveAreas: any[] = rules.exclusive_areas || [];
  const totalUnits = exclusiveAreas.reduce((s: number, a: any) => s + (a.totalUnits || 0), 0);
  const supplyTypesDetail: any[] = rules.supply_types_detail || [];
  const incomeTable: Record<string, any> = rules.income_table || {};
  const requiredDocuments: Record<string, string[]> = rules.required_documents || {};

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 헤더 */}
      <button
        onClick={() => router.push("/announcements")}
        className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> 목록으로 돌아가기
      </button>

      <div className="card mb-6 border-l-4 border-l-blue-300">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-7 h-7 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-xl font-bold text-gray-900">{ann.title}</h1>
              {regulation && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  regulation === "투기과열" ? "bg-red-100 text-red-700"
                  : regulation === "청약과열" ? "bg-orange-100 text-orange-700"
                  : "bg-green-100 text-green-700"
                }`}>{regulation}</span>
              )}
              {source === "local" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                  로컬 저장
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
              {ann.announcement_no && <span>공고번호: {ann.announcement_no}</span>}
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
          <ScheduleItem icon={FileText} label="서류 접수" value={ann.winner_announce_date ? `${formatDate(ann.winner_announce_date)} ~` : "—"} />
          <ScheduleItem icon={PenTool} label="계약 체결" value={formatDateRange(ann.contract_start, ann.contract_end)} />
        </div>
      </section>

      {/* 전용면적별 세대수 */}
      {exclusiveAreas.length > 0 && (
        <section className="card mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Home className="w-5 h-5 text-emerald-500" />
            <h2 className="font-semibold text-gray-900">공급 세대 ({totalUnits}세대)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">타입</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">전용면적</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">총 세대</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">일반</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">특별</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">분양가</th>
                </tr>
              </thead>
              <tbody>
                {exclusiveAreas.map((a: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2.5 px-3 font-medium">{a.area || `타입${i + 1}`}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{a.squareMeters ? `${a.squareMeters}㎡` : "—"}</td>
                    <td className="py-2.5 px-3 text-right font-semibold">{a.totalUnits ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{a.generalUnits ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{a.specialUnits ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{a.price || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 공급유형별 상세 조건 */}
      {supplyTypesDetail.length > 0 && (
        <section className="card mb-5">
          <div className="flex items-center gap-2 mb-4">
            <BadgeCheck className="w-5 h-5 text-purple-500" />
            <h2 className="font-semibold text-gray-900">공급유형별 조건</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {supplyTypesDetail.map((st: any, i: number) => (
              <div key={i} className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-bold text-gray-900">{st.type}</span>
                  {st.requireHomeless && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">무주택</span>
                  )}
                </div>
                <div className="space-y-1.5 text-xs text-gray-600">
                  {st.incomeLimitPercent && (
                    <div className="flex justify-between">
                      <span>소득기준 (외벌이)</span>
                      <span className="font-medium text-gray-900">{st.incomeLimitPercent}%</span>
                    </div>
                  )}
                  {st.incomeLimitDualPercent && (
                    <div className="flex justify-between">
                      <span>소득기준 (맞벌이)</span>
                      <span className="font-medium text-gray-900">{st.incomeLimitDualPercent}%</span>
                    </div>
                  )}
                  {st.minSubscriptionMonths && (
                    <div className="flex justify-between">
                      <span>통장 가입기간</span>
                      <span className="font-medium text-gray-900">{st.minSubscriptionMonths}개월</span>
                    </div>
                  )}
                  {st.maxMarriageYears && (
                    <div className="flex justify-between">
                      <span>혼인기간</span>
                      <span className="font-medium text-gray-900">{st.maxMarriageYears}년 이내</span>
                    </div>
                  )}
                  {st.minChildren && (
                    <div className="flex justify-between">
                      <span>자녀수</span>
                      <span className="font-medium text-gray-900">{st.minChildren}명 이상</span>
                    </div>
                  )}
                  {st.assetLimit && (
                    <div className="flex justify-between">
                      <span>자산한도</span>
                      <span className="font-medium text-gray-900">{st.assetLimit}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 소득기준표 */}
      {Object.keys(incomeTable).length > 0 && (
        <section className="card mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-amber-500" />
            <h2 className="font-semibold text-gray-900">소득기준표 (도시근로자 월평균소득)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">가구원수</th>
                  {(() => {
                    const firstKey = Object.keys(incomeTable)[0];
                    const percents = firstKey ? Object.keys(incomeTable[firstKey]) : [];
                    return percents.map((p) => (
                      <th key={p} className="text-right py-2 px-3 text-xs font-medium text-gray-500">{p}</th>
                    ));
                  })()}
                </tr>
              </thead>
              <tbody>
                {Object.entries(incomeTable).map(([size, vals]: [string, any]) => (
                  <tr key={size} className="border-b border-gray-50">
                    <td className="py-2.5 px-3 font-medium">{size}</td>
                    {Object.values(vals).map((v: any, i: number) => (
                      <td key={i} className="py-2.5 px-3 text-right text-gray-700">
                        {typeof v === "number" ? `${v.toLocaleString("ko-KR")}원` : String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rules.asset_limit && (
            <div className="mt-3 p-3 bg-amber-50 rounded-lg text-sm">
              <span className="font-medium text-amber-800">자산한도:</span> {rules.asset_limit}
              {rules.car_value_limit && <> · <span className="font-medium text-amber-800">자동차:</span> {rules.car_value_limit}</>}
            </div>
          )}
        </section>
      )}

      {/* 자격 기준 */}
      <section className="card mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-indigo-500" />
          <h2 className="font-semibold text-gray-900">청약 자격 기준</h2>
        </div>

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <RuleRow icon={Home} label="무주택 필수" value={rules.no_home_required ? "필수" : "해당 없음"} highlight={rules.no_home_required} />
          <RuleRow icon={Clock} label="최소 거주기간" value={rules.min_region_residence_months ? `${rules.min_region_residence_months}개월` : "—"} />
          <RuleRow icon={Clock} label="청약통장 최소 납입" value={rules.min_subscription_period ? `${rules.min_subscription_period}개월` : "—"} />
          <RuleRow icon={Users} label="소득 상한 (월)" value={rules.income_limit ? `${Number(rules.income_limit).toLocaleString("ko-KR")}원` : "제한 없음"} />
        </dl>

        {regionPriority.length > 0 && (
          <div className="mt-5 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">지역 우선순위</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {regionPriority.map((r: string, i: number) => (
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
              {specialTypes.map((t: string) => (
                <span key={t} className="inline-block text-xs bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full">
                  {SPECIAL_TYPE_LABELS[t] || t}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 제출서류 */}
      {Object.keys(requiredDocuments).length > 0 && (
        <section className="card mb-5">
          <div className="flex items-center gap-2 mb-4">
            <FileCheck className="w-5 h-5 text-teal-500" />
            <h2 className="font-semibold text-gray-900">제출서류</h2>
          </div>
          <div className="space-y-4">
            {Object.entries(requiredDocuments).map(([category, docs]: [string, string[]]) => (
              <div key={category}>
                <h3 className="text-sm font-medium text-gray-700 mb-2">{category}</h3>
                <ul className="space-y-1">
                  {docs.map((doc: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <FileText className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                      {doc}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ScheduleItem({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
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

function RuleRow({ icon: Icon, label, value, highlight }: { icon: typeof Home; label: string; value: string; highlight?: boolean }) {
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
