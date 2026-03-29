"use client";

import { useState, useCallback, useRef } from "react";
import { documentsApi, eligibilityApi, customersApi } from "@/lib/api";
import {
  Upload, FileText, CheckCircle, XCircle, AlertTriangle,
  RefreshCw, Plus, X, BookOpen, ChevronDown, ChevronUp
} from "lucide-react";

// ─── 서류 정의 ─────────────────────────────────────────────
interface DocDef {
  type: string;
  reason: string;
  verifies: string;
  required: boolean;
  categories: string[];
}

const DOC_DEFINITIONS: DocDef[] = [
  {
    type: "주민등록등본",
    reason: "현재 세대 구성원 및 주소 확인",
    verifies: "무주택 세대주 여부, 세대원 수, 현 거주지 확인",
    required: true,
    categories: ["일반공급", "신혼부부", "생애최초", "다자녀", "노부모부양"],
  },
  {
    type: "주민등록초본",
    reason: "주소 변동 이력 확인",
    verifies: "지역 거주 기간, 해당 지역 우선공급 자격 여부",
    required: true,
    categories: ["일반공급", "신혼부부", "생애최초", "다자녀", "노부모부양"],
  },
  {
    type: "가족관계증명서",
    reason: "법적 가족 관계 확인",
    verifies: "부양가족 수 산정 (배우자·자녀·직계존속), 가점제 점수 계산",
    required: true,
    categories: ["일반공급", "신혼부부", "생애최초", "다자녀", "노부모부양"],
  },
  {
    type: "소득증빙",
    reason: "소득 수준 확인 (근로소득원천징수영수증 등)",
    verifies: "도시근로자 월평균소득 기준 충족 여부 (신혼부부·생애최초 필수)",
    required: false,
    categories: ["신혼부부", "생애최초", "다자녀"],
  },
  {
    type: "건강보험료납부확인서",
    reason: "소득 간접 증빙 서류",
    verifies: "소득 기준 대체 확인, 건강보험료로 소득 구간 판단",
    required: false,
    categories: ["신혼부부", "생애최초", "다자녀"],
  },
  {
    type: "등기사항전부증명서",
    reason: "주택 소유 이력 확인",
    verifies: "과거 주택 소유 여부, 무주택 기간 산정 (가점 최대 32점)",
    required: false,
    categories: ["일반공급", "생애최초"],
  },
  {
    type: "혼인관계증명서",
    reason: "혼인 여부 및 혼인 기간 확인",
    verifies: "신혼부부 특별공급 자격, 혼인 7년 이내 여부",
    required: false,
    categories: ["신혼부부"],
  },
  {
    type: "청약통장확인서",
    reason: "청약 납입 기간 및 횟수 확인",
    verifies: "청약통장 납입 월수 (가점 최대 17점), 1순위 자격 여부",
    required: true,
    categories: ["일반공급", "신혼부부", "생애최초", "다자녀", "노부모부양"],
  },
];

const SUPPLY_CATEGORIES = ["일반공급", "신혼부부", "생애최초", "다자녀", "노부모부양"];

