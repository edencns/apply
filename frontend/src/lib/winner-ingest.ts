/**
 * 청약 당첨자 관련 파일 일괄 수집 + 취합 모듈
 *
 * 지원 파일 (자동 분류):
 *  1. 전산추첨결과 (원본·공문본·공1·공2)  — 17/15 시트 XLSX
 *  2. 당첨자현황 PDF                     — 공개용 마스킹
 *  3. 정당 확인용                         — 일반공급 이름순 XLSX
 *  4. 당첨자세대원내역                    — 요청자↔세대원 매핑
 *  5. 인포용 당첨자명단                   — 데스크용 간소화
 *  6. 추가 예비입주자                     — 추첨 결격자 대체
 *  7. 주택소유 전산검색 결과              — 무주택 검증
 *  8. 입주자저축 순위확인 통보 PDF        — 청약통장 검증 결과
 *
 * 처리 흐름:
 *  - classify(file)        : 시트/헤더/본문 패턴으로 파일 종류 식별
 *  - parse*(file/text)     : 파일 종류별 파서 → WinnerRecord[] 또는 보조 레코드
 *  - consolidate(records)  : 주민번호(정규화) 기준으로 병합 → WinnerProfile[]
 *
 * 민감정보(주민번호 등)는 서버로 전송하지 않고 브라우저 내에서 처리한다.
 * 단 PDF 텍스트 추출만 CMap이 필요해 전용 API(/api/extract-pdf-text)를 거친다.
 */

// xlsx는 300KB+ 라이브러리 — 번들 부풀림 방지를 위해 동적 import
type XLSXModule = typeof import("xlsx");
type XLSXWorkBook = import("xlsx").WorkBook;
let _xlsx: XLSXModule | null = null;
async function ensureXlsx(): Promise<XLSXModule> {
  if (!_xlsx) _xlsx = await import("xlsx");
  return _xlsx;
}
function sheetRows(sheet: any): any[][] {
  if (!_xlsx) throw new Error("xlsx 모듈이 로드되지 않았습니다");
  return _xlsx.utils.sheet_to_json(sheet, { defval: "", header: 1 }) as any[][];
}
// 외부 코드에서 workbook 타입을 쓸 수 있도록 namespace 역할
const XLSX = { get utils() { return _xlsx!.utils; }, get read() { return _xlsx!.read; } } as const;

/* ─────────────────────────────────────────────────────────────
   1. Types
   ───────────────────────────────────────────────────────────── */

/** 파일 분류 결과 */
export type FileKind =
  | "lottery-results"         // 전산추첨결과 (원본/공1/공문본)
  | "lottery-results-masked"  // 공2 (마스킹)
  | "winner-pdf"              // 당첨자현황 PDF
  | "confirmation-list"       // 정당 확인용
  | "household-members"       // 세대원내역
  | "info-desk"               // 인포용 명단
  | "additional-standbys"     // 추가 예비입주자
  | "property-ownership"      // 주택소유 전산검색
  | "savings-priority-pdf"    // 입주자저축 순위확인 PDF
  | "unknown";

/** 공급 구분 */
export type SupplyKind =
  | "일반공급"
  | "신혼부부"
  | "생애최초"
  | "다자녀가구"
  | "노부모부양"
  | "기관추천"
  | "이전기관"
  | "신생아"
  | "알수없음";

/** 파일 파싱 후 중간 레코드 (주민번호 키 기준 merge 단위) */
export interface WinnerRecord {
  rrn?: string;                 // 13자리 숫자 (정규화)
  rrnMasked?: string;           // PDF용 마스킹된 뒷자리 표기
  name: string;
  /** 공고 정보 */
  announcementNo?: string;      // 주택관리번호
  announcementDate?: string;    // 당첨자발표일 YYYYMMDD
  /** 당첨 정보 */
  unitType?: string;            // 주택형 예 "0599660", "0778300A"
  dong?: string;
  ho?: string;
  supplyCategory?: "특별공급" | "일반공급";
  specialType?: SupplyKind;     // 특별공급 상세 유형
  isStandby?: boolean;          // 예비입주자 여부
  standbyRank?: string;         // 예비순위
  rank?: string;                // 일반공급 순위
  selectionOrder?: string;      // 특별공급 선정순위
  /** 연락 */
  phone?: string;
  zipCode?: string;
  address?: string;
  /** 청약통장 */
  bankName?: string;
  bankCode?: string;
  depositType?: string;
  accountNo?: string;
  /** 배점 */
  scores?: {
    총점?: number;
    가점?: number;
    감점?: number;
    무주택기간?: string;
    부양가족수?: string;
    입주자저축가입기간?: string;
    배우자저축점수?: string;
    미성년자녀수?: string;
    영유아자녀수?: string;
    세대구성?: string;
    시도거주기간?: string;
  };
  /** 신혼부부/생애최초 상세 */
  maritalInfo?: {
    소득우선구분?: string;
    선정순위?: string;
    미성년자녀수?: string;
    임신여부?: string;
    태아수?: string;
    신청유형?: string;
  };
  /** 기타 */
  regionLocal?: string;         // 거주지역명 "(600)부산"
  regionQualifyApply?: string;  // 당해여부(신청기준)
  regionQualifyWin?: string;    // 당해여부(당첨기준)
  lowestFloor?: string;         // 최하층 신청구분
  applyDate?: string;           // 청약신청일
  applyTime?: string;           // 접수시간
  housingOwnership?: string;    // 주택소유구분
  lotteryRandom?: string;       // 무작위당첨여부
  lotteryType?: string;         // 당첨구분 (가점제/추첨제)
  longMilitary?: string;
  rankBaseDate?: string;
  /** 기관추천 */
  institution?: string;         // 추천구분
  institutionSubType?: string;  // 기관추천 특별공급 종류코드
  /** 이전기관 */
  affiliation?: string;         // 소속기관
  position?: string;
  /** 출처 파일명 리스트 */
  sourceFiles?: string[];
}

/** 세대원 레코드 */
export interface HouseholdMemberRecord {
  requesterRrn: string;
  requesterName: string;
  memberName: string;
  memberRrn: string;
  errorCode?: string;
}

/** 주택소유 레코드 */
export interface PropertyOwnershipRecord {
  ownerRrn: string;
  ownerName: string;
  identifier?: string;
  address: string;
  zipCode?: string;
  areaM2?: number;
  acquiredDate?: string;
  transferredDate?: string;
  usage?: string;
  changeReason?: string;
  changeDate?: string;
  saleReportDate?: string;
  contractDate?: string;
  paymentDate?: string;
  rightsType?: string;
  buySell?: string;
}

