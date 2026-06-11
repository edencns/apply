"use client";

/**
 * 용어사전 — 청약 업무 신입사원이 처음 보는 용어를 한 곳에서 찾을 수 있도록 정리.
 *
 * 카테고리:
 *   ① 청약 기본
 *   ② 자격 요건
 *   ③ 가점·추첨
 *   ④ 서류·증명
 *   ⑤ 명의변경
 *   ⑥ 시스템 상태(이 시스템에서만 쓰이는 배지·코드)
 *
 * 각 항목은: 용어 / 한 줄 정의 / 보충 설명·예시 / (있으면) 관련 법령·기준
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen, Search, Phone, ExternalLink, Home, Award, FileText,
  RefreshCw, AlertCircle, Sparkles,
} from "lucide-react";

interface Term {
  term: string;
  /** 검색용 별칭(영문·약어·동의어) */
  aliases?: string[];
  /** 한 줄 정의 */
  short: string;
  /** 보충 설명 */
  detail?: string;
  /** 예시·계산식 */
  example?: string;
  /** 관련 법령·기준 */
  reference?: string;
}

interface Category {
  key: string;
  label: string;
  icon: any;
  color: string;
  terms: Term[];
}

const CATEGORIES: Category[] = [
  {
    key: "basic",
    label: "① 청약 기본",
    icon: Home,
    color: "indigo",
    terms: [
      {
        term: "청약통장",
        aliases: ["주택청약종합저축", "입주자저축"],
        short: "주택을 분양받기 위해 가입하는 적금. 가입기간·납입회차·예치금이 1순위 자격과 가점에 영향.",
        detail: "주택청약종합저축이 현재의 표준 형태. 매월 2만~50만원 자유 납입. 만 19세 이상 누구나 1인 1통장.",
        example: "24개월 가입 + 24회 납입 + 예치금 300만원(서울·85㎡ 이하) = 1순위 자격.",
        reference: "주택공급에 관한 규칙 제27조",
      },
      {
        term: "1순위 / 2순위",
        short: "청약통장 가입기간·납입회차에 따른 우선순위. 1순위가 먼저 추첨·가점 경쟁.",
        detail: "투기과열·청약과열지구는 24개월·24회 + 무주택 세대구성 + 5년 이내 다른 당첨 이력 없음 = 1순위. 그 외 12개월·12회면 1순위(공고에 따라 6개월·6회).",
      },
      {
        term: "일반공급 / 특별공급",
        short: "일반공급은 가점·추첨으로 누구나, 특별공급은 신혼·다자녀·노부모 등 특정 조건자만.",
        detail: "특별공급은 7유형: 기관추천·다자녀가구·신혼부부·노부모부양·생애최초·신생아·청년. 각 유형별 자격·가점·서류가 다름.",
      },
      {
        term: "공급유형",
        short: "이 당첨자가 어떤 자격으로 신청했는지 — 일반/기관추천/다자녀/신혼부부/노부모/생애최초/신생아/청년.",
        detail: "서류 검증의 출발점. 같은 사람이라도 공급유형에 따라 필요 서류·소득 한도·가점 항목이 달라짐.",
      },
      {
        term: "예비입주자 / 예비당첨자",
        aliases: ["예비"],
        short: "본 당첨자가 부적격·계약포기 시 같은 주택형의 다음 순번으로 승계되는 명단.",
        detail: "보통 본 당첨자의 5배수까지. 같은 주택형 안에서만 승계 가능.",
      },
      {
        term: "입주자모집공고일",
        aliases: ["공고일", "모집공고일"],
        short: "모든 자격(무주택·거주기간·소득)의 「기준 시점」. 이 날짜를 기준으로 역산해 N개월·N년 자격을 본다.",
        example: "「2년 이상 거주」 = 모집공고일로부터 24개월 전부터 해당 지역에 전입돼 있어야 함.",
      },
      {
        term: "규제지역 (투기과열·청약과열·비규제)",
        short: "정부가 지정한 부동산 시장 과열 지역. 1순위 요건·재당첨 제한 등이 강화됨.",
        detail: "투기과열지구가 가장 강함. 청약과열지구가 그 다음. 비규제는 일반 기준 적용. 강원도는 대부분 비규제.",
        reference: "주택법 제63조·제63조의2",
      },
    ],
  },
  {
    key: "eligibility",
    label: "② 자격 요건",
    icon: Award,
    color: "blue",
    terms: [
      {
        term: "무주택 세대구성원",
        aliases: ["무주택"],
        short: "신청자 본인 + 배우자 + 같은 등본의 직계존비속 모두 주택을 소유하지 않은 상태.",
        detail: "분리세대인 배우자도 합산. 자녀·부모는 등본 동일 시 합산. 분양권·입주권도 2018-12-11 이후 취득분은 주택수에 포함.",
      },
      {
        term: "무주택 4대 예외",
        short: "주택을 가진 것처럼 보여도 무주택으로 인정되는 4가지 케이스. 시스템이 자동 판정.",
        detail: "① 소형·저가주택(전용 60㎡ 이하 + 공시가 1.6억 이하 수도권 / 1억 비수도권) ② 상속주택(등기 후 6개월 내 처분 약정) ③ 일시적 2주택(36개월 내 종전 처분) ④ 단독·다가구주택은 호 수 무관 1주택.",
      },
      {
        term: "무주택 기간",
        short: "본인·배우자가 무주택 상태였던 기간. 가점 「무주택기간」(최대 32점)의 근거.",
        detail: "시작일은 「만 30세가 된 날」 또는 「혼인신고일」 중 빠른 시점. 과거 주택 보유 이력이 있으면 「처분일 이후」부터 재계산.",
        example: "1990-05-15 출생 + 미혼 + 주택 보유 이력 없음 → 무주택기간 시작일 = 2020-05-15(만 30세).",
      },
      {
        term: "세대주 / 세대원",
        short: "세대주는 등본의 「세대주」로 표시된 사람. 세대원은 그 외 가족.",
        detail: "노부모부양·다자녀 특공은 세대주 본인 필수. 일반공급 일부 가점제는 세대원도 가능.",
      },
      {
        term: "분리세대",
        short: "법적 부부지만 등본이 분리되어 있는 경우. 무주택·소득은 합산하지만 가족관계는 분리.",
        detail: "배우자 분리세대는 주택수·소득 합산 대상. 그 외 분리세대(자녀·부모)는 합산 안 됨.",
      },
      {
        term: "지역 우선공급",
        short: "공고 지역에 일정 기간 거주한 사람에게 먼저 공급하는 제도. 공고에 따라 1·2·3순위로 차등.",
        example: "서울 공고 + 「2년 이상 거주」 요건 → 모집공고일 기준 24개월 전부터 서울 전입돼야 우선.",
      },
      {
        term: "도시근로자 월평균소득",
        aliases: ["월평균소득"],
        short: "통계청·국토부가 매년 1월 발표하는 가구 평균 소득. 청약 자격(특공·생애최초)의 소득 기준선.",
        detail: "가구원 수별로 다르고 100% 기준액에 ×120%·130%·160% 등 비율로 자격선이 정해짐.",
        example: "2024년 4인 가구 100% = 약 825만원. 신혼부부 우선 100% / 일반 130% / 추첨 200%.",
      },
      {
        term: "재당첨 제한",
        short: "이전 청약에서 당첨된 사람은 일정 기간(1~10년) 다른 청약에 1순위 신청 불가.",
        detail: "투기과열지구 당첨 = 10년, 청약과열 = 7년, 그 외 = 5년 이내 다른 1순위 신청 불가.",
      },
    ],
  },
  {
    key: "scoring",
    label: "③ 가점·추첨",
    icon: Sparkles,
    color: "purple",
    terms: [
      {
        term: "가점제",
        short: "무주택기간(32) + 부양가족수(35) + 청약통장 가입기간(17) = 84점 만점으로 점수 높은 순 당첨.",
        reference: "주택공급에 관한 규칙 제28조",
      },
      {
        term: "추첨제",
        short: "1순위 자격자 중 무작위 추첨. 가점 낮은 1주택자도 도전 가능.",
        detail: "투기과열·청약과열지구 85㎡ 이하는 추첨 60%, 그 외 비율 다양. 「가점·추첨 비율표」는 서류 검증 기준 페이지에 정리됨.",
      },
      {
        term: "84점 만점 (가점)",
        short: "일반공급 가점제 총점. 무주택기간 32 + 부양가족수 35 + 통장 가입기간 17.",
        detail: "무주택 1년당 +2점(15년 32점) / 부양가족 0~6명+ (5~35점) / 통장 6개월~15년+ (1~17점).",
      },
      {
        term: "100점 만점 (다자녀)",
        short: "다자녀 특별공급 우선순위 배점. 자녀수·영유아·세대구성·무주택·거주기간 등.",
        detail: "미성년 자녀 5명+ 40점, 4명 35점, 3명 30점. 영유아 자녀수·세대구성·무주택기간 가점.",
      },
      {
        term: "동점자 처리",
        short: "가점·배점 동점일 때 적용되는 우선순위. 보통 ① 미성년 자녀수 → ② 신청자 연령 → ③ 추첨.",
      },
    ],
  },
  {
    key: "documents",
    label: "④ 서류·증명",
    icon: FileText,
    color: "emerald",
    terms: [
      {
        term: "주민등록등본",
        short: "세대 구성·세대원·세대주·전입일을 증명. 「상세」 + 주민번호 뒷자리 포함 발급분 필수.",
        detail: "지역 우선공급의 거주기간은 등본 「발급사항」 또는 전입일자로 산정.",
      },
      {
        term: "주민등록초본",
        short: "본인의 주소 변동 이력. 「상세」 + 「과거 주소 포함」으로 발급되어야 거주기간 계산 가능.",
      },
      {
        term: "출입국사실증명원",
        aliases: ["출입국증명원"],
        short: "본인·직계존비속·배우자의 국내 거주 사실 증명.",
        detail: "해외체류 90일 초과(연속) 또는 183일 초과(연간)는 국내거주 미인정. 입국 후 7일 내 동일국가 재출국은 연속 체류로 봄.",
      },
      {
        term: "가족관계증명서 (상세)",
        short: "본인 기준 부모·배우자·자녀 관계 증명. 다자녀·신혼·생애최초 검증 핵심.",
      },
      {
        term: "혼인관계증명서 (상세)",
        short: "혼인일·이혼·재혼 이력. 신혼부부 7년 이내 자격 판정.",
        detail: "사실혼은 인정 안 됨. 재혼 시에도 「현 혼인」 7년 이내 기준.",
      },
      {
        term: "건강보험자격득실확인서",
        short: "직장가입자/지역가입자/피부양자 구분. 소득 산정의 1차 근거.",
      },
      {
        term: "건강보험료 납부확인서",
        short: "최근 6개월 납부분으로 소득 추정. 신혼·생애최초·신생아 특공 소득 검토 핵심.",
      },
      {
        term: "소득증빙서류",
        short: "전년도 또는 5개년 누적 소득 증빙. 근로/사업/기타/연금/이자배당소득 원천징수영수증·소득금액증명원 등.",
        detail: "근로자: 근로소득원천징수영수증. 사업자: 종합소득세 신고서. 무직: 사실증명원(신고사실없음).",
      },
      {
        term: "부동산소유현황",
        short: "본인·세대원의 주택·토지·건축물 소유 이력. 「부동산소유확인 시스템」으로 일괄 조회.",
      },
      {
        term: "비사업자 확인각서",
        short: "본인·세대원이 부동산임대업 등 사업자가 아님을 자필 서약. 생애최초 필수.",
      },
      {
        term: "인감증명서 / 본인서명사실확인서",
        short: "본인 의사 표시 검증. 발급 3개월 이내 분만 유효.",
      },
    ],
  },
  {
    key: "transfer",
    label: "⑤ 명의변경",
    icon: RefreshCw,
    color: "amber",
    terms: [
      {
        term: "명의변경",
        short: "계약 체결 후 분양권을 다른 사람 명의로 옮기는 것. 사유는 상속·증여·이혼·전매 4가지.",
      },
      {
        term: "상속",
        short: "기존 명의자 사망으로 분양권이 상속인에게 이전. 사망진단서·제적등본·가족관계증명서 필요.",
      },
      {
        term: "증여 (배우자/부모자녀)",
        short: "분양권을 무상으로 양도. 증여계약서·증여세 납부 영수증 필요.",
      },
      {
        term: "전매",
        short: "분양권을 매매로 양도. 전매제한 기간이 지났는지 확인 필수.",
        detail: "투기과열지구는 소유권 이전등기 시까지(보통 5~10년) 전매 제한.",
      },
      {
        term: "이혼 재산분할",
        short: "이혼에 따라 분양권 명의가 배우자에게 이전. 법원 판결문 또는 공증 합의서 필요.",
      },
      {
        term: "승계",
        short: "본 당첨자 부적격·계약포기 시 같은 주택형의 예비자가 그 자리를 잇는 것. 명의변경과는 다름.",
      },
    ],
  },
  {
    key: "system",
    label: "⑥ 시스템 상태·배지 (이 시스템에서)",
    icon: AlertCircle,
    color: "rose",
    terms: [
      {
        term: "적합",
        short: "1~5단계 모든 검증 통과. 계약 진행 가능.",
      },
      {
        term: "부적합",
        short: "한 가지 이상 자격 미달. 계약 불가, 같은 주택형 예비에서 승계 처리.",
      },
      {
        term: "검수보류",
        aliases: ["보류"],
        short: "자동 판정만으로는 결정 어려움. 담당자가 추가 서류·확인 후 수동 판정 필요.",
      },
      {
        term: "미검수",
        short: "서류는 등록됐지만 아직 검토 시작 안 됨. 5단계에서 차례 대기 중.",
      },
      {
        term: "미등록",
        short: "당첨자 명단에 없거나 1단계 등록이 안 됨. 1단계로 돌아가 등록 필요.",
      },
      {
        term: "✓ 자동검증",
        short: "시스템이 별도 입력 없이 자동으로 판정한 항목. 1~4단계 결과·국토부 전산 조회 결과 등.",
      },
      {
        term: "✓ 청약홈 자동확인",
        short: "청약홈 신청자가 청약 신청 시 이미 검증된 서류 — 별도 제출 불필요.",
        detail: "특별공급신청서·무주택서약서·청약통장 순위확인서 등. 추가 당첨자(미달·승계자)는 청약홈을 거치지 않아 별도 제출 필요.",
      },
      {
        term: "수동 매칭",
        short: "5단계 배치 업로드 시 파일명 자동 매칭 실패 → 사용자가 직접 당첨자 선택.",
      },
      {
        term: "QUOTA_EXCEEDED",
        short: "Gemini API 월 한도 초과(429). 6단계 명의변경에서 발생 가능. ai.studio/spend에서 한도 늘리거나 다음 달 대기.",
      },
    ],
  },
];

