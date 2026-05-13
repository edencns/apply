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
import { parseSeparatedExcel } from "@/lib/separated-ingest";
import { exportSeparatedReportXlsx } from "@/lib/applyhome-exports";
import OfficialDocAttachment from "@/components/workflow/OfficialDocAttachment";
import { toIdentity, sameIdentity } from "@/lib/identity";
import { ingestForStage, type WorkflowIngestResult } from "@/lib/workflow-ingest";
import { formatHousingCode } from "@/lib/housing-code";
import IndividualVerifyModal from "@/components/workflow/IndividualVerifyModal";
import {
  Users, AlertTriangle, FileSpreadsheet,
  Loader2, CheckCircle2, UserCheck, ShieldAlert,
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

  /** 한국부동산원 「전산검색 결과」 PDF (7가지 부적격 카테고리 자동 검출) */
  const householdSearchRef = useRef<HTMLInputElement>(null);
  const [uploadingHSearch, setUploadingHSearch] = useState(false);
  const [hSearchResult, setHSearchResult] = useState<{
    detected: number;
    marked: number;
    unmatched: Array<{ name: string; dong?: string; ho?: string; category?: string }>;
    samples: Array<{ category?: string; name: string; dong?: string; ho?: string; with: string[]; violation: string }>;
    byCategory: Record<string, number>;
  } | null>(null);

  /** 「당첨자 및 세대원 전산검색 결과」 PDF 업로드 → Gemini 파싱 → 부적격 자동 마킹 */
  const handleHouseholdSearchPdf = async (file: File) => {
    if (!selected) { alert("먼저 공고를 선택해주세요"); return; }
    setUploadingHSearch(true);
    setHSearchResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-household-search", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        alert(json?.error || `PDF 파싱 실패 (${res.status})`);
        return;
      }
      const violations: Array<any> = json.violations || [];
      const totals: Record<string, number> = json.perCategoryTotals || {};

      if (violations.length === 0) {
        const totalsLine = Object.entries(totals)
          .map(([k, v]) => `${k}=${v || 0}`)
          .join(" · ");
        alert(`검색결과: 모든 카테고리 위반자 없음.\\n${totalsLine || ""}`);
        setHSearchResult({ detected: 0, marked: 0, unmatched: [], samples: [], byCategory: totals });
        return;
      }

      const customers = localCustomers.listByAnnouncement(selected.id).filter((c) => !c.superseded);
      const unmasked = (s: string) => (s || "").replace(/\*/g, ".");
      let marked = 0;
      const unmatched: Array<{ name: string; dong?: string; ho?: string; category?: string }> = [];
      const byCategory: Record<string, number> = {};

      for (const v of violations) {
        byCategory[v.category || "기타"] = (byCategory[v.category || "기타"] || 0) + 1;
        const dong = String(v.dong || "").trim();
        const ho = String(v.ho || "").trim();
        const namePat = unmasked(v.name || "");

        let target: LocalCustomer | undefined;
        if (dong && ho) {
          target = customers.find((c) => {
            const cd = String((c as any).unit_dong || c.winner_info?.building || "").trim();
            const ch = String((c as any).unit_ho || c.winner_info?.unit_no || "").trim();
            return cd === dong && ch === ho;
          });
        }
        if (!target && namePat) {
          const re = new RegExp("^" + namePat + "$");
          target = customers.find((c) => re.test(c.name));
        }

        if (!target) {
          unmatched.push({ name: v.name, dong: v.dong, ho: v.ho, category: v.category });
          continue;
        }

        // 카테고리별 사유 구성
        let reason = `부적격 (${v.category || "기타"})`;
        if (v.category === "중복청약" && v.sameHouseholdWith?.length) {
          reason += ` — 같은 세대원: ${v.sameHouseholdWith.join(", ")}`;
        } else if (v.violatedHistory) {
          reason += ` — 이력: ${v.violatedHistory}`;
        } else if (v.violation) {
          reason += ` — ${v.violation}`;
        }

        const existing = (target.verification_reasons || []).filter((r) => !/부적격|중복당첨/.test(r));
        localCustomers.update(target.id, {
          verification_verdict: "ineligible",
          verification_reasons: [...existing, reason],
          verification_checked_at: new Date().toISOString(),
        });
        marked++;
      }

      setHSearchResult({
        detected: violations.length,
        marked,
        unmatched,
        samples: violations.slice(0, 8).map((v: any) => ({
          category: v.category,
          name: v.name,
          dong: v.dong,
          ho: v.ho,
          with: v.sameHouseholdWith || [],
          violation: v.violation || "",
        })),
        byCategory,
      });
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || "PDF 처리 실패");
    } finally {
      setUploadingHSearch(false);
      if (householdSearchRef.current) householdSearchRef.current.value = "";
    }
  };

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
              onClick={() => householdSearchRef.current?.click()}
              disabled={uploadingHSearch}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 shadow-sm whitespace-nowrap transition-colors disabled:opacity-40"
              title="한국부동산원 「전산검색 결과」 PDF (1~7페이지) → AI가 7가지 부적격 카테고리(가점제2년·당첨5년·중복청약·재당첨·특공1회·사전청약) 자동 검출 + 부적합 마킹"
            >
              {uploadingHSearch ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> AI 분석 중…</>
              ) : (
                <><ShieldAlert className="w-4 h-4" /> 전산검색 결과 PDF</>
              )}
            </button>
            <input
              ref={householdSearchRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleHouseholdSearchPdf(f);
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

          {/* 전산검색 결과 PDF 결과 (7가지 카테고리) */}
          {hSearchResult && (
            <div className="card mb-4 p-3 text-sm bg-red-50/70 border-red-200">
              <div className="flex items-center gap-2 flex-wrap">
                <ShieldAlert className="w-4 h-4 text-red-700" />
                <span className="font-semibold text-red-900">전산검색 결과 분석 완료</span>
                {hSearchResult.detected === 0 ? (
                  <span className="text-emerald-700">✓ 모든 카테고리 위반자 없음</span>
                ) : (
                  <>
                    <span className="text-red-800">위반자 {hSearchResult.detected}명 검출</span>
                    <span className="text-red-900 font-semibold">→ 부적합 자동 마킹 {hSearchResult.marked}건</span>
                    {hSearchResult.unmatched.length > 0 && (
                      <span className="text-amber-800">매칭 실패 {hSearchResult.unmatched.length}건</span>
                    )}
                  </>
                )}
              </div>

              {/* 카테고리별 카운트 */}
              {Object.keys(hSearchResult.byCategory).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 text-[10.5px]">
                  {Object.entries(hSearchResult.byCategory).map(([cat, n]) => (
                    <span key={cat} className="px-1.5 py-0.5 rounded bg-red-100 text-red-900 font-medium">
                      {cat}: {n}건
                    </span>
                  ))}
                </div>
              )}

              {hSearchResult.samples.length > 0 && (
                <details className="mt-2 text-[11px]" open>
                  <summary className="cursor-pointer text-red-900 font-semibold">
                    검출 샘플 ({hSearchResult.samples.length}건)
                  </summary>
                  <ul className="mt-1 ml-4 space-y-0.5 text-ink-2">
                    {hSearchResult.samples.map((s, i) => (
                      <li key={i}>
                        <span className="text-[9.5px] px-1 py-0 rounded bg-red-200 text-red-900 font-semibold mr-1">
                          {s.category || "기타"}
                        </span>
                        <strong>{s.dong || "?"}-{s.ho || "?"} {s.name}</strong>
                        {s.with.length > 0 && <span className="text-red-700"> ↔ 세대원: {s.with.join(", ")}</span>}
                        {s.violation && <span className="text-red-700"> — {s.violation}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {hSearchResult.unmatched.length > 0 && (
                <details className="mt-2 text-[11px]">
                  <summary className="cursor-pointer text-amber-900 font-semibold">
                    매칭 실패 ({hSearchResult.unmatched.length}건) — 1단계 명단에 없음 또는 동·호 불일치
                  </summary>
                  <ul className="mt-1 ml-4 space-y-0.5 text-amber-800">
                    {hSearchResult.unmatched.map((u, i) => (
                      <li key={i}>[{u.category || "기타"}] {u.dong || "?"}-{u.ho || "?"} {u.name}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-2 text-[10.5px] text-red-800/80">
                💡 7가지 부적격 카테고리 (가점제2년·당첨5년·중복청약·재당첨일반/특공·특공1회·사전청약) 자동 검출. 부적합 호수는 예비 승계 또는 선착순으로 처리.
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

          {/* [01] 당첨자 배우자 분리세대 세대원 검색요청 송부 관리 */}
          <SeparatedReportSection
            announcement={selected}
            onChange={() => setReloadKey((k) => k + 1)}
          />

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

/**
 * [01] 당첨자 배우자 분리세대 세대원 검색요청 송부 관리
 *
 * 청약홈 > 사업주체전용 > 당첨자 > 배우자분리세대 세대원 검색요청 > [01]당첨자 명단
 * 분리세대원이 등록된 당첨자 목록을 보여주고 송부 완료 마킹 관리.
 */
function SeparatedReportSection({
  announcement,
  onChange,
}: {
  announcement: LocalAnnouncement;
  onChange: () => void;
}) {
  const announcementId = announcement.id;
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ matched: number; unmatched: number; total: number } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const all = localCustomers.listByAnnouncement(announcementId).filter((c) => !c.superseded);
  const withSeparated = all.filter((c) => (c.separated_household_members || []).length > 0);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadResult(null);
    try {
      const buf = await file.arrayBuffer();
      const result = parseSeparatedExcel(buf);
      const customers = localCustomers.listByAnnouncement(announcementId);
      let matched = 0;
      let unmatched = 0;
      const nowIso = new Date().toISOString();
      for (const [winnerRrnFront, rows] of result.byWinnerRrn.entries()) {
        let target = customers.find((c) => (c.rrn_front || "").slice(0, 6) === winnerRrnFront);
        if (!target) {
          const first = rows[0];
          target = customers.find(
            (c) =>
              c.name === first.winnerName &&
              String(c.unit_dong || "") === String(first.winnerDong || "") &&
              String(c.unit_ho || "") === String(first.winnerHo || ""),
          );
        }
        if (!target) { unmatched++; continue; }
        const members = rows.map((r) => ({
          name: r.memberName,
          rrn: r.memberRrn,
          relation: r.relation,
          ...(r.note ? { note: r.note } : {}),
        }));
        localCustomers.update(target.id, {
          separated_household_members: members,
          separated_checked_at: nowIso,
        });
        matched++;
      }
      setUploadResult({ matched, unmatched, total: result.byWinnerRrn.size });
      setReloadKey((k) => k + 1);
      onChange();
    } catch (err: any) {
      alert(err?.message || "분리세대 명단 파싱 실패");
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  if (withSeparated.length === 0 && !uploadResult) {
    // 분리세대원이 아직 등록 안 된 상태 — 업로드만 유도
    return (
      <div className="card mb-4 p-3 bg-sky-50/60 border-sky-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold text-sky-900">
              [01] 당첨자 배우자 분리세대 세대원 검색요청 (선택)
            </h3>
            <p className="text-[11px] text-sky-800 mt-0.5">
              청약홈 자동조회 대상이 아닌 배우자 분리세대원이 있다면 명단 엑셀을 업로드하세요.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              ref={uploadRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
            />
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white text-xs font-semibold"
            >
              {uploading ? "업로드 중…" : "분리세대 명단 업로드"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // separated_property_checked_at(회신 들어옴)이 있으면 자동으로 송부 완료로 간주
  const pending = withSeparated.filter(
    (c) => !c.separated_reported_at && !c.separated_property_checked_at,
  );
  const reported = withSeparated.filter(
    (c) => c.separated_reported_at || c.separated_property_checked_at,
  );

  const markReported = (c: LocalCustomer) => {
    localCustomers.update(c.id, { separated_reported_at: new Date().toISOString() });
    setReloadKey((k) => k + 1);
    onChange();
  };
  const unmarkReported = (c: LocalCustomer) => {
    if (!confirm("[01] 송부 완료 표시를 해제할까요?")) return;
    localCustomers.update(c.id, { separated_reported_at: undefined });
    setReloadKey((k) => k + 1);
    onChange();
  };
  const markAllPending = () => {
    if (pending.length === 0) return;
    if (!confirm(`${pending.length}명을 일괄 송부 완료로 표시할까요?`)) return;
    const now = new Date().toISOString();
    for (const c of pending) localCustomers.update(c.id, { separated_reported_at: now });
    setReloadKey((k) => k + 1);
    onChange();
  };

  return (
    <div className="card mb-4 p-3 bg-sky-50/60 border-sky-200" key={reloadKey}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div>
          <h3 className="text-sm font-semibold text-sky-900">
            [01] 당첨자 배우자 분리세대 세대원 검색요청
          </h3>
          <p className="text-[11px] text-sky-800 mt-0.5">
            청약홈 &gt; 당첨자 &gt; 배우자분리세대 세대원 검색요청 &gt; [01]당첨자 명단 — 확인 즉시 송부
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="px-2 py-0.5 rounded bg-white border border-sky-200 text-sky-900">
            대상 <strong>{withSeparated.length}</strong>명
          </span>
          <span className="px-2 py-0.5 rounded bg-white border border-emerald-200 text-emerald-900">
            송부 완료 <strong>{reported.length}</strong>명
          </span>
          {pending.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-red-100 text-red-900 font-semibold">
              미송부 <strong>{pending.length}</strong>명
            </span>
          )}
          <input
            ref={uploadRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
          />
          <button
            onClick={() => uploadRef.current?.click()}
            disabled={uploading}
            className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white text-[10px] font-semibold"
            title="분리세대 명단 엑셀 추가 업로드"
          >
            {uploading ? "업로드 중" : "+ 명단 추가"}
          </button>
          <button
            onClick={() => exportSeparatedReportXlsx(withSeparated, announcement)}
            className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold"
            title="청약홈 [01] 메뉴 송부용 엑셀 다운로드"
          >
            [01] 엑셀 출력
          </button>
          <OfficialDocAttachment announcement={announcement} menuCode="01" compact onUpdate={onChange} />
        </div>
      </div>

      {uploadResult && (
        <div className="mb-2 px-2 py-1 rounded bg-sky-100 border border-sky-300 text-[11px] text-sky-900">
          분리세대 명단 업로드 — 당첨자 {uploadResult.total}명 중 매칭 <strong>{uploadResult.matched}명</strong>
          {uploadResult.unmatched > 0 && <span className="text-red-700"> · 실패 {uploadResult.unmatched}명 (당첨자 미등록 또는 이름·동호 불일치)</span>}
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-red-50 border border-red-200">
          <span className="text-[11px] text-red-800">
            🔴 분리세대원이 등록되어 있으나 [01] 미송부인 당첨자 <strong>{pending.length}명</strong>이 있습니다.
          </span>
          <button
            onClick={markAllPending}
            className="px-2 py-1 rounded bg-sky-700 hover:bg-sky-800 text-white text-[11px] font-semibold"
          >
            일괄 송부 완료 ({pending.length}명)
          </button>
        </div>
      )}

      <details className="text-[11px]">
        <summary className="cursor-pointer text-sky-900 font-semibold">송부 명단 펼치기</summary>
        <ul className="mt-2 space-y-1">
          {withSeparated.map((c) => {
            const isReported = !!(c.separated_reported_at || c.separated_property_checked_at);
            const memberCount = (c.separated_household_members || []).length;
            return (
              <li key={c.id} className="flex items-center justify-between p-1.5 rounded bg-white border border-sky-100">
                <span>
                  {isReported ? "✓ " : "○ "}
                  <strong>{c.name}</strong> · {c.unit_type || "—"} · 분리세대원 {memberCount}명
                  {c.separated_property_checked_at && (
                    <span className="ml-2 text-emerald-700">회신 수신됨</span>
                  )}
                  {c.separated_reported_at && !c.separated_property_checked_at && (
                    <span className="ml-2 text-sky-700">
                      송부 {new Date(c.separated_reported_at).toLocaleDateString()}
                    </span>
                  )}
                </span>
                {isReported && !c.separated_property_checked_at ? (
                  <button
                    onClick={() => unmarkReported(c)}
                    className="px-1.5 py-0.5 rounded border border-ink-300 text-[10px] text-ink-3 hover:bg-ink-50"
                  >
                    해제
                  </button>
                ) : !isReported ? (
                  <button
                    onClick={() => markReported(c)}
                    className="px-1.5 py-0.5 rounded bg-sky-600 hover:bg-sky-700 text-white text-[10px] font-semibold"
                  >
                    송부 완료
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
