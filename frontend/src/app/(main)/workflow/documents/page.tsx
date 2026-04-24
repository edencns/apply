"use client";

import { useRef, useState } from "react";
import WorkflowShell, { WORKFLOW_STEPS } from "@/components/workflow/WorkflowShell";
import StageCustomerList, { StageColumn } from "@/components/workflow/StageCustomerList";
import { evaluateFinal } from "@/lib/verification-rules";
import { COMMON_DOCUMENTS, SUPPLY_TYPE_DOCUMENTS } from "@/lib/document-checklist";
import { localCustomers, type LocalAnnouncement, type LocalCustomer } from "@/lib/local-store";
import { ingestAutoStage, stageLabel, type WorkflowIngestResult } from "@/lib/workflow-ingest";
import {
  CheckCircle2, XCircle, Clock, FileText, FileSpreadsheet, Loader2, Gavel,
  FolderUp, ShieldCheck,
} from "lucide-react";

const step = WORKFLOW_STEPS[4]; // documents

function computeDocList(
  c: LocalCustomer,
  a: LocalAnnouncement,
): Array<{ name: string; category: string; conditional: boolean }> {
  const supplyType = c.supply_type || c.special_types?.[0] || "일반공급";
  const parsedDocs: Record<string, string[]> = a.eligibility_rules?.required_documents || {};
  const items: Array<{ name: string; category: string; conditional: boolean }> = [];

  // "서류 묶음(통합)" — 배치 업로드 시 자동으로 첨부되는 슬롯. 공통 최상단.
  items.push({ name: "서류 묶음(통합)", category: "공통", conditional: false });

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
      if (total === 0) return <span className="text-xs text-ink-4">—</span>;
      const pct = Math.round((count / total) * 100);
      return (
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className={`h-full ${pct === 100 ? "bg-green-500" : "bg-accent"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-ink-2 whitespace-nowrap">{count}/{total}</span>
        </div>
      );
    },
  },
  {
    key: "score",
    header: "가점",
    render: (c) => {
      if (!c.total_score) return <span className="text-xs text-ink-4">—</span>;
      return (
        <span className="text-sm">
          <strong className="text-accent">{c.total_score}</strong>
          <span className="text-ink-4 text-[10px]">/84</span>
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
        <span className="inline-flex items-center gap-1 text-xs text-ink-3">
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
  const [verifyResult, setVerifyResult] = useState<
    { eligible: number; ineligible: number; pending: number } | null
  >(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const xlsxRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLInputElement>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    attached: number;
    unmatched: number;
    total: number;
    errors: string[];
  } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ eligible: number } | null>(null);

  const evaluate = (c: LocalCustomer, a: LocalAnnouncement) => {
    const docList = computeDocList(c, a);
    const submitted = c.documents_submitted || {};
    const final = evaluateFinal(c, a, submitted, docList);
    return final.stages.documents;
  };

  /** 최종 검증: 공고 고객 전원에 대해 evaluateFinal 실행 → 적합/부적합 판정 저장 */
  const handleFinalVerify = () => {
    if (!selected) return;
    const customers = localCustomers
      .listByAnnouncement(selected.id)
      .filter((c) => !c.superseded);
    let eligible = 0, ineligible = 0, pending = 0;
    for (const c of customers) {
      const docList = computeDocList(c, selected);
      const submitted = c.documents_submitted || {};
      const final = evaluateFinal(c, selected, submitted, docList);
      const verdict = final.verdict;
      if (verdict === "eligible") eligible++;
      else if (verdict === "ineligible") ineligible++;
      else pending++;
      try {
        localCustomers.update(c.id, {
          verification_verdict: verdict,
          verification_reasons: final.reasons || [],
          verification_checked_at: new Date().toISOString(),
        });
      } catch {}
    }
    setVerifyResult({ eligible, ineligible, pending });
    setReloadKey((k) => k + 1);
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

  /** 서류 스캔본 배치 업로드 — 파일명 "동-호수 이름.pdf" 매칭 후 각 당첨자의 "서류 묶음" 슬롯에 저장 */
  const handleBatchDocs = async (files: FileList | null) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    if (!files || files.length === 0) return;
    setBatchBusy(true);
    setBatchResult(null);
    try {
      const customers = localCustomers.listByAnnouncement(selected.id);
      let attached = 0, unmatched = 0;
      const errors: string[] = [];
      const total = files.length;

      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".pdf")) continue;
        const base = file.name.replace(/\.pdf$/i, "").trim();
        // "101-1401 김성진" 또는 "101-1401_김성진" 또는 "101-1401"
        const m = base.match(/^(\d{2,4})[-_\s]+(\d{1,5})(?:[\s_-]+(.*))?$/);
        if (!m) {
          unmatched++;
          errors.push(`${file.name}: 파일명 형식 불일치 (예: "101-1401 김성진.pdf")`);
          continue;
        }
        const [, dong, ho, nameHint] = m;

        const target = customers.find((c) => {
          const cd = String((c as any).unit_dong || "").trim();
          const ch = String((c as any).unit_ho || "").trim();
          return cd === dong && ch === ho;
        });
        if (!target) {
          unmatched++;
          errors.push(`${file.name}: ${dong}-${ho} 당첨자 없음`);
          continue;
        }
        if (nameHint && target.name && !nameHint.trim().includes(target.name) && !target.name.includes(nameHint.trim())) {
          console.warn(`[batch-docs] ${file.name}: 이름 불일치(${nameHint} vs ${target.name})`);
        }

        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("kind", "other");
          fd.append("announcement_id", String(selected.id));
          const res = await fetch("/api/files/upload", { method: "POST", body: fd });
          if (!res.ok) throw new Error(`업로드 실패 ${res.status}`);
          const json = await res.json();

          const existing = target.document_files || {};
          const nextFiles = {
            ...existing,
            "서류 묶음(통합)": {
              url: json.url,
              filename: file.name,
              uploadedAt: new Date().toISOString(),
            },
          };
          // 체크리스트 "서류 묶음(통합)"도 자동 체크
          const submittedNow = target.documents_submitted || {};
          localCustomers.update(target.id, {
            document_files: nextFiles,
            documents_submitted: { ...submittedNow, "서류 묶음(통합)": true },
          } as any);
          attached++;
        } catch (err: any) {
          errors.push(`${file.name}: ${err?.message || "오류"}`);
          unmatched++;
        }
      }

      setBatchResult({ attached, unmatched, total, errors });
      setReloadKey((k) => k + 1);
    } finally {
      setBatchBusy(false);
      if (batchRef.current) batchRef.current.value = "";
    }
  };

  /** 일괄 적합 판정 — 서류 묶음이 첨부된(또는 "모두 제출 완료") 당첨자를 한 번에 "적합"으로 */
  const handleBulkApprove = () => {
    if (!selected) return;
    const customers = localCustomers
      .listByAnnouncement(selected.id)
      .filter((c) => !c.superseded);

    // 대상: 서류 묶음 첨부되었거나, 체크리스트 100% 체크된 사람
    const candidates = customers.filter((c) => {
      const hasBundle = !!c.document_files?.["서류 묶음(통합)"];
      if (hasBundle) return true;
      const docList = computeDocList(c, selected);
      const sub = c.documents_submitted || {};
      const required = docList.filter((d) => !d.conditional);
      if (required.length === 0) return false;
      return required.every((d) => sub[d.name]);
    });

    if (candidates.length === 0) {
      alert("일괄 적합 대상이 없습니다. (서류 묶음 배치 업로드 또는 체크리스트 완료 상태가 필요)");
      return;
    }
    if (!confirm(`${candidates.length}명을 일괄 "적합" 처리하시겠습니까?\n\n(2·3단계 자동 판정은 유지되며, 여기서는 "서류 판정"만 적합으로 마킹됩니다.)`)) return;

    setBulkBusy(true);
    try {
      let eligible = 0;
      for (const c of candidates) {
        localCustomers.update(c.id, {
          verification_verdict: "eligible",
          verification_reasons: [],
          verification_checked_at: new Date().toISOString(),
        });
        eligible++;
      }
      setBulkResult({ eligible });
      setReloadKey((k) => k + 1);
    } finally {
      setBulkBusy(false);
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

          {/* Phase #5 — 면책 디스클레이머 */}
          <div className="mb-4 p-3 rounded-lg bg-red-50 border-2 border-red-300 text-xs text-red-900 flex items-start gap-2">
            <span className="text-base leading-none flex-shrink-0">⚠️</span>
            <div>
              <div className="font-bold mb-1">이 판정은 참고용 자동 로직 결과입니다.</div>
              <div>
                최종 적합·부적합은 담당자가 <strong>공고 원문과 법령을 직접 확인 후 결정</strong>하세요.
                시스템은 데이터 수집·규칙 기반 1차 판정·경계 케이스 플래그를 제공할 뿐이며,
                법령 해석·서류 진위·개인 상황별 판단의 책임은 담당자에게 있습니다.
                청약 관련 정책·규정은 수시로 개정되므로 최신 청약홈 공지(1644-7445)로 반드시 확인 필요.
              </div>
            </div>
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
            <button
              onClick={handleFinalVerify}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-700 hover:bg-indigo-800 shadow-sm whitespace-nowrap transition-colors"
              title="1~4단계 검증 결과 + 서류 체크리스트를 종합해 최종 적합·부적합 판정"
            >
              <Gavel className="w-4 h-4" /> 최종 검증
            </button>
            <span className="text-[11px] text-ink-3 ml-2">
              * 세대원/주택/통장 어느 쪽이든 자동 인식하여 반영
            </span>
          </div>

          {/* ─── 서류 스캔본 배치 처리 ─────────────────────────── */}
          <div className="mb-4 p-3 rounded-lg border border-indigo-200 bg-indigo-50/30">
            <div className="flex items-center gap-2 mb-2">
              <FolderUp className="w-4 h-4 text-indigo-700" />
              <h3 className="text-sm font-semibold text-indigo-900">서류 스캔본 배치 + 일괄 판정</h3>
            </div>
            <p className="text-[11px] text-indigo-800/90 mb-2.5">
              당첨자별 서류 묶음 PDF를 한 번에 올리면 파일명 <code>동-호수 이름.pdf</code>(예: <code>101-1401 김성진.pdf</code>)로 자동 매칭하여
              각 당첨자의 "서류 묶음(통합)" 슬롯에 첨부합니다. 이후 [일괄 적합]으로 서류 체크가 완료된 사람들을 한 번에 적합 처리할 수 있습니다.
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => batchRef.current?.click()}
                disabled={batchBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm disabled:opacity-40"
                title="PDF 여러 개 선택 (파일명 '동-호수 이름' 형식)"
              >
                {batchBusy ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 업로드 중…</>
                ) : (
                  <><FolderUp className="w-3.5 h-3.5" /> 스캔본 배치 업로드</>
                )}
              </button>
              <input
                ref={batchRef}
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={(e) => { handleBatchDocs(e.target.files); }}
              />
              <button
                onClick={handleBulkApprove}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-40"
                title="서류 묶음 첨부 완료자(또는 체크리스트 100% 체크자)를 일괄 적합 처리"
              >
                {bulkBusy ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 처리 중…</>
                ) : (
                  <><ShieldCheck className="w-3.5 h-3.5" /> 일괄 적합 판정</>
                )}
              </button>
            </div>

            {batchResult && (
              <div className="mt-2 text-[11px] text-indigo-900 flex flex-wrap gap-2">
                <span className="px-1.5 py-0.5 rounded bg-white border border-indigo-200">
                  전체 {batchResult.total}개
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900">
                  매칭 & 첨부 {batchResult.attached}건
                </span>
                {batchResult.unmatched > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800">
                    매칭 실패 {batchResult.unmatched}건
                  </span>
                )}
                {batchResult.errors.length > 0 && (
                  <details className="w-full mt-1">
                    <summary className="cursor-pointer text-red-700 text-[11px]">실패 목록 ▶</summary>
                    <ul className="mt-1 pl-4 space-y-0.5 text-[10px] text-red-700 list-disc">
                      {batchResult.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                      {batchResult.errors.length > 10 && <li>… 외 {batchResult.errors.length - 10}건</li>}
                    </ul>
                  </details>
                )}
              </div>
            )}
            {bulkResult && (
              <div className="mt-2 text-[11px] text-emerald-900">
                <span className="px-1.5 py-0.5 rounded bg-emerald-100 font-medium">
                  ✅ {bulkResult.eligible}명 적합 처리 완료
                </span>
                <span className="ml-2 text-ink-3">(audit_log에 전부 기록됨)</span>
              </div>
            )}
          </div>


          {verifyResult && (
            <div className="card mb-4 p-3 text-sm bg-emerald-50/60 border-emerald-100">
              <span className="font-semibold text-emerald-900 mr-3">최종 판정 결과</span>
              <span className="text-green-700 mr-3">적합 {verifyResult.eligible}명</span>
              <span className="text-red-700 mr-3">부적합 {verifyResult.ineligible}명</span>
              <span className="text-ink-2">보류 {verifyResult.pending}명</span>
            </div>
          )}

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
