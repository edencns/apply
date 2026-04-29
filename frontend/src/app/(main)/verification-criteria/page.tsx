"use client";

/**
 * 서류 검증 기준 — 선택한 공고에 적용되는 청약 무주택·자격 판정 룰 모음.
 *
 * 「주택공급에 관한 규칙」 표준 룰 + 공고별 특화 기준 (규제지역, 예치금 등)을
 * 한 화면에 정리. 시스템이 자동 검증하는 항목은 ✓ 자동검증 배지로 구분.
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

function Section({ title, children, defaultOpen = true }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
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

function RuleRow({
  label, value, autoVerified, hint,
}: { label: string; value: string; autoVerified?: boolean; hint?: string }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border-soft last:border-0">
      <div className="flex-shrink-0 w-1/3 text-xs font-semibold text-ink-2">{label}</div>
      <div className="flex-1 text-xs text-ink-2">
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

/** 공고의 시·도 추정 (지역별 예치금 표 어느 컬럼을 보여줄지) */
function inferRegion(ann: LocalAnnouncement | null): "수도권" | "강원" | "지방" {
  const text = `${ann?.title || ""} ${(ann as any)?.eligibility_rules?.region_full || ""}`;
  if (/서울|경기|인천/.test(text)) return "수도권";
  if (/강원/.test(text)) return "강원";
  return "지방";
}

