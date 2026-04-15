'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  type AnnouncementRequirements,
  type DocumentVerifiedData,
  type SupplyCondition,
  type SupplyUnit,
  getDefaultAnnouncement,
  getDefaultDocuments,
} from '@/lib/verification-engine';
import {
  saveProject,
  loadProject,
  saveCurrentApplicantDraft,
  loadCurrentApplicantDraft,
  upsertApplicant,
  newApplicantId,
  loadAllApplicants,
  type SavedApplicant,
} from '@/lib/applicant-storage';

// ============ 아이콘 ============

function CheckIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" width={16} height={16}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>;
}
function XIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" width={16} height={16}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
}
function AlertIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={16} height={16}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>;
}

// ============ 공통 컴포넌트 ============

function Section({ title, children, color = 'blue' }: { title: string; children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50/30',
    green: 'border-emerald-200 bg-emerald-50/30',
    purple: 'border-violet-200 bg-violet-50/30',
  };
  const titleColors: Record<string, string> = {
    blue: 'text-blue-700 bg-blue-100',
    green: 'text-emerald-700 bg-emerald-100',
    purple: 'text-violet-700 bg-violet-100',
  };
  return (
    <div className={`rounded-2xl border ${colors[color]} overflow-hidden`}>
      <div className={`px-4 py-2.5 text-sm font-bold ${titleColors[color]}`}>{title}</div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, unit }: {
  value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string; unit?: string;
}) {
  return (
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
      />
      {unit && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{unit}</span>}
    </div>
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
        checked ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500'}`}>
      <div className={`w-4 h-4 rounded flex items-center justify-center text-white ${checked ? 'bg-blue-500' : 'bg-gray-200'}`}>
        {checked && <CheckIcon className="w-3 h-3" />}
      </div>
      {label}
    </button>
  );
}

// ============ OCR 업로드 버튼 ============

