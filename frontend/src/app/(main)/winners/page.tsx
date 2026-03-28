"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { CheckCircle, XCircle, AlertTriangle, Clock, FileSearch, ThumbsUp, ThumbsDown } from "lucide-react";

interface Winner {
  id: number;
  unit_number: string;
  unit_type: string;
  supply_type: string;
  is_preliminary: boolean;
  doc_review_status: string;
  contract_intent: string;
  customer: { name: string; phone: string; total_score: number };
}

const REVIEW_STATUS: Record<string, { label: string; cls: string; icon: any }> = {
  pending:           { label: "검수 대기",    cls: "badge-pending",    icon: Clock },
  reviewing:         { label: "검수 중",      cls: "badge-review",     icon: FileSearch },
  eligible:          { label: "적격",        cls: "badge-eligible",   icon: CheckCircle },
  ineligible:        { label: "부적격",       cls: "badge-ineligible", icon: XCircle },
  needs_review:      { label: "확인 필요",    cls: "badge-review",     icon: AlertTriangle },
  needs_supplement:  { label: "서류 보완",    cls: "badge-review",     icon: AlertTriangle },
};

const INTENT_STATUS: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "계약 의사 있음", cls: "badge-eligible" },
  declined:  { label: "계약 포기",     cls: "badge-ineligible" },
  pending:   { label: "미확인",        cls: "badge-pending" },
};

export default function WinnersPage() {
  const [announcementId, setAnnouncementId] = useState("");
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const loadWinners = async () => {
    if (!announcementId) return;
    setLoading(true);
    try {
      const r = await api.get(`/announcements/${announcementId}`);
      // 공고의 당첨자 목록은 별도 엔드포인트 (간단히 winner 조회)
      const wr = await api.get(`/customers/site/1`); // TODO: 실제 연동
      setWinners([]);
    } finally {
      setLoading(false);
    }
  };

  // 적격 판정 실행
  const runCheck = async (winnerId: number) => {
    setActionLoading(winnerId);
    try {
      const r = await api.post(`/eligibility/check/${winnerId}`);
      alert(`판정 완료: ${r.data.verdict_label}\n${r.data.summary}`);
      loadWinners();
    } catch (e: any) {
      alert(e.response?.data?.detail || "판정 실패");
    } finally {
      setActionLoading(null);
    }
  };

  // 계약 의사 업데이트
  const updateIntent = async (winnerId: number, intent: "confirmed" | "declined") => {
    setActionLoading(winnerId);
    try {
      await api.patch(`/winners/${winnerId}/intent`, { contract_intent: intent });
      loadWinners();
    } catch (e: any) {
      alert(e.response?.data?.detail || "업데이트 실패");
    } finally {
      setActionLoading(null);
    }
  };

  // 계약서 생성
  const generateContract = async (winnerId: number) => {
    setActionLoading(winnerId);
    try {
      const r = await api.post(`/contracts/generate/${winnerId}`);
      alert(`계약서 생성 완료: ${r.data.contract_no}`);
    } catch (e: any) {
      alert(e.response?.data?.detail || "계약서 생성 실패");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">당첨자 관리</h1>
        <p className="text-sm text-gray-500 mt-1">서류 검수 · 적격 판정 · 계약 의사 확인</p>
      </div>

      {/* 공고 선택 */}
      <div className="card mb-6">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">공고 ID</label>
            <input
              type="number"
              value={announcementId}
              onChange={(e) => setAnnouncementId(e.target.value)}
              placeholder="모집공고 ID 입력"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={loadWinners}
            disabled={!announcementId}
            className="btn-primary mt-5"
          >
            당첨자 조회
          </button>
        </div>

        {/* 통계 요약 */}
        {winners.length > 0 && (
          <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
            {[
              { label: "전체 당첨자", value: winners.length, color: "text-gray-900" },
              { label: "적격", value: winners.filter(w => w.doc_review_status === "eligible").length, color: "text-green-600" },
              { label: "부적격", value: winners.filter(w => w.doc_review_status === "ineligible").length, color: "text-red-600" },
              { label: "계약 확정", value: winners.filter(w => w.contract_intent === "confirmed").length, color: "text-blue-600" },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 당첨자 목록 */}
      {winners.length === 0 && !loading ? (
        <div className="card text-center py-16 text-gray-400">
          <FileSearch className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>공고 ID를 입력하고 당첨자를 조회해주세요</p>
          <p className="text-xs mt-1">부동산원 당첨자 명단을 먼저 등록해야 합니다</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">당첨자</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">동호수</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">공급 유형</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">서류 검수</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">계약 의사</th>
                <th className="px-4 py-3 font-medium text-gray-600">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {winners.map((w) => {
                const reviewS = REVIEW_STATUS[w.doc_review_status] || REVIEW_STATUS.pending;
                const intentS = INTENT_STATUS[w.contract_intent] || INTENT_STATUS.pending;
                const ReviewIcon = reviewS.icon;
                const isLoading = actionLoading === w.id;

                return (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{w.customer?.name}</div>
                      <div className="text-xs text-gray-400">{w.customer?.phone} · 가점 {w.customer?.total_score}점</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-blue-700">{w.unit_number}</span>
                      <span className="text-xs text-gray-400 ml-1">{w.unit_type}</span>
                      {w.is_preliminary && <span className="ml-1 badge-review">예비</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{w.supply_type}</td>
                    <td className="px-4 py-3">
                      <span className={`${reviewS.cls} flex items-center gap-1 w-fit`}>
                        <ReviewIcon className="w-3 h-3" />
                        {reviewS.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={intentS.cls}>{intentS.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end flex-wrap">
                        {/* 검수 대기 상태에서 판정 실행 */}
                        {w.doc_review_status === "pending" && (
                          <button
                            onClick={() => runCheck(w.id)}
                            disabled={isLoading}
                            className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                          >
                            {isLoading ? "..." : "판정 실행"}
                          </button>
                        )}
                        {/* 적격이고 계약 의사 미확인 */}
                        {w.doc_review_status === "eligible" && w.contract_intent === "pending" && (
                          <>
                            <button onClick={() => updateIntent(w.id, "confirmed")} disabled={isLoading}
                              className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100 flex items-center gap-1">
                              <ThumbsUp className="w-3 h-3" /> 계약 의사 있음
                            </button>
                            <button onClick={() => updateIntent(w.id, "declined")} disabled={isLoading}
                              className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100 flex items-center gap-1">
                              <ThumbsDown className="w-3 h-3" /> 포기
                            </button>
                          </>
                        )}
                        {/* 계약 의사 확인됨 → 계약서 생성 */}
                        {w.contract_intent === "confirmed" && w.doc_review_status === "eligible" && (
                          <button onClick={() => generateContract(w.id)} disabled={isLoading}
                            className="text-xs px-2 py-1 bg-purple-50 text-purple-700 rounded hover:bg-purple-100">
                            {isLoading ? "..." : "계약서 생성"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
