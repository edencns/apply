"use client";

/**
 * 서류 검증 기준 — 청약 신청 유형별 자격·서류·검증 포인트 정리.
 *
 * 구조:
 *   ① 공고 선택 → ② 공통 룰 (무주택·청약통장·거주·부적격)
 *   ③ 신청 유형 탭 (일반공급 + 특별공급 7유형)
 *   ④ 선택 유형의 자격·선정·소득자산·필요서류·검증포인트·자동검증 표시
 *
 * 시스템이 자동 검증하는 항목은 ✓ 자동검증 배지로 구분.
 */

import { useEffect, useState } from "react";
import {
  localAnnouncements, isAnnouncementDone,
  LocalAnnouncement, onLocalStoreChange,
} from "@/lib/local-store";
import AnnouncementPicker from "@/components/AnnouncementPicker";
import {
  Scale, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
  FileText, Users, Heart, Baby, UserCheck, Home, Award, Sparkles,
} from "lucide-react";

/* ─── UI 헬퍼 ────────────────────────────────────── */

function Section({ title, children, defaultOpen = false }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // overflow-hidden 제거 — InfoPopover가 섹션 경계 밖으로 나가도 잘리지 않게 함.
  // 대신 button과 내부 div에 적절한 rounded를 직접 적용.
  return (
    <div className="border border-border rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-2.5 bg-surface2 hover:bg-surface2 transition-colors ${
          open ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="font-semibold text-ink text-[13px]">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-ink-4" /> : <ChevronDown className="w-4 h-4 text-ink-4" />}
      </button>
      {open && <div className="p-4 rounded-b-lg">{children}</div>}
    </div>
  );
}

/**
 * 마우스오버하면 자세한 표·금액 등을 보여주는 ⓘ 아이콘.
 * 모바일은 클릭으로도 동작 (focus 토글).
 */
function InfoPopover({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <span className="relative inline-block group align-middle">
      <button
        type="button"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold ml-1 hover:bg-blue-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
        aria-label={label || "자세히 보기"}
        title={label || ""}
      >
        i
      </button>
      {/* 우측이 잘리지 않도록 right-0 으로 우측 정렬. z-50 으로 다른 모든 컨텐츠 위에 노출 */}
      <div
        className="invisible group-hover:visible group-focus-within:visible opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity absolute z-50 right-0 top-6 w-[360px] max-w-[90vw] p-3 bg-white border border-border rounded-md shadow-xl text-[11px] text-ink-2 leading-relaxed pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto"
        role="tooltip"
      >
        {label && <div className="font-semibold text-ink mb-1.5 text-[11.5px]">{label}</div>}
        {children}
      </div>
    </span>
  );
}

interface RuleRowProps {
  label: string;
  value: React.ReactNode;
  autoVerified?: boolean;
  hint?: string;
  details?: { label?: string; content: React.ReactNode };
}
function RuleRow({ label, value, autoVerified, hint, details }: RuleRowProps) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-border-soft last:border-0">
      <div className="flex-shrink-0 w-1/3 text-[11.5px] font-semibold text-ink-2">{label}</div>
      <div className="flex-1 text-[11.5px] text-ink-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span>{value}</span>
          {details && <InfoPopover label={details.label}>{details.content}</InfoPopover>}
          {autoVerified && (
            <span
              className="text-[9.5px] bg-emerald-100 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-medium"
              title="시스템이 자동 검증"
            >
              ✓ 자동검증
            </span>
          )}
        </div>
        {hint && <div className="text-[10.5px] text-ink-4 mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

function SubBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="text-[12.5px] font-bold text-ink mb-1.5 pb-1 border-b-2 border-ink-3">
        {title}
      </div>
      <div className="space-y-0">{children}</div>
    </div>
  );
}

/** 서류 카드 목록 — 필수/추가 색 구분 + 자동검증 배지. */
function DocList({ docs }: { docs: { name: string; required: boolean; purpose: string; auto?: boolean }[] }) {
  return (
    <div className="space-y-1.5">
      {docs.map((d, i) => (
        <div
          key={i}
          className={`p-2 rounded border ${
            d.required ? "border-blue-200 bg-blue-50/40" : "border-amber-200 bg-amber-50/40"
          }`}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <FileText className="w-3 h-3 text-ink-4 flex-shrink-0" />
            <span className="text-[11.5px] font-semibold text-ink">{d.name}</span>
            {d.required ? (
              <span className="text-[9.5px] bg-blue-100 text-blue-800 px-1 py-0.5 rounded font-semibold">필수</span>
            ) : (
              <span className="text-[9.5px] bg-amber-200 text-amber-800 px-1 py-0.5 rounded font-semibold">추가(해당자)</span>
            )}
            {d.auto && (
              <span className="text-[9.5px] bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 rounded font-medium">
                ✓ 자동검증
              </span>
            )}
          </div>
          <div className="text-[10.5px] text-ink-4 mt-0.5 ml-4">↳ {d.purpose}</div>
        </div>
      ))}
    </div>
  );
}

/* ─── 재사용 상세 컨텐츠 (popover에 들어가는 표·금액) ─── */

/** 청약예금 예치금 표 — 지역·면적별 */
const DEPOSIT_DETAIL = (
  <div>
    <table className="w-full text-[10px] border border-border rounded">
      <thead className="bg-surface2">
        <tr>
          <th className="text-left px-1.5 py-1 font-medium border-b border-border">전용면적</th>
          <th className="text-right px-1.5 py-1 font-medium border-b border-border">강원도</th>
          <th className="text-right px-1.5 py-1 font-medium border-b border-border">서울·부산</th>
          <th className="text-right px-1.5 py-1 font-medium border-b border-border">기타 광역시</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">85㎡ 이하</td><td className="px-1.5 py-1 text-right font-mono">200만원</td><td className="px-1.5 py-1 text-right font-mono">300만원</td><td className="px-1.5 py-1 text-right font-mono">250만원</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">102㎡ 이하</td><td className="px-1.5 py-1 text-right font-mono">300만원</td><td className="px-1.5 py-1 text-right font-mono">600만원</td><td className="px-1.5 py-1 text-right font-mono">400만원</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">135㎡ 이하</td><td className="px-1.5 py-1 text-right font-mono">400만원</td><td className="px-1.5 py-1 text-right font-mono">1,000만원</td><td className="px-1.5 py-1 text-right font-mono">700만원</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">모든 면적</td><td className="px-1.5 py-1 text-right font-mono">500만원</td><td className="px-1.5 py-1 text-right font-mono">1,500만원</td><td className="px-1.5 py-1 text-right font-mono">1,000만원</td></tr>
      </tbody>
    </table>
    <div className="mt-1.5 text-[9.5px] text-ink-4">청약통장 가입 + 위 금액 이상 납입 시 1순위 자격 (지역·면적 기준은 청약 신청 주택 기준)</div>
  </div>
);

