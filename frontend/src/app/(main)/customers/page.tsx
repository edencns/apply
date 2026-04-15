"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { customersApi, sitesApi, eligibilityApi } from "@/lib/api";
import { ActiveAnnouncementBanner } from "@/components/ActiveAnnouncementBanner";
import { UserPlus, Search, ChevronRight, Calculator, FileSpreadsheet, Loader2, Download } from "lucide-react";

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

  // 엑셀 업로드
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [excelUploading, setExcelUploading] = useState(false);
  const [excelResult, setExcelResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);

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

  /** 엑셀 템플릿 다운로드 — xlsx 라이브러리를 lazy-load */
  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet([
      {
        성명: "홍길동",
        연락처: "010-1234-5678",
        주민번호앞: "800101",
        주민번호뒤: "1234567",
        주소: "서울 강남구 역삼동",
        무주택기간_년: 10,
        부양가족수: 2,
        통장개월: 120,
        생애최초: "N",
        신혼부부: "N",
        월소득_원: 5000000,
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "고객등록");
    XLSX.writeFile(wb, "고객등록_템플릿.xlsx");
  };

  /** 엑셀 일괄 등록 — 컬럼명은 한글/영문 모두 허용, xlsx lazy-load */
  const handleExcelUpload = async (file: File) => {
    if (!siteId) { alert("현장을 먼저 선택해주세요"); return; }
    setExcelUploading(true);
    setExcelResult(null);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

      // 컬럼명 정규화 — 한글/영문 둘 다 허용
      const pick = (row: Record<string, any>, ...keys: string[]): any => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== "") return row[k];
        }
        return undefined;
      };
      const toBool = (v: any): boolean => {
        if (typeof v === "boolean") return v;
        const s = String(v).trim().toLowerCase();
        return s === "y" || s === "yes" || s === "true" || s === "1" || s === "예" || s === "o" || s === "해당";
      };
      const toNum = (v: any): number => {
        if (v === undefined || v === "" || v === null) return 0;
        const n = Number(String(v).replace(/[^\d.-]/g, ""));
        return Number.isFinite(n) ? n : 0;
      };
      const toStr = (v: any): string => (v === undefined || v === null ? "" : String(v).trim());

      let success = 0, failed = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const name = toStr(pick(row, "성명", "이름", "name"));
          if (!name) { failed++; errors.push(`${i + 2}행: 성명 누락`); continue; }
          const rrnFront = toStr(pick(row, "주민번호앞", "주민번호 앞", "rrn_front")).replace(/\D/g, "").slice(0, 6);
          const rrnBack = toStr(pick(row, "주민번호뒤", "주민번호 뒤", "rrn_back")).replace(/\D/g, "").slice(0, 7);
          if (!rrnFront || !rrnBack) { failed++; errors.push(`${i + 2}행(${name}): 주민번호 누락`); continue; }

          const payload = {
            site_id: siteId,
            name,
            phone: toStr(pick(row, "연락처", "전화", "phone")),
            rrn_front: rrnFront,
            rrn_back: rrnBack,
            address: toStr(pick(row, "주소", "address")),
            no_home_years: toNum(pick(row, "무주택기간_년", "무주택년", "무주택기간", "no_home_years")),
            dependents_count: toNum(pick(row, "부양가족수", "부양가족", "dependents_count")),
            subscription_months: toNum(pick(row, "통장개월", "청약통장개월", "가입기간", "subscription_months")),
            is_first_time_buyer: toBool(pick(row, "생애최초", "is_first_time_buyer")),
            is_newlywed: toBool(pick(row, "신혼부부", "is_newlywed")),
            current_region: toStr(pick(row, "지역", "current_region")),
            income_monthly: (() => {
              const n = toNum(pick(row, "월소득_원", "월소득", "소득", "income_monthly"));
              return n > 0 ? n : null;
            })(),
          };
          await customersApi.create(payload as any);
          success++;
        } catch (err: any) {
          failed++;
          const msg = err?.response?.data?.detail || err?.message || "등록 실패";
          const name = String(pick(row, "성명", "이름", "name") || "(이름없음)");
          errors.push(`${i + 2}행(${name}): ${msg}`);
        }
      }

      setExcelResult({ success, failed, errors: errors.slice(0, 10) });
      if (success > 0) loadCustomers();
    } catch (err: any) {
      alert(err?.message || "엑셀 파일 파싱 실패");
    } finally {
      setExcelUploading(false);
      if (excelInputRef.current) excelInputRef.current.value = "";
    }
  };

  const filtered = customers.filter((c) =>
    c.name.includes(search) || c.phone?.includes(search)
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <ActiveAnnouncementBanner />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">고객 관리</h1>
          <p className="text-sm text-gray-500 mt-1">청약 신청자 등록 및 관리</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCalc(!showCalc)} className="btn-secondary flex items-center gap-2">
            <Calculator className="w-4 h-4" /> 가점 계산기
          </button>
          <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-2" title="엑셀 템플릿 다운로드">
            <Download className="w-4 h-4" /> 템플릿
          </button>
          <button
            onClick={() => excelInputRef.current?.click()}
            disabled={excelUploading}
            className="btn-secondary flex items-center gap-2"
          >
            {excelUploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 등록 중…</>
            ) : (
              <><FileSpreadsheet className="w-4 h-4" /> 엑셀 업로드</>
            )}
          </button>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleExcelUpload(f);
            }}
          />
          <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> 고객 등록
          </button>
        </div>
      </div>

      {/* 엑셀 업로드 결과 */}
      {excelResult && (
        <div className={`card mb-4 ${excelResult.failed === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-800">
                엑셀 일괄 등록 결과
              </div>
              <div className="mt-1 text-sm text-gray-700">
                성공 <strong className="text-green-700">{excelResult.success}건</strong>
                {excelResult.failed > 0 && <> · 실패 <strong className="text-red-700">{excelResult.failed}건</strong></>}
              </div>
              {excelResult.errors.length > 0 && (
                <ul className="mt-2 text-xs text-red-700 space-y-0.5 list-disc list-inside">
                  {excelResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  {excelResult.failed > excelResult.errors.length && (
                    <li className="text-gray-500">…외 {excelResult.failed - excelResult.errors.length}건 더</li>
                  )}
                </ul>
              )}
            </div>
            <button onClick={() => setExcelResult(null)} className="text-gray-400 hover:text-gray-600 text-sm">×</button>
          </div>
        </div>
      )}

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
