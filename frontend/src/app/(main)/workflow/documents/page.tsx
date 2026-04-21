"use client";

import { useRef, useState } from "react";
import WorkflowShell, { WORKFLOW_STEPS } from "@/components/workflow/WorkflowShell";
import StageCustomerList, { StageColumn } from "@/components/workflow/StageCustomerList";
import { evaluateFinal } from "@/lib/verification-rules";
import { COMMON_DOCUMENTS, SUPPLY_TYPE_DOCUMENTS } from "@/lib/document-checklist";
import type { LocalAnnouncement, LocalCustomer } from "@/lib/local-store";
import { ingestAutoStage, stageLabel, type WorkflowIngestResult } from "@/lib/workflow-ingest";
import {
  CheckCircle2, XCircle, Clock, FileText, FileSpreadsheet, Loader2,
} from "lucide-react";

const step = WORKFLOW_STEPS[4]; // documents

function computeDocList(
  c: LocalCustomer,
  a: LocalAnnouncement,
): Array<{ name: string; category: string; conditional: boolean }> {
  const supplyType = c.supply_type || c.special_types?.[0] || "일반공급";
  const parsedDocs: Record<string, string[]> = a.eligibility_rules?.required_documents || {};
  const items: Array<{ name: string; category: string; conditional: boolean }> = [];
  const common = (parsedDocs["공통"] && parsedDocs["공통"].length >= 3) ? parsedDocs["공통"] : COMMON_DOCUMENTS;
  for (const doc of common) {
    items.push({ name: doc, category: "공통", conditional: /해당\s*시|해당자/.test(doc) });
  }
  const typeDocs = (parsedDocs[supplyType] && parsedDocs[supplyType].length >= 2)
    ? parsedDocs[supplyType]
    : (SUPPLY_TYPE_DOCUMENTS[supplyType] || SUPPLY_TYPE_DOCUMENTS["일반공급"] || []);
  for (const doc of typeDocs) {
    if (items.some((it) => it.name === doc)) continue;
    items.push({ name: doc, category: supplyType, conditional: /해당\s*시|해당자|임신|기혼자/.test(doc) });
  }
  return items;
}

const columns: StageColumn[] = [
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
    key: "progress",
    header: "서류 진행률",
    render: (c) => {
      const submitted = c.documents_submitted || {};
      const count = Object.values(submitted).filter(Boolean).length;
      const total = Object.keys(submitted).length;
      if (total === 0) return <span className="text-xs text-gray-400">—</span>;
      const pct = Math.round((count / total) * 100);
      return (
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full ${pct === 100 ? "bg-green-500" : "bg-blue-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-gray-600 whitespace-nowrap">{count}/{total}</span>
        </div>
      );
    },
  },
  {
    key: "score",
    header: "가점",
    render: (c) => {
      if (!c.total_score) return <span className="text-xs text-gray-400">—</span>;
      return (
        <span className="text-sm">
          <strong className="text-blue-700">{c.total_score}</strong>
          <span className="text-gray-400 text-[10px]">/84</span>
        </span>
      );
    },
  },
  {
    key: "verdict",
    header: "최종 판정",
    render: (c) => {
      const v = c.verification_verdict;
      if (v === "eligible") {
        return (
          <span className="inline-flex items-center gap-1 text-sm text-green-700 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" /> 적합
          </span>
        );
      }
      if (v === "ineligible") {
        return (
          <span className="inline-flex items-center gap-1 text-sm text-red-700 font-semibold">
            <XCircle className="w-3.5 h-3.5" /> 부적합
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <Clock className="w-3 h-3" /> 미검수
        </span>
      );
    },
  },
];

export default function DocumentsStepPage() {
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<WorkflowIngestResult | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const xlsxRef = useRef<HTMLInputElement>(null);

  const evaluate = (c: LocalCustomer, a: LocalAnnouncement) => {
    const docList = computeDocList(c, a);
    const submitted = c.documents_submitted || {};
    const final = evaluateFinal(c, a, submitted, docList);
    return final.stages.documents;
  };

  const handleFile = async (file: File) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    setUploading(true);
    setUploadResult(null);
    try {
      const r = await ingestAutoStage(file, selected);
      setUploadResult(r);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "파일 처리 실패");
    } finally {
      setUploading(false);
      if (pdfRef.current) pdfRef.current.value = "";
      if (xlsxRef.current) xlsxRef.current.value = "";
    }
  };

  return (
    <WorkflowShell step={step} selected={selected} onSelect={setSelected}>
      {selected && (
        <>
          <div className="mb-3 p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-xs text-indigo-800 flex items-start gap-2">
            <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              이 단계는 공급유형별 필수 서류 + 2·3·4단계 검증 결과를 종합해 <strong>멀티팩터 적합 판정</strong>을 내립니다.
              부적합 시 같은 주택형의 예비에서 승계 가능합니다.
            </span>
          </div>

          {/* 업로드 툴바 — 세대원/주택/통장 어느 쪽 파일이든 자동 판별해서 반영 */}
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <button
              onClick={() => pdfRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
              ) : (
                <><FileText className="w-4 h-4" /> PDF 업로드</>
              )}
            </button>
            <input
              ref={pdfRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <button
              onClick={() => xlsxRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
              ) : (
                <><FileSpreadsheet className="w-4 h-4" /> 엑셀 업로드</>
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
            <span className="text-[11px] text-gray-500 ml-2">
              * 세대원/주택/통장 어느 쪽이든 자동 인식하여 반영
            </span>
          </div>

          {uploadResult && (
            <div className="card mb-4 p-3 text-sm bg-indigo-50/60 border-indigo-100">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-indigo-900">
                  {stageLabel(uploadResult.stage)} 데이터 반영 완료
                </span>
                <span className="text-indigo-800">
                  {uploadResult.attached}명 · 총 {uploadResult.totalRecords}건
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

          <StageCustomerList
            key={reloadKey}
            announcement={selected}
            evaluate={evaluate}
            columns={columns}
            stageNumber={5}
          />
        </>
      )}
    </WorkflowShell>
  );
}
