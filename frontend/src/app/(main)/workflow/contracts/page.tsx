"use client";

/**
 * 7단계 — 최종 계약자
 *
 * 「계약자명단(분양금 포함)」 엑셀 업로드 → 계약일·분양금·새 거주지 등 기록.
 * 청약 명단에 없는 사람(선착순·잔여세대 매수자)은 「선착순」 공급유형으로 자동 등록.
 */

import { useRef, useState } from "react";
import WorkflowShell, { WORKFLOW_STEPS } from "@/components/workflow/WorkflowShell";
import StageCustomerList, { StageColumn } from "@/components/workflow/StageCustomerList";
import {
  localCustomers,
  type LocalAnnouncement,
  type LocalCustomer,
} from "@/lib/local-store";
import {
  parseContractExcel,
  matchContractToCustomer,
  type ContractRecord,
} from "@/lib/contract-ingest";
import { formatHousingCode } from "@/lib/housing-code";
import { exportAdditionalResidentXlsx } from "@/lib/applyhome-exports";
import OfficialDocAttachment from "@/components/workflow/OfficialDocAttachment";
import {
  FileSpreadsheet, Loader2, ClipboardCheck, AlertTriangle, UserPlus,
} from "lucide-react";

const step = WORKFLOW_STEPS.find((s) => s.key === "contracts")!;

/** 100,000원 → "10만원", 1억2천만 → "1.2억" */
function fmtMoney(n?: number): string {
  if (!n) return "—";
  if (n >= 100_000_000) {
    const eok = (n / 100_000_000).toFixed(2).replace(/\.00$/, "");
    return `${eok}억`;
  }
  if (n >= 10_000) return `${Math.floor(n / 10_000)}만`;
  return n.toLocaleString();
}

const columns: StageColumn[] = [
  {
    key: "unitNo",
    header: "동호수",
    render: (c) => {
      const dong = (c as any).unit_dong || c.winner_info?.building || "";
      const ho = (c as any).unit_ho || c.winner_info?.unit_no || "";
      if (!dong && !ho) return <span className="text-xs text-ink-4">—</span>;
      return <span className="font-mono text-[12px]">{dong || "?"}-{ho || "?"}</span>;
    },
  },
  {
    key: "supply",
    header: "공급유형",
    render: (c) => {
      const supply = c.supply_type || "—";
      const isLeftover = /선착순|잔여세대/.test(supply);
      const cls = isLeftover
        ? "bg-amber-100 text-amber-800"
        : supply === "일반공급"
          ? "bg-indigo-50 text-indigo-700"
          : "bg-purple-50 text-purple-700";
      return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>{supply}</span>;
    },
  },
  {
    key: "contract",
    header: "계약",
    render: (c) => {
      const ci = (c as any).contract_info;
      if (!ci?.contractDate) return <span className="text-xs text-ink-4">미등록</span>;
      return (
        <div className="flex flex-col gap-0.5 leading-tight">
          <span className="text-[11px] text-ink-2">{ci.contractDate}</span>
          <span className="text-[10px] text-emerald-700 font-medium">{fmtMoney(ci.contractPrice)}</span>
        </div>
      );
    },
  },
];

