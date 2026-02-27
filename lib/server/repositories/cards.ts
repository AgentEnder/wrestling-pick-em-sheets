import { randomUUID } from "crypto";

import {
  DEFAULT_BATTLE_ROYAL_MATCH_TYPE_ID,
  DEFAULT_MATCH_TYPE_ID,
  normalizeMatchTypeId,
} from "@/lib/match-types";
import { db } from "@/lib/server/db/client";
import type {
  CardMatchOverrides,
  CardMatches,
  Cards,
} from "@/lib/server/db/generated";
import { canReadCard, isCardOwner } from "@/lib/server/db/permissions";
import {
  isBattleRoyalMatchType,
  requireDbId,
  toDbMatchType,
  type DbMatchType,
} from "@/lib/server/db/types";
import type {
  BonusGradingRule,
  BonusQuestion,
  BonusQuestionValueType,
  Match,
} from "@/lib/types";
import type { Insertable, Selectable, Updateable } from "kysely";

type CardSelectable = Selectable<Cards>;
type CardMatchSelectable = Selectable<CardMatches>;
type CardMatchOverrideSelectable = Selectable<CardMatchOverrides>;

interface CardRow {
  id: string;
  owner_id: string | null;
  template_card_id: string | null;
  name: string | null;
  event_name: string | null;
  promotion_name: string | null;
  event_date: string | null;
  event_tagline: string | null;
  default_points: number | null;
  tiebreaker_label: string | null;
  tiebreaker_is_time_based: number;
  event_bonus_questions_json: string;
  public: number;
  is_template: number;
  created_at: string;
  updated_at: string;
}

interface CardMatchRow {
  id: string;
  card_id: string;
  sort_order: number;
  match_type: DbMatchType;
  match_type_id: string;
  match_type_name_override: string | null;
  is_elimination_style: number;
  title: string;
  description: string;
  participants_json: string;
  announced_participants_json: string;
  surprise_slots: number | null;
  surprise_points: number | null;
  bonus_questions_json: string;
  points: number | null;
  is_custom: number;
  created_at: string;
  updated_at: string;
}

interface CardMatchOverrideRow {
  id: string;
  card_id: string;
  template_match_id: string;
  hidden: number;
  sort_order: number | null;
  title: string | null;
  description: string | null;
  is_elimination_style: number | null;
  participants_json: string | null;
  announced_participants_json: string | null;
  surprise_slots: number | null;
  surprise_points: number | null;
  bonus_questions_json: string | null;
  points: number | null;
  updated_at: string;
}

interface CardOverrideRow {
  card_id: string;
  name: string | null;
  event_name: string | null;
  promotion_name: string | null;
  event_date: string | null;
  event_tagline: string | null;
  default_points: number | null;
  tiebreaker_label: string | null;
  tiebreaker_is_time_based: number | null;
  event_bonus_questions_json: string | null;
  updated_at: string;
}