/** 청약통장 순위확인 레코드 */
export interface SavingsPriorityRecord {
  rrn: string;
  name: string;
  bankCode?: string;
  announcementDate?: string;
  specialSupplyCode?: string;
  firstLifeDate?: string;
  resultLength?: number;     // 70/63/62/61
  verified: boolean;         // 검증완료 여부
  errorNote?: string;        // 오류 상세
}

/** 통합 후 최종 프로필 */
export interface WinnerProfile extends WinnerRecord {
  householdMembers?: HouseholdMemberRecord[];
  properties?: PropertyOwnershipRecord[];
  savingsPriority?: SavingsPriorityRecord;
  sourceKinds?: FileKind[];
}

/** 파일 단위 파싱 결과 */
export interface FileIngestResult {
  fileName: string;
  kind: FileKind;
  winners: WinnerRecord[];
  householdMembers: HouseholdMemberRecord[];
  properties: PropertyOwnershipRecord[];
  savings: SavingsPriorityRecord[];
  /** 사용자에게 보여줄 파일별 요약 라벨 */
  label: string;
  /** 경고/알림 */
  notes: string[];
}

/** 전체 취합 결과 */
export interface ConsolidatedResult {
  profiles: WinnerProfile[];
  files: FileIngestResult[];
  /** 주민번호 없이 매칭 실패한 레코드 (예: PDF만 있는 마스킹 건) */
  unmatched: {
    winners: WinnerRecord[];
    household: HouseholdMemberRecord[];
    properties: PropertyOwnershipRecord[];
  };
  /** 공통 공고 정보 (여러 파일에서 공통으로 발견되면 한곳에 모음) */
  announcement?: {
    no?: string;
    date?: string;
  };
}

/* ─────────────────────────────────────────────────────────────
   2. 공용 유틸
   ───────────────────────────────────────────────────────────── */

/** 주민번호 정규화 (하이픈/공백 제거 → 13자리 숫자) */
export function normalizeRrn(input: any): string | undefined {
  if (input === undefined || input === null) return undefined;
  const s = String(input).replace(/\s|-/g, "");
  if (/^\d{13}$/.test(s)) return s;
  return undefined;
}

/** 주민번호 포맷팅 (저장/표시용 "YYMMDD-XXXXXXX") */
export function formatRrn(rrn?: string): string {
  if (!rrn || rrn.length !== 13) return rrn || "";
  return `${rrn.slice(0, 6)}-${rrn.slice(6)}`;
}

/** 성명 정규화 */
function normalizeName(v: any): string {
  return String(v ?? "").trim();
}

/** 전화번호 정규화 "010 1234 5678" → "010-1234-5678" */
function normalizePhone(v: any): string {
  const s = String(v ?? "").replace(/\s+/g, "").replace(/\./g, "-");
  if (!s) return "";
  const m = s.match(/(01[016789])-?(\d{3,4})-?(\d{4})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}

/** 숫자 파싱 (콤마/문자 제거) */
function toNum(v: any): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** 공급종류 문자열 정규화 (예: "13[특별공급(신혼부부)당첨자명단]" → 신혼부부) */
export function normalizeSpecialType(raw: any): SupplyKind | undefined {
  if (!raw) return undefined;
  const s = String(raw);
  if (/신혼부부/.test(s)) return "신혼부부";
  if (/생애최초/.test(s)) return "생애최초";
  if (/다자녀/.test(s)) return "다자녀가구";
  if (/노부모/.test(s)) return "노부모부양";
  if (/기관추천|기타/.test(s) && !/이전기관/.test(s)) return "기관추천";
  if (/이전기관/.test(s)) return "이전기관";
  if (/신생아/.test(s)) return "신생아";
  return undefined;
}

/** 헤더 행 자동 탐지 — 주어진 signal 문자열 중 몇 개가 포함된 첫 행 index 반환 */
function findHeaderRow(rows: any[][], signals: string[], minHits = 2): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i] || [];
    const cells = r.map((c) => String(c ?? "").trim());
    const hits = signals.filter((sig) => cells.some((c) => c.includes(sig))).length;
    if (hits >= minHits) return i;
  }
  return -1;
}

/** 헤더 → 인덱스 맵 */
function buildColMap(header: any[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = String(h ?? "").trim();
    if (key) map[key] = i;
  });
  return map;
}

