"use client";

/**
 * 워크플로우 단계 페이지 공용 셸
 *
 * - 헤더: 단계 번호 + 제목 + 설명
 * - 공고 선택 (AnnouncementPicker)
 * - 이전/다음 단계 네비게이션
 * - 본문 children은 단계별 커스텀 콘텐츠
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  localAnnouncements,
  isNetworkError,
  activeAnnouncement,
  LocalAnnouncement,
} from "@/lib/local-store";
import AnnouncementPicker from "@/components/AnnouncementPicker";
import { getSampleAsLocalAnnouncements } from "@/lib/sample-adapter";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";

export interface WorkflowStep {
  step: number;
  key: string;
  title: string;
  description: string;
  fileHint?: string;         // "이 단계에 필요한 파일"
  href: string;
  prev?: string;             // 이전 단계 href
  next?: string;             // 다음 단계 href
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: 1,
    key: "registration",
    title: "당첨자 등록",
    description: "전산추첨결과·당첨자현황 PDF·예비입주자 명단 등 당첨자 원본 파일을 올려 고객으로 등록합니다.",
    fileHint: "전산추첨결과.xlsx, 당첨자현황.pdf, 인포용 명단 등",
    href: "/workflow/registration",
  },
  {
    step: 2,
    key: "household",
    title: "세대원 확인",
    description: "당첨자 본인과 세대원 전원의 주민번호를 확보합니다. 다음 단계(주택소유 조회) 입력 리스트가 됩니다.",
    fileHint: "당첨자세대원내역.xlsx",
    href: "/workflow/household",
  },
  {
    step: 3,
    key: "property",
    title: "주택소유 조회",
    description: "세대 전원의 주택 보유 여부를 판정합니다. 공고의 규제지역 여부에 따라 기준이 달라집니다.",
    fileHint: "주택소유정보전산검색결과.xlsx",
    href: "/workflow/property",
  },
  {
    step: 4,
    key: "savings",
    title: "청약통장 순위",
    description: "청약통장 가입기간과 순위확인 통보 결과를 확인합니다. 공고 최소 가입기간을 자동 대조합니다.",
    fileHint: "입주자저축순위확인 통보 PDF",
    href: "/workflow/savings",
  },
  {
    step: 5,
    key: "documents",
    title: "서류·판정",
    description: "공급유형별 필수 서류 체크리스트 + 4단계 종합으로 최종 적합·부적합 판정을 내립니다. 부적합일 경우 예비 승계가 가능합니다.",
    href: "/workflow/documents",
  },
];

// 단계 간 prev/next 자동 세팅
WORKFLOW_STEPS.forEach((s, i) => {
  s.prev = i > 0 ? WORKFLOW_STEPS[i - 1].href : undefined;
  s.next = i < WORKFLOW_STEPS.length - 1 ? WORKFLOW_STEPS[i + 1].href : undefined;
});

interface Props {
  step: WorkflowStep;
  selected: LocalAnnouncement | null;
  onSelect: (ann: LocalAnnouncement | null) => void;
  children: React.ReactNode;
}

export default function WorkflowShell({ step, selected, onSelect, children }: Props) {
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<LocalAnnouncement[]>([]);

  const loadAnnouncements = useCallback(async () => {
    const local = localAnnouncements.listAll();
    const samples = getSampleAsLocalAnnouncements();
    try {
      const r = await api.get(`/announcements/`);
      const backend = Array.isArray(r.data) ? r.data : [];
      const merged: LocalAnnouncement[] = [...backend];
      for (const l of local) if (!merged.some((a) => a.id === l.id)) merged.push(l);
      for (const s of samples) if (!merged.some((a) => a.id === s.id)) merged.push(s);
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
      if (!selected) {
        const active = activeAnnouncement.get();
        const target =
          (active && list.find((a) => a.id === active.id))
          || (active?.snapshot as LocalAnnouncement | null)
          || list[0]
          || null;
        if (target) onSelect(target);
      }
    })();
  }, [loadAnnouncements]); // eslint-disable-line

  // 선택 변경 시 active 공고 갱신
  useEffect(() => {
    if (selected) {
      activeAnnouncement.set(
        { id: selected.id, title: selected.title, announcement_no: selected.announcement_no },
        selected.id < 0 ? "local" : "backend",
        selected,
      );
    }
  }, [selected]);

  const totalSteps = WORKFLOW_STEPS.length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* 단계 헤더 */}
      <div className="mb-5">
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
          <span>서류 검수 단계</span>
          <ChevronRight className="w-3 h-3" />
          <span>{step.step} / {totalSteps}</span>
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold">
                {step.step}
              </span>
              {step.title}
            </h1>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">{step.description}</p>
            {step.fileHint && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2.5 py-0.5">
                <Info className="w-3 h-3" />
                <span>필요 파일: {step.fileHint}</span>
              </div>
            )}
          </div>

          {/* 이전/다음 단계 */}
          <div className="flex items-center gap-2">
            {step.prev && (
              <Link
                href={step.prev}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                이전 단계
              </Link>
            )}
            {step.next && (
              <Link
                href={step.next}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
              >
                다음 단계
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* 공고 선택 */}
      <AnnouncementPicker
        announcements={announcements as any}
        selected={selected as any}
        onSelect={(a) => onSelect(a as any)}
        onOpenDetail={(a) => router.push(`/announcements/${a.id}`)}
      />

      {/* 본문 */}
      {!selected ? (
        <div className="card text-center py-16 text-gray-400">
          <p className="text-sm">공고를 먼저 선택해 주세요</p>
        </div>
      ) : (
        children
      )}

      {/* 하단 다음 단계 큰 버튼 */}
      {selected && step.next && (
        <div className="mt-8 flex justify-end">
          <Link
            href={step.next}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
          >
            다음 단계로 진행
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
