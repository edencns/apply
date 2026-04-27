"use client";

/**
 * Stage 6: 명의변경 (배치 처리)
 *
 * 흐름:
 *   1. 담당자가 여러 PDF 스캔본을 드래그·드롭 (파일명 = "동-호수")
 *   2. 파일명 파싱 → 해당 당첨자 자동 매칭
 *   3. 매칭된 파일만 Gemini Vision에 순차 전송 → 구조화 JSON 추출
 *   4. 테이블에 결과 표시 → 담당자 검토 → 일괄 승인
 *   5. 각 당첨자 레코드에 title_transfer 저장 + audit_log 기록
 */

import { useRef, useState, useMemo } from "react";
import WorkflowShell, { WORKFLOW_STEPS } from "@/components/workflow/WorkflowShell";
import {
  localCustomers,
  type LocalAnnouncement,
  type LocalCustomer,
} from "@/lib/local-store";
import {
  FileText, Upload, Loader2, CheckCircle2, AlertTriangle,
  Eye, X, Search, UserCheck, ArrowRight, FilePlus,
} from "lucide-react";

// 인덱스 대신 key 검색 — 단계 순서 바뀌어도 안전
const step = WORKFLOW_STEPS.find((s) => s.key === "transfers")!;

type Reason = "상속" | "배우자증여" | "부모자녀증여" | "이혼재산분할" | "전매" | "기타";

/** 파일 1건 파싱 결과 (Gemini 응답) */
interface ParseResult {
  filename: string;
  reason: Reason;
  transferDate?: string | null;
  oldHolder?: {
    name?: string | null;
    rrn?: string | null;
    address?: string | null;
    dong?: string | null;
    ho?: string | null;
  };
  newHolder?: {
    name?: string | null;
    rrn?: string | null;
    address?: string | null;
    phone?: string | null;
    relation?: string | null;
  };
  submittedDocuments?: string[];
  confidence?: "high" | "med" | "low";
  notes?: string | null;
  durationMs?: number;
}

/** 파일명 → { dong, ho } 추출 (101-1001.pdf → {101, 1001}) */
function parseFilename(name: string): { dong: string; ho: string } | null {
  const base = name.replace(/\.pdf$/i, "").trim();
  const m = base.match(/^(\d{2,4})[-_](\d{1,5})/);
  if (!m) return null;
  return { dong: m[1], ho: m[2] };
}

/** 당첨자 레코드에서 동·호 추출 (unit_dong / unit_ho 또는 eligibility_rules 등) */
function getCustomerDongHo(c: LocalCustomer): { dong?: string; ho?: string } {
  const rawDong = (c as any).unit_dong || (c as any).dong;
  const rawHo = (c as any).unit_ho || (c as any).ho;
  return {
    dong: rawDong ? String(rawDong) : undefined,
    ho: rawHo ? String(rawHo) : undefined,
  };
}

/** 업로드된 파일의 상태 */
type FileStatus = "queued" | "parsing" | "done" | "error" | "unmatched";

interface FileRow {
  file: File;
  filename: string;
  dong: string;
  ho: string;
  status: FileStatus;
  matchedCustomerId?: number;
  matchedCustomerName?: string;
  result?: ParseResult;
  error?: string;
  originalFileUrl?: string; // 업로드 성공 후 프록시 URL
}

const REASON_COLORS: Record<Reason, string> = {
  "상속": "bg-rose-100 text-rose-800",
  "배우자증여": "bg-purple-100 text-purple-800",
  "부모자녀증여": "bg-indigo-100 text-indigo-800",
  "이혼재산분할": "bg-amber-100 text-amber-800",
  "전매": "bg-emerald-100 text-emerald-800",
  "기타": "bg-gray-100 text-gray-700",
};

const CONF_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-800",
  med: "bg-amber-100 text-amber-800",
  low: "bg-red-100 text-red-800",
};

