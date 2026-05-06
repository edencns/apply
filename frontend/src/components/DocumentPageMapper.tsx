"use client";

/**
 * 문서 묶음 PDF 페이지 매퍼 (v2 — 다페이지 + 썸네일 + 키보드/휠 네비게이션)
 *
 * 담당자 워크플로우:
 *  1. 좌측 PDF 뷰어 또는 하단 썸네일에서 원하는 페이지 탐색
 *  2. 우측 서류 목록에서 [+ 이 페이지 추가] 클릭 — 같은 서류에 여러 페이지 추가 가능
 *  3. 같은 페이지를 다시 누르면 토글 해제
 *
 * 페이지 이동 방법:
 *   - 외부 ← → 버튼 / 숫자 입력 / Enter
 *   - 키보드 ← → / PgUp PgDn (모달 포커스 시)
 *   - 하단 썸네일 클릭
 *   - PDF 영역 위에서 마우스 휠 (Ctrl 누른 채로 휠은 PDF 뷰어 확대 — 일반 휠은 페이지 이동)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X, FileText, CheckCircle2,
  ChevronLeft, ChevronRight, AlertCircle, Plus, Image as ImageIcon,
} from "lucide-react";
import { getCheckpointsForDocument } from "@/lib/document-checkpoints";
import type { LocalCustomer, LocalAnnouncement } from "@/lib/local-store";

type DocFile = {
  url?: string;
  filename?: string;
  page?: number;
  pages?: number[];
  totalPages?: number;
  /** 체크포인트별 검수 결과 (5단계 상세 페이지와 동일 스토리지) */
  checkpointResults?: Record<string, { status: "pass" | "fail" | "pending"; note?: string }>;
};

type DocItem = {
  name: string;
  shortName?: string;
  condition?: string;
  category?: string;
  conditional?: boolean;
};

export interface DocumentMapperProps {
  isOpen: boolean;
  onClose: () => void;
  bundleUrl: string;
  bundleFilename?: string;
  bundleFileId?: number;
  totalPages?: number;
  documents: DocItem[];
  fileMap: Record<string, DocFile>;
  /**
   * 페이지 토글 — `page=number`면 해당 페이지를 그 서류에 토글(있으면 제거, 없으면 추가),
   * `page=undefined`면 그 서류의 페이지 매핑 전체 해제.
   */
  onAssignPage: (docName: string, page: number | undefined) => void;
  initialPage?: number;
  /**
   * 청약홈에서 이미 검증되어 별도 페이지 지정이 불필요한 서류 이름 목록.
   * (예: 특별공급신청서·무주택 서약서, 청약통장 순위(가입)확인서)
   * 매퍼에서 [+] 버튼 비활성화 + 녹색 「청약홈 자동확인」 배지로 구분.
   */
  applyhomeAutoVerified?: string[];
  /**
   * 담당자 확인 포인트 표시용 — 있으면 우측 서류 카드 안에 체크포인트 인라인 노출.
   * 페이지 매핑하면서 동시에 「부양가족 수 일치」「미성년 자녀 3명 이상」 등 검증 가능.
   */
  customer?: LocalCustomer;
  announcement?: LocalAnnouncement;
  /** 체크포인트 상태 변경 콜백 — pass/fail/pending 토글 */
  onCheckpointChange?: (
    docName: string,
    cpKey: string,
    next: { status?: "pass" | "fail" | "pending"; note?: string },
  ) => void;
}

/* ─── 페이지 썸네일 캐시 ─── */
type ThumbCache = {
  url: string;        // bundleUrl
  total: number;
  thumbs: Record<number, string>; // page -> dataURL
};
const thumbCacheRef: { current: ThumbCache | null } = { current: null };

