"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, FileText,
  BookOpen, LogOut, PenLine, Scale,
  UserCheck, Home, Banknote, Settings, RefreshCw, GraduationCap, ClipboardCheck,
} from "lucide-react";

interface NavItem {
  href: string;
  icon: typeof LayoutDashboard;
  label: string;
}

// 서류검토·판정 단계에서 열리는 외부 검수화면(VPS). 비번 보호 HTTPS
const DOCUMENTS_REVIEW_URL = "https://72-62-79-122.nip.io";

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
              ? "bg-accent text-[#0a0a0a]"
              : "bg-surface2 text-ink-3 shadow-[inset_0_0_0_1px_#ffffff1a]"
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

  // 서류검토·판정 단계 활성 시 외부 검수화면 링크 노출
  const showDocReview = isActive("/workflow/documents");

  return (
    <aside className="w-[220px] bg-surface2 border-r border-border flex flex-col h-screen sticky top-0">
      {/* 로고 */}
      <div className="p-4 border-b border-border-soft">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-[#F37021] flex items-center justify-center shadow-[0_0_0_1px_#ffffff14]">
            <span className="text-white text-[12px] font-extrabold leading-none tracking-tight">K</span>
          </div>
          <div>
            <div className="text-[13px] font-bold text-ink tracking-tight">
              KUKDO <span className="text-[#F37021]">ID</span>
            </div>
            <div className="text-[10px] text-white mt-px">분양자동화 시스템</div>
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
            {/* 5단계(서류검토·판정) 활성 시 외부 검수화면(VPS) 링크 노출 */}
            {item.href === "/workflow/documents" && showDocReview && (
              <div className="ml-7 mt-0.5 mb-1 space-y-0.5 border-l border-border-soft pl-2">
                <a
                  href={DOCUMENTS_REVIEW_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-2 py-1 rounded text-[11.5px] font-semibold text-accent hover:bg-surface transition-colors"
                >
                  └ 무주택 1차 검수 (VPS) ↗
                </a>
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