/** 도시근로자 월평균소득 — 가구원수·비율별 (2024 기준) */
const INCOME_DETAIL_2024 = (
  <div>
    <table className="w-full text-[10px] border border-border rounded">
      <thead className="bg-surface2">
        <tr>
          <th className="text-left px-1.5 py-1 font-medium border-b border-border">가구원수</th>
          <th className="text-right px-1.5 py-1 font-medium border-b border-border">100%</th>
          <th className="text-right px-1.5 py-1 font-medium border-b border-border">120%</th>
          <th className="text-right px-1.5 py-1 font-medium border-b border-border">140%</th>
          <th className="text-right px-1.5 py-1 font-medium border-b border-border">160%</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">3인 이하</td><td className="px-1.5 py-1 text-right">7,198,000</td><td className="px-1.5 py-1 text-right">8,638,000</td><td className="px-1.5 py-1 text-right">10,077,000</td><td className="px-1.5 py-1 text-right">11,517,000</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">4인</td><td className="px-1.5 py-1 text-right">8,248,000</td><td className="px-1.5 py-1 text-right">9,898,000</td><td className="px-1.5 py-1 text-right">11,547,000</td><td className="px-1.5 py-1 text-right">13,197,000</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">5인</td><td className="px-1.5 py-1 text-right">8,775,000</td><td className="px-1.5 py-1 text-right">10,530,000</td><td className="px-1.5 py-1 text-right">12,285,000</td><td className="px-1.5 py-1 text-right">14,040,000</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">6인</td><td className="px-1.5 py-1 text-right">9,563,000</td><td className="px-1.5 py-1 text-right">11,476,000</td><td className="px-1.5 py-1 text-right">13,388,000</td><td className="px-1.5 py-1 text-right">15,301,000</td></tr>
      </tbody>
    </table>
    <div className="mt-1.5 text-[9.5px] text-ink-4">2024년 기준 (단위: 원). 매년 1월 갱신 — 청약홈에서 최신값 확인 필수.</div>
  </div>
);

/** 일반공급 가점제 84점 만점 표 */
const GAJEOM_DETAIL = (
  <div className="space-y-2">
    <div>
      <div className="font-semibold text-ink mb-0.5">무주택기간 (32점)</div>
      <div className="text-[10px]">1년 미만 2점 → 1년당 +2점 → <strong>15년 이상 32점</strong></div>
    </div>
    <div>
      <div className="font-semibold text-ink mb-0.5">부양가족수 (35점)</div>
      <div className="text-[10px]">0명(본인) 5점 / 1명 10점 / 2명 15 / 3명 20 / 4명 25 / 5명 30 / <strong>6명 이상 35점</strong></div>
    </div>
    <div>
      <div className="font-semibold text-ink mb-0.5">청약통장 가입기간 (17점)</div>
      <div className="text-[10px]">6개월 미만 1점 → 6개월~1년 2점 → 2년당 +1점 → <strong>15년 이상 17점</strong></div>
    </div>
    <div className="text-[9.5px] text-ink-4 pt-1 border-t border-border-soft">
      총점 = 32 + 35 + 17 = <strong>최대 84점</strong>
    </div>
  </div>
);

/** 다자녀 가점표 (100점 만점) */
const MULTI_CHILD_GAJEOM_DETAIL = (
  <div className="space-y-1.5">
    <table className="w-full text-[10px] border border-border rounded">
      <thead className="bg-surface2">
        <tr>
          <th className="text-left px-1.5 py-1 font-medium border-b border-border">평점요소</th>
          <th className="text-left px-1.5 py-1 font-medium border-b border-border">기준</th>
          <th className="text-right px-1.5 py-1 font-medium border-b border-border">점수</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">미성년 자녀수</td><td className="px-1.5 py-1">5명+ / 4명 / 3명</td><td className="px-1.5 py-1 text-right font-mono">40 / 35 / 30</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">영유아 자녀수</td><td className="px-1.5 py-1">3명+ / 2명 / 1명</td><td className="px-1.5 py-1 text-right font-mono">15 / 10 / 5</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">세대구성</td><td className="px-1.5 py-1">3세대 이상 / 한부모</td><td className="px-1.5 py-1 text-right font-mono">5 / 5</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">무주택기간</td><td className="px-1.5 py-1">10년+ / 5~10년 / 1~5년</td><td className="px-1.5 py-1 text-right font-mono">20 / 15 / 10</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">시·도 거주</td><td className="px-1.5 py-1">10년+ / 5~10년 / 1~5년</td><td className="px-1.5 py-1 text-right font-mono">15 / 10 / 5</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1">통장 가입기간</td><td className="px-1.5 py-1">10년 이상</td><td className="px-1.5 py-1 text-right font-mono">5</td></tr>
      </tbody>
    </table>
    <div className="text-[9.5px] text-ink-4">총 100점. 동점자: ① 미성년 자녀수 → ② 신청자 연령</div>
  </div>
);

/** 가점·추첨 비율 표 */
const GAJEOM_RATIO_DETAIL = (
  <div>
    <table className="w-full text-[10px] border border-border rounded">
      <thead className="bg-surface2">
        <tr>
          <th className="text-left px-1.5 py-1 font-medium border-b border-border">규제</th>
          <th className="text-left px-1.5 py-1 font-medium border-b border-border">85㎡ 이하</th>
          <th className="text-left px-1.5 py-1 font-medium border-b border-border">85㎡ 초과</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1 font-semibold">투기과열</td><td className="px-1.5 py-1">가점 40% + 추첨 60%</td><td className="px-1.5 py-1">가점 70% + 추첨 30%</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1 font-semibold">청약과열</td><td className="px-1.5 py-1">가점 40% + 추첨 60%</td><td className="px-1.5 py-1">가점 30% + 추첨 70%</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1 font-semibold">수도권 비규제</td><td className="px-1.5 py-1">가점 40% + 추첨 60%</td><td className="px-1.5 py-1">추첨 100%</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1 font-semibold">지방 광역시</td><td className="px-1.5 py-1">가점 40% + 추첨 60%</td><td className="px-1.5 py-1">추첨 100%</td></tr>
        <tr className="border-t border-border-soft"><td className="px-1.5 py-1 font-semibold">지방 그 외 (강원)</td><td className="px-1.5 py-1">추첨 100% (사업주체 선택)</td><td className="px-1.5 py-1">추첨 100%</td></tr>
      </tbody>
    </table>
  </div>
);

/* ─── 공통 서류 (모든 청약 신청자 공통) ───────────────── */

