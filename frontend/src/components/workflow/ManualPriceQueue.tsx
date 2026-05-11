"use client";

/**
 * 공시가격 수동 입력 대기 큐
 *
 * 자동 조회로 가격을 확정하지 못한 60㎡ 이하 보유 주택 목록.
 * 각 행마다:
 *   - 「공시가격 알리미 새 탭 열기」 버튼 → 사용자가 직접 확인
 *   - 가격 입력 input → 저장 버튼
 * 저장하면 customer.properties[idx]에 officialPrice + Source="manual" 반영,
 * 그 항목은 큐에서 자동 제거.
 *
 * 「소형·저가 예외」 자동 판정에 필요한 가격 정보를 사람 손으로도 채울 수 있게 해
 * 자동화가 안 되는 케이스도 작업 흐름이 끊기지 않도록 함.
 */

import { useState } from "react";
import { localCustomers, type LocalCustomer } from "@/lib/local-store";
import { ExternalLink, Save, Loader2, ChevronDown, ChevronUp } from "lucide-react";

interface QueueItem {
  customerId: number;
  customerName: string;
  unitDong?: string;
  unitHo?: string;
  /** 묶인 properties 인덱스들 — 가격 저장 시 모든 인덱스에 동시 반영 */
  propIdxList: number[];
  address: string;
  areaM2?: number;
  usage?: string;
  /** 그룹화된 행 개수 (1=단독, 2이상=중복 묶음) */
  groupSize: number;
}

/**
 * 동일 부동산 「signature」 생성 — 같은 사람의 같은 호수면 한 부동산으로 묶음.
 *
 * 묶음 매칭 기준:
 *   - 같은 행정구역(시·도·읍·면·동·리)
 *   - 같은 번지 (부번 0은 무시)
 *   - 같은 「호 번호」 (마지막 3~5자리)
 *   - 면적 ±2㎡ 이내
 *
 * 「동」은 표기 다양성이 너무 커서 signature에서 제외:
 *   - "0001 00514" (단지코드+호)
 *   - "5층 514호" (층+호)
 *   - "103동 1006호" (동+호)
 *   - "0019 00202" (코드+호)
 * 모두 호번호만 보면 의도 명확. 같은 사람·같은 번지·같은 호 = 거의 확실히 같은 부동산.
 */
function propSignature(address: string, areaM2?: number): string {
  let s = (address || "").trim();
  // 행정구역 중복 prefix (강원도 강원강릉시 → 강원도 강릉시)
  s = s.replace(/(강원|경기|충북|충남|전북|전남|경북|경남|제주|충청|전라|경상)도\s+\1(?=\S)/g, "$1도 ");

  // 1) 행정구역 토큰
  const adminMatch = s.match(/(\S+(?:특별시|광역시|특별자치도|도)\s+\S+(?:시|군|구)(?:\s+\S+(?:읍|면|동|리))?(?:\s+\S+(?:리|동))?)/);
  const admin = adminMatch ? adminMatch[1].replace(/\s+/g, " ") : "";

  // 2) 번지 (본번만 추출, 부번 무시)
  //   "1089-40번지" → "1089-40"
  //   "1089-0번지"  → "1089"
  //   "1089번지"    → "1089"
  const jibunMatch = s.match(/(\d+)(?:-(\d+))?\s*번지/);
  let jibun = "";
  if (jibunMatch) {
    const main = jibunMatch[1];
    const sub = jibunMatch[2];
    jibun = sub && sub !== "0" ? `${main}-${sub}` : main;
  }

  // 3) 호 번호 추출 — 다양한 패턴
  //   "00514" → 514
  //   "514호" → 514
  //   "1006호" → 1006
  //   "0202" → 202 (00202 같은 leading-zero 형태)
  // 호 번호는 보통 3~5자리. 끝에서 호 키워드 또는 leading-zero 5자리 추출.
  let ho = "";
  // 끝 부분에서 N호 찾기
  const hoEnd = s.match(/(\d{2,5})\s*호\s*$/);
  if (hoEnd) {
    ho = String(Number(hoEnd[1]));
  } else {
    // 호 키워드 없으면 끝의 마지막 숫자 시퀀스 (4~5자리 우선)
    const tail = s.match(/(\d{4,5})\s*$/);
    if (tail) {
      ho = String(Number(tail[1]));
    } else {
      const tail3 = s.match(/(\d{3})\s*$/);
      if (tail3) ho = String(Number(tail3[1]));
    }
  }

  // 4) 면적 버킷 (±2㎡)
  const aBucket = areaM2 != null ? Math.floor(areaM2 / 2) : "?";

  return `${admin}|${jibun}|${ho}|${aBucket}`;
}

