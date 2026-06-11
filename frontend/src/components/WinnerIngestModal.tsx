"use client";

/**
 * 당첨자 파일 일괄 분석 모달
 *
 * 1) 여러 파일 drop/선택 → 2) 분석 진행 → 3) 파일별 인식 결과 + 취합된 프로필 미리보기
 * → 4) 기존 classifyIncoming 흐름으로 고객 등록 (신규/중복/충돌 처리)
 *
 * 이 모달은 당첨자 파일의 "읽기+취합"에 전념하고, 실제 고객 레코드 저장은
 * 부모(customers page)가 콜백으로 받아 처리한다.
 */

import { useCallback, useRef, useState } from "react";
import {
  ingestFiles,
  profileToCustomerPayload,
  formatRrn,
  WinnerProfile,
  ConsolidatedResult,
  FileKind,
} from "@/lib/winner-ingest";
import type { IncomingCustomer } from "@/lib/customer-dedup";
import {
  X, Upload, FileSpreadsheet, FileText, Loader2, CheckCircle2,
  AlertTriangle, Users, Home, Banknote, Trash2, Sparkles, ChevronRight,
} from "lucide-react";

const KIND_LABEL: Record<FileKind, { label: string; cls: string; icon: typeof FileText }> = {
  "lottery-results":        { label: "전산추첨결과",        cls: "bg-accent-soft text-accent",      icon: FileSpreadsheet },
  "lottery-results-masked": { label: "전산추첨결과(마스킹)", cls: "bg-accent-soft text-accent",         icon: FileSpreadsheet },
  "winner-pdf":             { label: "당첨자현황 PDF",     cls: "bg-surface2 text-ink-2",   icon: FileText },
  "confirmation-list":      { label: "정당 확인용",        cls: "bg-ok-soft text-ok", icon: FileSpreadsheet },
  "household-members":      { label: "세대원내역",         cls: "bg-warn-soft text-warn",     icon: Users },
  "info-desk":              { label: "인포용 명단",        cls: "bg-accent-soft text-accent",   icon: FileSpreadsheet },
  "additional-standbys":    { label: "추가 예비입주자",    cls: "bg-pink-100 text-pink-700",       icon: FileSpreadsheet },
  "property-ownership":     { label: "주택소유 검색결과",  cls: "bg-orange-100 text-orange-700",   icon: Home },
  "savings-priority-pdf":   { label: "청약통장 순위확인",  cls: "bg-teal-100 text-teal-700",       icon: Banknote },
  "unknown":                { label: "미식별",             cls: "bg-surface2 text-ink-2",       icon: AlertTriangle },
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** 분석 완료 후 "고객 등록" 버튼 클릭 시 호출 — 부모가 classifyIncoming 흐름을 돌린다 */
  onRegister: (candidates: IncomingCustomer[]) => void;
}

