"use client";

/**
 * 방문 계약 페이지 (공고별 관리)
 * - 상단에서 공고 선택
 * - 상담원이 고객 성명 + 주민번호 앞 6자리 입력
 * - 즉시 해당 계약서 로딩
 * - 고객이 내용 확인 후 전자서명
 * - 서명 완료 즉시 PDF 출력
 */

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { contractsApi, api } from "@/lib/api";
import {
  localAnnouncements, localContracts, localCustomers, activeAnnouncement,
  isNetworkError, LocalAnnouncement, LocalContract,
} from "@/lib/local-store";
import {
  Search, CheckCircle, XCircle, Download, PenLine, BookOpen, ChevronRight,
} from "lucide-react";
import AnnouncementPicker from "@/components/AnnouncementPicker";
import { getSampleAsLocalAnnouncements } from "@/lib/sample-adapter";
import SignatureCanvas from "react-signature-canvas";

type Step = "lookup" | "review" | "sign" | "complete";

interface ContractInfo {
  found: boolean;
  customer_id?: number;
  customer_name?: string;
  contract_id?: number;
  contract_no?: string;
  unit_number?: string;
  unit_type?: string;
  total_price?: number;
  status?: string;
  review_status?: string;
  review_issues?: any[];
  payment_schedule?: any[];
  deposit_confirmed?: boolean;
  _local?: boolean;
}

function WalkInPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryAnnId = searchParams.get("announcementId");

  const [announcements, setAnnouncements] = useState<LocalAnnouncement[]>([]);
  const [selectedAnn, setSelectedAnn] = useState<LocalAnnouncement | null>(null);

  const [step, setStep] = useState<Step>("lookup");
  const [name, setName] = useState("");
  const [rrnFront, setRrnFront] = useState("");
  const [contractInfo, setContractInfo] = useState<ContractInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sigRef = useRef<SignatureCanvas>(null);

  // ─── 공고 목록 로딩 ────────────────────────────────────
  const loadAnnouncements = useCallback(async () => {
    const local = localAnnouncements.listAll();
    const samples = getSampleAsLocalAnnouncements();
    try {
      const r = await api.get(`/announcements/`);
      const backend = Array.isArray(r.data) ? r.data : [];
      const merged: any[] = [...backend];
      for (const l of local) {
        if (!merged.some((a: any) => a.id === l.id)) merged.push(l);
      }
      for (const s of samples) {
        if (!merged.some((a: any) => a.id === s.id)) merged.push(s);
      }
      setAnnouncements(merged);
      return merged;
    } catch {
      const combined = [...local, ...samples];
      setAnnouncements(combined);
      return combined;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const list = await loadAnnouncements();
      const active = activeAnnouncement.get();
      let target: LocalAnnouncement | null = null;
      if (queryAnnId) target = list.find((a: LocalAnnouncement) => a.id === Number(queryAnnId)) || null;
      if (!target && active) target = list.find((a: LocalAnnouncement) => a.id === active.id) || (active.snapshot as LocalAnnouncement | null);
      if (!target && list.length > 0) target = list[0];
      if (target) setSelectedAnn(target);
    })();
  }, [loadAnnouncements, queryAnnId]);

  useEffect(() => {
    if (selectedAnn) {
      activeAnnouncement.set(
        { id: selectedAnn.id, title: selectedAnn.title, announcement_no: selectedAnn.announcement_no },
        "local", selectedAnn,
      );
    }
  }, [selectedAnn]);

  const handleLookup = async () => {
    if (!selectedAnn) { setError("먼저 공고를 선택해주세요"); return; }
    if (!name.trim() || rrnFront.length !== 6) {
      setError("성명과 주민번호 앞 6자리를 입력해주세요");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await contractsApi.walkIn({
        name: name.trim(),
        rrn_front: rrnFront,
        site_id: selectedAnn.site_id,
        announcement_id: selectedAnn.id,
      } as any);
      setContractInfo(res.data);
      if (res.data.found) setStep("review");
      else setError("해당 고객의 계약서를 찾을 수 없습니다");
    } catch (e: any) {
      if (isNetworkError(e) || e?.response?.status === 404) {
        // 로컬 계약서 조회
        let c = localContracts.findByName(selectedAnn.id, name.trim());

        // 고객 정보에 매칭되면 즉석 계약서 생성
        if (!c) {
          const cust = localCustomers.listByAnnouncement(selectedAnn.id).find(
            (x) => x.name === name.trim() && (x.rrn_front || "") === rrnFront,
          );
          if (cust) {
            c = localContracts.create({
              announcement_id: selectedAnn.id,
              customer_id: cust.id,
              customer_name: cust.name,
              unit_number: "",
              unit_type: "",
              total_price: 0,
            });
          }
        }

        if (c) {
          setContractInfo({
            found: true,
            contract_id: c.id,
            contract_no: c.contract_no,
            customer_name: c.customer_name,
            unit_number: c.unit_number,
            unit_type: c.unit_type,
            total_price: c.total_price,
            status: c.status,
            review_status: "passed",
            review_issues: [],
            payment_schedule: [],
            deposit_confirmed: false,
            _local: true,
          });
          setStep("review");
        } else {
          setError("이 공고에 등록된 계약서/고객이 없습니다");
        }
      } else {
        setError(e.response?.data?.detail || "조회 중 오류가 발생했습니다");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("서명을 입력해주세요");
      return;
    }
    if (!contractInfo?.contract_id) return;

    const signatureData = sigRef.current.toDataURL("image/png");
    setLoading(true);
    try {
      if (contractInfo._local) {
        localContracts.update(contractInfo.contract_id, {
          status: "signed",
          signed_at: new Date().toISOString(),
        });
        setStep("complete");
      } else {
        await contractsApi.sign(contractInfo.contract_id, {
          signature_data: signatureData,
          signer_name: contractInfo.customer_name || name,
          signer_rrn_front: rrnFront,
        });
        setStep("complete");
      }
    } catch (e: any) {
      setError(e.response?.data?.detail || "서명 처리 중 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!contractInfo?.contract_id) return;
    if (contractInfo._local) {
      alert("로컬 모드에서는 PDF 생성이 지원되지 않습니다. 백엔드 연결 후 이용해주세요.");
      return;
    }
    const res = await contractsApi.downloadPdf(contractInfo.contract_id);
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = `계약서_${contractInfo.contract_no}.pdf`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* ─── 공고 선택 배너 ───────────────────────────────── */}
      <AnnouncementPicker
        announcements={announcements as any}
        selected={selectedAnn as any}
        onSelect={(a) => {
          setSelectedAnn(a as any);
          setStep("lookup");
          setContractInfo(null);
          setName(""); setRrnFront("");
        }}
        onOpenDetail={(a) => router.push(`/announcements/${a.id}`)}
      />
      <h1 className="text-2xl font-bold text-ink mb-2">방문 계약</h1>
      <p className="text-sm text-ink-3 mb-8">
        {selectedAnn ? `「${selectedAnn.title}」 · ` : ""}
        성명과 주민번호 앞 6자리를 입력하면 계약서가 자동으로 불러와집니다
      </p>

      {/* 진행 단계 */}
      <div className="flex items-center gap-2 mb-8">
        {(["lookup", "review", "sign", "complete"] as Step[]).map((s, i) => {
          const labels = ["고객 조회", "내용 확인", "전자서명", "완료"];
          const isActive = step === s;
          const isDone = ["lookup", "review", "sign", "complete"].indexOf(step) > i;
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                ${isActive ? "bg-accent text-[#0a0a0a]" : isDone ? "bg-green-500 text-white" : "bg-surface2 text-ink-3"}`}>
                {isDone ? "✓" : i + 1}
              </div>
              <span className={`text-sm ${isActive ? "text-accent font-medium" : "text-ink-4"}`}>
                {labels[i]}
              </span>
              {i < 3 && <div className="w-8 h-px bg-border" />}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* STEP 1: 고객 조회 */}
      {step === "lookup" && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">고객 정보 입력</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">성명</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent text-lg"
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">주민등록번호 앞 6자리</label>
              <input
                type="text"
                value={rrnFront}
                onChange={(e) => setRrnFront(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="800101"
                maxLength={6}
                className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent text-lg tracking-widest"
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              />
            </div>
            <button
              onClick={handleLookup}
              disabled={loading || !selectedAnn}
              className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base disabled:opacity-50"
            >
              <Search className="w-5 h-5" />
              {loading ? "조회 중..." : "계약서 조회"}
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: 계약 내용 확인 */}
      {step === "review" && contractInfo?.found && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <h2 className="text-lg font-semibold">계약서 확인</h2>
              {contractInfo._local && (
                <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">로컬 모드</span>
              )}
            </div>

            {contractInfo.review_status === "failed" && (contractInfo.review_issues || []).length > 0 && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-medium text-red-700 mb-2">계약서 오류 발견</p>
                {contractInfo.review_issues!.map((issue: any, i: number) => (
                  <p key={i} className="text-sm text-red-600">• {issue.message}</p>
                ))}
              </div>
            )}

            <table className="w-full text-sm">
              <tbody className="divide-y divide-border-soft">
                <tr><td className="py-2 text-ink-3 w-32">계약자</td><td className="py-2 font-medium">{contractInfo.customer_name}</td></tr>
                <tr><td className="py-2 text-ink-3">동호수</td><td className="py-2 font-medium text-accent text-base">{contractInfo.unit_number || "-"}</td></tr>
                <tr><td className="py-2 text-ink-3">주택형</td><td className="py-2">{contractInfo.unit_type || "-"}</td></tr>
                <tr><td className="py-2 text-ink-3">총 계약금액</td><td className="py-2 font-bold text-lg">{contractInfo.total_price?.toLocaleString() || 0}원</td></tr>
                <tr><td className="py-2 text-ink-3">계약서 번호</td><td className="py-2 text-ink-2">{contractInfo.contract_no}</td></tr>
                <tr>
                  <td className="py-2 text-ink-3">계약금 입금</td>
                  <td className="py-2">
                    {contractInfo.deposit_confirmed
                      ? <span className="badge-eligible">입금 확인</span>
                      : <span className="badge-review">미확인</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {contractInfo.payment_schedule && contractInfo.payment_schedule.length > 0 && (
            <div className="card">
              <h3 className="font-semibold mb-3">납부 일정</h3>
              <div className="space-y-2">
                {contractInfo.payment_schedule.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between items-center text-sm py-1 border-b border-border-soft">
                    <span className="text-ink-2">{item.name}</span>
                    <div className="text-right">
                      <span className="font-medium">{item.amount?.toLocaleString()}원</span>
                      <span className="text-ink-4 text-xs ml-2">{item.due_date}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep("lookup")} className="btn-secondary flex-1">다시 조회</button>
            <button
              onClick={() => setStep("sign")}
              disabled={contractInfo.review_status === "failed"}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              <PenLine className="w-4 h-4" />
              서명하기
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: 전자서명 */}
      {step === "sign" && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">전자서명</h2>
          <p className="text-sm text-ink-3 mb-4">아래 서명란에 서명해주세요</p>
          <div className="border-2 border-dashed border-border rounded-lg overflow-hidden bg-white">
            <SignatureCanvas
              ref={sigRef}
              penColor="black"
              canvasProps={{ className: "w-full", height: 200 }}
            />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => sigRef.current?.clear()} className="btn-secondary flex-1">서명 지우기</button>
            <button onClick={() => setStep("review")} className="btn-secondary">이전</button>
            <button onClick={handleSign} disabled={loading} className="btn-primary flex-1">
              {loading ? "처리 중..." : "서명 완료"}
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: 완료 */}
      {step === "complete" && (
        <div className="card text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-ink mb-2">계약이 완료되었습니다</h2>
          <p className="text-ink-3 mb-2">계약자: <strong>{contractInfo?.customer_name}</strong></p>
          <p className="text-ink-3 mb-6">동호수: <strong>{contractInfo?.unit_number || "-"}</strong></p>

          <div className="flex gap-3 justify-center">
            <button onClick={handleDownloadPdf} className="btn-primary flex items-center gap-2">
              <Download className="w-4 h-4" />
              계약서 출력 / 다운로드
            </button>
            <button onClick={() => { setStep("lookup"); setName(""); setRrnFront(""); setContractInfo(null); }}
              className="btn-secondary">
              다음 고객
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WalkInPage() {
  return (
    <Suspense fallback={<div className="p-6 text-ink-4">로딩 중...</div>}>
      <WalkInPageInner />
    </Suspense>
  );
}
