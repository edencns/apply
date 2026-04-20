"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { customersApi } from "@/lib/api";
import {
  localCustomers,
  localAnnouncements,
  isNetworkError,
  LocalCustomer,
  LocalAnnouncement,
} from "@/lib/local-store";
import {
  ArrowLeft, User, Phone, MapPin, Calculator, Calendar, Loader2,
  AlertCircle, Trash2, Edit2, Save, X, CheckCircle2, Home, Baby,
  CreditCard, Landmark, BookOpen, ChevronRight,
} from "lucide-react";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  inquiry: { label: "문의", cls: "bg-amber-100 text-amber-700" },
  applied: { label: "청약 접수", cls: "bg-blue-100 text-blue-700" },
  winner: { label: "당첨", cls: "bg-purple-100 text-purple-700" },
  contracted: { label: "계약 완료", cls: "bg-green-100 text-green-700" },
};

function fmtRRN(front?: string, back?: string): string {
  if (!front) return "—";
  const masked = back ? `${back.slice(0, 1)}••••••` : "•••••••";
  return `${front}-${masked}`;
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  } catch { return String(s); }
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const customerId = Number(params?.id);

  const [customer, setCustomer] = useState<LocalCustomer | null>(null);
  const [announcement, setAnnouncement] = useState<LocalAnnouncement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<Partial<LocalCustomer>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!customerId || Number.isNaN(customerId)) {
      setError("잘못된 고객 ID입니다.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const r = await customersApi.get(customerId);
        if (!cancelled) {
          setCustomer(r.data);
          setForm(r.data);
          loadAnnouncement(r.data.announcement_id);
        }
      } catch (err: any) {
        const local = localCustomers.get(customerId);
        if (!cancelled) {
          if (local) {
            setCustomer(local);
            setForm(local);
            loadAnnouncement(local.announcement_id);
          } else {
            setError(
              isNetworkError(err)
                ? "해당 고객을 찾을 수 없습니다."
                : err?.response?.data?.detail || "고객 정보를 불러오지 못했습니다.",
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    function loadAnnouncement(annId: number) {
      const local = localAnnouncements.get(annId);
      if (local) setAnnouncement(local);
    }

    return () => { cancelled = true; };
  }, [customerId]);

  const handleSave = async () => {
    if (!customer) return;
    setSaving(true);
    try {
      const patch: Partial<LocalCustomer> = {
        name: form.name,
        phone: form.phone,
        address: form.address,
        no_home_years: Number(form.no_home_years) || 0,
        dependents_count: Number(form.dependents_count) || 0,
        subscription_months: Number(form.subscription_months) || 0,
        current_region: form.current_region,
        income_monthly: form.income_monthly || null,
        special_types: form.special_types || [],
      };
      const updated = localCustomers.update(customer.id, patch);
      if (updated) {
        setCustomer(updated);
        setEditMode(false);
      }
    } catch (err: any) {
      alert(err?.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!customer) return;
    if (!confirm(`${customer.name} 고객을 삭제하시겠습니까?`)) return;
    localCustomers.remove(customer.id);
    router.push("/customers");
  };

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="card text-center py-16 text-gray-400">
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-60" />
          <p>고객 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button onClick={() => router.push("/customers")} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> 목록으로 돌아가기
        </button>
        <div className="card text-center py-16">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-400" />
          <p className="text-gray-700 font-medium">{error || "고객을 찾을 수 없습니다"}</p>
        </div>
      </div>
    );
  }

  const status = STATUS_LABEL[customer.status || "inquiry"] || STATUS_LABEL.inquiry;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <a href="/customers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> 고객 목록
      </a>

      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{customer.name}</h1>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status.cls}`}>
              {status.label}
            </span>
            {customer.total_score !== undefined && customer.total_score > 0 && (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700">
                <Calculator className="w-3.5 h-3.5" /> {customer.total_score}점 / 84점
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
            <span>{fmtRRN(customer.rrn_front, customer.rrn_back)}</span>
            {customer.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" /> {customer.phone}
              </span>
            )}
            <span className="text-xs">등록일 {fmtDate(customer.created_at)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {editMode ? (
            <>
              <button
                onClick={() => { setEditMode(false); setForm(customer); }}
                disabled={saving}
                className="btn-secondary flex items-center gap-1.5 text-sm"
              >
                <X className="w-4 h-4" /> 취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-1.5 text-sm"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                저장
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditMode(true)} className="btn-secondary flex items-center gap-1.5 text-sm">
                <Edit2 className="w-4 h-4" /> 수정
              </button>
              <button onClick={handleDelete} className="btn-secondary flex items-center gap-1.5 text-sm text-red-600 hover:bg-red-50">
                <Trash2 className="w-4 h-4" /> 삭제
              </button>
            </>
          )}
        </div>
      </div>

      {/* 연결된 공고 */}
      {announcement && (
        <div
          onClick={() => router.push(`/announcements/${announcement.id}`)}
          className="card mb-5 cursor-pointer hover:border-blue-300 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-blue-600 font-medium mb-0.5">신청 공고</div>
              <p className="text-sm font-semibold text-gray-900 truncate">{announcement.title}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </div>
        </div>
      )}

      {/* 상세 정보 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 기본 정보 */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold text-gray-800">기본 정보</h2>
          </div>
          <div className="space-y-3 text-sm">
            <Field label="성명" value={form.name} editable={editMode}
              onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
            <Field label="연락처" value={form.phone} editable={editMode} placeholder="010-0000-0000"
              onChange={(v) => setForm((p) => ({ ...p, phone: v }))} />
            <StaticField label="주민번호" value={fmtRRN(customer.rrn_front, customer.rrn_back)} />
            <Field label="주소" value={form.address} editable={editMode}
              onChange={(v) => setForm((p) => ({ ...p, address: v }))} />
            <Field label="현재 거주 지역" value={form.current_region} editable={editMode} placeholder="예: 경기도"
              onChange={(v) => setForm((p) => ({ ...p, current_region: v }))} />
          </div>
        </div>

        {/* 청약 가점 정보 */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold text-gray-800">청약 가점</h2>
          </div>
          <div className="space-y-3 text-sm">
            <NumField label="무주택 기간 (년)" icon={Home} value={form.no_home_years ?? 0} editable={editMode}
              onChange={(v) => setForm((p) => ({ ...p, no_home_years: v }))} />
            <NumField label="부양가족 수" icon={Baby} value={form.dependents_count ?? 0} editable={editMode}
              onChange={(v) => setForm((p) => ({ ...p, dependents_count: v }))} />
            <NumField label="청약통장 가입 (개월)" icon={CreditCard} value={form.subscription_months ?? 0} editable={editMode}
              onChange={(v) => setForm((p) => ({ ...p, subscription_months: v }))} />
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">총 가점</span>
                <span className="font-bold text-lg text-blue-700">{customer.total_score ?? 0}<span className="text-xs text-gray-400 font-normal"> / 84점</span></span>
              </div>
            </div>
          </div>
        </div>

        {/* 소득 정보 */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Landmark className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold text-gray-800">소득·자산</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <label className="text-xs text-gray-500 block mb-1">월소득 (원)</label>
              {editMode ? (
                <input
                  type="number"
                  value={form.income_monthly ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, income_monthly: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <p className="font-medium">
                  {customer.income_monthly ? `${customer.income_monthly.toLocaleString("ko-KR")}원` : "—"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 특별공급 유형 */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold text-gray-800">특별공급 유형</h2>
          </div>
          {customer.special_types && customer.special_types.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {customer.special_types.map((t) => (
                <span key={t} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-1 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">해당 없음</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Sub components ──────────────────────────────────── */

function Field({
  label, value, editable, placeholder, onChange,
}: { label: string; value: any; editable: boolean; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {editable ? (
        <input
          type="text"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      ) : (
        <p className="font-medium text-gray-900">{value || "—"}</p>
      )}
    </div>
  );
}

function NumField({
  label, icon: Icon, value, editable, onChange,
}: { label: string; icon: typeof Home; value: number; editable: boolean; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3" /> {label}
      </label>
      {editable ? (
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      ) : (
        <p className="font-medium text-gray-900">{value}</p>
      )}
    </div>
  );
}

function StaticField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <p className="font-medium text-gray-900 font-mono text-xs">{value}</p>
    </div>
  );
}