export default function DocumentPageMapper({
  isOpen, onClose, bundleUrl, bundleFilename, bundleFileId,
  totalPages: totalPagesProp, documents, fileMap, onAssignPage,
  initialPage = 1, applyhomeAutoVerified = [],
  customer, announcement, onCheckpointChange,
}: DocumentMapperProps) {
  const autoVerifiedSet = new Set(applyhomeAutoVerified);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [iframeKey, setIframeKey] = useState(0);
  const [detectedTotal, setDetectedTotal] = useState<number | undefined>(undefined);
  const [detecting, setDetecting] = useState(false);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [thumbProgress, setThumbProgress] = useState<{done: number; total: number} | null>(null);
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const wheelLockRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // URL에서 fileId 추출 (legacy 파일 호환)
  const effectiveFileId = (() => {
    if (bundleFileId) return bundleFileId;
    const m = bundleUrl.match(/\/api\/files\/(\d+)\/download/);
    return m ? Number(m[1]) : undefined;
  })();

  const totalP = totalPagesProp || detectedTotal || 50;

  /* 모달 열림 시 초기 페이지 + iframe 리셋 */
  useEffect(() => {
    if (!isOpen) return;
    setCurrentPage(initialPage);
    setIframeKey((k) => k + 1);
  }, [isOpen, initialPage]);

  /* 총 페이지 수 자동 감지 */
  useEffect(() => {
    if (!isOpen || !effectiveFileId || totalPagesProp || detectedTotal) return;
    setDetecting(true);
    fetch(`/api/files/${effectiveFileId}/page-count`)
      .then((r) => r.json())
      .then((j) => { if (j?.totalPages) setDetectedTotal(j.totalPages); })
      .catch(() => {})
      .finally(() => setDetecting(false));
  }, [isOpen, effectiveFileId, totalPagesProp, detectedTotal]);

  /* 썸네일 점진적 로딩 (pdfjs 클라이언트 사이드) */
  useEffect(() => {
    if (!isOpen) return;
    const total = totalPagesProp || detectedTotal;
    if (!total) return;
    // 캐시 재활용
    if (thumbCacheRef.current && thumbCacheRef.current.url === bundleUrl
        && thumbCacheRef.current.total === total) {
      setThumbs(thumbCacheRef.current.thumbs);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setThumbProgress({ done: 0, total });
        // pdfjs-dist 동적 로드 — Next.js SSR 회피
        const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
        // worker 설정
        try {
          // @ts-ignore
          pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url")).default;
        } catch {
          // legacy CDN fallback
          pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
        }
        const loadingTask = pdfjs.getDocument(bundleUrl);
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const acc: Record<number, string> = {};
        for (let p = 1; p <= total; p++) {
          if (cancelled) return;
          try {
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale: 0.25 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            await page.render({ canvasContext: ctx, viewport }).promise;
            acc[p] = canvas.toDataURL("image/jpeg", 0.6);
            setThumbs((prev) => ({ ...prev, [p]: acc[p] }));
            setThumbProgress({ done: p, total });
          } catch {
            // skip page
          }
        }
        thumbCacheRef.current = { url: bundleUrl, total, thumbs: acc };
        setThumbProgress(null);
      } catch (err) {
        // 썸네일 실패해도 매퍼는 동작 (텍스트만 표시)
        setThumbProgress(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, bundleUrl, totalPagesProp, detectedTotal]);

  /* 페이지 → 서류 역인덱스 */
  const pageAssignments = new Map<number, string[]>();
  for (const [docName, df] of Object.entries(fileMap)) {
    if (docName === "서류 묶음(통합)") continue;
    const pages: number[] = Array.isArray(df?.pages) && df!.pages!.length > 0
      ? df!.pages!
      : (df?.page ? [df.page] : []);
    for (const p of pages) {
      if (!pageAssignments.has(p)) pageAssignments.set(p, []);
      pageAssignments.get(p)!.push(docName);
    }
  }

  const jumpTo = useCallback((p: number) => {
    const total = totalPagesProp || detectedTotal || 50;
    const clamped = Math.max(1, Math.min(total, Math.round(p)));
    setCurrentPage(clamped);
    setIframeKey((k) => k + 1);
  }, [totalPagesProp, detectedTotal]);

  /* 키보드 화살표 / PgUp PgDn / Home / End */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      // input·textarea 안에서는 무시
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentPage((p) => {
          const next = Math.max(1, p - 1);
          setIframeKey((k) => k + 1);
          return next;
        });
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        const total = totalPagesProp || detectedTotal || 50;
        setCurrentPage((p) => {
          const next = Math.min(total, p + 1);
          setIframeKey((k) => k + 1);
          return next;
        });
      } else if (e.key === "Home") {
        e.preventDefault();
        jumpTo(1);
      } else if (e.key === "End") {
        e.preventDefault();
        jumpTo(totalPagesProp || detectedTotal || 50);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, totalPagesProp, detectedTotal, jumpTo, onClose]);

  /* 휠 페이지 이동 (PDF 영역 위) — 빠르게 굴리지 않도록 throttle */
  const onWheelZone: React.WheelEventHandler<HTMLDivElement> = (e) => {
    if (e.ctrlKey) return; // Ctrl+휠은 브라우저/PDF 줌
    const now = Date.now();
    if (now - wheelLockRef.current < 80) {
      e.preventDefault();
      return;
    }
    wheelLockRef.current = now;
    e.preventDefault();
    const total = totalPagesProp || detectedTotal || 50;
    if (e.deltaY > 0) {
      setCurrentPage((p) => {
        const next = Math.min(total, p + 1);
        setIframeKey((k) => k + 1);
        return next;
      });
    } else if (e.deltaY < 0) {
      setCurrentPage((p) => {
        const next = Math.max(1, p - 1);
        setIframeKey((k) => k + 1);
        return next;
      });
    }
  };

  /* 빠른 화살표 (autorepeat 빠르게) — onMouseDown + setInterval */
  const repeatRef = useRef<{stop: () => void} | null>(null);
  const startRepeat = (dir: -1 | 1) => {
    if (repeatRef.current) repeatRef.current.stop();
    let started = false;
    let interval: any = null;
    // 첫 클릭은 즉시
    const tick = () => {
      const total = totalPagesProp || detectedTotal || 50;
      setCurrentPage((p) => {
        const next = Math.max(1, Math.min(total, p + dir));
        setIframeKey((k) => k + 1);
        return next;
      });
    };
    tick();
    const startDelay = setTimeout(() => {
      started = true;
      interval = setInterval(tick, 80);
    }, 350);
    repeatRef.current = {
      stop: () => {
        clearTimeout(startDelay);
        if (interval) clearInterval(interval);
        repeatRef.current = null;
        void started;
      },
    };
  };
  const stopRepeat = () => repeatRef.current?.stop();

  if (!isOpen) return null;

  const currentAssignments = pageAssignments.get(currentPage) || [];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex" onClick={onClose}>
      <div
        ref={containerRef}
        className="bg-white w-full h-full max-w-[1700px] mx-auto my-2 rounded-lg overflow-hidden flex flex-col"
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
                <strong>워크플로우</strong>: ① 페이지 이동 (휠/← →/숫자/썸네일) → ② 우측 서류 [+] 클릭 — 한 서류에 <strong className="text-indigo-700">여러 페이지 추가 가능</strong>
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
            <span className="text-[11px] text-ink-2 font-semibold">📍 현재 페이지</span>
            <button
              onMouseDown={() => startRepeat(-1)}
              onMouseUp={stopRepeat}
              onMouseLeave={stopRepeat}
              onTouchStart={() => startRepeat(-1)}
              onTouchEnd={stopRepeat}
              disabled={currentPage <= 1}
              className="p-1 hover:bg-white rounded disabled:opacity-30"
              title="이전 페이지 (← / PgUp · 길게 눌러 빠르게)"
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
              onMouseDown={() => startRepeat(1)}
              onMouseUp={stopRepeat}
              onMouseLeave={stopRepeat}
              onTouchStart={() => startRepeat(1)}
              onTouchEnd={stopRepeat}
              disabled={currentPage >= totalP}
              className="p-1 hover:bg-white rounded disabled:opacity-30"
              title="다음 페이지 (→ / PgDn · 길게 눌러 빠르게)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {detecting && <span className="text-[10px] text-ink-3 ml-2">페이지 수 감지 중…</span>}
            {thumbProgress && (
              <span className="text-[10px] text-ink-3 ml-2 inline-flex items-center gap-1">
                <ImageIcon className="w-3 h-3" /> 썸네일 {thumbProgress.done}/{thumbProgress.total}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0" />

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
                <span className="text-amber-800">{currentPage}p 미지정</span>
              </>
            )}
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 flex overflow-hidden">
          {/* PDF 뷰어 */}
          <div
            ref={wheelRef}
            className="flex-1 flex flex-col min-w-0 bg-gray-100"
            onWheel={onWheelZone}
          >
            <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-[11px] text-blue-900 flex items-center gap-1.5">
              <span>💡</span>
              <span>
                <strong>이동:</strong> 마우스 휠 / 키보드 ← → / 하단 썸네일 클릭. <strong>같은 서류에 여러 페이지를</strong> [+] 버튼으로 추가하세요.
              </span>
            </div>
            <iframe
              key={iframeKey}
              src={`${bundleUrl}#page=${currentPage}&toolbar=0&navpanes=0&view=FitH`}
              className="flex-1 w-full bg-gray-200"
              title="서류 묶음 PDF"
            />
            {/* 썸네일 바 */}
            <div className="px-2 py-2 bg-white border-t border-border max-h-44 overflow-y-auto">
              <div className="text-[10px] text-ink-3 mb-1.5 uppercase tracking-wide font-medium flex items-center gap-2">
                <span>썸네일</span>
                <span className="text-ink-4">· 전체 {totalP}p · 지정됨 {pageAssignments.size}p</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(78px,1fr))] gap-1.5">
                {Array.from({ length: totalP }, (_, i) => i + 1).map((p) => {
                  const docs = pageAssignments.get(p) || [];
                  const isCurrent = p === currentPage;
                  const hasAssign = docs.length > 0;
                  const thumbUrl = thumbs[p];
                  return (
                    <button
                      key={p}
                      onClick={() => jumpTo(p)}
                      className={`relative rounded border-2 overflow-hidden transition group ${
                        isCurrent
                          ? "border-indigo-600 ring-2 ring-indigo-200"
                          : hasAssign
                            ? "border-emerald-400"
                            : "border-gray-200 hover:border-indigo-300"
                      }`}
                      title={docs.length > 0 ? docs.join(", ") : `${p}p로 이동`}
                    >
                      {thumbUrl ? (
                        <img src={thumbUrl} alt={`p${p}`} className="w-full h-auto block" />
                      ) : (
                        <div className="w-full aspect-[3/4] bg-gray-100 flex items-center justify-center text-[10px] text-ink-4">
                          로딩…
                        </div>
                      )}
                      <span className={`absolute top-0 left-0 px-1 text-[9px] font-bold ${
                        isCurrent ? "bg-indigo-600 text-white" : "bg-white/90 text-ink-2"
                      }`}>
                        {p}
                      </span>
                      {hasAssign && (
                        <span className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-emerald-600/90 text-white text-[9px] truncate">
                          {docs[0].length > 6 ? docs[0].slice(0, 6) + "…" : docs[0]}
                          {docs.length > 1 ? ` +${docs.length - 1}` : ""}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 우: 서류 목록 */}
          <div className="w-[360px] flex-shrink-0 flex flex-col border-l border-border bg-white">
            <div className="px-3 py-2 border-b border-border bg-surface2/50">
              <h3 className="text-xs font-semibold text-ink-2">서류 목록</h3>
              <p className="text-[10px] text-ink-3 mt-0.5 leading-relaxed">
                현재 <strong className="text-indigo-700">{currentPage}p</strong>를 [+] 버튼으로 서류에 추가/제거하세요. (같은 서류에 여러 장 추가 가능)
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {documents
                .filter((d) => d.name !== "서류 묶음(통합)")
                .map((d) => {
                  const df: any = fileMap[d.name];
                  const pages: number[] = Array.isArray(df?.pages) && df.pages.length > 0
                    ? df.pages
                    : (df?.page ? [df.page] : []);
                  const isOnCurrent = pages.includes(currentPage);
                  const display = d.shortName || d.name;
                  const isAutoVerified = autoVerifiedSet.has(d.name);
                  return (
                    <div
                      key={d.name}
                      className={`p-2 rounded border ${
                        isAutoVerified
                          ? "border-emerald-300 bg-emerald-50/80"
                          : isOnCurrent
                            ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200"
                            : pages.length > 0
                              ? "border-emerald-200 bg-emerald-50/60"
                              : "border-border"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className={`text-xs font-medium leading-tight ${
                              isAutoVerified ? "text-emerald-900" : "text-ink-2"
                            }`}>
                              {display}
                            </span>
                            {d.conditional ? (
                              <span
                                className="text-[9px] bg-amber-200 text-amber-800 px-1 py-0.5 rounded font-semibold"
                                title={d.condition ? `해당자 — ${d.condition}` : "해당자만"}
                              >
                                해당자
                              </span>
                            ) : (
                              <span className="text-[9px] bg-blue-100 text-blue-800 px-1 py-0.5 rounded font-semibold">
                                필수
                              </span>
                            )}
                            {isAutoVerified && (
                              <span
                                className="text-[9px] bg-emerald-600 text-white px-1 py-0.5 rounded font-semibold inline-flex items-center gap-0.5"
                                title="청약홈에서 이미 검증 — 별도 페이지 지정 불필요"
                              >
                                ✓ 청약홈 자동확인
                              </span>
                            )}
                          </div>
                          {isAutoVerified ? (
                            <div className="text-[9.5px] mt-0.5 text-emerald-700">
                              ↳ 청약홈 신청 시 검증 완료. 별도 제출·페이지 지정 불필요.
                            </div>
                          ) : d.condition ? (
                            <div className={`text-[9.5px] mt-0.5 ${
                              d.conditional ? "text-amber-700" : "text-ink-4"
                            }`}>
                              {d.conditional ? "↳ 해당 시: " : "↳ "}{d.condition}
                            </div>
                          ) : null}
                          {/* 지정된 페이지 목록 */}
                          {!isAutoVerified && (
                            pages.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-0.5 items-center">
                                <span className="text-[9px] text-emerald-700">지정:</span>
                                {pages.map((p) => (
                                  <button
                                    key={p}
                                    onClick={() => jumpTo(p)}
                                    className={`px-1 py-0 rounded text-[10px] font-mono ${
                                      p === currentPage
                                        ? "bg-indigo-600 text-white"
                                        : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                    }`}
                                    title={`${p}p 보기`}
                                  >
                                    {p}p
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[10px] text-ink-4 mt-0.5">미지정</div>
                            )
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          {isAutoVerified ? (
                            <span
                              className="inline-flex items-center gap-0.5 px-2 py-1 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 cursor-not-allowed"
                              title="청약홈 자동확인 — 페이지 지정 불필요"
                            >
                              <CheckCircle2 className="w-2.5 h-2.5" />완료
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => onAssignPage(d.name, currentPage)}
                                className={`inline-flex items-center gap-0.5 px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap ${
                                  isOnCurrent
                                    ? "bg-red-100 text-red-700 hover:bg-red-200"
                                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                                }`}
                                title={isOnCurrent ? `${currentPage}p 제거` : `${currentPage}p 추가`}
                              >
                                {isOnCurrent ? (
                                  <>−{currentPage}p</>
                                ) : (
                                  <><Plus className="w-2.5 h-2.5" />{currentPage}p</>
                                )}
                              </button>
                              {pages.length > 0 && (
                                <button
                                  onClick={() => onAssignPage(d.name, undefined)}
                                  className="text-[9px] text-red-500 hover:underline"
                                  title="이 서류의 모든 페이지 지정 해제"
                                >
                                  전체 해제
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {/* 담당자 확인 포인트 — customer/announcement 있을 때만 노출 */}
                      {!isAutoVerified && customer && (() => {
                        const checkpoints = getCheckpointsForDocument(d.name, customer, announcement);
                        if (checkpoints.length === 0) return null;
                        const results = df?.checkpointResults || {};
                        const doneCount = checkpoints.filter((c) => results[c.key]?.status === "pass").length;
                        return (
                          <div className="mt-1.5 p-1.5 rounded bg-white/70 border border-blue-100 text-[10px] space-y-0.5">
                            <div className="flex items-center justify-between">
                              <div className="text-[9.5px] font-semibold text-blue-900">
                                💡 담당자 확인 포인트
                              </div>
                              <div className="text-[9px] text-ink-4">
                                {doneCount}/{checkpoints.length} 확인
                              </div>
                            </div>
                            {checkpoints.map((cp) => {
                              const status = results[cp.key]?.status || "pending";
                              const sevColor = cp.severity === "must"
                                ? "text-red-600"
                                : cp.severity === "verify"
                                  ? "text-amber-600"
                                  : "text-ink-3";
                              const bgClr = status === "pass"
                                ? "bg-green-50"
                                : status === "fail"
                                  ? "bg-red-50"
                                  : "";
                              return (
                                <div key={cp.key} className={`flex items-start gap-1 p-1 rounded ${bgClr}`}>
                                  <span className={`flex-shrink-0 mt-0.5 ${sevColor}`}>
                                    {cp.severity === "must" ? "●" : cp.severity === "verify" ? "◉" : "◯"}
                                  </span>
                                  <div className="flex-1 min-w-0 text-ink-2 leading-tight">
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span>{cp.label}</span>
                                      {cp.expected && (
                                        <span className="font-semibold text-ink">
                                          {cp.expected}
                                        </span>
                                      )}
                                      <span className="text-[8.5px] text-ink-4">
                                        [{cp.source}]
                                      </span>
                                    </div>
                                    {cp.hint && (
                                      <div className="text-[9px] text-ink-4 mt-0.5">
                                        ↳ {cp.hint}
                                      </div>
                                    )}
                                  </div>
                                  {/* pass/fail/pending 토글 */}
                                  {onCheckpointChange && (
                                    <div className="flex flex-shrink-0 gap-0.5 items-center">
                                      <button
                                        onClick={() => onCheckpointChange(d.name, cp.key, { status: status === "pass" ? "pending" : "pass" })}
                                        className={`px-1 py-0 rounded text-[10px] ${status === "pass" ? "bg-green-600 text-white" : "bg-gray-100 text-ink-3 hover:bg-green-100"}`}
                                        title="확인 완료"
                                      >
                                        ✓
                                      </button>
                                      <button
                                        onClick={() => onCheckpointChange(d.name, cp.key, { status: status === "fail" ? "pending" : "fail" })}
                                        className={`px-1 py-0 rounded text-[10px] ${status === "fail" ? "bg-red-600 text-white" : "bg-gray-100 text-ink-3 hover:bg-red-100"}`}
                                        title="문제 있음"
                                      >
                                        ✗
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
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
