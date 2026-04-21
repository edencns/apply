"use client";

import { useState } from "react";
import WorkflowShell, { WORKFLOW_STEPS } from "@/components/workflow/WorkflowShell";
import StageCustomerList, { StageColumn } from "@/components/workflow/StageCustomerList";
import { evaluateHousehold } from "@/lib/verification-rules";
import type { LocalAnnouncement, LocalCustomer } from "@/lib/local-store";
import { Users, AlertTriangle } from "lucide-react";

const step = WORKFLOW_STEPS[1]; // household

const columns: StageColumn[] = [
  {
    key: "unit",
    header: "주택형",
    render: (c) => c.unit_type ? (
      <span className="font-mono text-xs">{c.unit_type}</span>
    ) : <span className="text-gray-400 text-xs">—</span>,
  },
  {
    key: "supply",
    header: "공급유형",
    render: (c) => {
      const supply = c.supply_type || "—";
      const cls = supply === "일반공급" ? "bg-indigo-50 text-indigo-700" : "bg-purple-50 text-purple-700";
      return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>{supply}</span>;
    },
  },
  {
    key: "members",
    header: "세대원",
    render: (c) => {
      const count = c.household_members?.length ?? 0;
      if (count === 0) return <span className="text-xs text-gray-400">미등록</span>;
      return (
        <span className="inline-flex items-center gap-1 text-sm">
          <Users className="w-3.5 h-3.5 text-amber-600" />
          <strong>{count}</strong>명
        </span>
      );
    },
  },
  {
    key: "errors",
    header: "오류 코드",
    render: (c) => {
      const issues = (c.household_members || []).filter((m) => m.errorCode);
      if (issues.length === 0 && (c.household_members?.length ?? 0) > 0) {
        return <span className="text-xs text-green-700">정상</span>;
      }
      if (issues.length > 0) {
        return (
          <span className="inline-flex items-center gap-1 text-xs text-red-700">
            <AlertTriangle className="w-3 h-3" /> {issues.length}건
          </span>
        );
      }
      return <span className="text-xs text-gray-400">—</span>;
    },
  },
];

export default function HouseholdStepPage() {
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);

  const evaluate = (c: LocalCustomer) => evaluateHousehold(c);

  return (
    <WorkflowShell step={step} selected={selected} onSelect={setSelected}>
      {selected && (
        <StageCustomerList
          announcement={selected}
          evaluate={evaluate}
          columns={columns}
          stageNumber={2}
        />
      )}
    </WorkflowShell>
  );
}
