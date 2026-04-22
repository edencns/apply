"use client";

/**
 * 단계별 고객 리스트 — 각 워크플로우 페이지에서 사용
 *
 * 공고를 받으면 해당 공고의 고객을 로드하고, 단계별 verdict를 계산해
 * 커스텀 columns 정의로 테이블을 렌더링한다. 행 클릭 시 개인 상세로 이동.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  localCustomers,
  isNetworkError,
  LocalCustomer,
  LocalAnnouncement,
} from "@/lib/local-store";
import { customersApi } from "@/lib/api";
import { pullAll } from "@/lib/cloud-sync";
import { useRealtimeSync } from "@/lib/realtime/useRealtimeSync";
import type { StageVerdict } from "@/lib/verification-rules";
import {
  ChevronRight, Loader2, Search,
} from "lucide-react";

export interface StageColumn {
  key: string;
  header: string;
  render: (customer: LocalCustomer, verdict: StageVerdict) => React.ReactNode;
  cls?: string;
}

interface Props {
  announcement: LocalAnnouncement;
  /** 각 고객의 해당 단계 verdict 계산 함수 */
  evaluate: (customer: LocalCustomer, announcement: LocalAnnouncement) => StageVerdict;
  columns: StageColumn[];
  /** 이 단계에 해당하는 URL stage 숫자 (행 클릭 시 /customers/[id]?stage=N) */
  stageNumber: number;
}