interface UploadedFile {
  file: File;
  uploaded: boolean;
}

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
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, UploadedFile>>({});
  const [eligResult, setEligResult] = useState<EligibilityResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("일반공급");
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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

  const handleFileUpload = async (docType: string, file: File) => {
    if (!customerId) return;
    setUploading(docType);
    try {
      await documentsApi.upload(Number(customerId), file, docType);
      setUploadedFiles((prev) => ({ ...prev, [docType]: { file, uploaded: true } }));
      await loadDocs(customerId);
    } catch (err: any) {
      alert(err.response?.data?.detail || "업로드 실패");
    } finally {
      setUploading(null);
    }
  };

  const handleFileChange = (docType: string) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFileUpload(docType, file);
    e.target.value = "";
  };

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

  const verdictColor =
    eligResult?.verdict === "eligible"
      ? "bg-green-50 border-green-200"
      : eligResult?.verdict === "ineligible"
      ? "bg-red-50 border-red-200"
      : "bg-yellow-50 border-yellow-200";

  const filteredDocs = DOC_DEFINITIONS.filter((d) =>
    d.categories.includes(selectedCategory)
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">서류 검수 및 적격 판정</h1>
        <button
          onClick={() => setShowGuide(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors text-sm font-medium"
        >
          <BookOpen className="w-4 h-4" />
          필요 서류 목록
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 좌측: 서류 업로드 */}
        <div className="space-y-4">
          {/* 고객 ID 입력 */}
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

              {/* 공급 유형 선택 */}
              {customerId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">공급 유형</label>
                  <div className="flex flex-wrap gap-2">
                    {SUPPLY_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          selectedCategory === cat
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 서류 체크리스트 */}
          {customerId && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">
                  필요 서류 체크리스트
                  <span className="ml-2 text-xs text-gray-400 font-normal">
                    {Object.values(uploadedFiles).filter((f) => f.uploaded).length}/{filteredDocs.length} 완료
                  </span>
                </h2>
                <button onClick={() => loadDocs(customerId)} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> 새로고침
                </button>
              </div>

              <div className="space-y-2">
                {filteredDocs.map((docDef) => {
                  const uploaded = uploadedFiles[docDef.type];
                  const isUploading = uploading === docDef.type;
                  const isExpanded = expandedDoc === docDef.type;
                  const submittedDoc = docs.find((d) => d.doc_type === docDef.type);

                  return (
                    <div
                      key={docDef.type}
                      className={`border rounded-lg overflow-hidden transition-all ${
                        uploaded?.uploaded || submittedDoc
                          ? "border-green-200 bg-green-50"
                          : docDef.required
                          ? "border-gray-200 bg-white"
                          : "border-dashed border-gray-200 bg-gray-50"
                      }`}
                    >
                      {/* 서류 행 */}
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        {/* 상태 아이콘 */}
                        {uploaded?.uploaded || submittedDoc ? (
                          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                        ) : (
                          <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 ${
                            docDef.required ? "border-blue-400" : "border-gray-300"
                          }`} />
                        )}

                        {/* 서류명 + 설명 토글 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">{docDef.type}</span>
                            {docDef.required && (
                              <span className="text-xs text-red-500 font-medium">필수</span>
                            )}
                            {submittedDoc && ocrStatusBadge(submittedDoc.ocr_status)}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{docDef.reason}</p>
                        </div>

                        {/* 버튼 영역 */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {/* 정보 토글 */}
                          <button
                            onClick={() => setExpandedDoc(isExpanded ? null : docDef.type)}
                            className="p-1 text-gray-400 hover:text-gray-600 rounded"
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>

                          {/* 업로드 버튼 */}
                          <label className={`p-1.5 rounded-md cursor-pointer transition-colors flex items-center justify-center ${
                            isUploading
                              ? "bg-gray-100 text-gray-400"
                              : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                          }`}>
                            {isUploading
                              ? <RefreshCw className="w-4 h-4 animate-spin" />
                              : <Plus className="w-4 h-4" />
                            }
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              className="hidden"
                              disabled={isUploading}
                              ref={(el) => { fileInputRefs.current[docDef.type] = el; }}
                              onChange={handleFileChange(docDef.type)}
                            />
                          </label>
                        </div>
                      </div>

                      {/* 확장: 서류 설명 */}
                      {isExpanded && (
                        <div className="px-3 pb-2.5 pt-0 border-t border-gray-100 bg-white">
                          <p className="text-xs text-gray-600 mt-2">
                            <span className="font-medium text-gray-700">확인 내용: </span>
                            {docDef.verifies}
                          </p>
                        </div>
                      )}

                      {/* 업로드된 파일명 */}
                      {(uploaded?.uploaded || submittedDoc) && (
                        <div className="px-3 pb-2 flex items-center gap-1.5">
                          <FileText className="w-3 h-3 text-green-500" />
                          <span className="text-xs text-green-700">
                            {uploaded?.file.name ?? `접수완료 (${submittedDoc?.doc_type})`}
                          </span>
                          {uploaded?.uploaded && (
                            <button
                              onClick={() => {
                                setUploadedFiles((prev) => {
                                  const next = { ...prev };
                                  delete next[docDef.type];
                                  return next;
                                });
                              }}
                              className="ml-auto text-gray-400 hover:text-gray-600"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
                {eligResult.total_score > 0 && (
                  <div className="ml-auto text-right">
                    <div className="text-2xl font-bold text-blue-600">{eligResult.total_score}</div>
                    <div className="text-xs text-gray-500">/ 84점</div>
                  </div>
                )}
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

      {/* ─── 필요 서류 목록 모달 ─────────────────────────── */}
      {showGuide && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">필요 서류 목록</h2>
              </div>
              <button onClick={() => setShowGuide(false)} className="p-1 hover:bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* 공급 유형 탭 */}
            <div className="flex gap-1 px-6 pt-4 overflow-x-auto">
              {SUPPLY_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    selectedCategory === cat
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* 서류 목록 */}
            <div className="overflow-y-auto flex-1 p-6 space-y-3">
              {DOC_DEFINITIONS.filter((d) => d.categories.includes(selectedCategory)).map((doc) => (
                <div key={doc.type} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      <span className="font-semibold text-gray-900">{doc.type}</span>
                    </div>
                    {doc.required
                      ? <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">필수</span>
                      : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">선택</span>
                    }
                  </div>
                  <p className="text-sm text-gray-600 mb-1.5">
                    <span className="font-medium text-gray-700">제출 이유: </span>{doc.reason}
                  </p>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium text-gray-700">확인 내용: </span>{doc.verifies}
                  </p>
                </div>
              ))}
            </div>

            <div className="p-4 border-t bg-gray-50 rounded-b-2xl">
              <p className="text-xs text-gray-500 text-center">
                공급 유형에 따라 필요 서류가 다를 수 있습니다. 모집공고문을 반드시 확인하세요.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
