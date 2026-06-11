"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, X, ChevronRight } from "lucide-react";
import { activeAnnouncement, ActiveAnnouncementSnapshot } from "@/lib/local-store";

/**
 * 고객 관리 / 서류 검수 / 공고 비교 페이지 상단에 고정으로 표시되는
 * "현재 작업 중인 공고" 배너. activeAnnouncement(localStorage)에서 읽어온다.
 *
 * 사용자가 명시적으로 공고를 고르지 않았다면 아무것도 렌더하지 않는다.
 */
export function ActiveAnnouncementBanner({ onClear }: { onClear?: () => void }) {
  const [ann, setAnn] = useState<ActiveAnnouncementSnapshot | null>(null);

  useEffect(() => {
    setAnn(activeAnnouncement.get());
  }, []);

  if (!ann) return null;

  const handleClear = () => {
    activeAnnouncement.clear();
    setAnn(null);
    onClear?.();
  };

  return (
    <div className="mb-5 rounded-xl border border-accent-line bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-accent text-[#0a0a0a] flex items-center justify-center flex-shrink-0">
        <BookOpen className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-accent font-medium">현재 작업 중인 공고</div>
        <div className="text-sm font-semibold text-ink truncate">
          {ann.title}
          {ann.announcement_no && (
            <span className="ml-2 text-xs text-ink-3 font-normal">#{ann.announcement_no}</span>
          )}
        </div>
      </div>
      <Link
        href={`/announcements/${ann.id}`}
        className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent font-medium"
      >
        공고 상세 <ChevronRight className="w-3 h-3" />
      </Link>
      <button
        type="button"
        onClick={handleClear}
        className="p-1.5 rounded-md text-ink-3 hover:text-ink-2 hover:bg-surface/60 transition-colors"
        title="공고 연결 해제"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
