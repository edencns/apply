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
import { ensureXlsx, parseHouseholdMembers } from "@/lib/winner-ingest";
import { toIdentity, sameIdentity } from "@/lib/identity";
import { ingestForStage, type WorkflowIngestResult } from "@/lib/workflow-ingest";
import { parseSeparatedExcel } from "@/lib/separated-ingest";
import { formatHousingCode } from "@/lib/housing-code";
import IndividualVerifyModal from "@/components/workflow/IndividualVerifyModal";
import {
  Users, AlertTriangle, FileSpreadsheet,
  Loader2, CheckCircle2, UserCheck, UserMinus,
} from "lucide-react";

const step = WORKFLOW_STEPS[1]; // household

const columns: StageColumn[] = [
  {
    key: "unit",
    header: "주택형",
    render: (c) => c.unit_type ? (
      <span className="font-medium text-sm">{formatHousingCode(c.unit_type)}</span>
    ) : <span className="text-ink-4 text-xs">—</span>,
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
      if (count === 0) return <span className="text-xs text-ink-4">미등록</span>;
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
      return <span className="text-xs text-ink-4">—</span>;
    },
  },
];

export default function HouseholdStepPage() {
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<WorkflowIngestResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<
    { ok: number; fail: number; missing: number } | null
  >(null);
  const [indivOpen, setIndivOpen] = useState(false);
  const xlsxRef = useRef<HTMLInputElement>(null);
  const separatedRef = useRef<HTMLInputElement>(null);
  const [uploadingSep, setUploadingSep] = useState(false);
  const [sepResult, setSepResult] = useState<{
    attached: number;
    unmatched: number;
    total: number;
  } | null>(null);

  const evaluate = (c: LocalCustomer) => evaluateHousehold(c);

  const handleFile = async (file: File) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    setUploading(true);
    setUploadResult(null);
    setVerifyResult(null);
    try {
      const r = await ingestForStage(file, selected, "household");
      setUploadResult(r);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "파일 처리 실패");
    } finally {
      setUploading(false);
      if (xlsxRef.current) xlsxRef.current.value = "";
    }
  };

  /** 개별 고객 파일 업로드 — 세대원내역 엑셀만 지원 */
  const handleIndividualUpload = async (c: LocalCustomer, file: File) => {
    try {
      const ext = file.name.toLowerCase().split(".").pop() || "";
      if (!["xlsx", "xls", "xlsm", "csv"].includes(ext)) {
        alert("세대원내역은 엑셀 파일만 지원합니다.");
        return;
      }
      const XLSX = await ensureXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const result = parseHouseholdMembers(wb as any, file.name);
      const records = result.householdMembers;
      if (records.length === 0) {
        alert("세대원내역을 찾지 못했습니다.");
        return;
      }

      const cIdent = toIdentity(c as any);
      const mine = records.filter((r) => {
        if (c.rrn_front && c.rrn_back && /^\d{13}$/.test(c.rrn_front + c.rrn_back)) {
          if (r.requesterRrn === c.rrn_front + c.rrn_back) return true;
        }
        return sameIdentity(
          toIdentity({ name: r.requesterName, rrn: r.requesterRrn }),
          cIdent,
        );
      });

      const source = mine.length > 0 ? mine : records;
      const members = source.map((m) => ({
        name: m.memberName || m.requesterName,
        rrn: m.memberRrn || undefined,
        errorCode: m.errorCode,
      }));
      localCustomers.update(c.id, { household_members: members });
      alert(`${c.name}: 세대원 ${members.length}명 저장됨`);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "파일 파싱 실패");
    }
  };

  /** 분리세대 명단 엑셀 업로드 */
  const handleSeparatedUpload = async (file: File) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    setUploadingSep(true);
    setSepResult(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseSeparatedExcel(buf);
      const customers = localCustomers.listByAnnouncement(selected.id);
      let attached = 0;
      let unmatched = 0;

      // 각 당첨자에게 분리세대원 정보 부착
      parsed.byWinnerRrn.forEach((rows, rrnFrontKey) => {
        const target = customers.find((c) => c.rrn_front === rrnFrontKey);
        if (!target) {
          unmatched++;
          return;
        }
        const members = rows.map((r: any) => ({
          name: r.memberName,
          rrn: r.memberRrn,
          relation: r.relation,
          note: r.note,
        }));
        localCustomers.update(target.id, {
          separated_household_members: members,
          separated_checked_at: new Date().toISOString(),
        });
        attached++;
      });

      // 분리세대원이 없는 것으로 확인된 나머지 고객들도 "확인 완료" 표시
      const checkedCustomerIds = new Set(
        Array.from(parsed.byWinnerRrn.keys())
          .map((f) => customers.find((c) => c.rrn_front === f)?.id)
          .filter(Boolean),
      );
      for (const c of customers) {
        if (checkedCustomerIds.has(c.id)) continue;
        if (c.superseded) continue;
        // 이미 분리세대 정보 있으면 건드리지 않음
        if (c.separated_checked_at) continue;
        localCustomers.update(c.id, {
          separated_household_members: [],
          separated_checked_at: new Date().toISOString(),
        });
      }

      setSepResult({ attached, unmatched, total: parsed.totalRows });
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "분리세대 파일 처리 실패");
    } finally {
      setUploadingSep(false);
      if (separatedRef.current) separatedRef.current.value = "";
    }
  };

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
              onClick={() => xlsxRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="당첨자세대원내역 엑셀 업로드"
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
              ) : (
                <><FileSpreadsheet className="w-4 h-4" /> 세대원내역 업로드</>
              )}
            </button>
            <input
              ref={xlsxRef}
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <button
              onClick={handleVerify}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm whitespace-nowrap transition-colors"
              title="현재 공고 고객 전원 세대원 검증"
            >
              <CheckCircle2 className="w-4 h-4" /> 검증
            </button>
            <button
              onClick={() => setIndivOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm whitespace-nowrap transition-colors"
              title="고객 한 명을 지정해 개별 파일 업로드"
            >
              <UserCheck className="w-4 h-4" /> 추가 검증
            </button>
            <button
              onClick={() => separatedRef.current?.click()}
              disabled={uploadingSep}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40"
              title="분리세대 명단 엑셀 업로드 (배우자 분리세대 등)"
            >
              {uploadingSep ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
              ) : (
                <><UserMinus className="w-4 h-4" /> 분리세대 명단</>
              )}
            </button>
            <input
              ref={separatedRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleSeparatedUpload(f);
              }}
            />
          </div>

          <IndividualVerifyModal
            open={indivOpen}
            onClose={() => setIndivOpen(false)}
            customers={localCustomers.listByAnnouncement(selected.id)}
            title="세대원 개별 검증"
            fileHint="한 명의 당첨자 세대원내역 파일만 올려 해당 고객에게 붙입니다."
            onApply={handleIndividualUpload}
          />

          {/* 업로드 결과 배너 */}
          {uploadResult && (
            <div className="card mb-4 p-3 text-sm bg-indigo-50/60 border-indigo-100">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-indigo-900">세대원내역 연결 완료</span>
                <span className="text-indigo-800">
                  {uploadResult.attached}명에게 세대원 정보 부착 · 총 {uploadResult.totalRecords}건
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

          {/* 분리세대 업로드 결과 */}
          {sepResult && (
            <div className="card mb-4 p-3 text-sm bg-amber-50/70 border-amber-200">
              <div className="flex items-center gap-2 flex-wrap">
                <UserMinus className="w-4 h-4 text-amber-800" />
                <span className="font-semibold text-amber-900">분리세대 명단 연결 완료</span>
                <span className="text-amber-800">
                  {sepResult.attached}명에게 분리세대원 정보 부착 · 총 {sepResult.total}건
                </span>
                {sepResult.unmatched > 0 && (
                  <span className="text-red-700">매칭 실패 {sepResult.unmatched}명</span>
                )}
              </div>
              <div className="mt-1 text-xs text-amber-800/80">
                💡 다음 단계(주택소유 조회)에서 분리세대 청약홈 회신 PDF를 업로드해 주세요.
              </div>
            </div>
          )}

          {/* 검증 결과 배너 */}
          {verifyResult && (
            <div className="card mb-4 p-3 text-sm bg-emerald-50/60 border-emerald-100">
              <span className="font-semibold text-emerald-900 mr-3">세대원 검증 결과</span>
              <span className="text-green-700 mr-3">통과 {verifyResult.ok}명</span>
              <span className="text-red-700 mr-3">부적합 {verifyResult.fail}명</span>
              <span className="text-ink-2">검증 필요 {verifyResult.missing}명</span>
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
