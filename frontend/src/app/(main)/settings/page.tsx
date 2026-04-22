"use client";

import { useEffect, useState } from "react";
import {
  Settings as SettingsIcon, UserPlus, Trash2, KeyRound, Loader2, User,
} from "lucide-react";

interface DbUser {
  id: number;
  email: string;
  name: string;
  created_at: string;
}

export default function SettingsPage() {
  const [users, setUsers] = useState<DbUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pwModal, setPwModal] = useState<{ id: number; email: string } | null>(null);
  const [newPw, setNewPw] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/users");
      if (!r.ok) throw new Error((await r.json()).error || "목록 조회 실패");
      setUsers(await r.json());
    } catch (e: any) {
      setErr(e?.message || "목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null); setCreating(true);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "생성 실패");
      setMsg(`계정 생성 완료: ${form.email}`);
      setForm({ email: "", name: "", password: "" });
      load();
    } catch (e: any) {
      setErr(e?.message || "생성 실패");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(u: DbUser) {
    if (!confirm(`${u.email} 계정을 삭제합니다. 계속?`)) return;
    setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error || "삭제 실패");
      setMsg(`${u.email} 삭제 완료`);
      load();
    } catch (e: any) {
      setErr(e?.message);
    }
  }

  async function handleResetPassword() {
    if (!pwModal) return;
    if (newPw.length < 6) { setErr("비밀번호는 최소 6자"); return; }
    setErr(null);
    try {
      const r = await fetch(`/api/admin/users/${pwModal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPw }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "재설정 실패");
      setMsg(`${pwModal.email} 비밀번호 재설정 완료`);
      setPwModal(null); setNewPw("");
    } catch (e: any) {
      setErr(e?.message);
    }
  }

  return (
    <div className="px-7 py-6 max-w-4xl mx-auto">
      {/* 헤더 */}
      <div className="mb-5">
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3 mb-1 uppercase tracking-[0.6px] font-medium">
          <SettingsIcon className="w-3 h-3" /> 설정
        </div>
        <h1 className="text-xl font-bold text-ink tracking-[-0.3px]">계정 관리</h1>
        <p className="text-xs text-ink-3 mt-1">
          다른 담당자에게 발급할 아이디·비밀번호를 생성·관리합니다.
        </p>
      </div>

      {/* 메시지 */}
      {err && (
        <div className="mb-3 p-2.5 rounded-md bg-fail-soft border border-fail-soft text-xs text-fail">
          {err}
        </div>
      )}
      {msg && (
        <div className="mb-3 p-2.5 rounded-md bg-ok-soft border border-ok-soft text-xs text-ok">
          {msg}
        </div>
      )}

      {/* 신규 생성 폼 */}
      <div className="bg-surface border border-border rounded-lg p-4 mb-5">
        <div className="text-[13px] font-semibold text-ink mb-3 flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5" />
          신규 계정 생성
        </div>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <div>
            <label className="block text-[11px] text-ink-3 mb-1">아이디 *</label>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="예: jung123"
              required
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-[11px] text-ink-3 mb-1">이름 *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="예: 정민아"
              required
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-[11px] text-ink-3 mb-1">초기 비밀번호 * (6자+)</label>
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="담당자에게 전달"
              minLength={6}
              required
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent font-mono"
            />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="btn-accent inline-flex items-center gap-1"
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
              {creating ? "생성 중…" : "계정 생성"}
            </button>
          </div>
        </form>
      </div>

      {/* 목록 */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-[13px] font-semibold text-ink">
          등록된 계정 ({users.length})
        </div>
        <table className="w-full">
          <thead className="bg-surface2 border-b border-border-soft">
            <tr>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-ink-3">아이디</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-ink-3">이름</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-ink-3">생성일</th>
              <th className="px-4 py-2.5 w-32"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-8 text-ink-4">
                <Loader2 className="w-4 h-4 mx-auto mb-1 animate-spin opacity-60" />
                <span className="text-xs">불러오는 중…</span>
              </td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-xs text-ink-4">
                생성된 계정 없음. 위 폼에서 첫 번째 계정을 만들어 주세요.
              </td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="border-t border-border-soft">
                <td className="px-4 py-2.5 text-[12px] font-semibold text-ink font-mono">{u.email}</td>
                <td className="px-4 py-2.5 text-[12px] text-ink-2">{u.name}</td>
                <td className="px-4 py-2.5 text-[11px] text-ink-3">{(u.created_at || "").slice(0, 10)}</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => setPwModal({ id: u.id, email: u.email })}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-ink-2 hover:bg-surface2 mr-1"
                    title="비밀번호 재설정"
                  >
                    <KeyRound className="w-3 h-3" /> 비번 재설정
                  </button>
                  <button
                    onClick={() => handleDelete(u)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-fail hover:bg-fail-soft"
                    title="삭제"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 비밀번호 재설정 모달 */}
      {pwModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-lg max-w-sm w-full p-5">
            <div className="flex items-center gap-1.5 mb-3">
              <KeyRound className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-bold text-ink">비밀번호 재설정</h3>
            </div>
            <p className="text-xs text-ink-3 mb-3">
              <span className="font-mono font-semibold text-ink">{pwModal.email}</span> 계정의 새 비밀번호를 입력하세요.
            </p>
            <input
              type="text"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="6자 이상"
              minLength={6}
              className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent font-mono"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setPwModal(null); setNewPw(""); }}
                className="btn-secondary"
              >
                취소
              </button>
              <button
                onClick={handleResetPassword}
                className="btn-accent"
              >
                재설정
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 안내 */}
      <div className="mt-5 p-3 rounded-md bg-accent-soft border border-accent-line text-[11.5px] text-ink-2 flex gap-2">
        <User className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-semibold text-ink mb-0.5">마스터 관리자 안내</div>
          Vercel 환경변수 <code className="font-mono text-[11px] bg-surface px-1 rounded">STAFF_USERNAME</code> /{" "}
          <code className="font-mono text-[11px] bg-surface px-1 rounded">STAFF_PASSWORD</code> 계정은 여기 목록에 표시되지 않지만 언제나 로그인 가능합니다.
          DB 장애 시에도 접속 보장용이니 비밀번호 관리 유의하세요.
        </div>
      </div>
    </div>
  );
}
