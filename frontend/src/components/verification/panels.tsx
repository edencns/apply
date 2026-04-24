"use client";

/**
 * 검증 단계별 패널 모음 (customer detail 워크스페이스에서 Stage 2~4 렌더링에 사용)
 * - 세대원 / 주택소유 / 청약통장 각각 분리된 컴포넌트
 * - 판정 결과(StageVerdict)를 카드 헤더에 뱃지로 표시
 */

import type { LocalCustomer } from "@/lib/local-store";
import type { StageVerdict } from "@/lib/verification-rules";
import { isResidentialUse } from "@/lib/verification-rules";
import { Users, Home, Banknote, AlertTriangle, CheckCircle2, XCircle, Circle } from "lucide-react";

function VerdictBadge({ verdict }: { verdict: StageVerdict }) {
  if (verdict.missing) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-surface2 text-ink-2">
        <Circle className="w-3 h-3" /> 데이터 없음
      </span>
    );
  }
  if (verdict.ok && verdict.warnings.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
        <AlertTriangle className="w-3 h-3" /> 경고 포함 통과
      </span>
    );
  }
  if (verdict.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
        <CheckCircle2 className="w-3 h-3" /> 통과
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
      <XCircle className="w-3 h-3" /> 부적합
    </span>
  );
}

function VerdictBox({ verdict }: { verdict: StageVerdict }) {
  if (verdict.reasons.length === 0 && verdict.warnings.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5">
      {verdict.reasons.map((r, i) => (
        <div key={`r${i}`} className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{r}</span>
        </div>
      ))}
      {verdict.warnings.map((w, i) => (
        <div key={`w${i}`} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── 세대원 패널 ─────────────────────────────────── */

export function HouseholdPanel({
  customer,
  verdict,
}: {
  customer: LocalCustomer;
  verdict: StageVerdict;
}) {
  const members = customer.household_members || [];

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Users className="w-4 h-4 text-amber-600" />
        <h2 className="font-semibold text-ink">세대원 확인</h2>
        <VerdictBadge verdict={verdict} />
      </div>

      {verdict.missing ? (
        <EmptyState
          hint="세대원 확인이 완료되면 주민번호가 파일로 제공됩니다."
          action='고객 관리 > "파일 일괄 분석" 에서 당첨자세대원내역.xlsx 업로드'
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-ink-3">
              <th className="text-left py-1.5 font-medium">성명</th>
              <th className="text-left py-1.5 font-medium">주민번호</th>
              <th className="text-left py-1.5 font-medium">비고</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m, i) => (
              <tr key={i} className={`border-b border-gray-50 ${m.errorCode ? "bg-red-50/50" : ""}`}>
                <td className="py-2 font-medium">{m.name}</td>
                <td className="py-2 font-mono text-xs text-ink-2">
                  {m.rrn ? `${m.rrn.slice(0, 6)}-${m.rrn.slice(6, 7)}••••••` : "—"}
                </td>
                <td className="py-2">
                  {m.errorCode ? (
                    <span className="text-[11px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                      오류 {m.errorCode}
                    </span>
                  ) : (
                    <span className="text-[11px] text-ink-4">정상</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <VerdictBox verdict={verdict} />
    </div>
  );
}

/* ─── 주택소유 패널 ───────────────────────────────── */

export function PropertyPanel({
  customer,
  verdict,
  regulation,
}: {
  customer: LocalCustomer;
  verdict: StageVerdict;
  regulation?: string;
}) {
  const properties = customer.properties || [];

  // 소유자별 그룹핑
  const byOwner: Record<string, typeof properties> = {};
  for (const p of properties) {
    const key = `${p.ownerName}|${p.ownerRrn}`;
    if (!byOwner[key]) byOwner[key] = [];
    byOwner[key].push(p);
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Home className="w-4 h-4 text-orange-600" />
        <h2 className="font-semibold text-ink">주택소유 전산검색</h2>
        <VerdictBadge verdict={verdict} />
        {regulation && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
            공고 규제: {regulation}
          </span>
        )}
      </div>

      {verdict.missing ? (
        <EmptyState
          hint="주택소유 전산검색 결과가 있으면 세대 주택 보유 여부가 자동 판정됩니다."
          action='고객 관리 > "파일 일괄 분석" 에서 주택소유정보전산검색결과.xlsx 업로드'
        />
      ) : (
        <div className="space-y-3">
          {Object.entries(byOwner).map(([key, owned]) => {
            const [name] = key.split("|");
            return (
              <div key={key} className="border border-border rounded-lg p-3">
                <div className="text-sm font-medium text-ink-2 mb-2">{name}</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border-soft text-ink-3">
                      <th className="text-left py-1 font-normal">주소</th>
                      <th className="text-right py-1 font-normal">면적</th>
                      <th className="text-left py-1 font-normal pl-2">용도</th>
                      <th className="text-left py-1 font-normal pl-2">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {owned.map((p, i) => {
                      const isCurrent = !p.transferredDate;
                      const isRes = isResidentialUse(p.usage);
                      const statusCls = !isCurrent
                        ? "text-ink-4"
                        : isRes
                          ? "text-amber-700 font-medium"
                          : "text-ink-3";
                      const statusLabel = !isCurrent
                        ? `양도 (${p.transferredDate})`
                        : isRes
                          ? "현재 보유"
                          : "비주거";
                      return (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="py-1.5 text-ink-2 truncate max-w-xs" title={p.address}>
                            {p.address}
                          </td>
                          <td className="py-1.5 text-right text-ink-2">
                            {p.areaM2 ? `${p.areaM2}㎡` : "—"}
                          </td>
                          <td className="py-1.5 pl-2 text-ink-2">{p.usage || "—"}</td>
                          <td className={`py-1.5 pl-2 ${statusCls}`}>{statusLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 분리세대 주택소유 섹션 ── */}
      {((customer.separated_household_members || []).length > 0 || (customer.separated_properties || []).length > 0) && (
        <div className="mt-4 pt-4 border-t border-border-soft">
          <div className="flex items-center gap-2 mb-2">
            <Home className="w-3.5 h-3.5 text-amber-600" />
            <h3 className="text-sm font-semibold text-ink-2">분리세대원 주택소유</h3>
            {customer.separated_property_checked_at ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                ✓ 청약홈 회신 확인됨
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                ⚠ PDF 미업로드
              </span>
            )}
          </div>

          {/* 분리세대원 목록 */}
          {(customer.separated_household_members || []).length > 0 && (
            <div className="mb-2 text-xs text-ink-2">
              <span className="text-ink-3">등록된 분리세대원: </span>
              {(customer.separated_household_members || []).map((m, i) => (
                <span key={i} className="inline-block mr-2 mb-1 px-2 py-0.5 rounded bg-surface2">
                  {m.name} <span className="text-ink-3">({m.relation})</span>
                </span>
              ))}
            </div>
          )}

          {/* 분리세대 주택 목록 */}
          {(customer.separated_properties || []).length > 0 ? (
            <div className="space-y-1.5">
              {(customer.separated_properties || []).map((p, i) => {
                const isSpouse = /배우자/.test(p.relation || "");
                return (
                  <div
                    key={i}
                    className={`text-xs p-2 rounded border ${
                      isSpouse ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-medium text-ink-2">{p.ownerName}</span>
                      {p.relation && (
                        <span className={`text-[10px] px-1 py-0 rounded ${
                          isSpouse ? "bg-red-200 text-red-900" : "bg-gray-200 text-ink-3"
                        }`}>
                          {p.relation}
                        </span>
                      )}
                      {isSpouse && (
                        <span className="text-[10px] text-red-700 font-semibold">
                          → 본인 판정에 합산
                        </span>
                      )}
                    </div>
                    <div className="text-ink-3">
                      {p.address} · {p.usage || "—"} · {p.areaM2 ? `${p.areaM2}㎡` : ""}
                      {p.transferredDate && <span className="ml-1">(양도 {p.transferredDate})</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : customer.separated_property_checked_at ? (
            <div className="text-xs text-ink-3 italic py-1">
              회신 결과 분리세대원의 주택 보유 없음 ✓
            </div>
          ) : (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              💡 <strong>주택소유 단계에서 "분리세대 회신" 업로드 필요</strong> — 청약홈에 분리세대 전산검색을 요청해 받은 회신 파일(엑셀 또는 PDF)을 업로드하면 자동으로 주택소유 내역이 추출·합산됩니다.
            </div>
          )}
        </div>
      )}

      <VerdictBox verdict={verdict} />

      <p className="text-[11px] text-ink-3 mt-3">
        * 판정 기준: 현재 보유 + 주거용만 카운트. 공고가 <strong>투기과열/청약과열</strong>이면 1건도 불가, 그 외 지역은 2주택부터 부적격.
        <strong className="ml-1">배우자 분리세대</strong>의 주택은 본인 세대에 합산, 그 외 분리세대(자녀·부모 등)는 경고만 표시.
      </p>
    </div>
  );
}

/* ─── 청약통장 패널 ───────────────────────────────── */

export function SavingsPanel({
  customer,
  verdict,
  minSubscriptionMonths,
}: {
  customer: LocalCustomer;
  verdict: StageVerdict;
  minSubscriptionMonths?: number;
}) {
  const savings = customer.savings_priority;

  // 은행코드 매핑
  const BANK_MAP: Record<string, string> = {
    "003": "기업", "004": "국민", "007": "수협", "011": "농협", "020": "우리",
    "023": "SC", "027": "씨티", "031": "아이엠뱅크", "032": "부산", "034": "광주",
    "035": "제주", "037": "전북", "039": "경남", "081": "KEB하나", "088": "신한",
  };
  const bankName = savings?.bankCode ? (BANK_MAP[savings.bankCode] || savings.bankCode) : "—";

  const errorHint =
    savings?.resultLength === 63
      ? "은행코드 또는 신청구분 오류 — 은행 재조회 필요"
      : savings?.resultLength === 62
        ? "특별공급 신청구분 불일치 — 신청자 재확인"
        : savings?.resultLength === 61
          ? "성명 불일치 — 명의 확인 필요"
          : null;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Banknote className="w-4 h-4 text-teal-600" />
        <h2 className="font-semibold text-ink">청약통장 순위확인</h2>
        <VerdictBadge verdict={verdict} />
        {typeof minSubscriptionMonths === "number" && minSubscriptionMonths > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
            공고 최소 가입기간 {minSubscriptionMonths}개월
          </span>
        )}
      </div>

      {verdict.missing ? (
        <EmptyState
          hint="청약통장 순위확인 결과가 업로드되면 자동 판정됩니다."
          action='고객 관리 > "파일 일괄 분석" 에서 입주자저축순위확인 PDF 업로드'
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-surface2 rounded-lg p-3">
              <p className="text-xs text-ink-3">은행</p>
              <p className="font-medium mt-0.5">
                {bankName} {savings?.bankCode && `(${savings.bankCode})`}
              </p>
            </div>
            <div className="bg-surface2 rounded-lg p-3">
              <p className="text-xs text-ink-3">순위확인 결과</p>
              <p className={`font-medium mt-0.5 ${savings?.verified ? "text-green-700" : "text-red-700"}`}>
                {savings?.resultLength ? `${savings.resultLength})` : "—"}{" "}
                {savings?.verified ? "검증완료" : "오류"}
              </p>
            </div>
            <div className="bg-surface2 rounded-lg p-3">
              <p className="text-xs text-ink-3">고객 가입기간</p>
              <p className="font-medium mt-0.5">
                {customer.subscription_months ?? 0}개월
              </p>
            </div>
            <div className="bg-surface2 rounded-lg p-3">
              <p className="text-xs text-ink-3">공고 최소 요구</p>
              <p className="font-medium mt-0.5">
                {typeof minSubscriptionMonths === "number" && minSubscriptionMonths > 0
                  ? `${minSubscriptionMonths}개월`
                  : "공고 파싱값 없음"}
              </p>
            </div>
          </div>

          {!savings?.verified && errorHint && (
            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              <strong>⚠ {errorHint}</strong>
              {savings?.errorNote && <p className="mt-1">{savings.errorNote}</p>}
            </div>
          )}
        </>
      )}

      <VerdictBox verdict={verdict} />
    </div>
  );
}

/* ─── 공용 빈 상태 ──────────────────────────────── */

function EmptyState({ hint, action }: { hint: string; action: string }) {
  return (
    <div className="p-4 text-center border border-dashed border-border rounded-lg">
      <p className="text-sm text-ink-3">{hint}</p>
      <p className="text-[11px] text-ink-4 mt-1">{action}</p>
    </div>
  );
}
