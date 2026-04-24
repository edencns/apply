"use client";

/**
 * 문서 묶음 PDF 페이지 매퍼
 *
 * 담당자 워크플로우:
 *  1. 좌측 PDF 뷰어에서 내부 네비게이션(스크롤·뷰어 버튼)으로 원하는 페이지 탐색
 *  2. 현재 보고 있는 페이지 번호를 상단 입력창에 입력
 *  3. 우측 서류 목록에서 해당 서류 [이 페이지로 지정] 클릭
 *
 * PDF 뷰어 내부 상태는 iframe 경계상 외부에서 읽기 어려우므로
 * 담당자가 수동 입력하는 방식. 입력값이 "지정할 페이지"의 단일 진실.
 */

import { useState, useEffect } from "react";
import {
  X, FileText, Target, CheckCircle2,
  ChevronLeft, ChevronRight, AlertCircle,
} from "lucide-react";

type DocFile = {
  url?: string;
  filename?: string;
  page?: number;
  totalPages?: number;
};

export interface DocumentMapperProps {
  isOpen: boolean;
  onClose: () => void;
  bundleUrl: string;
  bundleFilename?: string;
  /** 파일 ID (페이지 수 자동 감지용) */
  bundleFileId?: number;
  totalPages?: number;
  documents: Array<{ name: string; category: string; conditional: boolean }>;
  fileMap: Record<string, DocFile>;
  onAssignPage: (docName: string, page: number | undefined) => void;
  initialPage?: number;
}