/** 유사 컬럼명 여럿 중 첫 존재 값 */
function pick(row: any[], map: Record<string, number>, ...names: string[]): any {
  for (const name of names) {
    const idx = map[name];
    if (idx !== undefined) {
      const v = row[idx];
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }
  return undefined;
}

/** 공통 행 → WinnerRecord 필드 추출 (유형 불문) */
function extractCommonWinnerFields(
  row: any[],
  map: Record<string, number>,
): Partial<WinnerRecord> {
  const rec: Partial<WinnerRecord> = {};
  rec.name = normalizeName(pick(row, map, "성명"));
  rec.rrn = normalizeRrn(pick(row, map, "주민등록번호", "주민번호"));
  rec.announcementNo = String(pick(row, map, "주택관리번호") ?? "").trim() || undefined;
  rec.unitType = String(pick(row, map, "주택형") ?? "").trim() || undefined;
  rec.dong = String(pick(row, map, "동수", "동") ?? "").trim() || undefined;
  rec.ho = String(pick(row, map, "호수", "호") ?? "").trim() || undefined;
  rec.phone = normalizePhone(pick(row, map, "연락전화번호", "전화번호", "연락처")) || undefined;
  rec.zipCode = String(pick(row, map, "연락우편번호", "우편번호") ?? "").trim() || undefined;
  rec.address = String(pick(row, map, "연락주소", "주소") ?? "").trim() || undefined;
  rec.bankName = String(pick(row, map, "개설은행") ?? "").trim() || undefined;
  rec.depositType = String(pick(row, map, "예금종목", "예금종류") ?? "").trim() || undefined;
  rec.accountNo = String(pick(row, map, "계좌번호") ?? "").trim() || undefined;
  rec.regionLocal = String(pick(row, map, "거주지역명") ?? "").trim() || undefined;
  rec.regionQualifyApply = String(pick(row, map, "당해여부(신청기준)") ?? "").trim() || undefined;
  rec.regionQualifyWin = String(pick(row, map, "당해여부(당첨기준)") ?? "").trim() || undefined;
  rec.lowestFloor = String(pick(row, map, "최하층 신청구분") ?? "").trim() || undefined;
  rec.applyDate = String(pick(row, map, "청약신청일", "접수일자") ?? "").trim() || undefined;
  rec.applyTime = String(pick(row, map, "접수시간") ?? "").trim() || undefined;
  rec.lotteryRandom = String(pick(row, map, "무작위당첨여부") ?? "").trim() || undefined;
  rec.longMilitary = String(pick(row, map, "장기복무군인 신청", "장기복무군인신청여부") ?? "").trim() || undefined;
  return rec;
}

/* ─────────────────────────────────────────────────────────────
   3. 파일 분류기
   ───────────────────────────────────────────────────────────── */

/** XLSX 바이너리에서 파일 종류 판별 */
export function classifyXlsx(wb: XLSXWorkBook, fileName: string = ""): FileKind {
  const sheetSet = new Set(wb.SheetNames);

  // 주택소유 정보
  if (sheetSet.has("주택소유정보결과")) return "property-ownership";

  // 세대원 내역
  if (sheetSet.has("당첨자세대원내역")) return "household-members";
  // 단일 시트에 요청성명/요청주민등록번호 패턴
  if (wb.SheetNames.length === 1) {
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rows = sheetRows(firstSheet);
    const headerIdx = findHeaderRow(rows, ["요청성명", "요청주민등록번호", "세대원성명"], 2);
    if (headerIdx !== -1) return "household-members";
  }

  // 단일 시트에 "동명2인" 헤더 → 인포용 (시트 이름이 "생애최초당첨자"여도 우선 판별)
  if (wb.SheetNames.length === 1) {
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "", header: 1 }) as any[][];
    const info = findHeaderRow(rows, ["동명2인", "성명"], 2);
    if (info !== -1) return "info-desk";
  }

  // 전산추첨결과 유형
  const lotteryTypeSheets = [
    "신혼부부당첨자",
    "생애최초당첨자",
    "일반공급당첨자",
    "다자녀가구당첨자",
    "노부모부양당첨자",
    "기관추천당첨자",
    "이전기관당첨자",
  ];
  const hasLotterySheets = lotteryTypeSheets.some((s) => sheetSet.has(s));
  if (hasLotterySheets) {
    // 공2 (마스킹본): 주민번호 컬럼이 아예 없거나 데이터에 주민번호가 없음
    const sample = wb.Sheets["일반공급당첨자"] || wb.Sheets["신혼부부당첨자"] || wb.Sheets[wb.SheetNames[0]];
    if (sample) {
      const rows = sheetRows(sample);
      const header = rows[0] || [];
      const hasRrn = header.some((h) => String(h).includes("주민"));
      if (!hasRrn) return "lottery-results-masked";
    }
    return "lottery-results";
  }

  // 추가 예비입주자 — 시트 이름이 "특별공급예비" / "일반공급예비"
  if (sheetSet.has("특별공급예비") || sheetSet.has("일반공급예비")) return "additional-standbys";

  // 정당 확인용 / 인포용 — 단일 시트
  if (wb.SheetNames.length === 1) {
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rows = sheetRows(firstSheet);
    // 인포용: "동명2인 생년월일" 컬럼 존재
    const info = findHeaderRow(rows, ["성명", "동명2인"], 2);
    if (info !== -1) return "info-desk";
    // 정당 확인용: 동수/호수/주택형/성명/주민번호 ... 총점
    const confirm = findHeaderRow(rows, ["동수", "호수", "주택형", "성명", "주민번호", "총점"], 5);
    if (confirm !== -1) return "confirmation-list";
    // 일반공급당첨자 헤더지만 시트 이름이 다를 수도 있음
    const single = findHeaderRow(rows, ["주택형", "성명", "순위", "당해여부(신청기준)"], 3);
    if (single !== -1) return "confirmation-list";
  }

  // 파일명 힌트
  const lower = fileName.toLowerCase();
  if (/정당/.test(fileName)) return "confirmation-list";
  if (/인포|데스크/.test(fileName)) return "info-desk";
  if (/주택소유/.test(fileName)) return "property-ownership";
  if (/세대원/.test(fileName)) return "household-members";
  if (/추가|예비/.test(fileName)) return "additional-standbys";

  return "unknown";
}

/** PDF 텍스트에서 파일 종류 판별 */
export function classifyPdfText(text: string, fileName: string = ""): FileKind {
  if (/당첨자\s*명단|특별공급\s*당첨자|일반공급\s*당첨자/.test(text) && /순번/.test(text)) {
    return "winner-pdf";
  }
  if (/입주자저축|순위확인|검증완료|FILLER/.test(text)) {
    return "savings-priority-pdf";
  }
  if (/당첨자현황|당첨자명단/.test(fileName)) return "winner-pdf";
  if (/입주자저축|순위확인/.test(fileName)) return "savings-priority-pdf";
  return "unknown";
}

/* ─────────────────────────────────────────────────────────────
   4. 파서 — 전산추첨결과 (원본/공1/공문본)
   ───────────────────────────────────────────────────────────── */

/** 시트 이름 → (공급구분, 특별유형, 예비여부) */
function interpretSheetName(name: string):
  { supply: "특별공급" | "일반공급"; special?: SupplyKind; standby: boolean } | null {
  const standby = /예비입주자|예비$|^.*예비$/.test(name);
  const trimmed = name.replace(/예비입주자$|예비$/, "").replace("당첨자", "");
  if (/신혼부부/.test(name)) return { supply: "특별공급", special: "신혼부부", standby };
  if (/생애최초/.test(name)) return { supply: "특별공급", special: "생애최초", standby };
  if (/다자녀/.test(name)) return { supply: "특별공급", special: "다자녀가구", standby };
  if (/노부모/.test(name)) return { supply: "특별공급", special: "노부모부양", standby };
  if (/기관추천/.test(name)) return { supply: "특별공급", special: "기관추천", standby };
  if (/이전기관/.test(name)) return { supply: "특별공급", special: "이전기관", standby };
  if (/일반공급/.test(name)) return { supply: "일반공급", standby };
  void trimmed;
  return null;
}

