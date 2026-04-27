"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2, LayoutDashboard, Users, FileText,
  BookOpen, LogOut, PenLine, GitCompareArrows,
  UserCheck, Home, Banknote, Settings, RefreshCw,
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

const workflowItems: NavItem[] = [
  { href: "/workflow/registration", icon: UserCheck, label: "당첨자 등록" },
  { href: "/workflow/household",    icon: Users,     label: "세대원 확인" },
  { href: "/workflow/property",     icon: Home,      label: "주택소유" },
  { href: "/workflow/savings",      icon: Banknote,  label: "청약통장" },
  { href: "/workflow/documents",    icon: FileText,  label: "서류·판정" },
  { href: "/workflow/transfers",    icon: RefreshCw, label: "명의변경" },
];

const bottomItems: NavItem[] = [
  { href: "/contracts/walk-in", icon: PenLine, label: "방문 계약" },
  { href: "/settings", icon: Settings, label: "설정" },
];

function NavLink({
  item,
  isActive,
  stepNumber,
}: {
  item: NavItem;
  isActive: boolean;
  stepNumber?: number;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] transition-colors
        ${isActive
          ? "bg-surface text-ink font-semibold shadow-[inset_0_0_0_1px_#e8e4dc]"
          : "text-ink-2 font-medium hover:bg-surface"
        }`}
    >
      {stepNumber !== undefined ? (
        <span
          className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[10px] font-bold tnum flex-shrink-0 ${
            isActive
              ? "bg-accent text-white"
              : "bg-surface2 text-ink-3 shadow-[inset_0_0_0_1px_#e8e4dc]"
          }`}
        >
          {stepNumber}
        </span>
      ) : (
        <Icon
          className={`w-[15px] h-[15px] flex-shrink-0 ${
            isActive ? "text-accent" : "text-ink-3"
          }`}
        />
      )}
      <span className="flex-1">{item.label}</span>
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

  const userName =
    typeof window !== "undefined" ? localStorage.getItem("user_name") : "";
  const initial = (userName || "사").charAt(0);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="w-[220px] bg-surface2 border-r border-border flex flex-col h-screen sticky top-0">
      {/* 로고 */}
      <div className="p-4 border-b border-border-soft">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-ink flex items-center justify-center">
            <Building2 className="w-3.5 h-3.5 text-white" strokeWidth={1.8} />
          </div>
          <div>
            <div className="text-[13px] font-bold text-ink tracking-tight">
              분양 자동화
            </div>
            <div className="text-[10px] text-ink-4 mt-px">SH공사 · 은평지부</div>
          </div>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {topItems.map((item) => (
          <NavLink key={item.href} item={item} isActive={isActive(item.href)} />
        ))}

        <div className="text-[9.5px] uppercase tracking-[1.2px] font-semibold text-ink-4 px-2.5 pt-3.5 pb-1">
          서류 검수 단계
        </div>
        {workflowItems.map((item, i) => (
          <NavLink
            key={item.href}
            item={item}
            isActive={isActive(item.href)}
            stepNumber={i + 1}
          />
        ))}

        <div className="text-[9.5px] uppercase tracking-[1.2px] font-semibold text-ink-4 px-2.5 pt-3.5 pb-1">
          기타
        </div>
        {bottomItems.map((item) => (
          <NavLink key={item.href} item={item} isActive={isActive(item.href)} />
        ))}
      </nav>

      {/* 하단 사용자 정보 */}
      <div className="p-2.5 border-t border-border-soft">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-[22px] h-[22px] rounded-full bg-accent-soft text-accent text-[10px] font-bold flex items-center justify-center">
            {initial}
          </div>
          <span className="flex-1 text-xs text-ink-2 truncate">
            {userName || "사용자"}
          </span>
          <button
            onClick={handleLogout}
            className="text-ink-4 hover:text-fail transition-colors"
            title="로그아웃"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
