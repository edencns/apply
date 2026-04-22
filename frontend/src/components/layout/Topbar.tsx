"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, Search, Bell, LogOut } from "lucide-react";

/**
 * 상단 바 — pathname으로 breadcrumb 자동 생성.
 * 주요 경로만 라벨링. 기타는 소문자 그대로.
 */
const LABELS: Record<string, string> = {
  dashboard: "대시보드",
  announcements: "모집공고",
  compare: "공고 비교",
  workflow: "서류 검수",
  registration: "당첨자 등록",
  household: "세대원 확인",
  property: "주택소유 조회",
  savings: "청약통장 순위",
  documents: "서류·판정",
  customers: "고객",
  contracts: "계약",
  "walk-in": "방문 계약",
  winners: "당첨자",
};

function toCrumb(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((p) => LABELS[p] || p);
}

export default function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const crumb = toCrumb(pathname || "/");
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j) => {
      if (j.user) setUser({ name: j.user.name, email: j.user.email });
    }).catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    if (typeof window !== "undefined") {
      localStorage.removeItem("user_name");
      localStorage.removeItem("user_email");
    }
    router.push("/login");
  }

  return (
    <div className="h-12 border-b border-border bg-surface flex items-center px-6 gap-2.5 sticky top-0 z-20">
      <div className="flex items-center gap-1.5 text-xs text-ink-3">
        {crumb.length === 0 ? (
          <span className="text-ink font-medium">홈</span>
        ) : (
          crumb.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="w-3 h-3 text-ink-4" />}
              <span
                className={
                  i === crumb.length - 1
                    ? "text-ink font-medium"
                    : "text-ink-3"
                }
              >
                {c}
              </span>
            </span>
          ))
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface2 text-[11.5px] text-ink-3">
        <Search className="w-3 h-3 text-ink-4" />
        <span>빠른 검색</span>
        <span className="ml-3 px-1.5 py-px rounded-sm bg-surface text-[10px] text-ink-4 border border-border font-mono">
          ⌘K
        </span>
      </div>
      <button className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface2 transition-colors">
        <Bell className="w-[15px] h-[15px] text-ink-3" />
      </button>
      {user && (
        <div className="flex items-center gap-2 pl-2 ml-1 border-l border-border">
          <div className="text-[11px] text-ink-2 font-medium" title={user.email}>
            {user.name}
          </div>
          <button
            onClick={logout}
            title="로그아웃"
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface2 transition-colors"
          >
            <LogOut className="w-[14px] h-[14px] text-ink-3" />
          </button>
        </div>
      )}
    </div>
  );
}