export function parseLotteryResults(
  wb: XLSXWorkBook,
  fileName: string,
  masked: boolean = false,
): FileIngestResult {
  const winners: WinnerRecord[] = [];
  const notes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const meta = interpretSheetName(sheetName);
    if (!meta) continue; // 안내/최저당첨정보 등은 스킵

    const sheet = wb.Sheets[sheetName];
    const rows = sheetRows(sheet);

    const headerIdx = findHeaderRow(
      rows,
      ["성명", "주택형"],
      2,
    );
    if (headerIdx === -1) continue;

    const header = rows[headerIdx];
    const map = buildColMap(header);

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c === "" || c === null || c === undefined)) continue;
      const name = normalizeName(pick(row, map, "성명"));
      if (!name) continue;

      const common = extractCommonWinnerFields(row, map);
      const rec: WinnerRecord = {
        ...common,
        name,
        supplyCategory: meta.supply,
        specialType: meta.special,
        isStandby: meta.standby,
        sourceFiles: [fileName],
      };

      // 예비순위
      if (meta.standby) {
        rec.standbyRank = String(pick(row, map, "예비순위", "예비순번") ?? "").trim() || undefined;
      }

      // 일반공급: 순위/가점
      if (meta.supply === "일반공급") {
        rec.rank = String(pick(row, map, "순위") ?? "").trim() || undefined;
        rec.lotteryType = String(pick(row, map, "당첨구분") ?? "").trim() || undefined;
        rec.housingOwnership = String(pick(row, map, "주택소유구분") ?? "").trim() || undefined;
        rec.rankBaseDate = String(pick(row, map, "순위기산일") ?? "").trim() || undefined;
        rec.scores = {
          총점: toNum(pick(row, map, "총점")),
          가점: toNum(pick(row, map, "가점")),
          감점: toNum(pick(row, map, "감점")),
          무주택기간: String(pick(row, map, "무주택기간") ?? "").trim() || undefined,
          부양가족수: String(pick(row, map, "부양가족수") ?? "").trim() || undefined,
          입주자저축가입기간: String(pick(row, map, "입주자저축가입기간") ?? "").trim() || undefined,
          배우자저축점수: String(pick(row, map, "배우자 입주자저축가입기간 점수") ?? "").trim() || undefined,
        };
      }

      // 다자녀 가점
      if (meta.special === "다자녀가구") {
        rec.scores = {
          총점: toNum(pick(row, map, "총점")),
          미성년자녀수: String(pick(row, map, "미성년 자녀수 배점") ?? "").trim() || undefined,
          영유아자녀수: String(pick(row, map, "영유아 자녀수 배점") ?? "").trim() || undefined,
          세대구성: String(pick(row, map, "세대구성 배점") ?? "").trim() || undefined,
          무주택기간: String(pick(row, map, "무주택기간 배점") ?? "").trim() || undefined,
          시도거주기간: String(pick(row, map, "해당 시,도 거주기간 배점") ?? "").trim() || undefined,
          입주자저축가입기간: String(pick(row, map, "입주자저축 가입기간 배점") ?? "").trim() || undefined,
        };
      }

      // 노부모부양: 가점제 총점
      if (meta.special === "노부모부양") {
        rec.scores = {
          총점: toNum(pick(row, map, "가점제 총점", "총점")),
          무주택기간: String(pick(row, map, "무주택기간 배점") ?? "").trim() || undefined,
          부양가족수: String(pick(row, map, "부양가족수 배점") ?? "").trim() || undefined,
          입주자저축가입기간: String(pick(row, map, "청약통장 가입기간 배점") ?? "").trim() || undefined,
        };
        rec.rankBaseDate = String(pick(row, map, "순위기산일") ?? "").trim() || undefined;
      }

      // 신혼부부: 소득우선구분, 선정순위
      if (meta.special === "신혼부부") {
        rec.maritalInfo = {
          소득우선구분: String(pick(row, map, "소득우선구분(당첨기준)", "소득우선구분(신청기준)", "소득기준 우선공급 구분") ?? "").trim() || undefined,
          선정순위: String(pick(row, map, "선정순위") ?? "").trim() || undefined,
          미성년자녀수: String(pick(row, map, "전체 미성년 자녀수(태아포함)") ?? "").trim() || undefined,
          임신여부: String(pick(row, map, "임신여부") ?? "").trim() || undefined,
          태아수: String(pick(row, map, "태아수") ?? "").trim() || undefined,
        };
      }

      // 생애최초
      if (meta.special === "생애최초") {
        rec.maritalInfo = {
          소득우선구분: String(pick(row, map, "소득우선구분(당첨기준)", "소득우선구분(신청기준)", "소득기준 우선공급 구분") ?? "").trim() || undefined,
          신청유형: String(pick(row, map, "생애최초 신청 유형") ?? "").trim() || undefined,
        };
      }

      // 기관추천
      if (meta.special === "기관추천") {
        rec.institution = String(pick(row, map, "추천구분") ?? "").trim() || undefined;
        rec.institutionSubType = String(pick(row, map, "기관추천 특별공급 종류코드") ?? "").trim() || undefined;
      }

      // 이전기관
      if (meta.special === "이전기관") {
        rec.affiliation = String(pick(row, map, "소속기관") ?? "").trim() || undefined;
        rec.position = String(pick(row, map, "직위(직급)") ?? "").trim() || undefined;
      }

      winners.push(rec);
    }
  }

  return {
    fileName,
    kind: masked ? "lottery-results-masked" : "lottery-results",
    winners,
    householdMembers: [],
    properties: [],
    savings: [],
    label: masked ? "전산추첨결과 (마스킹본)" : "전산추첨결과",
    notes,
  };
}

/* ─────────────────────────────────────────────────────────────
   5. 파서 — 세대원내역
   ───────────────────────────────────────────────────────────── */

export function parseHouseholdMembers(wb: XLSXWorkBook, fileName: string): FileIngestResult {
  const household: HouseholdMemberRecord[] = [];
  const notes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = sheetRows(sheet);
    const headerIdx = findHeaderRow(rows, ["요청성명", "요청주민등록번호", "세대원성명", "세대원주민등록번호"], 3);
    if (headerIdx === -1) continue;
    const map = buildColMap(rows[headerIdx]);

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c === "" || c === null)) continue;
      const rn = normalizeRrn(pick(row, map, "요청주민등록번호"));
      const mn = normalizeRrn(pick(row, map, "세대원주민등록번호"));
      const rname = normalizeName(pick(row, map, "요청성명"));
      const mname = normalizeName(pick(row, map, "세대원성명"));
      if (!rn || !rname) continue;
      household.push({
        requesterRrn: rn,
        requesterName: rname,
        memberName: mname,
        memberRrn: mn || "",
        errorCode: String(pick(row, map, "오류구분코드") ?? "").trim() || undefined,
      });
    }
  }

  return {
    fileName,
    kind: "household-members",
    winners: [],
    householdMembers: household,
    properties: [],
    savings: [],
    label: `세대원내역 (${household.length}건)`,
    notes,
  };
}

