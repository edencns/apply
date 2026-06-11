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
import { ChevronLeft, ChevronRight, BookOpen, ChevronDown, ChevronUp, Target, ArrowRightCircle, AlertCircle, Clock } from "lucide-react";

export interface WorkflowStep {
  step: number;
  key: string;
  title: string;
  description: string;
  fileHint?: string;         // "이 단계에 필요한 파일"
  href: string;
  prev?: string;             // 이전 단계 href
  next?: string;             // 다음 단계 href
  /** 신입 가이드: 이 단계의 목적 (한 문장) */
  purpose?: string;
  /** 신입 가이드: 받는 입력 (어떤 데이터·파일이 들어오나) */
  inputs?: string[];
  /** 신입 가이드: 산출 결과 (이 단계가 끝나면 무엇이 결정되나) */
  outputs?: string[];
  /** 신입 가이드: 자주 막히는 지점·해결 힌트 */
  commonIssues?: { issue: string; solution: string }[];
  /** 신입 가이드: 단계 마감 시점 (상대 시점) */
  deadline?: string;
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: 1,
    key: "registration",
    title: "당첨자 등록",
    description: "전산추첨결과·당첨자현황 PDF·예비입주자 명단 등 당첨자 원본 파일을 올려 고객으로 등록합니다.",
    fileHint: "전산추첨결과.xlsx, 당첨자현황.pdf, 인포용 명단 등",
    href: "/workflow/registration",
    purpose: "이번 공고의 당첨자(본·예비)를 시스템에 등록해 이후 모든 검증의 기준 명단을 만든다.",
    inputs: [
      "청약홈에서 받은 「전산추첨결과」 엑셀",
      "「당첨자현황」 PDF (인포뱅크·SH 발송분)",
      "추가 당첨자(미달·승계자)는 직접 행 추가",
    ],
    outputs: [
      "고객 명단(본·예비) — 동·호·성명·주민번호 앞자리",
      "각 고객별 supply_type(공급유형) 자동 분류",
      "이름·동호 매칭 키 — 이후 단계의 파일 매칭 근거",
    ],
    commonIssues: [
      {
        issue: "엑셀 컬럼명이 표준과 달라 자동 인식 실패",
        solution: "「수동 매핑」 모달에서 컬럼을 직접 지정. 한 번 매핑하면 동일 양식 재사용.",
      },
      {
        issue: "동·호 정보가 비어 있어 5단계에서 매칭 안 됨",
        solution: "고객 행에서 직접 입력하거나, 5단계 배치 업로드 시 파일명에서 자동 보강됨.",
      },
    ],
    deadline: "당첨자 발표 직후 D+1~3일 내 완료 권장.",
  },
  {
    step: 2,
    key: "household",
    title: "세대·가족관계",
    description: "당첨자 본인과 세대원 전원의 주민번호·가족관계를 확보합니다. 다음 단계(주택소유 조회) 입력 리스트가 됩니다.",
    fileHint: "당첨자세대원내역.xlsx",
    href: "/workflow/household",
    purpose: "주택소유 조회·소득 산정에 필요한 「세대원 전원 명단」을 확보한다.",
    inputs: [
      "「당첨자세대원내역」 엑셀 (당첨자별 세대원 행 묶음)",
      "고객별 가족관계 수동 입력(필요 시)",
    ],
    outputs: [
      "세대원 행 묶음 — 주민번호 앞7자리·가족관계·세대분리 여부",
      "3단계 「주택소유 조회」에 보낼 명단",
      "가점 「부양가족수」 기초 데이터",
    ],
    commonIssues: [
      {
        issue: "배우자 분리세대 — 등본에 없지만 합산 대상",
        solution: "배우자 행을 직접 추가하고 「분리세대」 체크. 주택수·소득 합산 시 자동 포함.",
      },
      {
        issue: "주민번호 앞7자리 누락",
        solution: "엑셀 마스킹 정책으로 인한 결손. 고객 상세에서 직접 입력 가능.",
      },
    ],
    deadline: "1단계 완료 후 D+1~2일 내.",
  },
  {
    step: 3,
    key: "property",
    title: "주택소유 조회",
    description: "세대 전원의 주택 보유 여부를 판정합니다. 공급유형·공고 원문 기준에 따라 무주택/1주택 허용 여부가 달라집니다.",
    fileHint: "주택소유정보전산검색결과.xlsx",
    href: "/workflow/property",
    purpose: "세대 전원의 주택 수를 산정해 「무주택 자격」 충족 여부를 판정한다.",
    inputs: [
      "국토부 「주택소유정보 전산검색결과」 엑셀",
      "(필요 시) 등기부등본·매매계약서 스캔본",
    ],
    outputs: [
      "세대별 주택 수 — 소형·저가/상속/일시적 2주택/단독·다가구 후보를 공고 기준으로 검증",
      "무주택기간 계산 — 입주자모집공고일 기준, 만 30세 vs 혼인일 중 빠른 시점 기준",
      "무주택 가점(최대 32점) 산출",
    ],
    commonIssues: [
      {
        issue: "동일 주소가 「전용면적 부분」+「일반」으로 중복 등기",
        solution: "주소 정규화로 동일 매물 후보를 묶되, 등기부·건축물대장 기준으로 최종 확인.",
      },
      {
        issue: "다가구주택 — 호별로 여러 등기 나옴",
        solution: "같은 지번·같은 건축물로 확인되는 행만 1주택으로 합산. 다른 지번/건물은 별도 주택으로 유지.",
      },
      {
        issue: "매수+매도가 같은 날 발생 (단순 명의이전)",
        solution: "동일자 매수·매도는 자동 netting 되어 주택 수에 반영 안 됨.",
      },
    ],
    deadline: "2단계 완료 직후 (자동조회 대기시간 포함 D+3~5일).",
  },
  {
    step: 4,
    key: "savings",
    title: "청약통장 검증",
    description: "청약통장 가입기간과 순위확인 통보 결과를 검증합니다. 공고 최소 가입기간을 자동 대조합니다.",
    fileHint: "입주자저축순위확인 통보 PDF",
    href: "/workflow/savings",
    purpose: "청약통장 1순위 자격(가입기간·납입회차·예치금)을 확정한다.",
    inputs: [
      "은행 또는 국토부 발급 「입주자저축 순위확인 통보」 PDF",
      "예치금 영수증·통장 사본(필요 시)",
    ],
    outputs: [
      "1순위 자격 충족 여부",
      "가점 「청약통장 가입기간」(최대 17점) 산출",
      "예치금 부족 시 신청 면적 변경 안내",
    ],
    commonIssues: [
      {
        issue: "가입기간은 24개월인데 미납 회차가 있어 1순위 미달",
        solution: "납입 회차와 가입기간은 별개. 미납 개월 수 체크 — 회차도 24회 이상 필수.",
      },
      {
        issue: "전용면적 변경되어 예치금 재계산 필요",
        solution: "변경 후 면적 기준으로 검증. 예: 85㎡→102㎡ 변경 시 600만원 이상 필요.",
      },
    ],
    deadline: "3단계와 병행 가능. D+5일 내 완료.",
  },
  {
    step: 5,
    key: "documents",
    title: "서류검토·최종판정",
    description: "공급유형별 필수 서류 체크리스트 + 1~4단계 종합으로 최종 적합·부적합 판정을 내립니다. 부적합일 경우 같은 주택형의 예비에서 승계 가능합니다.",
    href: "/workflow/documents",
    purpose: "1~4단계 결과 + 서류 스캔본을 종합해 「적합/부적합」 최종 판정을 내린다.",
    inputs: [
      "「동-호수 이름.pdf」 형식의 서류 묶음 PDF (배치 업로드)",
      "공통 서류 9종 + 공급유형별 추가 서류",
      "1~4단계의 자동 판정 결과",
    ],
    outputs: [
      "적합/부적합/검수보류 판정 + 사유 기록",
      "부적합 시 → 같은 주택형 예비자 승계 후보 자동 추출",
      "최종 계약 진행 명단",
    ],
    commonIssues: [
      {
        issue: "파일명이 「동-호 이름」 형식이 아니어서 매칭 실패",
        solution: "「수동 매칭으로 보내기」 버튼으로 모든 등록자 후보에서 직접 선택.",
      },
      {
        issue: "동명이인 — 이름만 같고 동·호 다름",
        solution: "후보 2개 이상 시 보류 큐로 이동, 사용자가 직접 정확한 당첨자 선택.",
      },
      {
        issue: "출입국증명원 90일/183일 룰 헷갈림",
        solution: "각 서류 카드의 「📖 검토 가이드」 펼쳐서 법령·예외 확인.",
      },
    ],
    deadline: "계약 시작 전까지. 보통 발표 후 D+10~14일.",
  },
  {
    step: 6,
    key: "transfers",
    title: "명의변경 관리",
    description: "계약 체결 이후 분양권을 상속·증여·이혼·전매 등으로 다른 명의자에게 넘긴 세대의 서류 스캔본을 업로드하면 AI가 신·구 명의자와 사유를 자동 추출합니다. 배치 처리.",
    fileHint: "명의변경 서류 스캔본 PDF (파일명 예: 101-101)",
    href: "/workflow/transfers",
    purpose: "계약 후 발생한 분양권 명의변경(상속·증여·이혼·전매)을 처리·기록한다.",
    inputs: [
      "명의변경 서류 묶음 PDF (10~20페이지) — 신청서·인감·등본·증명서 등",
      "Gemini AI가 PDF에서 신·구 명의자·사유 자동 추출",
    ],
    outputs: [
      "당첨자별 명의변경 이력(사유·일자·새 명의자)",
      "기존 당첨자 정보를 「승계」 처리 — 계약·입주는 새 명의자가 승계",
    ],
    commonIssues: [
      {
        issue: "Gemini API 월 한도 초과 (429 오류)",
        solution: "명확한 안내 배너 표시됨. ai.studio/spend 에서 한도 늘리거나 다음 달 재처리.",
      },
      {
        issue: "여러 상속인 공동명의",
        solution: "AI 「notes」 필드에 표시됨. 담당자가 추가 검토 후 분할귀속 입력.",
      },
    ],
    deadline: "계약 체결 후 명의변경 신청 시 즉시. (소급 등록 가능)",
  },
  {
    step: 7,
    key: "contracts",
    title: "최종 계약자",
    description: "계약자명단(분양금 포함) 엑셀을 업로드해 계약일·분양금·새 계약자 정보를 기록합니다. 청약 명단에 없던 사람은 「선착순(잔여세대)」로 자동 등록됩니다.",
    fileHint: "계약자명단(분양금 포함).xlsx",
    href: "/workflow/contracts",
    purpose: "최종 계약 정보(계약일·분양금·계약자 주소) 기록 + 미분양 잔여세대 선착순 계약자 등록.",
    inputs: [
      "「계약자명단(분양금 포함)」 엑셀 (계약일·고객명·분양금 등)",
    ],
    outputs: [
      "당첨자별 계약 정보(계약일·분양금·새 주소·연락처)",
      "청약 명단 외 신규 계약자는 「선착순」 공급유형으로 자동 등록",
    ],
    commonIssues: [
      {
        issue: "동·호 매칭 안 됨",
        solution: "동·호 그대로 신규 「선착순」 계약자로 등록하거나, 수동 매칭 가능.",
      },
      {
        issue: "선착순 계약자가 「생애최초」 등 잘못된 유형으로 표시",
        solution: "공급유형을 「선착순」으로 명시 변경 시 자동 자격 검증 룰 미적용.",
      },
    ],
    deadline: "계약 종료 후 — 최종 단계.",
  },
];

