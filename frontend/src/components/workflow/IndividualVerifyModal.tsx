"use client";

/**
 * 고객 개인별 추가 검증 모달
 *
 * 세대원·주택소유·청약통장 페이지에서 재사용.
 * 공고에 등록된 고객 1명을 선택하고, 그 사람의 파일만 올려 개별 검증.
 */

import { useState, useMemo, useRef } from "react";
import type { LocalCustomer } from "@/lib/local-store";
import { X, Upload, Loader2, Search } from "lucide-react";
import { formatPhone } from "@/lib/housing-code";

interface Props {
  open: boolean;
  onClose: () => void;
  customers: LocalCustomer[];
  title: string;        // "세대원 개별 검증" 등
  fileHint: string;     // 업로드 안내
  accept?: string;      // 파일 필터 (기본: 모든 파일)
  /** 실제 업로드 처리 — 호출측에서 페이지별 파싱·저장 로직 구현 */
  onApply: (customer: LocalCustomer, file: File) => Promise<void>;
}

export default function IndividualVerifyModal({
  open,
  onClose,
  customers,
  title,
  fileHint,
  accept = "",
  onApply,
}: Props) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim();
    const base = customers.filter((c) => !c.superseded);
    if (!q) return base;
    return base.filter(
      (c) =>
        c.name.includes(q) ||
        (c.phone || "").includes(q) ||
        (c.rrn_front || "").includes(q),
    );
  }, [customers, search]);

  const selected = customers.find((c) => c.id === selectedId) || null;

  if (!open) return null;

  const handleFile = async (f: File) => {
    if (!selected) return;
    setUploading(true);
    try {
      await onApply(selected, f);
      onClose();
      setSelectedId(null);
      setSearch("");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gray-100 text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex-1 overflow-auto">
          <p className="text-xs text-gray-500 mb-3">{fileHint}</p>

          {/* 고객 선택 */}
          <div className="mb-4">
            <label className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-1.5">
              <span>1. 고객 선택</span>
              <span className="text-[11px] font-normal text-gray-500">
                {filtered.length} / {customers.filter((c) => !c.superseded).length}명
              </span>
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="이름·연락처·주민번호 앞자리 검색"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="border border-gray-200 rounded-lg max-h-80 overflow-auto divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-400">검색 결과 없음</div>
              ) : (
                filtered.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                        active ? "bg-blue-50 text-blue-900" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        {c.is_standby && (
                          <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                            예비 {c.standby_rank || ""}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">
                        {c.rrn_front || "—"}
                        {c.phone && <span className="ml-2">{formatPhone(c.phone)}</span>}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* 파일 업로드 */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              2. 파일 업로드
            </label>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!selected || uploading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 적용 중…</>
              ) : (
                <><Upload className="w-4 h-4" /> {selected ? `${selected.name} 파일 올리기` : "먼저 고객을 선택해주세요"}</>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-100"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
