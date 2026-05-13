/**
 * 부적격 사유 9종 분류 — 「주택공급에 관한 규칙」 조항 기준.
 *
 * 출처: 한국부동산원 「청약업무 종합 준칙」 — 추첨이후 업무 中 [08]부적격당첨자 명단.
 *
 * 사용처:
 *   1) ineligible-ingest: 부적격자 엑셀의 "오류내용" 자유텍스트 → code 자동 매핑
 *   2) documents 페이지: 담당자가 드롭다운으로 수정/추가 가능
 *   3) 청약홈 [08] 양식 출력 시 코드별 분류 사용
 */

export type IneligibleReasonCode =
  | "special_once_limit"           // 제55조 — 특별공급 1회 제한
  | "duplicate_homeless_member"    // 제4·52조 — 무주택세대구성원 중복청약·당첨
  | "rewinning_restriction"        // 제54조 — 재당첨 제한
  | "score_miscalc"                // 제28조 — 가점제 미달 (무주택기간·부양가족수 착오 기재)
  | "minor"                        // 제4·52조 — 미성년자
  | "residence_error"              // 제4·52조 — 거주지 오류
  | "move_in_restriction"          // 제4·52조 — 전입제한일 미충족
  | "past2y_score_winner"          // 제28조 — 과거 2년 이내 가점제 당첨 제한자 중 가점제 당첨자
  | "past_ineligible_processed"    // 제58조 — 과거 부적격당첨자 처리로 제한받는 자
  | "past5y_first_rank_limit"      // 제28조 — 과거 5년 이내 당첨자의 1순위 제한
  | "other";                       // 그 외 (자유 텍스트 보존)

export interface IneligibleReasonDef {
  code: IneligibleReasonCode;
  label: string;
  article: string;
  /** 자유 텍스트 자동 매핑용 — 공백 제거 후 매칭 */
  keywords: RegExp[];
}

/**
 * 사유 정의 목록 — UI 드롭다운 순서.
 * keywords는 ineligible-ingest 엑셀의 "오류내용"/"결과" 자유 텍스트 매칭용.
 */
export const INELIGIBLE_REASONS: IneligibleReasonDef[] = [
  {
    code: "special_once_limit",
    label: "특별공급 1회 제한",
    article: "제55조",
    keywords: [/특별?공급.{0,3}1회/, /특공.{0,3}1회/, /평생.?1회/, /특공.*제한/],
  },
  {
    code: "duplicate_homeless_member",
    label: "무주택세대구성원 중복청약·당첨",
    article: "제4·52조",
    keywords: [/세대원.{0,3}중복/, /세대.{0,3}중복/, /중복.{0,3}신청/, /중복.{0,3}청약/, /중복.{0,3}당첨/, /이중신청/],
  },
  {
    code: "rewinning_restriction",
    label: "재당첨 제한",
    article: "제54조",
    keywords: [/재당첨/, /재 ?당첨/],
  },
  {
    code: "score_miscalc",
    label: "가점제 미달 (무주택기간·부양가족수 착오)",
    article: "제28조",
    keywords: [/가점.{0,3}미달/, /가점.{0,3}오류/, /가점.{0,3}착오/, /무주택기간.{0,5}오류/, /부양가족.?수.{0,5}오류/, /가점.{0,3}부족/],
  },
  {
    code: "minor",
    label: "미성년자",
    article: "제4·52조",
    keywords: [/미성년/, /만 ?19세.{0,3}미만/],
  },
  {
    code: "residence_error",
    label: "거주지 오류",
    article: "제4·52조",
    keywords: [/거주지.{0,3}오류/, /거주지.{0,3}불일치/, /주소지.{0,5}오류/, /거주.{0,3}요건.{0,3}미달/],
  },
  {
    code: "move_in_restriction",
    label: "전입제한일 미충족",
    article: "제4·52조",
    keywords: [/전입.{0,5}미충족/, /전입.{0,5}제한/, /전입일.{0,5}오류/],
  },
  {
    code: "past2y_score_winner",
    label: "과거 2년 가점제 당첨 제한자",
    article: "제28조",
    keywords: [/2년.{0,5}가점.{0,5}당첨/, /과거 ?2년/],
  },
  {
    code: "past_ineligible_processed",
    label: "과거 부적격당첨자 처리 제한자",
    article: "제58조",
    keywords: [/과거.{0,3}부적격/, /부적격.{0,3}처리.{0,3}제한/],
  },
  {
    code: "past5y_first_rank_limit",
    label: "5년 내 당첨자 1순위 제한",
    article: "제28조",
    keywords: [/5년.{0,5}당첨/, /5년.{0,3}이내.{0,3}당첨/, /1순위.{0,3}제한/],
  },
];

export const INELIGIBLE_REASON_MAP: Record<IneligibleReasonCode, IneligibleReasonDef> = (() => {
  const m: any = {};
  for (const r of INELIGIBLE_REASONS) m[r.code] = r;
  m.other = { code: "other", label: "기타", article: "—", keywords: [] };
  return m;
})();

/**
 * 자유 텍스트 → 코드 자동 매핑.
 * - 매칭되는 모든 코드 반환 (다중 매칭 가능 — 예: "재당첨 + 거주지오류")
 * - 매칭 0건이면 ["other"]
 * - 빈 입력이면 []
 */
export function classifyIneligibleReason(text: string | undefined | null): IneligibleReasonCode[] {
  if (!text) return [];
  const normalized = String(text).replace(/\s+/g, "").trim();
  if (!normalized) return [];
  const matched: IneligibleReasonCode[] = [];
  for (const r of INELIGIBLE_REASONS) {
    if (r.keywords.some((k) => k.test(normalized))) matched.push(r.code);
  }
  return matched.length ? matched : ["other"];
}

export function reasonLabel(code: IneligibleReasonCode): string {
  return INELIGIBLE_REASON_MAP[code]?.label || code;
}

export function reasonArticle(code: IneligibleReasonCode): string {
  return INELIGIBLE_REASON_MAP[code]?.article || "—";
}
