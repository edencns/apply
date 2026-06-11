"use client";

/**
 * 공고 룰 검증 패널 (Phase A)
 *
 * 판정 정확도에 가장 큰 영향을 주는 핵심 룰을 사용자가 검증·수정.
 *
 * 왜 필요한가:
 *   - 공고 PDF → Gemini로 eligibility_rules 추출 → 잘못 추출되면 그 공고 전체 판정이 어긋남
 *   - 예: household_head_required=true가 신혼부부에도 적용되면 곽미자 케이스처럼 잘못된 부적합
 *   - 사용자가 「이 룰 이 값이 맞나?」 사전 검증할 수 있어야 신뢰 가능
 *
 * 검증 대상 (가장 영향 큰 9가지):
 *   1. regulation — 투기과열/청약과열/비규제 (일반공급 1순위·1주택 가능 여부)
 *   2. announcement_base_date — 모든 날짜 계산 기준
 *   3. household_head_required — 세대주 필수 여부 (곽미자 케이스 원인)
 *   4. homeless_household_required — 무주택세대구성원 필수
 *   5. single_home_owner_rank1_allowed — 1주택자 1순위
 *   6. min_region_residence_months — 지역 우선공급 거주기간
 *   7. min_subscription_period — 청약통장 가입기간
 *   8. small_low_house_price_max_metro — 소형·저가 한도 (수도권)
 *   9. small_low_house_price_max_non_metro — 소형·저가 한도 (비수도권)
 *
 * 사용자가 수정한 필드는 `_user_overrides` 배열에 기록 → 추후 자동 재파싱 시
 * 사용자 검증 값을 덮어쓰지 않음.
 */