export default function TransfersStepPage() {
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [previewRow, setPreviewRow] = useState<FileRow | null>(null);
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customers = selected
    ? localCustomers.listByAnnouncement(selected.id).filter((c) => !c.superseded)
    : [];

  // ── 파일 선택 ──
  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!selected) { alert("먼저 공고를 선택해주세요."); return; }

    const newRows: FileRow[] = [];
    const seen = new Set(rows.map((r) => r.filename));

    for (const file of Array.from(files)) {
      if (seen.has(file.name)) continue;
      if (!file.name.toLowerCase().endsWith(".pdf")) continue;
      const parsed = parseFilename(file.name);
      const row: FileRow = {
        file,
        filename: file.name,
        dong: parsed?.dong || "",
        ho: parsed?.ho || "",
        status: parsed ? "queued" : "unmatched",
      };

      // 파일명으로 당첨자 매칭
      if (parsed) {
        const match = customers.find((c) => {
          const { dong, ho } = getCustomerDongHo(c);
          return dong === parsed.dong && ho === parsed.ho;
        });
        if (match) {
          row.matchedCustomerId = match.id;
          row.matchedCustomerName = match.name;
        } else {
          row.status = "unmatched";
        }
      }
      newRows.push(row);
    }
    setRows((prev) => [...prev, ...newRows]);
  };

  // ── 배치 AI 파싱 ──
  const handleParseAll = async () => {
    if (!selected) return;
    const queued = rows.filter((r) => r.status === "queued");
    if (queued.length === 0) return;

    setParsing(true);
    try {
      // 순차 처리 (Gemini rate limit + 안정성)
      for (const row of queued) {
        setRows((prev) =>
          prev.map((r) => (r.filename === row.filename ? { ...r, status: "parsing" } : r)),
        );
        try {
          // 1) 원본 PDF를 Vercel Blob에 업로드 (프록시 URL 확보)
          let originalFileUrl: string | undefined;
          try {
            const upFd = new FormData();
            upFd.append("file", row.file);
            upFd.append("kind", "other");
            upFd.append("announcement_id", String(selected.id));
            const upRes = await fetch("/api/files/upload", { method: "POST", body: upFd });
            if (upRes.ok) {
              const upJson = await upRes.json();
              originalFileUrl = upJson?.url;
            }
          } catch {
            /* 업로드 실패해도 파싱은 계속 */
          }

          // 2) Gemini Vision으로 파싱
          const fd = new FormData();
          fd.append("file", row.file);
          const res = await fetch("/api/parse-title-transfer", { method: "POST", body: fd });
          const json = await res.json();
          if (!res.ok || !json?.success) {
            throw new Error(json?.error || `파싱 실패 (${res.status})`);
          }
          const result: ParseResult = {
            filename: json.filename,
            reason: json.reason || "기타",
            transferDate: json.transferDate,
            oldHolder: json.oldHolder,
            newHolder: json.newHolder,
            submittedDocuments: json.submittedDocuments || [],
            confidence: json.confidence,
            notes: json.notes,
            durationMs: json.durationMs,
          };
          setRows((prev) =>
            prev.map((r) =>
              r.filename === row.filename
                ? { ...r, status: "done", result, originalFileUrl }
                : r,
            ),
          );
        } catch (err: any) {
          setRows((prev) =>
            prev.map((r) =>
              r.filename === row.filename
                ? { ...r, status: "error", error: err?.message || "파싱 실패" }
                : r,
            ),
          );
        }
      }
    } finally {
      setParsing(false);
    }
  };

  // ── 일괄 승인 ──
  const handleApproveAll = async () => {
    const toApprove = rows.filter(
      (r) => r.status === "done" && r.matchedCustomerId && r.result,
    );
    if (toApprove.length === 0) {
      alert("승인 가능한 파일이 없습니다.");
      return;
    }
    if (!confirm(`${toApprove.length}건을 일괄 승인하시겠습니까?`)) return;

    setApproving(true);
    try {
      for (const row of toApprove) {
        const r = row.result!;
        localCustomers.update(row.matchedCustomerId!, {
          title_transfer: {
            reason: r.reason,
            transferDate: r.transferDate || undefined,
            oldHolder: r.oldHolder ? {
              name: r.oldHolder.name || undefined,
              rrn: r.oldHolder.rrn || undefined,
              address: r.oldHolder.address || undefined,
            } : undefined,
            newHolder: r.newHolder ? {
              name: r.newHolder.name || undefined,
              rrn: r.newHolder.rrn || undefined,
              address: r.newHolder.address || undefined,
              phone: r.newHolder.phone || undefined,
              relation: r.newHolder.relation || undefined,
            } : undefined,
            submittedDocuments: r.submittedDocuments || [],
            originalFileUrl: row.originalFileUrl,
            originalFileName: row.filename,
            aiConfidence: r.confidence,
            aiNotes: r.notes || undefined,
            createdAt: new Date().toISOString(),
          },
        });
      }
      alert(`${toApprove.length}건 승인 완료. 각 당첨자 상세 페이지에서 확인 가능합니다.`);
      // 승인된 건은 상태 clear (재승인 방지)
      setRows((prev) =>
        prev.map((r) =>
          toApprove.some((t) => t.filename === r.filename)
            ? { ...r, status: "done" as FileStatus, approved: true } as any
            : r,
        ),
      );
    } finally {
      setApproving(false);
    }
  };

  // ── 필터링 ──
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.filename, r.dong, r.ho, r.matchedCustomerName, r.result?.newHolder?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const stats = useMemo(() => {
    return {
      total: rows.length,
      matched: rows.filter((r) => r.matchedCustomerId).length,
      unmatched: rows.filter((r) => !r.matchedCustomerId).length,
      queued: rows.filter((r) => r.status === "queued").length,
      done: rows.filter((r) => r.status === "done").length,
      error: rows.filter((r) => r.status === "error").length,
      lowConf: rows.filter((r) => r.result?.confidence === "low").length,
    };
  }, [rows]);

  return (
    <WorkflowShell step={step} selected={selected} onSelect={setSelected}>
      {selected && (
        <>
          {/* 안내 */}
          <div className="mb-4 p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-xs text-indigo-900">
            <div className="font-semibold mb-1">📋 명의변경 배치 처리 — 계약 체결 이후 단계</div>
            <p className="text-indigo-800 mb-2">
              <strong>당첨·서류 판정·계약 체결까지 완료한 분양권</strong>이 상속·증여·이혼·전매 등으로
              다른 명의자에게 넘어간 세대를 처리합니다. 서류 스캔본을 일괄 업로드하면 AI가
              신·구 명의자와 사유를 자동 추출하고, 각 당첨자 레코드에 명의변경 이력으로 저장됩니다.
            </p>
            <ol className="list-decimal list-inside space-y-0.5 text-indigo-800">
              <li>파일명은 <strong>동-호수</strong> 형식이어야 자동 매칭됩니다 (예: <code>101-101.pdf</code>, <code>102-1204.pdf</code>).</li>
              <li>PDF들을 한 번에 선택해 업로드하면 AI(Gemini)가 각 파일에서 사유·신구 명의자·관계를 추출합니다.</li>
              <li>검토 후 [일괄 승인]으로 각 당첨자 레코드에 명의변경 이력이 저장되며, 감사 로그에도 기록됩니다.</li>
              <li>낮은 신뢰도(low)나 매칭 실패 건은 별도 검토 후 수동 처리 필요.</li>
            </ol>
          </div>

          {/* 업로드 툴바 */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm"
            >
              <FilePlus className="w-4 h-4" /> 스캔본 선택 (여러 파일)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <button
              onClick={handleParseAll}
              disabled={parsing || stats.queued === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 shadow-sm disabled:opacity-40"
              title={stats.queued === 0 ? "대기 중인 파일 없음" : `${stats.queued}건 AI 파싱 시작`}
            >
              {parsing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> AI 파싱 중…</>
              ) : (
                <><FileText className="w-4 h-4" /> AI 파싱 시작 ({stats.queued})</>
              )}
            </button>
            <button
              onClick={handleApproveAll}
              disabled={approving || stats.done === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-40"
            >
              {approving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 저장 중…</>
              ) : (
                <><CheckCircle2 className="w-4 h-4" /> 일괄 승인 ({stats.done})</>
              )}
            </button>
            <button
              onClick={() => setRows([])}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-ink-2 bg-surface2 hover:bg-surface border border-border disabled:opacity-40"
            >
              초기화
            </button>
            <div className="ml-auto flex items-center gap-1 border border-border rounded-lg px-2 py-1.5 bg-white">
              <Search className="w-3.5 h-3.5 text-ink-4" />
              <input
                placeholder="파일명·당첨자·신명의자 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="text-xs outline-none w-52"
              />
            </div>
          </div>

          {/* 통계 */}
          {rows.length > 0 && (
            <div className="mb-3 flex gap-2 text-xs flex-wrap">
              <span className="px-2 py-1 rounded bg-gray-100 text-ink-2">전체 <strong>{stats.total}</strong></span>
              <span className="px-2 py-1 rounded bg-green-50 text-green-800">매칭 <strong>{stats.matched}</strong></span>
              {stats.unmatched > 0 && (
                <span className="px-2 py-1 rounded bg-red-50 text-red-800">매칭 실패 <strong>{stats.unmatched}</strong></span>
              )}
              <span className="px-2 py-1 rounded bg-blue-50 text-blue-800">파싱 완료 <strong>{stats.done}</strong></span>
              {stats.error > 0 && (
                <span className="px-2 py-1 rounded bg-rose-50 text-rose-800">파싱 실패 <strong>{stats.error}</strong></span>
              )}
              {stats.lowConf > 0 && (
                <span className="px-2 py-1 rounded bg-amber-50 text-amber-800">낮은 신뢰도 <strong>{stats.lowConf}</strong></span>
              )}
            </div>
          )}

          {/* 테이블 */}
          {rows.length === 0 ? (
            <div
              className="border-2 border-dashed border-border-soft rounded-lg py-16 text-center text-ink-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <div className="text-sm mb-1">PDF 파일을 여기로 드래그하거나 상단 버튼으로 선택</div>
              <div className="text-[11px] text-ink-4">파일명 형식: <code>101-101.pdf</code>, <code>102-1204.pdf</code></div>
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface2 border-b border-border-soft">
                  <tr>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wide">파일 · 동호</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wide">상태</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wide">기존 당첨자</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wide">사유</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wide">신 명의자</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wide">관계</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wide">신뢰도</th>
                    <th className="text-right px-3 py-2 text-[11px] font-semibold text-ink-3 uppercase tracking-wide"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => {
                    const approved = (row as any).approved;
                    return (
                      <tr key={row.filename} className={`border-t border-border-soft ${approved ? "opacity-60" : ""}`}>
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs text-ink">{row.dong && row.ho ? `${row.dong}-${row.ho}` : "—"}</div>
                          <div className="text-[10px] text-ink-3 truncate max-w-[180px]" title={row.filename}>
                            {row.filename}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={row.status} error={row.error} approved={approved} />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.matchedCustomerName ? (
                            <div className="flex items-center gap-1">
                              <UserCheck className="w-3 h-3 text-green-600" />
                              <span className="text-ink">{row.matchedCustomerName}</span>
                            </div>
                          ) : (
                            <span className="text-red-700 text-[11px]">매칭 실패</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.result?.reason ? (
                            <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${REASON_COLORS[row.result.reason]}`}>
                              {row.result.reason}
                            </span>
                          ) : <span className="text-ink-4 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.result?.newHolder?.name ? (
                            <div>
                              <div className="text-ink">{row.result.newHolder.name}</div>
                              {row.result.newHolder.rrn && (
                                <div className="text-[10px] text-ink-3 font-mono">{row.result.newHolder.rrn}</div>
                              )}
                            </div>
                          ) : <span className="text-ink-4">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-2">
                          {row.result?.newHolder?.relation || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row.result?.confidence ? (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CONF_COLORS[row.result.confidence]}`}>
                              {row.result.confidence.toUpperCase()}
                            </span>
                          ) : <span className="text-ink-4">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => setPreviewRow(row)}
                            disabled={row.status === "queued" || row.status === "parsing"}
                            className="text-xs text-accent hover:underline inline-flex items-center gap-0.5 disabled:opacity-40"
                            title="상세 보기"
                          >
                            <Eye className="w-3 h-3" /> 상세
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 상세 모달 */}
          {previewRow && (
            <PreviewModal row={previewRow} onClose={() => setPreviewRow(null)} />
          )}
        </>
      )}
    </WorkflowShell>
  );
}

function StatusBadge({
  status, error, approved,
}: { status: FileStatus; error?: string; approved?: boolean }) {
  if (approved) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-medium">
        <CheckCircle2 className="w-3 h-3" /> 승인됨
      </span>
    );
  }
  if (status === "queued") {
    return <span className="text-[11px] text-ink-3">대기 중</span>;
  }
  if (status === "parsing") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-blue-700">
        <Loader2 className="w-3 h-3 animate-spin" /> 파싱 중…
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">
        <CheckCircle2 className="w-3 h-3" /> 파싱 완료
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-medium" title={error || ""}>
        <AlertTriangle className="w-3 h-3" /> 실패
      </span>
    );
  }
  if (status === "unmatched") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
        <AlertTriangle className="w-3 h-3" /> 동호 미인식
      </span>
    );
  }
  return null;
}

