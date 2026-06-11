"use client";

/**
 * 공고 PDF 근거 페이지 뷰어 모달
 *
 * Phase A의 evidencePage 필드를 UI에서 클릭하면 이 모달이 열려
 * 공고 원본 PDF의 해당 페이지로 자동 스크롤.
 *
 * iframe + src="{url}#page={N}"으로 브라우저 기본 PDF 뷰어를 활용.
 * Chrome·Edge·Firefox·Safari 모두 지원.
 */

import { useEffect } from "react";
import { X, ExternalLink } from "lucide-react";

interface Props {
  open: boolean;
  url: string;
  page?: number;
  title?: string;
  onClose: () => void;
}

export default function PdfEvidenceModal({ open, url, page, title, onClose }: Props) {
  // ESC로 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // body 스크롤 잠금
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  // Vercel Blob URL + #page=N 으로 직접 점프
  const src = page ? `${url}#page=${page}` : url;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-ink">
              공고 원본 {page ? `· ${page}페이지` : ""}
            </span>
            {title && (
              <span className="text-xs text-ink-3 truncate max-w-md">{title}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/70 px-2 py-1"
              title="새 탭에서 열기"
            >
              <ExternalLink className="w-3.5 h-3.5" /> 새 탭
            </a>
            <button
              onClick={onClose}
              className="p-1 hover:bg-surface2 rounded-full"
              aria-label="닫기"
            >
              <X className="w-4 h-4 text-ink-2" />
            </button>
          </div>
        </div>

        {/* PDF iframe — 브라우저 기본 뷰어 사용 */}
        <div className="flex-1 bg-surface2 overflow-hidden">
          <iframe
            src={src}
            className="w-full h-full border-0"
            title="공고 원본 PDF"
          />
        </div>

        {/* 푸터 안내 */}
        <div className="px-4 py-2 border-t border-border text-[11px] text-ink-3 flex items-center justify-between flex-shrink-0">
          <span>ESC 또는 배경 클릭으로 닫기</span>
          <span>공고문 자체 파일이 원본이며, 추출 데이터와 상이 시 공고문이 우선합니다.</span>
        </div>
      </div>
    </div>
  );
}
