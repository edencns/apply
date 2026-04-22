"use client";

import Link from "next/link";
import { Building2, Lock } from "lucide-react";

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="bg-surface rounded-lg border border-border w-full max-w-md p-8 text-center">
        <div className="w-12 h-12 bg-ink rounded-md flex items-center justify-center mx-auto mb-3">
          <Building2 className="w-6 h-6 text-white" strokeWidth={1.8} />
        </div>
        <h1 className="text-lg font-bold text-ink tracking-tight mb-2">계정 생성 제한</h1>
        <div className="inline-flex items-center gap-1.5 text-xs text-ink-3 mb-4">
          <Lock className="w-3.5 h-3.5" />
          이 시스템은 관리자에게 발급받은 계정으로만 접속 가능합니다.
        </div>
        <p className="text-xs text-ink-3 mb-6">
          아이디·비밀번호는 시스템 관리자에게 문의하세요.
        </p>
        <Link
          href="/login"
          className="btn-accent inline-flex items-center justify-center gap-1.5 !px-5 !py-2 !text-sm"
        >
          로그인 화면으로
        </Link>
      </div>
    </div>
  );
}
