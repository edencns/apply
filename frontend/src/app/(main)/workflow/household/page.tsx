"use client";

import { useRef, useState } from "react";
import WorkflowShell, { WORKFLOW_STEPS } from "@/components/workflow/WorkflowShell";
import StageCustomerList, { StageColumn } from "@/components/workflow/StageCustomerList";
import { evaluateHousehold } from "@/lib/verification-rules";
import {
  localCustomers,
  type LocalAnnouncement,
  type LocalCustomer,
} from "@/lib/local-store";
import { parseHouseholdMembers, ensureXlsx, type HouseholdMemberRecord } from "@/lib/winner-ingest";
import { toIdentity, sameIdentity } from "@/lib/identity";
import { Users, AlertTriangle, Upload, Loader2, CheckCircle2 } from "lucide-react";

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

interface UploadResult {
  attached: number;      // 세대원 연결된 당첨자 수
  unmatched: number;     // 매칭 실패한 요청자 수
  totalMembers: number;  // 총 세대원 레코드 수
  errors: string[];
}

export default function HouseholdStepPage() {
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<
    { ok: number; fail: number; missing: number } | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const evaluate = (c: LocalCustomer) => evaluateHousehold(c);

  /** 세대원내역 엑셀 업로드 → 각 당첨자에 세대원 정보 연결 */
  const handleUpload = async (file: File) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    setUploading(true);
    setUploadResult(null);
    setVerifyResult(null);
    try {
      const XLSX = await ensureXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const result = parseHouseholdMembers(wb as any, file.name);
      const records = result.householdMembers;
      if (records.length === 0) {
        alert("세대원내역을 찾지 못했습니다. '당첨자세대원내역' 양식인지 확인해 주세요.");
        return;
      }

      // 요청자 RRN 기준으로 그룹핑
      const grouped = new Map<string, HouseholdMemberRecord[]>();
      for (const r of records) {
        const key = r.requesterRrn || `${r.requesterName}__nofront`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(r);
      }

      const customers = localCustomers.listByAnnouncement(selected.id);
      let attached = 0;
      let unmatched = 0;
      const errors: string[] = [];

      grouped.forEach((group) => {
        const first = group[0];
        // 요청자 identity 후보
        const reqIdent = toIdentity({
          name: first.requesterName,
          rrn: first.requesterRrn && /^\d{13}$/.test(first.requesterRrn) ? first.requesterRrn : undefined,
        });

        // 고객 매칭 — 13자리 RRN 우선, 없으면 identity 퍼지 매칭
        let target: LocalCustomer | undefined;
        if (first.requesterRrn && /^\d{13}$/.test(first.requesterRrn)) {
          const front = first.requesterRrn.slice(0, 6);
          const back = first.requesterRrn.slice(6);
          target = customers.find(
            (c) => c.rrn_front === front && c.rrn_back === back,
          );
        }
        if (!target) {
          for (const c of customers) {
            if (sameIdentity(reqIdent, toIdentity(c as any))) {
              target = c;
              break;
            }
          }
        }

        if (!target) {
          unmatched++;
          errors.push(`${first.requesterName}: 등록된 당첨자와 매칭 실패`);
          return;
        }

        const members = group.map((m) => ({
          name: m.memberName || first.requesterName,
          rrn: m.memberRrn || undefined,
          errorCode: m.errorCode,
        }));
        try {
          localCustomers.update(target.id, { household_members: members });
          attached++;
        } catch (e: any) {
          errors.push(`${first.requesterName}: 저장 실패 (${e?.message || ""})`);
        }
      });

      setUploadResult({
        attached,
        unmatched,
        totalMembers: records.length,
        errors: errors.slice(0, 10),
      });
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "세대원내역 파싱 실패");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** 현재 공고 고객 전원 재검증 → 요약 표시 */
  const handleVerify = () => {
    if (!selected) return;
    const customers = localCustomers
      .listByAnnouncement(selected.id)
      .filter((c) => !c.superseded);
    let ok = 0, fail = 0, missing = 0;
    for (const c of customers) {
      const v = evaluateHousehold(c);
      if (v.missing) missing++;
      else if (v.ok) ok++;
      else fail++;
    }
    setVerifyResult({ ok, fail, missing });
    setReloadKey((k) => k + 1);
  };

  return (
    <WorkflowShell step={step} selected={selected} onSelect={setSelected}>
      {selected && (
        <>
          {/* 툴바 */}
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 shadow-sm whitespace-nowrap transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="당첨자세대원내역.xlsx 업로드"
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
              ) : (
                <><Upload className="w-4 h-4" /> 업로드</>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
            />
            <button
              onClick={handleVerify}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm whitespace-nowrap transition-colors"
              title="현재 공고 고객 전원 세대원 검증"
            >
              <CheckCircle2 className="w-4 h-4" /> 검증
            </button>
          </div>

          {/* 업로드 결과 배너 */}
          {uploadResult && (
            <div className="card mb-4 p-3 text-sm bg-indigo-50/60 border-indigo-100">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-indigo-900">세대원내역 연결 완료</span>
                <span className="text-indigo-800">
                  {uploadResult.attached}명에게 세대원 정보 부착 · 총 {uploadResult.totalMembers}건
                </span>
                {uploadResult.unmatched > 0 && (
                  <span className="text-red-700">매칭 실패 {uploadResult.unmatched}명</span>
                )}
              </div>
              {uploadResult.errors.length > 0 && (
                <ul className="mt-2 text-xs text-red-700 list-disc list-inside space-y-0.5">
                  {uploadResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* 검증 결과 배너 */}
          {verifyResult && (
            <div className="card mb-4 p-3 text-sm bg-emerald-50/60 border-emerald-100">
              <span className="font-semibold text-emerald-900 mr-3">세대원 검증 결과</span>
              <span className="text-green-700 mr-3">통과 {verifyResult.ok}명</span>
              <span className="text-red-700 mr-3">부적합 {verifyResult.fail}명</span>
              <span className="text-gray-600">미검증 {verifyResult.missing}명</span>
            </div>
          )}

          <StageCustomerList
            key={reloadKey}
            announcement={selected}
            evaluate={evaluate}
            columns={columns}
            stageNumber={2}
          />
        </>
      )}
    </WorkflowShell>
  );
}
