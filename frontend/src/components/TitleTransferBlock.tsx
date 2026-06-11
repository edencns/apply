"use client";

/**
 * 명의변경 이력 블록 — 고객 상세 페이지
 *
 * 당첨자 계약 체결 이후 상속·증여·전매 등으로 계약자가 바뀐 경우의 기록.
 * 데이터는 /workflow/transfers 에서 배치 파싱으로 생성되거나
 * 여기서 수동으로 추가 가능.
 */

import { useState } from "react";
import type { LocalCustomer } from "@/lib/local-store";
import { localCustomers } from "@/lib/local-store";
import {
  ArrowRightLeft, FileText, Eye, Trash2, Plus, AlertTriangle, CheckCircle2,
} from "lucide-react";

type Reason = NonNullable<LocalCustomer["title_transfer"]>["reason"];

const REASON_OPTIONS: Reason[] = ["상속", "배우자증여", "부모자녀증여", "이혼재산분할", "전매", "기타"];
const REASON_COLORS: Record<Reason, string> = {
  "상속": "bg-fail-soft text-fail",
  "배우자증여": "bg-surface2 text-ink-2",
  "부모자녀증여": "bg-accent-soft text-accent",
  "이혼재산분할": "bg-warn-soft text-warn",
  "전매": "bg-ok-soft text-ok",
  "기타": "bg-surface2 text-ink-2",
};

