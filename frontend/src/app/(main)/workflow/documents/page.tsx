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
  FolderUp, ShieldCheck, FileQuestion, PauseCircle,
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

/** 동·호수 prefix 컬럼 — 동·호 매칭이 핵심인 5단계에서 가장 먼저 노출 */
const prefixColumns: StageColumn[] = [
  {
    key: "unitNo",
    header: "동호수",
    render: (c) => {
      const dong = (c as any).unit_dong
        || c.winner_info?.building
        || "";
      const ho = (c as any).unit_ho
        || c.winner_info?.unit_no
        || "";
      if (!dong && !ho) return <span className="text-xs text-ink-4">—</span>;
      return (
        <span className="text-[12px] text-ink font-mono whitespace-nowrap">
          {dong || "?"}-{ho || "?"}
        </span>
      );
    },
  },
];

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
      const status = computeReviewStatus(c);
      switch (status) {
        case "eligible":
          return (
            <span className="inline-flex items-center gap-1 text-sm text-green-700 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" /> 적합
            </span>
          );
        case "ineligible":
          return (
            <span className="inline-flex items-center gap-1 text-sm text-red-700 font-semibold">
              <XCircle className="w-3.5 h-3.5" /> 부적합
            </span>
          );
        case "in_review":
          return (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
              <PauseCircle className="w-3.5 h-3.5" /> 검수 보류
            </span>
          );
        case "uploaded":
          return (
            <span className="inline-flex items-center gap-1 text-xs text-blue-700 font-medium">
              <Clock className="w-3.5 h-3.5" /> 미검수
            </span>
          );
        case "missing":
        default:
          return (
            <span className="inline-flex items-center gap-1 text-xs text-ink-4">
              <FileQuestion className="w-3.5 h-3.5" /> 미등록
            </span>
          );
      }
    },
  },
];

/**
 * 5단계 서류 검수 상태를 5가지로 분류.
 *
 *  - missing    : 서류 파일이 하나도 등록되지 않음
 *  - uploaded   : 파일은 등록됐지만 아직 어떤 체크포인트도 검토하지 않음 (= 미검수)
 *  - in_review  : 일부 체크포인트만 ✓/✕ 처리 — 담당자가 중간에 멈춤 (= 검수 보류)
 *  - eligible   : 최종 적합
 *  - ineligible : 최종 부적합
 *
 * 청약홈 자동검증 서류는 파일이 없어도 검증 완료로 간주되므로
 * registration_source === "applyhome"인 경우 documents_submitted에서 그 항목들이
 * true로 사전 체크되어 있다 — 이들은 "uploaded"로 잡힘.
 */