function OcrUploadButton({
  label,
  hint,
  onResult,
  apiPath,
  docType,
  accept = 'image/*,.pdf',
}: {
  label: string;
  hint: string;
  onResult: (data: any) => void;
  apiPath: string;
  docType?: string;
  accept?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      const fd = new FormData();
      fd.append('file', file);
      if (docType) fd.append('docType', docType);

      const res = await fetch(apiPath, { method: 'POST', body: fd });
      const json = await res.json();

      if (!res.ok || json.error) {
        setError(json.error || '처리 실패');
      } else {
        onResult(json.data || json.results);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err: any) {
      setError(err.message || '오류 발생');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-dashed cursor-pointer text-sm font-semibold transition-all ${
        loading ? 'border-blue-200 bg-blue-50 text-blue-400' :
        success ? 'border-emerald-300 bg-emerald-50 text-emerald-600' :
        'border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100'}`}>
        <input ref={fileRef} type="file" accept={accept} className="hidden" onChange={handleFile} disabled={loading} />
        {loading ? (
          <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>AI 분석 중...</>
        ) : success ? (
          <><CheckIcon className="w-4 h-4" />자동입력 완료!</>
        ) : (
          <><svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>{label}</>
        )}
      </label>
      <p className="text-xs text-gray-400">{hint}</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ============ 문서 OCR 섹션 ============

function DocumentOcrSection({ onDocumentParsed }: { onDocumentParsed: (docType: string, data: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ docType: string; fileName: string; success: boolean }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setLoading(true);

    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      fd.append('docType', 'auto');

      const res = await fetch('/api/parse-documents', { method: 'POST', body: fd });
      const json = await res.json();

      if (json.success && json.results) {
        const newResults: { docType: string; fileName: string; success: boolean }[] = [];
        Object.entries(json.results).forEach(([docType, result]: [string, any]) => {
          onDocumentParsed(docType, result.data);
          newResults.push({ docType, fileName: result.fileName, success: true });
        });
        setResults(prev => [...prev, ...newResults]);
      }
    } catch (err: any) {
      console.error('Document OCR error:', err);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h4 className="text-sm font-bold text-emerald-700 mb-1">📄 서류 파일 일괄 업로드 (AI 자동 추출)</h4>
          <p className="text-xs text-emerald-600 mb-3">
            이미지 또는 PDF를 업로드하면 AI가 서류 종류를 자동으로 감지하고 내용을 추출합니다.
          </p>
          <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-400 cursor-pointer text-sm font-semibold transition-all ${
            loading ? 'bg-emerald-100 text-emerald-400' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}>
            <input ref={fileRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={handleFiles} disabled={loading} />
            {loading
              ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>AI 분석 중...</>
              : <><svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>서류 파일 선택 (여러 개 가능)</>
            }
          </label>
        </div>
      </div>
      {results.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {results.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
              <CheckIcon className="w-3 h-3" />{r.docType}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 서류 수기 입력 폼 ============

function ManualEntryForm({
  documents,
  onChange,
}: {
  documents: DocumentVerifiedData;
  onChange: (partial: Partial<DocumentVerifiedData>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-gray-600 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center gap-2">
          ✍️ 수기 입력 (OCR 실패 시 / 직접 검증)
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="p-4 space-y-4">
          {/* 주민등록등본 */}
          <ManualSection title="주민등록등본">
            <ManualField label="세대주명">
              <input type="text" value={documents.등본_세대주}
                onChange={(e) => onChange({ 등본_세대주: e.target.value })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
            <ManualField label="세대주 여부">
              <Toggle checked={documents.등본_세대주여부}
                onChange={(v) => onChange({ 등본_세대주여부: v })}
                label={documents.등본_세대주여부 ? '세대주' : '세대원'} />
            </ManualField>
            <ManualField label="세대원 수">
              <input type="number" value={documents.등본_세대원수 || ''}
                onChange={(e) => onChange({ 등본_세대원수: parseInt(e.target.value) || 0 })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
            <ManualField label="주소" wide>
              <input type="text" value={documents.등본_주소}
                onChange={(e) => onChange({ 등본_주소: e.target.value })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
          </ManualSection>

          {/* 청약통장 */}
          <ManualSection title="청약통장확인서">
            <ManualField label="가입일">
              <input type="date" value={documents.통장_가입일}
                onChange={(e) => onChange({ 통장_가입일: e.target.value })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
            <ManualField label="납입 횟수">
              <input type="number" value={documents.통장_납입횟수 || ''}
                onChange={(e) => onChange({ 통장_납입횟수: parseInt(e.target.value) || 0 })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
            <ManualField label="예치금 (만원)">
              <input type="number" value={documents.통장_예치금 || ''}
                onChange={(e) => onChange({ 통장_예치금: parseInt(e.target.value) || 0 })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
          </ManualSection>

          {/* 가족관계 / 혼인 */}
          <ManualSection title="가족관계 · 혼인">
            <ManualField label="가족 구성원 수">
              <input type="number" value={documents.가족_구성원수 || ''}
                onChange={(e) => onChange({ 가족_구성원수: parseInt(e.target.value) || 0 })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
            <ManualField label="자녀 수">
              <input type="number" value={documents.가족_자녀수 || ''}
                onChange={(e) => onChange({ 가족_자녀수: parseInt(e.target.value) || 0 })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
            <ManualField label="혼인일">
              <input type="date" value={documents.혼인_혼인일}
                onChange={(e) => onChange({ 혼인_혼인일: e.target.value })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
          </ManualSection>

          {/* 소득 / 주택소유 */}
          <ManualSection title="소득 · 주택소유">
            <ManualField label="월평균 소득 (만원)">
              <input type="number" value={documents.소득_월평균 || ''}
                onChange={(e) => onChange({ 소득_월평균: parseInt(e.target.value) || 0 })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
            <ManualField label="주택 소유 여부">
              <Toggle checked={documents.등기_주택소유여부}
                onChange={(v) => onChange({ 등기_주택소유여부: v, 등기_소유주택수: v ? Math.max(1, documents.등기_소유주택수 || 1) : 0 })}
                label={documents.등기_주택소유여부 ? '소유' : '무주택'} />
            </ManualField>
            <ManualField label="소유 주택 수">
              <input type="number" value={documents.등기_소유주택수 || ''}
                onChange={(e) => onChange({ 등기_소유주택수: parseInt(e.target.value) || 0 })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md" />
            </ManualField>
          </ManualSection>
        </div>
      )}
    </div>
  );
}

function ManualSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">{children}</div>
    </div>
  );
}

function ManualField({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-3' : ''}>
      <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">{label}</label>
      {children}
    </div>
  );
}

// ============ 공고 PDF 업로드 ============

function PdfAnnouncementUpload({ onResult }: { onResult: (data: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [progress, setProgress] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('PDF 파일만 업로드 가능합니다.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess(false);
    setProgress('PDF 텍스트 추출 중...');

    try {
      const fd = new FormData();
      fd.append('file', file);

      setProgress('AI가 자격조건 분석 중... (30초~1분 소요)');
      const res = await fetch('/api/parse-announcement-pdf', { method: 'POST', body: fd });
      const json = await res.json();

      if (!res.ok || json.error) {
        setError(json.error || '처리 실패');
      } else {
        onResult(json.data);
        setSuccess(true);
        setProgress('');
        setTimeout(() => setSuccess(false), 5000);
      }
    } catch (err: any) {
      setError(err.message || '오류 발생');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 p-4 space-y-2">
      <h4 className="text-sm font-bold text-indigo-700">📄 공고문 PDF 업로드 (자격조건 + 필요서류 자동 추출)</h4>
      <p className="text-xs text-indigo-600">
        입주자모집공고문 PDF를 업로드하면 AI가 공급유형별 자격조건, 소득기준, 필요서류 목록을 자동으로 추출합니다.
      </p>
      <label className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer text-sm font-semibold transition-all ${
        loading ? 'border-indigo-200 bg-indigo-100 text-indigo-400' :
        success ? 'border-emerald-400 bg-emerald-100 text-emerald-700' :
        'border-indigo-400 bg-indigo-600 text-white hover:bg-indigo-700'}`}>
        <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFile} disabled={loading} />
        {loading ? (
          <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>{progress}</>
        ) : success ? (
          <><CheckIcon className="w-4 h-4" />공고 분석 완료!</>
        ) : (
          <><svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>공고문 PDF 업로드</>
        )}
      </label>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ============ 단계 인디케이터 ============

function StepIndicator({ currentStep }: { currentStep: 1 | 2 | 3 | 4 }) {
  const steps = [
    { n: 1, label: '공고 업로드', desc: 'PDF 분석' },
    { n: 2, label: '공급유형 · 면적', desc: '검수 대상 선택' },
    { n: 3, label: '서류 업로드', desc: 'OCR / 수기 입력' },
    { n: 4, label: '검수 결과', desc: '적합 / 부적합 판정' },
  ];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        {steps.map((s, i) => {
          const done = currentStep > s.n;
          const active = currentStep === s.n;
          return (
            <div key={s.n} className="flex items-center flex-1">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0 transition-all ${
                  done ? 'bg-emerald-500 text-white' :
                  active ? 'bg-blue-600 text-white ring-4 ring-blue-100' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {done ? <CheckIcon className="w-4 h-4" /> : s.n}
                </div>
                <div className="min-w-0 hidden sm:block">
                  <div className={`text-xs font-bold truncate ${
                    done ? 'text-emerald-700' : active ? 'text-blue-700' : 'text-gray-400'
                  }`}>{s.label}</div>
                  <div className="text-[10px] text-gray-400 truncate">{s.desc}</div>
                </div>
              </div>
              {i < steps.length - 1 && (
                <div className={`h-0.5 flex-1 mx-2 rounded ${done ? 'bg-emerald-300' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ 메인 페이지 ============

// ============ 툴팁 ============

function Tooltip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className="absolute z-50 left-0 top-full mt-1 w-96 p-3 rounded-xl bg-gray-900 text-white text-xs shadow-2xl border border-gray-700 leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      )}
    </span>
  );
}

// ============ 전용면적 편집기 ============

/** 공급대상 주택형 목록 — PDF 공급대상 표에서 파싱된 세대수 상세를 카드로 표시 */
function SupplyUnitsPanel({
  units,
  selectedArea,
  selectedSupplyType,
  onSelectArea,
}: {
  units: SupplyUnit[];
  selectedArea: string;
  selectedSupplyType: string;
  onSelectArea: (area: string) => void;
}) {
  if (!units || units.length === 0) return null;

  const totals = units.reduce(
    (acc, u) => ({
      total: acc.total + u.totalUnits,
      multiChild: acc.multiChild + u.multiChild,
      newlywed: acc.newlywed + u.newlywed,
      elderParent: acc.elderParent + u.elderParent,
      firstTime: acc.firstTime + u.firstTime,
      general: acc.general + u.general,
      special: acc.special + u.specialTotal,
    }),
    { total: 0, multiChild: 0, newlywed: 0, elderParent: 0, firstTime: 0, general: 0, special: 0 },
  );

  // 특정 공급유형을 선택했을 때 해당 유형으로 배정이 있는 주택형만 available
  const getAvailableCount = (u: SupplyUnit, type: string): number => {
    const t = (type || '').replace(/\s+/g, '');
    if (t === '일반공급') return u.general;
    if (/다자녀/.test(t)) return u.multiChild;
    if (/신혼부부|신혼/.test(t)) return u.newlywed;
    if (/노부모/.test(t)) return u.elderParent;
    if (/생애최초|생애/.test(t)) return u.firstTime;
    return u.totalUnits;
  };

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
            공급대상
          </span>
          <span className="text-xs font-bold text-indigo-900">
            총 {totals.total}세대 · {units.length}개 주택형
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-gray-600 font-semibold flex-wrap justify-end">
          <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">특공 {totals.special}</span>
          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">일반 {totals.general}</span>
          {totals.multiChild > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">다자녀 {totals.multiChild}</span>}
          {totals.newlywed > 0 && <span className="px-1.5 py-0.5 rounded bg-pink-100 text-pink-700">신혼 {totals.newlywed}</span>}
          {totals.elderParent > 0 && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">노부모 {totals.elderParent}</span>}
          {totals.firstTime > 0 && <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">생애최초 {totals.firstTime}</span>}
        </div>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-gray-500 border-b border-indigo-200">
              <th className="text-left font-semibold px-1.5 py-1.5">#</th>
              <th className="text-left font-semibold px-1.5 py-1.5">약식</th>
              <th className="text-right font-semibold px-1.5 py-1.5">전용</th>
              <th className="text-right font-semibold px-1.5 py-1.5">계약</th>
              <th className="text-center font-semibold px-1.5 py-1.5">총</th>
              <th className="text-center font-semibold px-1.5 py-1.5 text-amber-700">다자녀</th>
              <th className="text-center font-semibold px-1.5 py-1.5 text-pink-700">신혼</th>
              <th className="text-center font-semibold px-1.5 py-1.5 text-emerald-700">노부모</th>
              <th className="text-center font-semibold px-1.5 py-1.5 text-violet-700">생애</th>
              <th className="text-center font-semibold px-1.5 py-1.5 text-rose-700">특공</th>
              <th className="text-center font-semibold px-1.5 py-1.5 text-blue-700">일반</th>
              <th className="text-center font-semibold px-1.5 py-1.5 text-gray-500">최하층</th>
            </tr>
          </thead>
          <tbody>
            {units.map(u => {
              const areaKey = String(u.exclusiveArea);
              const active = Math.abs(Number(selectedArea) - u.exclusiveArea) < 0.01;
              const available = getAvailableCount(u, selectedSupplyType);
              const disabled = selectedSupplyType && available === 0;
              return (
                <tr
                  key={u.shortCode}
                  onClick={() => !disabled && onSelectArea(areaKey)}
                  className={`border-b border-indigo-100 cursor-pointer transition-colors ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : disabled
                        ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                        : 'bg-white hover:bg-indigo-100/60 text-gray-700'
                  }`}
                >
                  <td className="px-1.5 py-1.5 font-mono">{String(u.no).padStart(2, '0')}</td>
                  <td className="px-1.5 py-1.5 font-mono">{u.shortCode}</td>
                  <td className="px-1.5 py-1.5 text-right font-semibold">{u.exclusiveArea.toFixed(2)}</td>
                  <td className="px-1.5 py-1.5 text-right">{u.contractArea.toFixed(2)}</td>
                  <td className={`px-1.5 py-1.5 text-center font-bold ${active ? 'text-white' : 'text-gray-900'}`}>{u.totalUnits}</td>
                  <td className="px-1.5 py-1.5 text-center">{u.multiChild || '-'}</td>
                  <td className="px-1.5 py-1.5 text-center">{u.newlywed || '-'}</td>
                  <td className="px-1.5 py-1.5 text-center">{u.elderParent || '-'}</td>
                  <td className="px-1.5 py-1.5 text-center">{u.firstTime || '-'}</td>
                  <td className="px-1.5 py-1.5 text-center font-semibold">{u.specialTotal || '-'}</td>
                  <td className="px-1.5 py-1.5 text-center font-semibold">{u.general || '-'}</td>
                  <td className="px-1.5 py-1.5 text-center">{u.lowestFloorPriority || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedSupplyType && (
        <div className="mt-2 text-[10px] text-gray-500">
          <span className="font-semibold text-gray-700">{selectedSupplyType}</span>
          {' '}로 배정된 주택형만 클릭 가능 · 회색은 해당 공급유형 배정 없음
        </div>
      )}
    </div>
  );
}

function ExclusiveAreaEditor({
  areas, selected, onSelect, onAdd, onRemove,
}: {
  areas: number[];
  selected: string;
  onSelect: (v: string) => void;
  onAdd: (v: number) => void;
  onRemove: (v: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState('');

  const commitAdd = () => {
    const n = parseFloat(newVal.replace(/[^\d.]/g, ''));
    if (Number.isFinite(n)) {
      onAdd(n);
      onSelect(String(n));
    }
    setNewVal('');
    setAdding(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-semibold text-gray-500">
          전용면적 <span className="text-gray-400 font-normal">({areas.length}개)</span>
        </label>
        <button
          type="button"
          onClick={() => setAdding(v => !v)}
          className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={12} height={12}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          수동 추가
        </button>
      </div>

      {adding && (
        <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-blue-50 border border-blue-200">
          <input
            type="text"
            autoFocus
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') { setAdding(false); setNewVal(''); }
            }}
            placeholder="예: 74.98"
            className="flex-1 px-2 py-1 text-xs bg-white border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <span className="text-xs text-blue-600 font-semibold">m²</span>
          <button
            type="button"
            onClick={commitAdd}
            className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700"
          >
            추가
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewVal(''); }}
            className="px-2 py-1 rounded-md text-[11px] font-semibold text-gray-500 hover:bg-white"
          >
            취소
          </button>
        </div>
      )}

      {areas.length === 0 ? (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
          PDF 파싱에서 전용면적이 추출되지 않았습니다. 위 "수동 추가"로 직접 입력해주세요.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {areas.map(a => {
            const key = String(a);
            const active = selected === key;
            return (
              <div
                key={key}
                className={`group inline-flex items-center gap-1 rounded-lg border text-xs font-semibold transition-all overflow-hidden ${
                  active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(key)}
                  className="px-2.5 py-1.5"
                >
                  {a}m²
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemove(a); }}
                  title="삭제"
                  className={`pr-1.5 pl-0.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                    active ? 'text-white/80 hover:text-white' : 'text-gray-400 hover:text-red-500'
                  }`}
                >
                  <XIcon className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============ 조건 매칭 ============

function pickConditionForArea(conditions: SupplyCondition[], area: number): SupplyCondition | null {
  if (!conditions?.length) return null;
  // areaType 기준으로 가장 적합한 조건 선택
  const under85 = area <= 85;
  const matched = conditions.find(c => {
    if (!c.areaType || c.areaType === 'all') return true;
    if (c.areaType === 'under85' && under85) return true;
    if (c.areaType === 'over85' && !under85) return true;
    return false;
  });
  return matched || conditions[0];
}

function pickDepositForArea(depositByArea: Record<string, number> | undefined, area: number): { key: string; value: number } | null {
  if (!depositByArea) return null;
  const keys = Object.keys(depositByArea).map(k => ({ k, n: Number(k) })).sort((a, b) => a.n - b.n);
  for (const { k, n } of keys) {
    if (area <= n) return { key: k, value: depositByArea[k] };
  }
  // 최대 구간 초과
  const last = keys[keys.length - 1];
  return last ? { key: last.k, value: depositByArea[last.k] } : null;
}

// ============ 기준 vs 서류 비교 ============

interface CriterionRow {
  label: string;
  required: string;
  actual: string;
  status: 'match' | 'fail' | 'warn' | 'na';
  hint?: string;
}

function buildCriterionRows(
  condition: SupplyCondition | null,
  area: number,
  documents: DocumentVerifiedData,
  supplyType: string,
  incomeTable?: Record<string, Record<string, number>>,
): CriterionRow[] {
  const rows: CriterionRow[] = [];
  if (!condition) return rows;

  // 청약통장 가입기간
  if (condition.minSubscriptionMonths && condition.minSubscriptionMonths > 0) {
    const opened = documents.통장_가입일;
    let actualMonths = 0;
    if (opened) {
      const d = new Date(opened);
      const now = new Date();
      actualMonths = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    }
    const ok = opened ? actualMonths >= condition.minSubscriptionMonths : false;
    rows.push({
      label: '청약통장 가입기간',
      required: `${condition.minSubscriptionMonths}개월 이상`,
      actual: opened ? `${actualMonths}개월 (${opened})` : '미확인',
      status: opened ? (ok ? 'match' : 'fail') : 'na',
    });
  }

  // 납입 횟수
  if (condition.minDepositCount && condition.minDepositCount > 0) {
    const actual = documents.통장_납입횟수 || 0;
    const ok = actual >= condition.minDepositCount;
    rows.push({
      label: '납입 횟수',
      required: `${condition.minDepositCount}회 이상`,
      actual: actual ? `${actual}회` : '미확인',
      status: actual ? (ok ? 'match' : 'fail') : 'na',
    });
  }

  // 예치금 (면적별)
  const deposit = pickDepositForArea(condition.depositByArea, area);
  if (deposit) {
    const actual = documents.통장_예치금 || 0;
    const ok = actual >= deposit.value;
    rows.push({
      label: `예치금 (${deposit.key}m² 이하 기준)`,
      required: `${deposit.value}만원 이상`,
      actual: actual ? `${actual}만원` : '미확인',
      status: actual ? (ok ? 'match' : 'fail') : 'na',
    });
  } else if (condition.requiredDeposit && condition.requiredDeposit > 0) {
    const actual = documents.통장_예치금 || 0;
    const ok = actual >= condition.requiredDeposit;
    rows.push({
      label: '예치금',
      required: `${condition.requiredDeposit}만원 이상`,
      actual: actual ? `${actual}만원` : '미확인',
      status: actual ? (ok ? 'match' : 'fail') : 'na',
    });
  }

  // 무주택 요건
  if (condition.requireHomeless) {
    const owned = documents.등기_주택소유여부;
    const count = documents.등기_소유주택수;
    const hasDoc = documents.등기_소유주택수 !== undefined && (owned || count > 0 || documents.등본_세대원수 > 0);
    const isHomeless = !owned && count === 0;
    rows.push({
      label: '무주택세대구성원',
      required: '무주택 필수',
      actual: hasDoc ? (isHomeless ? '무주택 확인' : `주택 ${count}채 소유`) : '미확인',
      status: hasDoc ? (isHomeless ? 'match' : 'fail') : 'na',
    });
  }

  // 세대주 요건
  if (condition.requireHouseholdHead) {
    const isHead = documents.등본_세대주여부;
    const hasDoc = !!documents.등본_세대주;
    rows.push({
      label: '세대주',
      required: '세대주 필수',
      actual: hasDoc ? (isHead ? '세대주 확인' : '세대원') : '미확인',
      status: hasDoc ? (isHead ? 'match' : 'fail') : 'na',
    });
  }

  // 혼인 기간 (신혼부부)
  if (condition.maxMarriageYears && condition.maxMarriageYears > 0) {
    const md = documents.혼인_혼인일;
    let years = 0;
    if (md) {
      const d = new Date(md);
      const now = new Date();
      years = (now.getFullYear() - d.getFullYear());
    }
    const ok = md ? years <= condition.maxMarriageYears : false;
    rows.push({
      label: '혼인 기간',
      required: `${condition.maxMarriageYears}년 이내`,
      actual: md ? `${years}년 (${md})` : '미확인',
      status: md ? (ok ? 'match' : 'fail') : 'na',
    });
  }

  // 자녀 수 (다자녀)
  if (condition.minChildren && condition.minChildren > 0) {
    const actual = documents.가족_자녀수 || 0;
    const hasDoc = documents.가족_구성원수 > 0;
    const ok = actual >= condition.minChildren;
    rows.push({
      label: '미성년 자녀 수',
      required: `${condition.minChildren}명 이상`,
      actual: hasDoc ? `${actual}명` : '미확인',
      status: hasDoc ? (ok ? 'match' : 'fail') : 'na',
    });
  }

  // 소득 기준
  if (incomeTable && Object.keys(incomeTable).length > 0) {
    const hhSize = documents.등본_세대원수 || documents.가족_구성원수 || 0;
    const row = hhSize > 0 ? incomeTable[String(hhSize)] : null;
    const percent = condition.incomeLimitPercent || '100%';
    const limit = row ? row[percent] || row['100%'] || Object.values(row)[0] : 0;
    const monthly = (documents.소득_월평균 || 0) * 10000; // 만원→원
    const hasDoc = monthly > 0 && hhSize > 0;
    const ok = limit > 0 && monthly <= limit;
    rows.push({
      label: `소득 (${hhSize}인, ${percent})`,
      required: limit > 0 ? `${Math.round(limit / 10000).toLocaleString()}만원 이하` : '공고 기준표 적용',
      actual: hasDoc ? `${Math.round(monthly / 10000).toLocaleString()}만원` : '미확인',
      status: hasDoc && limit > 0 ? (ok ? 'match' : 'fail') : 'na',
    });
  } else if (condition.incomeLimit && condition.incomeLimit > 0) {
    const monthly = documents.소득_월평균 || 0;
    const ok = monthly > 0 && monthly <= condition.incomeLimit;
    rows.push({
      label: '월평균 소득',
      required: `${condition.incomeLimit}만원 이하`,
      actual: monthly > 0 ? `${monthly}만원` : '미확인',
      status: monthly > 0 ? (ok ? 'match' : 'fail') : 'na',
    });
  }

  return rows;
}

// ============ 기준 좌측 패널 ============

function EditableRow({
  label,
  value,
  suffix,
  type = 'number',
  onCommit,
}: {
  label: string;
  value: string | number;
  suffix: string;
  type?: 'number' | 'text';
  onCommit: (v: any) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => { setDraft(String(value ?? '')); }, [value]);
  const commit = () => {
    setEditing(false);
    if (type === 'number') {
      const n = parseFloat(draft);
      onCommit(Number.isFinite(n) ? n : 0);
    } else {
      onCommit(draft);
    }
  };
  return (
    <div className="px-4 py-2.5 flex justify-between items-center text-xs group">
      <span className="text-gray-500">{label}</span>
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            type={type}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setDraft(String(value ?? '')); setEditing(false); }
            }}
            className="w-16 px-1.5 py-0.5 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 text-right"
          />
          <span className="text-gray-500">{suffix}</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="font-semibold text-gray-800 hover:text-blue-600 hover:underline decoration-dotted"
          title="클릭하여 수정"
        >
          {value}{suffix && ` ${suffix}`}
        </button>
      )}
    </div>
  );
}

function CriteriaPane({
  announcement,
  supplyTypeKey,
  area,
  condition,
  incomeTable,
  onConditionOverride,
}: {
  announcement: AnnouncementRequirements;
  supplyTypeKey: string;
  area: number;
  condition: SupplyCondition | null;
  incomeTable?: Record<string, Record<string, number>>;
  onConditionOverride: (patch: Partial<SupplyCondition>) => void;
}) {
  if (!condition) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        선택한 공급유형·전용면적에 해당하는 조건을 찾을 수 없습니다.
      </div>
    );
  }
  const deposit = pickDepositForArea(condition.depositByArea, area);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="px-2 py-0.5 rounded-full bg-violet-600 text-white text-[10px] font-bold">
            {supplyTypeKey}
          </span>
          <span className="text-sm font-bold text-violet-900">{condition.label}</span>
          <span className="text-xs text-violet-600">· 전용 {area}m²</span>
        </div>
        {condition.description && (
          <p className="text-xs text-violet-800 leading-relaxed whitespace-pre-wrap">
            {condition.description}
          </p>
        )}
        {condition.descriptionBullets && condition.descriptionBullets.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-violet-700">
            {condition.descriptionBullets.map((b, i) => (
              <li key={i} className="flex gap-1.5"><span>·</span><span>{b}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 text-xs font-bold text-gray-600 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <span>자격 기준값</span>
          <span className="text-[10px] text-gray-400 font-normal">✏️ 숫자 클릭하여 수동 보정 가능</span>
        </div>
        <div className="divide-y divide-gray-100">
          <EditableRow
            label="청약통장 가입기간"
            value={condition.minSubscriptionMonths || 0}
            suffix="개월 이상"
            onCommit={(v) => onConditionOverride({ minSubscriptionMonths: v })}
          />
          <EditableRow
            label="납입 횟수"
            value={condition.minDepositCount || 0}
            suffix="회 이상"
            onCommit={(v) => onConditionOverride({ minDepositCount: v })}
          />
          {deposit && (
            <EditableRow
              label={`예치금 (${deposit.key}m² 기준)`}
              value={deposit.value || 0}
              suffix="만원 이상"
              onCommit={(v) => onConditionOverride({
                depositByArea: { ...(condition.depositByArea || {}), [deposit.key]: v }
              })}
            />
          )}
          <div className="px-4 py-2.5 flex justify-between items-center text-xs">
            <span className="text-gray-500">무주택 요건</span>
            <button
              type="button"
              onClick={() => onConditionOverride({ requireHomeless: !condition.requireHomeless })}
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${
                condition.requireHomeless ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {condition.requireHomeless ? '무주택 필수' : '제한 없음'}
            </button>
          </div>
          <div className="px-4 py-2.5 flex justify-between items-center text-xs">
            <span className="text-gray-500">세대주 요건</span>
            <button
              type="button"
              onClick={() => onConditionOverride({ requireHouseholdHead: !condition.requireHouseholdHead })}
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${
                condition.requireHouseholdHead ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {condition.requireHouseholdHead ? '세대주 필수' : '제한 없음'}
            </button>
          </div>
          {(!!condition.maxMarriageYears || supplyTypeKey.includes('신혼')) && (
            <EditableRow
              label="혼인 기간 (최대)"
              value={condition.maxMarriageYears || 0}
              suffix="년 이내"
              onCommit={(v) => onConditionOverride({ maxMarriageYears: v })}
            />
          )}
          {(!!condition.minChildren || supplyTypeKey.includes('다자녀')) && (
            <EditableRow
              label="자녀 수 (최소)"
              value={condition.minChildren || 0}
              suffix="명 이상"
              onCommit={(v) => onConditionOverride({ minChildren: v })}
            />
          )}
          {condition.incomeLimitPercent && (
            <div className="px-4 py-2.5 flex justify-between text-xs">
              <span className="text-gray-500">소득 한도</span>
              <span className="font-semibold text-gray-800">도시근로자 {condition.incomeLimitPercent} 이하</span>
            </div>
          )}
        </div>
      </div>

      {incomeTable && Object.keys(incomeTable).length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-bold text-gray-600 bg-gray-50 border-b border-gray-100">
            가구원수별 월평균 소득 한도 (원)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">가구원수</th>
                  {Object.keys(Object.values(incomeTable)[0] || {}).map(p => (
                    <th key={p} className="px-3 py-2 text-right font-semibold">{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Object.entries(incomeTable).map(([size, row]) => (
                  <tr key={size}>
                    <td className="px-3 py-1.5 text-gray-700 font-medium">{size}인</td>
                    {Object.entries(row).map(([p, v]) => (
                      <td key={p} className="px-3 py-1.5 text-right text-gray-700">{Number(v).toLocaleString()}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {announcement.resaleRestriction && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
          <div><span className="font-semibold">전매제한: </span>{announcement.resaleRestriction}</div>
          {announcement.rewinRestriction && (
            <div><span className="font-semibold">재당첨제한: </span>{announcement.rewinRestriction}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ 서류 비교 우측 패널 ============

function RequiredDocumentsList({
  requiredDocuments,
  supplyType,
  submittedDocs,
}: {
  requiredDocuments?: any;
  supplyType: string;
  submittedDocs: string[];
}) {
  if (!requiredDocuments) return null;
  const common = Array.isArray(requiredDocuments.common) ? requiredDocuments.common : [];
  const perType = requiredDocuments.perSupplyType?.[supplyType] || { required: [], conditional: [] };
  const required: any[] = Array.isArray(perType.required) ? perType.required : [];
  const conditional: any[] = Array.isArray(perType.conditional) ? perType.conditional : [];
  const total = common.length + required.length + conditional.length;
  if (total === 0) return null;

  const isSubmitted = (name: string) =>
    submittedDocs.some(d => d.includes(name) || name.includes(d));

  const renderItem = (item: any, variant: 'common' | 'required' | 'conditional', idx: number) => {
    const submitted = isSubmitted(item.name || '');
    const badgeLabel = variant === 'common' ? '공통' : variant === 'required' ? '필수' : '조건부';
    const badgeClass = variant === 'conditional'
      ? 'bg-amber-100 text-amber-700'
      : variant === 'required'
        ? 'bg-red-100 text-red-700'
        : 'bg-blue-100 text-blue-700';
    return (
      <div
        key={`${variant}-${idx}`}
        className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
          submitted ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-gray-100'
        }`}
      >
        <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
          submitted ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-400'
        }`}>
          {submitted && <CheckIcon className="w-2.5 h-2.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-gray-800">{item.name}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeClass}`}>{badgeLabel}</span>
            {item.condition && (
              <span className="text-[10px] text-amber-600 font-medium">[{item.condition}]</span>
            )}
          </div>
          {item.description && (
            <div className="text-gray-500 mt-0.5 leading-relaxed">{item.description}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 text-xs font-bold text-gray-600 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <span>📋 필요 서류 — {supplyType}</span>
        <span className="text-[10px] text-gray-400 font-normal">{total}건</span>
      </div>
      <div className="p-3 space-y-1.5">
        {common.map((i: any, idx: number) => renderItem(i, 'common', idx))}
        {required.map((i: any, idx: number) => renderItem(i, 'required', idx))}
        {conditional.map((i: any, idx: number) => renderItem(i, 'conditional', idx))}
      </div>
    </div>
  );
}

function ComparisonPane({
  documents,
  onDocumentParsed,
  onDocumentsChange,
  rows,
  requiredDocuments,
  supplyType,
  onSaveApplicant,
  currentApplicantId,
}: {
  documents: DocumentVerifiedData;
  onDocumentParsed: (docType: string, data: any) => void;
  onDocumentsChange: (partial: Partial<DocumentVerifiedData>) => void;
  rows: CriterionRow[];
  requiredDocuments?: any;
  supplyType: string;
  onSaveApplicant: () => void;
  currentApplicantId: string;
}) {
  const matchCount = rows.filter(r => r.status === 'match').length;
  const failCount = rows.filter(r => r.status === 'fail').length;
  const naCount = rows.filter(r => r.status === 'na').length;
  const verdict = failCount > 0 ? 'fail' : naCount === rows.length ? 'pending' : matchCount === rows.length ? 'pass' : 'partial';

  return (
    <div className="space-y-3">
      <RequiredDocumentsList
        requiredDocuments={requiredDocuments}
        supplyType={supplyType}
        submittedDocs={documents.제출서류목록 || []}
      />
      <DocumentOcrSection onDocumentParsed={onDocumentParsed} />
      <ManualEntryForm documents={documents} onChange={onDocumentsChange} />

      {rows.length > 0 && (
        <div className={`rounded-2xl border-2 p-4 text-center ${
          verdict === 'pass' ? 'bg-emerald-50 border-emerald-300' :
          verdict === 'fail' ? 'bg-red-50 border-red-300' :
          verdict === 'partial' ? 'bg-amber-50 border-amber-300' :
          'bg-gray-50 border-gray-200'
        }`}>
          <div className="text-2xl mb-1">
            {verdict === 'pass' ? '✅' : verdict === 'fail' ? '❌' : verdict === 'partial' ? '⚠️' : '📄'}
          </div>
          <div className={`text-base font-black ${
            verdict === 'pass' ? 'text-emerald-700' :
            verdict === 'fail' ? 'text-red-700' :
            verdict === 'partial' ? 'text-amber-700' : 'text-gray-600'
          }`}>
            {verdict === 'pass' ? '적합' : verdict === 'fail' ? '부적합' : verdict === 'partial' ? '일부 미확인' : '서류 업로드 대기'}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {matchCount} 충족 · {failCount} 미달 · {naCount} 미확인
          </div>
          <button
            type="button"
            onClick={onSaveApplicant}
            className={`mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              verdict === 'pass' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' :
              verdict === 'fail' ? 'bg-red-600 hover:bg-red-700 text-white' :
              'bg-gray-800 hover:bg-gray-900 text-white'
            }`}
          >
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={14} height={14}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {currentApplicantId ? '당첨자 정보 업데이트' : '당첨자로 저장'}
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 text-xs font-bold text-gray-600 bg-gray-50 border-b border-gray-100">
          서류 대조 결과
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            왼쪽에서 기준을 확인하고 위에서 서류를 업로드하세요.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-700">{r.label}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    r.status === 'match' ? 'bg-emerald-100 text-emerald-700' :
                    r.status === 'fail' ? 'bg-red-100 text-red-700' :
                    r.status === 'warn' ? 'bg-amber-100 text-amber-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {r.status === 'match' ? <><CheckIcon className="w-3 h-3" />적합</> :
                     r.status === 'fail' ? <><XIcon className="w-3 h-3" />부적합</> :
                     r.status === 'warn' ? <><AlertIcon className="w-3 h-3" />확인</> :
                     '미확인'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-violet-50 rounded-lg p-2">
                    <div className="text-violet-500 font-semibold mb-0.5">공고 기준</div>
                    <div className="text-gray-700">{r.required}</div>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-2">
                    <div className="text-emerald-500 font-semibold mb-0.5">서류 확인</div>
                    <div className="text-gray-700">{r.actual}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 메인 페이지 ============

export default function CheckerPage() {
  const [announcement, setAnnouncement] = useState<AnnouncementRequirements>(getDefaultAnnouncement());
  const [documents, setDocuments] = useState<DocumentVerifiedData>(getDefaultDocuments());
  const [selectedSupplyType, setSelectedSupplyType] = useState<string>('');
  const [selectedArea, setSelectedArea] = useState<string>('');
  const [inquired, setInquired] = useState(false);
  const [applicantName, setApplicantName] = useState('');
  const [applicantMemo, setApplicantMemo] = useState('');
  const [currentApplicantId, setCurrentApplicantId] = useState<string>('');
  const [saveToast, setSaveToast] = useState('');

  // 최초 마운트 시 저장된 공고 + 작성 중 초안 복원
  useEffect(() => {
    const savedProject = loadProject();
    if (savedProject) {
      setAnnouncement(savedProject.announcement);
    }
    // /applicants 페이지에서 '편집' 클릭 시 — 해당 당첨자를 로드
    let loadedFromEdit = false;
    try {
      const editingId = typeof window !== 'undefined' ? localStorage.getItem('checker:editing') : null;
      if (editingId) {
        const target = loadAllApplicants().find(a => a.id === editingId);
        if (target) {
          setDocuments(target.documents);
          setSelectedSupplyType(target.supplyType);
          setSelectedArea(String(target.area));
          setInquired(true);
          setApplicantName(target.name);
          setApplicantMemo(target.memo);
          setCurrentApplicantId(target.id);
          loadedFromEdit = true;
        }
        localStorage.removeItem('checker:editing');
      }
    } catch {}
    if (loadedFromEdit) return;
    const draft = loadCurrentApplicantDraft();
    if (draft) {
      if (draft.documents) setDocuments(draft.documents);
      if (draft.supplyType) setSelectedSupplyType(draft.supplyType);
      if (draft.area) setSelectedArea(draft.area);
      if (draft.inquired) setInquired(draft.inquired);
      if (draft.name) setApplicantName(draft.name);
      if (draft.memo) setApplicantMemo(draft.memo);
    }
  }, []);

  const updateAnnouncement = useCallback((partial: Partial<AnnouncementRequirements>) => {
    setAnnouncement(prev => {
      const next = { ...prev, ...partial };
      // 변경될 때마다 저장
      saveProject(next);
      return next;
    });
  }, []);
  const updateDocuments = useCallback((partial: Partial<DocumentVerifiedData>) => {
    setDocuments(prev => ({ ...prev, ...partial }));
  }, []);

  // 작성 초안 자동 저장 (디바운스 간단 구현)
  useEffect(() => {
    const t = setTimeout(() => {
      saveCurrentApplicantDraft({
        projectId: announcement.complexName,
        supplyType: selectedSupplyType,
        area: selectedArea,
        inquired,
        documents,
        name: applicantName,
        memo: applicantMemo,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [announcement.complexName, selectedSupplyType, selectedArea, inquired, documents, applicantName, applicantMemo]);

  const supplyTypeList = announcement.supplyTypes || [];
  const areaList = announcement.exclusiveAreas || [];
  const currentSupplyType = supplyTypeList.find(s => s.type === selectedSupplyType);
  const matchedCondition: SupplyCondition | null = useMemo(() => {
    if (!inquired || !currentSupplyType || !selectedArea) return null;
    return pickConditionForArea(currentSupplyType.conditions || [], Number(selectedArea));
  }, [inquired, currentSupplyType, selectedArea]);

  const criterionRows = useMemo(() => {
    if (!matchedCondition || !selectedArea) return [];
    return buildCriterionRows(
      matchedCondition,
      Number(selectedArea),
      documents,
      selectedSupplyType,
      currentSupplyType?.incomeTable,
    );
  }, [matchedCondition, selectedArea, documents, selectedSupplyType, currentSupplyType]);

  // 현재 단계 계산
  const currentStep: 1 | 2 | 3 | 4 = useMemo(() => {
    if (!announcement.complexName && supplyTypeList.length === 0) return 1;
    if (!inquired) return 2;
    if (criterionRows.every(r => r.status === 'na')) return 3;
    return 4;
  }, [announcement.complexName, supplyTypeList.length, inquired, criterionRows]);

  // 전용면적 추가/삭제
  const addExclusiveArea = useCallback((val: number) => {
    if (!Number.isFinite(val) || val <= 20 || val >= 500) return;
    const cur = announcement.exclusiveAreas || [];
    if (cur.some(a => Math.abs(a - val) < 0.01)) return; // 중복
    updateAnnouncement({ exclusiveAreas: [...cur, val].sort((a, b) => a - b) });
  }, [announcement.exclusiveAreas, updateAnnouncement]);

  const removeExclusiveArea = useCallback((val: number) => {
    const cur = announcement.exclusiveAreas || [];
    updateAnnouncement({ exclusiveAreas: cur.filter(a => Math.abs(a - val) >= 0.01) });
    if (selectedArea && Math.abs(Number(selectedArea) - val) < 0.01) {
      setSelectedArea('');
      setInquired(false);
    }
  }, [announcement.exclusiveAreas, updateAnnouncement, selectedArea]);

  // 기준값 수동 보정 — 현재 matchedCondition을 수정
  const overrideCondition = useCallback((patch: Partial<SupplyCondition>) => {
    if (!currentSupplyType || !matchedCondition) return;
    const newConditions = (currentSupplyType.conditions || []).map(c =>
      c === matchedCondition ? { ...c, ...patch } : c
    );
    const newSupplyTypes = supplyTypeList.map(st =>
      st.type === currentSupplyType.type ? { ...st, conditions: newConditions } : st
    );
    updateAnnouncement({ supplyTypes: newSupplyTypes });
  }, [currentSupplyType, matchedCondition, supplyTypeList, updateAnnouncement]);

  // 당첨자 저장
  const saveCurrentApplicant = useCallback(() => {
    if (!announcement.complexName) {
      setSaveToast('공고가 선택되지 않았습니다.');
      setTimeout(() => setSaveToast(''), 2500);
      return;
    }
    if (!selectedSupplyType || !selectedArea) {
      setSaveToast('공급유형과 전용면적을 먼저 선택하세요.');
      setTimeout(() => setSaveToast(''), 2500);
      return;
    }
    const matchCount = criterionRows.filter(r => r.status === 'match').length;
    const failCount = criterionRows.filter(r => r.status === 'fail').length;
    const naCount = criterionRows.filter(r => r.status === 'na').length;
    const verdict: SavedApplicant['verdict'] =
      failCount > 0 ? 'fail' :
      naCount === criterionRows.length ? 'pending' :
      matchCount === criterionRows.length ? 'pass' : 'partial';
    const failReasons = criterionRows.filter(r => r.status === 'fail').map(r => r.label);
    const id = currentApplicantId || newApplicantId();
    const now = new Date().toISOString();
    const applicant: SavedApplicant = {
      id,
      projectId: announcement.complexName,
      projectName: announcement.complexName,
      name: applicantName || '미입력',
      supplyType: selectedSupplyType,
      area: Number(selectedArea),
      documents,
      verdict,
      matchCount,
      failCount,
      naCount,
      failReasons,
      memo: applicantMemo,
      createdAt: now,
      updatedAt: now,
    };
    upsertApplicant(applicant);
    setCurrentApplicantId(id);
    setSaveToast(currentApplicantId ? '당첨자 정보가 수정되었습니다.' : '당첨자가 저장되었습니다.');
    setTimeout(() => setSaveToast(''), 2500);
  }, [announcement.complexName, selectedSupplyType, selectedArea, criterionRows, currentApplicantId, applicantName, applicantMemo, documents]);

  // 새 당첨자 시작
  const startNewApplicant = useCallback(() => {
    setDocuments(getDefaultDocuments());
    setApplicantName('');
    setApplicantMemo('');
    setCurrentApplicantId('');
    setInquired(false);
    setSaveToast('새 당첨자 입력 모드');
    setTimeout(() => setSaveToast(''), 2000);
  }, []);

  const onDocumentParsed = useCallback((docType: string, data: any) => {
    if (docType === '주민등록등본') updateDocuments({
      등본_세대주: data.세대주 || '',
      등본_세대주여부: data.세대주여부 ?? false,
      등본_주소: data.주소 || '',
      등본_세대원수: data.세대원수 || 0,
    });
    else if (docType === '주민등록초본') updateDocuments({
      초본_전입일: data.최근전입일 || '',
      초본_거주기간개월: data.거주기간개월 || 0,
    });
    else if (docType === '가족관계증명서') updateDocuments({
      가족_구성원수: data.구성원수 || 0,
      가족_배우자: data.배우자 || '',
      가족_자녀수: data.자녀수 || 0,
      가족_직계존속수: data.직계존속수 || 0,
    });
    else if (docType === '혼인관계증명서') updateDocuments({
      혼인_혼인일: data.혼인일 || '',
      혼인_상태: data.혼인상태 || '',
    });
    else if (docType === '청약통장확인서') updateDocuments({
      통장_종류: data.통장종류 || '',
      통장_가입일: data.가입일 || '',
      통장_납입횟수: data.납입횟수 || 0,
      통장_예치금: data.예치금 || 0,
    });
    else if (docType === '소득증빙') updateDocuments({
      소득_월평균: data.월평균소득 || 0,
      소득_연간: data.연간소득 || 0,
    });
    else if (docType === '건강보험료납부확인서') updateDocuments({
      건보_월납부액: data.월납부액 || 0,
    });
    else if (docType === '등기사항전부증명서') updateDocuments({
      등기_주택소유여부: data.주택소유여부 ?? false,
      등기_소유주택수: data.소유주택수 || 0,
    });
  }, [updateDocuments]);

  const handlePdfResult = useCallback((data: any) => {
    if (!data) return;
    const update: Partial<AnnouncementRequirements> = {};
    if (data.announcementName) update.complexName = data.announcementName;
    if (data.housingType) update.housingType = data.housingType;
    if (data.region) update.region = data.region;
    if (data.localRegion) update.localRegion = data.localRegion;
    if (data.otherRegions) update.otherRegions = data.otherRegions;
    if (data.isRegulated !== undefined) update.isRegulated = data.isRegulated;
    if (data.resaleRestriction) update.resaleRestriction = data.resaleRestriction;
    if (data.rewinRestriction) update.rewinRestriction = data.rewinRestriction;
    if (data.announcementDate) update.announcementDate = data.announcementDate;
    if (data.requiredDocuments) update.requiredDocuments = data.requiredDocuments;
    if (Array.isArray(data.exclusiveAreas)) {
      // 문자열/숫자 혼재 대응 + 숫자 변환 + 중복 제거 + 정렬
      const normalized = Array.from(new Set(
        data.exclusiveAreas
          .map((v: any) => typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.]/g, '')))
          .filter((n: number) => Number.isFinite(n) && n > 20 && n < 500)
      )).sort((a: any, b: any) => a - b) as number[];
      update.exclusiveAreas = normalized;
    }
    if (data.supplyTypes?.length) {
      update.supplyTypes = data.supplyTypes;
    }
    updateAnnouncement(update);
    setSelectedSupplyType('');
    setSelectedArea('');
    setInquired(false);
  }, [updateAnnouncement]);

  const canInquire = !!(selectedSupplyType && selectedArea);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white text-lg font-bold">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={22} height={22}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-black text-gray-900">청약 서류 교차검증</h1>
              <p className="text-xs text-gray-400">공고 자격조건 · 제출 서류 자동 대조</p>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link
              href="/applicants"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100"
            >
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={14} height={14}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              당첨자 현황
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5 space-y-5">
        {/* 단계 표시 */}
        <StepIndicator currentStep={currentStep} />

        {/* 1단계: PDF 업로드 */}
        <PdfAnnouncementUpload onResult={handlePdfResult} />

        {/* 저장 토스트 */}
        {saveToast && (
          <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-semibold shadow-2xl">
            {saveToast}
          </div>
        )}

        {/* 2단계: 고정 정보 + 드롭박스 + 조회 버튼 */}
        {(announcement.complexName || supplyTypeList.length > 0) && (
          <div className="rounded-2xl border border-violet-200 bg-white p-4 space-y-4">
            {/* 고정 정보 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">단지명</label>
                <div className="px-2.5 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-800 font-semibold">
                  {announcement.complexName || '-'}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">주택유형</label>
                <div className="px-2.5 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                  {announcement.housingType || '-'}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">지역</label>
                <div className="px-2.5 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                  {[announcement.region, announcement.localRegion].filter(Boolean).join(' · ') || '-'}
                </div>
              </div>
            </div>

            {/* 공급유형 버튼 (툴팁 포함) */}
            {supplyTypeList.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">공급유형 (마우스 오버: 자격조건)</label>
                <div className="flex flex-wrap gap-2">
                  {supplyTypeList.map(st => {
                    const firstCond = st.conditions?.[0];
                    const tipContent = (
                      <div>
                        <div className="font-bold text-white mb-1">{st.type} — {firstCond?.label || ''}</div>
                        {firstCond?.description && (
                          <div className="text-gray-200 mb-2">{firstCond.description}</div>
                        )}
                        {firstCond?.descriptionBullets && firstCond.descriptionBullets.length > 0 && (
                          <ul className="space-y-0.5 text-gray-100">
                            {firstCond.descriptionBullets.map((b, i) => (
                              <li key={i} className="flex gap-1"><span>·</span><span>{b}</span></li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                    const active = selectedSupplyType === st.type;
                    return (
                      <Tooltip key={st.type} content={tipContent}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSupplyType(st.type);
                            setInquired(false);
                          }}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                            active
                              ? 'bg-violet-600 border-violet-600 text-white'
                              : 'bg-white border-gray-200 text-gray-700 hover:border-violet-300 hover:bg-violet-50'
                          }`}
                        >
                          {st.type}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 공급대상 표 (PDF 파싱된 주택형별 세대수 상세) */}
            {(announcement.supplyUnits && announcement.supplyUnits.length > 0) && (
              <SupplyUnitsPanel
                units={announcement.supplyUnits}
                selectedArea={selectedArea}
                selectedSupplyType={selectedSupplyType}
                onSelectArea={(v) => { setSelectedArea(v); setInquired(false); }}
              />
            )}

            {/* 전용면적 (수동 편집 가능) */}
            <ExclusiveAreaEditor
              areas={areaList}
              selected={selectedArea}
              onSelect={(v) => { setSelectedArea(v); setInquired(false); }}
              onAdd={addExclusiveArea}
              onRemove={removeExclusiveArea}
            />

            {/* 당첨자 정보 + 조회 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-2 border-t border-gray-100">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">당첨자명 (선택)</label>
                <Input value={applicantName} onChange={setApplicantName} placeholder="홍길동" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">메모 (선택)</label>
                <Input value={applicantMemo} onChange={setApplicantMemo} placeholder="특이사항" />
              </div>
              <div className="flex justify-end gap-2">
                {currentApplicantId && (
                  <button
                    type="button"
                    onClick={startNewApplicant}
                    className="px-3 py-2 rounded-xl text-xs font-bold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                  >
                    새 당첨자
                  </button>
                )}
                <button
                  type="button"
                  disabled={!canInquire}
                  onClick={() => setInquired(true)}
                  className={`px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                    canInquire
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={16} height={16}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                  조회
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3단계: 좌우 분할 — 왼쪽 기준값, 오른쪽 서류 업로드·비교 */}
        {inquired && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-bold text-violet-600 mb-2 uppercase tracking-wide">
                기준값 (공고)
              </div>
              <CriteriaPane
                announcement={announcement}
                supplyTypeKey={selectedSupplyType}
                area={Number(selectedArea)}
                condition={matchedCondition}
                incomeTable={currentSupplyType?.incomeTable}
                onConditionOverride={overrideCondition}
              />
            </div>
            <div>
              <div className="text-xs font-bold text-emerald-600 mb-2 uppercase tracking-wide">
                당첨자 제출 서류
              </div>
              <ComparisonPane
                documents={documents}
                onDocumentParsed={onDocumentParsed}
                onDocumentsChange={updateDocuments}
                rows={criterionRows}
                requiredDocuments={announcement.requiredDocuments}
                supplyType={selectedSupplyType}
                onSaveApplicant={saveCurrentApplicant}
                currentApplicantId={currentApplicantId}
              />
            </div>
          </div>
        )}

        {/* 초기 안내 */}
        {!announcement.complexName && supplyTypeList.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">
              먼저 입주자모집공고문 PDF를 업로드해주세요.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