export interface CardSummary {
  id: string;
  ownerId: string | null;
  templateCardId: string | null;
  name: string;
  isPublic: boolean;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedCard {
  id: string;
  ownerId: string | null;
  templateCardId: string | null;
  isPublic: boolean;
  isTemplate: boolean;
  name: string;
  eventName: string;
  promotionName: string;
  eventDate: string;
  eventTagline: string;
  defaultPoints: number;
  tiebreakerLabel: string;
  tiebreakerIsTimeBased: boolean;
  matches: Match[];
  eventBonusQuestions: BonusQuestion[];
  createdAt: string;
  updatedAt: string;
}

function asCardRow(row: CardSelectable): CardRow {
  return {
    id: requireDbId(row.id, "cards.id"),
    owner_id: row.owner_id,
    template_card_id: row.template_card_id,
    name: row.name,
    event_name: row.event_name,
    promotion_name: row.promotion_name,
    event_date: row.event_date,
    event_tagline: row.event_tagline,
    default_points: row.default_points,
    tiebreaker_label: row.tiebreaker_label,
    tiebreaker_is_time_based: Number(row.tiebreaker_is_time_based),
    event_bonus_questions_json: row.event_bonus_questions_json,
    public: Number(row.public),
    is_template: Number(row.is_template),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function asCardMatchRow(row: CardMatchSelectable): CardMatchRow {
  return {
    id: requireDbId(row.id, "card_matches.id"),
    card_id: row.card_id,
    sort_order: row.sort_order,
    match_type: toDbMatchType(row.match_type),
    match_type_id:
      typeof row.match_type_id === "string" &&
      row.match_type_id.trim().length > 0
        ? row.match_type_id
        : toDbMatchType(row.match_type) === "battleRoyal"
          ? DEFAULT_BATTLE_ROYAL_MATCH_TYPE_ID
          : DEFAULT_MATCH_TYPE_ID,
    match_type_name_override: row.match_type_name_override,
    is_elimination_style: Number(row.is_elimination_style),
    title: row.title,
    description: row.description,
    participants_json: row.participants_json,
    announced_participants_json: row.announced_participants_json,
    surprise_slots: row.surprise_slots,
    surprise_points: row.surprise_points,
    bonus_questions_json: row.bonus_questions_json,
    points: row.points,
    is_custom: Number(row.is_custom),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function asCardMatchOverrideRow(
  row: CardMatchOverrideSelectable,
): CardMatchOverrideRow {
  return {
    id: requireDbId(row.id, "card_match_overrides.id"),
    card_id: row.card_id,
    template_match_id: row.template_match_id,
    hidden: Number(row.hidden),
    sort_order: row.sort_order,
    title: row.title,
    description: row.description,
    is_elimination_style:
      row.is_elimination_style === null ||
      row.is_elimination_style === undefined
        ? null
        : Number(row.is_elimination_style),
    participants_json: row.participants_json,
    announced_participants_json: row.announced_participants_json,
    surprise_slots: row.surprise_slots,
    surprise_points: row.surprise_points,
    bonus_questions_json: row.bonus_questions_json,
    points: row.points,
    updated_at: row.updated_at,
  };
}

function parseJsonArray<T>(json: string | null | undefined): T[] {
  if (!json) return [];

  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function normalizeBonusQuestion(value: unknown): BonusQuestion | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Partial<BonusQuestion> & {
    isTimeBased?: boolean;
    isCountBased?: boolean;
    gradingMode?: BonusGradingRule;
  };
  const answerType =
    raw.answerType === "multiple-choice" ? "multiple-choice" : "write-in";
  const valueType: BonusQuestionValueType =
    raw.valueType === "numerical" ||
    raw.valueType === "time" ||
    raw.valueType === "rosterMember"
      ? raw.valueType
      : raw.isTimeBased === true
        ? "time"
        : raw.isCountBased === true
          ? "numerical"
          : "string";
  const options = Array.isArray(raw.options)
    ? raw.options
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter((option) => option.length > 0)
    : [];
  const normalizedOptions = answerType === "multiple-choice" ? options : [];
  const gradingRule: BonusGradingRule =
    raw.gradingRule === "closest" ||
    raw.gradingRule === "atOrAbove" ||
    raw.gradingRule === "atOrBelow"
      ? raw.gradingRule
      : raw.gradingMode === "closest" ||
          raw.gradingMode === "atOrAbove" ||
          raw.gradingMode === "atOrBelow"
        ? raw.gradingMode
        : "exact";

  return {
    id: typeof raw.id === "string" ? raw.id : randomUUID(),
    question: typeof raw.question === "string" ? raw.question : "",
    points: typeof raw.points === "number" ? raw.points : null,
    answerType,
    options: normalizedOptions,
    valueType,
    gradingRule,
  };
}

function parseBonusQuestions(json: string | null | undefined): BonusQuestion[] {
  return parseJsonArray<unknown>(json)
    .map((value) => normalizeBonusQuestion(value))
    .filter((value): value is BonusQuestion => value !== null);
}

function mapMatch(match: CardMatchRow): Match {
  const bonusQuestions = parseBonusQuestions(match.bonus_questions_json);
  const isBattleRoyal = isBattleRoyalMatchType(match.match_type);
  const participants = parseJsonArray<string>(match.participants_json);
  const announcedParticipants = parseJsonArray<string>(
    match.announced_participants_json,
  );
  const resolvedParticipants = isBattleRoyal
    ? announcedParticipants.length > 0
      ? announcedParticipants
      : participants
    : participants.length > 0
      ? participants
      : announcedParticipants;

  return {
    id: match.id,
    type: normalizeMatchTypeId(match.match_type_id, isBattleRoyal),
    typeLabelOverride: match.match_type_name_override ?? "",
    isBattleRoyal,
    isEliminationStyle: match.is_elimination_style === 1,
    title: match.title,
    description: match.description,
    participants: resolvedParticipants,
    surpriseSlots: isBattleRoyal ? (match.surprise_slots ?? 0) : 0,
    surpriseEntrantPoints: isBattleRoyal ? match.surprise_points : null,
    bonusQuestions,
    points: match.points,
  };
}

function mapSummary(card: CardRow): CardSummary {
  return {
    id: card.id,
    ownerId: null,
    templateCardId: card.template_card_id,
    name: card.name ?? "Untitled card",
    isPublic: card.public === 1,
    isTemplate: card.is_template === 1,
    createdAt: card.created_at,
    updatedAt: card.updated_at,
  };
}

function resolveCardValue<T>(
  overrideValue: T | null | undefined,
  templateValue: T | null | undefined,
  fallback: T,
): T {
  if (overrideValue !== null && overrideValue !== undefined)
    return overrideValue;
  if (templateValue !== null && templateValue !== undefined)
    return templateValue;
  return fallback;
}

export async function listReadableCards(
  userId: string | null,
): Promise<CardSummary[]> {
  const rows = await db
    .selectFrom("cards")
    .selectAll()
    .where((eb) => canReadCard(eb, userId))
    .orderBy("updated_at", "desc")
    .execute();

  return rows.map((row) => {
    const card = asCardRow(row);
    return {
      ...mapSummary(card),
      ownerId: card.owner_id === userId ? card.owner_id : null,
    };
  });
}

export async function createCardFromTemplate(
  ownerId: string,
  templateCardId: string,
): Promise<CardSummary | null> {
  const template = await db
    .selectFrom("cards")
    .selectAll()
    .where("id", "=", templateCardId)
    .where("is_template", "=", 1)
    .where("public", "=", 1)
    .executeTakeFirst();

  if (!template) return null;

  const now = new Date().toISOString();
  const id = randomUUID();

  await db
    .insertInto("cards")
    .values({
      id,
      owner_id: ownerId,
      template_card_id: templateCardId,
      name: null,
      event_name: null,
      promotion_name: null,
      event_date: null,
      event_tagline: null,
      default_points: null,
      tiebreaker_label: null,
      tiebreaker_is_time_based: 0,
      event_bonus_questions_json: "[]",
      public: 0,
      is_template: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();

  const created = await db
    .selectFrom("cards")
    .selectAll()
    .where("id", "=", id)
    .where((eb) => isCardOwner(eb, ownerId))
    .executeTakeFirstOrThrow();

  return {
    ...mapSummary(asCardRow(created)),
    ownerId,
  };
}

export async function createOwnedCard(
  ownerId: string,
  input?: {
    name?: string;
    isPublic?: boolean;
  },
): Promise<CardSummary> {
  const now = new Date().toISOString();
  const id = randomUUID();

  await db
    .insertInto("cards")
    .values({
      id,
      owner_id: ownerId,
      template_card_id: null,
      name: input?.name?.trim() || null,
      event_name: "",
      promotion_name: "",
      event_date: "",
      event_tagline: "",
      default_points: 1,
      tiebreaker_label: "Main event total match time (mins)",
      tiebreaker_is_time_based: 1,
      event_bonus_questions_json: "[]",
      public: input?.isPublic ? 1 : 0,
      is_template: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();

  const created = await db
    .selectFrom("cards")
    .selectAll()
    .where("id", "=", id)
    .where((eb) => isCardOwner(eb, ownerId))
    .executeTakeFirstOrThrow();

  return {
    ...mapSummary(asCardRow(created)),
    ownerId,
  };
}

export async function updateCardOverrides(
  cardId: string,
  ownerId: string,
  input: {
    name?: string | null;
    eventName?: string | null;
    promotionName?: string | null;
    eventDate?: string | null;
    eventTagline?: string | null;
    defaultPoints?: number | null;
    tiebreakerLabel?: string | null;
    tiebreakerIsTimeBased?: boolean | null;
  },
): Promise<boolean> {
  const card = await db
    .selectFrom("cards")
    .select(["id"])
    .where("id", "=", cardId)
    .where((eb) => isCardOwner(eb, ownerId))
    .executeTakeFirst();

  if (!card) return false;

  const now = new Date().toISOString();

  await db
    .insertInto("card_overrides")
    .values({
      card_id: cardId,
      name: input.name ?? null,
      event_name: input.eventName ?? null,
      promotion_name: input.promotionName ?? null,
      event_date: input.eventDate ?? null,
      event_tagline: input.eventTagline ?? null,
      default_points: input.defaultPoints ?? null,
      tiebreaker_label: input.tiebreakerLabel ?? null,
      tiebreaker_is_time_based:
        input.tiebreakerIsTimeBased === undefined
          ? null
          : input.tiebreakerIsTimeBased
            ? 1
            : 0,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column("card_id").doUpdateSet({
        name: input.name ?? null,
        event_name: input.eventName ?? null,
        promotion_name: input.promotionName ?? null,
        event_date: input.eventDate ?? null,
        event_tagline: input.eventTagline ?? null,
        default_points: input.defaultPoints ?? null,
        tiebreaker_label: input.tiebreakerLabel ?? null,
        tiebreaker_is_time_based:
          input.tiebreakerIsTimeBased === undefined
            ? null
            : input.tiebreakerIsTimeBased
              ? 1
              : 0,
        updated_at: now,
      }),
    )
    .execute();

  await db
    .updateTable("cards")
    .set({ updated_at: now })
    .where("id", "=", cardId)
    .execute();

  return true;
}

export async function findResolvedReadableCardById(
  cardId: string,
  userId: string | null,
): Promise<ResolvedCard | null> {
  const cardRaw = await db
    .selectFrom("cards")
    .selectAll()
    .where("id", "=", cardId)
    .where((eb) => canReadCard(eb, userId))
    .executeTakeFirst();

  if (!cardRaw) return null;

  const card = asCardRow(cardRaw);

  if (!card.template_card_id) {
    const ownMatchesRaw = await db
      .selectFrom("card_matches")
      .selectAll()
      .where("card_id", "=", card.id)
      .orderBy("sort_order", "asc")
      .execute();

    const ownMatches = ownMatchesRaw.map((row) =>
      mapMatch(asCardMatchRow(row)),
    );

    return {
      id: card.id,
      ownerId: card.owner_id === userId ? card.owner_id : null,
      templateCardId: null,
      isPublic: card.public === 1,
      isTemplate: card.is_template === 1,
      name: card.name ?? "Untitled card",
      eventName: card.event_name ?? "",
      promotionName: card.promotion_name ?? "",
      eventDate: card.event_date ?? "",
      eventTagline: card.event_tagline ?? "",
      defaultPoints: card.default_points ?? 1,
      tiebreakerLabel:
        card.tiebreaker_label ?? "Main event total match time (mins)",
      tiebreakerIsTimeBased: card.tiebreaker_is_time_based === 1,
      matches: ownMatches,
      eventBonusQuestions: parseBonusQuestions(card.event_bonus_questions_json),
      createdAt: card.created_at,
      updatedAt: card.updated_at,
    };
  }

  const [templateRaw, overrideRaw] = await Promise.all([
    db
      .selectFrom("cards")
      .selectAll()
      .where("id", "=", card.template_card_id)
      .executeTakeFirst(),
    db
      .selectFrom("card_overrides")
      .selectAll()
      .where("card_id", "=", card.id)
      .executeTakeFirst(),
  ]);

  if (!templateRaw) {
    return {
      id: card.id,
      ownerId: card.owner_id === userId ? card.owner_id : null,
      templateCardId: card.template_card_id,
      isPublic: card.public === 1,
      isTemplate: card.is_template === 1,
      name: "Template unavailable",
      eventName: "",
      promotionName: "",
      eventDate: "",
      eventTagline: "",
      defaultPoints: 1,
      tiebreakerLabel: "Main event total match time (mins)",
      tiebreakerIsTimeBased: false,
      matches: [],
      eventBonusQuestions: [],
      createdAt: card.created_at,
      updatedAt: card.updated_at,
    };
  }

  const template = asCardRow(templateRaw);
  const override = (overrideRaw as CardOverrideRow | undefined) ?? null;

  const [templateMatchRowsRaw, overrideRowsRaw, customRowsRaw] =
    await Promise.all([
      db
        .selectFrom("card_matches")
        .selectAll()
        .where("card_id", "=", template.id)
        .where("is_custom", "=", 0)
        .orderBy("sort_order", "asc")
        .execute(),
      db
        .selectFrom("card_match_overrides")
        .selectAll()
        .where("card_id", "=", card.id)
        .execute(),
      db
        .selectFrom("card_matches")
        .selectAll()
        .where("card_id", "=", card.id)
        .where("is_custom", "=", 1)
        .orderBy("sort_order", "asc")
        .execute(),
    ]);

  const templateMatchRows = templateMatchRowsRaw.map((row) =>
    asCardMatchRow(row),
  );
  const overrideRows = overrideRowsRaw.map((row) =>
    asCardMatchOverrideRow(row),
  );
  const customRows = customRowsRaw.map((row) => asCardMatchRow(row));

  const overridesByTemplateMatchId = new Map<string, CardMatchOverrideRow>();
  for (const matchOverride of overrideRows) {
    overridesByTemplateMatchId.set(
      matchOverride.template_match_id,
      matchOverride,
    );
  }

  const resolvedTemplateMatchRows: CardMatchRow[] = [];
  for (const templateMatch of templateMatchRows) {
    const matchOverride = overridesByTemplateMatchId.get(templateMatch.id);
    if (matchOverride?.hidden === 1) {
      continue;
    }

    const mergedMatch: CardMatchRow = {
      ...templateMatch,
      sort_order: matchOverride?.sort_order ?? templateMatch.sort_order,
      title: matchOverride?.title ?? templateMatch.title,
      description: matchOverride?.description ?? templateMatch.description,
      is_elimination_style:
        matchOverride?.is_elimination_style ??
        templateMatch.is_elimination_style,
      participants_json:
        matchOverride?.participants_json ?? templateMatch.participants_json,
      announced_participants_json:
        matchOverride?.announced_participants_json ??
        templateMatch.announced_participants_json,
      surprise_slots:
        matchOverride?.surprise_slots ?? templateMatch.surprise_slots,
      surprise_points:
        matchOverride?.surprise_points ?? templateMatch.surprise_points,
      bonus_questions_json:
        matchOverride?.bonus_questions_json ??
        templateMatch.bonus_questions_json,
      points: matchOverride?.points ?? templateMatch.points,
    };

    resolvedTemplateMatchRows.push(mergedMatch);
  }

  const mergedRows = [...resolvedTemplateMatchRows, ...customRows].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  return {
    id: card.id,
    ownerId: card.owner_id === userId ? card.owner_id : null,
    templateCardId: card.template_card_id,
    isPublic: card.public === 1,
    isTemplate: card.is_template === 1,
    name: resolveCardValue(override?.name, template.name, "Untitled card"),
    eventName: resolveCardValue(override?.event_name, template.event_name, ""),
    promotionName: resolveCardValue(
      override?.promotion_name,
      template.promotion_name,
      "",
    ),
    eventDate: resolveCardValue(override?.event_date, template.event_date, ""),
    eventTagline: resolveCardValue(
      override?.event_tagline,
      template.event_tagline,
      "",
    ),
    defaultPoints: resolveCardValue(
      override?.default_points,
      template.default_points,
      1,
    ),
    tiebreakerLabel: resolveCardValue(
      override?.tiebreaker_label,
      template.tiebreaker_label,
      "Main event total match time (mins)",
    ),
    tiebreakerIsTimeBased:
      resolveCardValue(
        override?.tiebreaker_is_time_based,
        template.tiebreaker_is_time_based,
        0,
      ) === 1,
    matches: mergedRows.map((row) => mapMatch(row)),
    eventBonusQuestions: parseBonusQuestions(
      resolveCardValue(
        override?.event_bonus_questions_json,
        template.event_bonus_questions_json,
        "[]",
      ),
    ),
    createdAt: card.created_at,
    updatedAt: card.updated_at,
  };
}

function toCardMatchInsert(
  cardId: string,
  match: Match,
  sortOrder: number,
  isCustom: 0 | 1,
  now: string,
): Insertable<CardMatches> {
  const matchTypeId = normalizeMatchTypeId(match.type, match.isBattleRoyal);

  if (match.isBattleRoyal) {
    return {
      id: match.id || randomUUID(),
      card_id: cardId,
      sort_order: sortOrder,
      match_type: "battleRoyal",
      match_type_id: matchTypeId,
      match_type_name_override: match.typeLabelOverride.trim()
        ? match.typeLabelOverride.trim()
        : null,
      is_elimination_style: match.isEliminationStyle ? 1 : 0,
      title: match.title,
      description: match.description,
      participants_json: JSON.stringify(match.participants),
      announced_participants_json: JSON.stringify(match.participants),
      surprise_slots: match.surpriseSlots,
      surprise_points: match.surpriseEntrantPoints,
      bonus_questions_json: JSON.stringify(match.bonusQuestions),
      points: match.points,
      is_custom: isCustom,
      created_at: now,
      updated_at: now,
    };
  }

  return {
    id: match.id || randomUUID(),
    card_id: cardId,
    sort_order: sortOrder,
    match_type: "standard",
    match_type_id: matchTypeId,
    match_type_name_override: match.typeLabelOverride.trim()
      ? match.typeLabelOverride.trim()
      : null,
    is_elimination_style: match.isEliminationStyle ? 1 : 0,
    title: match.title,
    description: match.description,
    participants_json: JSON.stringify(match.participants),
    announced_participants_json: "[]",
    surprise_slots: null,
    surprise_points: null,
    bonus_questions_json: JSON.stringify(match.bonusQuestions),
    points: match.points,
    is_custom: isCustom,
    created_at: now,
    updated_at: now,
  };
}

export async function persistOwnedCardSheet(
  cardId: string,
  ownerId: string,
  input: {
    eventName: string;
    promotionName: string;
    eventDate: string;
    eventTagline: string;
    defaultPoints: number;
    tiebreakerLabel: string;
    tiebreakerIsTimeBased: boolean;
    matches: Match[];
    eventBonusQuestions: BonusQuestion[];
  },
): Promise<ResolvedCard | null> {
  const card = await db
    .selectFrom("cards")
    .select(["id", "template_card_id"])
    .where("id", "=", cardId)
    .where((eb) => isCardOwner(eb, ownerId))
    .executeTakeFirst();

  if (!card) return null;

  const now = new Date().toISOString();
  const name = input.eventName.trim() ? input.eventName.trim() : null;

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("cards")
      .set({
        name,
        event_name: card.template_card_id ? null : input.eventName,
        promotion_name: card.template_card_id ? null : input.promotionName,
        event_date: card.template_card_id ? null : input.eventDate,
        event_tagline: card.template_card_id ? null : input.eventTagline,
        default_points: card.template_card_id ? null : input.defaultPoints,
        tiebreaker_label: card.template_card_id ? null : input.tiebreakerLabel,
        tiebreaker_is_time_based: card.template_card_id
          ? 0
          : input.tiebreakerIsTimeBased
            ? 1
            : 0,
        event_bonus_questions_json: card.template_card_id
          ? "[]"
          : JSON.stringify(input.eventBonusQuestions),
        updated_at: now,
      })
      .where("id", "=", cardId)
      .execute();

    if (card.template_card_id) {
      await trx
        .insertInto("card_overrides")
        .values({
          card_id: cardId,
          name,
          event_name: input.eventName,
          promotion_name: input.promotionName,
          event_date: input.eventDate,
          event_tagline: input.eventTagline,
          default_points: input.defaultPoints,
          tiebreaker_label: input.tiebreakerLabel,
          tiebreaker_is_time_based: input.tiebreakerIsTimeBased ? 1 : 0,
          event_bonus_questions_json: JSON.stringify(input.eventBonusQuestions),
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column("card_id").doUpdateSet({
            name,
            event_name: input.eventName,
            promotion_name: input.promotionName,
            event_date: input.eventDate,
            event_tagline: input.eventTagline,
            default_points: input.defaultPoints,
            tiebreaker_label: input.tiebreakerLabel,
            tiebreaker_is_time_based: input.tiebreakerIsTimeBased ? 1 : 0,
            event_bonus_questions_json: JSON.stringify(
              input.eventBonusQuestions,
            ),
            updated_at: now,
          }),
        )
        .execute();

      const templateMatches = await trx
        .selectFrom("card_matches")
        .select(["id"])
        .where("card_id", "=", card.template_card_id)
        .where("is_custom", "=", 0)
        .execute();

      await trx
        .deleteFrom("card_match_overrides")
        .where("card_id", "=", cardId)
        .execute();

      if (templateMatches.length > 0) {
        await trx
          .insertInto("card_match_overrides")
          .values(
            templateMatches.map((templateMatch) => ({
              id: randomUUID(),
              card_id: cardId,
              template_match_id: requireDbId(
                templateMatch.id,
                "card_matches.id",
              ),
              hidden: 1,
              sort_order: null,
              title: null,
              description: null,
              is_elimination_style: null,
              participants_json: null,
              announced_participants_json: null,
              surprise_slots: null,
              surprise_points: null,
              bonus_questions_json: null,
              points: null,
              updated_at: now,
            })),
          )
          .execute();
      }

      await trx
        .deleteFrom("card_matches")
        .where("card_id", "=", cardId)
        .where("is_custom", "=", 1)
        .execute();

      if (input.matches.length > 0) {
        await trx
          .insertInto("card_matches")
          .values(
            input.matches.map((match, index) =>
              toCardMatchInsert(cardId, match, index + 1, 1, now),
            ),
          )
          .execute();
      }

      return;
    }

    await trx
      .deleteFrom("card_overrides")
      .where("card_id", "=", cardId)
      .execute();

    await trx
      .deleteFrom("card_match_overrides")
      .where("card_id", "=", cardId)
      .execute();

    await trx
      .deleteFrom("card_matches")
      .where("card_id", "=", cardId)
      .execute();

    if (input.matches.length > 0) {
      await trx
        .insertInto("card_matches")
        .values(
          input.matches.map((match, index) =>
            toCardMatchInsert(cardId, match, index + 1, 0, now),
          ),
        )
        .execute();
    }
  });

  return findResolvedReadableCardById(cardId, ownerId);
}

export async function listTemplateCardsForAdmin(): Promise<CardSummary[]> {
  const rows = await db
    .selectFrom("cards")
    .selectAll()
    .where("is_template", "=", 1)
    .orderBy("updated_at", "desc")
    .execute();

  return rows.map((row) => {
    const card = asCardRow(row);
    return {
      ...mapSummary(card),
      ownerId: card.owner_id,
    };
  });
}

export async function createTemplateCardForAdmin(
  ownerId: string,
  input?: {
    name?: string;
    isPublic?: boolean;
  },
): Promise<CardSummary> {
  const now = new Date().toISOString();
  const id = randomUUID();

  await db
    .insertInto("cards")
    .values({
      id,
      owner_id: ownerId,
      template_card_id: null,
      name: input?.name?.trim() || null,
      event_name: "",
      promotion_name: "",
      event_date: "",
      event_tagline: "",
      default_points: 1,
      tiebreaker_label: "Main event total match time (mins)",
      tiebreaker_is_time_based: 1,
      event_bonus_questions_json: "[]",
      public: input?.isPublic === false ? 0 : 1,
      is_template: 1,
      created_at: now,
      updated_at: now,
    })
    .execute();

  const created = await db
    .selectFrom("cards")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

  const card = asCardRow(created);
  return {
    ...mapSummary(card),
    ownerId: card.owner_id,
  };
}

export async function updateTemplateCardForAdmin(
  cardId: string,
  input: {
    name?: string;
    isPublic?: boolean;
  },
): Promise<boolean> {
  const update: Updateable<Cards> = {
    updated_at: new Date().toISOString(),
  };

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    update.name = trimmed ? trimmed : null;
  }

  if (input.isPublic !== undefined) {
    update.public = input.isPublic ? 1 : 0;
  }

  const result = await db
    .updateTable("cards")
    .set(update)
    .where("id", "=", cardId)
    .where("is_template", "=", 1)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0) > 0;
}

export async function deleteTemplateCardForAdmin(
  cardId: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom("cards")
    .where("id", "=", cardId)
    .where("is_template", "=", 1)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}