/* ─────────────────────────────────────────────────────────────
   6. 파서 — 주택소유 전산검색
   ───────────────────────────────────────────────────────────── */

export function parsePropertyOwnership(wb: XLSXWorkBook, fileName: string): FileIngestResult {
  const properties: PropertyOwnershipRecord[] = [];
  const notes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = sheetRows(sheet);
    const headerIdx = findHeaderRow(rows, ["주민등록번호", "성명", "물건지주소"], 2);
    if (headerIdx === -1) continue;
    const map = buildColMap(rows[headerIdx]);

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c === "" || c === null)) continue;
      const rrn = normalizeRrn(pick(row, map, "주민등록번호"));
      const name = normalizeName(pick(row, map, "성명"));
      const address = String(pick(row, map, "물건지주소") ?? "").trim();
      if (!rrn || !address) continue;

      properties.push({
        ownerRrn: rrn,
        ownerName: name,
        identifier: String(pick(row, map, "식별번호") ?? "").trim() || undefined,
        address,
        zipCode: String(pick(row, map, "우편번호") ?? "").trim() || undefined,
        areaM2: toNum(pick(row, map, "면적")),
        acquiredDate: String(pick(row, map, "취득일") ?? "").trim() || undefined,
        transferredDate: String(pick(row, map, "양도일") ?? "").trim() || undefined,
        usage: String(pick(row, map, "용도 등", "용도") ?? "").trim() || undefined,
        changeReason: String(pick(row, map, "건축물대장상 소유권등 변동원인") ?? "").trim() || undefined,
        changeDate: String(pick(row, map, "건축물대장상 소유권등 변동일") ?? "").trim() || undefined,
        saleReportDate: String(pick(row, map, "매매신고일") ?? "").trim() || undefined,
        contractDate: String(pick(row, map, "계약일") ?? "").trim() || undefined,
        paymentDate: String(pick(row, map, "잔금지급일") ?? "").trim() || undefined,
        rightsType: String(pick(row, map, "권리구분") ?? "").trim() || undefined,
        buySell: String(pick(row, map, "매수매도구분") ?? "").trim() || undefined,
      });
    }
  }

  return {
    fileName,
    kind: "property-ownership",
    winners: [],
    householdMembers: [],
    properties,
    savings: [],
    label: `주택소유 전산검색 (${properties.length}건)`,
    notes,
  };
}

/* ─────────────────────────────────────────────────────────────
   7. 파서 — 정당 확인용
   ───────────────────────────────────────────────────────────── */

export function parseConfirmationList(wb: XLSXWorkBook, fileName: string): FileIngestResult {
  const winners: WinnerRecord[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = sheetRows(sheet);
    const headerIdx = findHeaderRow(rows, ["성명", "주택형", "순위"], 2);
    if (headerIdx === -1) continue;
    const map = buildColMap(rows[headerIdx]);

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c === "" || c === null)) continue;
      const name = normalizeName(pick(row, map, "성명"));
      if (!name) continue;

      const common = extractCommonWinnerFields(row, map);
      winners.push({
        ...common,
        name,
        supplyCategory: "일반공급",
        rank: String(pick(row, map, "순위") ?? "").trim() || undefined,
        lotteryType: String(pick(row, map, "당첨구분") ?? "").trim() || undefined,
        housingOwnership: String(pick(row, map, "주택소유구분") ?? "").trim() || undefined,
        scores: {
          총점: toNum(pick(row, map, "총점")),
          가점: toNum(pick(row, map, "가점")),
          무주택기간: String(pick(row, map, "무주택기간") ?? "").trim() || undefined,
          부양가족수: String(pick(row, map, "부양가족수") ?? "").trim() || undefined,
          입주자저축가입기간: String(pick(row, map, "입주자저축가입기간") ?? "").trim() || undefined,
        },
        sourceFiles: [fileName],
      });
    }
  }
  return {
    fileName,
    kind: "confirmation-list",
    winners,
    householdMembers: [],
    properties: [],
    savings: [],
    label: `정당 확인용 (${winners.length}명)`,
    notes: [],
  };
}

/* ─────────────────────────────────────────────────────────────
   8. 파서 — 인포용 명단
   ───────────────────────────────────────────────────────────── */

export function parseInfoDeskList(wb: XLSXWorkBook, fileName: string): FileIngestResult {
  const winners: WinnerRecord[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = sheetRows(sheet);
    const headerIdx = findHeaderRow(rows, ["성명", "주택형"], 2);
    if (headerIdx === -1) continue;
    const map = buildColMap(rows[headerIdx]);

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c === "" || c === null)) continue;
      const name = normalizeName(pick(row, map, "성명"));
      if (!name) continue;
      const specialRaw = String(pick(row, map, "특별공급 종류", "특별공급종류") ?? "");
      winners.push({
        name,
        announcementNo: String(pick(row, map, "주택관리번호") ?? "").trim() || undefined,
        unitType: String(pick(row, map, "주택형") ?? "").trim() || undefined,
        dong: String(pick(row, map, "동수", "동") ?? "").trim() || undefined,
        ho: String(pick(row, map, "호수", "호") ?? "").trim() || undefined,
        specialType: normalizeSpecialType(specialRaw),
        supplyCategory: specialRaw && /일반/.test(specialRaw) ? "일반공급" : (specialRaw ? "특별공급" : undefined),
        sourceFiles: [fileName],
      });
    }
  }
  return {
    fileName,
    kind: "info-desk",
    winners,
    householdMembers: [],
    properties: [],
    savings: [],
    label: `인포용 명단 (${winners.length}명)`,
    notes: [],
  };
}

/* ─────────────────────────────────────────────────────────────
   9. 파서 — 추가 예비입주자
   ───────────────────────────────────────────────────────────── */

