"use client";

/**
 * 고객 상세 페이지 좌측 세로 5단계 탭
 *
 * - 현재 선택된 단계와 각 단계의 상태(ok/warn/fail/missing)를 시각화
 * - 단계 아이템 클릭 시 `onSelect`로 상위에 전달
 */

import { StageKey } from "./stage-utils";
import type { FinalVerdict } from "@/lib/verification-rules";
import type { LocalCustomer } from "@/lib/local-store";
import {
  UserCheck, Users, Home, Banknote, FileText,
  CheckCircle2, AlertTriangle, XCircle, Circle,
  UserX, ArrowUpCircle,
} from "lucide-react";

const STAGES: Array<{
  key: StageKey;
  label: string;
  icon: typeof UserCheck;
  field: keyof FinalVerdict["stages"];
}> = [
  { key: "registration", label: "당첨자 등록",   icon: UserCheck, field: "registration" },
  { key: "household",    label: "세대원 확인",   icon: Users,     field: "household" },
  { key: "property",     label: "주택소유 조회", icon: Home,      field: "property" },
  { key: "savings",      label: "청약통장 순위", icon: Banknote,  field: "savings" },
  { key: "documents",    label: "서류·판정",     icon: FileText,  field: "documents" },
];

function stateIcon(v: FinalVerdict["stages"][keyof FinalVerdict["stages"]]) {
  if (v.missing) return { Icon: Circle, cls: "text-gray-300" };
  if (v.ok && v.warnings.length > 0) return { Icon: AlertTriangle, cls: "text-amber-500" };
  if (v.ok) return { Icon: CheckCircle2, cls: "text-green-600" };
  return { Icon: XCircle, cls: "text-red-600" };
}

export default function StageSidebar({
  current,
  finalVerdict,
  onSelect,
  customer,
}: {
  current: StageKey;
  finalVerdict: FinalVerdict;
  onSelect: (k: StageKey) => void;
  customer?: LocalCustomer;
}) {
  const isSuperseded = customer?.superseded === true;
  const isSucceededFrom = customer?.succeeded_from != null;
  const isStandby = customer?.is_standby === true;

  return (
    <nav className="card p-2 sticky top-4">
      {/* 상단 — 승계 상태 배너 */}
      {isSuperseded && (
        <div className="mb-2 px-3 py-2 rounded-lg bg-gray-100 border border-gray-200 flex items-start gap-2">
          <UserX className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-gray-700">포기·승계 완료</div>
            <div className="text-[10px] text-gray-500 mt-0.5 truncate">
              {customer?.supersede_reason || "부적합 판정"}
            </div>
          </div>
        </div>
      )}
      {isSucceededFrom && !isSuperseded && (
        <div className="mb-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2">
          <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-emerald-800">예비 승계됨</div>
            <div className="text-[10px] text-emerald-600 mt-0.5">원 당첨자 자리 인수</div>
          </div>
        </div>
      )}
      {isStandby && !isSucceededFrom && !isSuperseded && (
        <div className="mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
          <ArrowUpCircle className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-amber-800">
              예비 {customer?.standby_rank || ""}순위
            </div>
            <div className="text-[10px] text-amber-600 mt-0.5">당첨자 결격 시 승계 대기</div>
          </div>
        </div>
      )}

      <div className="px-3 py-2 mb-1">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">진행 단계</div>
      </div>
      <ul className="space-y-0.5">
        {STAGES.map((s, i) => {
          const v = finalVerdict.stages[s.field];
          // 승계 완료(포기) 상태면 모든 단계를 회색으로 표시
          const { Icon: StateIcon, cls } = isSuperseded
            ? { Icon: Circle, cls: "text-gray-300" }
            : stateIcon(v);
          const StepIcon = s.icon;
          const active = current === s.key;
          return (
            <li key={s.key}>
              <button
                onClick={() => onSelect(s.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                  active
                    ? "bg-blue-50 text-blue-900 ring-1 ring-blue-200"
                    : "hover:bg-gray-50 text-gray-700"
                } ${isSuperseded ? "opacity-60" : ""}`}
              >
                <span className={`text-[10px] font-mono w-4 ${active ? "text-blue-600" : "text-gray-400"}`}>
                  0{i + 1}
                </span>
                <StepIcon className={`w-4 h-4 flex-shrink-0 ${active ? "text-blue-700" : "text-gray-500"}`} />
                <span className="flex-1 font-medium">{s.label}</span>
                <StateIcon className={`w-4 h-4 ${cls}`} />
              </button>
            </li>
          );
        })}
      </ul>

      {/* 하단 — 최종 판정 카드 */}
      <div className={`mt-3 px-3 py-3 rounded-lg border ${
        isSuperseded
          ? "bg-gray-100 border-gray-200"
          : "bg-gray-50 border-gray-100"
      }`}>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1">최종 판정</div>
        {isSuperseded ? (
          <div>
            <div className="text-sm font-bold text-gray-700 flex items-center gap-1">
              <UserX className="w-3.5 h-3.5" /> 포기
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">자리 승계됨</div>
          </div>
        ) : finalVerdict.verdict === "eligible" ? (
          <div className="text-sm font-bold text-green-700">
            적합
            {isSucceededFrom && (
              <span className="ml-1 text-[10px] font-normal text-emerald-700">(승계)</span>
            )}
          </div>
        ) : finalVerdict.verdict === "ineligible" ? (
          <div>
            <div className="text-sm font-bold text-red-700">부적합</div>
            <div className="text-[10px] text-red-600 mt-0.5">사유 {finalVerdict.reasons.length}건</div>
          </div>
        ) : (
          <div>
            <div className="text-sm font-bold text-gray-700">판정 보류</div>
            <div className="text-[10px] text-gray-500 mt-0.5">데이터 수집 중</div>
          </div>
        )}
      </div>
    </nav>
  );
}
