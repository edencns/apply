"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, User, Loader2 } from "lucide-react";

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "로그인 실패");
      if (typeof window !== "undefined") {
        localStorage.setItem("user_name", json.user.name);
        localStorage.setItem("user_email", json.user.email);
      }
      router.push(next);
    } catch (e: any) {
      setError(e?.message || "로그인 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="bg-surface rounded-lg border border-border w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-[#F37021] rounded-md flex items-center justify-center mx-auto mb-3 shadow-[0_0_0_1px_#ffffff14]">
            <span className="text-white text-2xl font-extrabold leading-none tracking-tight">K</span>
          </div>
          <h1 className="text-lg font-bold text-white tracking-tight">분양자동화 시스템</h1>
          <p className="text-xs text-ink-3 mt-1">로그인해서 시작하세요</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">아이디</label>
            <div className="relative">
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="관리자 아이디"
                required
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">비밀번호</label>
            <div className="relative">
              <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-fail bg-fail-soft border border-fail-soft rounded-md px-2 py-1.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-accent w-full !py-2.5 !text-sm inline-flex items-center justify-center gap-1.5"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <div className="mt-4 text-center text-[11px] text-ink-4">
          계정은 관리자에게 문의해 발급받으세요
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
