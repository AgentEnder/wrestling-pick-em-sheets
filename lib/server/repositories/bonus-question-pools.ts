import { randomUUID } from "crypto";

import type { Insertable, Selectable, Updateable } from "kysely";

import { db } from "@/lib/server/db/client";
import type {
  BonusQuestionPools,
  BonusQuestionTemplates,
} from "@/lib/server/db/generated";
import { requireDbId } from "@/lib/server/db/types";
import type {
  BonusPoolRuleSet,
  BonusQuestionPool,
  BonusQuestionTemplate,
  BonusQuestionValueType,
} from "@/lib/types";

type BonusQuestionPoolSelectable = Selectable<BonusQuestionPools>;
type BonusQuestionTemplateSelectable = Selectable<BonusQuestionTemplates>;

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

function normalizeMatchTypeIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];

  const uniqueIds: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of value) {
    if (typeof rawValue !== "string") continue;

    const trimmed = rawValue.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;

    seen.add(trimmed);
    uniqueIds.push(trimmed);
  }

  return uniqueIds;
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

function normalizeValueType(
  value: unknown,
  isTimeBased: number | boolean,
  isCountBased: number | boolean,
): BonusQuestionValueType {
  if (value === "numerical" || value === "time" || value === "rosterMember")
    return value;
  if (Number(isTimeBased) === 1) return "time";
  if (Number(isCountBased) === 1) return "numerical";
  return "string";
}

function mapTemplate(
  row: BonusQuestionTemplateSelectable,
): BonusQuestionTemplate {
  const answerType =
    row.answer_type === "multiple-choice" ? "multiple-choice" : "write-in";

  return {
    id: requireDbId(row.id, "bonus_question_templates.id"),
    poolId: row.pool_id,
    label: row.label,
    questionTemplate: row.question_template,
    defaultPoints: row.default_points,
    answerType,
    options:
      answerType === "multiple-choice" ? parseJsonArray(row.options_json) : [],
    valueType: normalizeValueType(
      row.value_type,
      row.is_time_based,
      row.is_count_based,
    ),
    defaultSection: row.default_section === "event" ? "event" : "match",
    sortOrder: row.sort_order,
    isActive: Number(row.is_active) === 1,
  };
}

function mapPool(
  row: BonusQuestionPoolSelectable,
  templates: BonusQuestionTemplate[],
): BonusQuestionPool {
  return {
    id: requireDbId(row.id, "bonus_question_pools.id"),
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    isActive: Number(row.is_active) === 1,
    matchTypeIds: parseJsonArray(row.match_type_ids_json),
    ruleSetIds: normalizeRuleSetIds(parseJsonArray(row.rule_set_ids_json)),
    templates,
  };
}

export async function listBonusQuestionPools(input?: {
  includeInactive?: boolean;
}): Promise<BonusQuestionPool[]> {
  const includeInactive = input?.includeInactive ?? false;

  let poolsQuery = db.selectFrom("bonus_question_pools").selectAll();

  if (!includeInactive) {
    poolsQuery = poolsQuery.where("is_active", "=", 1);
  }

  const poolRows = await poolsQuery
    .orderBy("sort_order", "asc")
    .orderBy("name", "asc")
    .execute();

  if (poolRows.length === 0) {
    return [];
  }

  const poolIds = poolRows.map((row) =>
    requireDbId(row.id, "bonus_question_pools.id"),
  );

  let templatesQuery = db
    .selectFrom("bonus_question_templates")
    .selectAll()
    .where("pool_id", "in", poolIds);

  if (!includeInactive) {
    templatesQuery = templatesQuery.where("is_active", "=", 1);
  }

  const templateRows = await templatesQuery
    .orderBy("sort_order", "asc")
    .orderBy("label", "asc")
    .execute();

  const templatesByPoolId = new Map<string, BonusQuestionTemplate[]>();
  for (const templateRow of templateRows) {
    const template = mapTemplate(templateRow);
    const existing = templatesByPoolId.get(template.poolId);
    if (existing) {
      existing.push(template);
      continue;
    }

    templatesByPoolId.set(template.poolId, [template]);
  }

  return poolRows.map((poolRow) => {
    const poolId = requireDbId(poolRow.id, "bonus_question_pools.id");
    return mapPool(poolRow, templatesByPoolId.get(poolId) ?? []);
  });
}

export async function createBonusQuestionPool(input: {
  name: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  matchTypeIds: string[];
  ruleSetIds: BonusPoolRuleSet[];
}): Promise<BonusQuestionPool> {
  const matchTypeIds = normalizeMatchTypeIds(input.matchTypeIds);
  const ruleSetIds = normalizeRuleSetIds(input.ruleSetIds);
  const now = new Date().toISOString();
  const id = randomUUID();

  const values: Insertable<BonusQuestionPools> = {
    id,
    name: input.name,
    description: input.description,
    sort_order: input.sortOrder,
    is_active: input.isActive ? 1 : 0,
    match_type_ids_json: JSON.stringify(matchTypeIds),
    rule_set_ids_json: JSON.stringify(ruleSetIds),
    created_at: now,
    updated_at: now,
  };

  await db.insertInto("bonus_question_pools").values(values).execute();

  return {
    id,
    name: input.name,
    description: input.description,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
    matchTypeIds,
    ruleSetIds,
    templates: [],
  };
}

