"use client";

/**
 * Phase #6 — 담당자 최종 승인 체크리스트
 *
 * 자동 판정 결과 위에 담당자가 직접 "공고/서류/특이사항 다 확인했음"을
 * 체크 + 서명하는 블록. 서명 후에만 "최종 적합" 상태로 간주.
 */

import { useState, useEffect } from "react";
import type { LocalCustomer } from "@/lib/local-store";
import { localCustomers } from "@/lib/local-store";
import { CheckCircle2, Circle, ClipboardCheck, Edit2 } from "lucide-react";

interface Props {
  customer: LocalCustomer;
  /** 고객 업데이트 후 재조회 트리거 — (c: LocalCustomer) | () => void 둘 다 호환 */
  onUpdate: (c?: LocalCustomer) => void;
}

const CHECKLIST_ITEMS = [
  {
    key: "announcement_original_confirmed" as const,
    label: "공고 원문 재확인 완료",
    hint: "자격 요건·규제·서류 목록이 시스템 추출과 일치하는지",
  },
  {
    key: "family_cert_matched" as const,
    label: "가족관계·혼인관계 증명서 대조 완료",
    hint: "세대 구성·혼인기간·자녀수가 실제 서류와 일치",
  },
  {
    key: "past_winning_checked" as const,
    label: "청약홈 당첨사실 확인서 대조 완료",
    hint: "과거 당첨 이력·재당첨 제한·특공 평생 1회 확인",
  },
  {
    key: "boundary_cases_reviewed" as const,
    label: "애매 케이스 검토 완료",
    hint: "부부 중복 당첨·세대원 교차·자녀 나이 경계·소득 경계 등",
  },
];

export default function ManualReviewBlock({ customer, onUpdate }: Props) {
  const existing = customer.manual_review;
  const [editing, setEditing] = useState(!existing?.signed_off);
  const [checks, setChecks] = useState(existing?.checklist || {
    announcement_original_confirmed: false,
    family_cert_matched: false,
    past_winning_checked: false,
    boundary_cases_reviewed: false,
  });
  const [reviewerName, setReviewerName] = useState(existing?.reviewer_name || "");
  const [note, setNote] = useState(existing?.note || "");

  // user_id → 담당자명 기본값
  useEffect(() => {
    if (!reviewerName && typeof window !== "undefined") {
      const name = localStorage.getItem("user_name") || localStorage.getItem("user_email") || "";
      if (name) setReviewerName(name);
    }
  }, [reviewerName]);

  const allChecked = Object.values(checks).every(Boolean);
  const signedOff = existing?.signed_off && !editing;

  const handleSignOff = () => {
    if (!allChecked) {
      alert("모든 체크 항목을 확인한 후 서명할 수 있습니다.");
      return;
    }
    if (!reviewerName.trim()) {
      alert("담당자명을 입력해주세요.");
      return;
    }
    const updated = localCustomers.update(customer.id, {
      manual_review: {
        signed_off: true,
        checklist: checks,
        reviewer_name: reviewerName.trim(),
        signed_at: new Date().toISOString(),
        note: note.trim() || undefined,
      },
    });
    setEditing(false);
    onUpdate(updated as any);
  };

  const handleUnsign = () => {
    if (!confirm("서명을 해제하고 다시 편집하시겠습니까?")) return;
    const updated = localCustomers.update(customer.id, {
      manual_review: existing ? { ...existing, signed_off: false } : undefined,
    });
    setEditing(true);
    onUpdate(updated as any);
  };

  // 서명 완료 뷰
  if (signedOff) {
    const signedDate = new Date(existing.signed_at);
    return (
      <div className="card border-2 border-border bg-ok-soft">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="w-5 h-5 text-ok flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-ok">담당자 서명 완료</span>
              <span className="text-xs text-ok">
                {existing.reviewer_name} · {signedDate.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
              </span>
            </div>
            <ul className="mt-2 text-xs text-ok space-y-0.5">
              {CHECKLIST_ITEMS.map((item) => (
                <li key={item.key} className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-ok" /> {item.label}
                </li>
              ))}
            </ul>
            {existing.note && (
              <div className="mt-2 text-xs text-ok bg-surface/60 rounded px-2 py-1 border border-border">
                <span className="font-semibold">메모:</span> {existing.note}
              </div>
            )}
          </div>
          <button
            onClick={handleUnsign}
            className="text-xs text-ok hover:text-ok inline-flex items-center gap-1"
          >
            <Edit2 className="w-3 h-3" /> 재편집
          </button>
        </div>
      </div>
    );
  }

  // 편집/미서명 뷰
  return (
    <div className="card border-2 border-border bg-warn-soft">
      <div className="flex items-start gap-3 mb-3">
        <ClipboardCheck className="w-5 h-5 text-warn flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-bold text-warn">최종 승인 체크리스트</div>
          <div className="text-xs text-warn mt-0.5">
            아래 항목을 모두 확인한 후 서명하세요. 서명 후에만 최종 판정이 확정됩니다.
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        {CHECKLIST_ITEMS.map((item) => (
          <label
            key={item.key}
            className="flex items-start gap-2 cursor-pointer hover:bg-surface/60 rounded px-2 py-1.5 transition-colors"
          >
            <button
              type="button"
              onClick={() => setChecks((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
              className="mt-0.5 flex-shrink-0"
            >
              {checks[item.key] ? (
                <CheckCircle2 className="w-5 h-5 text-ok" />
              ) : (
                <Circle className="w-5 h-5 text-ink-3" />
              )}
            </button>
            <div className="flex-1">
              <div className={`text-sm font-medium ${checks[item.key] ? "text-ok" : "text-ink"}`}>
                {item.label}
              </div>
              <div className="text-[11px] text-ink-2">{item.hint}</div>
            </div>
          </label>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="col-span-1">
          <label className="block text-[11px] font-medium text-warn mb-1">담당자명 *</label>
          <input
            value={reviewerName}
            onChange={(e) => setReviewerName(e.target.value)}
            placeholder="예: 홍길동"
            className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] font-medium text-warn mb-1">특이사항 메모 (선택)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 상급자 ○○○과 협의"
            className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
      </div>

      <button
        onClick={handleSignOff}
        disabled={!allChecked || !reviewerName.trim()}
        className="w-full bg-green-600 hover:bg-green-700 disabled:bg-surface2 disabled:cursor-not-allowed text-white font-semibold py-2 rounded-md text-sm transition-colors"
      >
        {allChecked && reviewerName.trim() ? "최종 승인 및 서명" : "모든 항목 체크 + 담당자명 입력 필요"}
      </button>
    </div>
  );
}
