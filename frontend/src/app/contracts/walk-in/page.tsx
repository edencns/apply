"use client";

/**
 * 방문 계약 페이지
 * - 상담원이 고객 성명 + 주민번호 앞 6자리 입력
 * - 즉시 해당 계약서 로딩
 * - 고객이 내용 확인 후 전자서명
 * - 서명 완료 즉시 PDF 출력
 */

import { useState, useRef } from "react";
import { contractsApi } from "@/lib/api";
import { Search, CheckCircle, XCircle, Download, PenLine } from "lucide-react";
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
}

export default function WalkInPage() {
  const [step, setStep] = useState<Step>("lookup");
  const [name, setName] = useState("");
  const [rrnFront, setRrnFront] = useState("");
  const [siteId] = useState(1); // TODO: 현장 선택 기능
  const [contractInfo, setContractInfo] = useState<ContractInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sigRef = useRef<SignatureCanvas>(null);

  const handleLookup = async () => {
    if (!name.trim() || rrnFront.length !== 6) {
      setError("성명과 주민번호 앞 6자리를 입력해주세요");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await contractsApi.walkIn({ name: name.trim(), rrn_front: rrnFront, site_id: siteId });
      setContractInfo(res.data);
      if (res.data.found) {
        setStep("review");
      } else {
        setError("해당 고객의 계약서를 찾을 수 없습니다. 계약서 생성이 필요합니다.");
      }
    } catch (e: any) {
      setError(e.response?.data?.detail || "조회 중 오류가 발생했습니다");
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
      await contractsApi.sign(contractInfo.contract_id, {
        signature_data: signatureData,
        signer_name: contractInfo.customer_name || name,
        signer_rrn_front: rrnFront,
      });
      setStep("complete");
    } catch (e: any) {
      setError(e.response?.data?.detail || "서명 처리 중 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!contractInfo?.contract_id) return;
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
      <h1 className="text-2xl font-bold text-gray-900 mb-2">방문 계약</h1>
      <p className="text-sm text-gray-500 mb-8">성명과 주민번호 앞 6자리를 입력하면 계약서가 자동으로 불러와집니다</p>

      {/* 진행 단계 */}
      <div className="flex items-center gap-2 mb-8">
        {(["lookup", "review", "sign", "complete"] as Step[]).map((s, i) => {
          const labels = ["고객 조회", "내용 확인", "전자서명", "완료"];
          const isActive = step === s;
          const isDone = ["lookup", "review", "sign", "complete"].indexOf(step) > i;
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                ${isActive ? "bg-blue-600 text-white" : isDone ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500"}`}>
                {isDone ? "✓" : i + 1}
              </div>
              <span className={`text-sm ${isActive ? "text-blue-600 font-medium" : "text-gray-400"}`}>
                {labels[i]}
              </span>
              {i < 3 && <div className="w-8 h-px bg-gray-300" />}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">성명</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">주민등록번호 앞 6자리</label>
              <input
                type="text"
                value={rrnFront}
                onChange={(e) => setRrnFront(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="800101"
                maxLength={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg tracking-widest"
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              />
            </div>
            <button
              onClick={handleLookup}
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base"
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
            </div>

            {/* 계약서 검수 오류 경고 */}
            {contractInfo.review_status === "failed" && (contractInfo.review_issues || []).length > 0 && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-medium text-red-700 mb-2">계약서 오류 발견</p>
                {contractInfo.review_issues!.map((issue: any, i: number) => (
                  <p key={i} className="text-sm text-red-600">• {issue.message}</p>
                ))}
              </div>
            )}

            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                <tr><td className="py-2 text-gray-500 w-32">계약자</td><td className="py-2 font-medium">{contractInfo.customer_name}</td></tr>
                <tr><td className="py-2 text-gray-500">동호수</td><td className="py-2 font-medium text-blue-600 text-base">{contractInfo.unit_number}</td></tr>
                <tr><td className="py-2 text-gray-500">주택형</td><td className="py-2">{contractInfo.unit_type}</td></tr>
                <tr><td className="py-2 text-gray-500">총 계약금액</td><td className="py-2 font-bold text-lg">{contractInfo.total_price?.toLocaleString()}원</td></tr>
                <tr><td className="py-2 text-gray-500">계약서 번호</td><td className="py-2 text-gray-600">{contractInfo.contract_no}</td></tr>
                <tr>
                  <td className="py-2 text-gray-500">계약금 입금</td>
                  <td className="py-2">
                    {contractInfo.deposit_confirmed
                      ? <span className="badge-eligible">입금 확인</span>
                      : <span className="badge-review">미확인</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 납부 일정 */}
          {contractInfo.payment_schedule && contractInfo.payment_schedule.length > 0 && (
            <div className="card">
              <h3 className="font-semibold mb-3">납부 일정</h3>
              <div className="space-y-2">
                {contractInfo.payment_schedule.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between items-center text-sm py-1 border-b border-gray-50">
                    <span className="text-gray-600">{item.name}</span>
                    <div className="text-right">
                      <span className="font-medium">{item.amount?.toLocaleString()}원</span>
                      <span className="text-gray-400 text-xs ml-2">{item.due_date}</span>
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
          <p className="text-sm text-gray-500 mb-4">아래 서명란에 서명해주세요</p>
          <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden bg-white">
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
          <h2 className="text-xl font-bold text-gray-900 mb-2">계약이 완료되었습니다</h2>
          <p className="text-gray-500 mb-2">계약자: <strong>{contractInfo?.customer_name}</strong></p>
          <p className="text-gray-500 mb-6">동호수: <strong>{contractInfo?.unit_number}</strong></p>

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
