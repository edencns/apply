/** 단계 key — URL ?stage=X 와 1:1 매핑 */
export type StageKey =
  | "registration"
  | "household"
  | "property"
  | "savings"
  | "documents";

export const STAGE_NUMBER: Record<StageKey, number> = {
  registration: 1,
  household: 2,
  property: 3,
  savings: 4,
  documents: 5,
};

export const STAGE_BY_NUMBER: Record<number, StageKey> = {
  1: "registration",
  2: "household",
  3: "property",
  4: "savings",
  5: "documents",
};

export function parseStageParam(raw: string | null): StageKey {
  if (!raw) return "registration";
  const n = Number(raw);
  if (!Number.isNaN(n) && STAGE_BY_NUMBER[n]) return STAGE_BY_NUMBER[n];
  if ((raw as StageKey) in STAGE_NUMBER) return raw as StageKey;
  return "registration";
}
