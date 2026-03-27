"use client";

/**
 * 서류 검수 페이지
 * - 고객 선택 후 서류 업로드
 * - OCR 상태 실시간 확인
 * - 적격 판정 실행 및 결과 표시
 */

import { useState, useCallback } from "react";
import { documentsApi, eligibilityApi, customersApi } from "@/lib/api";
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, RefreshCw } from "lucide-react";

const DOC_TYPES = [
  "주민등록등본",
  "주민등록초본",
  "가족관계증명서",
  "소득증빙",
  "건강보험료납부확인서",
  "등기사항전부증명서",
  "혼인관계증명서",
  "청약통장확인서",
  "기타",
];

interface DocumentItem {
  id: number;
  doc_type: string;
  ocr_status: string;
  ocr_confidence: number;
  uploaded_at: string;
  has_issues: boolean;
}

interface EligibilityResult {
  verdict: string;
  verdict_label: string;
  total_score: number;
  summary: string;
  checks: Record<string, any>;
  issues: string[];
  supplement_docs: string[];
}

export default function DocumentsPage() {
  const [customerId, setCustomerId] = useState("");
  const [winnerId, setWinnerId] = useState("");
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState("기타");
  const [eligResult, setEligResult] = useState<EligibilityResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const loadDocs = useCallback(async (cid: string) => {
    if (!cid) return;
    setLoadingDocs(true);
    try {
      const res = await customersApi.listDocuments(Number(cid));
      setDocs(res.data);
    } catch {
      setDocs([]);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !customerId) return;
    setUploading(true);
    try {
      await documentsApi.upload(Number(customerId), file, selectedDocType);
      await loadDocs(customerId);
    } catch (err: any) {
      alert(err.response?.data?.detail || "업로드 실패");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    if (!customerId) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setUploading(true);
    try {
      await documentsApi.upload(Number(customerId), file, selectedDocType);
      await loadDocs(customerId);
    } catch (err: any) {
      alert(err.response?.data?.detail || "업로드 실패");
    } finally {
      setUploading(false);
    }
  }, [customerId, selectedDocType, loadDocs]);

  const runEligibilityCheck = async () => {
    if (!winnerId) { alert("당첨자 ID를 입력해주세요"); return; }
    setChecking(true);
    setEligResult(null);
    try {
      const res = await eligibilityApi.check(Number(winnerId));
      setEligResult(res.data);
    } catch (err: any) {
      alert(err.response?.data?.detail || "판정 중 오류 발생");
    } finally {
      setChecking(false);
    }
  };

  const ocrStatusBadge = (status: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      pending: { cls: "badge-pending", label: "대기" },
      processing: { cls: "badge-review", label: "처리 중" },
      done: { cls: "badge-eligible", label: "완료" },
      failed: { cls: "badge-ineligible", label: "실패" },
    };
    const s = map[status] || map.pending;
    return <span className={s.cls}>{s.label}</span>;
  };

  const verdictColor = eligResult?.verdict === "eligible"
    ? "bg-green-50 border-green-200"
    : eligResult?.verdict === "ineligible"
    ? "bg-red-50 border-red-200"
    : "bg-yellow-50 border-yellow-200";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">서류 검수 및 적격 판정</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 좌측: 서류 업로드 */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="font-semibold mb-4">고객 서류 업로드</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">고객 ID</label>
                <input
                  type="number"
                  value={customerId}
                  onChange={(e) => { setCustomerId(e.target.value); loadDocs(e.target.value); }}
                  placeholder="고객 ID 입력"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">서류 종류</label>
                <select
                  value={selectedDocType}
                  onChange={(e) => setSelectedDocType(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none"
                >
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* 드래그&드롭 업로드 영역 */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors"
              >
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500 mb-2">파일을 드래그하거나 클릭하여 업로드</p>
                <p className="text-xs text-gray-400 mb-3">지원: PDF, JPG, PNG (최대 50MB)</p>
                <label className="btn-primary cursor-pointer">
                  {uploading ? "업로드 중..." : "파일 선택"}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileUpload}
                    disabled={!customerId || uploading}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* 제출된 서류 목록 */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">제출 서류 목록</h2>
              <button onClick={() => loadDocs(customerId)} disabled={!customerId} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> 새로고침
              </button>
            </div>
            {loadingDocs ? (
              <p className="text-sm text-gray-400 text-center py-4">로딩 중...</p>
            ) : docs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">제출된 서류가 없습니다</p>
            ) : (
              <div className="space-y-2">
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium">{doc.doc_type}</span>
                      {doc.has_issues && <AlertTriangle className="w-3 h-3 text-yellow-500" />}
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.ocr_confidence > 0 && (
                        <span className="text-xs text-gray-400">{doc.ocr_confidence}%</span>
                      )}
                      {ocrStatusBadge(doc.ocr_status)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 우측: 적격 판정 */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="font-semibold mb-4">적격 판정 실행</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">당첨자 ID</label>
                <input
                  type="number"
                  value={winnerId}
                  onChange={(e) => setWinnerId(e.target.value)}
                  placeholder="당첨자 ID 입력"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={runEligibilityCheck}
                disabled={checking || !winnerId}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {checking ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> 판정 중...</>
                ) : (
                  <><CheckCircle className="w-4 h-4" /> 적격 판정 실행</>
                )}
              </button>
            </div>
          </div>

          {/* 판정 결과 */}
          {eligResult && (
            <div className={`card border-2 ${verdictColor}`}>
              <div className="flex items-center gap-3 mb-4">
                {eligResult.verdict === "eligible"
                  ? <CheckCircle className="w-6 h-6 text-green-600" />
                  : eligResult.verdict === "ineligible"
                  ? <XCircle className="w-6 h-6 text-red-600" />
                  : <AlertTriangle className="w-6 h-6 text-yellow-600" />}
                <div>
                  <div className="text-lg font-bold">{eligResult.verdict_label}</div>
                  <div className="text-sm text-gray-600">{eligResult.summary}</div>
                </div>
              </div>

              <div className="text-sm font-medium text-gray-700 mb-2">항목별 검수 결과</div>
              <div className="space-y-2">
                {Object.entries(eligResult.checks).map(([key, check]: [string, any]) => (
                  <div key={key} className="flex items-start gap-2 text-sm">
                    {check.status === "pass"
                      ? <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      : check.status === "fail"
                      ? <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      : <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />}
                    <span className="text-gray-700">{check.detail}</span>
                  </div>
                ))}
              </div>

              {eligResult.issues.length > 0 && (
                <div className="mt-4 p-3 bg-red-50 rounded-lg">
                  <p className="text-sm font-medium text-red-700 mb-1">부적격 사유</p>
                  {eligResult.issues.map((issue, i) => (
                    <p key={i} className="text-sm text-red-600">• {issue}</p>
                  ))}
                </div>
              )}

              {eligResult.supplement_docs.length > 0 && (
                <div className="mt-3 p-3 bg-yellow-50 rounded-lg">
                  <p className="text-sm font-medium text-yellow-700 mb-1">추가 서류 요청</p>
                  {eligResult.supplement_docs.map((doc, i) => (
                    <p key={i} className="text-sm text-yellow-600">• {doc}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