export default function DocumentPageMapper({
  isOpen,
  onClose,
  bundleUrl,
  bundleFilename,
  bundleFileId,
  totalPages: totalPagesProp,
  documents,
  fileMap,
  onAssignPage,
  initialPage = 1,
}: DocumentMapperProps) {
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [iframeKey, setIframeKey] = useState(0);
  const [detectedTotal, setDetectedTotal] = useState<number | undefined>(undefined);
  const [detecting, setDetecting] = useState(false);

  const totalP = totalPagesProp || detectedTotal || 50;

  useEffect(() => {
    if (!isOpen) return;
    setCurrentPage(initialPage);
    setIframeKey((k) => k + 1);
  }, [isOpen, initialPage]);

  // 총 페이지 수 자동 감지 (bundleFileId 있을 때)
  useEffect(() => {
    if (!isOpen || !bundleFileId || totalPagesProp || detectedTotal) return;
    setDetecting(true);
    fetch(`/api/files/${bundleFileId}/page-count`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.totalPages) setDetectedTotal(j.totalPages);
      })
      .catch(() => { /* 무시 — 기본값 사용 */ })
      .finally(() => setDetecting(false));
  }, [isOpen, bundleFileId, totalPagesProp, detectedTotal]);

  if (!isOpen) return null;

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
                <strong>작업 흐름</strong>: ① PDF 뷰어에서 원하는 페이지 찾기 → ② 페이지 번호 입력 → ③ 우측 서류 [지정] 클릭
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface2 rounded flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 페이지 컨트롤 바 */}
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 text-sm">
            <span className="text-[11px] text-ink-2 font-semibold">📍 지정할 페이지</span>
            <button
              onClick={() => jumpTo(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1 hover:bg-white rounded disabled:opacity-30"
              title="이전 페이지"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="number"
              min={1}
              max={totalP}
              value={currentPage}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setCurrentPage(v);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") jumpTo(currentPage); }}
              className="w-16 border-2 border-indigo-300 rounded px-1.5 py-0.5 text-sm text-center font-bold bg-white"
            />
            <span className="text-ink-3 text-xs">/ {totalP}</span>
            <button
              onClick={() => jumpTo(currentPage)}
              className="ml-1 px-2.5 py-0.5 rounded bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700"
            >
              이동
            </button>
            <button
              onClick={() => jumpTo(currentPage + 1)}
              disabled={currentPage >= totalP}
              className="p-1 hover:bg-white rounded disabled:opacity-30"
              title="다음 페이지"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {detecting && <span className="text-[10px] text-ink-3 ml-2">페이지 수 감지 중…</span>}
          </div>

          <div className="flex-1 min-w-0" />

          {/* 현재 페이지 지정 상태 */}
          <div className="flex items-center gap-1.5 text-xs">
            {currentAssignments.length > 0 ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-800 font-medium">
                  {currentPage}p 지정: {currentAssignments.join(", ")}
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-amber-800">
                  {currentPage}p는 아직 어느 서류에도 지정되지 않음
                </span>
              </>
            )}
          </div>
        </div>

        {/* 본문 — 좌: PDF iframe / 우: 서류 목록 */}
        <div className="flex-1 flex overflow-hidden">
          {/* PDF 뷰어 */}
          <div className="flex-1 flex flex-col min-w-0 bg-gray-100">
            <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-[11px] text-blue-900 flex items-center gap-1.5">
              <span>💡</span>
              <span>
                PDF 뷰어 안에서 <strong>스크롤</strong>하거나 상단 뷰어 컨트롤로 원하는 페이지를 보세요.
                번호를 확인했으면 위 <strong className="text-indigo-700">📍 지정할 페이지</strong> 입력창에 타이핑하고 우측 [지정]을 누르세요.
              </span>
            </div>
            <iframe
              key={iframeKey}
              src={`${bundleUrl}#page=${currentPage}`}
              className="flex-1 w-full bg-gray-200"
              title="서류 묶음 PDF"
            />
            {/* 페이지 맵 */}
            <div className="px-3 py-2 bg-white border-t border-border max-h-36 overflow-y-auto">
              <div className="text-[10px] text-ink-3 mb-1 uppercase tracking-wide font-medium flex items-center gap-2">
                <span>페이지 맵</span>
                <span className="text-ink-4">· 전체 {totalP}p · 지정됨 {pageAssignments.size}개</span>
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
                      title={docs.length > 0 ? docs.join(", ") : `페이지 ${p}로 이동`}
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
          <div className="w-[340px] flex-shrink-0 flex flex-col border-l border-border bg-white">
            <div className="px-3 py-2 border-b border-border bg-surface2/50">
              <h3 className="text-xs font-semibold text-ink-2">서류 목록</h3>
              <p className="text-[10px] text-ink-3 mt-0.5 leading-relaxed">
                ② <strong className="text-indigo-700">{currentPage}p</strong>를 원하는 서류의 <strong>[지정]</strong> 버튼으로 배정하세요
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
                          ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200"
                          : assigned
                            ? "border-emerald-200 bg-emerald-50/60"
                            : "border-border"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-ink-2 leading-tight">
                            {d.name}
                          </div>
                          {assigned ? (
                            <div className="text-[10px] text-emerald-700 mt-0.5 flex items-center gap-1 flex-wrap">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              <span>{assigned}p 지정됨</span>
                              {!isCurrent && (
                                <button
                                  onClick={() => jumpTo(assigned)}
                                  className="text-accent hover:underline"
                                >
                                  [이동]
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="text-[10px] text-ink-4 mt-0.5">미지정</div>
                          )}
                        </div>
                        <div className="flex-shrink-0">
                          {isCurrent ? (
                            <button
                              onClick={() => onAssignPage(d.name, undefined)}
                              className="inline-flex items-center gap-0.5 px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 text-[10px] font-medium whitespace-nowrap"
                              title="이 서류의 페이지 지정 해제"
                            >
                              해제
                            </button>
                          ) : (
                            <button
                              onClick={() => onAssignPage(d.name, currentPage)}
                              className={`inline-flex items-center gap-0.5 px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap ${
                                assigned
                                  ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                                  : "bg-indigo-600 text-white hover:bg-indigo-700"
                              }`}
                              title={assigned ? `${assigned}p → ${currentPage}p로 변경` : `${currentPage}p로 지정`}
                            >
                              <Target className="w-2.5 h-2.5" />
                              {assigned ? `${currentPage}p로 변경` : `${currentPage}p 지정`}
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
