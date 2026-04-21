"use client";

/**
 * 상단 공고 선택 검색창
 * - 기본값: 진행중인 공고만 검색
 * - "완료 포함" 체크박스를 체크하면 완료된 공고도 검색 대상에 포함
 * - 검색어로 공고명/공고번호를 필터링
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronRight, Search, X } from "lucide-react";
import { isAnnouncementDone } from "@/lib/local-store";

export interface AnnouncementPickerItem {
  id: number;
  title: string;
  announcement_no?: string | null;
  [key: string]: any;
}

interface Props {
  announcements: AnnouncementPickerItem[];
  selected: AnnouncementPickerItem | null;
  onSelect: (ann: AnnouncementPickerItem) => void;
  onOpenDetail?: (ann: AnnouncementPickerItem) => void;
}

export default function AnnouncementPicker({ announcements, selected, onSelect, onOpenDetail }: Props) {
  const [query, setQuery] = useState("");
  const [includeDone, setIncludeDone] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return announcements.filter((a) => {
      // 진행중/완료 필터
      if (!includeDone && isAnnouncementDone(a)) return false;
      if (!q) return true;
      const title = (a.title || "").toLowerCase();
      const no = String(a.announcement_no || "").toLowerCase();
      return title.includes(q) || no.includes(q);
    });
  }, [announcements, query, includeDone]);

  const noResult = filtered.length === 0;

  return (
    <div className="mb-5 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0" ref={wrapperRef}>
          <div className="text-[11px] uppercase tracking-wider text-accent font-medium mb-0.5">
            현재 작업 공고
          </div>

          {announcements.length === 0 ? (
            <div className="text-sm text-ink-2">등록된 공고가 없습니다 — 먼저 모집공고를 등록해 주세요.</div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2">
                {/* 선택된 공고 표시 또는 검색 입력 */}
                <div className="flex-1 relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4 pointer-events-none" />
                  <input
                    type="text"
                    value={open ? query : (selected?.title || "")}
                    onFocus={() => { setOpen(true); setQuery(""); }}
                    onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                    placeholder="공고명 또는 공고번호 검색"
                    className="w-full text-sm font-semibold text-ink bg-white/60 border border-blue-200 rounded-md pl-7 pr-7 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  {open && query && (
                    <button
                      onClick={() => setQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* 완료 포함 체크박스 */}
                <label className="inline-flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={includeDone}
                    onChange={(e) => setIncludeDone(e.target.checked)}
                    className="w-3.5 h-3.5 accent-blue-600"
                  />
                  완료 포함
                </label>
              </div>

              {/* 검색 결과 드롭다운 */}
              {open && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {noResult ? (
                    <div className="px-3 py-4 text-sm text-ink-4 text-center">
                      {query ? "검색 결과가 없습니다" : (includeDone ? "공고가 없습니다" : "진행중인 공고가 없습니다")}
                      {!includeDone && !query && announcements.length > 0 && (
                        <div className="text-xs mt-1">우측의 &ldquo;완료 포함&rdquo;을 체크하면 완료된 공고도 검색됩니다</div>
                      )}
                    </div>
                  ) : (
                    filtered.map((a) => {
                      const done = isAnnouncementDone(a);
                      const isSelected = selected?.id === a.id;
                      return (
                        <button
                          key={a.id}
                          onClick={() => {
                            onSelect(a);
                            setOpen(false);
                            setQuery("");
                          }}
                          className={`w-full text-left px-3 py-2 hover:bg-accent-soft transition-colors text-sm flex items-center gap-2 ${
                            isSelected ? "bg-accent-soft" : ""
                          }`}
                        >
                          <span className="flex-1 truncate">
                            <span className="font-medium text-ink">{a.title}</span>
                            {a.announcement_no && (
                              <span className="text-ink-4 text-xs ml-1.5">#{a.announcement_no}</span>
                            )}
                          </span>
                          {done && (
                            <span className="text-[10px] bg-border text-ink-2 px-1.5 py-0.5 rounded">완료</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {selected && onOpenDetail && (
          <button
            onClick={() => onOpenDetail(selected)}
            className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent font-medium flex-shrink-0"
          >
            공고 상세 <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
