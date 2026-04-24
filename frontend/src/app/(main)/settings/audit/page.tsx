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

function DiffView({ before, after }: { before: any; after: any }) {
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

  return (
    <div className="mt-2 border border-border-soft rounded overflow-hidden">
      <table className="w-full text-[11px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.changed ? "bg-amber-50" : ""}>
              <td className="px-2 py-1 font-mono text-ink-3 border-b border-border-soft w-32">{r.key}</td>
              <td className="px-2 py-1 text-ink-2 border-b border-border-soft">
                <span className={r.changed ? "line-through text-red-600" : ""}>
                  {formatVal(r.b)}
                </span>
              </td>
              <td className="px-2 py-1 border-b border-border-soft">→</td>
              <td className="px-2 py-1 text-ink border-b border-border-soft">
                <span className={r.changed ? "text-green-700 font-medium" : ""}>
                  {formatVal(r.a)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatVal(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
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
              <div key={row.id} className="px-4 py-3 hover:bg-surface2/60 transition-colors">
                <div
                  className="flex items-center gap-3 flex-wrap cursor-pointer"
                  onClick={() => toggleExpand(row.id)}
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
                    {expanded.has(row.id) ? "▲ 접기" : "▼ 상세"}
                  </div>
                </div>

                {/* 상세 (펼침 시) */}
                {expanded.has(row.id) && (
                  <div className="mt-2 pl-3 border-l-2 border-border-soft">
                    {(row.before || row.after) && (
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
