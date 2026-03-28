"use client";

import { useState, useEffect, useCallback } from "react";
import { sitesApi, api } from "@/lib/api";
import { Plus, BookOpen, CalendarDays, ChevronRight } from "lucide-react";

interface Announcement {
  id: number;
  title: string;
  announcement_no: string;
  status: string;
  application_start: string;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft:     { label: "준비 중",  cls: "badge-pending" },
  published: { label: "공고 중",  cls: "badge-eligible" },
  closed:    { label: "마감",    cls: "badge-ineligible" },
};

const DEFAULT_RULES = {
  no_home_required: true,
  region_priority: [] as string[],
  min_region_residence_months: 12,
  income_limit: "",
  min_subscription_period: 0,
  special_supply_types: [] as string[],
};

export default function AnnouncementsPage() {
  const [sites, setSites] = useState<any[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    announcement_no: "",
    application_start: "",
    application_end: "",
    winner_announce_date: "",
    contract_start: "",
    contract_end: "",
    rules: { ...DEFAULT_RULES },
    regionInput: "",
  });

  useEffect(() => {
    sitesApi.list().then((r) => {
      setSites(r.data);
      if (r.data.length > 0) setSiteId(r.data[0].id);
    }).catch(() => {});
  }, []);

  const loadAnnouncements = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const r = await api.get(`/announcements/site/${siteId}`);
      setAnnouncements(r.data);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteId) return;
    try {
      await api.post("/announcements/", {
        site_id: siteId,
        title: form.title,
        announcement_no: form.announcement_no || null,
        application_start: form.application_start || null,
        application_end: form.application_end || null,
        winner_announce_date: form.winner_announce_date || null,
        contract_start: form.contract_start || null,
        contract_end: form.contract_end || null,
        eligibility_rules: {
          no_home_required: form.rules.no_home_required,
          region_priority: form.rules.region_priority,
          min_region_residence_months: form.rules.min_region_residence_months,
          income_limit: form.rules.income_limit ? Number(form.rules.income_limit) : null,
          min_subscription_period: form.rules.min_subscription_period,
          special_supply_types: form.rules.special_supply_types,
        },
      });
      setShowForm(false);
      setForm({ title: "", announcement_no: "", application_start: "", application_end: "", winner_announce_date: "", contract_start: "", contract_end: "", rules: { ...DEFAULT_RULES }, regionInput: "" });
      loadAnnouncements();
    } catch (e: any) {
      alert(e.response?.data?.detail || "등록 실패");
    }
  };

  const addRegion = () => {
    if (!form.regionInput.trim()) return;
    setForm((p) => ({ ...p, rules: { ...p.rules, region_priority: [...p.rules.region_priority, p.regionInput.trim()] }, regionInput: "" }));
  };

  const removeRegion = (i: number) => {
    setForm((p) => ({ ...p, rules: { ...p.rules, region_priority: p.rules.region_priority.filter((_, idx) => idx !== i) } }));
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">모집공고 관리</h1>
          <p className="text-sm text-gray-500 mt-1">현장별 청약 공고 및 자격 기준 설정</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> 공고 등록
        </button>
      </div>

      {/* 현장 선택 */}
      <div className="flex gap-3 mb-5">
        <select
          value={siteId || ""}
          onChange={(e) => setSiteId(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* 공고 목록 */}
      {loading ? (
        <div className="card text-center py-10 text-gray-400">불러오는 중...</div>
      ) : announcements.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>등록된 모집공고가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((ann) => {
            const s = STATUS_MAP[ann.status] || STATUS_MAP.draft;
            return (
              <div key={ann.id} className="card hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <BookOpen className="w-5 h-5 text-orange-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{ann.title}</span>
                        <span className={s.cls}>{s.label}</span>
                      </div>
                      {ann.announcement_no && (
                        <span className="text-xs text-gray-400">공고번호: {ann.announcement_no}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {ann.application_start && (
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <CalendarDays className="w-4 h-4" />
                        {new Date(ann.application_start).toLocaleDateString("ko-KR")}
                      </div>
                    )}
                    <a href={`/announcements/${ann.id}`} className="text-blue-600 hover:underline flex items-center gap-1 text-sm">
                      상세 <ChevronRight className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 공고 등록 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-lg font-semibold">모집공고 등록</h2>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-5">
              {/* 기본 정보 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">공고명 *</label>
                <input required value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="예: 힐스테이트 광진 1차 모집공고"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">공고번호 (부동산원)</label>
                <input value={form.announcement_no} onChange={(e) => setForm((p) => ({ ...p, announcement_no: e.target.value }))}
                  placeholder="예: 2026-서울-0001"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* 일정 */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: "application_start", label: "청약 접수 시작일" },
                  { key: "application_end",   label: "청약 접수 종료일" },
                  { key: "winner_announce_date", label: "당첨자 발표일" },
                  { key: "contract_start",    label: "계약 시작일" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                    <input type="datetime-local"
                      value={(form as any)[key]}
                      onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                ))}
              </div>

              {/* 자격 기준 */}
              <div className="border border-gray-200 rounded-xl p-4 space-y-4">
                <h3 className="font-medium text-gray-800">청약 자격 기준</h3>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.rules.no_home_required}
                    onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, no_home_required: e.target.checked } }))} />
                  무주택 필수
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">최소 거주기간 (개월)</label>
                    <input type="number" min={0}
                      value={form.rules.min_region_residence_months}
                      onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, min_region_residence_months: Number(e.target.value) } }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">청약통장 최소 납입 (개월)</label>
                    <input type="number" min={0}
                      value={form.rules.min_subscription_period}
                      onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, min_subscription_period: Number(e.target.value) } }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">소득 상한 (월, 원)</label>
                    <input type="number" min={0}
                      value={form.rules.income_limit}
                      onChange={(e) => setForm((p) => ({ ...p, rules: { ...p.rules, income_limit: e.target.value } }))}
                      placeholder="미설정 시 제한 없음"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                </div>

                {/* 지역 우선순위 */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">지역 우선순위</label>
                  <div className="flex gap-2 mb-2">
                    <input value={form.regionInput}
                      onChange={(e) => setForm((p) => ({ ...p, regionInput: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRegion())}
                      placeholder="예: 서울특별시"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                    <button type="button" onClick={addRegion} className="btn-secondary text-sm px-3">추가</button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {form.rules.region_priority.map((r, i) => (
                      <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">
                        {r}
                        <button type="button" onClick={() => removeRegion(i)} className="hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">취소</button>
                <button type="submit" className="btn-primary flex-1">등록</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
