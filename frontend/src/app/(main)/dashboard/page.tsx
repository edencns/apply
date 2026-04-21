"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  localAnnouncements, activeAnnouncement,
  localCustomers,
  LocalAnnouncement, LocalCustomer,
} from "@/lib/local-store";
import { getSampleAsLocalAnnouncements } from "@/lib/sample-adapter";
import AnnouncementPicker from "@/components/AnnouncementPicker";
import { evaluateFinal } from "@/lib/verification-rules";
import { COMMON_DOCUMENTS, SUPPLY_TYPE_DOCUMENTS } from "@/lib/document-checklist";
import {
  Upload, Download, Check, ArrowRight,
} from "lucide-react";

const WORKFLOW_STEPS_META = [
  { n: 1, key: "registration", label: "당첨자 등록", href: "/workflow/registration" },
  { n: 2, key: "household",    label: "세대원 확인", href: "/workflow/household" },
  { n: 3, key: "property",     label: "주택소유",    href: "/workflow/property" },
  { n: 4, key: "savings",      label: "청약통장",    href: "/workflow/savings" },
  { n: 5, key: "documents",    label: "서류·판정",   href: "/workflow/documents" },
];

function computeDocList(c: LocalCustomer, a: LocalAnnouncement) {
  const supplyType = c.supply_type || c.special_types?.[0] || "일반공급";
  const parsed: Record<string, string[]> = a.eligibility_rules?.required_documents || {};
  const items: Array<{ name: string; conditional: boolean }> = [];
  const common = parsed["공통"] && parsed["공통"].length >= 3 ? parsed["공통"] : COMMON_DOCUMENTS;
  for (const d of common) items.push({ name: d, conditional: /해당\s*시|해당자/.test(d) });
  const typeDocs = parsed[supplyType] && parsed[supplyType].length >= 2
    ? parsed[supplyType]
    : SUPPLY_TYPE_DOCUMENTS[supplyType] || SUPPLY_TYPE_DOCUMENTS["일반공급"] || [];
  for (const d of typeDocs) {
    if (items.some((it) => it.name === d)) continue;
    items.push({ name: d, conditional: /해당\s*시|해당자|임신|기혼자/.test(d) });
  }
  return items;
}

