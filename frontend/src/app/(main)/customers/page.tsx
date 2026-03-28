"use client";

import { useState, useEffect, useCallback } from "react";
import { customersApi, sitesApi, eligibilityApi } from "@/lib/api";
import { UserPlus, Search, ChevronRight, Calculator } from "lucide-react";

interface Customer {
  id: number;
  name: string;
  phone: string;
  total_score: number;
  status: string;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  inquiry:    { label: "문의",    cls: "badge-pending" },
  applied:    { label: "청약 접수", cls: "badge-review" },
  winner:     { label: "당첨",    cls: "bg-purple-100 text-purple-700 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" },
  contracted: { label: "계약 완료", cls: "badge-eligible" },
};

export default function CustomersPage() {
  const [sites, setSites] = useState<any[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // 가점 계산기
  const [calcInput, setCalcInput] = useState({ no_home_years: 0, dependents_count: 0, subscription_months: 0 });
  const [calcResult, setCalcResult] = useState<any>(null);
  const [showCalc, setShowCalc] = useState(false);

  // 신규 고객 폼
  const [form, setForm] = useState({
    name: "", rrn_front: "", rrn_back: "", phone: "", address: "",
    no_home_years: 0, dependents_count: 0, subscription_months: 0,
    is_first_time_buyer: false, is_newlywed: false,
    current_region: "", income_monthly: "",
  });

  useEffect(() => {
    sitesApi.list().then((r) => {
      setSites(r.data);
      if (r.data.length > 0) setSiteId(r.data[0].id);
    }).catch(() => {});
  }, []);

  const loadCustomers = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const r = await customersApi.list(siteId);
      setCustomers(r.data);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteId) return;
    try {
      await customersApi.create({ ...form, site_id: siteId, income_monthly: form.income_monthly ? Number(form.income_monthly) : null });
      setShowForm(false);
      setForm({ name: "", rrn_front: "", rrn_back: "", phone: "", address: "", no_home_years: 0, dependents_count: 0, subscription_months: 0, is_first_time_buyer: false, is_newlywed: false, current_region: "", income_monthly: "" });
      loadCustomers();
    } catch (e: any) {
      alert(e.response?.data?.detail || "등록 실패");
    }
  };

  const handleCalc = async () => {
    const r = await eligibilityApi.calculateScore(calcInput);
    setCalcResult(r.data);
  };

  const filtered = customers.filter((c) =>
    c.name.includes(search) || c.phone?.includes(search)
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">고객 관리</h1>
          <p className="text-sm text-gray-500 mt-1">청약 신청자 등록 및 관리</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCalc(!showCalc)} className="btn-secondary flex items-center gap-2">
            <Calculator className="w-4 h-4" /> 가점 계산기
          </button>
          <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> 고객 등록
          </button>
        </div>
      </div>

      {/* 현장 선택 + 검색 */}
      <div className="flex gap-3 mb-4">
        <select
          value={siteId || ""}
          onChange={(e) => setSiteId(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 또는 연락처 검색"
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* 가점 계산기 패널 */}
      {showCalc && (
        <div className="card mb-4 bg-blue-50 border-blue-200">
          <h3 className="font-semibold text-blue-900 mb-3">청약 가점 계산기</h3>
          <div className="grid grid-cols-3 gap-4 mb-3">
            {[
              { key: "no_home_years", label: "무주택 기간 (년)", max: 15 },
              { key: "dependents_count", label: "부양가족 수 (명)", max: 6 },
              { key: "subscription_months", label: "청약통장 납입 (개월)", max: 200 },
            ].map(({ key, label, max }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-blue-800 mb-1">{label}</label>
                <input
                  type="number" min={0} max={max}
                  value={(calcInput as any)[key]}
                  onChange={(e) => setCalcInput((p) => ({ ...p, [key]: Number(e.target.value) }))}
                  className="w-full border border-blue-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleCalc} className="btn-primary text-sm px-4 py-1.5">계산하기</button>
            {calcResult && (
              <div className="flex gap-4 text-sm">
                <span>무주택 <strong>{calcResult["무주택_가점"]}점</strong></span>
                <span>부양가족 <strong>{calcResult["부양가족_가점"]}점</strong></span>
                <span>통장 <strong>{calcResult["청약통장_가점"]}점</strong></span>
                <span className="text-blue-700 font-bold text-base">총 {calcResult["총_가점"]}점 / 84점</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 고객 목록 */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">성명</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">연락처</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">청약 가점</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">상태</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-400">불러오는 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-400">등록된 고객이 없습니다</td></tr>
            ) : filtered.map((c) => {
              const s = STATUS_LABEL[c.status] || { label: c.status, cls: "badge-pending" };
              return (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.phone || "-"}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-blue-700">{c.total_score}점</span>
                    <span className="text-gray-400 text-xs ml-1">/ 84점</span>
                  </td>
                  <td className="px-4 py-3"><span className={s.cls}>{s.label}</span></td>
                  <td className="px-4 py-3 text-right">
                    <a href={`/customers/${c.id}`} className="text-blue-600 hover:underline flex items-center gap-1 justify-end">
                      상세 <ChevronRight className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 text-right">
            총 {filtered.length}명
          </div>
        )}
      </div>

      {/* 고객 등록 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold">신규 고객 등록</h2>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">성명 *</label>
                  <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                  <input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="010-0000-0000"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">주민번호 앞 6자리 *</label>
                  <input required maxLength={6} value={form.rrn_front} onChange={(e) => setForm((p) => ({ ...p, rrn_front: e.target.value.replace(/\D/g,"") }))}
                    placeholder="800101"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">주민번호 뒷 7자리 *</label>
                  <input required type="password" maxLength={7} value={form.rrn_back} onChange={(e) => setForm((p) => ({ ...p, rrn_back: e.target.value.replace(/\D/g,"") }))}
                    placeholder="•••••••"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">주소</label>
                <input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">무주택 기간 (년)</label>
                  <input type="number" min={0} value={form.no_home_years} onChange={(e) => setForm((p) => ({ ...p, no_home_years: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">부양가족 수</label>
                  <input type="number" min={0} value={form.dependents_count} onChange={(e) => setForm((p) => ({ ...p, dependents_count: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">통장 납입 (개월)</label>
                  <input type="number" min={0} value={form.subscription_months} onChange={(e) => setForm((p) => ({ ...p, subscription_months: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.is_first_time_buyer} onChange={(e) => setForm((p) => ({ ...p, is_first_time_buyer: e.target.checked }))} />
                  생애최초
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.is_newlywed} onChange={(e) => setForm((p) => ({ ...p, is_newlywed: e.target.checked }))} />
                  신혼부부
                </label>
              </div>
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