interface Props {
  customers: LocalCustomer[];
  onUpdate: () => void;
}

export default function ManualPriceQueue({ customers, onUpdate }: Props) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // 가격 입력 필요 항목 — 60㎡ 이하 + 보유 + 주거용 + 가격 미상
  // ⚠ 일반공급 신청자에 한정 — 특별공급은 「유주택자 = 부적격」이라
  //   소형·저가 무주택 예외 적용 자체가 안 됨. 가격 입력 무의미하므로 큐에서 제외.
  //
  // 동일 부동산이 다른 표기로 중복 등록된 케이스(예: "0019 00202" vs "19동 202호"는
  // 같은 부동산) 자동 묶음 처리. 가격 저장 시 묶인 모든 인덱스에 동시 반영.
  const items: QueueItem[] = [];
  for (const c of customers) {
    const supplyType = (c.supply_type || "일반공급").trim();
    const isGeneralSupply = /일반공급/.test(supplyType) || supplyType === "";
    if (!isGeneralSupply) continue;

    // 1차: 적격 행 수집 (인덱스 보존)
    const eligible: Array<{ idx: number; address: string; areaM2?: number; usage?: string }> = [];
    (c.properties || []).forEach((p, idx) => {
      const isSmall = (p.areaM2 ?? Infinity) <= 60 && (p.areaM2 ?? 0) > 0;
      const noPrice = (p as any).officialPrice == null;
      const notTransferred = !p.transferredDate;
      const isRes = !p.usage || /아파트|주택|연립|다세대|단독|다가구|공동/.test(p.usage);
      if (isSmall && noPrice && notTransferred && isRes) {
        eligible.push({ idx, address: p.address, areaM2: p.areaM2, usage: p.usage });
      }
    });
    if (eligible.length === 0) continue;

    // 2차: signature로 그룹핑 → 1 row per group
    const groups = new Map<string, typeof eligible>();
    for (const e of eligible) {
      const sig = propSignature(e.address, e.areaM2);
      const arr = groups.get(sig) || [];
      arr.push(e);
      groups.set(sig, arr);
    }
    groups.forEach((arr) => {
      // 대표 항목 = 가장 정보 많아 보이는 행 (긴 주소 우선)
      const rep = arr.slice().sort((a, b) => b.address.length - a.address.length)[0];
      items.push({
        customerId: c.id,
        customerName: c.name,
        unitDong: (c as any).unit_dong,
        unitHo: (c as any).unit_ho,
        propIdxList: arr.map((x) => x.idx),
        address: rep.address,
        areaM2: rep.areaM2,
        usage: rep.usage,
        groupSize: arr.length,
      });
    });
  }

  if (items.length === 0) return null;

  const handleSave = async (item: QueueItem) => {
    const key = `${item.customerId}-${item.propIdxList.join(",")}`;
    const raw = draft[key] || "";
    const num = parsePriceInput(raw);
    if (!num || num <= 0) {
      alert("가격을 정확히 입력해주세요 (원 단위 숫자, 또는 「2.4억」 「2400만」 등)");
      return;
    }
    setSaving(key);
    try {
      const c = localCustomers.get(item.customerId);
      if (!c) return;
      const props = (c.properties || []).slice();
      // 묶인 모든 인덱스에 동일 가격 반영
      for (const idx of item.propIdxList) {
        const target = props[idx];
        if (!target) continue;
        props[idx] = {
          ...target,
          officialPrice: num,
          officialPriceYear: new Date().getFullYear(),
          officialPriceSource: "manual",
        } as any;
      }
      localCustomers.update(item.customerId, { properties: props as any });
      setDraft((d) => {
        const n = { ...d };
        delete n[key];
        return n;
      });
      onUpdate();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="card mb-4 p-3 bg-amber-50/40 border-amber-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-amber-900">
            ⚠ 공시가격 수동 입력 대기
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-bold">
            {items.length}건
          </span>
          {(() => {
            const grouped = items.filter((i) => i.groupSize > 1);
            if (grouped.length === 0) return null;
            const collapsedFrom = grouped.reduce((sum, i) => sum + i.groupSize, 0);
            const savedRows = collapsedFrom - grouped.length;
            return (
              <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-medium">
                🔗 중복 {grouped.length}개 묶음 ({savedRows}건 자동 통합)
              </span>
            );
          })()}
          <span className="text-[10.5px] text-amber-800/80">
            자동 조회 실패 → 알리미에서 직접 확인 후 입력
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-amber-800" /> : <ChevronDown className="w-4 h-4 text-amber-800" />}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
          {items.map((item) => {
            const key = `${item.customerId}-${item.propIdxList.join(",")}`;
            const allimiUrl = `https://www.realtyprice.kr:447/notice/main/mainBody.htm?addr=${encodeURIComponent(item.address)}`;
            return (
              <div
                key={key}
                className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] items-center gap-2 p-2 rounded bg-white border border-amber-100 text-[11.5px]"
              >
                <span className="font-mono text-ink-3 whitespace-nowrap">
                  {item.unitDong || "?"}-{item.unitHo || "?"}
                </span>
                <span className="font-medium text-ink-2 whitespace-nowrap">{item.customerName}</span>
                <span className="truncate text-ink-2" title={item.address}>
                  📍 {item.address}
                  {item.groupSize > 1 && (
                    <span
                      className="ml-1 text-[9.5px] px-1 py-0 rounded bg-indigo-100 text-indigo-800 font-semibold"
                      title={`동일 부동산 중복 등록 ${item.groupSize}건 자동 묶음 — 가격 저장 시 모두 일괄 반영`}
                    >
                      🔗 {item.groupSize}건 묶음
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-ink-4 whitespace-nowrap">
                  {item.areaM2 ? `${item.areaM2}㎡` : ""}
                  {item.usage ? ` · ${item.usage}` : ""}
                </span>
                <a
                  href={allimiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap"
                  title="공시가격 알리미 새 탭 열기 (해당 주소 검색)"
                >
                  <ExternalLink className="w-3 h-3" /> 알리미
                </a>
                <input
                  type="text"
                  placeholder="가격 (예: 2.4억 / 24000000)"
                  value={draft[key] || ""}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave(item);
                  }}
                  className="w-44 px-2 py-1 text-[11px] rounded border border-border focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  onClick={() => handleSave(item)}
                  disabled={saving === key || !draft[key]}
                  className="inline-flex items-center gap-0.5 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] disabled:opacity-40"
                >
                  {saving === key ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  저장
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 「2.4억」「24000000」「2,400만」 등 한국식 표기 → 원 단위 정수 */
function parsePriceInput(raw: string): number {
  const s = String(raw).trim();
  if (!s) return 0;
  // 「2.4억」 패턴
  const eok = s.match(/^(\d+(?:\.\d+)?)\s*억\s*(\d+)?\s*(?:만)?$/);
  if (eok) {
    const e = Number(eok[1]) * 100_000_000;
    const m = eok[2] ? Number(eok[2]) * 10_000 : 0;
    return Math.round(e + m);
  }
  // 「2400만」
  const man = s.match(/^(\d+(?:\.\d+)?)\s*만$/);
  if (man) return Math.round(Number(man[1]) * 10_000);
  // 그 외는 콤마·공백 제거 후 숫자
  const num = Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num)) return 0;
  return Math.round(num);
}
