/**
 * 현장(공고) + 당첨자 localStorage 영속화
 *
 * 구조:
 *  - project: 현재 로드된 공고 데이터 (1개만 유지, 새 PDF 업로드 시 교체)
 *  - applicants: 당첨자 리스트 (프로젝트별로 분리)
 *  - draft: 작성 중인 당첨자 초안 (페이지 새로고침 복원용)
 */

import type { AnnouncementRequirements, DocumentVerifiedData } from './verification-engine';

const KEY_PROJECT = 'checker:project';
const KEY_APPLICANTS = 'checker:applicants';
const KEY_DRAFT = 'checker:draft';

export interface SavedProject {
  id: string;                    // 단지명 기반 해시
  announcement: AnnouncementRequirements;
  savedAt: string;               // ISO
}

export interface SavedApplicant {
  id: string;
  projectId: string;             // 어느 공고에 속한 당첨자인지
  projectName: string;           // 단지명 스냅샷 (프로젝트 삭제되어도 유지)
  name: string;                  // 세대주명 또는 신청자명
  supplyType: string;            // 공급유형 (일반공급/다자녀가구/...)
  area: number;                  // 전용면적 (m²)
  documents: DocumentVerifiedData;
  verdict: 'pass' | 'fail' | 'partial' | 'pending';
  matchCount: number;
  failCount: number;
  naCount: number;
  failReasons: string[];         // 부적합 항목 라벨 리스트
  memo: string;                  // 메모
  createdAt: string;             // ISO
  updatedAt: string;             // ISO
}

// ─── 유틸 ───

function safeLoad<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSave(key: string, value: any): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function projectIdFromName(name: string): string {
  // 공백 제거 후 알파벳화, 같은 단지는 같은 id
  return (name || 'unknown').trim().replace(/\s+/g, '_');
}

export function newApplicantId(): string {
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Project ───

export function saveProject(announcement: AnnouncementRequirements): SavedProject | null {
  if (!announcement.complexName) return null;
  const project: SavedProject = {
    id: projectIdFromName(announcement.complexName),
    announcement,
    savedAt: new Date().toISOString(),
  };
  safeSave(KEY_PROJECT, project);
  return project;
}

export function loadProject(): SavedProject | null {
  return safeLoad<SavedProject | null>(KEY_PROJECT, null);
}

export function clearProject(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY_PROJECT);
}

// ─── Applicants ───

export function loadAllApplicants(): SavedApplicant[] {
  return safeLoad<SavedApplicant[]>(KEY_APPLICANTS, []);
}

export function loadApplicantsForProject(projectId: string): SavedApplicant[] {
  return loadAllApplicants().filter(a => a.projectId === projectId);
}

export function upsertApplicant(applicant: SavedApplicant): SavedApplicant[] {
  const list = loadAllApplicants();
  const idx = list.findIndex(a => a.id === applicant.id);
  if (idx >= 0) {
    list[idx] = { ...applicant, updatedAt: new Date().toISOString() };
  } else {
    list.push({ ...applicant, createdAt: applicant.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  safeSave(KEY_APPLICANTS, list);
  return list;
}

export function deleteApplicant(id: string): SavedApplicant[] {
  const list = loadAllApplicants().filter(a => a.id !== id);
  safeSave(KEY_APPLICANTS, list);
  return list;
}

export function deleteApplicantsForProject(projectId: string): SavedApplicant[] {
  const list = loadAllApplicants().filter(a => a.projectId !== projectId);
  safeSave(KEY_APPLICANTS, list);
  return list;
}

// ─── Draft (페이지 새로고침 복원) ───

export interface ApplicantDraft {
  projectId: string;
  supplyType: string;
  area: string;
  inquired: boolean;
  documents: DocumentVerifiedData;
  name: string;
  memo: string;
}

export function saveCurrentApplicantDraft(draft: Partial<ApplicantDraft>): void {
  const existing = safeLoad<ApplicantDraft | null>(KEY_DRAFT, null) || {} as ApplicantDraft;
  safeSave(KEY_DRAFT, { ...existing, ...draft });
}

export function loadCurrentApplicantDraft(): ApplicantDraft | null {
  return safeLoad<ApplicantDraft | null>(KEY_DRAFT, null);
}

export function clearApplicantDraft(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY_DRAFT);
}
