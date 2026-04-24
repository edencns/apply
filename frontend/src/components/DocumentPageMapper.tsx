"use client";

/**
 * 문서 묶음 PDF 페이지 매퍼
 *
 * 담당자가 23페이지짜리 서류 묶음 PDF를 한 번에 열어놓고:
 *  - 각 페이지를 넘기며 "이 페이지는 주민등록등본"이라고 지정
 *  - 지정된 서류는 각자의 page 필드에 저장되어 이후 [📄 3p 열기]로 바로 점프
 *  - 페이지 맵으로 이미 어떤 서류에 사용됐는지 한눈에 표시
 *
 * PDF 뷰는 브라우저 내장 뷰어(iframe)를 사용. #page=N 해시로 페이지 이동.
 * iframe 내부 현재 페이지를 외부에서 읽지 못하므로, 담당자가 수동으로
 * "현재 보고 있는 페이지는 N"이라고 입력하면 모달이 그 값으로 기록.
 */

import { useState, useEffect } from "react";
import { X, FileText, Target, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";

type DocFile = {
  url?: string;
  filename?: string;
  page?: number;
  totalPages?: number;
};

export interface DocumentMapperProps {
  isOpen: boolean;
  onClose: () => void;
  bundleUrl: string;                 // 묶음 PDF URL
  bundleFilename?: string;
  totalPages?: number;                // 묶음 PDF 총 페이지 (알려져 있으면)
  documents: Array<{ name: string; category: string; conditional: boolean }>;
  /** 현재 각 서류의 지정 페이지 */
  fileMap: Record<string, DocFile>;
  /** 특정 서류에 페이지 지정/해제 */
  onAssignPage: (docName: string, page: number | undefined) => void;
  /** 최초 열람 시 기본 페이지 */
  initialPage?: number;
}

export default function DocumentPageMapper({
  isOpen,
  onClose,
  bundleUrl,
  bundleFilename,
  totalPages,
  documents,
  fileMap,
  onAssignPage,
  initialPage = 1,
}: DocumentMapperProps) {
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setCurrentPage(initialPage);
      setIframeKey((k) => k + 1);
    }
  }, [isOpen, initialPage]);

  if (!isOpen) return null;

  const totalP = totalPages || 30;  // 미상이면 30으로 가정
  const pageAssignments = new Map<number, string[]>();
  for (const [docName, df] of Object.entries(fileMap)) {
    if (df?.page && docName !== "서류 묶음(통합)") {
      if (!pageAssignments.has(df.page)) pageAssignments.set(df.page, []);
      pageAssignments.get(df.page)!.push(docName);
    }
  }

  const jumpTo = (p: number) => {
    const clamped = Math.max(1, Math.min(totalP, p));
    setCurrentPage(clamped);
    setIframeKey((k) => k + 1);
  };

  const currentAssignments = pageAssignments.get(currentPage) || [];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex" onClick={onClose}>
      <div
        className="bg-white w-full h-full max-w-[1600px] mx-auto my-2 rounded-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-ink-3 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-ink truncate">
                페이지 매퍼 {bundleFilename && <span className="text-ink-3 font-normal">· {bundleFilename}</span>}
              </h2>
              <p className="text-[10px] text-ink-3">
                각 서류별로 "이 페이지로 지정"을 눌러 묶음 PDF 내 위치를 기록합니다. 이후 서류 목록에서 바로 해당 페이지로 점프 가능.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface2 rounded flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 좌: PDF 뷰어 */}
          <div className="flex-1 flex flex-col min-w-0 bg-gray-100 border-r border-border">
            {/* 페이지 컨트롤 */}
            <div className="px-3 py-2 bg-white border-b border-border flex items-center gap-2 flex-wrap">
              <button
                onClick={() => jumpTo(currentPage - 1)}
                disabled={currentPage <= 1}
                className="p-1 hover:bg-surface2 rounded disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1 text-sm">
                <span className="text-ink-3">페이지</span>
                <input
                  type="number"
                  min={1}
                  max={totalP}
                  value={currentPage}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setCurrentPage(v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") jumpTo(currentPage);
                  }}
                  className="w-14 border border-border rounded px-1.5 py-0.5 text-sm text-center"
                />
                <span className="text-ink-3">/ {totalP}</span>
                <button
                  onClick={() => jumpTo(currentPage)}
                  className="ml-1 px-2 py-0.5 rounded bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700"
                >
                  이동
                </button>
              </div>
              <button
                onClick={() => jumpTo(currentPage + 1)}
                disabled={currentPage >= totalP}
                className="p-1 hover:bg-surface2 rounded disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* 현재 페이지 배정 상태 */}
              <div className="ml-auto flex items-center gap-1.5 text-xs">
                {currentAssignments.length > 0 ? (
                  <>
                    <span className="text-ink-3">현재 페이지 지정:</span>
                    {currentAssignments.map((n) => (
                      <span
                        key={n}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px] font-medium"
                      >
                        <CheckCircle2 className="w-3 h-3" /> {n}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-amber-700 text-[11px]">
                    ⚠ 이 페이지는 아직 어느 서류에도 지정되지 않음
                  </span>
                )}
              </div>
            </div>

            {/* PDF iframe */}
            <iframe
              key={iframeKey}
              src={`${bundleUrl}#page=${currentPage}`}
              className="flex-1 w-full bg-gray-200"
              title="서류 묶음 PDF"
            />

            {/* 하단 페이지 맵 */}
            <div className="px-3 py-2 bg-white border-t border-border max-h-40 overflow-y-auto">
              <div className="text-[10px] text-ink-3 mb-1 uppercase tracking-wide font-medium">
                페이지 맵 ({totalP}페이지 · 지정 {pageAssignments.size}개)
              </div>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: totalP }, (_, i) => i + 1).map((p) => {
                  const docs = pageAssignments.get(p) || [];
                  const isCurrent = p === currentPage;
                  const hasAssign = docs.length > 0;
                  return (
                    <button
                      key={p}
                      onClick={() => jumpTo(p)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border transition ${
                        isCurrent
                          ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                          : hasAssign
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200 font-medium hover:bg-emerald-100"
                            : "bg-white text-ink-4 border-border hover:bg-surface2"
                      }`}
                      title={docs.join(", ")}
                    >
                      {p}
                      {hasAssign && (
                        <span className="ml-0.5 text-[8px] opacity-80">
                          · {docs[0].length > 4 ? docs[0].slice(0, 4) : docs[0]}
                          {docs.length > 1 ? "+" : ""}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 우: 서류 목록 */}
          <div className="w-80 flex-shrink-0 flex flex-col border-l border-border bg-white">
            <div className="px-3 py-2 border-b border-border bg-surface2/50">
              <h3 className="text-xs font-semibold text-ink-2">서류 목록</h3>
              <p className="text-[10px] text-ink-3 mt-0.5">
                현재 보고 있는 페이지({currentPage}p)를 원하는 서류에 지정하세요
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {documents
                .filter((d) => d.name !== "서류 묶음(통합)")
                .map((d) => {
                  const assigned = fileMap[d.name]?.page;
                  const isCurrent = assigned === currentPage;
                  return (
                    <div
                      key={d.name}
                      className={`p-2 rounded border ${
                        isCurrent
                          ? "border-indigo-400 bg-indigo-50"
                          : assigned
                            ? "border-emerald-200 bg-emerald-50/60"
                            : "border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-ink-2 truncate">
                            {d.name}
                          </div>
                          {assigned && (
                            <div className="text-[10px] text-emerald-700 mt-0.5">
                              📄 {assigned}페이지 지정됨
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          {isCurrent ? (
                            <button
                              onClick={() => onAssignPage(d.name, undefined)}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200 text-[10px] font-medium"
                              title="이 서류의 페이지 지정 해제"
                            >
                              해제
                            </button>
                          ) : (
                            <button
                              onClick={() => onAssignPage(d.name, currentPage)}
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                assigned
                                  ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                                  : "bg-indigo-600 text-white hover:bg-indigo-700"
                              }`}
                              title={assigned ? `현재 지정(${assigned}p) 대신 ${currentPage}p로 변경` : `${currentPage}p로 지정`}
                            >
                              <Target className="w-2.5 h-2.5" />
                              {assigned ? "변경" : "지정"}
                            </button>
                          )}
                          {assigned && !isCurrent && (
                            <button
                              onClick={() => jumpTo(assigned)}
                              className="text-[10px] text-accent hover:underline"
                            >
                              {assigned}p로 이동
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
