"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Upload, Download, Check, ArrowRight, Cloud, CloudDownload, CloudUpload, Loader2,
} from "lucide-react";
import { pushAll, pullAll, checkCloudStatus } from "@/lib/cloud-sync";
import { useRealtimeSync } from "@/lib/realtime/useRealtimeSync";
import { allDeadlineAlerts, alertLabel, alertColorClass } from "@/lib/deadline-alerts";

const WORKFLOW_STEPS_META = [
  { n: 1, key: "registration", label: "당첨자 등록",      href: "/workflow/registration" },
  { n: 2, key: "household",    label: "세대·가족관계",    href: "/workflow/household" },
  { n: 3, key: "property",     label: "주택소유 조회",    href: "/workflow/property" },
  { n: 4, key: "savings",      label: "청약통장 검증",    href: "/workflow/savings" },
  { n: 5, key: "documents",    label: "서류검토·최종판정", href: "/workflow/documents" },
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
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<LocalAnnouncement[]>([]);
  const [activeAnn, setActiveAnn] = useState<LocalAnnouncement | null>(null);
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);
  const [syncBusy, setSyncBusy] = useState<"push" | "pull" | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [cloudCounts, setCloudCounts] = useState<{ sites: number; announcements: number; customers: number } | null>(null);

  async function handlePush() {
    if (syncBusy) return;
    setSyncBusy("push"); setSyncMsg(null);
    const r = await pushAll();
    setSyncBusy(null);
    setSyncMsg(r.ok
      ? `☁️ 업로드 완료 — 공고 ${r.counts.announcements}건 · 고객 ${r.counts.customers}명`
      : `❌ 업로드 실패: ${r.error}`);
    const s = await checkCloudStatus();
    if (s.ok && s.counts) setCloudCounts(s.counts);
  }

  async function handlePull() {
    if (syncBusy) return;
    if (!confirm("클라우드 데이터로 로컬을 덮어씁니다. 현재 로컬 변경사항은 사라져요. 진행할까요?")) return;
    setSyncBusy("pull"); setSyncMsg(null);
    const r = await pullAll();
    setSyncBusy(null);
    setSyncMsg(r.ok
      ? `⬇️ 다운로드 완료 — 공고 ${r.counts.announcements}건 · 고객 ${r.counts.customers}명`
      : `❌ 다운로드 실패: ${r.error}`);
    if (r.ok) setTimeout(() => window.location.reload(), 800);
  }

  useEffect(() => {
    checkCloudStatus().then((s) => { if (s.ok && s.counts) setCloudCounts(s.counts); });
  }, []);

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

  // 실시간: 다른 사용자가 변경하면 리스트·카운트 재계산
  async function refetchFromCloud() {
    const r = await pullAll();
    if (r.ok && activeAnn) {
      setCustomers(localCustomers.listByAnnouncement(activeAnn.id));
    }
    const s = await checkCloudStatus();
    if (s.ok && s.counts) setCloudCounts(s.counts);
  }

  useRealtimeSync({
    onCustomerChange: refetchFromCloud,
    onAnnouncementChange: refetchFromCloud,
    onFileUploaded: refetchFromCloud,
  });

  // 통계 계산 — 실무에서 '오늘 뭘 처리해야 하나'에 답하는 카드들
  const stats = useMemo(() => {
    const active = customers.filter((c) => !c.superseded);
    const winners = active.filter((c) => !c.is_standby);
    const standbys = active.filter((c) => c.is_standby);
    let eligible = 0, ineligible = 0, needsReview = 0;
    let notSubmitted = 0;   // 서류 한 장도 안 올린 사람 (미제출)
    let atRisk = 0;         // 부적격 위험 (verdict 미확정 + reasons 또는 fail)
    let contractReady = 0;  // 계약 가능 (eligible + 서류 묶음 첨부됨)

    for (const c of winners) {
      const v = c.verification_verdict;
      if (v === "eligible") {
        eligible++;
        // 계약 가능: 적합 + 묶음 PDF 첨부됨 (실제 계약 진행 가능 상태)
        if ((c as any).document_files?.["서류 묶음(통합)"]) contractReady++;
        else contractReady++; // 적합이면 일단 계약 가능 후보로 카운트
      } else if (v === "ineligible") {
        ineligible++;
      } else {
        needsReview++;
        // 미제출: document_files에 url/pages가 하나도 없음
        const docFiles = (c as any).document_files || {};
        const hasFile = Object.values(docFiles).some((f: any) =>
          f?.url || (Array.isArray(f?.pages) && f.pages.length > 0) || f?.page,
        );
        if (!hasFile) notSubmitted++;

        // 부적격 위험: 활성 공고 기준 — 단계 평가에서 fail이 1개 이상 있는 사람
        if (activeAnn) {
          const docList = computeDocList(c, activeAnn);
          const final = evaluateFinal(c, activeAnn, c.documents_submitted || {}, docList);
          const hasFail =
            (!final.stages.registration.ok && !final.stages.registration.missing) ||
            (!final.stages.household.ok && !final.stages.household.missing) ||
            (!final.stages.property.ok && !final.stages.property.missing) ||
            (!final.stages.savings.ok && !final.stages.savings.missing);
          if (hasFail) atRisk++;
        }
      }
    }
    return {
      totalCustomers: active.length,
      winners: winners.length,
      standbys: standbys.length,
      eligible,
      ineligible,
      needsReview,
      notSubmitted,
      atRisk,
      contractReady: eligible, // '계약 가능' = 적합 판정자 (정확한 정의)
    };
  }, [customers, activeAnn]);

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

  // 확인 필요 목록 — 위험도(높음/중간/낮음) 순으로 정렬
  type Risk = "high" | "med" | "low";
  const attentionList = useMemo(() => {
    if (!activeAnn) return [];
    const winners = customers.filter((c) => !c.is_standby && !c.superseded);
    const rows: Array<{
      id: number;
      name: string;
      supplyType: string;
      reason: string;
      risk: Risk;
      riskRank: number;
      dueLabel: string;
      dueDays: number;
    }> = [];
    // 가장 가까운 마감일 (서류접수 마감 우선)
    const docEnd = (activeAnn as any).document_submit_end || (activeAnn as any).contract_end;
    const dueDate = docEnd ? new Date(docEnd) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = dueDate
      ? Math.round((dueDate.getTime() - today.getTime()) / 86400000)
      : 999;

    for (const c of winners) {
      const docList = computeDocList(c, activeAnn);
      const final = evaluateFinal(c, activeAnn, c.documents_submitted || {}, docList);

      // 적합 확정/부적합 확정/계약 완료자는 '확인 필요' 대상 아님
      if (final.verdict === "eligible" || final.verdict === "ineligible") continue;
      // 부적합 사유 또는 경고가 있는 사람만
      const hasReasons = final.reasons.length > 0;
      const hasWarnings = final.warnings.length > 0;
      if (!hasReasons && !hasWarnings) continue;

      // 위험도 산정:
      //   - 다단계 fail 또는 주택소유 fail → 높음 (부적격 확정 직전)
      //   - 단일 단계 fail 또는 다수 warning → 중간
      //   - 단일 warning만 → 낮음
      const failedStages = [
        !final.stages.registration.ok && !final.stages.registration.missing,
        !final.stages.household.ok && !final.stages.household.missing,
        !final.stages.property.ok && !final.stages.property.missing,
        !final.stages.savings.ok && !final.stages.savings.missing,
      ].filter(Boolean).length;

      const propertyFail = !final.stages.property.ok && !final.stages.property.missing;
      let risk: Risk;
      let riskRank: number;
      if (failedStages >= 2 || propertyFail || daysLeft <= 1) {
        risk = "high";
        riskRank = 0;
      } else if (failedStages === 1 || final.warnings.length >= 2 || daysLeft <= 5) {
        risk = "med";
        riskRank = 1;
      } else {
        risk = "low";
        riskRank = 2;
      }

      rows.push({
        id: c.id,
        name: c.name,
        supplyType: c.supply_type || "—",
        reason: (final.reasons[0] || final.warnings[0] || "").slice(0, 60),
        risk,
        riskRank,
        dueLabel: dueDate ? (daysLeft >= 0 ? `D-${daysLeft}` : `D+${-daysLeft}`) : "—",
        dueDays: daysLeft,
      });
    }
    // 위험도 → 마감 임박 → 이름순으로 정렬
    rows.sort((a, b) => a.riskRank - b.riskRank || a.dueDays - b.dueDays || a.name.localeCompare(b.name, "ko"));
    return rows.slice(0, 8);
  }, [customers, activeAnn]);

  // Hero용 — 활성 공고의 가장 가까운 마감 (서류접수 우선)
  const heroDeadline = useMemo(() => {
    if (!activeAnn) return null;
    const docEnd = (activeAnn as any).document_submit_end || (activeAnn as any).contract_end;
    if (!docEnd) return null;
    const due = new Date(docEnd);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - today.getTime()) / 86400000);
    return { days, label: days >= 0 ? `D-${days}` : `D+${-days}` };
  }, [activeAnn]);

  /** 카드 정의: 미처리 3종(미제출·확인필요·부적격위험)은 Hero가 흡수 → 보조 통계 4개만 */
  const statCards = [
    { label: "당첨자",     value: stats.winners,       tone: "neutral" as const, href: "/workflow/registration" },
    { label: "예비",       value: stats.standbys,      tone: "neutral" as const, href: "/workflow/registration" },
    { label: "계약 가능",  value: stats.contractReady, tone: "ok" as const,      href: "/workflow/documents", hint: "최종 적합 판정자" },
    { label: "부적격",     value: stats.ineligible,    tone: "fail" as const,    href: "/workflow/documents" },
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
          <h1 className="text-3xl font-bold text-ink tracking-[-0.6px]">현장 현황</h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {cloudCounts && (
            <span className="text-[10.5px] text-ink-3 mr-1 inline-flex items-center gap-1">
              <Cloud className="w-3 h-3 text-ink-4" />
              DB {cloudCounts.announcements}공고 · {cloudCounts.customers}고객
            </span>
          )}
          <button
            onClick={handlePush}
            disabled={!!syncBusy}
            className="btn-secondary inline-flex items-center gap-1"
            title="이 기기의 로컬 데이터를 클라우드 DB로 백업 업로드"
          >
            {syncBusy === "push" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
            DB 백업 ↑
          </button>
          <button
            onClick={handlePull}
            disabled={!!syncBusy}
            className="btn-secondary inline-flex items-center gap-1"
            title="클라우드 DB의 데이터를 이 기기로 가져오기 (로컬 덮어쓰기)"
          >
            {syncBusy === "pull" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
            DB 가져오기 ↓
          </button>
          <button className="btn-secondary inline-flex items-center gap-1">
            <Download className="w-3.5 h-3.5" /> 보고서
          </button>
          <Link
            href="/workflow/registration"
            className="btn-primary inline-flex items-center gap-1"
            title="당첨자 명단·서류 PDF 등을 업로드해 당첨자로 등록"
          >
            <Upload className="w-3.5 h-3.5" /> 당첨자 등록
          </Link>
        </div>
      </div>
      {syncMsg && (
        <div className="mb-3 px-3 py-2 rounded-md bg-accent-soft border border-accent-line text-[11.5px] text-ink-2">
          {syncMsg}
        </div>
      )}

      {/* Block B — Announcement picker (Hero가 활성 공고 기준이라 위로) */}
      <div className="mb-3.5">
        <AnnouncementPicker
          announcements={announcements as any}
          selected={activeAnn as any}
          onSelect={(a) => setActiveAnn(a as any)}
          onOpenDetail={() => {}}
        />
      </div>

      {/* Hero — 처리 대기 큐 요약 → 서류검토 */}
      <Link href="/workflow/documents" className="block mb-6">
        <div className="rounded-xl border border-accent-line bg-accent-soft px-6 py-5 transition-colors hover:brightness-[0.98]">
          {stats.needsReview === 0 ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-ok text-white">
                <Check className="w-5 h-5" strokeWidth={2.5} />
              </span>
              <div>
                <div className="text-lg font-bold text-ink">처리 대기 0 — 모든 당첨자 검토 완료</div>
                <div className="text-xs text-ink-3 mt-0.5">새 당첨자 등록 또는 다른 공고를 확인하세요</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-accent mb-1">처리 대기</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[44px] leading-none font-bold tracking-[-1.5px] text-ink tnum">
                    {stats.needsReview}
                  </span>
                  <span className="text-base text-ink-2 font-medium">건</span>
                </div>
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  {stats.notSubmitted > 0 && (
                    <span className="badge-warn">미제출 {stats.notSubmitted}</span>
                  )}
                  {stats.atRisk > 0 && (
                    <span className="badge-fail">부적격 위험 {stats.atRisk}</span>
                  )}
                  {heroDeadline && (
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium ${
                        heroDeadline.days <= 5 ? "bg-fail-soft text-fail" : "bg-surface2 text-ink-3"
                      }`}
                    >
                      마감 {heroDeadline.label}
                    </span>
                  )}
                </div>
              </div>
              <span className="btn-accent inline-flex items-center gap-1.5 text-sm px-4 py-2">
                큐 열기 <ArrowRight className="w-4 h-4" />
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Block C — Stats grid (보조 통계 4개) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-6">
        {statCards.map((s) => {
          const valueCls =
            s.tone === "ok" ? "text-ok"
            : s.tone === "fail" ? "text-fail"
            : "text-ink";
          const card = (
            <div
              className="card !p-3.5 transition-colors hover:bg-surface2 cursor-pointer h-full"
              title={(s as any).hint}
            >
              <div className="text-[11px] text-ink-3 font-medium">{s.label}</div>
              <div className="flex items-baseline gap-2 mt-1">
                <div className={`text-[30px] font-bold tracking-[-1px] tnum ${valueCls}`}>
                  {s.value.toLocaleString()}
                </div>
              </div>
              {(s as any).hint && (
                <div className="text-[9.5px] text-ink-4 mt-1 leading-tight">
                  {(s as any).hint}
                </div>
              )}
            </div>
          );
          return (s as any).href ? (
            <Link key={s.label} href={(s as any).href}>{card}</Link>
          ) : (
            <div key={s.label}>{card}</div>
          );
        })}
      </div>

      {/* 마감일 자동 알림 배너 (전체 공고 교차 — 보조) */}
      {(() => {
        const customersByAnn = new Map<number | string, LocalCustomer[]>();
        for (const a of announcements) {
          customersByAnn.set(a.id, localCustomers.listByAnnouncement(a.id as any));
        }
        const alerts = allDeadlineAlerts(announcements, customersByAnn);
        if (alerts.length === 0) return null;
        const top = alerts.slice(0, 4);
        return (
          <div className="mb-6 space-y-1.5">
            {top.map((a, i) => (
              <Link
                key={i}
                href={`/announcements/${a.announcementId}`}
                className={`block border rounded-lg px-3 py-2 text-xs transition-colors hover:bg-white/5 ${alertColorClass(a.level)}`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{alertLabel(a.daysLeft)}</span>
                    <span className="font-semibold">{a.label}</span>
                    <span className="text-[11px] opacity-80">
                      · {a.dueDate.getFullYear()}.{String(a.dueDate.getMonth() + 1).padStart(2, "0")}.{String(a.dueDate.getDate()).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.pendingCount !== undefined && a.totalCount !== undefined && (
                      <span className="text-[11px] font-medium">
                        미처리 <strong>{a.pendingCount}</strong>/{a.totalCount}명
                      </span>
                    )}
                    <span className="text-[11px] opacity-70 truncate max-w-[240px]">{a.announcementTitle}</span>
                  </div>
                </div>
              </Link>
            ))}
            {alerts.length > top.length && (
              <div className="text-[10.5px] text-ink-3 px-1">… 그 외 {alerts.length - top.length}건 더</div>
            )}
          </div>
        );
      })()}

      {/* Block D — Stage progress */}
      <div className="bg-surface border border-border rounded-lg p-[18px] mb-6">
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
                        ? "bg-ok text-[#0a0a0a]"
                        : isActive
                          ? "bg-accent text-[#0a0a0a]"
                          : "bg-surface2 text-ink-3 border border-border"
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
        {/* 확인 필요 — 위험도 순 */}
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <div className="text-[13px] font-semibold text-ink">확인이 필요한 건</div>
              <div className="text-[10px] text-ink-4 mt-0.5">위험도 높음 → 낮음 + 마감 임박 순</div>
            </div>
            <Link href="/workflow/documents" className="text-[11px] text-accent font-medium">
              전체 보기
            </Link>
          </div>
          {attentionList.length === 0 ? (
            <div className="py-8 text-center text-xs text-ink-4">
              확인이 필요한 건이 없습니다
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-ink-4">
                  <tr className="border-b border-border-soft">
                    <th className="text-left py-1.5 pr-2 font-medium">위험도</th>
                    <th className="text-left py-1.5 pr-2 font-medium">이름</th>
                    <th className="text-left py-1.5 pr-2 font-medium">공급유형</th>
                    <th className="text-left py-1.5 pr-2 font-medium">사유</th>
                    <th className="text-right py-1.5 font-medium">마감</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionList.map((r) => {
                    const riskCls =
                      r.risk === "high" ? "bg-fail text-[#0a0a0a]"
                      : r.risk === "med" ? "bg-warn text-[#0a0a0a]"
                      : "bg-ink-4 text-[#0a0a0a]";
                    const riskLabel =
                      r.risk === "high" ? "높음" : r.risk === "med" ? "중간" : "낮음";
                    return (
                      <tr
                        key={r.id}
                        onClick={() => router.push(`/customers/${r.id}`)}
                        className="cursor-pointer border-b border-border-soft hover:bg-surface2 transition-colors"
                      >
                        <td className="py-2 pr-2">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${riskCls}`}>
                            {riskLabel}
                          </span>
                        </td>
                        <td className="py-2 pr-2 font-semibold text-ink whitespace-nowrap">
                          {r.name}
                        </td>
                        <td className="py-2 pr-2 text-ink-2">{r.supplyType}</td>
                        <td className="py-2 pr-2 text-ink-2 max-w-[220px] truncate" title={r.reason}>
                          {r.reason || "—"}
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className={`text-[10.5px] font-mono tnum ${
                              r.dueDays <= 1 ? "text-fail font-bold"
                              : r.dueDays <= 5 ? "text-warn font-semibold"
                              : "text-ink-3"
                            }`}
                          >
                            {r.dueLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
