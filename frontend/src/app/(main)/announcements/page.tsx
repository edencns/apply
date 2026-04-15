"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { sitesApi, api } from "@/lib/api";
import { localSites, localAnnouncements, isNetworkError } from "@/lib/local-store";
import { Plus, BookOpen, CalendarDays, ChevronRight, FileUp, Loader2, CheckCircle2 } from "lucide-react";

interface Announcement {
  id: number;
  site_id?: number;
  title: string;
  announcement_no: string;
  status: string;
  application_start: string;
}

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
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfFilled, setPdfFilled] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const [sitesError, setSitesError] = useState<string | null>(null);

  const reloadSites = useCallback(async () => {
    try {
      const r = await sitesApi.list();
      setSites(r.data);
      if (r.data.length > 0) {
        setSiteId(r.data[0].id);
        setSitesError(null);
      }
      return r.data;
    } catch (err: any) {
      if (isNetworkError(err)) {
        // 백엔드 연결 불가 → 로컬 저장소 사용
        const local = localSites.list();
        setSites(local);
        if (local.length > 0) setSiteId(local[0].id);
        setSitesError(null);
        return local;
      }
      console.error("[announcements] sites load failed", err);
      setSitesError(err?.message || "현장 목록을 불러오지 못했습니다.");
      return null;
    }
  }, []);

  useEffect(() => { reloadSites(); }, [reloadSites]);

  const loadAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/announcements/`);
      // 전체 공고. 백엔드/로컬 어느쪽에서 불러오든 최신순으로 정렬
      const data = Array.isArray(r.data) ? r.data : [];
      // 로컬에 저장된 공고들도 함께 병합 (중복 id 제거)
      const local = localAnnouncements.listAll();
      const merged = [...data];
      for (const l of local) {
        if (!merged.some((a) => a.id === l.id)) merged.push(l as any);
      }
      setAnnouncements(
        merged.sort((a: any, b: any) => {
          const ad = a.created_at || a.application_start || "";
          const bd = b.created_at || b.application_start || "";
          return bd.localeCompare(ad);
        }) as any,
      );
    } catch (err: any) {
      if (isNetworkError(err)) {
        setAnnouncements(localAnnouncements.listAll() as any);
      } else {
        console.error("[announcements] load failed", err);
        // 실패 시에도 로컬만이라도 보여준다
        setAnnouncements(localAnnouncements.listAll() as any);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

  /** datetime-local ("YYYY-MM-DDTHH:mm") → "YYYY-MM-DDTHH:mm:00" (FastAPI 친화) */
  const normalizeDateTime = (v: string): string | null => {
    if (!v) return null;
    // 이미 초 포함이면 그대로, 아니면 ":00" 추가
    return /\d{2}:\d{2}:\d{2}/.test(v) ? v : `${v}:00`;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // 제목 필수
    if (!form.title.trim()) {
      setFormError("공고명을 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const eligibilityRules = {
        no_home_required: form.rules.no_home_required,
        region_priority: form.rules.region_priority,
        min_region_residence_months: form.rules.min_region_residence_months,
        income_limit: form.rules.income_limit ? Number(form.rules.income_limit) : null,
        min_subscription_period: form.rules.min_subscription_period,
        special_supply_types: form.rules.special_supply_types,
      };
      const annPayload = {
        title: form.title.trim(),
        announcement_no: form.announcement_no || null,
        application_start: normalizeDateTime(form.application_start),
        application_end: normalizeDateTime(form.application_end),
        winner_announce_date: normalizeDateTime(form.winner_announce_date),
        contract_start: normalizeDateTime(form.contract_start),
        contract_end: normalizeDateTime(form.contract_end),
      };

      // ─── 1) 백엔드 경로 ─────────────────────────────
      let useSiteId = siteId;
      let usedLocal = false;

      try {
        // 현장이 없으면 공고명으로 즉석 생성 (백엔드)
        if (!useSiteId) {
          try {
            const latest = await sitesApi.list();
            if (latest.data.length > 0) {
              useSiteId = latest.data[0].id;
              setSites(latest.data);
              setSiteId(useSiteId);
              setSitesError(null);
            }
          } catch (e) {
            if (isNetworkError(e)) throw e; // 네트워크 에러면 로컬 경로로 점프
          }

          if (!useSiteId) {
            const created = await sitesApi.create({
              name: form.title.trim(),
              address: "미입력",
              total_units: 0,
            });
            useSiteId = (created.data as { id: number }).id;
            reloadSites().catch(() => {});
          }
        }

        await api.post("/announcements/", {
          site_id: useSiteId,
          ...annPayload,
          eligibility_rules: eligibilityRules,
          status: "published", // 등록 즉시 공고 비교/고객/서류 검수에 노출
        });
      } catch (backendErr: any) {
        if (!isNetworkError(backendErr)) throw backendErr;

        // ─── 2) 네트워크 에러 → 로컬 저장소 경로 ────────
        usedLocal = true;
        let localSiteId = useSiteId;
        if (!localSiteId) {
          const existing = localSites.list();
          if (existing.length > 0) {
            localSiteId = existing[0].id;
          } else {
            const s = localSites.create({ name: form.title.trim() });
            localSiteId = s.id;
          }
          setSites(localSites.list());
          setSiteId(localSiteId);
          setSitesError(null);
        }
        localAnnouncements.create({
          site_id: localSiteId,
          ...annPayload,
          eligibility_rules: eligibilityRules,
          status: "published", // 등록 즉시 공고 비교/고객/서류 검수에 노출
        });
      }

      setShowForm(false);
      setPdfFilled([]);
      setForm({ title: "", announcement_no: "", application_start: "", application_end: "", winner_announce_date: "", contract_start: "", contract_end: "", rules: { ...DEFAULT_RULES }, regionInput: "" });
      if (usedLocal) {
        // 로컬 저장 후에도 동일한 loadAnnouncements 경로가 자동으로 local fallback을 탄다
        loadAnnouncements();
      } else {
        loadAnnouncements();
      }
    } catch (err: any) {
      console.error("[announcements] create failed", err);
      const detail =
        err?.response?.data?.detail ||
        (Array.isArray(err?.response?.data) ? JSON.stringify(err.response.data) : null) ||
        err?.message ||
        "등록 실패";
      setFormError(typeof detail === "string" ? detail : JSON.stringify(detail));
    } finally {
      setSubmitting(false);
    }
  };

  const addRegion = () => {
    if (!form.regionInput.trim()) return;
    setForm((p) => ({ ...p, rules: { ...p.rules, region_priority: [...p.rules.region_priority, p.regionInput.trim()] }, regionInput: "" }));
  };

  const removeRegion = (i: number) => {
    setForm((p) => ({ ...p, rules: { ...p.rules, region_priority: p.rules.region_priority.filter((_, idx) => idx !== i) } }));
  };

  /** PDF 업로드 → 서버 파싱 → 폼 자동 채우기 */
  const handlePdfUpload = async (file: File) => {
    setPdfParsing(true);
    setPdfFilled([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-announcement-pdf", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "파싱 실패");
      }
      const d = json.data as Record<string, any>;
      const filled: string[] = [];
      setForm((p) => {
        const next = { ...p, rules: { ...p.rules } };
        if (d.title && !p.title) { next.title = d.title; filled.push("공고명"); }
        if (d.announcementNo && !p.announcement_no) { next.announcement_no = d.announcementNo; filled.push("공고번호"); }
        if (d.applicationStart && !p.application_start) { next.application_start = d.applicationStart; filled.push("청약 접수 시작일"); }
        if (d.applicationEnd && !p.application_end) { next.application_end = d.applicationEnd; filled.push("청약 접수 종료일"); }
        if (d.winnerAnnounceDate && !p.winner_announce_date) { next.winner_announce_date = d.winnerAnnounceDate; filled.push("당첨자 발표일"); }
        if (d.contractStart && !p.contract_start) { next.contract_start = d.contractStart; filled.push("계약 시작일"); }
        if (typeof d.noHomeRequired === "boolean") { next.rules.no_home_required = d.noHomeRequired; filled.push("무주택 필수"); }
        if (d.minSubscriptionMonths) { next.rules.min_subscription_period = d.minSubscriptionMonths; filled.push("통장 납입 기간"); }
        if (Array.isArray(d.specialTypes) && d.specialTypes.length > 0) { next.rules.special_supply_types = d.specialTypes; filled.push(`특별공급(${d.specialTypes.length}종)`); }
        if (d.region && p.rules.region_priority.length === 0) {
          // 시/도 단위만 추출
          const firstRegion = d.region.split(/\s+/)[0];
          if (firstRegion) { next.rules.region_priority = [firstRegion]; filled.push("지역 우선순위"); }
        }
        return next;
      });
      setPdfFilled(filled);
    } catch (err: any) {
      alert(err.message || "PDF 파싱 실패");
    } finally {
      setPdfParsing(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">모집공고 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            등록한 공고는 자동으로 공고 비교 · 고객 관리 · 서류 검수 · 당첨자 · 방문 계약에 연동됩니다
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> 공고 등록
        </button>
      </div>

      {sitesError && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {sitesError}
        </div>
      )}

      {/* 공고 목록 — 전체 */}
      {loading ? (
        <div className="card text-center py-10 text-gray-400">불러오는 중...</div>
      ) : announcements.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>등록된 모집공고가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((ann) => (
            <a
              key={ann.id}
              href={`/announcements/${ann.id}`}
              className="card hover:shadow-md hover:border-blue-300 transition-all block group"
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-orange-100 transition-colors">
                    <BookOpen className="w-5 h-5 text-orange-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{ann.title}</div>
                    <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                      {ann.announcement_no && <span>공고번호: {ann.announcement_no}</span>}
                      {ann.application_start && (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          {new Date(ann.application_start).toLocaleDateString("ko-KR")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors flex-shrink-0" />
              </div>
            </a>
          ))}
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
              {/* PDF 자동 입력 */}
              <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50/50 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center flex-shrink-0">
                    <FileUp className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-blue-900">공고 PDF 자동 입력</div>
                    <p className="text-xs text-blue-700 mt-0.5 mb-2">
                      입주자모집공고문 PDF를 업로드하면 제목·번호·일정·자격 기준을 자동으로 채워넣습니다.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pdfParsing}
                        onClick={() => pdfInputRef.current?.click()}
                        className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
                      >
                        {pdfParsing ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> 분석 중…</>
                        ) : (
                          <><FileUp className="w-3 h-3" /> PDF 선택</>
                        )}
                      </button>
                      {pdfFilled.length > 0 && !pdfParsing && (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700">
                          <CheckCircle2 className="w-3 h-3" />
                          {pdfFilled.length}개 항목 자동 입력됨
                        </span>
                      )}
                    </div>
                    {pdfFilled.length > 0 && !pdfParsing && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {pdfFilled.map((f) => (
                          <span key={f} className="inline-block text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{f}</span>
                        ))}
                      </div>
                    )}
                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handlePdfUpload(f);
                      }}
                    />
                  </div>
                </div>
              </div>

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

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {formError}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setFormError(null); }}
                  disabled={submitting}
                  className="btn-secondary flex-1 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
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
