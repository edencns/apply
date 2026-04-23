"use client";

import { useRef, useState } from "react";
import WorkflowShell, { WORKFLOW_STEPS } from "@/components/workflow/WorkflowShell";
import StageCustomerList, { StageColumn } from "@/components/workflow/StageCustomerList";
import { evaluateProperty, isResidentialUse } from "@/lib/verification-rules";
import {
  localCustomers,
  type LocalAnnouncement,
  type LocalCustomer,
} from "@/lib/local-store";
import { parsePropertyOwnership, ensureXlsx } from "@/lib/winner-ingest";
import { ingestForStage, type WorkflowIngestResult } from "@/lib/workflow-ingest";
import { formatHousingCode } from "@/lib/housing-code";
import IndividualVerifyModal from "@/components/workflow/IndividualVerifyModal";
import {
  Home, AlertTriangle, FileSpreadsheet,
  Loader2, CheckCircle2, UserCheck,
} from "lucide-react";

const step = WORKFLOW_STEPS[2]; // property

const columns: StageColumn[] = [
  {
    key: "unit",
    header: "주택형",
    render: (c) => c.unit_type ? (
      <span className="font-medium text-sm">{formatHousingCode(c.unit_type)}</span>
    ) : <span className="text-ink-4 text-xs">—</span>,
  },
  {
    key: "current",
    header: "현재 보유",
    render: (c) => {
      const props = c.properties || [];
      if (props.length === 0) {
        if (c.property_checked_at) return <span className="text-xs text-green-700">보유 없음</span>;
        return <span className="text-xs text-ink-4">조회 불가</span>;
      }
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
        <span className="text-xs text-ink-2">{past}건</span>
      ) : <span className="text-xs text-ink-4">—</span>;
    },
  },
  {
    key: "verdict",
    header: "판정",
    render: (c, v) => {
      if (v.missing) return <span className="text-xs text-ink-4">검증 필요</span>;
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
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<WorkflowIngestResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<
    { ok: number; fail: number; warn: number; missing: number } | null
  >(null);
  const [indivOpen, setIndivOpen] = useState(false);
  const xlsxRef = useRef<HTMLInputElement>(null);

  const evaluate = (c: LocalCustomer, a: LocalAnnouncement) => evaluateProperty(c, a);
  const regulation = (selected?.eligibility_rules?.regulation as string) || undefined;

  const handleFile = async (file: File) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    setUploading(true);
    setUploadResult(null);
    setVerifyResult(null);
    try {
      const r = await ingestForStage(file, selected, "property");
      setUploadResult(r);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "파일 처리 실패");
    } finally {
      setUploading(false);
      if (xlsxRef.current) xlsxRef.current.value = "";
    }
  };

  const handleIndividualUpload = async (c: LocalCustomer, file: File) => {
    try {
      const ext = file.name.toLowerCase().split(".").pop() || "";
      if (!["xlsx", "xls", "xlsm", "csv"].includes(ext)) {
        alert("주택소유 전산검색은 엑셀 파일만 지원합니다.");
        return;
      }
      const XLSX = await ensureXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const result = parsePropertyOwnership(wb as any, file.name);
      const records = result.properties;

      const ownRrn = c.rrn_front && c.rrn_back ? c.rrn_front + c.rrn_back : "";
      const memberRrns = (c.household_members || [])
        .map((m) => m.rrn || "")
        .filter((r) => /^\d{13}$/.test(r));
      const targetRrns = new Set<string>([ownRrn, ...memberRrns].filter(Boolean));

      let mine = records.filter((r) => targetRrns.has(r.ownerRrn));
      if (mine.length === 0 && records.length > 0) mine = records;

      const seen = new Set<string>();
      const uniq = mine.filter((p) => {
        const k = `${p.ownerRrn}|${p.address}|${p.acquiredDate || ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      localCustomers.update(c.id, {
        properties: uniq.map((p) => ({
          ownerRrn: p.ownerRrn,
          ownerName: p.ownerName,
          address: p.address,
          areaM2: p.areaM2,
          acquiredDate: p.acquiredDate,
          transferredDate: p.transferredDate,
          usage: p.usage,
        })),
        property_checked_at: new Date().toISOString(),
      });
      alert(`${c.name}: 소유 레코드 ${uniq.length}건 저장됨`);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "파일 파싱 실패");
    }
  };

  const handleVerify = () => {
    if (!selected) return;
    const customers = localCustomers
      .listByAnnouncement(selected.id)
      .filter((c) => !c.superseded);
    let ok = 0, fail = 0, warn = 0, missing = 0;
    for (const c of customers) {
      const v = evaluateProperty(c, selected);
      if (v.missing) missing++;
      else if (!v.ok) fail++;
      else if (v.warnings.length > 0) warn++;
      else ok++;
    }
    setVerifyResult({ ok, fail, warn, missing });
    setReloadKey((k) => k + 1);
  };

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

          {/* 툴바 */}
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <button
              onClick={() => xlsxRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="주택소유정보 전산검색 엑셀 업로드"
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
              ) : (
                <><FileSpreadsheet className="w-4 h-4" /> 주택소유 조회 업로드</>
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
            >
              <CheckCircle2 className="w-4 h-4" /> 검증
            </button>
            <button
              onClick={() => setIndivOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm whitespace-nowrap transition-colors"
            >
              <UserCheck className="w-4 h-4" /> 추가 검증
            </button>
          </div>

          <IndividualVerifyModal
            open={indivOpen}
            onClose={() => setIndivOpen(false)}
            customers={localCustomers.listByAnnouncement(selected.id)}
            title="주택소유 개별 검증"
            fileHint="한 명의 주택소유 전산검색 결과 파일만 올려 해당 고객에게 붙입니다."
            onApply={handleIndividualUpload}
          />

          {/* 업로드 결과 */}
          {uploadResult && (
            <div className="card mb-4 p-3 text-sm bg-indigo-50/60 border-indigo-100">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-indigo-900">주택소유 조회 연결 완료</span>
                <span className="text-indigo-800">
                  {uploadResult.attached}명에게 소유 이력 부착 · 총 {uploadResult.totalRecords}건
                </span>
                {uploadResult.unmatched > 0 && (
                  <span className="text-red-700">매칭 실패 {uploadResult.unmatched}건</span>
                )}
              </div>
              {uploadResult.errors.length > 0 && (
                <ul className="mt-2 text-xs text-red-700 list-disc list-inside space-y-0.5">
                  {uploadResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* 검증 결과 */}
          {verifyResult && (
            <div className="card mb-4 p-3 text-sm bg-emerald-50/60 border-emerald-100">
              <span className="font-semibold text-emerald-900 mr-3">주택소유 검증 결과</span>
              <span className="text-green-700 mr-3">무주택 적격 {verifyResult.ok}명</span>
              <span className="text-amber-700 mr-3">경고 {verifyResult.warn}명</span>
              <span className="text-red-700 mr-3">부적합 {verifyResult.fail}명</span>
              <span className="text-ink-2">검증 필요 {verifyResult.missing}명</span>
            </div>
          )}

          <StageCustomerList
            key={reloadKey}
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
