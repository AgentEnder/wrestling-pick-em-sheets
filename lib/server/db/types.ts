export type Brand<T, Name extends string> = T & {
  readonly __brand: Name;
};

export type DbId = Brand<string, "DbId">;

export type DbMatchType =
  | Brand<"standard", "DbMatchType">
  | Brand<"battleRoyal", "DbMatchType">;

const STANDARD_MATCH_TYPE = "standard" as DbMatchType;
const BATTLE_ROYAL_MATCH_TYPE = "battleRoyal" as DbMatchType;

export function isDbMatchType(value: unknown): value is DbMatchType {
  return value === "standard" || value === "battleRoyal";
}

export function isDbId(value: unknown): value is DbId {
  return typeof value === "string" && value.length > 0;
}

export function requireDbId(value: unknown, fieldName: string): DbId {
  if (!isDbId(value)) {
    throw new Error(`Invalid database id for ${fieldName}`);
  }

  return value;
}

export function toDbMatchType(value: unknown): DbMatchType {
  return isDbMatchType(value) ? value : STANDARD_MATCH_TYPE;
}

export function isBattleRoyalMatchType(
  value: DbMatchType,
): value is typeof BATTLE_ROYAL_MATCH_TYPE {
  return value === BATTLE_ROYAL_MATCH_TYPE;
}
