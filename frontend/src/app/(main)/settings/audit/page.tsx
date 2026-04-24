"use client";

/**
 * 감사 로그 뷰어 — 관리자 전용
 *
 * 누가 언제 무엇을 어떻게 변경했는지 브라우저에서 바로 확인.
 * SQL 쿼리 없이 audit_log 전체를 시각화.
 */

import { useEffect, useState } from "react";
import {
  Shield, Filter, Clock, User, FileText, Home, AlertTriangle,
  Trash2, Plus, Edit, FileSignature, History, RefreshCw, Loader2,
} from "lucide-react";
import Link from "next/link";

interface AuditRow {
  id: number;
  ts: string;
  user_id: number;
  user_email: string | null;
  entity: "customer" | "announcement" | "file" | "user";
  entity_id: number;
  action: string;
  before?: any;
  after?: any;
  ip?: string | null;
  user_agent?: string | null;
}

const ACTION_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  create: { label: "생성", color: "bg-blue-100 text-blue-800", icon: Plus },
  update: { label: "수정", color: "bg-gray-100 text-gray-700", icon: Edit },
  delete: { label: "삭제", color: "bg-red-100 text-red-800", icon: Trash2 },
  update_verdict: { label: "판정 변경", color: "bg-amber-100 text-amber-800", icon: AlertTriangle },
  manual_sign: { label: "수기 서명", color: "bg-emerald-100 text-emerald-800", icon: FileSignature },
  past_winnings_change: { label: "과거당첨 수정", color: "bg-purple-100 text-purple-800", icon: History },
  role_change: { label: "권한 변경", color: "bg-orange-100 text-orange-800", icon: Shield },
};

const ENTITY_LABELS: Record<string, { label: string; icon: any }> = {
  customer: { label: "당첨자", icon: User },
  announcement: { label: "공고", icon: FileText },
  file: { label: "파일", icon: Home },
  user: { label: "사용자", icon: Shield },
};

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_LABELS[action] || { label: action, color: "bg-gray-100 text-gray-700", icon: Edit };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function EntityBadge({ entity, id }: { entity: string; id: number }) {
  const cfg = ENTITY_LABELS[entity] || { label: entity, icon: Edit };
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-ink-2">
      <Icon className="w-3 h-3 text-ink-3" />
      {cfg.label} <span className="text-ink-3">#{id}</span>
    </span>
  );
}

/** 기술 필드명 → 한글 레이블 */
const FIELD_LABELS: Record<string, string> = {
  verification_verdict: "최종 판정",
  superseded: "승계됨",
  manual_review_signed: "수기 서명 완료",
  past_winnings_count: "과거 당첨 이력(건)",
  reviewer_name: "검토자명",
  signed_at: "서명 시각",
  name: "이름",
  rrn_front: "주민번호 앞자리",
  phone: "연락처",
  address: "주소",
  email: "이메일",
  role: "권한",
  title: "공고명",
  status: "상태",
  announcement_id: "공고 ID",
  supply_type: "공급유형",
  unit_type: "주택형",
  is_standby: "예비자",
  note: "메모",
  filename: "파일명",
  size: "크기",
  kind: "용도",
  action_detail: "세부 액션",
  bulk: "일괄 작업",
  total_in_request: "요청 내 총 건수",
  announcementTitle: "공고명",
  winDate: "당첨일",
  canonicalType: "공급유형",
  restrictionYears: "재당첨 제한(년)",
  filters: "필터",
  limit: "조회 건수",
  password_changed: "비밀번호 변경됨",
};

/** 특정 필드의 코드값 → 한글 */
const VALUE_MAPPERS: Record<string, (v: any) => string> = {
  verification_verdict: (v) => {
    if (v == null) return "—";
    const s = String(v).toLowerCase();
    if (s === "eligible" || (s.includes("적합") && !s.includes("부"))) return "✅ 적합";
    if (s === "ineligible" || s.includes("부적합")) return "❌ 부적합";
    if (s === "pending" || s.includes("보류")) return "⏸ 판정 보류";
    if (s === "standby" || s.includes("예비")) return "대기(예비)";
    return String(v);
  },
  phone: (v) => {
    if (!v) return "—";
    const s = String(v);
    // 뒷 4자리만 표시: 010-****-1234
    const m = s.match(/(\d{2,4})[-\s]?(\d{3,4})[-\s]?(\d{4})$/);
    if (m) return `${m[1]}-****-${m[3]}`;
    return s;
  },
  address: (v) => {
    if (!v) return "—";
    const s = String(v).trim();
    const parts = s.split(/\s+/);
    if (parts.length <= 3) return s;
    return parts.slice(0, 3).join(" ") + " ***";
  },
  status: (v) => {
    const s = String(v || "").toLowerCase();
    if (s === "draft") return "작성 중";
    if (s === "published") return "공개";
    if (s === "closed") return "종료";
    return String(v ?? "—");
  },
  role: (v) => {
    const s = String(v || "").toLowerCase();
    if (s === "admin") return "관리자";
    if (s === "staff") return "담당자";
    return String(v ?? "—");
  },
  action_detail: (v) => {
    const s = String(v || "");
    if (s === "download") return "파일 다운로드";
    if (s === "audit_read") return "감사 로그 조회";
    return s;
  },
};

