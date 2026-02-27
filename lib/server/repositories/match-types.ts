import { randomUUID } from "crypto";

import type { Insertable, Selectable, Updateable } from "kysely";

import { db } from "@/lib/server/db/client";
import type { MatchTypes } from "@/lib/server/db/generated";
import { requireDbId } from "@/lib/server/db/types";
import type { BonusPoolRuleSet, MatchType } from "@/lib/types";

type MatchTypeSelectable = Selectable<MatchTypes>;

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];

  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
}

function normalizeRuleSetIds(
  value: readonly string[] | undefined,
): BonusPoolRuleSet[] {
  if (!Array.isArray(value)) return [];

  const uniqueIds: BonusPoolRuleSet[] = [];
  const seen = new Set<BonusPoolRuleSet>();

  for (const rawValue of value) {
    if (rawValue !== "timed-entry" && rawValue !== "elimination") continue;
    if (seen.has(rawValue)) continue;

    seen.add(rawValue);
    uniqueIds.push(rawValue);
  }

  return uniqueIds;
}

function mapMatchType(row: MatchTypeSelectable): MatchType {
  const defaultRuleSetIds = normalizeRuleSetIds(
    parseJsonArray(row.default_rule_set_ids_json),
  );

  return {
    id: requireDbId(row.id, "match_types.id"),
    name: row.name,
    sortOrder: row.sort_order,
    isActive: Number(row.is_active) === 1,
    defaultRuleSetIds,
  };
}

export async function listMatchTypes(input?: {
  includeInactive?: boolean;
}): Promise<MatchType[]> {
  const includeInactive = input?.includeInactive ?? false;

  let query = db.selectFrom("match_types").selectAll();

  if (!includeInactive) {
    query = query.where("is_active", "=", 1);
  }

  const rows = await query
    .orderBy("sort_order", "asc")
    .orderBy("name", "asc")
    .execute();

  return rows.map((row) => mapMatchType(row));
}

export async function createMatchType(input: {
  name: string;
  sortOrder: number;
  isActive: boolean;
  defaultRuleSetIds: BonusPoolRuleSet[];
}): Promise<MatchType> {
  const defaultRuleSetIds = normalizeRuleSetIds(input.defaultRuleSetIds);
  const id = randomUUID();
  const now = new Date().toISOString();

  const values: Insertable<MatchTypes> = {
    id,
    name: input.name,
    sort_order: input.sortOrder,
    is_active: input.isActive ? 1 : 0,
    default_rule_set_ids_json: JSON.stringify(defaultRuleSetIds),
    default_is_battle_royal: defaultRuleSetIds.includes("timed-entry") ? 1 : 0,
    created_at: now,
    updated_at: now,
  };

  await db.insertInto("match_types").values(values).execute();

  return {
    id,
    name: input.name,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
    defaultRuleSetIds,
  };
}

export async function updateMatchType(
  matchTypeId: string,
  input: {
    name?: string;
    sortOrder?: number;
    isActive?: boolean;
    defaultRuleSetIds?: BonusPoolRuleSet[];
  },
): Promise<boolean> {
  const update: Updateable<MatchTypes> = {
    updated_at: new Date().toISOString(),
  };

  if (input.name !== undefined) update.name = input.name;
  if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;
  if (input.isActive !== undefined) update.is_active = input.isActive ? 1 : 0;
  if (input.defaultRuleSetIds !== undefined) {
    const defaultRuleSetIds = normalizeRuleSetIds(input.defaultRuleSetIds);
    update.default_rule_set_ids_json = JSON.stringify(defaultRuleSetIds);
    update.default_is_battle_royal = defaultRuleSetIds.includes("timed-entry")
      ? 1
      : 0;
  }

  const result = await db
    .updateTable("match_types")
    .set(update)
    .where("id", "=", matchTypeId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0) > 0;
}

export async function deleteMatchType(matchTypeId: string): Promise<boolean> {
  const result = await db
    .deleteFrom("match_types")
    .where("id", "=", matchTypeId)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}