export default function StageCustomerList({ announcement, evaluate, columns, stageNumber }: Props) {
  const router = useRouter();
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [listTab, setListTab] = useState<"winners" | "standbys" | "all">("winners");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "fail" | "missing">("all");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [supplyFilter, setSupplyFilter] = useState<string>("all");

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      let list: LocalCustomer[] = [];
      try {
        const r = await api.get(`/customers/announcement/${announcement.id}`);
        list = r.data;
      } catch (e: any) {
        if (e?.response?.status === 404) {
          const r2 = await customersApi.list(announcement.site_id);
          list = r2.data;
        } else throw e;
      }
      setCustomers(list);
    } catch (err: any) {
      if (isNetworkError(err)) {
        setCustomers(localCustomers.listByAnnouncement(announcement.id));
      } else {
        console.error("[workflow] load customers failed", err);
        setCustomers([]);
      }
    } finally {
      setLoading(false);
    }
  }, [announcement.id, announcement.site_id]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // 실시간: 다른 사용자 변경 시 클라우드에서 최신 데이터 pull → 재조회
  useRealtimeSync({
    announcementId: announcement.id,
    onCustomerChange: async () => {
      await pullAll().catch(() => {});
      loadCustomers();
    },
    onFileUploaded: async () => {
      await pullAll().catch(() => {});
      loadCustomers();
    },
  });

  const rows = useMemo(() => {
    return customers
      .filter((c) => !c.superseded) // 포기·승계된 사람은 기본 제외
      .map((c) => ({ customer: c, verdict: evaluate(c, announcement) }));
  }, [customers, announcement, evaluate]);

  // 주택형·공급유형 옵션 (현재 공고의 고객 데이터에서 추출)
  const unitOptions = useMemo(
    () => Array.from(new Set(customers.map((c) => c.unit_type).filter(Boolean) as string[])).sort(),
    [customers],
  );
  const supplyOptions = useMemo(
    () => Array.from(new Set(customers.map((c) => c.supply_type).filter(Boolean) as string[])).sort(),
    [customers],
  );

  const filtered = rows.filter(({ customer: c, verdict: v }) => {
    if (listTab === "winners" && c.is_standby) return false;
    if (listTab === "standbys" && !c.is_standby) return false;
    if (statusFilter === "ok" && !(v.ok && !v.missing)) return false;
    if (statusFilter === "fail" && (v.ok || v.missing)) return false;
    if (statusFilter === "missing" && !v.missing) return false;
    if (unitFilter !== "all" && (c.unit_type || "") !== unitFilter) return false;
    if (supplyFilter !== "all" && (c.supply_type || "") !== supplyFilter) return false;
    const q = search.trim();
    if (!q) return true;
    return c.name.includes(q) || (c.phone || "").includes(q);
  });

  // 상태별 카운트 (필터 UI에 표시)
  const counts = {
    all: rows.length,
    ok: rows.filter(({ verdict: v }) => v.ok && !v.missing).length,
    fail: rows.filter(({ verdict: v }) => !v.ok && !v.missing).length,
    missing: rows.filter(({ verdict: v }) => v.missing).length,
  };

  const winnersCount = customers.filter((c) => !c.is_standby && !c.superseded).length;
  const standbysCount = customers.filter((c) => c.is_standby && !c.superseded).length;
  const allCount = customers.filter((c) => !c.superseded).length;

  return (
    <div>
      {/* 필터 영역 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* 당첨자/예비/전체 */}
        <div className="inline-flex rounded-md bg-surface2 p-0.5 border border-border">
          {[
            { key: "winners" as const, label: "당첨자", count: winnersCount },
            { key: "standbys" as const, label: "예비", count: standbysCount },
            { key: "all" as const, label: "전체", count: allCount },
          ].map((t) => {
            const active = listTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setListTab(t.key)}
                className={`px-2.5 py-1 rounded text-[11.5px] transition-colors inline-flex items-center gap-1.5 ${
                  active
                    ? "bg-surface text-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    : "text-ink-3 hover:text-ink"
                }`}
              >
                {t.label}
                <span className={`text-[10px] tnum ${active ? "text-accent" : "text-ink-4"}`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* 검증 상태 필터 */}
        <div className="inline-flex rounded-md bg-surface2 p-0.5 border border-border">
          {[
            { key: "all" as const,     label: "전체",     count: counts.all,     tone: null },
            { key: "ok" as const,      label: "통과",     count: counts.ok,      tone: "bg-ok" },
            { key: "fail" as const,    label: "부적합",   count: counts.fail,    tone: "bg-fail" },
            { key: "missing" as const, label: "검증 필요", count: counts.missing, tone: "bg-ink-4" },
          ].map((t) => {
            const active = statusFilter === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setStatusFilter(t.key)}
                className={`px-2.5 py-1 rounded text-[11.5px] transition-colors inline-flex items-center gap-1.5 ${
                  active
                    ? "bg-surface text-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    : "text-ink-3 hover:text-ink"
                }`}
              >
                {t.tone && <span className={`w-1.5 h-1.5 rounded-full ${t.tone}`} />}
                {t.label}
                <span className="text-[10px] text-ink-4 tnum">{t.count}</span>
              </button>
            );
          })}
        </div>

        {/* 주택형 필터 */}
        <select
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          className="px-2.5 py-1 rounded-md border border-border bg-surface text-[11.5px] text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">주택형 전체</option>
          {unitOptions.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>

        {/* 공급유형 필터 */}
        <select
          value={supplyFilter}
          onChange={(e) => setSupplyFilter(e.target.value)}
          className="px-2.5 py-1 rounded-md border border-border bg-surface text-[11.5px] text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">공급유형 전체</option>
          {supplyOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div className="flex-1" />

        {/* 검색 */}
        <div className="relative min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 또는 연락처 검색"
            className="w-full pl-8 pr-3 py-1 rounded-md border border-border bg-surface text-[11.5px] placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface2 border-b border-border">
            <tr>
              <th className="text-left px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-ink-3">성명</th>
              {columns.map((col) => (
                <th key={col.key} className={`text-left px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-ink-3 ${col.cls || ""}`}>
                  {col.header}
                </th>
              ))}
              <th className="px-3 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length + 2} className="text-center py-10 text-ink-4">
                <Loader2 className="w-4 h-4 mx-auto mb-2 animate-spin opacity-60" />
                <span className="text-xs">불러오는 중...</span>
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={columns.length + 2} className="text-center py-10 text-ink-4 text-xs">
                조건에 맞는 고객이 없습니다
              </td></tr>
            ) : filtered.map(({ customer: c, verdict: v }) => {
              return (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/customers/${c.id}?stage=${stageNumber}`)}
                  className={`cursor-pointer border-t border-border-soft transition-colors hover:bg-surface2 ${
                    c.is_standby ? "bg-standby-soft/40" : ""
                  }`}
                >
                  <td className="px-3.5 py-2.5 text-[12px] font-semibold text-ink">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{c.name}</span>
                      {c.is_standby && (
                        <span className="text-[9.5px] bg-standby-soft text-standby px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                          예비 {c.standby_rank || ""}
                        </span>
                      )}
                      {c.succeeded_from && (
                        <span className="text-[9.5px] bg-ok-soft text-ok px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                          승계
                        </span>
                      )}
                    </div>
                  </td>
                  {columns.map((col) => (
                    <td key={col.key} className={`px-3.5 py-2.5 text-[12px] text-ink-2 ${col.cls || ""}`}>
                      {col.render(c, v)}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right text-ink-4">
                    <ChevronRight className="w-3.5 h-3.5 inline" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 0 && (
          <div className="px-3.5 py-2 border-t border-border-soft text-[10.5px] text-ink-4 text-right">
            총 {filtered.length}명 표시됨
            {filtered.length < rows.length && (
              <> · <span className="text-accent font-medium">전체 {rows.length}명 중</span></>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
