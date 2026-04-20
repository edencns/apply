"use client";

/**
 * 청약 당첨자 검증 5단계 스텝퍼
 *
 * ① 등록 → ② 세대원 → ③ 주택소유 → ④ 청약통장 → ⑤ 서류·판정
 *
 * 각 단계의 상태 아이콘:
 *   done (녹색 ✓)      : 단계 완료
 *   warn (주황 ⚠)      : 검토 필요 (주택 보유, 오류코드 등)
 *   fail (빨강 ✗)      : 부적합
 *   missing (회색 ○)   : 데이터 없음 / 아직 안 함
 */

import type { LocalCustomer } from "@/lib/local-store";
import {
  CheckCircle2, AlertTriangle, XCircle, Circle, UserCheck, Users, Home, Banknote, FileText,
} from "lucide-react";

type StepState = "done" | "warn" | "fail" | "missing";

interface StepInfo {
  key: string;
  label: string;
  icon: typeof UserCheck;
  state: StepState;
  detail: string;
}

/**
 * 주거용 용도 판별 — 주택소유 레코드 기준
 * 아파트·다세대·연립·단독주택·오피스텔 등은 주거용
 */
function isResidentialUse(usage?: string): boolean {
  if (!usage) return true; // 용도 미상이면 보수적으로 주거용 간주
  const s = usage.trim();
  // 명시적 비주거만 제외
  if (/토지|임야|전|답|상가|사무실|공장|창고/.test(s)) return false;
  return true;
}

/** 고객 데이터로 5단계 상태 계산 */
export function computeVerificationSteps(customer: LocalCustomer): StepInfo[] {
  // ① 등록
  const registered: StepInfo = {
    key: "registered",
    label: "당첨자 등록",
    icon: UserCheck,
    state: "done",
    detail: `${customer.name}${customer.unit_type ? ` · ${customer.unit_type}` : ""}`,
  };

  // ② 세대원
  const members = customer.household_members || [];
  const memberIssues = members.filter((m) => m.errorCode);
  const household: StepInfo = {
    key: "household",
    label: "세대원 확인",
    icon: Users,
    state:
      members.length === 0
        ? "missing"
        : memberIssues.length > 0
          ? "warn"
          : "done",
    detail:
      members.length === 0
        ? "미등록"
        : memberIssues.length > 0
          ? `${members.length}명 · 오류 ${memberIssues.length}건`
          : `${members.length}명`,
  };

  // ③ 주택소유
  const properties = customer.properties || [];
  const currentResidential = properties.filter((p) => !p.transferredDate && isResidentialUse(p.usage));
  const property: StepInfo = {
    key: "property",
    label: "주택소유 조회",
    icon: Home,
    state:
      properties.length === 0
        ? "missing"
        : currentResidential.length === 0
          ? "done"
          : "warn",
    detail:
      properties.length === 0
        ? "미조회"
        : currentResidential.length === 0
          ? "무주택"
          : `보유 ${currentResidential.length}건`,
  };

  // ④ 청약통장
  const savings = customer.savings_priority;
  const bank: StepInfo = {
    key: "savings",
    label: "청약통장",
    icon: Banknote,
    state: !savings ? "missing" : savings.verified ? "done" : "fail",
    detail: !savings
      ? "미검증"
      : savings.verified
        ? "검증완료"
        : (savings.errorNote || "오류"),
  };

  // ⑤ 서류 제출 + 최종 판정
  const docs = customer.documents_submitted || {};
  const submittedCount = Object.values(docs).filter(Boolean).length;
  const totalExpected = Object.keys(docs).length;
  const verdict = customer.verification_verdict;
  const docState: StepState =
    verdict === "eligible"
      ? "done"
      : verdict === "ineligible"
        ? "fail"
        : totalExpected === 0
          ? "missing"
          : submittedCount === totalExpected
            ? "done"
            : "warn";
  const docs_step: StepInfo = {
    key: "docs",
    label: "서류·판정",
    icon: FileText,
    state: docState,
    detail:
      verdict === "eligible"
        ? `적합${customer.verification_score ? ` · ${customer.verification_score}점` : ""}`
        : verdict === "ineligible"
          ? "부적합"
          : totalExpected === 0
            ? "미검수"
            : `${submittedCount}/${totalExpected}`,
  };

  return [registered, household, property, bank, docs_step];
}

/* ─── UI ─────────────────────────────────────────────── */

const STATE_CLS: Record<StepState, { icon: typeof CheckCircle2; iconCls: string; ring: string; labelCls: string }> = {
  done:    { icon: CheckCircle2,   iconCls: "text-green-600",  ring: "ring-green-200 bg-green-50",    labelCls: "text-green-900" },
  warn:    { icon: AlertTriangle,  iconCls: "text-amber-500",  ring: "ring-amber-200 bg-amber-50",    labelCls: "text-amber-900" },
  fail:    { icon: XCircle,        iconCls: "text-red-600",    ring: "ring-red-200 bg-red-50",        labelCls: "text-red-900" },
  missing: { icon: Circle,         iconCls: "text-gray-300",   ring: "ring-gray-200 bg-gray-50",      labelCls: "text-gray-500" },
};

export function VerificationSteps({ customer }: { customer: LocalCustomer }) {
  const steps = computeVerificationSteps(customer);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1 mb-3">
        <h3 className="text-sm font-semibold text-gray-800">검증 진행 단계</h3>
        <span className="text-xs text-gray-400">— 당첨자 → 계약까지의 흐름</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {steps.map((step, i) => {
          const meta = STATE_CLS[step.state];
          const StateIcon = meta.icon;
          const StepIcon = step.icon;
          return (
            <div
              key={step.key}
              className={`relative rounded-lg p-3 ring-1 ${meta.ring} transition-colors`}
            >
              {/* 번호 + 단계 아이콘 */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-mono text-gray-400">0{i + 1}</span>
                <StepIcon className="w-3.5 h-3.5 text-gray-500" />
              </div>
              {/* 라벨 + 상태 */}
              <div className="flex items-start justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${meta.labelCls}`}>
                    {step.label}
                  </p>
                  <p className="text-[11px] text-gray-600 mt-0.5 truncate" title={step.detail}>
                    {step.detail}
                  </p>
                </div>
                <StateIcon className={`w-4 h-4 flex-shrink-0 ${meta.iconCls}`} />
              </div>
              {/* 단계 간 연결선 */}
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-1.5 w-3 h-0.5 bg-gray-200 -translate-y-1/2 z-10" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VerificationSteps;