function computeReviewStatus(
  c: LocalCustomer,
): "missing" | "uploaded" | "in_review" | "eligible" | "ineligible" {
  if (c.verification_verdict === "eligible") return "eligible";
  if (c.verification_verdict === "ineligible") return "ineligible";

  const submitted = c.documents_submitted || {};
  const hasSubmitted = Object.values(submitted).some(Boolean);
  const docFiles = c.document_files || {};
  const hasFile = Object.values(docFiles).some(
    (f: any) => f?.url || (Array.isArray(f?.pages) && f.pages.length > 0) || f?.page,
  );

  // 체크포인트 중 하나라도 pass/fail이면 검수 보류
  const hasReviewProgress = Object.values(docFiles).some((f: any) =>
    f?.checkpointResults
      ? Object.values(f.checkpointResults).some(
          (r: any) => r?.status === "pass" || r?.status === "fail",
        )
      : false,
  );

  if (hasReviewProgress) return "in_review";
  if (hasFile || hasSubmitted) return "uploaded";
  return "missing";
}

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
    pending: number;
    total: number;
    errors: string[];
  } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ eligible: number } | null>(null);

  /**
   * 동호수+이름 양쪽 다 일치하지 않은 파일은 자동 첨부하지 않고 보류 큐에 둡니다.
   * 담당자가 후보 중에서 어느 고객에 첨부할지 직접 고른 뒤 업로드/첨부합니다.
   * (File 객체는 메모리에만 보유 — 페이지 이탈 시 휘발)
   */
  type PendingMatch = {
    id: string;            // 고유 키 (UI 식별용)
    file: File;
    parsedDong: string;
    parsedHo: string;
    parsedName: string;
    tier: "dongHoOnly" | "nameOnly";
    candidates: LocalCustomer[];
  };
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

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

  /**
   * 단일 파일을 특정 고객의 「서류 묶음(통합)」 슬롯에 업로드하고 첨부.
   * 동호수가 비어 있으면 파싱된 dong/ho로 보강.
   */
  const uploadAndAttach = async (
    file: File,
    target: LocalCustomer,
    parsedDong?: string,
    parsedHo?: string,
  ): Promise<void> => {
    if (!selected) throw new Error("공고 미선택");
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
        fileId: json.id,
      },
    };
    const submittedNow = target.documents_submitted || {};
    const patch: Partial<LocalCustomer> & Record<string, any> = {
      document_files: nextFiles,
      documents_submitted: { ...submittedNow, "서류 묶음(통합)": true },
    };
    if (parsedDong && !(target as any).unit_dong) patch.unit_dong = parsedDong;
    if (parsedHo && !(target as any).unit_ho) patch.unit_ho = parsedHo;
    localCustomers.update(target.id, patch as any);
  };

  /** 보류 항목을 사용자가 선택한 고객에게 첨부 */
  const resolvePendingMatch = async (pendingId: string, customerId: number) => {
    const p = pendingMatches.find((x) => x.id === pendingId);
    if (!p) return;
    const target = p.candidates.find((c) => c.id === customerId);
    if (!target) return;
    setResolvingId(pendingId);
    try {
      await uploadAndAttach(p.file, target, p.parsedDong, p.parsedHo);
      setPendingMatches((prev) => prev.filter((x) => x.id !== pendingId));
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "첨부 실패");
    } finally {
      setResolvingId(null);
    }
  };

  const skipPendingMatch = (pendingId: string) => {
    setPendingMatches((prev) => prev.filter((x) => x.id !== pendingId));
  };

  const clearAllPending = () => {
    if (pendingMatches.length === 0) return;
    if (!confirm(`보류 중인 ${pendingMatches.length}개 파일을 모두 비울까요?`)) return;
    setPendingMatches([]);
  };

  /** 서류 스캔본 배치 업로드 — 파일명 "동-호수 이름.pdf" 매칭 후 각 당첨자의 "서류 묶음" 슬롯에 저장 */
  const handleBatchDocs = async (files: FileList | null) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    if (!files || files.length === 0) return;
    setBatchBusy(true);
    setBatchResult(null);
    try {
      const customers = localCustomers.listByAnnouncement(selected.id);
      let attached = 0, unmatched = 0, pending = 0;
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

        const cleanNameHint = nameHint?.trim() || "";
        // 동·호 필드가 채워진 후보군
        const byDongHo = customers.filter((c) => {
          const cd = String((c as any).unit_dong || "").trim();
          const ch = String((c as any).unit_ho || "").trim();
          return cd && ch && cd === dong && ch === ho;
        });

        // 1순위: 동호수 + 이름 모두 일치 → 자동 첨부
        let target: typeof customers[number] | undefined;
        if (cleanNameHint) {
          target = byDongHo.find((c) => c.name === cleanNameHint);
        }

        // 2순위/3순위는 자동 첨부하지 않고 보류 — 담당자가 어느 고객인지 직접 선택.
        if (!target) {
          // 후보군 추리기: 동호 일치 우선, 없으면 이름 일치
          let candidates: typeof customers = [];
          let tier: "dongHoOnly" | "nameOnly";
          if (byDongHo.length > 0) {
            candidates = byDongHo;
            tier = "dongHoOnly";
          } else if (cleanNameHint) {
            candidates = customers.filter((c) => c.name === cleanNameHint);
            tier = "nameOnly";
          } else {
            tier = "dongHoOnly";
          }

          if (candidates.length === 0) {
            // 어떤 후보도 없으면 진짜 매칭 실패 — errors로
            unmatched++;
            const dongHoFuzzy = customers
              .filter((c) => {
                const cd = String((c as any).unit_dong || "").trim();
                const ch = String((c as any).unit_ho || "").trim();
                return cd === dong || ch === ho;
              })
              .slice(0, 3)
              .map((c) => `${c.name}(${(c as any).unit_dong || "?"}-${(c as any).unit_ho || "?"})`)
              .join(", ");
            errors.push(
              `${file.name}: ${dong}-${ho}${cleanNameHint ? ` "${cleanNameHint}"` : ""} 매칭 실패. ` +
              `동호 유사: [${dongHoFuzzy || "없음"}]`,
            );
            continue;
          }

          // 보류 큐에 추가 — 담당자가 직접 선택
          const pid = `${file.name}#${Date.now()}#${Math.random().toString(36).slice(2, 8)}`;
          setPendingMatches((prev) => [
            ...prev,
            {
              id: pid,
              file,
              parsedDong: dong,
              parsedHo: ho,
              parsedName: cleanNameHint,
              tier,
              candidates,
            },
          ]);
          // 보류는 unmatched로 카운트하지 않고 별도 표시
          pending++;
          continue;
        }

        // 1순위 매칭 — 자동 첨부
        try {
          await uploadAndAttach(file, target, dong, ho);
          attached++;
        } catch (err: any) {
          errors.push(`${file.name}: ${err?.message || "오류"}`);
          unmatched++;
        }
      }

      setBatchResult({ attached, unmatched, pending, total, errors });
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

          {/* ─── 메인 작업: 서류 스캔본 배치 + 판정 ─── */}
          <div className="mb-4 p-4 rounded-lg border-2 border-indigo-200 bg-indigo-50/40">
            <div className="flex items-center gap-2 mb-3">
              <FolderUp className="w-5 h-5 text-indigo-700" />
              <h3 className="text-base font-bold text-indigo-900">서류 판정 주 작업</h3>
            </div>
            <p className="text-xs text-indigo-800/90 mb-3">
              <strong>① 스캔본 배치 업로드</strong>로 당첨자별 서류 PDF(파일명 <code>동-호수 이름.pdf</code>)를 한 번에 첨부 →
              <strong> ② 개별 검토</strong> (당첨자 클릭 → 체크포인트 확인) →
              <strong> ③ 일괄 적합 판정</strong>으로 검토 완료자 한 번에 "적합" 처리.
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => batchRef.current?.click()}
                disabled={batchBusy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm disabled:opacity-40"
                title="파일명 '동-호수 이름.pdf' 형식의 PDF 여러 개 선택 → 당첨자 자동 매칭"
              >
                {batchBusy ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> 업로드 중…</>
                ) : (
                  <><FolderUp className="w-4 h-4" /> ① 스캔본 배치 업로드</>
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
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-40"
                title="스캔본 첨부자 또는 체크리스트 완료자를 한 번에 적합 처리"
              >
                {bulkBusy ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> 처리 중…</>
                ) : (
                  <><ShieldCheck className="w-4 h-4" /> ③ 일괄 적합 판정</>
                )}
              </button>
              <button
                onClick={handleFinalVerify}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-700 hover:bg-indigo-800 shadow-sm"
                title="1~4단계 + 체크리스트를 규칙 기반으로 자동 재판정 (시스템 규칙 검증)"
              >
                <Gavel className="w-4 h-4" /> 전체 자동 재판정
              </button>
            </div>

            {batchResult && (
              <div className="mt-3 text-xs text-indigo-900 flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 rounded bg-white border border-indigo-200">
                  전체 {batchResult.total}개
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900">
                  ✓ 자동 첨부 {batchResult.attached}건
                </span>
                {batchResult.pending > 0 && (
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-medium">
                    ⏸ 수동 매칭 필요 {batchResult.pending}건
                  </span>
                )}
                {batchResult.unmatched > 0 && (
                  <span className="px-2 py-0.5 rounded bg-red-100 text-red-800">
                    매칭 실패 {batchResult.unmatched}건
                  </span>
                )}
                {batchResult.errors.length > 0 && (
                  <details className="w-full mt-1">
                    <summary className="cursor-pointer text-red-700 text-xs">실패 목록 ▶</summary>
                    <ul className="mt-1 pl-4 space-y-0.5 text-[11px] text-red-700 list-disc">
                      {batchResult.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                      {batchResult.errors.length > 10 && <li>… 외 {batchResult.errors.length - 10}건</li>}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {/* 수동 매칭 큐 — 동호수+이름이 모두 일치하지 않아 자동 첨부 보류된 파일들 */}
            {pendingMatches.length > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-300">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-amber-900">
                      ⏸ 수동 매칭 필요 ({pendingMatches.length}건)
                    </h3>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      동호수+이름이 모두 일치하지 않은 파일입니다. 후보 중 어느 고객에 첨부할지 직접 선택하세요.
                    </p>
                  </div>
                  <button
                    onClick={clearAllPending}
                    className="text-[11px] text-amber-700 hover:underline"
                  >
                    모두 비우기
                  </button>
                </div>
                <ul className="space-y-2">
                  {pendingMatches.map((p) => {
                    const isResolving = resolvingId === p.id;
                    return (
                      <li
                        key={p.id}
                        className="p-2.5 rounded-md bg-white border border-amber-200"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-mono text-ink truncate" title={p.file.name}>
                              📄 {p.file.name}
                            </div>
                            <div className="text-[10px] text-ink-3 mt-0.5 flex flex-wrap gap-2">
                              <span>파싱: <strong className="text-ink-2">{p.parsedDong}-{p.parsedHo}</strong></span>
                              {p.parsedName && <span>이름: <strong className="text-ink-2">{p.parsedName}</strong></span>}
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                                p.tier === "dongHoOnly"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-purple-100 text-purple-700"
                              }`}>
                                {p.tier === "dongHoOnly" ? "동호수 일치" : "이름만 일치"}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => skipPendingMatch(p.id)}
                            disabled={isResolving}
                            className="text-[10px] text-ink-4 hover:text-red-600 px-1 disabled:opacity-40"
                            title="이 파일 건너뛰기 (큐에서 제거)"
                          >
                            건너뛰기
                          </button>
                        </div>
                        <div className="space-y-1">
                          <div className="text-[10px] text-ink-3 font-medium">
                            후보 {p.candidates.length}명 — 선택해서 첨부:
                          </div>
                          {p.candidates.map((c) => {
                            const dh = `${(c as any).unit_dong || "?"}-${(c as any).unit_ho || "?"}`;
                            const supply = c.supply_type || "—";
                            return (
                              <button
                                key={c.id}
                                onClick={() => resolvePendingMatch(p.id, c.id)}
                                disabled={isResolving}
                                className="w-full text-left p-1.5 rounded border border-border hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                              >
                                <span className="font-mono text-[11px] text-ink">{dh}</span>
                                <span className="text-[11px] font-semibold text-ink">{c.name}</span>
                                <span className="text-[10px] px-1 py-0.5 rounded bg-surface2 text-ink-2">
                                  {supply}
                                </span>
                                {c.is_standby && (
                                  <span className="text-[9.5px] bg-amber-100 text-amber-800 px-1 py-0.5 rounded">
                                    예비 {c.standby_rank || ""}
                                  </span>
                                )}
                                {isResolving ? (
                                  <Loader2 className="w-3 h-3 animate-spin ml-auto text-indigo-500" />
                                ) : (
                                  <span className="ml-auto text-[10px] text-indigo-600 font-medium">
                                    이 고객에 첨부 →
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {bulkResult && (
              <div className="mt-3 text-xs text-emerald-900">
                <span className="px-2 py-0.5 rounded bg-emerald-100 font-medium">
                  ✅ {bulkResult.eligible}명 적합 처리 완료
                </span>
                <span className="ml-2 text-ink-3">(감사 로그 기록됨)</span>
              </div>
            )}
          </div>

          {/* ─── 보조: 세대원/주택/통장 파일 추가 업로드 (접힘) ─── */}
          <details className="mb-4 rounded-lg border border-border bg-surface2/40">
            <summary className="cursor-pointer px-3 py-2 text-xs text-ink-2 font-medium hover:bg-surface2 rounded-lg">
              ⚙️ 보조 파일 업로드 (2·3·4단계 데이터 보완)
            </summary>
            <div className="px-3 pb-3 pt-1">
              <p className="text-[11px] text-ink-3 mb-2">
                2·3·4단계에서 이미 처리했어야 하는 파일인데 누락된 경우만 여기서 올리세요.
                업로드하면 파일 종류를 자동 인식해 해당 단계에 반영됩니다.
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => pdfRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 disabled:opacity-40"
                >
                  {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                  PDF 업로드
                </button>
                <input
                  ref={pdfRef} type="file" accept=".pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                <button
                  onClick={() => xlsxRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-green-700 bg-white border border-green-200 hover:bg-green-50 disabled:opacity-40"
                >
                  {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileSpreadsheet className="w-3 h-3" />}
                  엑셀 업로드
                </button>
                <input
                  ref={xlsxRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>
            </div>
          </details>


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
            prefixColumns={prefixColumns}
            columns={columns}
            stageNumber={5}
          />
        </>
      )}
    </WorkflowShell>
  );
}