export function parseAdditionalStandbys(wb: XLSXWorkBook, fileName: string): FileIngestResult {
  // 시트 이름은 "특별공급예비" / "일반공급예비"
  // 컬럼은 전산추첨결과의 예비입주자 시트와 거의 동일
  const winners: WinnerRecord[] = [];
  for (const sheetName of wb.SheetNames) {
    const isGeneral = /일반공급/.test(sheetName);
    const sheet = wb.Sheets[sheetName];
    const rows = sheetRows(sheet);
    const headerIdx = findHeaderRow(rows, ["성명", "주택형"], 2);
    if (headerIdx === -1) continue;
    const map = buildColMap(rows[headerIdx]);

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c === "" || c === null)) continue;
      const name = normalizeName(pick(row, map, "성명"));
      if (!name) continue;
      const specialRaw = String(pick(row, map, "특별공급 종류", "특별공급종류") ?? "");
      const common = extractCommonWinnerFields(row, map);
      winners.push({
        ...common,
        name,
        supplyCategory: isGeneral ? "일반공급" : "특별공급",
        specialType: isGeneral ? undefined : normalizeSpecialType(specialRaw),
        isStandby: true,
        standbyRank: String(pick(row, map, "예비순위", "예비순번") ?? "").trim() || undefined,
        sourceFiles: [fileName],
      });
    }
  }
  return {
    fileName,
    kind: "additional-standbys",
    winners,
    householdMembers: [],
    properties: [],
    savings: [],
    label: `추가 예비입주자 (${winners.length}명)`,
    notes: [],
  };
}

/* ─────────────────────────────────────────────────────────────
   10. 파서 — 당첨자현황 PDF
   ───────────────────────────────────────────────────────────── */

export function parseWinnerPdfText(text: string, fileName: string): FileIngestResult {
  const winners: WinnerRecord[] = [];

  // 특별공급 행: "1 059.9660 생애최초특별공급 103 401 김*형 961101-1****** 010-2698-7887"
  // 일반공급 행: "1 059.9660 52028187 103 301 최*정 820130-2****** 010-8964-5105 004 국민 04 종합저축 95750701102899 1"
  //   — 접수번호(8자리 숫자), 순위(끝) 포함
  const specialRegex = /(\d+)\s+([\d.]+[A-Z]?)\s+(\S*?특별공급|\S*?신생아\S*)\s+(\d+)\s+(\d+)\s+([가-힣*]+)\s+(\d{6})[-–]([\d*]{7})\s+(01[016789][\s.-]?\d{3,4}[\s.-]?\d{4})/g;
  const generalRegex = /(\d+)\s+([\d.]+[A-Z]?)\s+(\d{8})\s+(\d+)\s+(\d+)\s+([가-힣*]+)\s+(\d{6})[-–]([\d*]{7})\s+(01[016789][\s.-]?\d{3,4}[\s.-]?\d{4})/g;

  // 현재 처리 중인 섹션 판별용
  const generalStart = text.indexOf("일반공급 당첨자 명단");
  const specialText = generalStart > 0 ? text.slice(0, generalStart) : text;
  const generalText = generalStart > 0 ? text.slice(generalStart) : "";

  let m: RegExpExecArray | null;

  // 특별공급
  const specialSeen = new Set<string>();
  while ((m = specialRegex.exec(specialText)) !== null) {
    const [, , unit, supply, dong, ho, name, rrnFront, rrnBack, phoneRaw] = m;
    const key = `${name}:${phoneRaw}`;
    if (specialSeen.has(key)) continue;
    specialSeen.add(key);
    winners.push({
      name,
      rrnMasked: `${rrnFront}-${rrnBack}`,
      rrn: /^[\d]+$/.test(rrnBack) ? `${rrnFront}${rrnBack}` : undefined, // 마스킹 없이 완전 숫자일 경우
      unitType: unit,
      dong,
      ho,
      phone: normalizePhone(phoneRaw),
      supplyCategory: "특별공급",
      specialType: normalizeSpecialType(supply),
      sourceFiles: [fileName],
    });
  }

  // 일반공급
  const generalSeen = new Set<string>();
  while ((m = generalRegex.exec(generalText)) !== null) {
    const [, , unit, applyNo, dong, ho, name, rrnFront, rrnBack, phoneRaw] = m;
    const key = `${name}:${phoneRaw}`;
    if (generalSeen.has(key)) continue;
    generalSeen.add(key);
    winners.push({
      name,
      rrnMasked: `${rrnFront}-${rrnBack}`,
      rrn: /^[\d]+$/.test(rrnBack) ? `${rrnFront}${rrnBack}` : undefined,
      unitType: unit,
      dong,
      ho,
      phone: normalizePhone(phoneRaw),
      supplyCategory: "일반공급",
      sourceFiles: [fileName],
    });
    void applyNo;
  }

  // 공고번호 / 발표일 추출
  const annoMatch = text.match(/관리번호\s*[:：]?\s*(\d{4}[-–]?\d+)/);
  const dateMatch = text.match(/당첨자발표일\s*[:：]?\s*(\d{4}[.\-]\d{2}[.\-]\d{2})/);

  return {
    fileName,
    kind: "winner-pdf",
    winners: winners.map((w) => ({
      ...w,
      announcementNo: annoMatch ? annoMatch[1].replace(/[-–]/g, "") : undefined,
      announcementDate: dateMatch ? dateMatch[1].replace(/[.\-]/g, "") : undefined,
    })),
    householdMembers: [],
    properties: [],
    savings: [],
    label: `당첨자현황 PDF (${winners.length}명)`,
    notes: winners.length === 0 ? ["PDF에서 당첨자 행을 인식하지 못했습니다"] : [],
  };
}

/* ─────────────────────────────────────────────────────────────
   11. 파서 — 입주자저축 순위확인 통보 PDF
   ───────────────────────────────────────────────────────────── */

export function parseSavingsPriorityPdfText(text: string, fileName: string): FileIngestResult {
  const savings: SavingsPriorityRecord[] = [];
  // 레코드 형식 예:
  // "0000001 2024000240 6303032105616 엄미옥 003 20240531 O 20240531 70) 검증완료"
  // "0000003 2024000240 7106192822610 김민지 11 20240531 O 20240531 63) 오류 계좌개설은행코드 ..."
  const regex = /\d{7}\s+(\d{10})\s+(\d{13})\s+([가-힣]{2,5})\s+(\d{1,3})\s+(\d{8})\s+(\S)\s+(\d{8})\s+(\d{2})\)\s*(검증완료|오류)(?:\s+([^\d\n]{1,60}))?/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const [, , rrn, name, bankCode, annoDate, specialCode, firstLifeDate, resultLen, result, errorNote] = m;
    savings.push({
      rrn,
      name,
      bankCode,
      announcementDate: annoDate,
      specialSupplyCode: specialCode,
      firstLifeDate,
      resultLength: parseInt(resultLen, 10),
      verified: result === "검증완료",
      errorNote: errorNote?.trim() || undefined,
    });
  }

  return {
    fileName,
    kind: "savings-priority-pdf",
    winners: [],
    householdMembers: [],
    properties: [],
    savings,
    label: `입주자저축 순위확인 (${savings.length}건)`,
    notes: savings.length === 0 ? ["검증 결과 레코드를 인식하지 못했습니다"] : [],
  };
}