export default function ContractsStepPage() {
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    updated: number;          // 기존 매칭에 계약 정보 추가
    nameChanged: number;      // 동·호 동일·이름 다름 → 선착순 의심 (수동 확인 필요)
    created: number;          // 신규 「선착순」 등록
    samples: Array<{ dong?: string; ho?: string; name: string; outcome: string }>;
  } | null>(null);
  const xlsxRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    setUploading(true);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const { records } = await parseContractExcel(buf);
      if (records.length === 0) {
        alert("계약자 레코드를 찾지 못했습니다. 헤더 행에 「동」「호」「고객명」 컬럼이 있어야 합니다.");
        return;
      }

      const customers = localCustomers.listByAnnouncement(selected.id).filter((c) => !c.superseded);
      let updated = 0;
      let nameChanged = 0;
      let created = 0;
      const samples: Array<{ dong?: string; ho?: string; name: string; outcome: string }> = [];

      for (const rec of records) {
        const ci = {
          contractDate: rec.contractDate,
          contractPrice: rec.contractPrice,
          downPayment: rec.downPayment,
          customerPhone: rec.phone,
          residenceAddress: rec.residenceAddress,
          registeredAddress: rec.registeredAddress,
          sourceFile: file.name,
          importedAt: new Date().toISOString(),
        };

        const { matched, nameChanged: nc } = matchContractToCustomer(rec, customers);

        if (matched && !nc) {
          // 기존 당첨자에 계약 정보 추가
          localCustomers.update(matched.id, { contract_info: ci } as any);
          updated++;
          if (samples.length < 8) samples.push({ dong: rec.dong, ho: rec.ho, name: rec.customerName, outcome: `계약정보 갱신 (${matched.supply_type || "-"})` });
        } else if (matched && nc) {
          // 동·호는 같은데 이름 다름 → 「선착순」으로 새 사람 등록 + 기존 사람은 「부적합 (계약 안 됨)」 유지
          const newCustomer = localCustomers.create({
            announcement_id: selected.id,
            site_id: matched.site_id,
            name: rec.customerName,
            phone: rec.phone || "",
            rrn_front: "",
            rrn_back: "",
            address: rec.residenceAddress || "",
            supply_type: "선착순",
            unit_type: rec.unitType || matched.unit_type,
            unit_dong: rec.dong,
            unit_ho: rec.ho,
            registration_source: "manual",
            verification_verdict: "eligible",
            verification_reasons: [],
            verification_checked_at: new Date().toISOString(),
          } as any);
          // contract_info 별도 update (create의 input에 없으니까)
          localCustomers.update(newCustomer.id, { contract_info: ci } as any);
          nameChanged++;
          created++;
          if (samples.length < 8) samples.push({ dong: rec.dong, ho: rec.ho, name: rec.customerName, outcome: `🆕 선착순 신규 등록 (이전: ${matched.name} 부적합)` });
        } else {
          // 동·호로 매칭 없음 → 「선착순」 신규 등록
          const newCustomer = localCustomers.create({
            announcement_id: selected.id,
            site_id: 0,
            name: rec.customerName,
            phone: rec.phone || "",
            rrn_front: "",
            rrn_back: "",
            address: rec.residenceAddress || "",
            supply_type: "선착순",
            unit_type: rec.unitType,
            unit_dong: rec.dong,
            unit_ho: rec.ho,
            registration_source: "manual",
            verification_verdict: "eligible",
            verification_reasons: [],
            verification_checked_at: new Date().toISOString(),
          } as any);
          localCustomers.update(newCustomer.id, { contract_info: ci } as any);
          created++;
          if (samples.length < 8) samples.push({ dong: rec.dong, ho: rec.ho, name: rec.customerName, outcome: "🆕 선착순 신규 등록 (청약 명단에 없음)" });
        }
      }

      setResult({ total: records.length, updated, nameChanged, created, samples });
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "엑셀 처리 실패");
    } finally {
      setUploading(false);
      if (xlsxRef.current) xlsxRef.current.value = "";
    }
  };

  const evaluate = (c: LocalCustomer) => {
    const ci = (c as any).contract_info;
    if (ci?.contractDate) {
      return { ok: true, reasons: [], warnings: [], missing: false };
    }
    return { ok: true, reasons: [], warnings: ["계약 정보 미등록"], missing: true };
  };

  return (
    <WorkflowShell step={step} selected={selected} onSelect={setSelected}>
      {selected && (
        <>
          <div className="mb-3 p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-xs text-emerald-900 flex items-start gap-2">
            <ClipboardCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              「계약자명단(분양금 포함)」 엑셀 업로드 → 기존 당첨자에 계약 정보 추가. 동·호 매칭 안 되거나 이름 다른 사람은 <strong>「선착순」</strong> 공급유형으로 자동 등록 (자격 검증 룰 미적용).
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <button
              onClick={() => xlsxRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-40"
              title="계약자명단(분양금 포함) 엑셀 업로드"
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 처리 중…</>
              ) : (
                <><FileSpreadsheet className="w-4 h-4" /> 계약자명단 업로드</>
              )}
            </button>
            <input
              ref={xlsxRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>

          {/* [05] 예비입주자 중 추가입주자 명단 송부 관리 */}
          <AdditionalResidentSection
            announcement={selected}
            onChange={() => setReloadKey((k) => k + 1)}
          />

          {result && (
            <div className="card mb-4 p-3 text-sm bg-emerald-50/60 border-emerald-200">
              <div className="flex items-center gap-2 flex-wrap">
                <ClipboardCheck className="w-4 h-4 text-emerald-700" />
                <span className="font-semibold text-emerald-900">계약자명단 처리 완료</span>
                <span className="text-emerald-800">총 {result.total}건</span>
                <span className="text-blue-800">✓ 기존 매칭 {result.updated}건</span>
                {result.nameChanged > 0 && (
                  <span className="text-amber-800">
                    <AlertTriangle className="w-3 h-3 inline" /> 이름 변경 {result.nameChanged}건
                  </span>
                )}
                {result.created > 0 && (
                  <span className="text-purple-800">
                    <UserPlus className="w-3 h-3 inline" /> 선착순 신규 등록 {result.created}건
                  </span>
                )}
              </div>
              {result.samples.length > 0 && (
                <details className="mt-2 text-[11px]" open>
                  <summary className="cursor-pointer text-emerald-900 font-semibold">처리 샘플</summary>
                  <ul className="mt-1 ml-4 space-y-0.5 text-ink-2">
                    {result.samples.map((s, i) => (
                      <li key={i}>
                        <strong>{s.dong || "?"}-{s.ho || "?"} {s.name}</strong> — {s.outcome}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <StageCustomerList
            key={reloadKey}
            announcement={selected}
            evaluate={evaluate}
            columns={columns}
            stageNumber={7}
          />
        </>
      )}
    </WorkflowShell>
  );
}

/**
 * [05] 예비입주자 중 추가입주자 명단 송부 관리.
 *
 * 청약홈 > 사업주체전용 > 당첨자 > 당첨자 등록 > [05]예비입주자 중 추가입주자 명단
 * 「주택공급에 관한 규칙」 제57조제1항 — 추가입주자 발생 즉시 송부.
 *
 * 대상: succeeded_from 필드가 있는 고객 (예비→당첨자로 승계 완료된 자).
 */
function AdditionalResidentSection({
  announcement,
  onChange,
}: {
  announcement: LocalAnnouncement;
  onChange: () => void;
}) {
  const announcementId = announcement.id;
  const [reloadKey, setReloadKey] = useState(0);
  const all = localCustomers.listByAnnouncement(announcementId);
  const additional = all.filter(
    (c) => c.succeeded_from !== undefined && c.succeeded_from !== null && !c.superseded,
  );
  if (additional.length === 0) return null;

  const reported = additional.filter((c) => c.additional_resident_reported_at);
  const pending = additional.filter((c) => !c.additional_resident_reported_at);

  const markReported = (c: LocalCustomer) => {
    localCustomers.update(c.id, { additional_resident_reported_at: new Date().toISOString() });
    setReloadKey((k) => k + 1);
    onChange();
  };
  const unmarkReported = (c: LocalCustomer) => {
    if (!confirm("[05] 송부 완료 표시를 해제할까요?")) return;
    localCustomers.update(c.id, { additional_resident_reported_at: undefined });
    setReloadKey((k) => k + 1);
    onChange();
  };
  const markAllPending = () => {
    if (pending.length === 0) return;
    if (!confirm(`${pending.length}명을 일괄 송부 완료로 표시할까요?`)) return;
    const now = new Date().toISOString();
    for (const c of pending) localCustomers.update(c.id, { additional_resident_reported_at: now });
    setReloadKey((k) => k + 1);
    onChange();
  };

  // 원당첨자 이름 조회 (succeeded_from → 원래 사람)
  const byId = new Map(all.map((c) => [c.id, c]));

  return (
    <div className="card mb-4 p-3 bg-violet-50/60 border-violet-200" key={reloadKey}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div>
          <h3 className="text-sm font-semibold text-violet-900">
            [05] 예비입주자 중 추가입주자 명단
          </h3>
          <p className="text-[11px] text-violet-800 mt-0.5">
            청약홈 &gt; 당첨자 &gt; 당첨자 등록 &gt; [05]예비입주자 중 추가입주자 명단 — 발생 즉시 송부 (제57조제1항)
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="px-2 py-0.5 rounded bg-white border border-violet-200 text-violet-900">
            추가입주자 <strong>{additional.length}</strong>명
          </span>
          <span className="px-2 py-0.5 rounded bg-white border border-emerald-200 text-emerald-900">
            송부 완료 <strong>{reported.length}</strong>명
          </span>
          {pending.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-red-100 text-red-900 font-semibold">
              미송부 <strong>{pending.length}</strong>명
            </span>
          )}
          <button
            onClick={() => exportAdditionalResidentXlsx(all, announcement)}
            className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold"
            title="청약홈 [05] 메뉴 송부용 엑셀 다운로드"
          >
            [05] 엑셀 출력
          </button>
          <OfficialDocAttachment announcement={announcement} menuCode="05" compact onUpdate={onChange} />
        </div>
      </div>

      {pending.length > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-red-50 border border-red-200">
          <span className="text-[11px] text-red-800">
            🔴 추가입주자로 전환되었으나 [05] 미송부인 고객 <strong>{pending.length}명</strong>이 있습니다.
          </span>
          <button
            onClick={markAllPending}
            className="px-2 py-1 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-semibold"
          >
            일괄 송부 완료 ({pending.length}명)
          </button>
        </div>
      )}

      <details className="text-[11px]">
        <summary className="cursor-pointer text-violet-900 font-semibold">추가입주자 명단</summary>
        <ul className="mt-2 space-y-1">
          {additional.map((c) => {
            const isReported = !!c.additional_resident_reported_at;
            const original = c.succeeded_from ? byId.get(c.succeeded_from) : null;
            return (
              <li key={c.id} className="flex items-center justify-between p-1.5 rounded bg-white border border-violet-100">
                <span>
                  {isReported ? "✓ " : "○ "}
                  <strong>{c.name}</strong> · {c.unit_type || "—"} · {c.unit_dong || "?"}-{c.unit_ho || "?"}
                  {original && (
                    <span className="ml-2 text-ink-3">(원당첨자: {original.name})</span>
                  )}
                  {isReported && (
                    <span className="ml-2 text-emerald-700">
                      송부 {new Date(c.additional_resident_reported_at!).toLocaleDateString()}
                    </span>
                  )}
                </span>
                {isReported ? (
                  <button
                    onClick={() => unmarkReported(c)}
                    className="px-1.5 py-0.5 rounded border border-ink-300 text-[10px] text-ink-3 hover:bg-ink-50"
                  >
                    해제
                  </button>
                ) : (
                  <button
                    onClick={() => markReported(c)}
                    className="px-1.5 py-0.5 rounded bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-semibold"
                  >
                    송부 완료
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </details>

      {/* 추가입주자의 배우자 분리세대원 - 보충 안내 */}
      {additional.some((c) => (c.separated_household_members || []).length > 0) && (
        <div className="mt-2 px-2 py-1.5 rounded bg-white border border-violet-200 text-[11px] text-violet-900">
          💡 추가입주자 중 배우자 분리세대원이 있는 경우, household 단계의 [01] 메뉴를 통해 별도 송부 필요.
        </div>
      )}
    </div>
  );
}