export default function TitleTransferBlock({
  customer,
  onUpdate,
}: {
  customer: LocalCustomer;
  onUpdate: (c?: LocalCustomer) => void;
}) {
  const tt = customer.title_transfer;
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<any>({
    reason: "기타" as Reason,
    transferDate: "",
    newName: "",
    newRrn: "",
    newRelation: "",
    newPhone: "",
    newAddress: "",
    notes: "",
  });

  const handleSave = () => {
    if (!draft.newName.trim()) {
      alert("신 명의자 성명은 필수입니다.");
      return;
    }
    const updated = localCustomers.update(customer.id, {
      title_transfer: {
        reason: draft.reason,
        transferDate: draft.transferDate || undefined,
        oldHolder: {
          name: customer.name,
          rrn: customer.rrn_front && customer.rrn_back
            ? `${customer.rrn_front}-${customer.rrn_back.slice(0, 1)}******`
            : undefined,
          address: (customer as any).address,
        },
        newHolder: {
          name: draft.newName.trim(),
          rrn: draft.newRrn.trim() || undefined,
          relation: draft.newRelation.trim() || undefined,
          phone: draft.newPhone.trim() || undefined,
          address: draft.newAddress.trim() || undefined,
        },
        submittedDocuments: [],
        aiNotes: draft.notes.trim() || undefined,
        aiConfidence: "high", // 수동 입력은 high
        createdAt: new Date().toISOString(),
      },
    });
    onUpdate(updated ?? undefined);
    setAddOpen(false);
    setDraft({
      reason: "기타", transferDate: "",
      newName: "", newRrn: "", newRelation: "", newPhone: "", newAddress: "", notes: "",
    });
  };

  const handleRemove = () => {
    if (!confirm("이 명의변경 기록을 삭제할까요?")) return;
    const updated = localCustomers.update(customer.id, {
      title_transfer: undefined as any,
    });
    onUpdate(updated ?? undefined);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-ink-2" />
          <h3 className="font-semibold text-ink">명의변경 이력</h3>
          {tt && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${REASON_COLORS[tt.reason]}`}>
              {tt.reason}
            </span>
          )}
        </div>
        {!tt && (
          <button
            onClick={() => setAddOpen(true)}
            className="btn-secondary text-xs inline-flex items-center gap-1 px-2.5 py-1"
          >
            <Plus className="w-3 h-3" /> 명의변경 기록 추가
          </button>
        )}
      </div>

      {!tt && !addOpen && (
        <div className="text-xs text-ink-3 py-2">
          명의변경 기록 없음. 계약 체결 이후 상속·증여·전매 등으로 계약자가 바뀐 경우
          <strong> /workflow/transfers </strong>에서 배치 업로드하거나 위 버튼으로 수동 추가할 수 있습니다.
        </div>
      )}

      {tt && (
        <div className="space-y-3">
          {/* 개요 */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded bg-surface2/60 border border-border-soft">
              <div className="text-[10px] text-ink-3 uppercase mb-0.5">변경일</div>
              <div className="font-mono text-ink">{tt.transferDate || "—"}</div>
            </div>
            <div className="p-2 rounded bg-surface2/60 border border-border-soft">
              <div className="text-[10px] text-ink-3 uppercase mb-0.5">관계</div>
              <div className="text-ink">{tt.newHolder?.relation || "—"}</div>
            </div>
          </div>

          {/* 명의자 흐름 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[120px] p-2.5 rounded-lg bg-surface2 border border-border">
              <div className="text-[10px] text-ink-3 uppercase mb-1">기존 명의자</div>
              <div className="text-sm font-medium text-ink">{tt.oldHolder?.name || customer.name}</div>
              {tt.oldHolder?.rrn && (
                <div className="text-[10px] text-ink-3 font-mono">{tt.oldHolder.rrn}</div>
              )}
            </div>
            <div className="text-ink-3 px-1">→</div>
            <div className="flex-1 min-w-[120px] p-2.5 rounded-lg bg-ok-soft border border-border">
              <div className="text-[10px] text-ok uppercase mb-1">신 명의자</div>
              <div className="text-sm font-medium text-ok">{tt.newHolder?.name || "—"}</div>
              {tt.newHolder?.rrn && (
                <div className="text-[10px] text-ok font-mono">{tt.newHolder.rrn}</div>
              )}
              {tt.newHolder?.phone && (
                <div className="text-[10px] text-ink-3 mt-0.5">{tt.newHolder.phone}</div>
              )}
              {tt.newHolder?.address && (
                <div className="text-[10px] text-ink-3 mt-0.5 truncate" title={tt.newHolder.address}>
                  {tt.newHolder.address}
                </div>
              )}
            </div>
          </div>

          {/* 제출 서류 */}
          {tt.submittedDocuments && tt.submittedDocuments.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-ink-3 mb-1">제출 서류 ({tt.submittedDocuments.length}종)</div>
              <div className="flex flex-wrap gap-1">
                {tt.submittedDocuments.map((d, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-ink-2">
                    <CheckCircle2 className="w-2.5 h-2.5 inline mr-0.5 text-ok" />
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI 특이사항 */}
          {tt.aiNotes && (
            <div className="p-2 rounded bg-warn-soft border border-border text-[11px] text-warn flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{tt.aiNotes}</span>
            </div>
          )}

          {/* 원본 파일 + 삭제 */}
          <div className="flex items-center justify-between pt-2 border-t border-border-soft">
            <div className="flex items-center gap-2">
              {tt.originalFileUrl && (
                <a
                  href={tt.originalFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline inline-flex items-center gap-1"
                >
                  <FileText className="w-3 h-3" /> 스캔본 보기
                </a>
              )}
              {tt.aiConfidence && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  tt.aiConfidence === "high" ? "bg-ok-soft text-ok" :
                  tt.aiConfidence === "med" ? "bg-warn-soft text-warn" :
                  "bg-fail-soft text-fail"
                }`}>
                  AI 신뢰도 {tt.aiConfidence.toUpperCase()}
                </span>
              )}
            </div>
            <button
              onClick={handleRemove}
              className="text-[11px] text-fail hover:text-fail inline-flex items-center gap-0.5"
            >
              <Trash2 className="w-3 h-3" /> 삭제
            </button>
          </div>
        </div>
      )}

      {/* 수동 추가 폼 */}
      {addOpen && (
        <div className="mt-3 border-2 border-dashed border-accent-line rounded-lg p-4 bg-accent-soft/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">사유 *</label>
              <select
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value as Reason })}
                className="w-full border border-border rounded-md px-2 py-1.5 text-sm"
              >
                {REASON_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">명의변경일</label>
              <input
                type="date"
                value={draft.transferDate}
                onChange={(e) => setDraft({ ...draft, transferDate: e.target.value })}
                className="w-full border border-border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-ink-2 mb-1">신 명의자 성명 *</label>
              <input
                value={draft.newName}
                onChange={(e) => setDraft({ ...draft, newName: e.target.value })}
                className="w-full border border-border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">신 명의자 주민번호</label>
              <input
                value={draft.newRrn}
                onChange={(e) => setDraft({ ...draft, newRrn: e.target.value })}
                placeholder="예: 800101-1234567"
                className="w-full border border-border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">기존자와의 관계</label>
              <input
                value={draft.newRelation}
                onChange={(e) => setDraft({ ...draft, newRelation: e.target.value })}
                placeholder="배우자 / 자녀 / 부모 등"
                className="w-full border border-border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">연락처</label>
              <input
                value={draft.newPhone}
                onChange={(e) => setDraft({ ...draft, newPhone: e.target.value })}
                className="w-full border border-border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">신 명의자 주소</label>
              <input
                value={draft.newAddress}
                onChange={(e) => setDraft({ ...draft, newAddress: e.target.value })}
                className="w-full border border-border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-ink-2 mb-1">메모</label>
              <input
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="특이사항"
                className="w-full border border-border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setAddOpen(false); }}
              className="btn-secondary text-xs"
            >
              취소
            </button>
            <button onClick={handleSave} className="btn-primary text-xs">
              저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