export default function WinnerIngestModal({ open, onClose, onRegister }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<ConsolidatedResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragActive, setDragActive] = useState(false);

  const reset = () => {
    setFiles([]);
    setResult(null);
    setSelectedIds(new Set());
  };

  const close = () => {
    reset();
    onClose();
  };

  const extractPdfText = useCallback(async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/extract-pdf-text", { method: "POST", body: fd });
    if (!res.ok) throw new Error((await res.json()).error || "PDF 텍스트 추출 실패");
    const d = await res.json();
    return d.text || "";
  }, []);

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    setFiles((p) => {
      const next = [...p];
      for (const f of arr) {
        if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
      }
      return next;
    });
    setResult(null);
  };

  const removeFile = (idx: number) => {
    setFiles((p) => p.filter((_, i) => i !== idx));
    setResult(null);
  };

  const analyze = async () => {
    if (files.length === 0) return;
    setAnalyzing(true);
    setResult(null);
    try {
      const r = await ingestFiles(files, extractPdfText);
      setResult(r);
      // 기본적으로 주민번호가 있는 모든 프로필을 선택
      const allIds = new Set<string>();
      r.profiles.forEach((p) => {
        if (p.rrn) allIds.add(p.rrn);
      });
      setSelectedIds(allIds);
    } catch (err: any) {
      alert(err?.message || "분석 실패");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRegister = () => {
    if (!result) return;
    const chosen = result.profiles.filter((p) => p.rrn && selectedIds.has(p.rrn));
    const candidates: IncomingCustomer[] = chosen.map((p) => profileToCustomerPayload(p));
    onRegister(candidates);
    close();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-border-soft flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-accent" />
              당첨자 파일 일괄 분석
            </h2>
            <p className="text-xs text-ink-3 mt-0.5">
              전산추첨결과·당첨자현황·세대원내역·주택소유검색·청약통장순위 등을 한 번에 업로드하면
              <br />
              주민번호 기준으로 자동 취합해 하나의 당첨자 프로필로 합칩니다.
            </p>
          </div>
          <button onClick={close} className="p-1 hover:bg-surface2 rounded-full">
            <X className="w-4 h-4 text-ink-3" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* 업로드 영역 */}
          {!result && (
            <div className="p-6">
              <div
                onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
                }}
                className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
                  dragActive ? "border-accent-line bg-accent-soft" : "border-border bg-surface2 hover:bg-surface2"
                }`}
              >
                <Upload className="w-10 h-10 mx-auto text-ink-4 mb-3" />
                <p className="text-sm font-medium text-ink-2">
                  엑셀/PDF 파일을 드래그하거나 클릭해서 여러 개 선택하세요
                </p>
                <p className="text-xs text-ink-3 mt-1">
                  .xlsx · .xls · .xlsm · .pdf
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 btn-primary text-sm inline-flex items-center gap-1"
                >
                  <Upload className="w-4 h-4" /> 파일 선택
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.xlsm,.pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
              </div>

              {files.length > 0 && (
                <div className="mt-5">
                  <div className="text-sm font-medium text-ink-2 mb-2">
                    선택된 파일 ({files.length}개)
                  </div>
                  <ul className="space-y-1.5">
                    {files.map((f, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 p-2 bg-surface2 rounded-lg text-sm"
                      >
                        {f.name.endsWith(".pdf") ? (
                          <FileText className="w-4 h-4 text-ink-3 flex-shrink-0" />
                        ) : (
                          <FileSpreadsheet className="w-4 h-4 text-ink-3 flex-shrink-0" />
                        )}
                        <span className="flex-1 truncate">{f.name}</span>
                        <span className="text-xs text-ink-4">
                          {(f.size / 1024).toFixed(1)}KB
                        </span>
                        <button
                          onClick={() => removeFile(i)}
                          className="p-0.5 hover:bg-border rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-ink-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* 분석 결과 */}
          {result && (
            <div className="p-6 space-y-5">
              {/* 파일별 인식 결과 */}
              <div>
                <h3 className="text-sm font-semibold text-ink mb-2">
                  파일별 인식 결과 ({result.files.length}개)
                </h3>
                <div className="space-y-2">
                  {result.files.map((f, i) => {
                    const meta = KIND_LABEL[f.kind];
                    const Icon = meta.icon;
                    const count =
                      f.winners.length +
                      f.householdMembers.length +
                      f.properties.length +
                      f.savings.length;
                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-3 p-3 rounded-lg border ${
                          f.kind === "unknown" ? "border-border bg-warn-soft" : "border-border bg-surface"
                        }`}
                      >
                        <Icon className="w-4 h-4 text-ink-3 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{f.fileName}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${meta.cls}`}>
                              {meta.label}
                            </span>
                          </div>
                          <p className="text-xs text-ink-3 mt-0.5">
                            {f.label}
                            {count > 0 && <span className="text-ink-4"> · {count}건 인식</span>}
                          </p>
                          {f.notes.length > 0 && (
                            <p className="text-xs text-warn mt-0.5">{f.notes.join(" · ")}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 공통 공고 정보 */}
              {(result.announcement?.no || result.announcement?.date) && (
                <div className="p-3 rounded-lg bg-accent-soft border border-accent-line text-xs text-accent">
                  <strong>공통 공고 정보</strong>
                  {result.announcement.no && <> · 관리번호 <strong>{result.announcement.no}</strong></>}
                  {result.announcement.date && <> · 당첨자발표일 <strong>{result.announcement.date}</strong></>}
                </div>
              )}

              {/* 당첨자/예비 요약 */}
              {(() => {
                const total = result.profiles.length;
                const winners = result.profiles.filter((p) => !p.isStandby).length;
                const standbys = result.profiles.filter((p) => p.isStandby).length;
                return (
                  <div className="p-3 rounded-lg bg-surface2 border border-border text-xs text-ink-2 flex items-center gap-4 flex-wrap">
                    <div>
                      <span className="text-ink-3">총</span> <strong className="text-ink">{total}명</strong>
                    </div>
                    <div className="h-3 w-px bg-border" />
                    <div>
                      <span className="text-accent">당첨자</span>{" "}
                      <strong className="text-accent">{winners}명</strong>
                    </div>
                    <div>
                      <span className="text-warn">예비입주자</span>{" "}
                      <strong className="text-warn">{standbys}명</strong>
                    </div>
                    <div className="text-[10px] text-ink-3 ml-auto">
                      예비는 당첨자가 부적합·포기할 때 자동 승계 후보로 보관됩니다
                    </div>
                  </div>
                );
              })()}

              {/* 취합된 프로필 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-ink">
                    취합된 프로필 ({result.profiles.length}명)
                  </h3>
                  <div className="text-xs text-ink-3">
                    선택 <strong className="text-accent">{selectedIds.size}</strong> / {result.profiles.length}
                  </div>
                </div>
                {result.profiles.length === 0 ? (
                  <div className="p-6 text-center text-sm text-ink-4 border border-dashed border-border rounded-lg">
                    추출된 당첨자가 없습니다
                  </div>
                ) : (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="max-h-96 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-surface2 sticky top-0 z-10">
                          <tr className="border-b border-border">
                            <th className="text-left px-3 py-2 w-10">
                              <input
                                type="checkbox"
                                checked={result.profiles.filter(p => p.rrn).length > 0 && selectedIds.size === result.profiles.filter(p => p.rrn).length}
                                onChange={() => {
                                  if (selectedIds.size === result.profiles.filter(p => p.rrn).length) {
                                    setSelectedIds(new Set());
                                  } else {
                                    setSelectedIds(new Set(result.profiles.filter(p => p.rrn).map(p => p.rrn!)));
                                  }
                                }}
                                className="w-3.5 h-3.5 accent-blue-600"
                              />
                            </th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">성명</th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">주민번호</th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">공급</th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">주택형</th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">동·호</th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">연락처</th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">점수</th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">세대원</th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">주택</th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">통장</th>
                            <th className="text-left px-3 py-2 font-medium text-ink-2">출처</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...result.profiles]
                            .sort((a, b) => {
                              // 당첨자 먼저, 그다음 예비
                              if (!!a.isStandby !== !!b.isStandby) return a.isStandby ? 1 : -1;
                              // 같은 구분 내에서는 예비순위/이름순
                              if (a.isStandby && b.isStandby) {
                                const ar = parseInt(a.standbyRank || "999", 10);
                                const br = parseInt(b.standbyRank || "999", 10);
                                if (ar !== br) return ar - br;
                              }
                              return (a.name || "").localeCompare(b.name || "");
                            })
                            .map((p, i) => {
                            const id = p.rrn || `${p.name}-${p.phone || i}`;
                            const checked = p.rrn ? selectedIds.has(p.rrn) : false;
                            const supply =
                              p.supplyCategory === "일반공급"
                                ? "일반공급"
                                : p.specialType || "—";
                            return (
                              <tr
                                key={id}
                                className={`border-t border-border-soft hover:bg-surface2 ${
                                  p.isStandby ? "bg-warn-soft/40" : ""
                                }`}
                              >
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    disabled={!p.rrn}
                                    checked={checked}
                                    onChange={() => {
                                      if (!p.rrn) return;
                                      setSelectedIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(p.rrn!)) next.delete(p.rrn!);
                                        else next.add(p.rrn!);
                                        return next;
                                      });
                                    }}
                                    className="w-3.5 h-3.5 accent-blue-600"
                                  />
                                </td>
                                <td className="px-3 py-2 font-medium">{p.name}</td>
                                <td className="px-3 py-2 font-mono text-[10px] text-ink-2">
                                  {p.rrn ? formatRrn(p.rrn) : (p.rrnMasked || "—")}
                                </td>
                                <td className="px-3 py-2">
                                  {p.isStandby ? (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] bg-amber-200 text-warn px-1.5 py-0.5 rounded font-medium mr-1">
                                      예비 {p.standbyRank || "—"}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] bg-accent-soft text-accent px-1.5 py-0.5 rounded font-medium mr-1">
                                      당첨
                                    </span>
                                  )}
                                  {supply}
                                </td>
                                <td className="px-3 py-2 font-mono text-[10px]">{p.unitType || "—"}</td>
                                <td className="px-3 py-2">{p.dong && p.ho ? `${p.dong}·${p.ho}` : "—"}</td>
                                <td className="px-3 py-2">{p.phone || "—"}</td>
                                <td className="px-3 py-2">
                                  {p.scores?.총점 !== undefined ? (
                                    <span className="font-bold text-accent">{p.scores.총점}점</span>
                                  ) : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  {p.householdMembers?.length ? (
                                    <span className="inline-flex items-center gap-0.5 text-warn">
                                      <Users className="w-3 h-3" /> {p.householdMembers.length}
                                    </span>
                                  ) : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  {p.properties?.length ? (
                                    <span className="inline-flex items-center gap-0.5 text-orange-700">
                                      <Home className="w-3 h-3" /> {p.properties.length}
                                    </span>
                                  ) : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  {p.savingsPriority ? (
                                    p.savingsPriority.verified ? (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-ok" />
                                    ) : (
                                      <AlertTriangle className="w-3.5 h-3.5 text-warn" />
                                    )
                                  ) : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-0.5">
                                    {(p.sourceKinds || []).map((k) => (
                                      <span
                                        key={k}
                                        className={`text-[9px] px-1 py-0.5 rounded ${KIND_LABEL[k].cls}`}
                                        title={KIND_LABEL[k].label}
                                      >
                                        {KIND_LABEL[k].label.slice(0, 4)}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* 매칭 안 된 주택소유 */}
              {result.unmatched.properties.length > 0 && (
                <div className="p-3 rounded-lg bg-warn-soft border border-border text-xs text-warn">
                  <strong>주의:</strong> 당첨자/세대원과 매칭되지 않은 주택소유 레코드가 {result.unmatched.properties.length}건 있습니다.
                  (세대원내역이 업로드되지 않았거나 주민번호가 일치하지 않을 수 있습니다)
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border-soft flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-ink-3">
            {!result && files.length > 0 && `${files.length}개 파일 분석 준비`}
            {result && `총 ${result.profiles.length}명 · ${result.files.length}개 파일`}
          </div>
          <div className="flex gap-2">
            <button onClick={close} className="btn-secondary text-sm">닫기</button>
            {!result ? (
              <button
                onClick={analyze}
                disabled={files.length === 0 || analyzing}
                className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                {analyzing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> 분석 시작</>
                )}
              </button>
            ) : (
              <>
                <button onClick={reset} className="btn-secondary text-sm">다시 업로드</button>
                <button
                  onClick={handleRegister}
                  disabled={selectedIds.size === 0}
                  className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4" /> {selectedIds.size}명 고객 등록
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
