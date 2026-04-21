"use client";

import { useState } from "react";
import WorkflowShell, { WORKFLOW_STEPS } from "@/components/workflow/WorkflowShell";
import StageCustomerList, { StageColumn } from "@/components/workflow/StageCustomerList";
import { evaluateProperty, isResidentialUse } from "@/lib/verification-rules";
import type { LocalAnnouncement, LocalCustomer } from "@/lib/local-store";
import { Home, AlertTriangle } from "lucide-react";

const step = WORKFLOW_STEPS[2]; // property

const columns: StageColumn[] = [
  {
    key: "unit",
    header: "주택형",
    render: (c) => c.unit_type ? (
      <span className="font-mono text-xs">{c.unit_type}</span>
    ) : <span className="text-gray-400 text-xs">—</span>,
  },
  {
    key: "current",
    header: "현재 보유",
    render: (c) => {
      const props = c.properties || [];
      if (props.length === 0) return <span className="text-xs text-gray-400">미조회</span>;
      const current = props.filter((p) => !p.transferredDate && isResidentialUse(p.usage));
      if (current.length === 0) return <span className="text-xs text-green-700">무주택</span>;
      return (
        <span className="inline-flex items-center gap-1 text-sm text-amber-700">
          <Home className="w-3.5 h-3.5" />
          <strong>{current.length}</strong>건
        </span>
      );
    },
  },
  {
    key: "history",
    header: "양도 이력",
    render: (c) => {
      const props = c.properties || [];
      const past = props.filter((p) => p.transferredDate).length;
      return past > 0 ? (
        <span className="text-xs text-gray-600">{past}건</span>
      ) : <span className="text-xs text-gray-400">—</span>;
    },
  },
  {
    key: "verdict",
    header: "판정",
    render: (c, v) => {
      if (v.missing) return <span className="text-xs text-gray-400">미검증</span>;
      if (!v.ok) {
        return (
          <span className="inline-flex items-center gap-1 text-xs text-red-700">
            <AlertTriangle className="w-3 h-3" />
            {v.reasons[0]?.slice(0, 30) || "부적합"}
          </span>
        );
      }
      if (v.warnings.length > 0) {
        return <span className="text-xs text-amber-700">경고: {v.warnings[0]?.slice(0, 25)}</span>;
      }
      return <span className="text-xs text-green-700">무주택 적격</span>;
    },
  },
];

export default function PropertyStepPage() {
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);

  const evaluate = (c: LocalCustomer, a: LocalAnnouncement) => evaluateProperty(c, a);

  const regulation = (selected?.eligibility_rules?.regulation as string) || undefined;

  return (
    <WorkflowShell step={step} selected={selected} onSelect={setSelected}>
      {selected && (
        <>
          {regulation && (
            <div className="mb-3 p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-xs text-indigo-800">
              <strong>공고 규제: {regulation}</strong> ·{" "}
              {regulation === "투기과열" || regulation === "청약과열"
                ? "주택 1건도 보유 시 부적합"
                : "2주택 이상 부적합, 1주택은 가점 감점 경고"}
            </div>
          )}
          <StageCustomerList
            announcement={selected}
            evaluate={evaluate}
            columns={columns}
            stageNumber={3}
          />
        </>
      )}
    </WorkflowShell>
  );
}
