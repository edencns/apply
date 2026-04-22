"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, User, Lock, Mail, Loader2 } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "가입 실패");
      if (typeof window !== "undefined") {
        localStorage.setItem("user_name", json.user.name);
        localStorage.setItem("user_email", json.user.email);
      }
      router.push("/dashboard");
    } catch (e: any) {
      setError(e?.message || "가입 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="bg-surface rounded-lg border border-border w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-ink rounded-md flex items-center justify-center mx-auto mb-3">
            <Building2 className="w-6 h-6 text-white" strokeWidth={1.8} />
          </div>
          <h1 className="text-lg font-bold text-ink tracking-tight">계정 만들기</h1>
          <p className="text-xs text-ink-3 mt-1">이메일로 간단히 가입하세요</p>
        </div>

        <form onSubmit={handle} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">이름</label>
            <div className="relative">
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                required
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">이메일</label>
            <div className="relative">
              <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@company.com"
                required
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">비밀번호 (6자 이상)</label>
            <div className="relative">
              <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
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
            {loading ? "가입 중..." : "가입하고 시작"}
          </button>
        </form>

        <div className="mt-4 text-center text-xs text-ink-3">
          이미 계정이 있나요?{" "}
          <Link href="/login" className="text-accent font-medium hover:underline">
            로그인
          </Link>
        </div>
      </div>
    </div>
  );
}