/* ─── 페이지 ─────────────────────────────────────── */

const COLOR_CLASS: Record<string, string> = {
  indigo: "border-accent-line bg-accent-soft text-ink",
  blue: "border-accent-line bg-accent-soft text-ink",
  purple: "border-purple-200 bg-purple-50/40 text-purple-900",
  emerald: "border-emerald-200 bg-emerald-50/40 text-emerald-900",
  amber: "border-amber-200 bg-amber-50/40 text-amber-900",
  rose: "border-rose-200 bg-rose-50/40 text-rose-900",
};

export default function GlossaryPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.map((cat) => ({
      ...cat,
      terms: cat.terms.filter((t) => {
        const hay = [
          t.term, ...(t.aliases || []), t.short, t.detail || "", t.example || "", t.reference || "",
        ].join(" ").toLowerCase();
        return hay.includes(q);
      }),
    })).filter((cat) => cat.terms.length > 0);
  }, [query]);

  const totalCount = CATEGORIES.reduce((sum, c) => sum + c.terms.length, 0);
  const filteredCount = filtered.reduce((sum, c) => sum + c.terms.length, 0);

  return (
    <div className="px-7 py-6 max-w-5xl mx-auto">
      {/* 헤더 */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="w-5 h-5 text-accent" />
          <h1 className="text-xl font-bold text-ink tracking-[-0.3px]">용어사전</h1>
          <span className="text-[11px] text-ink-4">({totalCount}개)</span>
        </div>
        <p className="text-xs text-ink-3">
          청약 업무에서 자주 등장하는 용어·자격·서류·시스템 상태를 한 곳에 정리. 검색하거나 카테고리별로 살펴보세요.
        </p>
      </div>

      {/* 검색 */}
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-4" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="용어 검색 (예: 무주택, 가점, 출입국, 부적합...)"
          className="w-full pl-9 pr-3 py-2.5 text-[13px] rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
        />
        {query && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10.5px] text-ink-4">
            {filteredCount}개 일치
          </div>
        )}
      </div>

      {/* 도움 채널 */}
      <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
        <div className="text-[12px] font-semibold text-amber-900 mb-1.5 flex items-center gap-1.5">
          <Phone className="w-3.5 h-3.5" /> 막혔을 때 — 직접 문의 채널
        </div>
        <ul className="text-[11.5px] text-amber-900 space-y-0.5 ml-4 list-disc">
          <li>
            <strong>청약홈 콜센터 1644-7445</strong> — 청약 자격·서류·1순위 자동검증 전반
          </li>
          <li>
            <strong>국토교통부 1599-0001</strong> — 법령 해석·정책 변경
          </li>
          <li>
            <strong>SH공사 1600-3456</strong> / <strong>LH 1600-1004</strong> — 사업주체별 공급 안내
          </li>
          <li>
            <a
              href="https://www.applyhome.co.kr/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-900 underline inline-flex items-center gap-0.5"
            >
              청약홈(applyhome.co.kr) <ExternalLink className="w-3 h-3" />
            </a>
            {" "}— 공식 공고·전산 자료 발신처
          </li>
        </ul>
      </div>

      {/* 관련 페이지 바로가기 */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link
          href="/verification-criteria"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-soft hover:bg-surface2 text-accent text-[11px] font-medium"
        >
          ⚖ 서류 검증 기준 →
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-soft hover:bg-surface2 text-accent text-[11px] font-medium"
        >
          🏠 대시보드 →
        </Link>
        <Link
          href="/announcements"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-[11px] font-medium"
        >
          📋 모집공고 →
        </Link>
      </div>

      {/* 카테고리·용어 */}
      {filtered.length === 0 && (
        <div className="text-center py-12 text-ink-4 text-sm">
          「{query}」와(과) 일치하는 용어가 없습니다.
        </div>
      )}

      <div className="space-y-4">
        {filtered.map((cat) => {
          const Icon = cat.icon;
          return (
            <section key={cat.key} className={`rounded-lg border ${COLOR_CLASS[cat.color]} p-3`}>
              <div className="flex items-center gap-1.5 mb-2.5 pb-1.5 border-b border-current/10">
                <Icon className="w-4 h-4" />
                <h2 className="text-[13px] font-bold">{cat.label}</h2>
                <span className="text-[10.5px] opacity-70">({cat.terms.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {cat.terms.map((t, i) => (
                  <div
                    key={i}
                    className="rounded border border-border bg-surface p-2.5 text-ink-2"
                  >
                    <div className="flex items-baseline gap-1.5 flex-wrap mb-1">
                      <h3 className="text-[12.5px] font-bold text-ink">{t.term}</h3>
                      {t.aliases && t.aliases.length > 0 && (
                        <span className="text-[9.5px] text-ink-4">
                          ({t.aliases.join(", ")})
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] leading-snug">{t.short}</div>
                    {t.detail && (
                      <div className="text-[10.5px] text-ink-3 mt-1 leading-snug">
                        {t.detail}
                      </div>
                    )}
                    {t.example && (
                      <div className="text-[10.5px] mt-1 p-1.5 rounded bg-accent-soft border border-accent-line text-ink-2">
                        💡 예: {t.example}
                      </div>
                    )}
                    {t.reference && (
                      <div className="text-[9.5px] text-ink-4 mt-1">
                        📜 {t.reference}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
