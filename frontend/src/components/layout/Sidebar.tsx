"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2, LayoutDashboard, Users, FileText,
  ClipboardCheck, BookOpen, LogOut, PenLine, GitCompareArrows,
} from "lucide-react";

const navItems = [
  { href: "/dashboard",          icon: LayoutDashboard, label: "대시보드" },
  { href: "/announcements",      icon: BookOpen,         label: "모집공고" },
  { href: "/announcements/compare", icon: GitCompareArrows, label: "공고 비교" },
  { href: "/customers",          icon: Users,            label: "고객 관리" },
  { href: "/winners",            icon: ClipboardCheck,   label: "당첨자 관리" },
  { href: "/contracts/walk-in",  icon: PenLine,          label: "방문 계약" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    localStorage.clear();
    router.push("/login");
  };

  const userName = typeof window !== "undefined" ? localStorage.getItem("user_name") : "";

  return (
    <aside className="w-56 bg-white border-r border-gray-100 flex flex-col h-screen sticky top-0">
      {/* 로고 */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-gray-900 text-sm">분양 자동화</span>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 하단 사용자 정보 */}
      <div className="p-3 border-t border-gray-100">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm text-gray-600 truncate">{userName || "사용자"}</span>
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-red-500 transition-colors"
            title="로그아웃"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
