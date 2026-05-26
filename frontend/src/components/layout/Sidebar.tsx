"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2, LayoutDashboard, Users, FileText,
  BookOpen, LogOut, PenLine, Scale,
  UserCheck, Home, Banknote, Settings, RefreshCw, GraduationCap, ClipboardCheck,
} from "lucide-react";

interface NavItem {
  href: string;
  icon: typeof LayoutDashboard;
  label: string;
}

/** 서류검토·판정 단계에서 공급유형별 sub-tab. 클릭 시 ?supply=XXX 쿼리로 필터링 */
const DOCUMENTS_SUB_TABS: Array<{ supply: string; label: string }> = [
  { supply: "all",       label: "전체" },
  { supply: "기관추천",   label: "기관추천" },
  { supply: "다자녀가구", label: "다자녀" },
  { supply: "신혼부부",   label: "신혼부부" },
  { supply: "노부모부양", label: "노부모부양" },
  { supply: "생애최초",   label: "생애최초" },
  { supply: "일반공급",   label: "일반공급" },
  { supply: "선착순",     label: "선착순/잔여세대" },
];

const topItems: NavItem[] = [
  { href: "/dashboard",     icon: LayoutDashboard, label: "대시보드" },
  { href: "/announcements", icon: BookOpen,        label: "모집공고" },
];

const workflowItems: NavItem[] = [
  { href: "/workflow/registration", icon: UserCheck, label: "당첨자 등록" },
  { href: "/workflow/household",    icon: Users,     label: "세대·가족관계" },
  { href: "/workflow/property",     icon: Home,      label: "주택소유 조회" },
  { href: "/workflow/savings",      icon: Banknote,  label: "청약통장 검증" },
  { href: "/workflow/documents",    icon: FileText,  label: "서류검토·판정" },
  { href: "/workflow/transfers",    icon: RefreshCw, label: "명의변경 관리" },
  { href: "/workflow/contracts",    icon: ClipboardCheck, label: "최종 계약자" },
];

const supportItems: NavItem[] = [
  { href: "/glossary",              icon: GraduationCap, label: "용어사전" },
  { href: "/verification-criteria", icon: Scale,         label: "서류 검증 기준" },
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

  // 서류검토·판정 sub-tab — 현재 활성 supply (URL 쿼리에서 읽음)
  const currentSupply = (() => {
    if (typeof window === "undefined") return "all";
    if (!pathname?.startsWith("/workflow/documents")) return "all";
    const sp = new URLSearchParams(window.location.search);
    return sp.get("supply") || "all";
  })();
  const showDocSubTabs = isActive("/workflow/documents");

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
          <div key={item.href}>
            <NavLink
              item={item}
              isActive={isActive(item.href)}
              stepNumber={i + 1}
            />
            {/* 5단계(서류검토·판정) 활성 시 공급유형별 sub-tab 노출 */}
            {item.href === "/workflow/documents" && showDocSubTabs && (
              <div className="ml-7 mt-0.5 mb-1 space-y-0.5 border-l border-border-soft pl-2">
                {DOCUMENTS_SUB_TABS.map((sub) => {
                  const isCur = currentSupply === sub.supply;
                  const href = sub.supply === "all"
                    ? "/workflow/documents"
                    : `/workflow/documents?supply=${encodeURIComponent(sub.supply)}`;
                  return (
                    <Link
                      key={sub.supply}
                      href={href}
                      className={`block px-2 py-1 rounded text-[11.5px] transition-colors ${
                        isCur
                          ? "bg-accent-soft text-accent font-semibold"
                          : "text-ink-3 hover:bg-surface hover:text-ink-2"
                      }`}
                    >
                      └ {sub.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        <div className="text-[9.5px] uppercase tracking-[1.2px] font-semibold text-ink-4 px-2.5 pt-3.5 pb-1">
          지원 (신입 도움말)
        </div>
        {supportItems.map((item) => (
          <NavLink key={item.href} item={item} isActive={isActive(item.href)} />
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
