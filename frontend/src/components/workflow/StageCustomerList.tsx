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
import {
  evaluateRegistration, evaluateHousehold, evaluateProperty, evaluateSavings,
  type StageVerdict,
} from "@/lib/verification-rules";
import { formatHousingCode } from "@/lib/housing-code";
import {
  ChevronRight, Loader2, Search, ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react";

export interface StageColumn {
  key: string;
  header: string;
  render: (customer: LocalCustomer, verdict: StageVerdict) => React.ReactNode;
  cls?: string;
  /**
   * 정렬 키 추출 함수. 지정하면 헤더가 클릭 가능한 정렬 토글이 됨.
   * 반환값은 string | number — 같은 컬럼은 일관된 타입을 반환해야 함.
   */
  sortValue?: (customer: LocalCustomer, verdict: StageVerdict) => string | number | null | undefined;
}

/** 이전 단계 부적합자 캐스케이드 필터링용 */
type PriorStage = "registration" | "household" | "property" | "savings";

interface Props {
  announcement: LocalAnnouncement;
  /** 각 고객의 해당 단계 verdict 계산 함수 */
  evaluate: (customer: LocalCustomer, announcement: LocalAnnouncement) => StageVerdict;
  columns: StageColumn[];
  /** 성명 컬럼 앞에 추가할 컬럼들 (예: 5단계는 동호수를 가장 먼저 노출) */
  prefixColumns?: StageColumn[];
  /** 이 단계에 해당하는 URL stage 숫자 (행 클릭 시 /customers/[id]?stage=N) */
  stageNumber: number;
  /**
   * 이전 단계에서 명확히 부적합(fail)으로 판정된 고객을 리스트에서 제외.
   * 예: 3단계(주택소유)에서는 ['registration', 'household']을 전달하면
   *     1·2단계 부적합자가 가려진다. 사용자는 토글로 다시 볼 수 있음.
   */
  excludeFailedStages?: PriorStage[];
}

/** 특정 단계에서 명확히 fail인지 판정 (missing은 데이터 부족 — 제외 대상 아님) */
function evaluatePriorStage(
  stage: PriorStage,
  c: LocalCustomer,
  ann: LocalAnnouncement,
): StageVerdict {
  switch (stage) {
    case "registration": return evaluateRegistration(c);
    case "household":    return evaluateHousehold(c);
    case "property":     return evaluateProperty(c, ann);
    case "savings":      return evaluateSavings(c, ann);
  }
}

const STAGE_LABEL_KO: Record<PriorStage, string> = {
  registration: "당첨자 등록",
  household: "세대원 확인",
  property: "주택소유",
  savings: "청약통장",
};

export default function StageCustomerList({
  announcement, evaluate, columns, prefixColumns = [], stageNumber,
  excludeFailedStages = [],
}: Props) {
  const router = useRouter();
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [listTab, setListTab] = useState<"winners" | "standbys" | "all">("winners");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "fail" | "missing">("all");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [supplyFilter, setSupplyFilter] = useState<string>("all");
  /** 이전 단계 부적합자를 가려둘지 여부 (기본 true — excludeFailedStages가 있으면 자동 활성) */
  const [hidePriorFailed, setHidePriorFailed] = useState<boolean>(true);
  /** 정렬 상태 — null이면 기본 순서(서버 응답) */
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  /** 헤더 클릭 → 정렬 토글: 같은 컬럼이면 방향 반전, 다른 컬럼이면 새 컬럼+오름차순 */
  const handleSort = (key: string) => {
    if (sortKey === key) {
      // 오름 → 내림 → 해제 순환
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey(null); setSortDir("asc"); }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ active }: { active: boolean }) => {
    if (!active) return <ArrowUpDown className="w-3 h-3 text-ink-4 opacity-50" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 text-accent" />
      : <ArrowDown className="w-3 h-3 text-accent" />;
  };

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

  /** 이 고객이 excludeFailedStages 중 하나에서 fail이면 true */
  const isPriorFailed = useCallback(
    (c: LocalCustomer) => {
      if (excludeFailedStages.length === 0) return false;
      for (const stage of excludeFailedStages) {
        const v = evaluatePriorStage(stage, c, announcement);
        // missing(데이터 부족)은 가리지 않음 — fail(명백한 부적합)만 제외
        if (!v.ok && !v.missing) return true;
      }
      return false;
    },
    [excludeFailedStages, announcement],
  );

  const rows = useMemo(() => {
    return customers
      .filter((c) => !c.superseded) // 포기·승계된 사람은 기본 제외
      .map((c) => ({
        customer: c,
        verdict: evaluate(c, announcement),
        priorFailed: isPriorFailed(c),
      }));
  }, [customers, announcement, evaluate, isPriorFailed]);

  const priorFailedCount = rows.filter((r) => r.priorFailed).length;

  // 주택형·공급유형 옵션 (현재 공고의 고객 데이터에서 추출)
  const unitOptions = useMemo(
    () => Array.from(new Set(customers.map((c) => c.unit_type).filter(Boolean) as string[])).sort(),
    [customers],
  );
  const supplyOptions = useMemo(
    () => Array.from(new Set(customers.map((c) => c.supply_type).filter(Boolean) as string[])).sort(),
    [customers],
  );

  const filtered = rows.filter(({ customer: c, verdict: v, priorFailed }) => {
    // 이전 단계 부적합자는 토글 OFF일 때 가림
    if (hidePriorFailed && priorFailed) return false;
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

  // 정렬 적용 — 모든 컬럼(prefix + 성명 + columns) 중 sortKey와 매칭되는 sortValue 사용
  const allColumns = [...prefixColumns, ...columns];
  const sortFn = useMemo(() => {
    if (!sortKey) return null;
    if (sortKey === "name") {
      // 성명은 하드코딩 컬럼이라 별도 처리
      return (a: LocalCustomer, b: LocalCustomer) =>
        (a.name || "").localeCompare(b.name || "", "ko");
    }
    const col = allColumns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return null;
    return (a: LocalCustomer, b: LocalCustomer, va: StageVerdict, vb: StageVerdict) => {
      const ra = col.sortValue!(a, va);
      const rb = col.sortValue!(b, vb);
      // null/undefined는 항상 뒤로
      if (ra == null && rb == null) return 0;
      if (ra == null) return 1;
      if (rb == null) return -1;
      if (typeof ra === "number" && typeof rb === "number") return ra - rb;
      return String(ra).localeCompare(String(rb), "ko");
    };
  }, [sortKey, allColumns]);

  const sorted = useMemo(() => {
    if (!sortFn) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    const out = [...filtered].sort((x, y) => {
      const r = sortKey === "name"
        ? (sortFn as (a: LocalCustomer, b: LocalCustomer) => number)(x.customer, y.customer)
        : (sortFn as (a: LocalCustomer, b: LocalCustomer, va: StageVerdict, vb: StageVerdict) => number)(x.customer, y.customer, x.verdict, y.verdict);
      return r * dir;
    });
    return out;
  }, [filtered, sortFn, sortDir, sortKey]);

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

        {/* 이전 단계 부적합자 토글 — excludeFailedStages가 있을 때만 노출 */}
        {excludeFailedStages.length > 0 && priorFailedCount > 0 && (
          <button
            onClick={() => setHidePriorFailed((v) => !v)}
            title={`이전 단계(${excludeFailedStages.map((s) => STAGE_LABEL_KO[s]).join(", ")})에서 부적합 판정된 ${priorFailedCount}명을 ${hidePriorFailed ? "숨김" : "표시"} 중`}
            className={`px-2.5 py-1 rounded-md text-[11.5px] inline-flex items-center gap-1.5 border transition-colors ${
              hidePriorFailed
                ? "bg-surface2 text-ink-3 border-border hover:text-ink"
                : "bg-amber-50 text-amber-800 border-amber-300"
            }`}
          >
            <span>{hidePriorFailed ? "👁️‍🗨️" : "👁️"}</span>
            {hidePriorFailed ? "이전 단계 부적합자 숨김" : "전부 표시 중"}
            <span className="text-[10px] text-ink-4 tnum">({priorFailedCount}명 제외)</span>
          </button>
        )}

        {/* 검증 상태 필터 — 신입을 위해 호버 시 정의 표시 */}
        <div className="inline-flex rounded-md bg-surface2 p-0.5 border border-border">
          {[
            { key: "all" as const,     label: "전체",     count: counts.all,     tone: null,        tip: "이 단계의 모든 당첨자" },
            { key: "ok" as const,      label: "통과",     count: counts.ok,      tone: "bg-ok",     tip: "이 단계 자동 검증을 통과한 당첨자 — 다음 단계로 이동 가능" },
            { key: "fail" as const,    label: "부적합",   count: counts.fail,    tone: "bg-fail",   tip: "이 단계에서 명확히 자격 미달로 판정된 당첨자 — 같은 주택형 예비에서 승계 처리 대상" },
            { key: "missing" as const, label: "검증 필요", count: counts.missing, tone: "bg-ink-4",  tip: "데이터·서류가 부족해 자동 판정 보류 — 추가 자료 입력 또는 수동 검토 필요" },
          ].map((t) => {
            const active = statusFilter === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setStatusFilter(t.key)}
                title={t.tip}
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
            <option key={u} value={u}>{formatHousingCode(u)}</option>
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
              {prefixColumns.map((col) => {
                const sortable = !!col.sortValue;
                const active = sortKey === col.key;
                return (
                  <th
                    key={`p-${col.key}`}
                    onClick={sortable ? () => handleSort(col.key) : undefined}
                    className={`text-left px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-ink-3 ${col.cls || ""} ${
                      sortable ? "cursor-pointer select-none hover:text-ink" : ""
                    } ${active ? "text-accent" : ""}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {sortable && <SortIcon active={active} />}
                    </span>
                  </th>
                );
              })}
              <th
                onClick={() => handleSort("name")}
                className={`text-left px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-ink-3 cursor-pointer select-none hover:text-ink ${
                  sortKey === "name" ? "text-accent" : ""
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  성명
                  <SortIcon active={sortKey === "name"} />
                </span>
              </th>
              {columns.map((col) => {
                const sortable = !!col.sortValue;
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={sortable ? () => handleSort(col.key) : undefined}
                    className={`text-left px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-ink-3 ${col.cls || ""} ${
                      sortable ? "cursor-pointer select-none hover:text-ink" : ""
                    } ${active ? "text-accent" : ""}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {sortable && <SortIcon active={active} />}
                    </span>
                  </th>
                );
              })}
              <th className="px-3 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={prefixColumns.length + columns.length + 2} className="text-center py-10 text-ink-4">
                <Loader2 className="w-4 h-4 mx-auto mb-2 animate-spin opacity-60" />
                <span className="text-xs">불러오는 중...</span>
              </td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={prefixColumns.length + columns.length + 2} className="text-center py-10 text-ink-4 text-xs">
                조건에 맞는 고객이 없습니다
              </td></tr>
            ) : sorted.map(({ customer: c, verdict: v }) => {
              return (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/customers/${c.id}?stage=${stageNumber}`)}
                  className={`cursor-pointer border-t border-border-soft transition-colors hover:bg-surface2 ${
                    c.is_standby ? "bg-standby-soft/40" : ""
                  }`}
                >
                  {prefixColumns.map((col) => (
                    <td key={`p-${col.key}`} className={`px-3.5 py-2.5 text-[12px] text-ink-2 ${col.cls || ""}`}>
                      {col.render(c, v)}
                    </td>
                  ))}
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
        {sorted.length > 0 && (
          <div className="px-3.5 py-2 border-t border-border-soft text-[10.5px] text-ink-4 text-right">
            총 {sorted.length}명 표시됨
            {sorted.length < rows.length && (
              <> · <span className="text-accent font-medium">전체 {rows.length}명 중</span></>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