function labelFor(key: string): string {
  return FIELD_LABELS[key] || key;
}

function formatVal(v: any, key?: string): string {
  if (key && VALUE_MAPPERS[key]) return VALUE_MAPPERS[key](v);
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "object") {
    try { return JSON.stringify(v, null, 0).slice(0, 100); } catch { return "—"; }
  }
  return String(v);
}

/** 변경된 필드만 뽑아서 "이름: 전 → 후" 한 줄 요약 생성 */
function buildSummary(before: any, after: any): string[] {
  const keys = new Set<string>([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  const out: string[] = [];
  keys.forEach((k) => {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) === JSON.stringify(a)) return;
    out.push(`${labelFor(k)}: ${formatVal(b, k)} → ${formatVal(a, k)}`);
  });
  return out;
}

function AuditRowItem({
  row,
  expanded,
  onToggle,
}: {
  row: AuditRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const summaryLines = buildSummary(row.before, row.after);
  const hasDetail = row.before || row.after;

  return (
    <div className="px-4 py-3 hover:bg-surface2/60 transition-colors">
      <div
        className="flex items-center gap-3 flex-wrap cursor-pointer"
        onClick={onToggle}
      >
        {/* 시각 */}
        <div className="text-[11px] text-ink-3 flex items-center gap-1 min-w-[140px] font-mono">
          <Clock className="w-3 h-3" />
          {row.ts.replace("T", " ").slice(0, 19)}
        </div>
        {/* 사용자 */}
        <div className="text-[12px] font-semibold text-ink min-w-[80px]">
          {row.user_email || `user#${row.user_id}`}
        </div>
        {/* 액션 */}
        <ActionBadge action={row.action} />
        {/* 대상 */}
        <EntityBadge entity={row.entity} id={row.entity_id} />
        {/* 펼침 화살표 */}
        <div className="ml-auto text-[11px] text-ink-3">
          {expanded ? "▲ 접기" : "▼ 상세"}
        </div>
      </div>

      {/* 한 줄 요약 — 펼치지 않아도 핵심 변경이 바로 보임 */}
      {!expanded && summaryLines.length > 0 && (
        <div className="mt-1.5 pl-[152px] text-[12px] text-ink-2 space-y-0.5">
          {summaryLines.slice(0, 3).map((line, i) => (
            <div key={i} className="truncate">· {line}</div>
          ))}
          {summaryLines.length > 3 && (
            <div className="text-[11px] text-ink-3">…외 {summaryLines.length - 3}건</div>
          )}
        </div>
      )}

      {/* 상세 (펼침 시) */}
      {expanded && (
        <div className="mt-2 pl-3 border-l-2 border-border-soft">
          {hasDetail && (
            <DiffView before={row.before} after={row.after} />
          )}
          <div className="mt-2 text-[10px] text-ink-3 font-mono">
            {row.ip && <span className="mr-3">IP: {row.ip}</span>}
            {row.user_agent && (
              <span>UA: {row.user_agent.slice(0, 60)}{row.user_agent.length > 60 ? "…" : ""}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffView({ before, after }: { before: any; after: any }) {
  const [showAll, setShowAll] = useState(false);

  const keys = new Set<string>([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  if (keys.size === 0) return null;

  const rows: Array<{ key: string; b: any; a: any; changed: boolean }> = [];
  keys.forEach((k) => {
    const b = before?.[k];
    const a = after?.[k];
    const changed = JSON.stringify(b) !== JSON.stringify(a);
    rows.push({ key: k, b, a, changed });
  });

  const changedRows = rows.filter((r) => r.changed);
  const unchangedRows = rows.filter((r) => !r.changed);
  const visibleRows = showAll ? rows : changedRows;

  if (changedRows.length === 0 && !showAll) {
    return (
      <div className="mt-2 text-[11px] text-ink-3 italic">
        이 변경에는 주요 필드 차이가 없습니다.
        {unchangedRows.length > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="ml-2 text-accent hover:underline"
          >
            전체 {unchangedRows.length}개 필드 보기
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="border border-border-soft rounded overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-surface2/60">
            <tr>
              <th className="px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-ink-3 w-36">항목</th>
              <th className="px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">이전</th>
              <th className="px-3 py-1.5 w-8"></th>
              <th className="px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">변경 후</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr
                key={r.key}
                className={r.changed ? "bg-amber-50/60" : "text-ink-3"}
              >
                <td className="px-3 py-1.5 font-medium border-t border-border-soft text-ink-2">
                  {labelFor(r.key)}
                </td>
                <td className="px-3 py-1.5 border-t border-border-soft">
                  <span className={r.changed ? "line-through text-red-600" : ""}>
                    {formatVal(r.b, r.key)}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-ink-3 border-t border-border-soft">→</td>
                <td className="px-3 py-1.5 border-t border-border-soft">
                  <span className={r.changed ? "text-green-700 font-semibold" : ""}>
                    {formatVal(r.a, r.key)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showAll && unchangedRows.length > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-1 text-[11px] text-ink-3 hover:text-ink hover:underline"
        >
          변경되지 않은 {unchangedRows.length}개 필드도 보기
        </button>
      )}
      {showAll && (
        <button
          onClick={() => setShowAll(false)}
          className="mt-1 text-[11px] text-ink-3 hover:text-ink hover:underline"
        >
          변경된 것만 보기
        </button>
      )}
    </div>
  );
}

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ entity?: string; action?: string }>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  async function load() {
    setLoading(true); setErr(null);
    try {
      const sp = new URLSearchParams();
      if (filter.entity) sp.set("entity", filter.entity);
      sp.set("limit", "200");
      const r = await fetch(`/api/admin/audit?${sp.toString()}`);
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j?.error || "조회 실패");
      }
      const data: AuditRow[] = await r.json();
      const filtered = filter.action
        ? data.filter((row) => row.action === filter.action)
        : data;
      setRows(filtered);
    } catch (e: any) {
      setErr(e?.message || "조회 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter.entity]);

  function toggleExpand(id: number) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  return (
    <div className="px-7 py-6 max-w-6xl mx-auto">
      {/* 헤더 */}
      <div className="mb-5">
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3 mb-1 uppercase tracking-[0.6px] font-medium">
          <Shield className="w-3 h-3" /> 감사 로그
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink tracking-[-0.3px]">변경 이력 추적</h1>
            <p className="text-xs text-ink-3 mt-1">
              당첨자·공고·파일·사용자에 대한 모든 변경 기록. 담당자 누가 언제 무엇을 바꿨는지 영구 기록됩니다.
            </p>
          </div>
          <button
            onClick={load}
            className="btn-secondary text-xs inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> 새로고침
          </button>
        </div>
        <div className="mt-3 flex gap-2 text-xs">
          <Link href="/settings" className="text-ink-3 hover:text-ink underline">← 계정 관리로</Link>
        </div>
      </div>

      {/* 필터 */}
      <div className="bg-surface border border-border rounded-lg p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-[11px] text-ink-3 mr-1">
          <Filter className="w-3 h-3" /> 필터:
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-ink-3">대상</span>
          <select
            value={filter.entity || ""}
            onChange={(e) => setFilter({ ...filter, entity: e.target.value || undefined })}
            className="text-xs border border-border rounded px-2 py-1"
          >
            <option value="">전체</option>
            <option value="customer">당첨자</option>
            <option value="announcement">공고</option>
            <option value="file">파일</option>
            <option value="user">사용자</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-ink-3">액션</span>
          <select
            value={filter.action || ""}
            onChange={(e) => { setFilter({ ...filter, action: e.target.value || undefined }); setTimeout(load, 0); }}
            className="text-xs border border-border rounded px-2 py-1"
          >
            <option value="">전체</option>
            <option value="create">생성</option>
            <option value="update">수정</option>
            <option value="delete">삭제</option>
            <option value="update_verdict">판정 변경</option>
            <option value="manual_sign">수기 서명</option>
            <option value="past_winnings_change">과거당첨 수정</option>
            <option value="role_change">권한 변경</option>
          </select>
        </div>
        <div className="ml-auto text-[11px] text-ink-3">
          {loading ? "..." : `${rows.length}건`}
        </div>
      </div>

      {/* 에러 */}
      {err && (
        <div className="mb-3 p-3 rounded-md bg-fail-soft border border-fail-soft text-sm text-fail">
          {err}
          {err.includes("관리자") && (
            <div className="mt-1 text-xs">
              💡 로그아웃 후 다시 로그인하면 해결됩니다 (JWT 토큰 갱신).
            </div>
          )}
        </div>
      )}

      {/* 목록 */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-ink-4">
            <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin opacity-60" />
            <div className="text-sm">불러오는 중…</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink-4">
            기록된 변경 이력 없음. 당첨자 판정을 변경해보면 여기에 기록됩니다.
          </div>
        ) : (
          <div className="divide-y divide-border-soft">
            {rows.map((row) => (
              <AuditRowItem
                key={row.id}
                row={row}
                expanded={expanded.has(row.id)}
                onToggle={() => toggleExpand(row.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 도움말 */}
      <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-900">
        <div className="font-semibold mb-1">💡 이 페이지로 확인 가능한 것</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>당첨자 판정(적합↔부적합) 변경 이력과 변경자</li>
          <li>수기 검토 서명 누가 언제 했는지</li>
          <li>과거 당첨 이력 추가·삭제 기록</li>
          <li>공고·파일 생성·삭제 이력</li>
          <li>사용자 계정 생성·권한 변경 이력</li>
        </ul>
      </div>
    </div>
  );
}
