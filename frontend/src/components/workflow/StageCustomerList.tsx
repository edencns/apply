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
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* 당첨자/예비/전체 */}
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
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
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  active
                    ? t.key === "standbys"
                      ? "bg-white text-amber-700 shadow-sm"
                      : "bg-white text-blue-700 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {t.label}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  active ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-600"
                }`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* 검증 상태 필터 */}
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
          {[
            { key: "all" as const,     label: "전체 상태",  count: counts.all,     cls: "text-gray-700" },
            { key: "ok" as const,      label: "통과",       count: counts.ok,      cls: "text-green-700" },
            { key: "fail" as const,    label: "부적합",     count: counts.fail,    cls: "text-red-700" },
            { key: "missing" as const, label: "검증 필요",     count: counts.missing, cls: "text-gray-500" },
          ].map((t) => {
            const active = statusFilter === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setStatusFilter(t.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  active ? `bg-white ${t.cls} shadow-sm` : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {t.label} <span className="text-[10px] text-gray-400 ml-1">{t.count}</span>
              </button>
            );
          })}
        </div>

        {/* 주택형 필터 */}
        <select
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">공급유형 전체</option>
          {supplyOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* 검색 */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 또는 연락처 검색"
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* 테이블 */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">성명</th>
              {columns.map((col) => (
                <th key={col.key} className={`text-left px-4 py-3 font-medium text-gray-600 ${col.cls || ""}`}>
                  {col.header}
                </th>
              ))}
              <th className="px-3 py-3 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={columns.length + 2} className="text-center py-10 text-gray-400">
                <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin opacity-60" />
                불러오는 중...
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={columns.length + 2} className="text-center py-10 text-gray-400">
                조건에 맞는 고객이 없습니다
              </td></tr>
            ) : filtered.map(({ customer: c, verdict: v }) => {
              return (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/customers/${c.id}?stage=${stageNumber}`)}
                  className={`cursor-pointer hover:bg-blue-50/50 transition-colors ${
                    c.is_standby ? "bg-amber-50/30" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{c.name}</span>
                      {c.is_standby && (
                        <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                          예비 {c.standby_rank || ""}
                        </span>
                      )}
                      {c.succeeded_from && (
                        <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                          승계
                        </span>
                      )}
                    </div>
                  </td>
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 ${col.cls || ""}`}>
                      {col.render(c, v)}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right text-gray-400">
                    <ChevronRight className="w-4 h-4 inline" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 text-right">
            총 {filtered.length}명 표시됨
          </div>
        )}
      </div>
    </div>
  );
}