const COMMON_DOCS: DocSpec[] = [
  // 필수 9종
  { name: "특별공급신청서·무주택 서약서", required: true, purpose: "신청 의사 + 무주택 본인 확인", auto: true },
  { name: "인감증명서 또는 본인서명사실확인서", required: true, purpose: "본인 인증" },
  { name: "신분증 (주민등록증·운전면허증·여권)", required: true, purpose: "본인 확인" },
  { name: "청약통장 순위(가입)확인서", required: true, purpose: "1·2순위 자격 + 가입기간·예치금 확인", auto: true },
  { name: "개인정보 수집·이용 동의서", required: true, purpose: "심사·검증 동의" },
  { name: "주민등록표등본 (상세, 본인)", required: true, purpose: "세대 구성·주소·동일등재 확인", auto: true },
  { name: "주민등록표초본 (상세, 본인)", required: true, purpose: "주소 변동 이력·거주기간 확인" },
  { name: "가족관계증명서 (상세, 본인)", required: true, purpose: "직계존속·직계비속·배우자 관계 확인" },
  { name: "출입국사실증명원 (본인)", required: true, purpose: "해외 90일 초과 체류 검증", auto: true },
  // 추가(해당자) 3종
  { name: "혼인관계증명서", required: false, purpose: "단독세대 또는 만30세 이전 혼인 인정 시" },
  { name: "배우자 주민등록표등본", required: false, purpose: "배우자 분리세대인 경우" },
  { name: "배우자·직계존비속 출입국사실증명원", required: false, purpose: "해외체류로 부양가족 인정 시" },
];

/* ─── 데이터 — 신청 유형별 자격·서류·검증 ────────────────── */

type SupplyType =
  | "general" | "institution" | "multiChild" | "newlywed"
  | "seniorParent" | "firstLife" | "newborn" | "youth";

interface DocSpec {
  name: string;
  required: boolean;
  purpose: string;
  auto?: boolean;
}

type RowSpec = {
  label: string;
  value: React.ReactNode;
  auto?: boolean;
  hint?: string;
  details?: { label?: string; content: React.ReactNode };
};

interface SupplyTypeConfig {
  label: string;
  icon: any;
  color: string;
  intro: string;
  eligibility: RowSpec[];
  selection: RowSpec[];
  incomeAsset: RowSpec[];
  documents: DocSpec[];
  checkpoints: string[];
}