export default function DashboardPage() {
  const [announcements, setAnnouncements] = useState<LocalAnnouncement[]>([]);
  const [activeAnn, setActiveAnn] = useState<LocalAnnouncement | null>(null);
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);

  useEffect(() => {
    (async () => {
      const local = localAnnouncements.listAll();
      const samples = getSampleAsLocalAnnouncements();
      let merged: LocalAnnouncement[] = [];
      try {
        const r = await api.get("/announcements/");
        const backend = Array.isArray(r.data) ? r.data : [];
        merged = [...backend];
        for (const l of local) if (!merged.some((a) => a.id === l.id)) merged.push(l);
        for (const s of samples) if (!merged.some((a) => a.id === s.id)) merged.push(s);
      } catch {
        merged = [...local, ...samples];
      }
      setAnnouncements(merged);
      const saved = activeAnnouncement.get();
      const target =
        (saved && merged.find((a) => a.id === saved.id))
        || (saved?.snapshot as LocalAnnouncement | null)
        || merged[0]
        || null;
      if (target) setActiveAnn(target);
    })();
  }, []);

  useEffect(() => {
    if (!activeAnn) { setCustomers([]); return; }
    activeAnnouncement.set(
      { id: activeAnn.id, title: activeAnn.title, announcement_no: activeAnn.announcement_no },
      activeAnn.id < 0 ? "local" : "backend",
      activeAnn,
    );
    setCustomers(localCustomers.listByAnnouncement(activeAnn.id));
  }, [activeAnn]);

  // 통계 계산
  const stats = useMemo(() => {
    const active = customers.filter((c) => !c.superseded);
    const winners = active.filter((c) => !c.is_standby);
    const standbys = active.filter((c) => c.is_standby);
    let eligible = 0, ineligible = 0, needsReview = 0;
    for (const c of winners) {
      const v = c.verification_verdict;
      if (v === "eligible") eligible++;
      else if (v === "ineligible") ineligible++;
      else needsReview++;
    }
    return {
      totalCustomers: active.length,
      winners: winners.length,
      standbys: standbys.length,
      eligible,
      ineligible,
      needsReview,
    };
  }, [customers]);

  // 단계별 진행률 — 각 단계를 통과(또는 데이터 있음)하는 고객 수 / 전체 당첨자
  const stageProgress = useMemo(() => {
    const winners = customers.filter((c) => !c.is_standby && !c.superseded);
    const total = winners.length || 1;
    const done = {
      registration: winners.length,
      household: winners.filter((c) => (c.household_members?.length ?? 0) > 0).length,
      property: winners.filter((c) => !!c.property_checked_at || (c.properties?.length ?? 0) > 0).length,
      savings: winners.filter((c) => !!c.savings_priority).length,
      documents: winners.filter((c) => c.verification_verdict === "eligible" || c.verification_verdict === "ineligible").length,
    };
    return WORKFLOW_STEPS_META.map((s) => ({
      ...s,
      done: (done as any)[s.key] || 0,
      total: winners.length,
      pct: Math.round(((done as any)[s.key] || 0) / total * 100),
    }));
  }, [customers]);

  // 확인 필요 목록
  const attentionList = useMemo(() => {
    if (!activeAnn) return [];
    const winners = customers.filter((c) => !c.is_standby && !c.superseded);
    const rows: Array<{ id: number; name: string; reason: string; stage: string }> = [];
    for (const c of winners) {
      const docList = computeDocList(c, activeAnn);
      const final = evaluateFinal(c, activeAnn, c.documents_submitted || {}, docList);
      if (final.reasons.length === 0) continue;
      // 우선순위: 어느 단계에서 터진 이슈인지 찾기
      const stageName =
        !final.stages.property.ok ? "주택소유"
        : !final.stages.savings.ok ? "청약통장"
        : !final.stages.household.ok ? "세대원"
        : !final.stages.documents.ok ? "서류"
        : "";
      rows.push({
        id: c.id,
        name: c.name,
        reason: final.reasons[0]?.slice(0, 60) || "",
        stage: stageName || "검수",
      });
      if (rows.length >= 5) break;
    }
    return rows;
  }, [customers, activeAnn]);

  const statCards = [
    { label: "전체 고객",      value: stats.totalCustomers, tone: "neutral" as const },
    { label: "당첨자",         value: stats.winners,        tone: "neutral" as const },
    { label: "검수 완료",      value: stats.eligible,       tone: "ok" as const },
    { label: "확인 필요",      value: stats.needsReview,    tone: "warn" as const },
    { label: "부적격",         value: stats.ineligible,     tone: "fail" as const },
    { label: "예비",           value: stats.standbys,       tone: "neutral" as const },
  ];
  const toneCls: Record<string, string> = {
    ok: "text-ok",
    warn: "text-warn",
    fail: "text-fail",
    neutral: "text-ink-3",
  };

  const avgPct = stageProgress.length > 0
    ? Math.round(stageProgress.reduce((s, x) => s + x.pct, 0) / stageProgress.length)
    : 0;

  return (
    <div className="px-7 py-6 max-w-7xl mx-auto">
      {/* Block A — Page title + actions */}
      <div className="flex items-center justify-between mb-3.5">
        <div>
          <div className="text-[11px] text-ink-3 uppercase tracking-[0.6px] font-medium mb-1">
            대시보드
          </div>
          <h1 className="text-xl font-bold text-ink tracking-[-0.3px]">현장 현황</h1>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary inline-flex items-center gap-1">
            <Download className="w-3.5 h-3.5" /> 보고서
          </button>
          <Link href="/workflow/registration" className="btn-primary inline-flex items-center gap-1">
            <Upload className="w-3.5 h-3.5" /> 파일 업로드
          </Link>
        </div>
      </div>

      {/* Block B — Announcement picker */}
      <div className="mb-3.5">
        <AnnouncementPicker
          announcements={announcements as any}
          selected={activeAnn as any}
          onSelect={(a) => setActiveAnn(a as any)}
          onOpenDetail={() => {}}
        />
      </div>

      {/* Block C — Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-4">
        {statCards.map((s) => (
          <div key={s.label} className="card !p-3.5">
            <div className="text-[11px] text-ink-3 font-medium">{s.label}</div>
            <div className="flex items-baseline gap-2 mt-1">
              <div className="text-[22px] font-bold text-ink tracking-[-0.5px] tnum">
                {s.value.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Block D — Stage progress */}
      <div className="bg-surface border border-border rounded-lg p-[18px] mb-4">
        <div className="flex items-center justify-between mb-3.5">
          <div className="text-[13px] font-semibold text-ink">검수 진행 현황</div>
          <div className="text-[11px] text-ink-3">
            총 5단계 · 평균 <span className="font-semibold text-ink-2 tnum">{avgPct}%</span> 완료
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2.5">
          {stageProgress.map((s) => {
            const isActive = s.pct > 0 && s.pct < 100;
            const isDone = s.pct >= 100;
            return (
              <Link
                key={s.key}
                href={s.href}
                className={`p-3 rounded-md border transition-colors ${
                  isActive
                    ? "bg-accent-soft border-accent-line"
                    : "bg-surface2 border-border-soft hover:border-ink-3"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <span
                    className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold tnum ${
                      isDone
                        ? "bg-ok text-white"
                        : isActive
                          ? "bg-accent text-white"
                          : "bg-surface text-ink-3 border border-border"
                    }`}
                  >
                    {isDone ? <Check className="w-2.5 h-2.5" strokeWidth={2.5} /> : s.n}
                  </span>
                  <span className="text-[11.5px] font-medium text-ink-2">{s.label}</span>
                </div>
                <div className="text-[18px] font-bold text-ink tracking-[-0.3px] tnum">
                  {s.pct}
                  <span className="text-xs text-ink-3 ml-0.5">%</span>
                </div>
                <div className="text-[10px] text-ink-3 mt-0.5 tnum">
                  {s.done} / {s.total}
                </div>
                <div className="mt-2 h-[3px] rounded-sm bg-border overflow-hidden">
                  <div
                    className={`h-full ${isDone ? "bg-ok" : isActive ? "bg-accent" : "bg-ink-4"}`}
                    style={{ width: `${s.pct}%` }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Block E — 2 col */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3.5">
        {/* 확인 필요 */}
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-[13px] font-semibold text-ink">확인이 필요한 건</div>
            <Link href="/workflow/documents" className="text-[11px] text-accent font-medium">
              전체 보기
            </Link>
          </div>
          {attentionList.length === 0 ? (
            <div className="py-8 text-center text-xs text-ink-4">
              확인이 필요한 건이 없습니다
            </div>
          ) : attentionList.map((r, i) => (
            <Link
              href={`/customers/${r.id}`}
              key={r.id}
              className={`flex items-center gap-3 py-2.5 ${
                i > 0 ? "border-t border-border-soft" : ""
              } hover:bg-surface2 -mx-2 px-2 rounded transition-colors`}
            >
              <div className="text-[12.5px] font-semibold text-ink w-[52px]">{r.name}</div>
              <div className="flex-1 text-xs text-ink-2 truncate">{r.reason}</div>
              <div className="text-[10.5px] text-ink-3 bg-surface2 px-2 py-0.5 rounded">
                {r.stage}
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-ink-4" />
            </Link>
          ))}
        </div>

        {/* 최근 활동 */}
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-[13px] font-semibold text-ink mb-3">최근 활동</div>
          {customers.length === 0 ? (
            <div className="py-8 text-center text-xs text-ink-4">활동 기록 없음</div>
          ) : (
            customers
              .slice()
              .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
              .slice(0, 5)
              .map((c, i) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-2.5 py-2 ${
                    i > 0 ? "border-t border-border-soft" : ""
                  }`}
                >
                  <div className="w-1 h-1 rounded-sm bg-accent" />
                  <div className="flex-1 text-xs text-ink-2 truncate">
                    <b className="text-ink font-semibold">{c.name}</b>
                    <span className="text-ink-3">
                      {" · "}
                      {c.is_standby ? "예비 등록" : "당첨자 등록"}
                    </span>
                  </div>
                  <div className="text-[10.5px] text-ink-4">
                    {(c.created_at || "").slice(5, 10) || "—"}
                  </div>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
