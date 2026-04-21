"use client";

import { useRef, useState } from "react";
import WorkflowShell, { WORKFLOW_STEPS } from "@/components/workflow/WorkflowShell";
import StageCustomerList, { StageColumn } from "@/components/workflow/StageCustomerList";
import { evaluateSavings } from "@/lib/verification-rules";
import {
  localCustomers,
  type LocalAnnouncement,
  type LocalCustomer,
} from "@/lib/local-store";
import { parseSavingsPriorityPdfText, type SavingsPriorityRecord } from "@/lib/winner-ingest";
import IndividualVerifyModal from "@/components/workflow/IndividualVerifyModal";
import {
  Banknote, AlertTriangle, CheckCircle2, Upload, Loader2, UserCheck,
} from "lucide-react";

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

interface UploadResult {
  attached: number;
  unmatched: number;
  totalRecords: number;
  errors: string[];
}

async function extractPdfText(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/extract-pdf-text", { method: "POST", body: fd });
  if (!res.ok) throw new Error((await res.json()).error || "PDF 텍스트 추출 실패");
  const d = await res.json();
  return d.text || "";
}

function saveToCustomer(c: LocalCustomer, rec: SavingsPriorityRecord) {
  localCustomers.update(c.id, {
    savings_priority: {
      verified: rec.verified,
      bankCode: rec.bankCode,
      errorNote: rec.errorNote,
      resultLength: rec.resultLength,
    },
  });
}

export default function SavingsStepPage() {
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<
    { ok: number; fail: number; missing: number } | null
  >(null);
  const [indivOpen, setIndivOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const evaluate = (c: LocalCustomer, a: LocalAnnouncement) => evaluateSavings(c, a);
  const minMonths = selected?.eligibility_rules?.min_subscription_period as number | undefined;

  const handleUpload = async (file: File) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    setUploading(true);
    setUploadResult(null);
    setVerifyResult(null);
    try {
      const text = await extractPdfText(file);
      const result = parseSavingsPriorityPdfText(text, file.name);
      const records = result.savings;
      if (records.length === 0) {
        alert("순위확인 레코드를 찾지 못했습니다. '입주자저축 순위확인 통보' PDF인지 확인해 주세요.");
        return;
      }

      const customers = localCustomers.listByAnnouncement(selected.id);
      let attached = 0;
      let unmatched = 0;
      const errors: string[] = [];

      for (const r of records) {
        if (!/^\d{13}$/.test(r.rrn)) { unmatched++; continue; }
        const front = r.rrn.slice(0, 6);
        const back = r.rrn.slice(6);
        const target = customers.find((c) => c.rrn_front === front && c.rrn_back === back);
        if (!target) {
          unmatched++;
          errors.push(`${r.name}: 당첨자 매칭 실패`);
          continue;
        }
        try {
          saveToCustomer(target, r);
          attached++;
        } catch (e: any) {
          errors.push(`${r.name}: 저장 실패 (${e?.message || ""})`);
        }
      }

      setUploadResult({
        attached,
        unmatched,
        totalRecords: records.length,
        errors: errors.slice(0, 10),
      });
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "청약통장 순위확인 파일 파싱 실패");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleVerify = () => {
    if (!selected) return;
    const customers = localCustomers
      .listByAnnouncement(selected.id)
      .filter((c) => !c.superseded);
    let ok = 0, fail = 0, missing = 0;
    for (const c of customers) {
      const v = evaluateSavings(c, selected);
      if (v.missing) missing++;
      else if (v.ok) ok++;
      else fail++;
    }
    setVerifyResult({ ok, fail, missing });
    setReloadKey((k) => k + 1);
  };

  const handleIndividualUpload = async (c: LocalCustomer, file: File) => {
    try {
      const text = await extractPdfText(file);
      const result = parseSavingsPriorityPdfText(text, file.name);
      const records = result.savings;
      if (records.length === 0) {
        alert("순위확인 레코드를 찾지 못했습니다.");
        return;
      }

      // 고객 RRN과 일치하는 레코드 우선 선택
      const target =
        records.find((r) => c.rrn_front && c.rrn_back && r.rrn === c.rrn_front + c.rrn_back)
        || records[0];

      saveToCustomer(c, target);
      alert(
        target.verified
          ? `${c.name}: 70) 검증완료 저장됨`
          : `${c.name}: ${target.resultLength}) 오류 저장됨`,
      );
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "파일 파싱 실패");
    }
  };

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

          {/* 툴바 */}
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 shadow-sm whitespace-nowrap transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="입주자저축 순위확인 통보 PDF 업로드"
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
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
            />
            <button
              onClick={handleVerify}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm whitespace-nowrap transition-colors"
              title="현재 공고 고객 전원 청약통장 검증"
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
          </div>

          <IndividualVerifyModal
            open={indivOpen}
            onClose={() => setIndivOpen(false)}
            customers={localCustomers.listByAnnouncement(selected.id)}
            title="청약통장 개별 검증"
            fileHint="한 명의 순위확인 통보 PDF만 올려 해당 고객에게 붙입니다."
            accept=".pdf,application/pdf"
            onApply={handleIndividualUpload}
          />

          {/* 업로드 결과 */}
          {uploadResult && (
            <div className="card mb-4 p-3 text-sm bg-indigo-50/60 border-indigo-100">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-indigo-900">청약통장 순위확인 연결 완료</span>
                <span className="text-indigo-800">
                  {uploadResult.attached}명에게 결과 부착 · 총 {uploadResult.totalRecords}건
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
              <span className="font-semibold text-emerald-900 mr-3">청약통장 검증 결과</span>
              <span className="text-green-700 mr-3">통과 {verifyResult.ok}명</span>
              <span className="text-red-700 mr-3">부적합 {verifyResult.fail}명</span>
              <span className="text-gray-600">검증 필요 {verifyResult.missing}명</span>
            </div>
          )}

          <StageCustomerList
            key={reloadKey}
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
