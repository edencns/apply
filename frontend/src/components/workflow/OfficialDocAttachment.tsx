"use client";

/**
 * 청약홈 송부용 공문 첨부 — 재사용 컴포넌트.
 *
 * 추첨이후 업무 [01]/[05]/[08] 각 메뉴마다 1개의 공문이 필요.
 * announcement.applyhome_documents[menuCode]에 파일 메타 저장.
 *
 * 공문 양식: "청약홈 > 사업주체전용 > 업무처리안내 > 관련양식" 참고.
 */

import { useRef, useState } from "react";
import { localAnnouncements, type LocalAnnouncement } from "@/lib/local-store";
import { uploadFileViaClient } from "@/lib/client-upload";

export type ApplyHomeMenuCode = "01" | "05" | "08";

const MENU_LABELS: Record<ApplyHomeMenuCode, string> = {
  "01": "[01] 분리세대 세대원 검색요청",
  "05": "[05] 추가입주자 명단",
  "08": "[08] 부적격당첨자 명단",
};

export default function OfficialDocAttachment({
  announcement,
  menuCode,
  compact = false,
  onUpdate,
}: {
  announcement: LocalAnnouncement;
  menuCode: ApplyHomeMenuCode;
  /** 작은 인라인 표시 모드 */
  compact?: boolean;
  onUpdate?: (a: LocalAnnouncement) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const docs = announcement.applyhome_documents || {};
  const current = docs[menuCode];

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const result = await uploadFileViaClient(file, {
        kind: "other",
        announcement_id: announcement.id,
      });
      const next = {
        ...(announcement.applyhome_documents || {}),
        [menuCode]: {
          url: result.url,
          filename: file.name,
          uploadedAt: new Date().toISOString(),
          fileId: result.id,
        },
      };
      localAnnouncements.update(announcement.id, {
        applyhome_documents: next,
      } as any);
      const fresh = localAnnouncements.get(announcement.id);
      if (fresh && onUpdate) onUpdate(fresh);
    } catch (err: any) {
      alert(err?.message || "공문 업로드 실패");
    } finally {
      setUploading(false);
      if (ref.current) ref.current.value = "";
    }
  };

  const remove = () => {
    if (!confirm(`${MENU_LABELS[menuCode]} 공문 첨부를 해제할까요?`)) return;
    const next = { ...(announcement.applyhome_documents || {}) };
    delete next[menuCode];
    localAnnouncements.update(announcement.id, {
      applyhome_documents: next,
    } as any);
    const fresh = localAnnouncements.get(announcement.id);
    if (fresh && onUpdate) onUpdate(fresh);
  };

  return (
    <div className={compact ? "inline-flex items-center gap-1.5" : "flex items-center gap-2"}>
      <input
        ref={ref}
        type="file"
        accept=".pdf,.hwp,.docx,.doc"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
      />
      {current ? (
        <>
          <a
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-[11px] text-emerald-700 hover:text-emerald-900 underline ${compact ? "" : "font-medium"}`}
            title={`공문 ${current.filename} · ${new Date(current.uploadedAt).toLocaleDateString()}`}
          >
            📎 공문 첨부됨
          </a>
          <button
            onClick={remove}
            className="text-[10px] text-ink-3 hover:text-red-600"
            title="첨부 해제"
          >
            ×
          </button>
        </>
      ) : (
        <button
          onClick={() => ref.current?.click()}
          disabled={uploading}
          className="px-2 py-0.5 rounded border border-amber-300 bg-white hover:bg-amber-50 disabled:opacity-40 text-[10px] text-amber-900 font-semibold"
          title="청약홈 송부 시 첨부할 공문 PDF 업로드"
        >
          {uploading ? "업로드 중…" : "공문 첨부"}
        </button>
      )}
    </div>
  );
}
