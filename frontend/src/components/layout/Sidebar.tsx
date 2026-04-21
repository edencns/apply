"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2, LayoutDashboard, Users, FileText,
  BookOpen, LogOut, PenLine, GitCompareArrows,
  UserCheck, Home, Banknote,
} from "lucide-react";

interface NavItem {
  href: string;
  icon: typeof LayoutDashboard;
  label: string;
}

const topItems: NavItem[] = [
  { href: "/dashboard",             icon: LayoutDashboard,   label: "대시보드" },
  { href: "/announcements",         icon: BookOpen,          label: "모집공고" },
  { href: "/announcements/compare", icon: GitCompareArrows,  label: "공고 비교" },
];

// 청약 당첨자 서류 검수 5단계 워크플로우
const workflowItems: NavItem[] = [
  { href: "/workflow/registration", icon: UserCheck, label: "당첨자 등록" },
  { href: "/workflow/household",    icon: Users,     label: "세대원 확인" },
  { href: "/workflow/property",     icon: Home,      label: "주택소유" },
  { href: "/workflow/savings",      icon: Banknote,  label: "청약통장" },
  { href: "/workflow/documents",    icon: FileText,  label: "서류·판정" },
];

const bottomItems: NavItem[] = [
  { href: "/contracts/walk-in", icon: PenLine, label: "방문 계약" },
];

function NavLink({ item, isActive, stepNumber }: { item: NavItem; isActive: boolean; stepNumber?: number }) {
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
        ${isActive
          ? "bg-blue-50 text-blue-700"
          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        }`}
    >
      {stepNumber !== undefined ? (
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold flex-shrink-0 ${
          isActive ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"
        }`}>
          {stepNumber}
        </span>
      ) : (
        <item.icon className="w-4 h-4 flex-shrink-0" />
      )}
      {item.label}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    localStorage.clear();
    router.push("/login");
  };

  const userName = typeof window !== "undefined" ? localStorage.getItem("user_name") : "";

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

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
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {topItems.map((item) => (
          <NavLink key={item.href} item={item} isActive={isActive(item.href)} />
        ))}

        {/* 워크플로우 섹션 */}
        <div className="pt-4 pb-1 px-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
            서류 검수 단계
          </div>
        </div>
        {workflowItems.map((item, i) => (
          <NavLink
            key={item.href}
            item={item}
            isActive={isActive(item.href)}
            stepNumber={i + 1}
          />
        ))}

        {/* 기타 */}
        <div className="pt-4 pb-1 px-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
            기타
          </div>
        </div>
        {bottomItems.map((item) => (
          <NavLink key={item.href} item={item} isActive={isActive(item.href)} />
        ))}
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
