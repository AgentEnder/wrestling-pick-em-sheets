import type { BreakdownRow, CardSection, Match } from "@/lib/types";

// The subset of a sheet/card that section grouping needs. Both PickEmSheet
// and ResolvedCard satisfy it.
export interface SectionedSheet {
  sections: CardSection[];
  matches: Match[];
}

export interface MatchGroup {
  section: CardSection | null;
  matches: Match[];
}

export function sectionDisplayName(
  section: CardSection,
  fallbackIndex: number,
): string {
  return section.name.trim() || `Part ${fallbackIndex + 1}`;
}

/**
 * Groups matches under their sections while preserving sheet order inside
 * each group. Matches without a (known) section come first, headerless;
 * sections with no matches are skipped.
 *
 * Used by the print sheet, the live player picks view, and the host keying
 * view so all surfaces present the same order and numbering.
 */
export function buildMatchGroups(sheet: SectionedSheet): MatchGroup[] {
  const sectionIds = new Set(sheet.sections.map((section) => section.id));
  const groups: MatchGroup[] = [];

  const unsectioned = sheet.matches.filter(
    (match) => !match.sectionId || !sectionIds.has(match.sectionId),
  );
  if (unsectioned.length > 0) {
    groups.push({ section: null, matches: unsectioned });
  }

  for (const section of sheet.sections) {
    const matches = sheet.matches.filter(
      (match) => match.sectionId === section.id,
    );
    if (matches.length > 0) {
      groups.push({ section, matches });
    }
  }

  return groups;
}

/** Bucket key for keyed rows from matches assigned to no (known) section. */
export const OTHER_BUCKET_KEY = "__other__";
/** Bucket key for keyed event bonus question rows (card-wide, not per section). */
export const EVENT_BUCKET_KEY = "__event__";

export interface SectionScore {
  /** Section id, OTHER_BUCKET_KEY, or EVENT_BUCKET_KEY. */
  key: string;
  name: string;
  score: number;
  maxPoints: number;
}

/**
 * Resolves the bucket key a breakdown row belongs to: the match's section,
 * OTHER_BUCKET_KEY for unsectioned matches, EVENT_BUCKET_KEY for event
 * bonus questions.
 */
export function bucketKeyForRow(
  row: BreakdownRow,
  sectionIdByMatchId: Map<string, string | null>,
): string {
  if (row.kind === "event-bonus") return EVENT_BUCKET_KEY;
  return sectionIdByMatchId.get(row.matchId) ?? OTHER_BUCKET_KEY;
}

export function buildSectionIdByMatchId(
  card: SectionedSheet,
): Map<string, string | null> {
  const sectionIds = new Set(card.sections.map((section) => section.id));
  return new Map(
    card.matches.map((match) => [
      match.id,
      match.sectionId && sectionIds.has(match.sectionId)
        ? match.sectionId
        : null,
    ]),
  );
}

/**
 * Aggregates a player's per-question breakdown rows into per-section totals.
 * Returns [] when the card has no sections (nothing to break down by).
 *
 * Bucket order matches the display order used everywhere else: unsectioned
 * matches ("Other Matches") first, then every card section in order (score 0
 * when nothing in it has been keyed yet, so columns stay stable across
 * players), then "Event Bonuses". The other/event buckets appear only when
 * they have keyed rows.
 */
export function computeSectionScores(
  card: SectionedSheet,
  rows: BreakdownRow[],
): SectionScore[] {
  if (card.sections.length === 0) return [];

  const sectionIdByMatchId = buildSectionIdByMatchId(card);

  const buckets = new Map<string, { score: number; maxPoints: number }>();
  for (const row of rows) {
    const key = bucketKeyForRow(row, sectionIdByMatchId);
    const bucket = buckets.get(key) ?? { score: 0, maxPoints: 0 };
    bucket.score += row.score;
    bucket.maxPoints += row.maxPoints;
    buckets.set(key, bucket);
  }

  const result: SectionScore[] = [];

  const otherBucket = buckets.get(OTHER_BUCKET_KEY);
  if (otherBucket) {
    result.push({
      key: OTHER_BUCKET_KEY,
      name: "Other Matches",
      ...otherBucket,
    });
  }

  for (const [index, section] of card.sections.entries()) {
    const bucket = buckets.get(section.id) ?? { score: 0, maxPoints: 0 };
    result.push({
      key: section.id,
      name: sectionDisplayName(section, index),
      ...bucket,
    });
  }

  const eventBucket = buckets.get(EVENT_BUCKET_KEY);
  if (eventBucket) {
    result.push({
      key: EVENT_BUCKET_KEY,
      name: "Event Bonuses",
      ...eventBucket,
    });
  }

  return result;
}

/**
 * Convenience for LeaderboardPanel call sites: returns the entries enriched
 * with each player's per-section totals (empty when the card has no
 * sections, which hides section UI entirely).
 */
export function withSectionScores<
  T extends { breakdown: { perQuestion: BreakdownRow[] } },
>(
  card: SectionedSheet,
  leaderboard: T[],
): Array<T & { sectionScores: SectionScore[] }> {
  return leaderboard.map((entry) => ({
    ...entry,
    sectionScores:
      card.sections.length > 0
        ? computeSectionScores(card, entry.breakdown.perQuestion)
        : [],
  }));
}
