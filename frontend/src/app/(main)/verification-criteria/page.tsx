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
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-surface2 hover:bg-surface2 transition-colors"
      >
        <span className="font-semibold text-ink text-[13px]">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-ink-4" /> : <ChevronDown className="w-4 h-4 text-ink-4" />}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

function RuleRow({
  label, value, autoVerified, hint,
}: { label: string; value: string; autoVerified?: boolean; hint?: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-border-soft last:border-0">
      <div className="flex-shrink-0 w-1/3 text-[11.5px] font-semibold text-ink-2">{label}</div>
      <div className="flex-1 text-[11.5px] text-ink-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span>{value}</span>
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

interface SupplyTypeConfig {
  label: string;
  icon: any;
  color: string;
  intro: string;
  eligibility: Array<{ label: string; value: string; auto?: boolean; hint?: string }>;
  selection: Array<{ label: string; value: string; auto?: boolean; hint?: string }>;
  incomeAsset: Array<{ label: string; value: string; auto?: boolean; hint?: string }>;
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
      { label: "청약통장", value: "1순위 — 가입기간 + 지역·면적별 예치금 충족", auto: true },
      { label: "주택소유", value: "규제지역(투기과열·청약과열): 무주택세대구성원 / 비규제: 무주택 또는 1주택자", auto: true },
      { label: "거주 요건", value: "해당지역 우선공급 1순위는 입주자모집공고일 기준 최근 1년 이상 계속 거주", auto: true, hint: "해외 90일 초과 체류 시 거주기간 인정 안 됨" },
      { label: "재당첨 제한", value: "투기과열 당첨자 10년/7년, 일반 5년 — 위반 시 부적격" },
    ],
    selection: [
      { label: "가점제 vs 추첨제", value: "전용 85㎡ 이하: 가점 40%/추첨 60% / 85㎡ 초과: 규제지역은 가점 70%, 비규제 추첨 100%" },
      { label: "가점제 항목", value: "무주택기간 32 + 부양가족수 35 + 통장가입기간 17 = 84점 만점", auto: true },
      { label: "추첨제 우선", value: "추첨제 75% → 무주택 세대주 / 25% → 1주택자(처분 약정자) + 미당첨 무주택자" },
    ],
    incomeAsset: [
      { label: "소득 기준", value: "민영주택 일반공급은 없음 (공공주택 한정)", hint: "추첨제 25%(1주택자) 한정 자산 기준 적용 — 가구 자산 약 3.31억 이하 (규제지역)" },
      { label: "자산 기준", value: "비규제 지구는 없음 / 투기과열·청약과열 지구 추첨제 25%만 적용" },
    ],
    documents: [
      { name: "특별공급신청서·무주택 서약서", required: true, purpose: "신청 의사 + 무주택 본인 확인", auto: true },
      { name: "인감증명서 또는 본인서명사실확인서", required: true, purpose: "본인 인증" },
      { name: "신분증", required: true, purpose: "본인 확인" },
      { name: "청약통장 순위(가입)확인서", required: true, purpose: "1순위 자격 확인", auto: true },
      { name: "개인정보 수집·이용 동의서", required: true, purpose: "심사 동의" },
      { name: "주민등록등본 (상세, 본인)", required: true, purpose: "세대 구성·거주 기간 확인", auto: true },
      { name: "주민등록초본 (상세, 본인)", required: true, purpose: "주소 변동 이력 확인" },
      { name: "가족관계증명서 (상세, 본인)", required: true, purpose: "부양가족 확인" },
      { name: "출입국사실증명서 (본인)", required: true, purpose: "해외 90일 초과 체류 검증", auto: true },
      { name: "혼인관계증명서", required: false, purpose: "단독세대 또는 만30세 이전 혼인 인정 시" },
      { name: "배우자 주민등록등본", required: false, purpose: "배우자 분리세대인 경우" },
      { name: "배우자·직계존비속 출입국사실증명서", required: false, purpose: "해외체류로 부양가족 인정 시" },
    ],
    checkpoints: [
      "청약통장 가입기간 + 예치금 충족",
      "무주택세대구성원 또는 1주택자 (규제지역별)",
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
      { label: "추천 기관", value: "국군복지단, 시·도 경로장애인과, 보훈지청, 중소기업 지방청, 도시재생 부지제공 등" },
      { label: "주택소유", value: "무주택세대구성원", auto: true },
      { label: "청약통장", value: "6개월 이상 + 예치금 (단, 철거민·도시재생 부지제공자·장애인·국가유공자는 통장 면제)" },
      { label: "1세대 1회 한정", value: "특별공급 평생 1세대 1회만 신청 가능", auto: true },
    ],
    selection: [
      { label: "공급 비율", value: "전용 85㎡ 이하 공급세대수의 10% 범위" },
      { label: "당첨자 결정", value: "기관 자체 우선순위로 추천 → 사업주체 통보 → 인터넷 청약 신청" },
      { label: "예비입주자", value: "예비대상자도 청약 신청 필수. 잔여 시 추첨으로 입주자/예비입주자 결정" },
    ],
    incomeAsset: [
      { label: "소득 기준", value: "기관별로 상이 — 보훈·장애인 별도, 중소기업 근로자는 도시근로자 월평균소득 100% 이하 등" },
      { label: "자산 기준", value: "공공주택 적용 (부동산 2.15억 / 자동차 3,683만원 이하)" },
    ],
    documents: [
      { name: "기관추천서 (해당 기관 발급)", required: true, purpose: "기관 추천 자격 증명 — 핵심 서류" },
      { name: "자격확인서 (해당 기관)", required: true, purpose: "장애 등급·복무 기간 등 자격 상세" },
      { name: "특별공급신청서·무주택 서약서", required: true, purpose: "신청 + 무주택 본인 확인", auto: true },
      { name: "인감증명서 또는 본인서명사실확인서", required: true, purpose: "본인 인증" },
      { name: "신분증", required: true, purpose: "본인 확인" },
      { name: "청약통장 순위(가입)확인서", required: false, purpose: "통장 면제 대상이 아니면 필수", auto: true },
      { name: "주민등록등본·초본 (상세, 본인)", required: true, purpose: "세대 구성·거주 기간 확인", auto: true },
      { name: "가족관계증명서 (상세, 본인)", required: true, purpose: "세대원 관계 확인" },
      { name: "출입국사실증명서 (본인)", required: true, purpose: "해외 90일 초과 체류 검증", auto: true },
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
      { label: "자녀 수", value: "만 19세 미만 자녀 3명 이상 (태아·입양 포함)", auto: true },
      { label: "주택소유", value: "무주택세대구성원", auto: true },
      { label: "청약통장", value: "6개월 이상 + 예치금" },
      { label: "거주 요건", value: "강원도 6개월 이상 거주 시 우선" },
    ],
    selection: [
      { label: "공급 비율", value: "공급세대수의 10% 범위" },
      { label: "가점표", value: "100점 만점 — 미성년자녀40 + 영유아15 + 세대구성5 + 무주택기간20 + 거주기간15 + 통장기간5", auto: true },
      { label: "동점자 처리", value: "① 미성년 자녀수 많은 자 → ② 신청자 연령 많은 자" },
    ],
    incomeAsset: [
      { label: "소득 기준", value: "공공주택 도시근로자 월평균소득 120% 이하 / 민영은 없음 (공고 확인)" },
      { label: "자산 기준", value: "공공주택만 적용" },
    ],
    documents: [
      { name: "다자녀 우선순위 배점 기준표", required: true, purpose: "가점 산정 자료" },
      { name: "가족관계증명서 (상세, 자녀 확인)", required: true, purpose: "자녀 관계·생년월일 확인" },
      { name: "주민등록등본 (상세, 본인)", required: true, purpose: "세대 구성·자녀 등재", auto: true },
      { name: "임신증명서류 (임신진단서·유산낙태진단서 등)", required: false, purpose: "태아 자녀 인정 시 — 입주자모집공고일 현재 의료기관·임신주차 확인 필수" },
      { name: "출산증명서", required: false, purpose: "최근 출생 자녀 — 자녀수 합산" },
      { name: "입양관계증명서", required: false, purpose: "입양 자녀 인정 시" },
      { name: "친양자 입양관계증명서", required: false, purpose: "친양자 입양 시" },
      { name: "임신증명·출산이행 확인각서", required: false, purpose: "임신 제증명서류와 함께 제출 — 허위·낙태 방지" },
      { name: "자녀 가족관계증명서 (재혼 자녀)", required: false, purpose: "재혼 배우자 자녀 인정 시" },
      { name: "자녀 주민등록등본", required: false, purpose: "자녀 일부가 본인 등본에 미등재 시" },
      { name: "미성년자녀 혼인관계증명서", required: false, purpose: "만 18세 직계비속 미성년 인정 시" },
      { name: "한부모가족증명서", required: false, purpose: "한부모 5년 경과 가점 시" },
      { name: "피부양 직계존속 주민등록초본", required: false, purpose: "3세대 이상 세대구성 가점 시 — 3년 이상 동일등재" },
      { name: "공통 서류", required: true, purpose: "신분증·인감·청약통장·등본·초본·가족관계·출입국·동의서" },
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
      { label: "혼인 기간", value: "혼인 7년 이내 (예비신혼 포함, 입주 전까지 혼인신고 필요)", auto: true },
      { label: "주택소유", value: "무주택세대구성원", auto: true },
      { label: "청약통장", value: "6개월 이상 + 예치금" },
      { label: "재혼", value: "재혼 시 재혼일 기준 7년 이내" },
    ],
    selection: [
      { label: "공급 비율", value: "공급세대수의 18% 범위" },
      { label: "1순위", value: "자녀 있음 (태아·입양 포함)" },
      { label: "2순위", value: "자녀 없음" },
      { label: "동순위 경쟁 시", value: "① 자녀수 → ② 강원도 거주기간 → ③ 통장가입기간 → ④ 추첨" },
    ],
    incomeAsset: [
      { label: "공공주택 소득", value: "우선 70% / 일반 100% / 추첨 140% (외벌이 — 맞벌이 +20%p)" },
      { label: "민영주택 소득", value: "일반 130% / 추첨 200% (외벌이) / 맞벌이 +20%p" },
      { label: "자산 기준", value: "공공주택만 적용 (부동산 2.15억 / 자동차 3,683만원)" },
    ],
    documents: [
      { name: "혼인관계증명서 (상세, 본인)", required: true, purpose: "혼인일·혼인 상태 확인 — 핵심 서류" },
      { name: "가족관계증명서 (상세, 자녀 확인)", required: true, purpose: "자녀 수·관계 확인" },
      { name: "건강보험자격득실확인서 (부부 각각)", required: true, purpose: "근로 현황·맞벌이 여부 확인" },
      { name: "건강보험료 납부확인서 (최근 6개월)", required: true, purpose: "소득 추정·맞벌이 검증" },
      { name: "소득증빙서류 (근로소득원천징수영수증 등)", required: true, purpose: "외벌이/맞벌이 소득 합산" },
      { name: "임신진단서", required: false, purpose: "임신 중인 경우 — 태아 자녀 인정 (입주자모집공고일 현재 임신주차 확인)" },
      { name: "출생증명서", required: false, purpose: "2세 이내 자녀 — 신생아 우선순위 추가" },
      { name: "입양관계증명서", required: false, purpose: "입양 자녀 인정 시" },
      { name: "한부모가족증명서", required: false, purpose: "한부모 5년 경과 시" },
      { name: "비사업자 확인각서", required: false, purpose: "근로자·자영업자 아닌 경우" },
      { name: "공통 서류", required: true, purpose: "신분증·인감·통장·등본·초본·출입국·동의서" },
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
      { label: "세대주 요건", value: "무주택세대주 (세대원 X)", auto: true, hint: "필수 — 세대원으로 등록되어 있으면 신청 불가" },
      { label: "부양 대상", value: "만 65세 이상 직계존속 (배우자 직계존속 포함)" },
      { label: "부양 기간", value: "3년 이상 등본 동일등재", auto: true },
      { label: "주택소유", value: "신청자·배우자·직계존속 모두 무주택", auto: true },
      { label: "청약통장", value: "1순위 + 6개월 이상 + 예치금" },
    ],
    selection: [
      { label: "공급 비율", value: "공급세대수의 3% 범위" },
      { label: "선정 방식", value: "일반공급 가점제(84점) 적용 + 거주기간·소득 등 종합" },
    ],
    incomeAsset: [
      { label: "소득 기준", value: "공공주택만 적용 (도시근로자 월평균소득 100% 이하 등 공고 확인)" },
      { label: "자산 기준", value: "공공주택 부동산 2.15억 / 자동차 3,683만원" },
    ],
    documents: [
      { name: "직계존속 주민등록초본 (3년 이상 계속 거주)", required: true, purpose: "부양 기간 입증 — 핵심 서류" },
      { name: "직계존속 가족관계증명서", required: true, purpose: "직계존속 관계 확인" },
      { name: "직계존속 출입국사실증명서", required: true, purpose: "직계존속 해외 90일 초과 체류 검증", auto: true },
      { name: "건강보험 피부양자 확인서 또는 요양급여내역", required: true, purpose: "실질 부양 사실 입증" },
      { name: "주민등록등본 (상세, 본인)", required: true, purpose: "세대주 + 직계존속 동일등재 확인", auto: true },
      { name: "가족관계증명서 (상세, 본인)", required: true, purpose: "직계존속과의 관계 확인" },
      { name: "공통 서류", required: true, purpose: "신분증·인감·통장·초본·출입국·동의서" },
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
      { label: "주택 구입 이력", value: "본인·배우자 모두 생애 최초 주택 구입 (과거 무소유)", auto: true },
      { label: "주택소유", value: "현재 무주택세대구성원", auto: true },
      { label: "소득세 납부", value: "5년 이상 (근로소득세·종합소득세·사업소득세 누적)" },
      { label: "혼인·자녀", value: "혼인 또는 미혼 자녀 있는 자만 신청 가능 (단독세대 X)" },
      { label: "청약통장", value: "1순위 + 6개월 이상 + 예치금" },
    ],
    selection: [
      { label: "공급 비율", value: "공공주택 25% / 민영주택 9% (전용 85㎡ 이하)" },
      { label: "선정 방식", value: "추첨제 (가점 없음) — 자격 충족자 중 추첨" },
      { label: "우선·일반·추첨", value: "소득 기준에 따라 우선 70% / 일반 20% / 추첨 10% 배분" },
    ],
    incomeAsset: [
      { label: "공공주택 소득", value: "우선 100% / 일반 130% / 추첨 160%" },
      { label: "민영주택 소득", value: "일반 130% / 추첨 200% (공고 확인)" },
      { label: "자산 기준", value: "공공주택 부동산 2.15억 / 자동차 3,683만원" },
    ],
    documents: [
      { name: "혼인관계증명서 (상세, 본인)", required: true, purpose: "혼인·이혼 이력 확인 — 미혼·기혼 무관 발급" },
      { name: "건강보험자격득실확인서 (본인 + 만19세 이상 세대원)", required: true, purpose: "근로 현황·세대원 직업 확인" },
      { name: "소득세 납부 입증서류 (5개년도, 본인)", required: true, purpose: "5년 이상 납부 확인 — 핵심" },
      { name: "소득증빙서류 (입주자모집공고일 이후 발행)", required: true, purpose: "현재 소득 — 우선·일반·추첨 분류" },
      { name: "부동산소유현황 (본인 + 세대원)", required: true, purpose: "생애 무소유 입증 — 등기 열람", auto: true },
      { name: "비사업자 확인각서 (본인 + 만19세 이상 세대원)", required: true, purpose: "근로자·자영업자 아닌 경우" },
      { name: "자녀 혼인관계증명서", required: false, purpose: "만 18세 이상 자녀를 미혼으로 인정 시" },
      { name: "피부양 직계존속 주민등록초본", required: false, purpose: "직계존속을 가구원수에 포함 인정 시 (소득 산정)" },
      { name: "공통 서류", required: true, purpose: "신분증·인감·통장·등본·초본·가족관계·출입국·동의서" },
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
      { label: "출생일·예정일", value: "입주자모집공고일 기준 2년 이내 임신·출산·입양", auto: true },
      { label: "주택소유", value: "무주택세대구성원", auto: true },
      { label: "혼인 여부", value: "무관 (미혼·이혼·재혼 모두 가능)" },
      { label: "청약통장", value: "6개월 이상 + 예치금" },
    ],
    selection: [
      { label: "공급 비율", value: "민영주택 신혼부부 특별공급 물량의 20% / 공공주택 별도 비율" },
      { label: "선정 방식", value: "신혼부부 특별공급 우선순위 적용 — 자녀 있음 1순위" },
      { label: "우선공급", value: "소득 100% 이하 우선 / 일반 150% / 추첨 200%" },
    ],
    incomeAsset: [
      { label: "소득 기준 (공공)", value: "우선 100% / 일반 150% / 추첨 200% (외벌이 — 맞벌이 +20%p)", hint: "신혼부부보다 완화 — 출산 장려" },
      { label: "자산 기준", value: "공공주택만 적용" },
    ],
    documents: [
      { name: "출생증명서 또는 자녀 기본증명서", required: true, purpose: "출생일 확인 — 핵심 서류" },
      { name: "임신진단서", required: false, purpose: "출산 전 — 임신주차·예정일 확인" },
      { name: "입양관계증명서", required: false, purpose: "입양 자녀 인정 시" },
      { name: "가족관계증명서 (상세, 본인)", required: true, purpose: "자녀 등록 확인" },
      { name: "혼인관계증명서", required: false, purpose: "기혼인 경우 (단, 미혼이어도 신청 가능)" },
      { name: "건강보험자격득실확인서", required: true, purpose: "근로 현황 확인" },
      { name: "건강보험료 납부확인서 (최근 6개월)", required: true, purpose: "소득 추정" },
      { name: "소득증빙서류", required: true, purpose: "우선/일반/추첨 분류" },
      { name: "주민등록등본 (상세, 본인)", required: true, purpose: "자녀 등재 + 세대 구성", auto: true },
      { name: "공통 서류", required: true, purpose: "신분증·인감·통장·초본·출입국·동의서" },
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
      { label: "연령", value: "만 19세 이상 39세 이하", auto: true },
      { label: "혼인 상태", value: "미혼 (혼인 이력 없음)", auto: true },
      { label: "주택소유", value: "본인 + 부모(직계존속) 모두 무주택", auto: true },
      { label: "청약통장", value: "6개월 이상" },
    ],
    selection: [
      { label: "공급 대상", value: "공공주택 (민영주택 청년 특별공급은 일부 시범사업)" },
      { label: "선정", value: "추첨제 (자격 충족자 중)" },
    ],
    incomeAsset: [
      { label: "본인 소득", value: "월평균소득 140% 이하 (1인 가구 기준)" },
      { label: "본인 자산", value: "2.83억원 이하 (2024 기준 — 부동산·자동차·금융자산 합산)" },
      { label: "부모 자산 별도", value: "공고에 따라 부모 자산 기준도 적용 가능 (가구 자산 합산)" },
    ],
    documents: [
      { name: "신분증", required: true, purpose: "연령 확인" },
      { name: "가족관계증명서 (상세, 본인)", required: true, purpose: "혼인·자녀 없음 확인" },
      { name: "혼인관계증명서", required: true, purpose: "미혼 입증 (혼인 이력 없음)" },
      { name: "본인 소득증빙서류", required: true, purpose: "월평균소득 산정" },
      { name: "건강보험자격득실확인서 (본인)", required: true, purpose: "직장가입자 vs 지역가입자" },
      { name: "본인·부모 주민등록표등본", required: true, purpose: "부모 무주택 + 등본 분리 확인", auto: true },
      { name: "부모 부동산소유 확인 동의서 또는 결과", required: true, purpose: "부모 무주택 입증", auto: true },
      { name: "본인 자산 증빙서류", required: true, purpose: "금융자산·부동산·자동차 합산 — 2.83억 이하" },
      { name: "공통 서류", required: true, purpose: "인감·통장·초본·출입국·동의서" },
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

              {/* 필요 서류 */}
              <Section title={`📄 필요 서류 (${cfg.documents.filter((d) => d.required).length}종 필수 + ${cfg.documents.filter((d) => !d.required).length}종 추가)`} defaultOpen>
                <div className="space-y-1.5">
                  {cfg.documents.map((d, i) => (
                    <div
                      key={i}
                      className={`p-2 rounded border ${
                        d.required
                          ? "border-blue-200 bg-blue-50/40"
                          : "border-amber-200 bg-amber-50/40"
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