export async function updateBonusQuestionPool(
  poolId: string,
  input: {
    name?: string;
    description?: string;
    sortOrder?: number;
    isActive?: boolean;
    matchTypeIds?: string[];
    ruleSetIds?: BonusPoolRuleSet[];
  },
): Promise<boolean> {
  const update: Updateable<BonusQuestionPools> = {
    updated_at: new Date().toISOString(),
  };

  if (input.name !== undefined) update.name = input.name;
  if (input.description !== undefined) update.description = input.description;
  if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;
  if (input.isActive !== undefined) update.is_active = input.isActive ? 1 : 0;
  if (input.matchTypeIds !== undefined) {
    update.match_type_ids_json = JSON.stringify(
      normalizeMatchTypeIds(input.matchTypeIds),
    );
  }
  if (input.ruleSetIds !== undefined) {
    update.rule_set_ids_json = JSON.stringify(
      normalizeRuleSetIds(input.ruleSetIds),
    );
  }

  const result = await db
    .updateTable("bonus_question_pools")
    .set(update)
    .where("id", "=", poolId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0) > 0;
}

export async function deleteBonusQuestionPool(
  poolId: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom("bonus_question_pools")
    .where("id", "=", poolId)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}

export async function createBonusQuestionTemplate(input: {
  poolId: string;
  label: string;
  questionTemplate: string;
  defaultPoints: number | null;
  answerType: "write-in" | "multiple-choice";
  options: string[];
  valueType: BonusQuestionValueType;
  defaultSection: "match" | "event";
  sortOrder: number;
  isActive: boolean;
}): Promise<BonusQuestionTemplate | null> {
  const pool = await db
    .selectFrom("bonus_question_pools")
    .select("id")
    .where("id", "=", input.poolId)
    .executeTakeFirst();

  if (!pool) {
    return null;
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const options = input.answerType === "multiple-choice" ? input.options : [];
  const valueType = normalizeValueType(input.valueType, false, false);
  const isTimeBased = valueType === "time";
  const isCountBased = valueType === "numerical";

  const values: Insertable<BonusQuestionTemplates> = {
    id,
    pool_id: input.poolId,
    label: input.label,
    question_template: input.questionTemplate,
    default_points: input.defaultPoints,
    answer_type: input.answerType,
    options_json: JSON.stringify(options),
    value_type: valueType,
    is_time_based: isTimeBased ? 1 : 0,
    is_count_based: isCountBased ? 1 : 0,
    default_section: input.defaultSection,
    sort_order: input.sortOrder,
    is_active: input.isActive ? 1 : 0,
    created_at: now,
    updated_at: now,
  };

  await db.insertInto("bonus_question_templates").values(values).execute();

  return {
    id,
    poolId: input.poolId,
    label: input.label,
    questionTemplate: input.questionTemplate,
    defaultPoints: input.defaultPoints,
    answerType: input.answerType,
    options,
    valueType,
    defaultSection: input.defaultSection,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  };
}

export async function updateBonusQuestionTemplate(
  templateId: string,
  input: {
    poolId?: string;
    label?: string;
    questionTemplate?: string;
    defaultPoints?: number | null;
    answerType?: "write-in" | "multiple-choice";
    options?: string[];
    valueType?: BonusQuestionValueType;
    defaultSection?: "match" | "event";
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<boolean> {
  if (input.poolId) {
    const pool = await db
      .selectFrom("bonus_question_pools")
      .select("id")
      .where("id", "=", input.poolId)
      .executeTakeFirst();

    if (!pool) {
      return false;
    }
  }

  const update: Updateable<BonusQuestionTemplates> = {
    updated_at: new Date().toISOString(),
  };

  if (input.poolId !== undefined) update.pool_id = input.poolId;
  if (input.label !== undefined) update.label = input.label;
  if (input.questionTemplate !== undefined)
    update.question_template = input.questionTemplate;
  if (input.defaultPoints !== undefined)
    update.default_points = input.defaultPoints;
  if (input.answerType !== undefined) {
    update.answer_type = input.answerType;
    if (input.answerType !== "multiple-choice" && input.options === undefined) {
      update.options_json = "[]";
    }
  }
  if (input.options !== undefined)
    update.options_json = JSON.stringify(input.options);
  if (input.valueType !== undefined) {
    const valueType = normalizeValueType(input.valueType, false, false);
    update.value_type = valueType;
    update.is_time_based = valueType === "time" ? 1 : 0;
    update.is_count_based = valueType === "numerical" ? 1 : 0;
  }
  if (input.defaultSection !== undefined)
    update.default_section = input.defaultSection;
  if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;
  if (input.isActive !== undefined) update.is_active = input.isActive ? 1 : 0;

  const result = await db
    .updateTable("bonus_question_templates")
    .set(update)
    .where("id", "=", templateId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0) > 0;
}

export async function deleteBonusQuestionTemplate(
  templateId: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom("bonus_question_templates")
    .where("id", "=", templateId)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}