function PreviewModal({ row, onClose }: { row: FileRow; onClose: () => void }) {
  const r = row.result;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-border-soft flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{row.dong}-{row.ho} 명의변경 상세</h2>
            <p className="text-xs text-ink-3 mt-0.5">{row.filename}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface2 rounded-full">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {row.status === "error" && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
              ❌ {row.error}
            </div>
          )}
          {r && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <InfoCard label="사유">
                  <span className={`text-sm px-2 py-0.5 rounded ${REASON_COLORS[r.reason]}`}>
                    {r.reason}
                  </span>
                </InfoCard>
                <InfoCard label="신뢰도">
                  <span className={`text-sm px-2 py-0.5 rounded ${CONF_COLORS[r.confidence || "med"]}`}>
                    {r.confidence?.toUpperCase() || "—"}
                  </span>
                </InfoCard>
                <InfoCard label="명의변경일">
                  <span className="text-sm font-mono">{r.transferDate || "—"}</span>
                </InfoCard>
                <InfoCard label="관계">
                  <span className="text-sm">{r.newHolder?.relation || "—"}</span>
                </InfoCard>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <HolderCard title="기존 명의자" data={r.oldHolder} />
                <div className="flex items-center justify-center">
                  <ArrowRight className="w-6 h-6 text-ink-3" />
                </div>
              </div>
              <HolderCard title="신 명의자" data={r.newHolder} />

              {r.submittedDocuments && r.submittedDocuments.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-ink-3 mb-1">제출 서류 ({r.submittedDocuments.length}종)</div>
                  <div className="flex flex-wrap gap-1">
                    {r.submittedDocuments.map((d, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-ink-2">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {r.notes && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <strong>📌 특이사항:</strong> {r.notes}
                </div>
              )}

              {row.originalFileUrl && (
                <a
                  href={row.originalFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs hover:bg-indigo-700"
                >
                  <FileText className="w-3.5 h-3.5" /> 원본 스캔본 열기
                </a>
              )}

              {r.durationMs && (
                <div className="text-[10px] text-ink-4 text-right">
                  ⏱ Gemini 처리: {(r.durationMs / 1000).toFixed(1)}초
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-2.5 rounded-lg border border-border bg-surface2/40">
      <div className="text-[10px] text-ink-3 mb-1 uppercase tracking-wide">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function HolderCard({ title, data }: { title: string; data?: ParseResult["oldHolder"] | ParseResult["newHolder"] }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-white">
      <div className="text-xs font-semibold text-ink-2 mb-2">{title}</div>
      {data ? (
        <div className="space-y-1 text-xs">
          <div><span className="text-ink-3 mr-2">성명</span><span className="font-medium">{data.name || "—"}</span></div>
          <div><span className="text-ink-3 mr-2">주민번호</span><span className="font-mono">{data.rrn || "—"}</span></div>
          <div><span className="text-ink-3 mr-2">주소</span><span>{(data as any).address || "—"}</span></div>
          {(data as any).phone && (
            <div><span className="text-ink-3 mr-2">연락처</span><span className="font-mono">{(data as any).phone}</span></div>
          )}
        </div>
      ) : <div className="text-xs text-ink-4">추출 정보 없음</div>}
    </div>
  );
}