/* ─────────────────────────────────────────────────────────────
   12. 통합 (consolidator)
   ───────────────────────────────────────────────────────────── */

/** name + phone → profile lookup key (주민번호 없는 PDF 레코드용) */
function nameKey(name?: string, phone?: string): string {
  return `${(name || "").trim()}|${(phone || "").replace(/\D/g, "")}`;
}

/** 보조: 더 구체적인 값으로 덮어쓰기 (이전 값이 비어있을 때만) */
function fillIfEmpty<T extends Record<string, any>>(target: T, patch: Partial<T>): T {
  for (const k of Object.keys(patch)) {
    const cur = (target as any)[k];
    const nxt = (patch as any)[k];
    if (nxt === undefined || nxt === null || nxt === "") continue;
    if (cur === undefined || cur === null || cur === "") {
      (target as any)[k] = nxt;
    } else if (typeof cur === "object" && typeof nxt === "object" && !Array.isArray(cur)) {
      (target as any)[k] = { ...nxt, ...cur }; // 하위 객체도 병합 (기존값 우선)
    }
  }
  return target;
}

export function consolidate(files: FileIngestResult[]): ConsolidatedResult {
  const profilesByRrn = new Map<string, WinnerProfile>();
  const profilesByNameKey = new Map<string, WinnerProfile>();
  const unmatchedWinners: WinnerRecord[] = [];
  const unmatchedHousehold: HouseholdMemberRecord[] = [];
  const unmatchedProperties: PropertyOwnershipRecord[] = [];
  const announcementNos = new Set<string>();
  const announcementDates = new Set<string>();

  // 1단계: 당첨자 레코드 병합
  for (const file of files) {
    for (const w of file.winners) {
      if (w.announcementNo) announcementNos.add(w.announcementNo);
      if (w.announcementDate) announcementDates.add(w.announcementDate);

      let profile: WinnerProfile | undefined;
      if (w.rrn) {
        profile = profilesByRrn.get(w.rrn);
        if (!profile) {
          profile = { ...w, sourceKinds: [file.kind], sourceFiles: [file.fileName] };
          profilesByRrn.set(w.rrn, profile);
          // 이름+전화로도 매칭될 수 있으니 index
          const nk = nameKey(w.name, w.phone);
          if (nk !== "|") profilesByNameKey.set(nk, profile);
          continue;
        }
      } else {
        const nk = nameKey(w.name, w.phone);
        profile = profilesByNameKey.get(nk);
        if (!profile) {
          profile = { ...w, sourceKinds: [file.kind], sourceFiles: [file.fileName] };
          if (nk !== "|") profilesByNameKey.set(nk, profile);
          continue;
        }
      }
      // 기존 프로필 병합
      fillIfEmpty(profile, w);
      if (profile.sourceKinds && !profile.sourceKinds.includes(file.kind)) {
        profile.sourceKinds.push(file.kind);
      }
      if (profile.sourceFiles && !profile.sourceFiles.includes(file.fileName)) {
        profile.sourceFiles.push(file.fileName);
      }
    }
  }

  // 2단계: 세대원 연결 — 요청자 주민번호 기준
  for (const file of files) {
    for (const h of file.householdMembers) {
      const profile = profilesByRrn.get(h.requesterRrn);
      if (!profile) {
        // 아직 프로필이 없으면 이름+주민번호로 임시 프로필 생성 (고객 미등록 상태 대비)
        const provisional: WinnerProfile = {
          name: h.requesterName,
          rrn: h.requesterRrn,
          householdMembers: [h],
          sourceKinds: [file.kind],
          sourceFiles: [file.fileName],
        };
        profilesByRrn.set(h.requesterRrn, provisional);
        continue;
      }
      if (!profile.householdMembers) profile.householdMembers = [];
      // 중복 방지 (세대원 주민번호 기준)
      if (!profile.householdMembers.some((m) => m.memberRrn === h.memberRrn)) {
        profile.householdMembers.push(h);
      }
      if (profile.sourceKinds && !profile.sourceKinds.includes(file.kind)) {
        profile.sourceKinds.push(file.kind);
      }
    }
  }

  // 3단계: 주택소유 연결 — 소유자 주민번호 기준 (당첨자 본인 + 세대원 둘 다 매칭)
  for (const file of files) {
    for (const p of file.properties) {
      // 직접 프로필에 매칭
      const profile = profilesByRrn.get(p.ownerRrn);
      if (profile) {
        if (!profile.properties) profile.properties = [];
        profile.properties.push(p);
        if (profile.sourceKinds && !profile.sourceKinds.includes(file.kind)) {
          profile.sourceKinds.push(file.kind);
        }
        continue;
      }
      // 세대원 중 매칭되는 프로필 찾기
      let attached = false;
      profilesByRrn.forEach((prof) => {
        if (attached) return;
        if (prof.householdMembers?.some((m) => m.memberRrn === p.ownerRrn)) {
          if (!prof.properties) prof.properties = [];
          prof.properties.push(p);
          if (prof.sourceKinds && !prof.sourceKinds.includes(file.kind)) {
            prof.sourceKinds.push(file.kind);
          }
          attached = true;
        }
      });
      if (!attached) unmatchedProperties.push(p);
    }
  }

  // 4단계: 청약통장 순위확인 연결
  for (const file of files) {
    for (const s of file.savings) {
      const profile = profilesByRrn.get(s.rrn);
      if (profile) {
        profile.savingsPriority = s;
        if (profile.sourceKinds && !profile.sourceKinds.includes(file.kind)) {
          profile.sourceKinds.push(file.kind);
        }
      } else {
        // 미매칭 청약통장은 임시 프로필로 생성
        const provisional: WinnerProfile = {
          name: s.name,
          rrn: s.rrn,
          savingsPriority: s,
          sourceKinds: [file.kind],
          sourceFiles: [file.fileName],
        };
        profilesByRrn.set(s.rrn, provisional);
      }
    }
  }

  // 이름+전화 기준 중복 제거 (주민번호 확인 후 이름키로만 저장된 프로필이 주민번호 프로필과 중복된 경우)
  const dedupProfiles: WinnerProfile[] = [];
  const seen = new Set<WinnerProfile>();
  profilesByRrn.forEach((p) => {
    dedupProfiles.push(p);
    seen.add(p);
  });
  profilesByNameKey.forEach((p) => {
    if (!seen.has(p)) {
      dedupProfiles.push(p);
      seen.add(p);
    }
  });

  return {
    profiles: dedupProfiles,
    files,
    unmatched: {
      winners: unmatchedWinners,
      household: unmatchedHousehold,
      properties: unmatchedProperties,
    },
    announcement: {
      no: Array.from(announcementNos)[0],
      date: Array.from(announcementDates)[0],
    },
  };
}

