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
  Loader2, CheckCircle2, UserCheck, UserMinus, FileText, ShieldAlert,
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
