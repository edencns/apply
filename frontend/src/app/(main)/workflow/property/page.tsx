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
import { parsePropertyOwnership, ensureXlsx, type PropertyOwnershipRecord } from "@/lib/winner-ingest";
import IndividualVerifyModal from "@/components/workflow/IndividualVerifyModal";
import { Home, AlertTriangle, Upload, Loader2, CheckCircle2, UserCheck } from "lucide-react";

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
      if (props.length === 0) {
        if (c.property_checked_at) return <span className="text-xs text-green-700">보유 없음</span>;
        return <span className="text-xs text-gray-400">조회 불가</span>;
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
        <span className="text-xs text-gray-600">{past}건</span>
      ) : <span className="text-xs text-gray-400">—</span>;
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
      if (v.warnings.length > 0) {
        return <span className="text-xs text-amber-700">경고: {v.warnings[0]?.slice(0, 25)}</span>;
      }
      return <span className="text-xs text-green-700">무주택 적격</span>;
    },
  },
];

interface UploadResult {
  attached: number;       // 속성 연결된 당첨자 수
  unmatched: number;      // 매칭 실패한 소유자 수
  totalRecords: number;   // 총 소유 레코드 수
  errors: string[];
}

export default function PropertyStepPage() {
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<
    { ok: number; fail: number; warn: number; missing: number } | null
  >(null);
  const [indivOpen, setIndivOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const evaluate = (c: LocalCustomer, a: LocalAnnouncement) => evaluateProperty(c, a);

  const regulation = (selected?.eligibility_rules?.regulation as string) || undefined;

  /** 주택소유 전산검색결과 엑셀 업로드 → 각 당첨자에 properties 연결 */
  const handleUpload = async (file: File) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    setUploading(true);
    setUploadResult(null);
    setVerifyResult(null);
    try {
      const XLSX = await ensureXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const result = parsePropertyOwnership(wb as any, file.name);
      const records = result.properties;
      if (records.length === 0) {
        alert("주택소유 레코드를 찾지 못했습니다. '주택소유정보전산검색결과' 양식인지 확인해 주세요.");
        return;
      }

      // 소유자 RRN 기준 그룹핑
      const grouped = new Map<string, PropertyOwnershipRecord[]>();
      for (const r of records) {
        if (!r.ownerRrn) continue;
        if (!grouped.has(r.ownerRrn)) grouped.set(r.ownerRrn, []);
        grouped.get(r.ownerRrn)!.push(r);
      }

      const customers = localCustomers.listByAnnouncement(selected.id);

      // 고객별 properties 축적 (본인 + 세대원 보유분 모두)
      const byCustomer = new Map<number, PropertyOwnershipRecord[]>();
      let unmatched = 0;
      const errors: string[] = [];

      grouped.forEach((group, ownerRrn) => {
        if (!/^\d{13}$/.test(ownerRrn)) {
          unmatched++;
          return;
        }
        const front = ownerRrn.slice(0, 6);
        const back = ownerRrn.slice(6);

        // 본인 RRN 매칭
        let matched: LocalCustomer[] = customers.filter(
          (c) => c.rrn_front === front && c.rrn_back === back,
        );
        // 세대원 RRN 매칭
        if (matched.length === 0) {
          matched = customers.filter(
            (c) => (c.household_members || []).some((m) => m.rrn === ownerRrn),
          );
        }

        if (matched.length === 0) {
          unmatched++;
          const name = group[0].ownerName || ownerRrn.slice(0, 6) + "-*";
          errors.push(`${name}: 당첨자 본인/세대원과 매칭 실패`);
          return;
        }

        for (const c of matched) {
          const prev = byCustomer.get(c.id) || [];
          byCustomer.set(c.id, [...prev, ...group]);
        }
      });

      // 이 공고의 모든 (미승계) 고객에게 "조회 완료" 마킹 — 파일에 없는 사람 = 무주택 확정
      const checkedAt = new Date().toISOString();
      for (const c of customers) {
        if (c.superseded) continue;
        try {
          localCustomers.update(c.id, { property_checked_at: checkedAt });
        } catch {}
      }

      let attached = 0;
      byCustomer.forEach((props, cid) => {
        try {
          // 중복 제거 (ownerRrn + address)
          const seen = new Set<string>();
          const uniq = props.filter((p) => {
            const k = `${p.ownerRrn}|${p.address}|${p.acquiredDate || ""}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          localCustomers.update(cid, {
            properties: uniq.map((p) => ({
              ownerRrn: p.ownerRrn,
              ownerName: p.ownerName,
              address: p.address,
              areaM2: p.areaM2,
              acquiredDate: p.acquiredDate,
              transferredDate: p.transferredDate,
              usage: p.usage,
            })),
          });
          attached++;
        } catch (e: any) {
          errors.push(`고객 #${cid}: 저장 실패 (${e?.message || ""})`);
        }
      });

      setUploadResult({
        attached,
        unmatched,
        totalRecords: records.length,
        errors: errors.slice(0, 10),
      });
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "주택소유 파일 파싱 실패");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** 개별 고객 파일 업로드 → 그 사람(+세대원)의 소유 기록만 저장 */
  const handleIndividualUpload = async (c: LocalCustomer, file: File) => {
    try {
      const XLSX = await ensureXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const result = parsePropertyOwnership(wb as any, file.name);
      const records = result.properties;

      // 이 고객(+세대원)의 RRN과 일치하는 레코드만 선별
      const ownRrn = c.rrn_front && c.rrn_back ? c.rrn_front + c.rrn_back : "";
      const memberRrns = (c.household_members || [])
        .map((m) => m.rrn || "")
        .filter((r) => /^\d{13}$/.test(r));
      const targetRrns = new Set<string>([ownRrn, ...memberRrns].filter(Boolean));

      // 파일에 이 사람 RRN이 전혀 없으면 "파일 전체 = 이 사람 것"으로 간주 (본인용 파일)
      let mine = records.filter((r) => targetRrns.has(r.ownerRrn));
      if (mine.length === 0 && records.length > 0) {
        mine = records;
      }

      // 중복 제거
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

  /** 현재 공고 고객 전원 재검증 → 요약 */
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
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 shadow-sm whitespace-nowrap transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="주택소유정보전산검색결과.xlsx 업로드"
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
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const ext = f.name.toLowerCase().split(".").pop() || "";
                if (["xlsx", "xls", "xlsm", "csv"].includes(ext)) {
                  handleUpload(f);
                } else {
                  alert("주택소유 조회는 엑셀 파일(주택소유정보전산검색결과.xlsx)만 지원합니다.");
                  if (fileRef.current) fileRef.current.value = "";
                }
              }}
            />
            <button
              onClick={handleVerify}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm whitespace-nowrap transition-colors"
              title="현재 공고 고객 전원 주택소유 검증"
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
            title="주택소유 개별 검증"
            fileHint="한 명의 주택소유 전산검색 결과 파일만 올려 해당 고객에게 붙입니다."
            accept=".xlsx,.xls,.xlsm,.csv"
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
              <span className="text-gray-600">검증 필요 {verifyResult.missing}명</span>
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