// 단계 간 prev/next 자동 세팅
WORKFLOW_STEPS.forEach((s, i) => {
  s.prev = i > 0 ? WORKFLOW_STEPS[i - 1].href : undefined;
  s.next = i < WORKFLOW_STEPS.length - 1 ? WORKFLOW_STEPS[i + 1].href : undefined;
});

/**
 * 신입 가이드 카드 — 단계 페이지 상단에 「목적·입력·산출·마감·자주 막히는 지점」을 정리.
 * 첫 출근자도 이 단계가 무엇을 하는 단계인지 한 화면에 파악 가능.
 *
 * localStorage에 사용자가 접은 상태를 기억해, 익숙해지면 자동으로 접힌 상태로 시작.
 * 각 단계마다 별도로 기억(stage_guide_open_{key}).
 */
function StageGuide({ step }: { step: WorkflowStep }) {
  const storageKey = `stage_guide_open_${step.key}`;
  const [open, setOpen] = useState<boolean>(true);

  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      // 첫 방문 시 자동 펼침. 사용자가 접은 적 있으면 그 상태 유지.
      if (v === "false") setOpen(false);
    } catch {}
  }, [storageKey]);

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      try { localStorage.setItem(storageKey, String(next)); } catch {}
      return next;
    });
  };

  return (
    <div className="mb-3 rounded-lg border border-accent-line bg-accent-soft">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-surface2 transition-colors rounded-lg"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-accent" />
          <span className="text-[12px] font-semibold text-ink">
            📘 이 단계가 처음이세요? — 목적·할 일·자주 막히는 지점
          </span>
        </div>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-accent" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-accent" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-0 text-[11.5px] text-ink-2 space-y-2.5">
          {step.purpose && (
            <div className="flex items-start gap-1.5">
              <Target className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-ink">목적 ─ </span>
                {step.purpose}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {step.inputs && step.inputs.length > 0 && (
              <div className="rounded border border-accent-line bg-surface p-2">
                <div className="text-[10px] font-semibold text-accent uppercase tracking-wide mb-1 flex items-center gap-1">
                  <ArrowRightCircle className="w-3 h-3" />
                  받는 입력
                </div>
                <ul className="list-disc list-outside ml-3.5 space-y-0.5 leading-snug">
                  {step.inputs.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}

            {step.outputs && step.outputs.length > 0 && (
              <div className="rounded border border-emerald-100 bg-surface p-2">
                <div className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wide mb-1 flex items-center gap-1">
                  <ArrowRightCircle className="w-3 h-3" />
                  산출 결과
                </div>
                <ul className="list-disc list-outside ml-3.5 space-y-0.5 leading-snug">
                  {step.outputs.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>

          {step.commonIssues && step.commonIssues.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50/70 p-2">
              <div className="text-[10px] font-semibold text-amber-900 uppercase tracking-wide mb-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                자주 막히는 지점 (그리고 해결법)
              </div>
              <ul className="space-y-1 leading-snug">
                {step.commonIssues.map((it, i) => (
                  <li key={i} className="pl-3 border-l-2 border-amber-300">
                    <div className="font-medium text-amber-900">⚠ {it.issue}</div>
                    <div className="text-amber-800 text-[11px]">↳ {it.solution}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap text-[10.5px] text-ink-3 pt-1 border-t border-accent-line">
            {step.deadline && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" /> 권장 마감: <strong className="text-ink-2">{step.deadline}</strong>
              </span>
            )}
            <Link href="/glossary" className="text-accent hover:underline">📖 용어사전</Link>
            <Link href="/verification-criteria" className="text-accent hover:underline">⚖ 서류 검증 기준</Link>
            <span className="text-ink-4">막히면 청약홈 1644-7445</span>
          </div>
        </div>
      )}
    </div>
  );
}

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
            <span className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full bg-accent text-[#0a0a0a] text-xs font-bold tnum">
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

      {/* 신입 가이드 — 이 단계의 목적·입력·산출·마감·자주 막히는 지점 */}
      <StageGuide step={step} />

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
