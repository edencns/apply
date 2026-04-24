"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Building2, CalendarDays, MapPin, Users, FileText, Shield,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, XCircle,
  ArrowLeft, Banknote, Scale, Baby, Heart, UserCheck,
} from "lucide-react";
import { announcements as staticAnnouncements, AptAnnouncement } from "./data";
import { api } from "@/lib/api";
import { localAnnouncements, isNetworkError, LocalAnnouncement, onLocalStoreChange } from "@/lib/local-store";

type Tab = "overview" | "eligibility" | "special" | "documents" | "income";

const TABS: { key: Tab; label: string; icon: typeof Building2 }[] = [
  { key: "overview", label: "단지 개요", icon: Building2 },
  { key: "eligibility", label: "청약 자격", icon: Shield },
  { key: "special", label: "특별공급", icon: Heart },
  { key: "income", label: "소득·자산", icon: Banknote },
  { key: "documents", label: "필요 서류", icon: FileText },
];

const REG_COLOR: Record<string, string> = {
  "투기과열": "bg-red-100 text-red-800",
  "청약과열": "bg-orange-100 text-orange-800",
  "비규제": "bg-green-100 text-green-800",
};

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{text}</span>;
}

function YesNo({ value, label }: { value: string; label?: string }) {
  const isNone = value === "없음";
  return (
    <div className="flex items-center gap-1.5 text-sm">
      {isNone ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
      )}
      <span className={isNone ? "text-green-700" : "text-amber-700"}>
        {label ? `${label}: ` : ""}{value}
      </span>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-surface2 hover:bg-surface2 transition-colors"
      >
        <span className="font-semibold text-ink text-sm">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-ink-4" /> : <ChevronDown className="w-4 h-4 text-ink-4" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

function AptCard({ apt, selected, onClick }: { apt: AptAnnouncement; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
        selected
          ? "border-blue-500 bg-accent-soft shadow-sm"
          : "border-border bg-white hover:border-gray-300 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-bold truncate ${selected ? "text-accent" : "text-ink"}`}>
            {apt.shortName}
          </p>
          <p className="text-xs text-ink-3 truncate mt-0.5">{apt.location}</p>
        </div>
        <Badge text={apt.regulation} cls={REG_COLOR[apt.regulation]} />
      </div>
      <div className="mt-2 flex flex-col gap-1 text-xs text-ink-3">
        <span>{apt.totalUnits}세대</span>
        {apt.schedule.docSubmit && apt.schedule.docSubmit !== "—" && (
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" /> 서류 {apt.schedule.docSubmit}
          </span>
        )}
        {apt.schedule.contract && apt.schedule.contract !== "—" && (
          <span className="flex items-center gap-1">
            <CalendarDays className="w-3 h-3" /> 계약 {apt.schedule.contract}
          </span>
        )}
      </div>
    </button>
  );
}

// Overview Tab
function OverviewTab({ apt }: { apt: AptAnnouncement }) {
  return (
    <div className="space-y-4">
      <Section title="단지 기본 정보">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-ink-3 mb-1">단지명</p>
            <p className="text-sm font-semibold">{apt.name}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3 mb-1">위치</p>
            <p className="text-sm">{apt.location}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3 mb-1">입주 예정</p>
            <p className="text-sm">{apt.moveIn}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3 mb-1">총 세대수</p>
            <p className="text-sm font-semibold">{apt.totalUnits.toLocaleString()}세대
              <span className="text-ink-4 font-normal"> (일반 {apt.generalUnits} / 특별 {apt.specialUnits})</span>
            </p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border-soft space-y-2">
          <YesNo value={apt.resaleRestriction} label="전매제한" />
          <YesNo value={apt.reWinRestriction} label="재당첨 제한" />
          <YesNo value={apt.residenceObligation} label="거주의무" />
          <div className="flex items-center gap-1.5 text-sm">
            {apt.priceCapApplied ? (
              <><AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" /><span className="text-amber-700">분양가상한제 적용</span></>
            ) : (
              <><CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /><span className="text-green-700">분양가상한제 미적용</span></>
            )}
          </div>
        </div>
      </Section>

      <Section title="주택형별 정보">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-xs font-medium text-ink-3">타입</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-ink-3">전용면적</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-ink-3">세대수</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-ink-3">분양가</th>
              </tr>
            </thead>
            <tbody>
              {apt.types.map((t) => (
                <tr key={t.name} className="border-b border-gray-50">
                  <td className="py-2 px-2 font-medium">{t.name}</td>
                  <td className="py-2 px-2 text-right text-ink-2">{t.area}㎡</td>
                  <td className="py-2 px-2 text-right">{t.units}세대</td>
                  <td className="py-2 px-2 text-right text-ink-2">{t.priceRange}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="공급 일정">
        <div className="space-y-2">
          {[
            { label: "공고일", value: apt.schedule.announcement },
            { label: "특별공급 접수", value: apt.schedule.specialApply },
            { label: "일반 1순위", value: apt.schedule.general1st },
            { label: "일반 2순위", value: apt.schedule.general2nd },
            { label: "당첨자 발표", value: apt.schedule.winnerAnnounce },
            { label: "서류 제출", value: apt.schedule.docSubmit },
            { label: "계약 체결", value: apt.schedule.contract },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between text-sm">
              <span className="text-ink-3">{item.label}</span>
              <span className="font-medium">{item.value}</span>
            </div>
          ))}
        </div>
      </Section>

      {apt.notes.length > 0 && (
        <Section title="주요 유의사항">
          <ul className="space-y-2">
            {apt.notes.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// Eligibility Tab
function EligibilityTab({ apt }: { apt: AptAnnouncement }) {
  return (
    <div className="space-y-4">
      <Section title="거주지역 요건">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-accent mb-1">해당지역 (우선공급)</p>
            <p className="text-sm font-semibold">{apt.region.priority}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-ink-3 mb-1">기타지역</p>
            <p className="text-sm">{apt.region.other}</p>
          </div>
          {apt.region.priorityRatio && (
            <div className="bg-accent-soft rounded-lg p-3">
              <p className="text-xs font-medium text-accent">우선공급 비율</p>
              <p className="text-sm text-accent mt-0.5">{apt.region.priorityRatio}</p>
            </div>
          )}
        </div>
      </Section>

      <Section title="청약통장 요건">
        <div className="mb-3">
          <p className="text-xs text-ink-3 mb-1">1순위 최소 가입기간</p>
          <p className="text-sm font-bold text-accent">{apt.subscription.period1st}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 text-xs font-medium text-ink-3">면적 기준</th>
                <th className="text-right py-2 text-xs font-medium text-ink-3">예치금액</th>
              </tr>
            </thead>
            <tbody>
              {apt.subscription.deposit.map((d) => (
                <tr key={d.area} className="border-b border-gray-50">
                  <td className="py-2 text-ink-2">{d.area}</td>
                  <td className="py-2 text-right font-medium">{d.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="일반공급 가점제/추첨제">
        <div className="mb-3 bg-indigo-50 rounded-lg p-3">
          <p className="text-xs font-medium text-indigo-700">적용 비율</p>
          <p className="text-sm text-indigo-900 mt-0.5 font-semibold">{apt.generalPointSystem.ratio}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-ink-3 mb-2">가점 항목 (최대 {apt.generalPointSystem.maxPoints}점)</p>
          <div className="space-y-1.5">
            {apt.generalPointSystem.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <div className="w-5 h-5 bg-surface2 rounded-full flex items-center justify-center text-xs font-medium text-ink-2">
                  {i + 1}
                </div>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="규제 현황">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface2 rounded-lg p-3">
            <p className="text-xs text-ink-3">규제지역</p>
            <Badge text={apt.regulation} cls={REG_COLOR[apt.regulation]} />
          </div>
          <div className="bg-surface2 rounded-lg p-3">
            <p className="text-xs text-ink-3">택지유형</p>
            <p className="text-sm font-medium mt-1">{apt.landType}</p>
          </div>
          <div className="bg-surface2 rounded-lg p-3">
            <p className="text-xs text-ink-3">전매제한</p>
            <p className="text-sm font-medium mt-1">{apt.resaleRestriction}</p>
          </div>
          <div className="bg-surface2 rounded-lg p-3">
            <p className="text-xs text-ink-3">재당첨 제한</p>
            <p className="text-sm font-medium mt-1">{apt.reWinRestriction}</p>
          </div>
        </div>
      </Section>
    </div>
  );
}

// Special Supply Tab
function SpecialTab({ apt }: { apt: AptAnnouncement }) {
  const sp = apt.specialSupply;
  const total = sp.institution + sp.multiChild + sp.newlywed + sp.seniorParent + sp.firstLife;
  const items = [
    { label: "기관추천", value: sp.institution, icon: UserCheck, color: "bg-purple-500" },
    { label: "다자녀", value: sp.multiChild, icon: Baby, color: "bg-pink-500" },
    { label: "신혼부부", value: sp.newlywed, icon: Heart, color: "bg-red-500" },
    { label: "노부모부양", value: sp.seniorParent, icon: Users, color: "bg-amber-500" },
    { label: "생애최초", value: sp.firstLife, icon: CheckCircle2, color: "bg-emerald-500" },
  ];

  return (
    <div className="space-y-4">
      <Section title="특별공급 세대수 배분">
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-ink-2">총 특별공급</span>
            <span className="text-lg font-bold">{total}세대</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden">
            {items.map((item) => (
              <div
                key={item.label}
                className={`${item.color} transition-all`}
                style={{ width: `${(item.value / total) * 100}%` }}
                title={`${item.label}: ${item.value}세대`}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2.5 p-2 rounded-lg bg-surface2">
              <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
              <span className="text-sm text-ink-2 flex-1">{item.label}</span>
              <span className="text-sm font-bold">{item.value}세대</span>
              <span className="text-xs text-ink-4">({((item.value / total) * 100).toFixed(0)}%)</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="다자녀가구 (만19세 미만 자녀 2명+)">
        <div className="space-y-2">
          {apt.multiChildCriteria.map((c, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-blue-500 mt-0.5">&#8226;</span>
              <span>{c}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 bg-pink-50 rounded-lg p-3">
          <p className="text-xs font-medium text-pink-800">선정 순서</p>
          <p className="text-sm text-pink-900 mt-1">지역 &rarr; 배점 &rarr; 자녀수 &rarr; 연령 &rarr; 추첨</p>
        </div>
      </Section>

      <Section title="신혼부부 (혼인 7년 이내)">
        <div className="space-y-2 text-sm">
          <p>무주택세대구성원 + 청약통장 요건 + 소득/자산 기준</p>
          <div className="bg-red-50 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium text-red-800">5단계 공급 구조</p>
            <p className="text-xs text-red-700">1단계(25%) 신생아우선 &rarr; 2단계(10%) 신생아일반</p>
            <p className="text-xs text-red-700">3단계(25%) 우선 &rarr; 4단계(10%) 일반 &rarr; 5단계 추첨</p>
          </div>
          <div className="bg-surface2 rounded-lg p-3">
            <p className="text-xs font-medium text-ink-2">순위 구분</p>
            <p className="text-xs text-ink-2 mt-1">1순위: 현 배우자와 혼인 중 자녀 출산하여 미성년 자녀 있는 분</p>
            <p className="text-xs text-ink-2">2순위: 그 외</p>
          </div>
        </div>
      </Section>

      <Section title="노부모부양 (만65세 이상 3년+ 부양)">
        <div className="text-sm space-y-2">
          <p><strong>무주택세대주</strong> 요건 필수 (다른 특별공급은 세대구성원)</p>
          <p>만65세 이상 직계존속을 3년 이상 계속 부양 (동일 등본 등재)</p>
          <p>가점제 적용: 무주택(32) + 부양가족(35) + 저축(17) = 84점</p>
        </div>
      </Section>

      <Section title="생애최초 (세대원 전원 주택소유 이력 없음)">
        <div className="text-sm space-y-2">
          <p>세대구성원 전원 과거 주택 소유 사실 없을 것</p>
          <p>근로자/자영업자로서 <strong>5년 이상 소득세 납부</strong></p>
          <div className="bg-emerald-50 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium text-emerald-800">5단계 공급 구조</p>
            <p className="text-xs text-emerald-700">1단계(15%) 신생아우선(130%) &rarr; 2단계(5%) 신생아일반</p>
            <p className="text-xs text-emerald-700">3단계(35%) 우선(130%) &rarr; 4단계(15%) 일반 &rarr; 5단계 추첨</p>
          </div>
        </div>
      </Section>
    </div>
  );
}

// Income Tab
function IncomeTab({ apt }: { apt: AptAnnouncement }) {
  return (
    <div className="space-y-4">
      <Section title="신혼부부 소득기준 (3인이하 가구 기준)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 text-xs font-medium text-ink-3">구분</th>
                <th className="text-right py-2 text-xs font-medium text-ink-3">소득 상한</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-50">
                <td className="py-2.5">
                  <div>
                    <p className="font-medium">우선공급 (외벌이 100%)</p>
                    <p className="text-xs text-ink-4">신생아우선 + 우선공급</p>
                  </div>
                </td>
                <td className="py-2.5 text-right font-medium text-accent">{apt.newlywedIncome.single100}</td>
              </tr>
              <tr className="border-b border-gray-50">
                <td className="py-2.5">
                  <div>
                    <p className="font-medium">우선공급 (맞벌이 120%)</p>
                    <p className="text-xs text-ink-4">부부 모두 소득 시</p>
                  </div>
                </td>
                <td className="py-2.5 text-right font-medium text-accent">{apt.newlywedIncome.dual120}</td>
              </tr>
              <tr className="border-b border-gray-50">
                <td className="py-2.5">
                  <div>
                    <p className="font-medium">일반공급 (외벌이 140%)</p>
                    <p className="text-xs text-ink-4">소득초과~140%</p>
                  </div>
                </td>
                <td className="py-2.5 text-right font-medium">{apt.newlywedIncome.single140}</td>
              </tr>
              <tr className="border-b border-gray-50">
                <td className="py-2.5">
                  <div>
                    <p className="font-medium">일반공급 (맞벌이 160%)</p>
                    <p className="text-xs text-ink-4">부부 모두 소득 시</p>
                  </div>
                </td>
                <td className="py-2.5 text-right font-medium">{apt.newlywedIncome.dual160}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="생애최초 소득기준 (3인이하 가구 기준)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 text-xs font-medium text-ink-3">구분</th>
                <th className="text-right py-2 text-xs font-medium text-ink-3">소득 상한</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-50">
                <td className="py-2.5">
                  <div>
                    <p className="font-medium">우선공급 (130% 이하)</p>
                    <p className="text-xs text-ink-4">신생아우선 + 우선공급</p>
                  </div>
                </td>
                <td className="py-2.5 text-right font-medium text-emerald-700">{apt.firstLifeIncome.pct130}</td>
              </tr>
              <tr className="border-b border-gray-50">
                <td className="py-2.5">
                  <div>
                    <p className="font-medium">일반공급 (160% 이하)</p>
                    <p className="text-xs text-ink-4">신생아일반 + 일반공급</p>
                  </div>
                </td>
                <td className="py-2.5 text-right font-medium text-emerald-700">{apt.firstLifeIncome.pct160}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="자산기준 (부동산 가액)">
        <div className="bg-amber-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Scale className="w-4 h-4 text-amber-600" />
            <p className="font-semibold text-amber-900">{apt.assetLimit}</p>
          </div>
          <div className="text-xs text-amber-800 space-y-1">
            <p>* 신혼부부 5단계(추첨) + 생애최초 5단계(추첨) 신청자에 적용</p>
            <p>* 건축물: 공동주택가격 / 개별주택가격</p>
            <p>* 토지: 개별공시지가 x 면적</p>
            <p>* 농지, 공공용지, 종중토지 등은 제외</p>
          </div>
        </div>
      </Section>

      <Section title="소득 확인 시점">
        <div className="bg-surface2 rounded-lg p-3 text-sm space-y-1.5">
          <p><strong>상시 근로자:</strong> 전년도(2025년) 소득 기준</p>
          <p><strong>사업자/프리랜서:</strong> 전전년도(2024년) 소득 기준</p>
          <p className="text-xs text-ink-3 mt-2">* 부산 국제금융은 2024년 공고이므로 2023년 기준 적용</p>
        </div>
      </Section>
    </div>
  );
}

// Documents Tab
function DocumentsTab({ apt }: { apt: AptAnnouncement }) {
  const docSections = [
    { key: "common" as const, title: "공통 서류 (전체 당첨자)", color: "blue" },
    { key: "newlywed" as const, title: "신혼부부 추가 서류", color: "red" },
    { key: "firstLife" as const, title: "생애최초 추가 서류", color: "emerald" },
    { key: "multiChild" as const, title: "다자녀가구 추가 서류", color: "pink" },
    { key: "seniorParent" as const, title: "노부모부양 추가 서류", color: "amber" },
    { key: "generalPoint" as const, title: "일반공급 가점제 추가", color: "indigo" },
  ];

  return (
    <div className="space-y-4">
      {docSections.map(({ key, title, color }) => (
        <Section key={key} title={title} defaultOpen={key === "common"}>
          <ul className="space-y-2">
            {apt.requiredDocs[key].map((doc, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <div className={`w-5 h-5 rounded-full bg-${color}-100 flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  <FileText className={`w-3 h-3 text-${color}-600`} />
                </div>
                <span>{doc}</span>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}

/** 등록된 공고(LocalAnnouncement 또는 backend)를 compare 페이지의 AptAnnouncement shape로 어댑팅.
 *  알 수 없는 필드는 "—" 또는 빈 배열로 채우고, 자동 추출되지 않았음을 알리는 노트를 추가한다.
 */
function adaptToAptAnnouncement(ann: any): AptAnnouncement {
  const rules = ann?.eligibility_rules || {};
  const regionPriority: string[] = rules.region_priority || [];
  const specialTypes: string[] = rules.special_supply_types || [];
  const exclusiveAreas: any[] = rules.exclusive_areas || [];
  const supplyTypesDetail: any[] = rules.supply_types_detail || [];
  const requiredDocuments: Record<string, string[]> = rules.required_documents || {};
  const incomeTable: Record<string, any> = rules.income_table || {};

  const fmtDate = (s?: string | null) => {
    if (!s) return "—";
    try {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return String(s);
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    } catch { return String(s); }
  };

  const fmtRange = (start?: string | null, end?: string | null) => {
    const s = fmtDate(start); const e = fmtDate(end);
    if (s === "—" && e === "—") return "—";
    if (s === "—") return e;
    if (e === "—" || e === s) return s;
    const [sy] = s.split("."); const [ey, ...rest] = e.split(".");
    if (sy === ey) return `${s}~${rest.join(".")}`;
    return `${s} ~ ${e}`;
  };

  // 소득기준표에서 3인 가구 기준 첫 행을 가져와 신혼부부 소득 표시에 대략 매핑 (정확한 변환은 어려우므로 "—")
  const getIncomeAt = (percent: string): string => {
    const first = Object.values(incomeTable)[0];
    if (first && typeof first === "object") {
      const v = (first as any)[percent];
      if (typeof v === "number") return `${Math.round(v / 10000).toLocaleString("ko-KR")}만원`;
    }
    return "—";
  };

  // 총 세대수: rules.total_units 우선, 없으면 exclusive_areas 합계
  const totalUnits: number = rules.total_units
    || exclusiveAreas.reduce((s: number, a: any) => s + (a.totalUnits || 0), 0);
  const generalUnits: number = exclusiveAreas.reduce((s: number, a: any) => s + (a.generalUnits || 0), 0);
  const specialUnits: number = exclusiveAreas.reduce((s: number, a: any) => s + (a.specialUnits || 0), 0);

  // 위치: region_full > region_priority 합
  const location = rules.region_full || regionPriority.join(" ") || "—";

  // 특별공급 타입별 세대수 (전용면적 합산에서 유추)
  const countByType = (typeName: string): number => {
    const st = supplyTypesDetail.find((t: any) => t.type === typeName);
    return st?.totalUnits || (specialTypes.includes(typeName) ? 1 : 0);
  };

  const newlywedDetail = supplyTypesDetail.find((t: any) => t.type === "신혼부부");
  const firstLifeDetail = supplyTypesDetail.find((t: any) => t.type === "생애최초");
  const multiChildDetail = supplyTypesDetail.find((t: any) => t.type === "다자녀가구");

  return {
    id: `registered-${ann.id}`,
    name: ann.title,
    shortName: ann.title,
    location,
    totalUnits,
    generalUnits,
    specialUnits,
    moveIn: rules.move_in_date || "—",
    regulation: rules.regulation || (rules.no_home_required ? "비규제" : "—"),
    landType: rules.land_type || "민간택지",
    priceCapApplied: rules.price_cap_applied ?? false,
    resaleRestriction: rules.resale_restriction || "없음",
    reWinRestriction: rules.rewin_restriction || "없음",
    residenceObligation: rules.residence_obligation || "없음",
    schedule: {
      announcement: fmtDate(rules.announcement_date),
      specialApply: fmtDate(rules.special_apply_date || ann.application_start),
      general1st: fmtDate(rules.general_1st_date || ann.application_start),
      general2nd: fmtDate(rules.general_2nd_date || ann.application_end),
      winnerAnnounce: fmtDate(ann.winner_announce_date),
      docSubmit: fmtRange(rules.doc_submit_start, rules.doc_submit_end),
      contract: fmtRange(ann.contract_start, ann.contract_end),
    },
    types: exclusiveAreas.map((a: any) => ({
      name: a.area || "—",
      area: Number(a.squareMeters) || 0,
      units: Number(a.totalUnits) || 0,
      priceRange: a.price || "—",
    })),
    region: {
      priority: regionPriority[0] || location || "—",
      other: regionPriority.slice(1).join(", ") || "—",
    },
    subscription: {
      period1st: rules.min_subscription_period ? `${rules.min_subscription_period}개월 이상` : "—",
      deposit: [],
    },
    specialSupply: {
      institution: countByType("기관추천"),
      multiChild: countByType("다자녀가구"),
      newlywed: countByType("신혼부부"),
      seniorParent: countByType("노부모부양"),
      firstLife: countByType("생애최초"),
    },
    multiChildCriteria: multiChildDetail?.conditions || [],
    newlywedIncome: {
      single100: newlywedDetail?.incomeLimitPercent ? `${newlywedDetail.incomeLimitPercent}%` : getIncomeAt("100%"),
      dual120: newlywedDetail?.incomeLimitDualPercent ? `${newlywedDetail.incomeLimitDualPercent}%` : getIncomeAt("120%"),
      single140: getIncomeAt("140%"),
      dual160: getIncomeAt("160%"),
    },
    firstLifeIncome: {
      pct130: firstLifeDetail?.incomeLimitPercent ? `${firstLifeDetail.incomeLimitPercent}%` : getIncomeAt("130%"),
      pct160: getIncomeAt("160%"),
    },
    assetLimit: rules.asset_limit || "—",
    generalPointSystem: {
      ratio: rules.point_system || "—",
      maxPoints: 84,
      items: [],
    },
    requiredDocs: {
      common: requiredDocuments["공통"] || (rules.no_home_required ? ["주민등록등본", "주민등록초본 (무주택 확인)", "혼인관계증명서"] : ["주민등록등본", "주민등록초본"]),
      multiChild: requiredDocuments["다자녀가구"] || [],
      newlywed: requiredDocuments["신혼부부"] || [],
      seniorParent: requiredDocuments["노부모부양"] || [],
      firstLife: requiredDocuments["생애최초"] || [],
      generalPoint: requiredDocuments["일반공급"] || [],
    },
    notes: totalUnits > 0 && exclusiveAreas.length > 0
      ? []  // 충분한 정보가 추출된 경우 경고 노트 생략
      : [
          "PDF 자동 추출은 일정·자격 기준·특별공급 유형만 지원합니다.",
          "단지 세부 정보(공급세대수, 소득기준, 가점제 등)는 공고문에서 수동으로 확인해 주세요.",
        ],
  };
}

function ComparePageInner() {
  const searchParams = useSearchParams();
  const registeredId = searchParams?.get("id");

  const [registeredApts, setRegisteredApts] = useState<AptAnnouncement[]>([]);
  const [selectedId, setSelectedId] = useState<string>(staticAnnouncements[0].id);
  const [tab, setTab] = useState<Tab>("overview");

  // 마운트 시 등록된 공고를 모두 로드하여 샘플과 합침
  // + 로컬 스토어 변경(다른 페이지에서 삭제/추가/수정) 시 자동 재로드
  useEffect(() => {
    let cancelled = false;

    const loadList = async () => {
      const adapted: AptAnnouncement[] = [];

      // 1) query param에 id가 있으면 우선 로드
      if (registeredId) {
        const idNum = Number(registeredId);
        let loaded: any = null;
        try {
          const r = await api.get(`/announcements/${idNum}`);
          loaded = r.data;
        } catch (err: any) {
          if (isNetworkError(err) || err?.response?.status === 404) {
            loaded = localAnnouncements.get(idNum);
          }
        }
        if (loaded) adapted.push(adaptToAptAnnouncement(loaded));
      }

      // 2) 로컬 공고 전부 추가
      const localAll = localAnnouncements.listAll();
      for (const la of localAll) {
        if (adapted.some((a) => a.id === `registered-${la.id}`)) continue;
        adapted.push(adaptToAptAnnouncement(la));
      }

      if (!cancelled) {
        setRegisteredApts(adapted);
        if (registeredId && adapted.length > 0) {
          setSelectedId(adapted[0].id);
        }
      }
    };

    loadList();

    // 다른 페이지(공고 관리 등)에서 공고 변경 시 자동 재로드
    const unsub = onLocalStoreChange((key) => {
      if (key === "apply:announcements") loadList();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [registeredId]);

  // 등록된 공고 + 샘플 모두 하나의 플랫 리스트
  const allApts = [...registeredApts, ...staticAnnouncements];
  const selected = allApts.find((a) => a.id === selectedId) || allApts[0] || staticAnnouncements[0];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <a href="/announcements" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2 mb-3">
          <ArrowLeft className="w-3.5 h-3.5" /> 모집공고 목록
        </a>
        <h1 className="text-2xl font-bold text-ink">공고문 비교 분석</h1>
        <p className="text-sm text-ink-3 mt-1">
          총 {allApts.length}개 공고의 청약 조건, 특별공급, 소득기준, 필요서류를 한눈에 비교
        </p>
      </div>

      <div className="flex gap-6">
        {/* Left: 전체 공고 리스트 (플랫) */}
        <div className="w-64 flex-shrink-0 space-y-2">
          {allApts.map((apt) => (
            <AptCard
              key={apt.id}
              apt={apt}
              selected={apt.id === selectedId}
              onClick={() => setSelectedId(apt.id)}
            />
          ))}
          {allApts.length === 0 && (
            <p className="text-xs text-ink-4 text-center py-8">등록된 공고가 없습니다</p>
          )}
        </div>

        {/* Right: Detail */}
        <div className="flex-1 min-w-0">
          {/* Tabs */}
          <div className="flex gap-1 mb-5 bg-surface2 rounded-lg p-1">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
                  tab === key
                    ? "bg-white text-accent shadow-sm"
                    : "text-ink-3 hover:text-ink-2"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="min-h-[600px]">
            {tab === "overview" && <OverviewTab apt={selected} />}
            {tab === "eligibility" && <EligibilityTab apt={selected} />}
            {tab === "special" && <SpecialTab apt={selected} />}
            {tab === "income" && <IncomeTab apt={selected} />}
            {tab === "documents" && <DocumentsTab apt={selected} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="p-6 text-ink-4">불러오는 중...</div>}>
      <ComparePageInner />
    </Suspense>
  );
}