const TYPES: Record<SupplyType, SupplyTypeConfig> = {
  general: {
    label: "일반공급",
    icon: Home,
    color: "indigo",
    intro: "청약통장 1순위 자격을 충족한 일반 신청자. 가점제와 추첨제 비율이 전용면적·규제지역에 따라 달라짐.",
    eligibility: [
      {
        label: "청약통장",
        value: "1순위 — 가입 6개월(비규제)/24개월(규제) 이상 + 지역·면적별 예치금 (200만~1,500만원)",
        auto: true,
        details: { label: "지역·면적별 예치금", content: DEPOSIT_DETAIL },
      },
      {
        label: "주택소유",
        value: "규제지역(투기과열·청약과열): 무주택세대구성원 / 비규제: 무주택 또는 1주택자",
        auto: true,
      },
      {
        label: "거주 요건",
        value: "해당지역 1년 이상 계속 거주 — 입주자모집공고일 기준",
        auto: true,
        hint: "해외 90일 초과 체류 시 거주기간 인정 안 됨",
      },
      {
        label: "재당첨 제한",
        value: "투기과열 당첨자 10년(85㎡↓) / 7년(85㎡↑), 일반 5년 — 위반 시 부적격",
      },
    ],
    selection: [
      {
        label: "가점제 vs 추첨제",
        value: "면적·규제지역별 차등 (40~100% 추첨)",
        details: { label: "비율 매트릭스 (전용면적 × 규제)", content: GAJEOM_RATIO_DETAIL },
      },
      {
        label: "가점제 항목",
        value: "무주택기간 32 + 부양가족 35 + 통장 17 = 84점 만점",
        auto: true,
        details: { label: "84점 만점 상세", content: GAJEOM_DETAIL },
      },
      {
        label: "추첨제 우선",
        value: "추첨제 75% → 무주택 세대주 우선 / 25% → 1주택자(처분 약정자) + 미당첨 무주택자",
      },
    ],
    incomeAsset: [
      {
        label: "소득 기준",
        value: "민영주택 일반공급은 없음",
        hint: "공공주택은 도시근로자 월평균소득 100~140% 등 별도 적용",
        details: { label: "도시근로자 월평균소득 (2024)", content: INCOME_DETAIL_2024 },
      },
      {
        label: "자산 기준",
        value: "비규제: 없음 / 투기과열·청약과열 추첨제 25%(1주택자)만 — 가구 자산 약 3.31억 이하",
      },
    ],
    documents: [
      // 일반공급은 공통 서류 외 추가 자료가 거의 없음. 가점제 신청자만 일부 추가.
      { name: "무주택기간 확인 보조 자료", required: false, purpose: "가점제 무주택기간 산정 시 — 등본·초본·과거 등기 등으로 자동 계산되지만 다툼 시 입증 자료" },
      { name: "분양권 보유 미신고 확인", required: false, purpose: "2018.12.11 이후 분양권 매수·신규 계약자 — 주택 보유로 간주" },
      { name: "1주택자 처분 약정서", required: false, purpose: "추첨제 25%(1주택자) 신청 시 — 입주자모집공고일까지 처분 약속" },
    ],
    checkpoints: [
      "청약통장 가입기간 + 예치금 충족 (지역·면적별)",
      "무주택세대구성원 또는 1주택자 (규제지역별 기준)",
      "해당지역 거주 1년 이상 (해외 90일 초과 체류 없을 것)",
      "무주택 기간 자동계산 vs 신고값 검증",
      "부양가족수 — 직계존속 3년 이상 등본 동일등재 + 무주택",
      "가점제 신청자: 무주택기간·부양가족·통장가입기간 일치",
      "추첨제 1주택자: 처분 약정서 제출 + 자산 기준 충족",
    ],
  },

  institution: {
    label: "기관추천",
    icon: Award,
    color: "purple",
    intro: "국가유공자·장애인·중소기업 근로자·철거민 등 정부·지자체 기관이 추천한 자. 별도 우선순위 적용.",
    eligibility: [
      {
        label: "추천 기관",
        value: "국군복지단, 시·도 경로장애인과, 보훈지청, 중소기업 지방청, 도시재생 부지제공 등",
        details: {
          label: "추천 기관 + 자격 (예시)",
          content: (
            <ul className="space-y-1 list-disc list-inside text-[10px]">
              <li>10년 이상 장기복무 군인 → 국군복지단 복지사업운용과</li>
              <li>장애인 → 강원도청 경로장애인과</li>
              <li>국가유공자·장기복무 제대군인·국가보훈대상자 → 강원동부보훈지청 복지팀</li>
              <li>중소기업 근로자 → 강원지방중소벤처기업부 강원영동사무소</li>
              <li>철거민·도시재생 부지제공자 → 해당 지자체 주택과</li>
            </ul>
          ),
        },
      },
      { label: "주택소유", value: "무주택세대구성원", auto: true },
      {
        label: "청약통장",
        value: "6개월 이상 + 지역·면적별 예치금 (200만~1,500만원)",
        hint: "철거민·도시재생 부지제공자·장애인·국가유공자는 통장 면제",
        details: { label: "지역·면적별 예치금", content: DEPOSIT_DETAIL },
      },
      {
        label: "1세대 1회 한정",
        value: "특별공급 평생 1세대 1회만 신청 가능",
        auto: true,
        hint: "과거 특별공급 당첨 이력자는 신청 불가 (예외: 미분양 등)",
      },
    ],
    selection: [
      { label: "공급 비율", value: "전용 85㎡ 이하 공급세대수의 10% 범위" },
      { label: "당첨자 결정", value: "기관 자체 우선순위로 추천 → 사업주체 통보 → 인터넷 청약 신청" },
      { label: "예비입주자", value: "예비대상자도 청약 신청 필수. 잔여 시 추첨으로 입주자/예비입주자 결정" },
    ],
    incomeAsset: [
      {
        label: "소득 기준",
        value: "기관별 상이 — 보훈·장애인 별도, 중소기업 근로자 100% 이하 등",
        details: { label: "도시근로자 월평균소득 (2024)", content: INCOME_DETAIL_2024 },
      },
      {
        label: "자산 기준",
        value: "공공주택만 — 부동산 2.15억 / 자동차 3,683만원 이하",
        hint: "부동산 = 토지·건물 공시지가 합산 (신청자·배우자·세대원 합산)",
      },
    ],
    documents: [
      // 필수
      { name: "기관추천서 (해당 기관 발급)", required: true, purpose: "기관 추천 자격 증명 — 핵심 서류" },
      { name: "자격확인서 (해당 기관)", required: true, purpose: "장애 등급·복무 기간 등 자격 상세" },
      // 추가(해당자)
      { name: "장애인 등록증·복지카드", required: false, purpose: "장애인 추천 시 — 장애 정도 확인" },
      { name: "국가유공자증·보훈대상자증", required: false, purpose: "보훈 추천 시" },
      { name: "재직증명서·근로계약서", required: false, purpose: "중소기업 근로자 추천 시" },
      { name: "철거확인서·도시재생사업 부지제공 증빙", required: false, purpose: "철거민·부지제공자 추천 시 (통장 면제)" },
    ],
    checkpoints: [
      "기관추천서 진위·발급일 (3개월 이내 발급 권장)",
      "추천 자격 일치 (예: 장애 등급, 군 복무 N년 이상, 보훈 대상자 코드)",
      "무주택세대구성원 (통장과 별개 자격)",
      "특별공급 1세대 1회 위반 여부 (시스템 자동 감지)",
      "통장 면제 대상자(철거민 등)는 통장 누락 OK",
    ],
  },

  multiChild: {
    label: "다자녀가구",
    icon: Users,
    color: "pink",
    intro: "만 19세 미만 자녀 3명 이상 보유. 100점 만점 가점표로 우선순위 결정.",
    eligibility: [
      {
        label: "자녀 수",
        value: "만 19세 미만 자녀 3명 이상 (태아·입양 포함)",
        auto: true,
        hint: "입주자모집공고일 현재 미성년자녀. 태아는 임신진단서, 입양자녀는 입양관계증명서로 입증",
      },
      { label: "주택소유", value: "무주택세대구성원 (3명 이상 미성년자녀 + 무주택)", auto: true },
      {
        label: "청약통장",
        value: "6개월 이상 + 지역·면적별 예치금 (200만~1,500만원)",
        details: { label: "지역·면적별 예치금", content: DEPOSIT_DETAIL },
      },
      {
        label: "거주 요건",
        value: "강원도 6개월 이상 거주 시 우선공급 — 경쟁 시 가점표로 우선",
      },
    ],
    selection: [
      { label: "공급 비율", value: "공급세대수의 10% 범위" },
      {
        label: "가점표",
        value: "100점 만점 — 미성년자녀(40) + 영유아(15) + 세대구성(5) + 무주택기간(20) + 거주기간(15) + 통장(5)",
        auto: true,
        details: { label: "다자녀가구 가점표 (100점)", content: MULTI_CHILD_GAJEOM_DETAIL },
      },
      { label: "동점자 처리", value: "① 미성년 자녀수 많은 자 → ② 신청자 연령(연월일) 많은 자" },
    ],
    incomeAsset: [
      {
        label: "소득 기준",
        value: "공공주택 — 도시근로자 월평균소득 120% 이하 / 민영주택 — 없음 (공고 확인)",
        details: { label: "도시근로자 월평균소득 (2024) — 가구원수별", content: INCOME_DETAIL_2024 },
      },
      {
        label: "자산 기준",
        value: "공공주택만 — 부동산 2.15억 / 자동차 3,683만원 이하",
      },
    ],
    documents: [
      // 필수
      { name: "다자녀 우선순위 배점 기준표", required: true, purpose: "가점 산정 자료 (기관 양식)" },
      { name: "가족관계증명서 (상세, 자녀 확인)", required: true, purpose: "자녀 관계·생년월일 확인" },
      // 추가(해당자)
      { name: "임신증명서류 (임신진단서·유산낙태진단서 등)", required: false, purpose: "태아 자녀 인정 시 — 입주자모집공고일 현재 의료기관·임신주차 확인 필수" },
      { name: "출산증명서", required: false, purpose: "최근 출생 자녀 — 자녀수 합산" },
      { name: "입양관계증명서", required: false, purpose: "입양 자녀 인정 시" },
      { name: "친양자 입양관계증명서", required: false, purpose: "친양자 입양 시" },
      { name: "임신증명·출산이행 확인각서", required: false, purpose: "임신 제증명서류와 함께 제출 — 허위·낙태 방지" },
      { name: "자녀 가족관계증명서 (재혼 자녀)", required: false, purpose: "재혼 배우자 자녀 인정 시" },
      { name: "자녀 주민등록표등본", required: false, purpose: "자녀 일부가 본인 등본에 미등재 시" },
      { name: "미성년자녀 혼인관계증명서", required: false, purpose: "만 18세 직계비속 미성년 인정 시" },
      { name: "한부모가족증명서", required: false, purpose: "한부모 5년 경과 가점 시" },
      { name: "피부양 직계존속 주민등록표초본", required: false, purpose: "3세대 이상 세대구성 가점 시 — 3년 이상 동일등재" },
    ],
    checkpoints: [
      "자녀수 (만 19세 미만 — 입주자모집공고일 현재 기준)",
      "영유아 자녀수 (만 6세 미만)",
      "자녀 등본 동일등재 — 3세 이상 자녀 일부가 다른 지역 거주 시 가족관계증명서로 입증",
      "태아·입양 자녀 포함 시 입증 서류 일치",
      "무주택 기간 (자동계산 vs 신고값)",
      "강원도 거주기간 (10년/5년/1년 단위)",
      "한부모 가족 — 5년 이상 경과 확인",
      "피부양 직계존속 3년 이상 동일등재 (3세대 가점)",
    ],
  },

  newlywed: {
    label: "신혼부부",
    icon: Heart,
    color: "red",
    intro: "혼인 7년 이내 부부 + 무주택. 자녀 수가 우선순위 핵심.",
    eligibility: [
      {
        label: "혼인 기간",
        value: "혼인 7년 이내 (예비신혼 포함)",
        auto: true,
        hint: "예비신혼은 입주 전까지 혼인신고 필요. 혼인신고일 = 가족관계등록부상 신고일 기준",
      },
      { label: "주택소유", value: "무주택세대구성원", auto: true },
      {
        label: "청약통장",
        value: "6개월 이상 + 지역·면적별 예치금 (200만~1,500만원)",
        details: { label: "지역·면적별 예치금", content: DEPOSIT_DETAIL },
      },
      {
        label: "재혼",
        value: "재혼 시 재혼일 기준 7년 이내",
        hint: "이혼 이력이 있으면 그 후 재혼한 날짜로 다시 7년 산정",
      },
    ],
    selection: [
      { label: "공급 비율", value: "공급세대수의 18% 범위" },
      { label: "1순위", value: "자녀 있음 (태아·입양 포함)" },
      { label: "2순위", value: "자녀 없음" },
      { label: "동순위 경쟁 시", value: "① 자녀수 → ② 강원도 거주기간 → ③ 통장가입기간 → ④ 추첨" },
    ],
    incomeAsset: [
      {
        label: "공공주택 소득",
        value: "우선 70% / 일반 100% / 추첨 140% (외벌이 — 맞벌이 +20%p)",
        details: {
          label: "신혼부부 공공주택 소득 한도 (3인가구·외벌이 기준 2024)",
          content: (
            <ul className="space-y-0.5 list-disc list-inside text-[10px]">
              <li>우선 70%: <span className="font-mono">5,038,600원</span> / 맞벌이 80%: 5,758,400원</li>
              <li>일반 100%: <span className="font-mono">7,198,000원</span> / 맞벌이 120%: 8,637,600원</li>
              <li>추첨 140%: <span className="font-mono">10,077,200원</span> / 맞벌이 160%: 11,516,800원</li>
              <li className="mt-1 text-ink-4">3인 이하 기준. 가구원 늘면 한도 ↑</li>
            </ul>
          ),
        },
      },
      {
        label: "민영주택 소득",
        value: "일반 130% / 추첨 200% (외벌이) — 맞벌이 +20%p",
        details: { label: "도시근로자 월평균소득 (2024)", content: INCOME_DETAIL_2024 },
      },
      {
        label: "자산 기준",
        value: "공공주택만 — 부동산 2.15억 / 자동차 3,683만원 이하",
      },
    ],
    documents: [
      // 필수
      { name: "혼인관계증명서 (상세, 본인)", required: true, purpose: "혼인일·혼인 상태 확인 — 핵심 서류" },
      { name: "가족관계증명서 (상세, 자녀 확인)", required: true, purpose: "자녀 수·관계 확인" },
      { name: "건강보험자격득실확인서 (부부 각각)", required: true, purpose: "근로 현황·맞벌이 여부 확인" },
      { name: "건강보험료 납부확인서 (최근 6개월)", required: true, purpose: "소득 추정·맞벌이 검증" },
      { name: "소득증빙서류 (근로소득원천징수영수증 등)", required: true, purpose: "외벌이/맞벌이 소득 합산" },
      // 추가(해당자)
      { name: "임신진단서", required: false, purpose: "임신 중인 경우 — 태아 자녀 인정 (의료기관·임신주차 확인)" },
      { name: "출생증명서", required: false, purpose: "2세 이내 자녀 — 신생아 우선순위 추가" },
      { name: "입양관계증명서", required: false, purpose: "입양 자녀 인정 시" },
      { name: "한부모가족증명서", required: false, purpose: "한부모 5년 경과 시" },
      { name: "비사업자 확인각서", required: false, purpose: "근로자·자영업자 아닌 경우" },
    ],
    checkpoints: [
      "혼인일 7년 이내 (혼인관계증명서 — 신고일 기준)",
      "신혼 자녀수 (태아·입양·전혼자녀 포함 여부)",
      "부부 합산 소득 (외벌이 vs 맞벌이 — 건강보험으로 자동 검증 가능)",
      "무주택 기간 자동계산 — 만 30세 vs 혼인일 중 빠른 시점부터",
      "이혼 이력 확인 (재혼 시 7년 재산정)",
      "강원도 거주기간 (동순위 경쟁 시)",
    ],
  },

  seniorParent: {
    label: "노부모부양",
    icon: UserCheck,
    color: "amber",
    intro: "만 65세 이상 직계존속을 3년 이상 부양한 무주택세대주. 일반공급 가점제 적용.",
    eligibility: [
      {
        label: "세대주 요건",
        value: "무주택세대주 (세대원 X)",
        auto: true,
        hint: "필수 — 세대원으로 등록돼 있으면 신청 불가. 등본상 세대주 표기 확인 필수",
      },
      { label: "부양 대상", value: "만 65세 이상 직계존속 (배우자 직계존속 포함)" },
      {
        label: "부양 기간",
        value: "3년 이상 등본 동일등재",
        auto: true,
        hint: "주민등록초본 발급사항란의 전입일·전출일 이력으로 검증",
      },
      { label: "주택소유", value: "신청자·배우자·직계존속 모두 무주택", auto: true },
      {
        label: "청약통장",
        value: "1순위 + 6개월 이상 + 지역·면적별 예치금 (200만~1,500만원)",
        details: { label: "지역·면적별 예치금", content: DEPOSIT_DETAIL },
      },
    ],
    selection: [
      { label: "공급 비율", value: "공급세대수의 3% 범위" },
      {
        label: "선정 방식",
        value: "일반공급 가점제(84점) + 거주기간·소득 등 종합",
        details: { label: "84점 만점 가점 항목", content: GAJEOM_DETAIL },
      },
    ],
    incomeAsset: [
      {
        label: "소득 기준",
        value: "공공주택만 — 도시근로자 월평균소득 100% 이하 등 (공고 확인)",
        details: { label: "도시근로자 월평균소득 (2024)", content: INCOME_DETAIL_2024 },
      },
      { label: "자산 기준", value: "공공주택 부동산 2.15억 / 자동차 3,683만원 이하" },
    ],
    documents: [
      // 필수
      { name: "직계존속 주민등록표초본 (3년 이상 계속 거주)", required: true, purpose: "부양 기간 입증 — 핵심 서류" },
      { name: "직계존속 가족관계증명서", required: true, purpose: "직계존속 관계 확인" },
      { name: "직계존속 출입국사실증명원", required: true, purpose: "직계존속 해외 90일 초과 체류 검증", auto: true },
      { name: "건강보험 피부양자 확인서 또는 요양급여내역", required: true, purpose: "실질 부양 사실 입증" },
    ],
    checkpoints: [
      "본인이 세대주인지 (세대원이면 부적격)",
      "직계존속 만 65세 이상 (생년월일 확인)",
      "등본 동일등재 3년 이상 계속 (주민등록초본 발급사항란)",
      "직계존속 본인 명의 무주택 (60세 이상 직계존속 본인 주택은 무주택 판정 시 제외 룰 별도)",
      "건강보험 피부양자 등록 또는 실질 부양 입증",
      "직계존속 해외체류 90일 초과 시 부양 인정 안 됨",
    ],
  },

  firstLife: {
    label: "생애최초",
    icon: Sparkles,
    color: "emerald",
    intro: "생애 처음 주택 구입 + 5년 이상 소득세 납부 + 혼인 또는 자녀 있는 자.",
    eligibility: [
      {
        label: "주택 구입 이력",
        value: "본인·배우자 모두 생애 최초 주택 구입 (과거 무소유)",
        auto: true,
        hint: "분양권·입주권 포함. 등기부등본·주택소유 전산검색으로 검증",
      },
      { label: "주택소유", value: "현재 무주택세대구성원", auto: true },
      {
        label: "소득세 납부",
        value: "5년 이상 누적 (60개월)",
        hint: "근로소득세·종합소득세·사업소득세 합산. 5개년도 소득세 납세증명서로 입증",
      },
      { label: "혼인·자녀", value: "혼인 또는 미혼 자녀 있는 자만 (단독세대 X)" },
      {
        label: "청약통장",
        value: "1순위 + 6개월 이상 + 지역·면적별 예치금 (200만~1,500만원)",
        details: { label: "지역·면적별 예치금", content: DEPOSIT_DETAIL },
      },
    ],
    selection: [
      { label: "공급 비율", value: "공공주택 25% / 민영주택 9% (전용 85㎡ 이하)" },
      { label: "선정 방식", value: "추첨제 (가점 없음) — 자격 충족자 중 추첨" },
      { label: "우선·일반·추첨", value: "소득 기준에 따라 우선 70% / 일반 20% / 추첨 10% 배분" },
    ],
    incomeAsset: [
      {
        label: "공공주택 소득",
        value: "우선 100% / 일반 130% / 추첨 160%",
        details: {
          label: "생애최초 공공주택 소득 한도 (3인가구 기준 2024)",
          content: (
            <ul className="space-y-0.5 list-disc list-inside text-[10px]">
              <li>우선 100%: <span className="font-mono">7,198,000원</span></li>
              <li>일반 130%: <span className="font-mono">9,357,400원</span></li>
              <li>추첨 160%: <span className="font-mono">11,516,800원</span></li>
              <li className="mt-1 text-ink-4">3인 이하 기준. 가구원 늘면 한도 ↑</li>
            </ul>
          ),
        },
      },
      {
        label: "민영주택 소득",
        value: "일반 130% / 추첨 200% (공고 확인)",
        details: { label: "도시근로자 월평균소득 (2024)", content: INCOME_DETAIL_2024 },
      },
      {
        label: "자산 기준",
        value: "공공주택 — 부동산 2.15억 / 자동차 3,683만원 이하",
        hint: "신청자·배우자·세대원 합산",
      },
    ],
    documents: [
      // 필수
      { name: "혼인관계증명서 (상세, 본인)", required: true, purpose: "혼인·이혼 이력 확인 — 미혼·기혼 무관 발급" },
      { name: "건강보험자격득실확인서 (본인 + 만19세 이상 세대원)", required: true, purpose: "근로 현황·세대원 직업 확인" },
      { name: "소득세 납부 입증서류 (5개년도, 본인)", required: true, purpose: "5년 이상 납부 확인 — 핵심" },
      { name: "소득증빙서류 (입주자모집공고일 이후 발행)", required: true, purpose: "현재 소득 — 우선·일반·추첨 분류" },
      { name: "부동산소유현황 (본인 + 세대원)", required: true, purpose: "생애 무소유 입증 — 등기 열람", auto: true },
      { name: "비사업자 확인각서 (본인 + 만19세 이상 세대원)", required: true, purpose: "근로자·자영업자 아닌 경우" },
      // 추가(해당자)
      { name: "자녀 혼인관계증명서", required: false, purpose: "만 18세 이상 자녀를 미혼으로 인정 시" },
      { name: "피부양 직계존속 주민등록표초본", required: false, purpose: "직계존속을 가구원수에 포함 인정 시 (소득 산정)" },
    ],
    checkpoints: [
      "본인·배우자·세대원 전원 무주택 + 생애 최초 (과거 주택 취득 이력 전무)",
      "5년 이상 소득세 납부 (근로·자영 합산) — 누적 60개월",
      "혼인 또는 미혼 자녀 있는 자 (단독세대 신청 불가)",
      "현재 소득 기준 충족 (우선/일반/추첨 분류)",
      "공공주택 자산 기준 충족 (부동산 2.15억 / 자동차 3,683만원)",
      "건강보험 가입 — 직업·소득 추정",
    ],
  },

  newborn: {
    label: "신생아 (2024 신설)",
    icon: Baby,
    color: "sky",
    intro: "2년 이내 임신·출산·입양한 가구. 혼인 무관, 출산 장려책으로 소득 한도 완화.",
    eligibility: [
      {
        label: "출생일·예정일",
        value: "입주자모집공고일 기준 2년 이내 임신·출산·입양",
        auto: true,
        hint: "예: 공고일 2024.06.01 → 2022.06.01 이후 출생 또는 임신 인정",
      },
      { label: "주택소유", value: "무주택세대구성원", auto: true },
      { label: "혼인 여부", value: "무관 (미혼·이혼·재혼 모두 가능)" },
      {
        label: "청약통장",
        value: "6개월 이상 + 지역·면적별 예치금 (200만~1,500만원)",
        details: { label: "지역·면적별 예치금", content: DEPOSIT_DETAIL },
      },
    ],
    selection: [
      { label: "공급 비율", value: "민영주택 신혼부부 특별공급 물량의 20% / 공공주택 별도" },
      { label: "선정 방식", value: "신혼부부 특별공급 우선순위 적용 — 자녀 있음 1순위" },
      { label: "우선공급", value: "소득 100% 이하 우선 / 일반 150% / 추첨 200%" },
    ],
    incomeAsset: [
      {
        label: "소득 기준 (공공)",
        value: "우선 100% / 일반 150% / 추첨 200% (외벌이 — 맞벌이 +20%p)",
        hint: "신혼부부보다 완화 — 출산 장려",
        details: {
          label: "신생아 공공주택 소득 한도 (3인가구·외벌이 기준 2024)",
          content: (
            <ul className="space-y-0.5 list-disc list-inside text-[10px]">
              <li>우선 100%: <span className="font-mono">7,198,000원</span> / 맞벌이 120%: 8,637,600원</li>
              <li>일반 150%: <span className="font-mono">10,797,000원</span> / 맞벌이 170%: 12,236,600원</li>
              <li>추첨 200%: <span className="font-mono">14,396,000원</span> / 맞벌이 220%: 15,835,600원</li>
              <li className="mt-1 text-ink-4">3인 이하 기준. 가구원 늘면 한도 ↑</li>
            </ul>
          ),
        },
      },
      { label: "자산 기준", value: "공공주택만 — 부동산 2.15억 / 자동차 3,683만원 이하" },
    ],
    documents: [
      // 필수
      { name: "출생증명서 또는 자녀 기본증명서", required: true, purpose: "출생일 확인 — 핵심 서류" },
      { name: "건강보험자격득실확인서", required: true, purpose: "근로 현황 확인" },
      { name: "건강보험료 납부확인서 (최근 6개월)", required: true, purpose: "소득 추정" },
      { name: "소득증빙서류", required: true, purpose: "우선/일반/추첨 분류" },
      // 추가(해당자)
      { name: "임신진단서", required: false, purpose: "출산 전 — 임신주차·예정일 확인 (의료기관명 명시)" },
      { name: "입양관계증명서", required: false, purpose: "입양 자녀 인정 시" },
      { name: "혼인관계증명서", required: false, purpose: "기혼인 경우 (미혼이어도 신청 가능)" },
    ],
    checkpoints: [
      "출생일·예정일 — 입주자모집공고일 기준 2년 이내",
      "자녀 등본·가족관계 등록 (입양 시 입양관계증명서)",
      "무주택세대구성원 (혼인 무관)",
      "소득 기준 (신혼부부보다 완화된 한도)",
      "임신 시 임신주차 확인 (의료기관명·날짜 명시 필수)",
    ],
  },

  youth: {
    label: "청년 (공공주택)",
    icon: Sparkles,
    color: "blue",
    intro: "만 19~39세 미혼 청년. 본인·부모 모두 무주택 + 본인 소득·자산 기준.",
    eligibility: [
      {
        label: "연령",
        value: "만 19세 이상 39세 이하",
        auto: true,
        hint: "주민등록상 생년월일 기준. 입주자모집공고일 현재 만 39세 0일까지 인정",
      },
      { label: "혼인 상태", value: "미혼 (혼인 이력 없음)", auto: true },
      { label: "주택소유", value: "본인 + 부모(직계존속) 모두 무주택", auto: true },
      { label: "청약통장", value: "6개월 이상", hint: "공공주택은 예치금 요건 별도 기준 (공고 확인)" },
    ],
    selection: [
      { label: "공급 대상", value: "공공주택 (민영주택 청년 특별공급은 일부 시범사업)" },
      { label: "선정", value: "추첨제 (자격 충족자 중)" },
    ],
    incomeAsset: [
      {
        label: "본인 소득",
        value: "월평균소득 140% 이하 — 1인 가구 약 4,860,000원 (2024)",
        details: {
          label: "1인 가구 청년 소득 한도 (2024)",
          content: (
            <ul className="space-y-0.5 list-disc list-inside text-[10px]">
              <li>1인 가구 100%: <span className="font-mono">3,471,000원</span></li>
              <li>1인 가구 120%: <span className="font-mono">4,165,200원</span></li>
              <li>1인 가구 140%: <span className="font-mono">4,859,400원</span></li>
              <li className="mt-1 text-ink-4">매년 1월 갱신 — 청약홈 최신값 확인</li>
            </ul>
          ),
        },
      },
      {
        label: "본인 자산",
        value: "2.83억원 이하 — 부동산·자동차·금융자산 합산 (2024)",
        hint: "본인 명의 자산만 (부모 자산은 별도 기준)",
      },
      { label: "부모 자산", value: "공고에 따라 부모 자산 기준도 적용 가능 — 보통 가구 자산 7.06억 이하" },
    ],
    documents: [
      // 필수
      { name: "혼인관계증명서 (상세, 본인)", required: true, purpose: "미혼 입증 (혼인 이력 없음) — 핵심 서류" },
      { name: "본인 소득증빙서류", required: true, purpose: "월평균소득 산정" },
      { name: "건강보험자격득실확인서 (본인)", required: true, purpose: "직장가입자 vs 지역가입자 구분" },
      { name: "부모 주민등록표등본", required: true, purpose: "부모 무주택 확인용 (부모 등본 별도)", auto: true },
      { name: "부모 부동산소유 확인 동의서 또는 결과", required: true, purpose: "부모 무주택 입증", auto: true },
      { name: "본인 자산 증빙서류", required: true, purpose: "금융자산·부동산·자동차 합산 — 2.83억 이하" },
    ],
    checkpoints: [
      "만 19세 ~ 39세 (생년월일)",
      "미혼 (혼인관계증명서로 입증)",
      "본인 무주택 + 부모(직계존속) 무주택 동시 충족",
      "본인 소득 140% 이하 (1인 가구 기준)",
      "본인 자산 2.83억 이하 (금융·부동산·자동차)",
    ],
  },
};

