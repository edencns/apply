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
  propIdx: number;
  address: string;
  areaM2?: number;
  usage?: string;
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
  const items: QueueItem[] = [];
  for (const c of customers) {
    const supplyType = (c.supply_type || "일반공급").trim();
    const isGeneralSupply = /일반공급/.test(supplyType) || supplyType === "";
    if (!isGeneralSupply) continue; // 특별공급은 큐에 안 띄움
    (c.properties || []).forEach((p, idx) => {
      const isSmall = (p.areaM2 ?? Infinity) <= 60 && (p.areaM2 ?? 0) > 0;
      const noPrice = (p as any).officialPrice == null;
      const notTransferred = !p.transferredDate;
      const isRes = !p.usage || /아파트|주택|연립|다세대|단독|다가구|공동/.test(p.usage);
      if (isSmall && noPrice && notTransferred && isRes) {
        items.push({
          customerId: c.id,
          customerName: c.name,
          unitDong: (c as any).unit_dong,
          unitHo: (c as any).unit_ho,
          propIdx: idx,
          address: p.address,
          areaM2: p.areaM2,
          usage: p.usage,
        });
      }
    });
  }

  if (items.length === 0) return null;

  const handleSave = async (item: QueueItem) => {
    const key = `${item.customerId}-${item.propIdx}`;
    const raw = draft[key] || "";
    // 「2.4억」 「24,000,000」 「2400만」 등 한국식 표기 일부 인식
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
      const target = props[item.propIdx];
      if (!target) return;
      props[item.propIdx] = {
        ...target,
        officialPrice: num,
        officialPriceYear: new Date().getFullYear(),
        officialPriceSource: "manual",
      } as any;
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
          <span className="text-[10.5px] text-amber-800/80">
            자동 조회 실패 → 알리미에서 직접 확인 후 입력
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-amber-800" /> : <ChevronDown className="w-4 h-4 text-amber-800" />}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
          {items.map((item) => {
            const key = `${item.customerId}-${item.propIdx}`;
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
