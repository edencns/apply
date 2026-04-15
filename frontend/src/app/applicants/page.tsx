'use client';

/**
 * 당첨자 현황 — Master/Detail 2-pane 레이아웃
 *
 * 왼쪽(Master): 저장된 당첨자 목록 + 필터(공급유형/판정/검색)
 * 오른쪽(Detail): 선택된 당첨자 상세 — 판정, 부적합 항목, 서류 요약, 메모
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  loadAllApplicants,
  deleteApplicant,
  loadProject,
  type SavedApplicant,
  type SavedProject,
} from '@/lib/applicant-storage';

// ─── 판정 뱃지 ───

function VerdictBadge({ verdict }: { verdict: SavedApplicant['verdict'] }) {
  const map = {
    pass: { label: '적합', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    fail: { label: '부적합', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    partial: { label: '부분적합', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    pending: { label: '미검수', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  } as const;
  const c = map[verdict] ?? map.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold ${c.cls}`}>
      {c.label}
    </span>
  );
}

// ─── 날짜 포맷 ───

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return iso;
  }
}

// ─── Master 리스트 아이템 ───

function ApplicantListItem({
  applicant,
  selected,
  onClick,
}: {
  applicant: SavedApplicant;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-l-4 transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-50'
          : 'border-transparent hover:bg-gray-50 border-b border-b-gray-100'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-bold text-gray-900 truncate">{applicant.name}</span>
        <VerdictBadge verdict={applicant.verdict} />
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-1 flex-wrap">
        <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-semibold">
          {applicant.supplyType}
        </span>
        <span className="text-gray-400">·</span>
        <span>{applicant.area}m²</span>
        <span className="text-gray-400">·</span>
        <span className="truncate">{applicant.projectName}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-gray-400">
        <span>{formatDate(applicant.updatedAt)}</span>
        {applicant.failCount > 0 && (
          <span className="text-rose-500 font-semibold">· 부적합 {applicant.failCount}건</span>
        )}
      </div>
    </button>
  );
}

// ─── Detail 패널 ───

function DetailPanel({
  applicant,
  onDelete,
  onEdit,
}: {
  applicant: SavedApplicant | null;
  onDelete: (id: string) => void;
  onEdit: (a: SavedApplicant) => void;
}) {
  if (!applicant) {
    return (
      <div className="h-full flex items-center justify-center p-10 text-center">
        <div>
          <svg className="mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={48} height={48}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
          <p className="text-sm text-gray-400">왼쪽 목록에서 당첨자를 선택하세요</p>
        </div>
      </div>
    );
  }

  const total = applicant.matchCount + applicant.failCount + applicant.naCount;

  return (
    <div className="p-5 space-y-4 overflow-y-auto h-full">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-black text-gray-900">{applicant.name}</h2>
            <VerdictBadge verdict={applicant.verdict} />
          </div>
          <div className="text-xs text-gray-500">
            {applicant.projectName} · {applicant.supplyType} · 전용 {applicant.area}m²
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            생성 {formatDate(applicant.createdAt)} · 수정 {formatDate(applicant.updatedAt)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(applicant)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100"
          >
            편집
          </button>
          <button
            onClick={() => {
              if (confirm(`'${applicant.name}' 당첨자를 삭제하시겠습니까?`)) onDelete(applicant.id);
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100"
          >
            삭제
          </button>
        </div>
      </div>

      {/* 판정 요약 카드 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
          <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">일치</div>
          <div className="text-2xl font-black text-emerald-700 mt-1">{applicant.matchCount}</div>
          <div className="text-[10px] text-emerald-500">/ {total}</div>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center">
          <div className="text-[10px] font-bold text-rose-600 uppercase tracking-wide">부적합</div>
          <div className="text-2xl font-black text-rose-700 mt-1">{applicant.failCount}</div>
          <div className="text-[10px] text-rose-500">/ {total}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center">
          <div className="text-[10px] font-bold text-gray-600 uppercase tracking-wide">미검증</div>
          <div className="text-2xl font-black text-gray-700 mt-1">{applicant.naCount}</div>
          <div className="text-[10px] text-gray-500">/ {total}</div>
        </div>
      </div>

      {/* 부적합 사유 */}
      {applicant.failReasons.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
          <div className="text-xs font-bold text-rose-700 mb-2">부적합 항목 ({applicant.failReasons.length})</div>
          <ul className="space-y-1.5">
            {applicant.failReasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-rose-900">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 서류 요약 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs font-bold text-gray-700 mb-2.5">제출 서류 요약</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <DetailRow label="세대주" value={applicant.documents?.등본_세대주 || '-'} />
          <DetailRow label="세대원 수" value={String(applicant.documents?.등본_세대원수 ?? '-')} />
          <DetailRow label="거주 (주소)" value={applicant.documents?.등본_주소 || '-'} />
          <DetailRow label="거주기간 (개월)" value={String(applicant.documents?.초본_거주기간개월 ?? '-')} />
          <DetailRow label="청약통장 가입일" value={applicant.documents?.통장_가입일 || '-'} />
          <DetailRow label="납입횟수" value={String(applicant.documents?.통장_납입횟수 ?? '-') + '회'} />
          <DetailRow label="예치금액" value={
            applicant.documents?.통장_예치금
              ? `${applicant.documents.통장_예치금.toLocaleString()}만원`
              : '-'
          } />
          <DetailRow label="혼인상태" value={applicant.documents?.혼인_상태 || '-'} />
          <DetailRow label="혼인일" value={applicant.documents?.혼인_혼인일 || '-'} />
          <DetailRow label="자녀 수" value={String(applicant.documents?.가족_자녀수 ?? '-') + '명'} />
          <DetailRow label="월평균 소득" value={
            applicant.documents?.소득_월평균
              ? `${applicant.documents.소득_월평균.toLocaleString()}만원`
              : '-'
          } />
          <DetailRow label="주택소유" value={
            applicant.documents?.등기_주택소유여부 === true ? `유주택 (${applicant.documents?.등기_소유주택수 ?? 0}호)` :
            applicant.documents?.등기_주택소유여부 === false ? '무주택' : '-'
          } />
        </div>
      </div>

      {/* 메모 */}
      {applicant.memo && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-bold text-amber-700 mb-1.5">메모</div>
          <p className="text-xs text-amber-900 leading-relaxed whitespace-pre-wrap">{applicant.memo}</p>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-gray-100 py-1">
      <span className="text-gray-500 text-[11px]">{label}</span>
      <span className="text-gray-800 font-semibold text-right truncate max-w-[60%]">{value}</span>
    </div>
  );
}

// ─── 메인 페이지 ───

type VerdictFilter = 'all' | 'pass' | 'fail' | 'partial' | 'pending';

export default function ApplicantsPage() {
  const [applicants, setApplicants] = useState<SavedApplicant[]>([]);
  const [project, setProject] = useState<SavedProject | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [supplyFilter, setSupplyFilter] = useState<string>('all');
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  // 초기 로드
  useEffect(() => {
    setApplicants(loadAllApplicants());
    setProject(loadProject());
  }, []);

  // 공급유형 목록 (동적으로 추출)
  const supplyTypeOptions = useMemo(() => {
    const set = new Set<string>();
    applicants.forEach(a => a.supplyType && set.add(a.supplyType));
    return Array.from(set).sort();
  }, [applicants]);

  // 프로젝트 목록
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    applicants.forEach(a => a.projectName && set.add(a.projectName));
    return Array.from(set).sort();
  }, [applicants]);

  // 필터링된 목록
  const filteredApplicants = useMemo(() => {
    let list = applicants;
    if (supplyFilter !== 'all') list = list.filter(a => a.supplyType === supplyFilter);
    if (verdictFilter !== 'all') list = list.filter(a => a.verdict === verdictFilter);
    if (projectFilter !== 'all') list = list.filter(a => a.projectName === projectFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.projectName.toLowerCase().includes(q) ||
        a.memo.toLowerCase().includes(q)
      );
    }
    // 최신순
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [applicants, supplyFilter, verdictFilter, projectFilter, searchQuery]);

  // 통계
  const stats = useMemo(() => {
    const total = filteredApplicants.length;
    const pass = filteredApplicants.filter(a => a.verdict === 'pass').length;
    const fail = filteredApplicants.filter(a => a.verdict === 'fail').length;
    const partial = filteredApplicants.filter(a => a.verdict === 'partial').length;
    const pending = filteredApplicants.filter(a => a.verdict === 'pending').length;
    return { total, pass, fail, partial, pending };
  }, [filteredApplicants]);

  const selected = useMemo(
    () => filteredApplicants.find(a => a.id === selectedId) || null,
    [filteredApplicants, selectedId]
  );

  // 선택 항목이 필터로 사라지면 첫 항목으로 자동 이동
  useEffect(() => {
    if (!selected && filteredApplicants.length > 0) {
      setSelectedId(filteredApplicants[0].id);
    }
  }, [filteredApplicants, selected]);

  const handleDelete = useCallback((id: string) => {
    const newList = deleteApplicant(id);
    setApplicants(newList);
    if (selectedId === id) setSelectedId('');
  }, [selectedId]);

  const handleEdit = useCallback((a: SavedApplicant) => {
    // localStorage에 current id 설정 → checker 페이지에서 읽어 편집 모드로 진입하도록
    try {
      localStorage.setItem('checker:editing', a.id);
    } catch {}
    window.location.href = '/checker';
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/checker" className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white hover:bg-blue-700">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={22} height={22}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </Link>
            <div>
              <h1 className="text-base font-black text-gray-900">당첨자 현황</h1>
              <p className="text-xs text-gray-400">
                {project?.announcement?.complexName
                  ? `현재 공고: ${project.announcement.complexName}`
                  : '저장된 당첨자 · 판정 결과'}
              </p>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link
              href="/checker"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100"
            >
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={14} height={14}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              새 당첨자 추가
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5 space-y-4">
        {/* 통계 바 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="전체" value={stats.total} color="gray" />
          <StatCard label="적합" value={stats.pass} color="emerald" />
          <StatCard label="부적합" value={stats.fail} color="rose" />
          <StatCard label="부분적합" value={stats.partial} color="amber" />
          <StatCard label="미검수" value={stats.pending} color="blue" />
        </div>

        {/* 필터 바 */}
        <div className="rounded-2xl border border-gray-200 bg-white p-3 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="이름·공고·메모 검색"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">전체 공고</option>
            {projectOptions.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={supplyFilter}
            onChange={e => setSupplyFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">전체 공급유형</option>
            {supplyTypeOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="inline-flex rounded-lg overflow-hidden border border-gray-200">
            {(['all', 'pass', 'fail', 'partial', 'pending'] as const).map(v => (
              <button
                key={v}
                onClick={() => setVerdictFilter(v)}
                className={`px-3 py-2 text-xs font-semibold border-r border-gray-200 last:border-r-0 ${
                  verdictFilter === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {v === 'all' ? '전체' : v === 'pass' ? '적합' : v === 'fail' ? '부적합' : v === 'partial' ? '부분' : '미검수'}
              </button>
            ))}
          </div>
        </div>

        {/* Master-Detail 2-pane */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-[520px]">
          {/* Master (왼쪽) */}
          <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                목록 ({filteredApplicants.length})
              </span>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[620px]">
              {filteredApplicants.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">
                  {applicants.length === 0
                    ? '저장된 당첨자가 없습니다.'
                    : '필터에 일치하는 당첨자가 없습니다.'}
                </div>
              ) : (
                filteredApplicants.map(a => (
                  <ApplicantListItem
                    key={a.id}
                    applicant={a}
                    selected={a.id === (selected?.id ?? '')}
                    onClick={() => setSelectedId(a.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Detail (오른쪽) */}
          <div className="lg:col-span-3 rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <DetailPanel applicant={selected} onDelete={handleDelete} onEdit={handleEdit} />
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'gray' | 'emerald' | 'rose' | 'amber' | 'blue';
}) {
  const map = {
    gray: 'border-gray-200 bg-white text-gray-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
  };
  return (
    <div className={`rounded-2xl border p-3 ${map[color]}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-black mt-0.5">{value}</div>
    </div>
  );
}