import { useState } from "react";
import { localAnnouncements, type LocalAnnouncement } from "@/lib/local-store";
import { ShieldCheck, Edit2, Save, X, AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";

interface Props {
  announcement: LocalAnnouncement;
  onUpdate?: (a: LocalAnnouncement) => void;
}

type FieldType = "boolean3" | "number" | "string" | "regulation" | "date";

interface CriticalField {
  key: string;
  label: string;
  type: FieldType;
  /** 왜 이 룰이 중요한지 한 줄 */
  why: string;
  /** 옵션 (boolean3·regulation에서 사용) */
  options?: Array<{ value: any; label: string }>;
  /** 입력 보조 (단위 등) */
  unit?: string;
  /** placeholder */
  placeholder?: string;
}

const CRITICAL_FIELDS: CriticalField[] = [
  {
    key: "regulation",
    label: "규제 지역 구분",
    type: "regulation",
    why: "일반공급 1순위·추첨제 기준에 영향. 특별공급 무주택 요건은 공급유형 기준을 별도로 우선 적용.",
    options: [
      { value: "투기과열", label: "투기과열지구" },
      { value: "청약과열", label: "청약과열지역" },
      { value: "비규제", label: "비규제지역" },
      { value: "", label: "(공고 미명시)" },
    ],
  },
  {
    key: "announcement_base_date",
    label: "공고 기준일",
    type: "date",
    why: "모든 자격 판정의 기준 시점. 무주택 기간·거주기간·연령 등 전체 계산의 출발점.",
    placeholder: "YYYY-MM-DD",
  },
  {
    key: "household_head_required",
    label: "세대주 필수 여부",
    type: "boolean3",
    why: "노부모부양 특공만 본인 세대주 필수. 잘못 true로 들어오면 신혼부부 등에 잘못된 부적합.",
    options: [
      { value: true, label: "필수" },
      { value: false, label: "무관" },
      { value: null, label: "공고 미명시" },
    ],
  },
  {
    key: "homeless_household_required",
    label: "무주택 세대구성원 필수",
    type: "boolean3",
    why: "특별공급은 보통 「세대 전원 무주택」. 일반공급은 1주택자도 가능(추첨제).",
    options: [
      { value: true, label: "필수" },
      { value: false, label: "무관" },
      { value: null, label: "공고 미명시" },
    ],
  },
  {
    key: "single_home_owner_rank1_allowed",
    label: "1주택자 1순위 가능",
    type: "boolean3",
    why: "비규제지역은 보통 가능. 투기과열·청약과열은 불가.",
    options: [
      { value: true, label: "가능" },
      { value: false, label: "불가" },
      { value: null, label: "공고 미명시" },
    ],
  },
  {
    key: "min_region_residence_months",
    label: "지역 우선 거주기간 (개월)",
    type: "number",
    why: "해당 지역에 N개월 이상 거주해야 우선공급 자격. 보통 1~2년 (12·24개월).",
    unit: "개월",
    placeholder: "예: 12, 24",
  },
  {
    key: "min_subscription_period",
    label: "청약통장 최소 가입 (개월)",
    type: "number",
    why: "투기/청약과열은 24개월·24회. 그 외는 12개월·12회 또는 6개월·6회.",
    unit: "개월",
    placeholder: "예: 6, 12, 24",
  },
  {
    key: "small_low_house_price_max_metro",
    label: "소형·저가 한도 (수도권)",
    type: "number",
    why: "수도권 60㎡ 이하 + 공고의 공시가격 한도 이하 보유 주택은 일반공급에서만 무주택 예외 후보.",
    unit: "원",
    placeholder: "160000000",
  },
  {
    key: "small_low_house_price_max_non_metro",
    label: "소형·저가 한도 (비수도권)",
    type: "number",
    why: "비수도권 60㎡ 이하 + 공고의 공시가격 한도 이하 보유 주택은 일반공급에서만 무주택 예외 후보.",
    unit: "원",
    placeholder: "100000000",
  },
];

function isSet(v: any): boolean {
  return v !== undefined && v !== null && v !== "";
}

function fmtMoney(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2).replace(/\.00$/, "")}억`;
  if (n >= 10_000) return `${Math.floor(n / 10_000)}만`;
  return String(n);
}

function fmtValue(field: CriticalField, value: any): { text: string; cls: string } {
  if (value === undefined || value === null || value === "") {
    return { text: "미지정", cls: "text-ink-4 italic" };
  }
  if (field.type === "boolean3") {
    const opt = field.options?.find((o) => o.value === value);
    return { text: opt?.label || String(value), cls: value === true ? "text-red-700 font-semibold" : value === false ? "text-emerald-700" : "text-ink-3" };
  }
  if (field.type === "regulation") {
    const cls = value === "투기과열" ? "text-red-700 font-bold"
      : value === "청약과열" ? "text-amber-700 font-semibold"
      : "text-emerald-700";
    return { text: String(value), cls };
  }
  if (field.type === "number" && field.unit === "원") {
    return { text: fmtMoney(Number(value)) + "원", cls: "text-ink-2 font-mono" };
  }
  if (field.type === "number") {
    return { text: String(value) + (field.unit ? ` ${field.unit}` : ""), cls: "text-ink-2 font-mono" };
  }
  return { text: String(value), cls: "text-ink-2" };
}

export default function RuleVerificationPanel({ announcement, onUpdate }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [open, setOpen] = useState(true);

  const rules = (announcement.eligibility_rules || {}) as Record<string, any>;
  const overrides: string[] = rules._user_overrides || [];

  const startEdit = (key: string) => {
    setEditing(key);
    setDraft(rules[key] ?? "");
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft(null);
  };

  const saveEdit = (field: CriticalField) => {
    let value = draft;
    if (field.type === "number") {
      const n = Number(String(value).replace(/[^\d.]/g, ""));
      value = Number.isFinite(n) && n > 0 ? n : null;
    }
    if (field.type === "boolean3" && typeof draft === "string") {
      if (draft === "true") value = true;
      else if (draft === "false") value = false;
      else value = null;
    }
    const nextRules = {
      ...rules,
      [field.key]: value,
      _user_overrides: Array.from(new Set([...overrides, field.key])),
      _user_verified_at: new Date().toISOString(),
    };
    localAnnouncements.update(announcement.id, {
      eligibility_rules: nextRules,
    });
    if (onUpdate) {
      const fresh = localAnnouncements.get(announcement.id);
      if (fresh) onUpdate(fresh);
    }
    setEditing(null);
    setDraft(null);
  };

  // 검증 진행 상황
  const setFields = CRITICAL_FIELDS.filter((f) => isSet(rules[f.key]));
  const verifiedFields = CRITICAL_FIELDS.filter((f) => overrides.includes(f.key));
  const missingFields = CRITICAL_FIELDS.filter((f) => !isSet(rules[f.key]) && !overrides.includes(f.key));

  return (
    <div className="mb-5 border-2 border-accent-line bg-accent-soft rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-surface2 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <span className="text-sm font-bold text-ink">
            🔍 핵심 룰 검증 (Phase A — 판정 정확도의 근원)
          </span>
          <span className="text-[10.5px] text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded font-semibold">
            ✓ 사용자 검증 {verifiedFields.length}
          </span>
          <span className="text-[10.5px] text-accent bg-accent-soft px-1.5 py-0.5 rounded font-medium">
            자동 추출 {setFields.length - verifiedFields.length}
          </span>
          {missingFields.length > 0 && (
            <span className="text-[10.5px] text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded font-semibold">
              ⚠ 미지정 {missingFields.length}
            </span>
          )}
        </div>
        <span className="text-[10px] text-accent">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          <div className="text-[10.5px] text-ink-3 leading-relaxed mb-2 px-1">
            아래 9개 룰은 모든 당첨자 판정에 직접 영향. 자동 추출 값을 검토하고 잘못된 부분은 「수정」 클릭. 검증된 값은 ✓ 마킹되어 추후 자동 재파싱 시 덮어쓰이지 않음.
          </div>

          {CRITICAL_FIELDS.map((field) => {
            const value = rules[field.key];
            const isOverridden = overrides.includes(field.key);
            const display = fmtValue(field, value);
            const isEditing = editing === field.key;

            return (
              <div
                key={field.key}
                className={`rounded-lg border p-2 ${
                  isOverridden
                    ? "bg-surface border-emerald-200"
                    : !isSet(value)
                      ? "bg-amber-50/60 border-amber-200"
                      : "bg-surface border-border"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 mt-0.5">
                    {isOverridden ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : !isSet(value) ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    ) : (
                      <HelpCircle className="w-3.5 h-3.5 text-accent" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-ink">{field.label}</span>
                      {isOverridden && (
                        <span className="text-[9.5px] bg-emerald-100 text-emerald-800 px-1 py-0 rounded font-semibold">
                          ✓ 검증됨
                        </span>
                      )}
                      {!isOverridden && !isSet(value) && (
                        <span className="text-[9.5px] bg-amber-100 text-amber-800 px-1 py-0 rounded">
                          미지정
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-ink-3 leading-snug mt-0.5">{field.why}</div>

                    {isEditing ? (
                      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                        {field.type === "boolean3" || field.type === "regulation" ? (
                          <select
                            value={String(draft)}
                            onChange={(e) => setDraft(e.target.value === "null" ? null : field.type === "regulation" ? e.target.value : e.target.value === "true" ? true : e.target.value === "false" ? false : null)}
                            className="text-[11px] px-1.5 py-1 rounded border border-border focus:outline-none focus:ring-1 focus:ring-accent"
                            autoFocus
                          >
                            {field.options?.map((o, i) => (
                              <option key={i} value={o.value === null ? "null" : String(o.value)}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : field.type === "date" ? (
                          <input
                            type="date"
                            value={draft || ""}
                            onChange={(e) => setDraft(e.target.value)}
                            className="text-[11px] px-1.5 py-1 rounded border border-border focus:outline-none focus:ring-1 focus:ring-accent"
                            autoFocus
                          />
                        ) : (
                          <input
                            type="text"
                            value={draft ?? ""}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder={field.placeholder}
                            className="text-[11px] px-1.5 py-1 rounded border border-border focus:outline-none focus:ring-1 focus:ring-accent w-40"
                            autoFocus
                          />
                        )}
                        <button
                          onClick={() => saveEdit(field)}
                          className="inline-flex items-center gap-0.5 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold"
                        >
                          <Save className="w-3 h-3" /> 저장
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="inline-flex items-center gap-0.5 px-2 py-1 rounded bg-surface2 hover:bg-surface2 text-ink-2 text-[10px]"
                        >
                          <X className="w-3 h-3" /> 취소
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`text-[12px] ${display.cls}`}>{display.text}</span>
                        <button
                          onClick={() => startEdit(field.key)}
                          className="inline-flex items-center gap-0.5 text-[10px] text-accent hover:underline"
                          title="이 값 수정"
                        >
                          <Edit2 className="w-2.5 h-2.5" /> 수정
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
