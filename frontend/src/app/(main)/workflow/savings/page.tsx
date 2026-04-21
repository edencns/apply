"use client";

import { useState } from "react";
import WorkflowShell, { WORKFLOW_STEPS } from "@/components/workflow/WorkflowShell";
import StageCustomerList, { StageColumn } from "@/components/workflow/StageCustomerList";
import { evaluateSavings } from "@/lib/verification-rules";
import type { LocalAnnouncement, LocalCustomer } from "@/lib/local-store";
import { Banknote, AlertTriangle, CheckCircle2 } from "lucide-react";

const step = WORKFLOW_STEPS[3]; // savings

const BANK_MAP: Record<string, string> = {
  "003": "기업", "004": "국민", "007": "수협", "011": "농협", "020": "우리",
  "023": "SC", "027": "씨티", "031": "아이엠뱅크", "032": "부산", "034": "광주",
  "035": "제주", "037": "전북", "039": "경남", "081": "KEB하나", "088": "신한",
};

const columns: StageColumn[] = [
  {
    key: "bank",
    header: "은행",
    render: (c) => {
      const code = c.savings_priority?.bankCode;
      if (!code) return <span className="text-xs text-gray-400">—</span>;
      return <span className="text-sm">{BANK_MAP[code] || code}</span>;
    },
  },
  {
    key: "result",
    header: "순위확인 결과",
    render: (c) => {
      const s = c.savings_priority;
      if (!s) return <span className="text-xs text-gray-400">조회 불가</span>;
      if (s.verified) {
        return (
          <span className="inline-flex items-center gap-1 text-sm text-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            70) 검증완료
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 text-sm text-red-700">
          <AlertTriangle className="w-3.5 h-3.5" />
          {s.resultLength ? `${s.resultLength}) 오류` : "오류"}
        </span>
      );
    },
  },
  {
    key: "months",
    header: "고객 가입기간",
    render: (c) => {
      const m = c.subscription_months ?? 0;
      return m > 0 ? (
        <span className="text-sm">{m}개월</span>
      ) : <span className="text-xs text-gray-400">0개월</span>;
    },
  },
  {
    key: "verdict",
    header: "판정",
    render: (c, v) => {
      if (v.missing) return <span className="text-xs text-gray-400">검증 필요</span>;
      if (!v.ok) {
        return (
          <span className="inline-flex items-center gap-1 text-xs text-red-700">
            <AlertTriangle className="w-3 h-3" />
            {v.reasons[0]?.slice(0, 30) || "부적합"}
          </span>
        );
      }
      return <span className="text-xs text-green-700">통과</span>;
    },
  },
];

export default function SavingsStepPage() {
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);
  const evaluate = (c: LocalCustomer, a: LocalAnnouncement) => evaluateSavings(c, a);
  const minMonths = selected?.eligibility_rules?.min_subscription_period as number | undefined;

  return (
    <WorkflowShell step={step} selected={selected} onSelect={setSelected}>
      {selected && (
        <>
          {typeof minMonths === "number" && minMonths > 0 && (
            <div className="mb-3 p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-xs text-indigo-800 flex items-center gap-2">
              <Banknote className="w-3.5 h-3.5" />
              <span>
                <strong>공고 최소 가입기간: {minMonths}개월</strong> — 고객 가입기간이 이보다 적으면 부적합
              </span>
            </div>
          )}
          <StageCustomerList
            announcement={selected}
            evaluate={evaluate}
            columns={columns}
            stageNumber={4}
          />
        </>
      )}
    </WorkflowShell>
  );
}