/* ─────────────────────────────────────────────────────────────
   13. 최상위 파이프라인 — File[] → ConsolidatedResult
   ───────────────────────────────────────────────────────────── */

/** PDF 텍스트 추출기 (UI 쪽에서 서버 API 호출 후 넘겨줌) */
export type PdfTextExtractor = (file: File) => Promise<string>;

export async function ingestFiles(
  files: File[],
  extractPdfText: PdfTextExtractor,
): Promise<ConsolidatedResult> {
  const results: FileIngestResult[] = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith(".pdf")) {
        const text = await extractPdfText(file);
        const kind = classifyPdfText(text, file.name);
        if (kind === "winner-pdf") {
          results.push(parseWinnerPdfText(text, file.name));
        } else if (kind === "savings-priority-pdf") {
          results.push(parseSavingsPriorityPdfText(text, file.name));
        } else {
          results.push({
            fileName: file.name,
            kind: "unknown",
            winners: [],
            householdMembers: [],
            properties: [],
            savings: [],
            label: "알 수 없는 PDF",
            notes: ["PDF 종류를 식별하지 못했습니다"],
          });
        }
      } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
        const xlsx = await ensureXlsx();
        const buf = new Uint8Array(await file.arrayBuffer());
        const wb = xlsx.read(buf, { type: "array" });
        const kind = classifyXlsx(wb, file.name);
        switch (kind) {
          case "lottery-results":
            results.push(parseLotteryResults(wb, file.name, false));
            break;
          case "lottery-results-masked":
            results.push(parseLotteryResults(wb, file.name, true));
            break;
          case "household-members":
            results.push(parseHouseholdMembers(wb, file.name));
            break;
          case "property-ownership":
            results.push(parsePropertyOwnership(wb, file.name));
            break;
          case "confirmation-list":
            results.push(parseConfirmationList(wb, file.name));
            break;
          case "info-desk":
            results.push(parseInfoDeskList(wb, file.name));
            break;
          case "additional-standbys":
            results.push(parseAdditionalStandbys(wb, file.name));
            break;
          default:
            results.push({
              fileName: file.name,
              kind: "unknown",
              winners: [],
              householdMembers: [],
              properties: [],
              savings: [],
              label: "알 수 없는 엑셀",
              notes: [`시트: ${wb.SheetNames.join(", ")}`],
            });
        }
      } else {
        results.push({
          fileName: file.name,
          kind: "unknown",
          winners: [],
          householdMembers: [],
          properties: [],
          savings: [],
          label: "미지원 파일 형식",
          notes: [],
        });
      }
    } catch (err: any) {
      results.push({
        fileName: file.name,
        kind: "unknown",
        winners: [],
        householdMembers: [],
        properties: [],
        savings: [],
        label: "파싱 실패",
        notes: [err?.message || "알 수 없는 에러"],
      });
    }
  }

  return consolidate(results);
}

/* ─────────────────────────────────────────────────────────────
   14. WinnerProfile → LocalCustomer 변환 (고객 등록용)
   ───────────────────────────────────────────────────────────── */

/** 주택형 코드 → 전용면적 ㎡ 표기 파생 */
function deriveUnitArea(code?: string): string | undefined {
  if (!code) return undefined;
  const m = code.match(/^0?(\d{2,3})(?:\.(\d{2,4}))?/);
  if (!m) return undefined;
  const whole = parseInt(m[1], 10);
  const frac = m[2] ? Number(`0.${m[2]}`) : 0;
  const area = whole + frac;
  return `${area.toFixed(2)}㎡`;
}

/** Consolidated 프로필을 고객 등록 payload 형태로 변환 */
export function profileToCustomerPayload(
  profile: WinnerProfile,
): {
  name: string;
  phone: string;
  rrn_front: string;
  rrn_back: string;
  address: string;
  no_home_years: number;
  dependents_count: number;
  subscription_months: number;
  current_region: string;
  income_monthly: number | null;
  special_types: string[];
  supply_type: string;
  unit_type?: string;
  unit_area?: string;
} {
  const specialTypes = profile.specialType ? [profile.specialType] : [];
  const supplyType =
    profile.supplyCategory === "일반공급"
      ? "일반공급"
      : profile.specialType || "일반공급";

  // 세대원 수 → 부양가족 수 (본인 제외)
  const dependents = profile.householdMembers
    ? Math.max(0, profile.householdMembers.filter((m) => m.memberRrn !== profile.rrn).length)
    : 0;

  // 주택소유 기반 무주택 여부: 양도일 없이 취득일만 있으면 보유중 → 무주택 아님
  const ownedProperties = (profile.properties || []).filter((p) => !p.transferredDate);
  const noHomeYears = ownedProperties.length === 0 ? 5 : 0; // 정확한 계산은 업무용 입력이 더 정확 — 기본 5년으로 시드

  return {
    name: profile.name,
    phone: profile.phone || "",
    rrn_front: profile.rrn ? profile.rrn.slice(0, 6) : "",
    rrn_back: profile.rrn ? profile.rrn.slice(6) : "0000000",
    address: profile.address || "",
    no_home_years: noHomeYears,
    dependents_count: dependents,
    subscription_months: 0, // 수작업 검증 후 기입
    current_region: profile.regionLocal?.replace(/^\(\d+\)/, "") || "",
    income_monthly: null,
    special_types: specialTypes as string[],
    supply_type: supplyType,
    unit_type: profile.unitType,
    unit_area: deriveUnitArea(profile.unitType),
  };
}
