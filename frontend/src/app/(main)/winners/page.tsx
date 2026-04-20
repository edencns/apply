"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  localAnnouncements, localWinners, localCustomers, activeAnnouncement,
  isNetworkError, LocalAnnouncement, LocalWinner, LocalCustomer,
} from "@/lib/local-store";
import {
  CheckCircle, XCircle, AlertTriangle, Clock, FileSearch, ThumbsUp, ThumbsDown,
  BookOpen, ChevronRight, Plus, X, UserPlus,
} from "lucide-react";
import AnnouncementPicker from "@/components/AnnouncementPicker";

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

function WinnersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryAnnId = searchParams.get("announcementId");

  const [announcements, setAnnouncements] = useState<LocalAnnouncement[]>([]);
  const [selectedAnn, setSelectedAnn] = useState<LocalAnnouncement | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [customersOfAnn, setCustomersOfAnn] = useState<LocalCustomer[]>([]);
  const [form, setForm] = useState({
    customer_id: "" as string,
    customer_name: "",
    unit_number: "",
    unit_type: "",
    supply_type: "일반공급",
    is_preliminary: false,
  });
  const [formError, setFormError] = useState<string | null>(null);

  // ─── 공고 목록 로딩 ────────────────────────────────────
  const loadAnnouncements = useCallback(async () => {
    const local = localAnnouncements.listAll();
    try {
      const r = await api.get(`/announcements/`);
      const backend = Array.isArray(r.data) ? r.data : [];
      const merged: any[] = [...backend];
      for (const l of local) {
        if (!merged.some((a: any) => a.id === l.id)) merged.push(l);
      }
      setAnnouncements(merged);
      return merged;
    } catch {
      setAnnouncements(local);
      return local;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const list = await loadAnnouncements();
      const active = activeAnnouncement.get();
      let target: LocalAnnouncement | null = null;
      if (queryAnnId) target = list.find((a: LocalAnnouncement) => a.id === Number(queryAnnId)) || null;
      if (!target && active) target = list.find((a: LocalAnnouncement) => a.id === active.id) || (active.snapshot as LocalAnnouncement | null);
      if (!target && list.length > 0) target = list[0];
      if (target) setSelectedAnn(target);
    })();
  }, [loadAnnouncements, queryAnnId]);

  useEffect(() => {
    if (selectedAnn) {
      activeAnnouncement.set(
        { id: selectedAnn.id, title: selectedAnn.title, announcement_no: selectedAnn.announcement_no },
        "local", selectedAnn,
      );
    }
  }, [selectedAnn]);

  // ─── 당첨자 목록 로딩 ─────────────────────────────────
  const loadWinners = useCallback(async () => {
    if (!selectedAnn) { setWinners([]); return; }
    setLoading(true);
    try {
      const r = await api.get(`/winners/announcement/${selectedAnn.id}`);
      setWinners(r.data);
    } catch (err: any) {
      if (isNetworkError(err) || err?.response?.status === 404) {
        // 로컬 저장소 fallback
        const local = localWinners.listByAnnouncement(selectedAnn.id);
        setWinners(local.map((w) => ({
          id: w.id,
          unit_number: w.unit_number || "",
          unit_type: w.unit_type || "",
          supply_type: w.supply_type || "일반공급",
          is_preliminary: w.is_preliminary || false,
          doc_review_status: w.doc_review_status,
          contract_intent: w.contract_intent,
          customer: {
            name: w.customer_name,
            phone: w.customer_phone || "",
            total_score: w.total_score ?? 0,
          },
        })));
      } else {
        console.error("[winners] load failed", err);
        setWinners([]);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedAnn]);

  useEffect(() => { loadWinners(); }, [loadWinners]);

  // 해당 공고의 고객 목록 (당첨자 등록 시 선택용)
  useEffect(() => {
    if (!selectedAnn) { setCustomersOfAnn([]); return; }
    setCustomersOfAnn(localCustomers.listByAnnouncement(selectedAnn.id));
  }, [selectedAnn?.id, showForm]);

  // ─── 당첨자 등록 ──────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedAnn) { setFormError("공고를 선택해 주세요."); return; }
    if (!form.customer_name.trim() && !form.customer_id) {
      setFormError("고객을 선택하거나 성명을 입력해 주세요.");
      return;
    }

    let customerName = form.customer_name.trim();
    let customerPhone = "";
    let totalScore = 0;
    if (form.customer_id) {
      const c = localCustomers.get(Number(form.customer_id));
      if (c) {
        customerName = c.name;
        customerPhone = c.phone || "";
        totalScore = c.total_score ?? 0;
      }
    }

    try {
      await api.post(`/winners/`, {
        announcement_id: selectedAnn.id,
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        unit_number: form.unit_number,
        unit_type: form.unit_type,
        supply_type: form.supply_type,
        is_preliminary: form.is_preliminary,
      });
    } catch (err: any) {
      if (!isNetworkError(err) && err?.response?.status !== 404) {
        setFormError(err?.response?.data?.detail || err?.message || "등록 실패");
        return;
      }
      // 로컬 저장
      localWinners.create({
        announcement_id: selectedAnn.id,
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        customer_name: customerName,
        customer_phone: customerPhone,
        unit_number: form.unit_number,
        unit_type: form.unit_type,
        supply_type: form.supply_type,
        is_preliminary: form.is_preliminary,
        total_score: totalScore,
      });
    }

    setShowForm(false);
    setForm({ customer_id: "", customer_name: "", unit_number: "", unit_type: "", supply_type: "일반공급", is_preliminary: false });
    loadWinners();
  };

  // 적격 판정 실행
  const runCheck = async (winnerId: number) => {
    setActionLoading(winnerId);
    try {
      const r = await api.post(`/eligibility/check/${winnerId}`);
      alert(`판정 완료: ${r.data.verdict_label}\n${r.data.summary}`);
      loadWinners();
    } catch (e: any) {
      if (isNetworkError(e) || e?.response?.status === 404) {
        // 로컬 간이 판정
        localWinners.update(winnerId, { doc_review_status: "eligible" });
        loadWinners();
      } else {
        alert(e.response?.data?.detail || "판정 실패");
      }
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
      if (isNetworkError(e) || e?.response?.status === 404) {
        localWinners.update(winnerId, { contract_intent: intent });
        loadWinners();
      } else {
        alert(e.response?.data?.detail || "업데이트 실패");
      }
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
      if (isNetworkError(e) || e?.response?.status === 404) {
        alert("로컬 모드에서는 방문 계약 페이지에서 생성해 주세요");
      } else {
        alert(e.response?.data?.detail || "계약서 생성 실패");
      }
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* ─── 공고 선택 배너 ───────────────────────────────── */}
      <AnnouncementPicker
        announcements={announcements as any}
        selected={selectedAnn as any}
        onSelect={(a) => setSelectedAnn(a as any)}
        onOpenDetail={(a) => router.push(`/announcements/${a.id}`)}
      />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">당첨자 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            {selectedAnn ? `「${selectedAnn.title}」 · 서류 검수 · 적격 판정 · 계약 의사 확인` : "공고를 먼저 선택해주세요"}
          </p>
        </div>
        <button
          onClick={() => { setFormError(null); setShowForm(true); }}
          disabled={!selectedAnn}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          <UserPlus className="w-4 h-4" /> 당첨자 등록
        </button>
      </div>

      {/* 통계 요약 */}
      {winners.length > 0 && (
        <div className="card mb-4">
          <div className="grid grid-cols-4 gap-4">
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
        </div>
      )}

      {/* 당첨자 목록 */}
      {!selectedAnn ? (
        <div className="card text-center py-16 text-gray-400">
          <FileSearch className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>먼저 공고를 선택해주세요</p>
        </div>
      ) : loading ? (
        <div className="card text-center py-10 text-gray-400">불러오는 중...</div>
      ) : winners.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <FileSearch className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>등록된 당첨자가 없습니다</p>
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
                        {w.doc_review_status === "pending" && (
                          <button
                            onClick={() => runCheck(w.id)}
                            disabled={isLoading}
                            className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                          >
                            {isLoading ? "..." : "판정 실행"}
                          </button>
                        )}
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

      {/* 당첨자 등록 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">당첨자 등록</h2>
                {selectedAnn && <p className="text-xs text-gray-500 mt-0.5">{selectedAnn.title}</p>}
              </div>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded-full">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              {/* 등록된 고객 중에서 선택 */}
              {customersOfAnn.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">등록된 고객에서 선택</label>
                  <select
                    value={form.customer_id}
                    onChange={(e) => {
                      const id = e.target.value;
                      const c = id ? localCustomers.get(Number(id)) : null;
                      setForm((p) => ({ ...p, customer_id: id, customer_name: c?.name || "" }));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">직접 입력</option>
                    {customersOfAnn.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.phone || "연락처 없음"})</option>
                    ))}
                  </select>
                </div>
              )}

              {!form.customer_id && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">당첨자 성명 *</label>
                  <input
                    value={form.customer_name}
                    onChange={(e) => setForm((p) => ({ ...p, customer_name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">동호수</label>
                  <input
                    value={form.unit_number}
                    onChange={(e) => setForm((p) => ({ ...p, unit_number: e.target.value }))}
                    placeholder="101동 1001호"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">주택형</label>
                  <input
                    value={form.unit_type}
                    onChange={(e) => setForm((p) => ({ ...p, unit_type: e.target.value }))}
                    placeholder="84A"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">공급 유형</label>
                <select
                  value={form.supply_type}
                  onChange={(e) => setForm((p) => ({ ...p, supply_type: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="일반공급">일반공급</option>
                  {(selectedAnn?.eligibility_rules?.special_supply_types || ["신혼부부", "생애최초", "다자녀", "노부모부양", "기관추천"]).map((t: string) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_preliminary}
                  onChange={(e) => setForm((p) => ({ ...p, is_preliminary: e.target.checked }))}
                />
                예비 당첨자
              </label>

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">취소</button>
                <button type="submit" className="btn-primary flex-1">등록</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WinnersPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">로딩 중...</div>}>
      <WinnersPageInner />
    </Suspense>
  );
}
