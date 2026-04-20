/**
 * compare/data.ts 의 샘플 공고를 LocalAnnouncement 형태로 변환해
 * 고객/당첨자/서류/계약 페이지의 공고 선택창에 함께 노출하기 위한 어댑터.
 *
 * - 샘플 ID는 충돌 방지를 위해 음수(-9000번대)로 매핑
 * - contract_end는 샘플 문자열("YYYY.MM.DD~MM.DD")에서 파싱해 ISO 포맷으로 채움
 *   → isAnnouncementDone()이 완료 여부를 제대로 판별할 수 있게 함
 */

import { announcements as sampleAnnouncements } from "@/app/(main)/announcements/compare/data";
import type { LocalAnnouncement } from "./local-store";

/** "YYYY.MM.DD~MM.DD" 또는 "YYYY.MM.DD ~ YYYY.MM.DD" 범위에서 끝 날짜 ISO 추출 */
function extractEndDateISO(range?: string): string | null {
  if (!range) return null;
  const parts = range.split("~").map((s) => s.trim());
  if (parts.length < 2) return null;
  const [startStr, endStr] = parts;
  const startMatch = startStr.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (!startMatch) return null;
  const startYear = startMatch[1];
  const endShort = endStr.match(/^(\d{1,2})[.\-](\d{1,2})$/);
  if (endShort) {
    return `${startYear}-${endShort[1].padStart(2, "0")}-${endShort[2].padStart(2, "0")}`;
  }
  const endFull = endStr.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (endFull) {
    return `${endFull[1]}-${endFull[2].padStart(2, "0")}-${endFull[3].padStart(2, "0")}`;
  }
  return null;
}

function extractStartDateISO(range?: string): string | null {
  if (!range) return null;
  const m = (range.split("~")[0] || "").match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function singleDateISO(s?: string): string | null {
  if (!s) return null;
  const m = s.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** 샘플 공고 → LocalAnnouncement 어댑터 */
export function getSampleAsLocalAnnouncements(): LocalAnnouncement[] {
  return sampleAnnouncements.map((s, i) => {
    const contractStart = extractStartDateISO(s.schedule.contract);
    const contractEnd = extractEndDateISO(s.schedule.contract);
    const appStart = singleDateISO(s.schedule.specialApply) || singleDateISO(s.schedule.general1st);
    const appEnd = singleDateISO(s.schedule.general2nd);
    const docStart = extractStartDateISO(s.schedule.docSubmit);
    const docEnd = extractEndDateISO(s.schedule.docSubmit);

    return {
      id: -(9000 + i),
      site_id: 0,
      title: s.shortName,
      announcement_no: null,
      status: "published",
      application_start: appStart,
      application_end: appEnd,
      winner_announce_date: singleDateISO(s.schedule.winnerAnnounce),
      contract_start: contractStart,
      contract_end: contractEnd,
      eligibility_rules: {
        region_full: s.location,
        total_units: s.totalUnits,
        regulation: s.regulation,
        doc_submit_start: docStart,
        doc_submit_end: docEnd,
        _isSample: true,
      },
      created_at: new Date().toISOString(),
    };
  });
}
