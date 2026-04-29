"use client";

/**
 * 서류 검증 기준 — 청약 무주택·자격 판정 룰 종합 정리.
 *
 * 「주택공급에 관한 규칙」 표준 룰 + 공고별 특화 기준.
 * 시스템이 자동 검증하는 항목은 ✓ 자동검증 배지.
 * 청약통장·일반공급·특별공급 7종·소득·자산·제한 사항 모두 포함.
 */

import { useEffect, useState } from "react";
import {
  localAnnouncements, isAnnouncementDone,
  LocalAnnouncement, onLocalStoreChange,
} from "@/lib/local-store";
import AnnouncementPicker from "@/components/AnnouncementPicker";
import {
  Scale, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
} from "lucide-react";

function Section({ title, children, defaultOpen = false }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 bg-surface2 hover:bg-surface2 transition-colors"
      >
        <span className="font-semibold text-ink text-sm">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-ink-4" /> : <ChevronDown className="w-4 h-4 text-ink-4" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="text-[12px] font-semibold text-ink mb-1.5 pb-1 border-b border-border-soft">
        {title}
      </div>
      <div className="space-y-0">{children}</div>
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

/** 공고의 시·도 추정 */
function inferRegion(ann: LocalAnnouncement | null): "수도권" | "강원" | "지방" {
  const text = `${ann?.title || ""} ${(ann as any)?.eligibility_rules?.region_full || ""}`;
  if (/서울|경기|인천/.test(text)) return "수도권";
  if (/강원/.test(text)) return "강원";
  return "지방";
}

/** 청약예금 예치금 표 */
const DEPOSIT_TABLE = [
  { area: "전용 85㎡ 이하", 강원: "200만원", 수도권: "300만원", 지방: "250만원" },
  { area: "전용 102㎡ 이하", 강원: "300만원", 수도권: "600만원", 지방: "400만원" },
  { area: "전용 135㎡ 이하", 강원: "400만원", 수도권: "1,000만원", 지방: "700만원" },
  { area: "모든 면적", 강원: "500만원", 수도권: "1,500만원", 지방: "1,000만원" },
];

/** 일반공급 가점제 84점 만점 항목 */
const GAJEOM_BREAKDOWN = [
  {
    factor: "무주택기간",
    max: 32,
    rows: [
      ["1년 미만", 2], ["1년 ~ 2년 미만", 4], ["2년 ~ 3년 미만", 6],
      ["...(1년당 2점씩 증가)...", 0],
      ["14년 ~ 15년 미만", 30], ["15년 이상", 32],
    ] as Array<[string, number]>,
    note: "만 30세 도달일 또는 혼인일 중 빠른 시점부터 산정. 보유 시 0년부터 재시작.",
  },
  {
    factor: "부양가족수",
    max: 35,
    rows: [
      ["0명 (본인)", 5], ["1명", 10], ["2명", 15],
      ["3명", 20], ["4명", 25], ["5명", 30], ["6명 이상", 35],
    ] as Array<[string, number]>,
    note: "세대주(본인) 제외 직계존속·직계비속 등. 직계존속은 3년 이상 등본 동일등재 + 무주택 필요.",
  },
  {
    factor: "청약통장 가입기간",
    max: 17,
    rows: [
      ["6개월 미만", 1], ["6개월 ~ 1년 미만", 2], ["1년 ~ 2년 미만", 3],
      ["...(2년당 1점씩 증가)...", 0],
      ["14년 ~ 15년 미만", 16], ["15년 이상", 17],
    ] as Array<[string, number]>,
    note: "신청자 본인 통장만 인정. 가입기간 = 통장 개설일부터 입주자모집공고일까지.",
  },
];

/** 도시근로자 월평균소득 (2024 기준 — 가구원수별, 100% 기준) */
const URBAN_INCOME_2024 = [
  { size: "3인 이하", base: 7_198_000 },
  { size: "4인",     base: 8_248_000 },
  { size: "5인",     base: 8_775_000 },
  { size: "6인",     base: 9_563_000 },
  { size: "7인",     base: 10_351_000 },
];

/** 입력 KRW → '7,200천원' 형태 */
function fmtKrw(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}
function pctOf(base: number, p: number): string {
  return fmtKrw(Math.round(base * p / 100));
}

export default function VerificationCriteriaPage() {
  const [announcements, setAnnouncements] = useState<LocalAnnouncement[]>([]);
  const [selected, setSelected] = useState<LocalAnnouncement | null>(null);

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

  const region = inferRegion(selected);
  const rules = selected?.eligibility_rules || {};
  const regulation = (rules.regulation as string) || "비규제";
  const minSubscription = rules.min_subscription_period || 6;
  const minRegion = rules.min_region_residence_months || 12;
  const isStrict = regulation === "투기과열" || regulation === "청약과열";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 헤더 */}
      <div className="mb-5">
        <div className="text-[11px] text-ink-3 uppercase tracking-[0.6px] font-medium mb-1">
          서류 검증 기준
        </div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Scale className="w-6 h-6 text-accent" />
          청약 자격·무주택 판정 종합
        </h1>
        <p className="text-sm text-ink-3 mt-1.5">
          「주택공급에 관한 규칙」 표준 + 공고별 특화. ✓ 자동검증 배지는 시스템이 자동 판정하는 항목입니다.
          금액 기준은 매년 변경되므로 청약홈(1644-7445)·해당 공고 원문에서 최신값 재확인 필요.
        </p>
      </div>

      <AnnouncementPicker
        announcements={announcements as any}
        selected={selected as any}
        onSelect={(a) => setSelected(a as any)}
      />

      {!selected ? (
        <div className="mt-6 p-8 text-center text-sm text-ink-3 border border-dashed border-border rounded-lg">
          공고를 선택해주세요. 등록된 공고가 없으면 좌측 「모집공고」에서 먼저 등록하세요.
        </div>
      ) : (
        <div className="space-y-3 mt-2">
          {/* 컨텍스트 */}
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-start gap-2">
            <Scale className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">「{selected.title}」 적용 컨텍스트</div>
              <div className="mt-0.5 text-blue-800">
                규제지역 <strong>{regulation}</strong> · 추정 시·도 <strong>{region}</strong> · 청약통장 최소 가입 <strong>{minSubscription}개월</strong> · 해당지역 거주 <strong>{minRegion}개월</strong> 이상
              </div>
            </div>
          </div>

          {/* 1. 청약통장 자격 */}
          <Section title="💳 청약통장 자격 (1·2순위)" defaultOpen>
            <Sub title="순위 결정">
              <RuleRow
                label="1순위"
                value={`가입기간 ${minSubscription}개월 이상 + 지역·면적별 예치금 이상 납입`}
                autoVerified
                hint={isStrict ? "투기과열·청약과열 지구는 가입기간 24개월 이상" : "비규제 지구 6~24개월"}
              />
              <RuleRow label="2순위" value="가입했으나 1순위 미충족" />
              <RuleRow
                label="특별공급 (기관추천·다자녀·신혼부부)"
                value="6개월 이상 + 지역·면적별 예치금"
                hint="기관추천 중 철거민·도시재생 부지제공자·장애인·국가유공자는 통장 불필요"
              />
              <RuleRow
                label="특별공급 (노부모부양·생애최초)"
                value="1순위 + 6개월 이상 + 예치금"
              />
            </Sub>
            <Sub title={`예치금 표 — ${region} 강조`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px] border border-border rounded">
                  <thead className="bg-surface2">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium text-ink-2 border-b border-border">전용면적</th>
                      <th className={`text-left px-2 py-1.5 font-medium border-b border-border ${region === "강원" ? "bg-blue-50 text-accent" : "text-ink-2"}`}>강원도</th>
                      <th className={`text-left px-2 py-1.5 font-medium border-b border-border ${region === "수도권" ? "bg-blue-50 text-accent" : "text-ink-2"}`}>특별시·부산</th>
                      <th className={`text-left px-2 py-1.5 font-medium border-b border-border ${region === "지방" ? "bg-blue-50 text-accent" : "text-ink-2"}`}>그 밖의 광역시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DEPOSIT_TABLE.map((d, i) => (
                      <tr key={i} className={i > 0 ? "border-t border-border-soft" : ""}>
                        <td className="px-2 py-1.5 text-ink-2">{d.area}</td>
                        <td className={`px-2 py-1.5 font-mono ${region === "강원" ? "text-ink font-bold" : "text-ink-2"}`}>{d.강원}</td>
                        <td className={`px-2 py-1.5 font-mono ${region === "수도권" ? "text-ink font-bold" : "text-ink-2"}`}>{d.수도권}</td>
                        <td className={`px-2 py-1.5 font-mono ${region === "지방" ? "text-ink font-bold" : "text-ink-2"}`}>{d.지방}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Sub>
          </Section>

          {/* 2. 무주택 판정 */}
          <Section title="🏠 무주택 판정" defaultOpen>
            <Sub title="기본 룰">
              <RuleRow
                label="규제지역"
                value={regulation}
                autoVerified
                hint={isStrict ? "1주택 보유만으로 부적격 (강화 규제)" : "2주택 이상 부적격, 1주택은 가점 감점만"}
              />
              <RuleRow
                label="무주택세대구성원"
                value="세대원 전원이 주택 미소유"
                hint="세대원: 신청자·배우자·직계존속(배우자 포함)·직계비속(배우자 포함). 같은 등본에 등재 필요"
              />
            </Sub>
            <Sub title="자동 적용 예외 룰">
              <RuleRow
                label="소형·저가주택 예외"
                value="60㎡ 이하 + 공시가격 1.6억 이하 → 무주택 인정"
                autoVerified
              />
              <RuleRow
                label="상속 주택 예외"
                value="상속일로부터 6개월 이내 무주택 인정"
                autoVerified
                hint="처분 약정서 확인 권장. 6개월 경과 시 일반 보유로 카운트"
              />
              <RuleRow
                label="일시적 2주택"
                value="2주택 + 최근 취득 36개월 이내 → 일시적 2주택 가능"
                autoVerified
                hint="입주자모집공고일까지 기존 주택 처분 약정 시 무주택 인정"
              />
              <RuleRow
                label="단독주택 합산"
                value="같은 사람의 단독주택 모두 1주택"
                autoVerified
              />
              <RuleRow
                label="다가구주택 합산"
                value="호별 등기·여러 건물 모두 1주택"
                autoVerified
                hint="다세대주택·아파트는 호별 별개"
              />
              <RuleRow
                label="매수·매도 페어"
                value="같은 주소의 매수·매도 모두 있으면 보유 0건"
                autoVerified
              />
              <RuleRow
                label="비주거용 자동 제외"
                value="토지·임야·전·답·상가·사무실·공장·창고"
                autoVerified
              />
              <RuleRow
                label="소유권보존 건물 등기"
                value="다가구주택 건물 단위 등기는 호별 소유와 중복 → 자동 제외"
                autoVerified
              />
            </Sub>
            <Sub title="수동 확인 항목">
              <RuleRow
                label="분양권 보유"
                value="2018.12.11 이후 신규 계약·매수 → 주택 소유로 간주"
                hint="공급계약 체결일 기준. 매수는 매매신고일(잔금 완납일) 기준"
              />
              <RuleRow
                label="60세 이상 직계존속 주택"
                value="직계존속 60세 이상 본인 명의 주택은 무주택 판정 시 제외"
                hint="가점제 부양가족 산정에서는 제외 (주택 소유 시)"
              />
              <RuleRow
                label="오피스텔"
                value="주거용 사용 시 1주택, 업무용은 무주택"
                hint="실사용 형태 + 주민등록 등재 여부로 판단"
              />
            </Sub>
          </Section>

          {/* 3. 일반공급 — 가점제 vs 추첨제 */}
          <Section title="🎯 일반공급 — 가점제 vs 추첨제" defaultOpen>
            <Sub title="비율 결정 (전용면적 + 규제지역)">
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px] border border-border rounded">
                  <thead className="bg-surface2">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium border-b border-border">구분</th>
                      <th className="text-left px-2 py-1.5 font-medium border-b border-border">전용 85㎡ 이하</th>
                      <th className="text-left px-2 py-1.5 font-medium border-b border-border">전용 85㎡ 초과</th>
                    </tr>
                  </thead>
                  <tbody className="text-ink-2">
                    <tr className="border-t border-border-soft">
                      <td className="px-2 py-1.5 font-semibold">투기과열지구</td>
                      <td className="px-2 py-1.5">가점 40% / 추첨 60%</td>
                      <td className="px-2 py-1.5">가점 70% / 추첨 30%</td>
                    </tr>
                    <tr className="border-t border-border-soft">
                      <td className="px-2 py-1.5 font-semibold">청약과열지구</td>
                      <td className="px-2 py-1.5">가점 40% / 추첨 60%</td>
                      <td className="px-2 py-1.5">가점 30% / 추첨 70%</td>
                    </tr>
                    <tr className="border-t border-border-soft">
                      <td className="px-2 py-1.5 font-semibold">수도권 비규제</td>
                      <td className="px-2 py-1.5">가점 40% / 추첨 60%</td>
                      <td className="px-2 py-1.5">추첨 100%</td>
                    </tr>
                    <tr className="border-t border-border-soft">
                      <td className="px-2 py-1.5 font-semibold">지방 광역시 비규제</td>
                      <td className="px-2 py-1.5">가점 40% / 추첨 60%</td>
                      <td className="px-2 py-1.5">추첨 100%</td>
                    </tr>
                    <tr className="border-t border-border-soft">
                      <td className="px-2 py-1.5 font-semibold">지방 그 외 (강원 등)</td>
                      <td className="px-2 py-1.5">추첨 100% (사업 주체 선택)</td>
                      <td className="px-2 py-1.5">추첨 100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-1.5 text-[10.5px] text-ink-4">
                국민주택(공공)은 85㎡ 이하만 공급, 가점제 100%. 위 표는 민영주택 기준.
              </div>
            </Sub>
            <Sub title="추첨제 내 무주택 우선">
              <RuleRow
                label="추첨제 75%"
                value="무주택 세대주에게 우선 배정"
                autoVerified
              />
              <RuleRow
                label="추첨제 25%"
                value="1주택자(기존 주택 처분 약정자) + 추첨에서 미당첨 무주택자"
              />
            </Sub>
          </Section>

          {/* 4. 일반공급 가점제 — 84점 만점 상세 */}
          <Section title="📊 일반공급 가점제 — 84점 만점 상세">
            <div className="grid sm:grid-cols-3 gap-3">
              {GAJEOM_BREAKDOWN.map((g, i) => (
                <div key={i} className="border border-border rounded-md p-2.5">
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-[12px] font-semibold text-ink">{g.factor}</span>
                    <span className="text-[10px] text-ink-4">최대 {g.max}점</span>
                  </div>
                  <table className="w-full text-[10.5px]">
                    <tbody>
                      {g.rows.map(([label, score], j) => (
                        <tr key={j} className={j > 0 ? "border-t border-border-soft" : ""}>
                          <td className="py-0.5 text-ink-2">{label}</td>
                          <td className="py-0.5 text-right font-mono text-ink">{score || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-1.5 text-[10px] text-ink-4 leading-tight">{g.note}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[11px] text-ink-3">
              총점 = 무주택기간(32) + 부양가족수(35) + 통장가입기간(17) = <strong className="text-ink">최대 84점</strong>
            </div>
          </Section>

          {/* 5. 특별공급 — 7유형 */}
          <Section title="❤️ 특별공급 — 유형별 자격" defaultOpen>
            <Sub title="공통 룰">
              <RuleRow
                label="1세대 1주택 1회 한정"
                value="평생 1세대 1회만 신청 가능"
                autoVerified
                hint="과거 특별공급 당첨 이력자 신청 불가 (예외: 미분양 등)"
              />
              <RuleRow
                label="중복 청약 금지"
                value="동일 세대원 2명 이상 신청 시 1명이라도 선정되면 부적격당첨자 처리"
              />
              <RuleRow
                label="해당지역 우선"
                value="해당지역 거주자에게 우선 공급, 잔여분 기타지역"
                hint="강릉시 6개월 거주 등 공고에 명시된 기간 충족 필요"
              />
            </Sub>

            <Sub title="① 기관추천 특별공급">
              <RuleRow label="자격" value="기관 추천 + 무주택세대구성원 + 청약통장(일부 면제)" />
              <RuleRow
                label="추천 기관 예시"
                value="군인(국군복지단), 장애인(시·도 경로장애인과), 국가유공자(보훈지청), 중소기업 근로자 등"
              />
              <RuleRow label="공급 비율" value="전용 85㎡ 이하 공급세대수의 10% 범위" />
              <RuleRow label="당첨자 선정" value="기관 자체 우선순위 → 사업주체 통보 → 인터넷 청약 신청" />
            </Sub>

            <Sub title="② 다자녀가구 특별공급">
              <RuleRow
                label="자격"
                value="만19세 미만 자녀 3명 이상(태아·입양 포함) + 무주택세대구성원"
                autoVerified
              />
              <RuleRow label="공급 비율" value="공급세대수의 10% 범위" />
              <RuleRow
                label="소득 기준"
                value="도시근로자 월평균소득 120% 이하 (공공주택 한정)"
                hint="민영주택 다자녀는 소득 기준 없음 (공고 확인)"
              />
              <RuleRow label="당첨자 선정" value="가점표 100점 만점 → 동점 시 미성년자녀수, 신청자 연령 순" />
            </Sub>

            <Sub title="③ 신혼부부 특별공급">
              <RuleRow
                label="자격"
                value="혼인 7년 이내 + 무주택세대구성원 (예비신혼 포함)"
                autoVerified
                hint="만 30세 이전 혼인 인정 등 무주택기간 산정 시 빠른 시점부터"
              />
              <RuleRow label="공급 비율" value="공급세대수의 18% 범위" />
              <RuleRow
                label="소득 기준 (공공주택)"
                value="우선 70% / 일반 100% / 추첨 140% (외벌이 기준)"
                hint="맞벌이는 +20%p (우선 80% / 일반 120% / 추첨 160%)"
              />
              <RuleRow
                label="우선순위"
                value="1순위: 자녀 있음 → 2순위: 자녀 없음"
                hint="자녀수 + 거주기간 + 통장가입기간 + 소득기준 등 종합"
              />
            </Sub>

            <Sub title="④ 노부모부양 특별공급">
              <RuleRow
                label="자격"
                value="무주택세대주 + 만 65세 이상 직계존속 3년 이상 부양"
                autoVerified
                hint="세대주 요건 필수 (세대원 X)"
              />
              <RuleRow label="공급 비율" value="공급세대수의 3% 범위" />
              <RuleRow label="가점" value="일반공급 가점제(84점) 그대로 적용 + 거주기간·소득 등" />
            </Sub>

            <Sub title="⑤ 생애최초 특별공급">
              <RuleRow
                label="자격"
                value="생애 최초 주택 구입 + 무주택세대구성원 + 5년 이상 소득세 납부"
                autoVerified
                hint="혼인 또는 미혼 자녀 있는 자만 신청 가능 (단독세대 X)"
              />
              <RuleRow label="공급 비율" value="공공주택 25% / 민영주택 9% (전용 85㎡ 이하)" />
              <RuleRow
                label="소득 기준"
                value="우선 100% / 일반 130% / 추첨 160%"
                hint="자산 기준도 적용 (공공)"
              />
              <RuleRow
                label="추첨"
                value="우선·일반 미달 시 추첨으로 결정"
                hint="가점제 없음 — 자격 충족 시 추첨"
              />
            </Sub>

            <Sub title="⑥ 신생아 특별공급 (2024.3 신설)">
              <RuleRow
                label="자격"
                value="입주자모집공고일 기준 2년 이내 임신·출산 가구 + 무주택세대구성원"
                hint="혼인 무관 (미혼·이혼 포함). 입양 포함."
              />
              <RuleRow
                label="공급 비율"
                value="민영주택 신혼부부 특별공급 물량의 20% / 공공주택 별도 비율"
              />
              <RuleRow
                label="소득 기준"
                value="우선 100% / 일반 150% / 추첨 200% (외벌이) — 맞벌이 +20%p"
                hint="기존 신혼부부보다 완화 — 출산 장려책"
              />
            </Sub>

            <Sub title="⑦ 청년 특별공급 (공공주택)">
              <RuleRow
                label="자격"
                value="만 19세 ~ 39세 미혼 + 무주택 + 부모(직계존속) 무주택"
              />
              <RuleRow label="소득 기준" value="본인 월평균소득 140% 이하 (1인 가구 기준)" />
              <RuleRow
                label="자산 기준"
                value="본인 자산 2.83억원 이하 (2024 기준)"
                hint="자동차·부동산·금융자산 합산"
              />
            </Sub>
          </Section>

          {/* 6. 소득 기준 */}
          <Section title="💰 소득 기준 — 도시근로자 월평균소득 (2024 기준)">
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] border border-border rounded">
                <thead className="bg-surface2">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium border-b border-border">가구원수</th>
                    <th className="text-right px-2 py-1.5 font-medium border-b border-border">100% (기준)</th>
                    <th className="text-right px-2 py-1.5 font-medium border-b border-border">120%</th>
                    <th className="text-right px-2 py-1.5 font-medium border-b border-border">130%</th>
                    <th className="text-right px-2 py-1.5 font-medium border-b border-border">140%</th>
                    <th className="text-right px-2 py-1.5 font-medium border-b border-border">160%</th>
                  </tr>
                </thead>
                <tbody className="text-ink-2">
                  {URBAN_INCOME_2024.map((r, i) => (
                    <tr key={i} className={i > 0 ? "border-t border-border-soft" : ""}>
                      <td className="px-2 py-1.5 font-semibold">{r.size}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtKrw(r.base)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{pctOf(r.base, 120)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{pctOf(r.base, 130)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{pctOf(r.base, 140)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{pctOf(r.base, 160)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 space-y-0.5 text-[10.5px] text-ink-3">
              <div>• <strong>가구원수</strong>: 신청자 + 배우자 + 직계존속·직계비속(같은 등본) 합산</div>
              <div>• 매년 1월 갱신 — 위 수치는 2024년 기준 참고값. 청약홈에서 최신 표 확인 필수</div>
              <div>• 신혼부부 일반: 100% (외벌이) / 120% (맞벌이) — 우선공급은 70%/80% 이하</div>
              <div>• 생애최초 일반: 130% / 우선 100% / 추첨 160%</div>
              <div>• 신생아 특공: 일반 150% / 우선 100% / 추첨 200%</div>
            </div>
          </Section>

          {/* 7. 자산 기준 */}
          <Section title="🏦 자산 기준 (공공주택 한정)">
            <Sub title="2024년 기준">
              <RuleRow
                label="부동산 (토지·건물)"
                value="2억 1,500만원 이하"
                hint="공시지가·공시가격 기준. 신청자·배우자·직계존속·직계비속 합산 (같은 등본)"
              />
              <RuleRow
                label="자동차"
                value="3,683만원 이하"
                hint="기준가액. 장애인 차량 등 일부 제외"
              />
            </Sub>
            <Sub title="민영주택">
              <RuleRow
                label="자산 기준"
                value="추첨제 25% (1주택자 등) 한정 적용 — 가구 자산 약 3.31억원 이하 (2024)"
                hint="투기과열·청약과열 지구 추첨제만 — 비규제는 자산 기준 없음"
              />
            </Sub>
          </Section>

          {/* 8. 거주 기간 / 우선공급 */}
          <Section title="🏘️ 거주 기간·해외체류 룰">
            <RuleRow
              label="해당지역 우선공급 1순위"
              value={`최근 ${minRegion}개월 이상 계속 거주`}
              autoVerified
              hint="해외 90일 초과 체류 시 거주 기간 인정 안 됨"
            />
            <RuleRow
              label="해외 장기체류 (90일 초과)"
              value="해당 주택건설지역 우선공급 청약 불가"
              hint="입국 후 7일 내 동일국가 재출국 시 계속 해외체류로 간주"
            />
            <RuleRow
              label="해외 거주 (연 183일 초과)"
              value="국내 거주자 인정 안 됨 — 해당 주택건설지역 청약 불가"
            />
            <RuleRow
              label="단기 해외체류 예외"
              value="90일 이내 여행·출장·파견·치료·취재"
              hint="국내 거주자로 간주 → 해당 주택건설지역 우선공급 청약 가능"
            />
          </Section>

          {/* 9. 전매제한·재당첨·거주의무 */}
          <Section title="🚫 전매제한·재당첨·거주의무">
            <Sub title="전매제한 기간">
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px] border border-border rounded">
                  <thead className="bg-surface2">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium border-b border-border">구분</th>
                      <th className="text-left px-2 py-1.5 font-medium border-b border-border">기간</th>
                    </tr>
                  </thead>
                  <tbody className="text-ink-2">
                    <tr className="border-t border-border-soft">
                      <td className="px-2 py-1.5">투기과열지구</td>
                      <td className="px-2 py-1.5">5~10년 (분양가 인근시세 비율에 따라)</td>
                    </tr>
                    <tr className="border-t border-border-soft">
                      <td className="px-2 py-1.5">조정대상지역</td>
                      <td className="px-2 py-1.5">3년</td>
                    </tr>
                    <tr className="border-t border-border-soft">
                      <td className="px-2 py-1.5">수도권 비규제</td>
                      <td className="px-2 py-1.5">1년</td>
                    </tr>
                    <tr className="border-t border-border-soft">
                      <td className="px-2 py-1.5">지방 광역시 비규제</td>
                      <td className="px-2 py-1.5">6개월</td>
                    </tr>
                    <tr className="border-t border-border-soft">
                      <td className="px-2 py-1.5">지방 그 외</td>
                      <td className="px-2 py-1.5">없음</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-1.5 text-[10.5px] text-ink-4">
                공공택지 분양가상한제 적용 시 전매제한 별도 가산
              </div>
            </Sub>
            <Sub title="재당첨 제한">
              <RuleRow
                label="투기과열·청약과열 당첨자"
                value="당첨일로부터 10년 (전용 85㎡ 이하) / 7년 (85㎡ 초과)"
              />
              <RuleRow
                label="기타 (특별공급 등)"
                value="당첨일로부터 5년"
                hint="동일 세대원 모두 적용 — 한 사람 당첨되면 세대 전원 5년 제한"
              />
            </Sub>
            <Sub title="거주의무">
              <RuleRow
                label="공공택지 분양가상한제"
                value="3~5년 거주 의무"
                hint="분양가 인근시세 비율: 80% 이하 5년 / 80~100% 3년"
              />
              <RuleRow
                label="민간택지 분양가상한제"
                value="2~3년 거주 의무"
              />
              <RuleRow
                label="위반 시"
                value="LH 등에 환매 + 향후 청약 자격 제한"
              />
            </Sub>
          </Section>

          {/* 10. 부적격 당첨자 처리 */}
          <Section title="⚠️ 부적격 당첨자 처리">
            <RuleRow
              label="부적격 사유 예시"
              value="무주택·자격·소득·자산 등 허위 신고 / 중복 청약 / 1세대 1주택 위반"
            />
            <RuleRow
              label="처리"
              value="당첨 취소 + 1년간 모든 청약 신청 제한"
              hint="고의·과실 무관. 신고 자료와 실제 자격 불일치만으로 부적격"
            />
            <RuleRow
              label="서류 미제출"
              value="입주자모집공고일에 명시된 기간 내 서류 미제출 시 부적격"
              autoVerified
              hint="시스템이 5단계 서류 판정에서 미제출자 자동 표시"
            />
            <RuleRow
              label="경쟁률 산정 시 영향"
              value="부적격당첨자 처리되어도 그 자리는 예비입주자가 승계"
              autoVerified
            />
          </Section>

          {/* 11. 가점제 부양가족 */}
          <Section title="👨‍👩‍👧 가점제 부양가족 산정 (2018.12.11 시행)">
            <RuleRow
              label="직계존속 부양가족 인정"
              value="3년 이상 등본 동일등재 + 무주택"
              hint="배우자의 직계존속 포함. 미혼 자녀의 부모 사망 시 손자녀의 부모 인정"
            />
            <RuleRow
              label="직계존속 무주택 요건"
              value="신청자(또는 배우자) 직계존속이 주택(분양권 포함) 소유 시 부양가족 제외"
              hint="단, 미혼·만20세 미만 손자녀의 부모가 모두 사망한 경우는 한정 인정"
            />
            <RuleRow
              label="60세 이상 직계존속"
              value="가점제 부양가족으로 인정 (주택 소유 시 제외)"
              hint="단, 그 직계존속이 60세 이상이고 본인 명의 주택 가지면 무주택 판정 시 제외 (별도 룰)"
            />
            <RuleRow
              label="자녀 (직계비속)"
              value="만19세 미만 미혼 자녀 + 등본 동일등재"
              hint="만19세 이상도 미혼이면 부양가족 인정 가능 (등본 등재 + 무주택)"
            />
          </Section>

          {/* 12. 다자녀 가점표 */}
          <Section title="👶 다자녀가구 특별공급 가점표 (총 100점)">
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] border border-border rounded">
                <thead className="bg-surface2">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium border-b border-border">평점요소</th>
                    <th className="text-left px-2 py-1.5 font-medium border-b border-border">기준</th>
                    <th className="text-right px-2 py-1.5 font-medium border-b border-border">점수</th>
                  </tr>
                </thead>
                <tbody className="text-ink-2">
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5" rowSpan={3}>미성년 자녀수 (40점)</td><td className="px-2 py-1.5">5명 이상</td><td className="px-2 py-1.5 text-right font-mono">40</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">4명</td><td className="px-2 py-1.5 text-right font-mono">35</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">3명</td><td className="px-2 py-1.5 text-right font-mono">30</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5" rowSpan={3}>영유아 자녀수 (15점)</td><td className="px-2 py-1.5">3명 이상</td><td className="px-2 py-1.5 text-right font-mono">15</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">2명</td><td className="px-2 py-1.5 text-right font-mono">10</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">1명</td><td className="px-2 py-1.5 text-right font-mono">5</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5" rowSpan={2}>세대구성 (5점)</td><td className="px-2 py-1.5">3세대 이상</td><td className="px-2 py-1.5 text-right font-mono">5</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">한부모 가족</td><td className="px-2 py-1.5 text-right font-mono">5</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5" rowSpan={3}>무주택기간 (20점)</td><td className="px-2 py-1.5">10년 이상</td><td className="px-2 py-1.5 text-right font-mono">20</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">5년~10년</td><td className="px-2 py-1.5 text-right font-mono">15</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">1년~5년</td><td className="px-2 py-1.5 text-right font-mono">10</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5" rowSpan={3}>해당 시·도 거주기간 (15점)</td><td className="px-2 py-1.5">10년 이상</td><td className="px-2 py-1.5 text-right font-mono">15</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">5년~10년</td><td className="px-2 py-1.5 text-right font-mono">10</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">1년~5년</td><td className="px-2 py-1.5 text-right font-mono">5</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">청약통장 가입기간 (5점)</td><td className="px-2 py-1.5">10년 이상</td><td className="px-2 py-1.5 text-right font-mono">5</td></tr>
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[10.5px] text-ink-4">
              동점자: ① 미성년 자녀수 → ② 신청자 연령(연월일 계산)
            </div>
          </Section>

          {/* 13. 시스템 자동 검증 정리 */}
          <Section title="✓ 시스템 자동 검증 항목 정리">
            <ul className="space-y-1 text-[11.5px] text-ink-2">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>주택소유 검색결과 분석</strong> — 매수·매도 페어 netting / 다가구주택 1주택 합산 / 단독주택 1주택 합산 / 비주거용 제외 / 소유권보존 건물 등기 제외</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>소형·저가주택 자동 예외</strong> (60㎡ + 1.6억 이하 충족 시 무주택 인정)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>상속 6개월 이내 무주택</strong> + 처분 약정 확인 경고</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>일시적 2주택 감지</strong> (최근 취득 ≤ 36개월) — 처분 약정 확인 권장</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>무주택 기간 자동계산</strong> (만 30세 또는 혼인일 중 빠른 시점부터) + 신고값 검증</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>청약통장 가입기간·예치금</strong> 자동 검증</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>해외 90일 초과 체류</strong> (출입국사실증명서) 검토 포인트 자동 표시</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>특별공급 1세대 1회</strong> 위반 / 중복 청약 자동 감지 (Phase #3 교차검증)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>서류 제출 기한·미제출자</strong> 자동 표시 (5단계 서류 판정)</span>
              </li>
            </ul>
            <div className="mt-3 p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                자동 판정은 참고용입니다. 최종 적합·부적합은 담당자가 공고 원문과 법령을 직접 확인 후 결정하세요.
                금액 기준(소득·자산)·정책은 매년 변경되므로 청약홈(1644-7445) 최신 안내 필수 확인.
              </span>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
