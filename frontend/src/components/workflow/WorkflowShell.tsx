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
import { ChevronLeft, ChevronRight } from "lucide-react";

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
    title: "세대·가족관계",
    description: "당첨자 본인과 세대원 전원의 주민번호·가족관계를 확보합니다. 다음 단계(주택소유 조회) 입력 리스트가 됩니다.",
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
    title: "청약통장 검증",
    description: "청약통장 가입기간과 순위확인 통보 결과를 검증합니다. 공고 최소 가입기간을 자동 대조합니다.",
    fileHint: "입주자저축순위확인 통보 PDF",
    href: "/workflow/savings",
  },
  {
    step: 5,
    key: "documents",
    title: "서류검토·최종판정",
    description: "공급유형별 필수 서류 체크리스트 + 1~4단계 종합으로 최종 적합·부적합 판정을 내립니다. 부적합일 경우 같은 주택형의 예비에서 승계 가능합니다.",
    href: "/workflow/documents",
  },
  {
    step: 6,
    key: "transfers",
    title: "명의변경 관리",
    description: "계약 체결 이후 분양권을 상속·증여·이혼·전매 등으로 다른 명의자에게 넘긴 세대의 서류 스캔본을 업로드하면 AI가 신·구 명의자와 사유를 자동 추출합니다. 배치 처리.",
    fileHint: "명의변경 서류 스캔본 PDF (파일명 예: 101-101)",
    href: "/workflow/transfers",
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
    <div className="px-7 py-6 max-w-6xl mx-auto">
      {/* 단계 헤더 */}
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3 mb-1">
            <span>서류 검수 단계</span>
            <ChevronRight className="w-3 h-3 text-ink-4" />
            <span className="text-ink-2 font-medium tnum">{step.step} / {totalSteps}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full bg-accent text-white text-xs font-bold tnum">
              {step.step}
            </span>
            <h1 className="text-xl font-bold text-ink tracking-[-0.3px]">
              {step.title}
            </h1>
          </div>
          <p className="text-xs text-ink-3 mt-1 max-w-xl">{step.description}</p>
        </div>

        {/* 이전/다음 단계 */}
        <div className="flex items-center gap-1.5">
          {step.prev && (
            <Link
              href={step.prev}
              className="btn-secondary inline-flex items-center gap-1"
            >
              <ChevronLeft className="w-3 h-3" />
              이전
            </Link>
          )}
          {step.next && (
            <Link
              href={step.next}
              className="btn-accent inline-flex items-center gap-1"
            >
              다음 단계
              <ChevronRight className="w-3 h-3" />
            </Link>
          )}
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
        <div className="card text-center py-16 text-ink-4">
          <p className="text-xs">공고를 먼저 선택해 주세요</p>
        </div>
      ) : (
        children
      )}

      {/* 하단 다음 단계 큰 버튼 */}
      {selected && step.next && (
        <div className="mt-8 flex justify-end">
          <Link
            href={step.next}
            className="btn-accent inline-flex items-center gap-1.5 !px-4 !py-2 !text-[13px]"
          >
            다음 단계로 진행
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
