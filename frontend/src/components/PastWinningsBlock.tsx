"use client";

/**
 * Phase #8 — 청약홈 당첨사실 확인서 기반 과거 당첨 이력 관리
 *
 * 청약홈 API가 공개되지 않아 현재는 담당자 수동 입력.
 * 추후 확인서 PDF 포맷이 표준화되면 파서 연결 예정.
 *
 * 입력된 과거 당첨 이력은 customer-cross-check.ts에서:
 *  - 특공 평생 1회 제한 위반 자동 감지
 *  - 재당첨 제한 기간 내 신청 감지
 * 에 활용됨.
 */

import { useState } from "react";
import type { LocalCustomer } from "@/lib/local-store";
import { localCustomers } from "@/lib/local-store";
import { History, Plus, Trash2 } from "lucide-react";

type PastEntry = NonNullable<LocalCustomer["past_winnings"]>[number];

interface Props {
  customer: LocalCustomer;
  onUpdate: (c?: LocalCustomer) => void;
}

const EMPTY: PastEntry = {
  announcementTitle: "",
  winDate: "",
  supplyType: "",
  canonicalType: "",
  unitType: "",
  restrictionYears: undefined,
  restrictionEndDate: "",
  note: "",
};

const CANONICAL_TYPES = [
  "일반공급", "신혼부부", "생애최초", "다자녀가구",
  "노부모부양", "기관추천", "신생아", "이전기관", "기타",
];

export default function PastWinningsBlock({ customer, onUpdate }: Props) {
  const [entries, setEntries] = useState<PastEntry[]>(customer.past_winnings || []);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<PastEntry>(EMPTY);

  const save = (newEntries: PastEntry[]) => {
    const updated = localCustomers.update(customer.id, {
      past_winnings: newEntries,
      past_winnings_checked_at: new Date().toISOString(),
    });
    setEntries(newEntries);
    onUpdate(updated as any);
  };

  const addEntry = () => {
    if (!draft.announcementTitle.trim() || !draft.winDate) {
      alert("공고명과 당첨일은 필수입니다.");
      return;
    }
    save([...entries, { ...draft }]);
    setDraft(EMPTY);
    setShowForm(false);
  };

  const removeEntry = (i: number) => {
    if (!confirm("이 당첨 이력을 삭제할까요?")) return;
    save(entries.filter((_, idx) => idx !== i));
  };

  const markNoHistory = () => {
    save([]);
  };

  const checkedAt = customer.past_winnings_checked_at
    ? new Date(customer.past_winnings_checked_at).toLocaleDateString("ko-KR")
    : null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-ink-2" />
          <h3 className="font-semibold text-ink">과거 당첨 이력 (청약홈 확인서)</h3>
          {entries.length > 0 && (
            <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">
              {entries.length}건
            </span>
          )}
          {entries.length === 0 && checkedAt && (
            <span className="text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-medium">
              이력 없음 확인
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {checkedAt && <span className="text-[11px] text-ink-3">확인일 {checkedAt}</span>}
          <button
            onClick={() => setShowForm(true)}
            className="btn-secondary text-xs inline-flex items-center gap-1 px-2.5 py-1"
          >
            <Plus className="w-3 h-3" /> 이력 추가
          </button>
          {entries.length === 0 && !checkedAt && (
            <button
              onClick={markNoHistory}
              className="text-xs bg-green-50 border border-green-200 text-green-700 rounded-md px-2.5 py-1 hover:bg-green-100"
              title="청약홈 확인서 확인 결과 과거 당첨 이력 없음"
            >
              이력 없음
            </button>
          )}
        </div>
      </div>

      {!checkedAt && entries.length === 0 && !showForm && (
        <div className="text-xs text-ink-3 bg-blue-50 border border-blue-200 rounded-md p-3">
          💡 청약홈에서 발급받은 <strong>당첨사실 확인서</strong>를 확인한 후:
          이력이 없으면 [이력 없음] 버튼을, 이력이 있으면 [이력 추가]로 입력하세요.
          미입력 상태면 교차검증에서 <strong>특공 평생 1회 제한 위반</strong>을 자동 감지할 수 없습니다.
        </div>
      )}

      {/* 기존 이력 리스트 */}
      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((e, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-semibold text-sm">{e.announcementTitle}</span>
                  {e.canonicalType && (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                      {e.canonicalType}
                    </span>
                  )}
                  {e.unitType && (
                    <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                      {e.unitType}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600">
                  <span>당첨일: <span className="text-gray-800 font-medium">{e.winDate}</span></span>
                  {e.restrictionYears && (
                    <span>재당첨 제한: <span className="text-red-700 font-medium">{e.restrictionYears}년</span></span>
                  )}
                  {e.restrictionEndDate && (
                    <span>제한 해제일: <span className="text-amber-700 font-medium">{e.restrictionEndDate}</span></span>
                  )}
                </div>
                {e.note && (
                  <div className="text-[11px] text-gray-500 mt-1">{e.note}</div>
                )}
              </div>
              <button
                onClick={() => removeEntry(i)}
                className="text-red-400 hover:text-red-600 flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 입력 폼 */}
      {showForm && (
        <div className="mt-3 border-2 border-dashed border-blue-300 rounded-lg p-4 bg-blue-50/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-ink-2 mb-1">공고명 *</label>
              <input
                value={draft.announcementTitle}
                onChange={(e) => setDraft({ ...draft, announcementTitle: e.target.value })}
                placeholder="예: 2021 XX지구 XX단지"
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">당첨일 *</label>
              <input
                type="date"
                value={draft.winDate}
                onChange={(e) => setDraft({ ...draft, winDate: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">공급유형</label>
              <select
                value={draft.canonicalType || ""}
                onChange={(e) => setDraft({ ...draft, canonicalType: e.target.value, supplyType: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              >
                <option value="">선택</option>
                {CANONICAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">주택형</label>
              <input
                value={draft.unitType || ""}
                onChange={(e) => setDraft({ ...draft, unitType: e.target.value })}
                placeholder="예: 84A"
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">재당첨 제한(년)</label>
              <input
                type="number"
                min={0}
                value={draft.restrictionYears ?? ""}
                onChange={(e) => setDraft({ ...draft, restrictionYears: e.target.value === "" ? undefined : Number(e.target.value) })}
                placeholder="예: 5"
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-2 mb-1">제한 해제일</label>
              <input
                type="date"
                value={draft.restrictionEndDate || ""}
                onChange={(e) => setDraft({ ...draft, restrictionEndDate: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-ink-2 mb-1">메모 (선택)</label>
              <input
                value={draft.note || ""}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="특이사항"
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setDraft(EMPTY); }} className="btn-secondary text-xs">
              취소
            </button>
            <button onClick={addEntry} className="btn-primary text-xs">
              저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