const TYPE_ORDER: SupplyType[] = [
  "general", "institution", "multiChild", "newlywed",
  "seniorParent", "firstLife", "newborn", "youth",
];

/* ─── 페이지 ─────────────────────────────────────── */

export default function VerificationCriteriaPage() {
  const [announcements, setAnnouncements] = useState<LocalAnnouncement[]>([]);
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);
  const [activeType, setActiveType] = useState<SupplyType>("general");

  useEffect(() => {
    const reload = () => {
      const list = localAnnouncements.listAll();
      setAnnouncements(list);
      if (!selected) {
        const active = list.find((a: LocalAnnouncement) => !isAnnouncementDone(a));
        if (active) setSelected(active);
      }
    };
    reload();
    return onLocalStoreChange(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rules = selected?.eligibility_rules || {};
  const regulation = (rules.regulation as string) || "비규제";
  const minSubscription = rules.min_subscription_period || 6;
  const minRegion = rules.min_region_residence_months || 12;
  const isStrict = regulation === "투기과열" || regulation === "청약과열";

  const cfg = TYPES[activeType];
  const Icon = cfg.icon;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <div className="text-[11px] text-ink-3 uppercase tracking-[0.6px] font-medium mb-1">서류 검증 기준</div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Scale className="w-6 h-6 text-accent" />
          청약 신청 유형별 자격·서류·검증 포인트
        </h1>
        <p className="text-sm text-ink-3 mt-1.5">
          신청 유형을 고르면 그 유형에 적용되는 자격·선정·소득·자산·필요 서류·검증 포인트를 한 화면에 정리합니다.
          ✓ 자동검증 배지는 시스템이 자동 판정하는 항목.
        </p>
      </div>

      <AnnouncementPicker
        announcements={announcements as any}
        selected={selected as any}
        onSelect={(a) => setSelected(a as any)}
      />

      {!selected ? (
        <div className="mt-6 p-8 text-center text-sm text-ink-3 border border-dashed border-border rounded-lg">
          공고를 선택해주세요.
        </div>
      ) : (
        <>
          {/* 컨텍스트 */}
          <div className="mt-2 mb-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-start gap-2">
            <Scale className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">「{selected.title}」 컨텍스트</div>
              <div className="mt-0.5 text-blue-800">
                규제지역 <strong>{regulation}</strong> · 청약통장 최소 가입 <strong>{minSubscription}개월</strong> · 해당지역 거주 <strong>{minRegion}개월</strong> 이상
              </div>
            </div>
          </div>

          {/* 공통 룰 — 모든 유형에 적용 */}
          <Section title="📋 모든 신청 유형 공통 룰 (펼쳐서 확인)">
            <SubBlock title="🏠 무주택 자동 판정 (자동 검증 항목)">
              <RuleRow label="다가구주택" value="호별 등기·여러 건물 모두 1주택 합산" autoVerified />
              <RuleRow label="단독주택" value="여러 채 보유해도 1주택 합산" autoVerified />
              <RuleRow label="매수·매도 페어" value="같은 주소 매수+매도 모두 있으면 보유 0건" autoVerified />
              <RuleRow label="비주거용" value="토지·임야·전·답·상가·사무실·공장·창고 자동 제외" autoVerified />
              <RuleRow label="소형·저가주택" value="60㎡ 이하 + 공시가격 1.6억 이하 → 무주택 인정" autoVerified />
              <RuleRow label="상속 주택" value="상속 6개월 이내 자동 무주택 + 처분 약정 확인 권장" autoVerified />
              <RuleRow label="일시적 2주택" value="2주택 + 최근 취득 36개월 이내 → 처분 약정 권장 경고" autoVerified />
              <RuleRow label="소유권보존 등기" value="다가구주택 건물 단위 등기는 호별 소유와 중복 → 자동 제외" autoVerified />
            </SubBlock>
            <SubBlock title="🌐 거주·해외체류">
              <RuleRow label="해당지역 우선공급" value={`최근 ${minRegion}개월 이상 계속 거주`} autoVerified />
              <RuleRow label="해외 90일 초과" value="해당 주택건설지역 우선공급 청약 불가 — 부적격" autoVerified />
              <RuleRow label="해외 183일 초과" value="국내 거주자 인정 안 됨" />
              <RuleRow label="단기 해외체류 예외" value="90일 이내 여행·출장·파견·치료·취재는 국내 거주 인정" />
            </SubBlock>
            <SubBlock title="⚠️ 부적격 처리">
              <RuleRow label="부적격 사유" value="허위 신고 / 중복 청약 / 1세대 1주택 위반 / 서류 미제출" />
              <RuleRow label="처리" value="당첨 취소 + 1년간 모든 청약 신청 제한" hint="고의·과실 무관" />
              <RuleRow label="예비입주자 승계" value="부적격 시 자리는 예비입주자가 자동 승계" autoVerified />
            </SubBlock>
            <SubBlock title="🚫 전매·재당첨·거주의무">
              <RuleRow label="전매제한" value={isStrict ? "5~10년 (분양가 비율)" : "비규제 1년 / 지방 그 외 없음"} />
              <RuleRow label="재당첨 제한" value="투기과열·청약과열 당첨자 10년/7년, 기타 5년" />
              <RuleRow label="거주의무" value="공공택지 분양가상한제 3~5년, 민간택지 2~3년" />
            </SubBlock>
          </Section>

          {/* 신청 유형 탭 */}
          <div className="mt-4 mb-3">
            <div className="text-[11px] text-ink-3 uppercase tracking-[0.6px] font-medium mb-1.5">신청 유형 선택</div>
            <div className="grid grid-cols-4 gap-1.5">
              {TYPE_ORDER.map((t) => {
                const c = TYPES[t];
                const TIcon = c.icon;
                const active = activeType === t;
                return (
                  <button
                    key={t}
                    onClick={() => setActiveType(t)}
                    className={`px-2.5 py-2 rounded-md text-[11.5px] font-medium border inline-flex items-center justify-center gap-1.5 transition-all ${
                      active
                        ? "bg-accent text-white border-accent shadow-sm"
                        : "bg-white text-ink-2 border-border hover:border-accent/50 hover:text-ink"
                    }`}
                  >
                    <TIcon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 선택된 유형 상세 */}
          <div className="border-2 border-accent/30 rounded-xl p-4 bg-accent-soft/30">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-5 h-5 text-${cfg.color}-600`} />
              <h2 className="text-base font-bold text-ink">{cfg.label}</h2>
            </div>
            <p className="text-xs text-ink-3 mb-4">{cfg.intro}</p>

            <div className="space-y-3">
              {/* 자격 요건 */}
              <Section title="✅ 자격 요건" defaultOpen>
                {cfg.eligibility.map((r, i) => <RuleRow key={i} {...r} autoVerified={r.auto} />)}
              </Section>

              {/* 선정 방식 */}
              <Section title="🎯 선정 방식 / 우선순위" defaultOpen>
                {cfg.selection.map((r, i) => <RuleRow key={i} {...r} autoVerified={r.auto} />)}
              </Section>

              {/* 소득·자산 */}
              <Section title="💰 소득·자산 기준">
                {cfg.incomeAsset.map((r, i) => <RuleRow key={i} {...r} autoVerified={r.auto} />)}
              </Section>

              {/* 필요 서류 — 공통 + 해당 유형 전용 (각 별도 섹션, 해당 유형은 필수 → 추가 순) */}
              <Section
                title={`📄 필요 서류 (공통 ${COMMON_DOCS.length}종 + ${cfg.label} 전용 ${cfg.documents.length}종)`}
                defaultOpen
              >
                <div className="space-y-3">
                  {/* 공통 서류 — 항상 펼쳐진 상태로 노출 */}
                  <div>
                    <div className="text-[12.5px] font-bold text-ink mb-2 flex items-center gap-1.5">
                      <span className="text-[14px]">📁</span>
                      <span>공통 서류 (모든 청약 신청자)</span>
                      <span className="text-[10px] text-ink-4 font-normal">
                        — 필수 {COMMON_DOCS.filter((d) => d.required).length}종 + 추가 {COMMON_DOCS.filter((d) => !d.required).length}종
                      </span>
                    </div>
                    <DocList docs={COMMON_DOCS} />
                  </div>

                  {/* 해당 유형 서류 — 별도 collapsible Section, 필수 → 추가 순 */}
                  {cfg.documents.length > 0 && (
                    <Section title={`📁 ${cfg.label} 전용 서류 (필수 ${cfg.documents.filter((d) => d.required).length}종 + 추가 ${cfg.documents.filter((d) => !d.required).length}종)`} defaultOpen>
                      <DocList
                        docs={[
                          ...cfg.documents.filter((d) => d.required),
                          ...cfg.documents.filter((d) => !d.required),
                        ]}
                      />
                    </Section>
                  )}
                </div>
              </Section>

              {/* 검증 포인트 */}
              <Section title="🔍 담당자 검증 포인트" defaultOpen>
                <ul className="space-y-1 text-[11.5px] text-ink-2">
                  {cfg.checkpoints.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-blue-600 mt-0.5 flex-shrink-0" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
          </div>

          {/* 면책 */}
          <div className="mt-4 p-2.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              자동 판정은 참고용입니다. 최종 적합·부적합은 담당자가 공고 원문과 법령을 직접 확인 후 결정하세요.
              금액 기준(소득·자산)·정책은 매년 변경되므로 청약홈(1644-7445)·해당 공고 문서 최신값 재확인 필수.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
