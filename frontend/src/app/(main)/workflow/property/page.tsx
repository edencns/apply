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
  Loader2, CheckCircle2, UserCheck, UserMinus, FileText,
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
  const separatedPdfRef = useRef<HTMLInputElement>(null);
  const [uploadingSep, setUploadingSep] = useState(false);
  const [sepResult, setSepResult] = useState<{
    attached: number;
    unmatched: number;
    total: number;
  } | null>(null);

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
        // 무주택 예외 룰(소형·저가, 상속, 일시적 2주택, 매수·매도 netting)에
        // 필요한 모든 메타를 통째로 저장 — verification-rules가 활용
        properties: uniq.map((p) => ({
          ownerRrn: p.ownerRrn,
          ownerName: p.ownerName,
          address: p.address,
          areaM2: p.areaM2,
          acquiredDate: p.acquiredDate,
          transferredDate: p.transferredDate,
          usage: p.usage,
          changeReason: p.changeReason,
          changeDate: p.changeDate,
          contractDate: p.contractDate,
          paymentDate: p.paymentDate,
          saleReportDate: p.saleReportDate,
          rightsType: p.rightsType,
          buySell: p.buySell,
          officialPrice: p.officialPrice,
          identifier: p.identifier,
          zipCode: p.zipCode,
        })),
        property_checked_at: new Date().toISOString(),
      });
      alert(`${c.name}: 소유 레코드 ${uniq.length}건 저장됨`);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "파일 파싱 실패");
    }
  };

  /** 분리세대 회신 업로드 — 엑셀(기존 파서 재사용) 또는 PDF(Gemini 파싱) */
  const handleSeparatedResponseUpload = async (file: File) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    const ext = file.name.toLowerCase().split(".").pop() || "";
    const isExcel = ["xlsx", "xls", "xlsm", "csv"].includes(ext);
    const isPdf = ext === "pdf";
    if (!isExcel && !isPdf) {
      alert("분리세대 회신은 엑셀(xlsx/xls) 또는 PDF만 지원합니다.");
      return;
    }
    setUploadingSep(true);
    setSepResult(null);
    try {
      let extracted: Array<{
        ownerRrn: string;
        ownerName: string;
        relation?: string;
        address: string;
        areaM2?: number;
        acquiredDate?: string;
        transferredDate?: string;
        usage?: string;
      }> = [];

      if (isExcel) {
        // 엑셀 경로 — 청약홈 주택소유 엑셀과 동일 포맷으로 가정
        const XLSX = await ensureXlsx();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const parsed = parsePropertyOwnership(wb as any, file.name);
        extracted = parsed.properties.map((p) => ({
          ownerRrn: p.ownerRrn,
          ownerName: p.ownerName,
          address: p.address,
          areaM2: p.areaM2,
          acquiredDate: p.acquiredDate,
          transferredDate: p.transferredDate,
          usage: p.usage,
        }));
      } else {
        // PDF 경로 — Gemini 파싱
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/parse-separated-property", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || `PDF 파싱 실패 (${res.status})`);
        }
        extracted = json.properties || [];
      }

      // 주민번호 앞 6자리로 각 고객에게 매칭
      const rrnFront = (s: string) => String(s || "").replace(/\D/g, "").slice(0, 6);
      const customers = localCustomers.listByAnnouncement(selected.id);

      // 분리세대원 rrn → 당첨자 id 역인덱스
      const sepRrnToCustomer = new Map<string, number>();
      for (const c of customers) {
        for (const m of c.separated_household_members || []) {
          const f = rrnFront(m.rrn);
          if (f) sepRrnToCustomer.set(f, c.id);
        }
      }

      const byCustomer: Record<number, typeof extracted> = {};
      let unmatched = 0;
      for (const p of extracted) {
        const f = rrnFront(p.ownerRrn);
        const cid = sepRrnToCustomer.get(f);
        if (cid == null) {
          unmatched++;
          continue;
        }
        if (!byCustomer[cid]) byCustomer[cid] = [];
        byCustomer[cid].push(p);
      }

      // 분리세대원 관계 힌트 주입 (배우자/자녀/부모 등)
      // — 엑셀은 관계 정보가 없으므로 분리세대 명단에서 찾아 매칭
      for (const c of customers) {
        const props = byCustomer[c.id];
        if (!props || !props.length) continue;
        const memberMap = new Map<string, string>();
        for (const m of c.separated_household_members || []) {
          const f = rrnFront(m.rrn);
          if (f && m.relation) memberMap.set(f, m.relation);
        }
        for (const p of props) {
          if (!p.relation) {
            const f = rrnFront(p.ownerRrn);
            const rel = memberMap.get(f);
            if (rel) p.relation = rel;
          }
        }
      }

      let attached = 0;
      for (const c of customers) {
        // 분리세대원이 등록된 고객만 처리
        if (!(c.separated_household_members || []).length) continue;
        const ownProps = byCustomer[c.id] || [];
        localCustomers.update(c.id, {
          separated_properties: ownProps,
          separated_property_checked_at: new Date().toISOString(),
        });
        attached++;
      }

      setSepResult({ attached, unmatched, total: extracted.length });
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "분리세대 회신 처리 실패");
    } finally {
      setUploadingSep(false);
      if (separatedPdfRef.current) separatedPdfRef.current.value = "";
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
            <button
              onClick={() => separatedPdfRef.current?.click()}
              disabled={uploadingSep}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40"
              title="청약홈 분리세대 주택소유 회신 업로드 — 엑셀(xlsx/xls) 또는 PDF"
            >
              {uploadingSep ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중…</>
              ) : (
                <><FileText className="w-4 h-4" /> 분리세대 회신</>
              )}
            </button>
            <input
              ref={separatedPdfRef}
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleSeparatedResponseUpload(f);
              }}
            />
          </div>

          <IndividualVerifyModal
            open={indivOpen}
            onClose={() => setIndivOpen(false)}
            customers={localCustomers.listByAnnouncement(selected.id)}
            title="주택소유 개별 검증"
            fileHint="한 명의 주택소유 전산검색 결과 파일만 올려 해당 고객에게 붙입니다."
            onApply={handleIndividualUpload}
          />

          {/* 분리세대 주택소유 회신 업로드 결과 */}
          {sepResult && (
            <div className="card mb-4 p-3 text-sm bg-amber-50/70 border-amber-200">
              <div className="flex items-center gap-2 flex-wrap">
                <UserMinus className="w-4 h-4 text-amber-800" />
                <span className="font-semibold text-amber-900">분리세대 주택소유 회신 연결 완료</span>
                <span className="text-amber-800">
                  {sepResult.attached}명에게 분리세대 주택 부착 · 총 {sepResult.total}건 추출
                </span>
                {sepResult.unmatched > 0 && (
                  <span className="text-red-700">매칭 실패 {sepResult.unmatched}건 (분리세대 명단 미등록)</span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-amber-800/80">
                💡 엑셀 또는 PDF 모두 지원. 배우자 분리세대 주택은 본인 세대에 자동 합산되어 판정에 반영됩니다.
              </div>
            </div>
          )}

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
            // 1단계(당첨자 등록)·2단계(세대원)에서 부적합으로 걸러진 사람은 가림
            excludeFailedStages={["registration", "household"]}
          />
        </>
      )}
    </WorkflowShell>
  );
}