/** 청약예금 예치금 — 표준 청약통장 예치금 기준 (단위 만원) */
const STANDARD_DEPOSIT_TABLE: Array<{ area: string; 강원: string; 수도권: string; 지방: string }> = [
  { area: "전용면적 85㎡ 이하", 강원: "200만원", 수도권: "300만원", 지방: "250만원" },
  { area: "전용면적 102㎡ 이하", 강원: "300만원", 수도권: "600만원", 지방: "400만원" },
  { area: "전용면적 135㎡ 이하", 강원: "400만원", 수도권: "1,000만원", 지방: "700만원" },
  { area: "모든 면적", 강원: "500만원", 수도권: "1,500만원", 지방: "1,000만원" },
];

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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 헤더 */}
      <div className="mb-5">
        <div className="text-[11px] text-ink-3 uppercase tracking-[0.6px] font-medium mb-1">
          서류 검증 기준
        </div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Scale className="w-6 h-6 text-accent" />
          청약 자격·무주택 판정 룰
        </h1>
        <p className="text-sm text-ink-3 mt-1.5">
          선택한 공고에 적용되는 「주택공급에 관한 규칙」 표준 룰 + 공고별 특화 기준.
          ✓ 자동검증 배지는 시스템이 자동 판정하는 항목입니다.
        </p>
      </div>

      {/* 공고 선택 */}
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
        <div className="space-y-4 mt-2">
          {/* 컨텍스트 안내 */}
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-start gap-2">
            <Scale className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">「{selected.title}」 적용 기준</div>
              <div className="mt-0.5 text-blue-800">
                규제지역 <strong>{regulation}</strong> · 추정 시·도 <strong>{region}</strong> · 청약통장 최소 가입 <strong>{minSubscription}개월</strong> · 해당지역 거주 <strong>{minRegion}개월</strong> 이상
              </div>
            </div>
          </div>

          {/* 1. 무주택 판정 */}
          <Section title="🏠 무주택 판정" defaultOpen>
            <div className="space-y-0">
              <RuleRow
                label="규제지역"
                value={regulation}
                autoVerified
                hint={
                  regulation === "투기과열" || regulation === "청약과열"
                    ? "1주택만 보유해도 부적격 (강화 규제)"
                    : "2주택 이상 보유 시 부적격, 1주택은 가점 감점만"
                }
              />
              <RuleRow
                label="무주택세대구성원"
                value="세대원 전원이 주택을 소유하지 않은 세대"
                hint="세대원: 신청자·배우자·직계존속(배우자 포함)·직계비속(배우자 포함). 같은 등본에 등재 필요"
              />
              <RuleRow
                label="소형·저가주택 예외"
                value="전용면적 60㎡ 이하 + 공시가격 1.6억 이하"
                autoVerified
                hint="조건 충족 시 무주택 인정. 공시가격 데이터 없으면 면적 기준만 만족 → 수동 검증 권장 경고"
              />
              <RuleRow
                label="상속 주택 예외"
                value="상속받은 후 6개월 이내"
                autoVerified
                hint="처분 약정서 확인 권장. 6개월 경과 시 일반 보유로 카운트"
              />
              <RuleRow
                label="일시적 2주택"
                value="2주택 보유 + 최근 취득 36개월(3년) 이내"
                autoVerified
                hint="입주자모집공고일까지 기존 주택 처분 약정 시 무주택 인정 가능 — 수동 확인"
              />
              <RuleRow
                label="분양권 보유"
                value="2018.12.11 이후 신규 계약·매수 시 주택 소유로 간주"
                hint="공급계약 체결일 기준. 매수는 매매신고일(잔금 완납일) 기준"
              />
              <RuleRow
                label="단독주택 합산"
                value="같은 사람의 단독주택은 주소가 여러 개여도 1주택"
                autoVerified
              />
              <RuleRow
                label="다가구주택 합산"
                value="호별 등기·여러 건물 모두 1주택"
                autoVerified
                hint="다가구주택은 단독주택의 한 종류 (건축법). 다세대주택·아파트는 호별로 별개 카운트"
              />
              <RuleRow
                label="매수·매도 페어"
                value="같은 주소의 매수·매도가 모두 있으면 보유 0건"
                autoVerified
              />
              <RuleRow
                label="비주거용 자동 제외"
                value="토지·임야·전·답·상가·사무실·공장·창고"
                autoVerified
              />
              <RuleRow
                label="소유권보존 건물 등기 제외"
                value="다가구주택의 건물 단위 소유권보존 등기는 호별 소유와 중복 → 자동 제외"
                autoVerified
              />
            </div>
          </Section>

          {/* 2. 청약통장 자격 */}
          <Section title="💳 청약통장 자격 (1·2순위)">
            <div className="space-y-0">
              <RuleRow
                label="1순위"
                value={`가입기간 ${minSubscription}개월 이상 + 지역별·면적별 예치금 이상 납입`}
                autoVerified
              />
              <RuleRow
                label="2순위"
                value="가입했으나 1순위 요건 미충족"
              />
              <RuleRow
                label="특별공급 (기관추천·다자녀·신혼부부)"
                value="6개월 이상 + 지역별·면적별 예치금"
                hint="기관추천 중 철거민·도시재생 부지제공자·장애인·국가유공자는 통장 불필요"
              />
              <RuleRow
                label="특별공급 (노부모부양·생애최초)"
                value="1순위 + 6개월 이상 + 지역별·면적별 예치금"
              />
            </div>

            {/* 예치금 표 */}
            <div className="mt-4 overflow-x-auto">
              <div className="text-xs font-semibold text-ink-2 mb-1.5">청약예금 예치금 — {region} 기준 강조</div>
              <table className="w-full text-xs border border-border rounded">
                <thead className="bg-surface2">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium text-ink-2 border-b border-border">전용면적</th>
                    <th className={`text-left px-2 py-1.5 font-medium border-b border-border ${region === "강원" ? "bg-blue-50 text-accent" : "text-ink-2"}`}>강원도/강릉시</th>
                    <th className={`text-left px-2 py-1.5 font-medium border-b border-border ${region === "수도권" ? "bg-blue-50 text-accent" : "text-ink-2"}`}>특별시·부산</th>
                    <th className={`text-left px-2 py-1.5 font-medium border-b border-border ${region === "지방" ? "bg-blue-50 text-accent" : "text-ink-2"}`}>그 밖의 광역시</th>
                  </tr>
                </thead>
                <tbody>
                  {STANDARD_DEPOSIT_TABLE.map((d, i) => (
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
          </Section>

          {/* 3. 거주 기간 */}
          <Section title="🏘️ 거주 기간 및 우선순위">
            <div className="space-y-0">
              <RuleRow
                label="해당지역 우선공급 1순위"
                value={`입주자모집공고일 기준 최근 ${minRegion}개월 이상 계속 거주`}
                autoVerified
                hint="해외 90일 초과 체류 시 거주 기간 인정 안 됨 (단, 90일 이내 단기 해외체류는 인정)"
              />
              <RuleRow
                label="해외 장기체류 (90일 초과)"
                value="해당 주택건설지역 우선공급 청약 불가"
                hint="위반 시 부적격 당첨자 처리. 출입국사실증명서로 자동 검증"
              />
              <RuleRow
                label="해외 거주 (연 183일 초과)"
                value="국내 거주자로 인정 안 됨 — 해당 주택건설지역 청약 불가"
              />
            </div>
          </Section>

          {/* 4. 특별공급 자격 요건 */}
          <Section title="❤️ 특별공급 자격 요건">
            <div className="space-y-0">
              <RuleRow
                label="기관추천·다자녀·신혼부부·생애최초"
                value="무주택세대구성원 전원"
                autoVerified
              />
              <RuleRow
                label="노부모부양"
                value="무주택세대주 (세대주 본인만)"
                autoVerified
                hint="세대주 요건 필수. 직계존속(부모)을 3년 이상 계속 부양"
              />
              <RuleRow
                label="1세대 1주택 1회 한정"
                value="특별공급은 평생 1세대 1회만 신청 가능"
                autoVerified
                hint="과거 특별공급 당첨 이력이 있는 자는 신청 불가 (예외: 미분양 등)"
              />
              <RuleRow
                label="중복 청약 금지"
                value="동일 세대원 2명 이상 신청 시 1명이라도 선정되면 부적격당첨자 처리"
              />
            </div>
          </Section>

          {/* 5. 다자녀 가점표 */}
          <Section title="👶 다자녀가구 특별공급 가점표 (총 100점)">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-border rounded">
                <thead className="bg-surface2">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium text-ink-2 border-b border-border">평점요소</th>
                    <th className="text-left px-2 py-1.5 font-medium text-ink-2 border-b border-border">기준</th>
                    <th className="text-right px-2 py-1.5 font-medium text-ink-2 border-b border-border">점수</th>
                  </tr>
                </thead>
                <tbody className="text-ink-2">
                  <tr className="border-t border-border-soft">
                    <td className="px-2 py-1.5" rowSpan={3}>미성년 자녀수 (40점)</td>
                    <td className="px-2 py-1.5">5명 이상</td>
                    <td className="px-2 py-1.5 text-right font-mono">40</td>
                  </tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">4명</td><td className="px-2 py-1.5 text-right font-mono">35</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">3명</td><td className="px-2 py-1.5 text-right font-mono">30</td></tr>
                  <tr className="border-t border-border-soft">
                    <td className="px-2 py-1.5" rowSpan={3}>영유아 자녀수 (15점)</td>
                    <td className="px-2 py-1.5">3명 이상</td>
                    <td className="px-2 py-1.5 text-right font-mono">15</td>
                  </tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">2명</td><td className="px-2 py-1.5 text-right font-mono">10</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">1명</td><td className="px-2 py-1.5 text-right font-mono">5</td></tr>
                  <tr className="border-t border-border-soft">
                    <td className="px-2 py-1.5" rowSpan={2}>세대구성 (5점)</td>
                    <td className="px-2 py-1.5">3세대 이상</td>
                    <td className="px-2 py-1.5 text-right font-mono">5</td>
                  </tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">한부모 가족</td><td className="px-2 py-1.5 text-right font-mono">5</td></tr>
                  <tr className="border-t border-border-soft">
                    <td className="px-2 py-1.5" rowSpan={3}>무주택기간 (20점)</td>
                    <td className="px-2 py-1.5">10년 이상</td>
                    <td className="px-2 py-1.5 text-right font-mono">20</td>
                  </tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">5년~10년</td><td className="px-2 py-1.5 text-right font-mono">15</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">1년~5년</td><td className="px-2 py-1.5 text-right font-mono">10</td></tr>
                  <tr className="border-t border-border-soft">
                    <td className="px-2 py-1.5" rowSpan={3}>해당 시·도 거주기간 (15점)</td>
                    <td className="px-2 py-1.5">10년 이상</td>
                    <td className="px-2 py-1.5 text-right font-mono">15</td>
                  </tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">5년~10년</td><td className="px-2 py-1.5 text-right font-mono">10</td></tr>
                  <tr className="border-t border-border-soft"><td className="px-2 py-1.5">1년~5년</td><td className="px-2 py-1.5 text-right font-mono">5</td></tr>
                  <tr className="border-t border-border-soft">
                    <td className="px-2 py-1.5">청약통장 가입기간 (5점)</td>
                    <td className="px-2 py-1.5">10년 이상</td>
                    <td className="px-2 py-1.5 text-right font-mono">5</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[10.5px] text-ink-4">
              동점자 처리: ① 미성년 자녀수 많은 자 → ② 신청자 연령(연월일 계산) 많은 자
            </div>
          </Section>

          {/* 6. 가점제 부양가족 */}
          <Section title="👨‍👩‍👧 가점제 부양가족 산정 (2018.12.11 시행)" defaultOpen={false}>
            <div className="space-y-0">
              <RuleRow
                label="직계존속 무주택 요건"
                value="신청자(또는 배우자) 직계존속이 주택(분양권 포함) 소유 시 부양가족에서 제외"
                hint="단, 미혼·만20세 미만 손자녀의 부모가 모두 사망한 경우는 한정 인정"
              />
              <RuleRow
                label="60세 이상 직계존속"
                value="청약 가점제에서는 부양가족으로 인정 (주택 소유 시 제외)"
                hint="무주택 인정 별도 — 직계존속이 60세 이상이고 본인 명의 주택 가지면 그 주택은 무주택 판정 시 제외"
              />
            </div>
          </Section>

          {/* 7. 시스템 자동 검증 정리 */}
          <Section title="✓ 시스템 자동 검증 항목 정리" defaultOpen={false}>
            <ul className="space-y-1.5 text-xs text-ink-2">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span>주택소유 검색결과 → <strong>매수·매도 페어 netting</strong>, <strong>다가구주택 1주택 합산</strong>, <strong>단독주택 1주택 합산</strong>, <strong>비주거용 제외</strong>, <strong>소유권보존 건물 단위 등기 제외</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>소형·저가주택 자동 예외</strong> (60㎡ + 1.6억 충족 시 무주택 인정)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>상속 주택 6개월 이내</strong> 자동 무주택 + 처분 약정 확인 경고</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span><strong>일시적 2주택 감지</strong> (최근 취득 ≤ 36개월) — 처분 약정 확인 권장 경고</span>
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
            </ul>
            <div className="mt-3 p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                자동 판정은 참고용입니다. 최종 적합·부적합은 담당자가 공고 원문과 법령을 직접 확인 후 결정하세요.
                정책 개정은 수시 발생 — 청약홈 공지(1644-7445)로 최신 기준 확인 필요.
              </span>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
