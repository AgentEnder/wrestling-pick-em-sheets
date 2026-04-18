/**
 * One-off backfill: re-run snapshotScores for every ended game whose
 * snapshot rows were written before migration 0025 (i.e. have null
 * breakdown_json). This rewrites total_score, winner/bonus/surprise points,
 * rank, and breakdown_json using the current scoring engine.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-score-snapshots.ts            # dry-run (default)
 *   pnpm tsx scripts/backfill-score-snapshots.ts --apply    # actually writes
 *
 * The script prints the DATABASE_URL / TURSO_DATABASE_URL it will operate
 * on and asks for typed confirmation before applying. Local env files
 * often point to prod — read carefully before confirming.
 */
import { createInterface } from "node:readline/promises";

import { db } from "@/lib/server/db/client";
import { findResolvedReadableCardById } from "@/lib/server/repositories/cards";
import {
  computeLeaderboard,
  snapshotScores,
} from "@/lib/server/repositories/live-games";
import { normalizeLiveKeyPayload } from "@/lib/server/repositories/live-keys";
import type { LiveGameKeyPayload, LivePlayerPicksPayload } from "@/lib/types";

const APPLY = process.argv.includes("--apply");

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function dbTarget(): string {
  return (
    process.env.TURSO_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "(unset — using default libsql client)"
  );
}

async function confirm(prompt: string, expected: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer.trim() === expected;
}

interface GameToBackfill {
  id: string;
  cardId: string;
  hostUserId: string;
  endedAt: string | null;
  keyPayload: LiveGameKeyPayload;
  snapshotCount: number;
  nullBreakdownCount: number;
}

async function findGamesNeedingBackfill(): Promise<GameToBackfill[]> {
  const endedGames = await db
    .selectFrom("live_games")
    .select([
      "id",
      "card_id",
      "host_user_id",
      "ended_at",
      "key_payload_json",
    ])
    .where("status", "=", "ended")
    .execute();

  const out: GameToBackfill[] = [];
  for (const g of endedGames) {
    const snapshots = await db
      .selectFrom("live_game_score_snapshots")
      .select(["breakdown_json"])
      .where("game_id", "=", String(g.id))
      .execute();

    if (snapshots.length === 0) continue;
    const nullCount = snapshots.filter((s) => !s.breakdown_json).length;
    if (nullCount === 0) continue;

    out.push({
      id: String(g.id),
      cardId: g.card_id,
      hostUserId: g.host_user_id,
      endedAt: g.ended_at,
      keyPayload: normalizeLiveKeyPayload(
        parseJson<unknown>(g.key_payload_json, {}),
      ),
      snapshotCount: snapshots.length,
      nullBreakdownCount: nullCount,
    });
  }
  return out;
}

interface DiffRow {
  playerId: string;
  nickname: string;
  oldTotal: number;
  newTotal: number;
  oldWinner: number;
  newWinner: number;
  oldBonus: number;
  newBonus: number;
  oldSurprise: number;
  newSurprise: number;
}

async function buildDiff(game: GameToBackfill): Promise<DiffRow[] | null> {
  const card = await findResolvedReadableCardById(
    game.cardId,
    game.hostUserId,
  );
  if (!card) return null;

  const playerRows = await db
    .selectFrom("live_game_players")
    .selectAll()
    .where("game_id", "=", game.id)
    .where("join_status", "=", "approved")
    .execute();

  const players = playerRows.map((row) => ({
    id: String(row.id),
    gameId: row.game_id,
    joinStatus: "approved" as const,
    nickname: row.nickname,
    isSubmitted: Number(row.is_submitted) === 1,
    picks: parseJson<LivePlayerPicksPayload>(row.picks_json, {
      matchPicks: [],
      eventBonusAnswers: [],
      tiebreakerAnswer: "",
    }),
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    // computeLeaderboard only uses the fields above; the cast is safe here
  })) as unknown as Parameters<typeof computeLeaderboard>[2];

  const leaderboard = computeLeaderboard(card, game.keyPayload, players);
  const nicknameToPlayerId = new Map<string, string>();
  for (const p of playerRows) {
    nicknameToPlayerId.set(p.nickname.trim().toLowerCase(), String(p.id));
  }

  const existing = await db
    .selectFrom("live_game_score_snapshots")
    .select([
      "player_id",
      "total_score",
      "winner_points",
      "bonus_points",
      "surprise_points",
    ])
    .where("game_id", "=", game.id)
    .execute();
  const existingById = new Map(existing.map((e) => [e.player_id, e]));

  const rows: DiffRow[] = [];
  for (const entry of leaderboard) {
    if (!entry.isSubmitted) continue;
    const playerId = nicknameToPlayerId.get(entry.nickname.trim().toLowerCase());
    if (!playerId) continue;
    const prev = existingById.get(playerId);
    rows.push({
      playerId,
      nickname: entry.nickname,
      oldTotal: prev?.total_score ?? 0,
      newTotal: entry.score,
      oldWinner: prev?.winner_points ?? 0,
      newWinner: entry.breakdown.winnerPoints,
      oldBonus: prev?.bonus_points ?? 0,
      newBonus: entry.breakdown.bonusPoints,
      oldSurprise: prev?.surprise_points ?? 0,
      newSurprise: entry.breakdown.surprisePoints,
    });
  }
  return rows;
}

function formatDelta(a: number, b: number): string {
  const d = b - a;
  if (d === 0) return "     =";
  return d > 0 ? `  +${d}` : `  ${d}`;
}

async function main() {
  console.log("=".repeat(70));
  console.log("Score snapshot backfill");
  console.log("=".repeat(70));
  console.log(`DB target  : ${dbTarget()}`);
  console.log(`Mode       : ${APPLY ? "APPLY (writes will occur)" : "dry-run"}`);
  console.log();

  const games = await findGamesNeedingBackfill();
  if (games.length === 0) {
    console.log("No ended games with null breakdown_json. Nothing to do.");
    return;
  }

  console.log(`Found ${games.length} ended game(s) with at least one null breakdown_json.`);
  console.log();

  let gamesWithChanges = 0;
  let totalPlayerRowDelta = 0;

  for (const game of games) {
    const diff = await buildDiff(game);
    if (!diff) {
      console.log(`[skip] game ${game.id} — could not load card ${game.cardId}`);
      continue;
    }
    const changedRows = diff.filter(
      (r) =>
        r.oldTotal !== r.newTotal ||
        r.oldWinner !== r.newWinner ||
        r.oldBonus !== r.newBonus ||
        r.oldSurprise !== r.newSurprise,
    );

    console.log(`Game ${game.id}  (ended ${game.endedAt ?? "?"})`);
    console.log(
      `  snapshots=${game.snapshotCount}  null_breakdown=${game.nullBreakdownCount}  changed=${changedRows.length}/${diff.length}`,
    );
    if (changedRows.length > 0) {
      gamesWithChanges += 1;
      totalPlayerRowDelta += changedRows.length;
      console.log(
        "    player                total (old→new)   win   bonus   surprise",
      );
      for (const r of changedRows) {
        console.log(
          `    ${r.nickname.padEnd(22).slice(0, 22)}  ${String(r.oldTotal).padStart(4)}→${String(r.newTotal).padEnd(4)}${formatDelta(r.oldTotal, r.newTotal)}${formatDelta(r.oldWinner, r.newWinner)}${formatDelta(r.oldBonus, r.newBonus)}${formatDelta(r.oldSurprise, r.newSurprise)}`,
        );
      }
    }
    console.log();
  }

  console.log("-".repeat(70));
  console.log(
    `Summary: ${gamesWithChanges}/${games.length} game(s) would change; ${totalPlayerRowDelta} player row(s) affected.`,
  );

  if (!APPLY) {
    console.log();
    console.log("Dry-run complete. Re-run with --apply to write.");
    return;
  }

  console.log();
  console.log("!! APPLY mode. About to write to the DB shown above.");
  const ok = await confirm(
    `Type 'apply' to proceed (target=${dbTarget()}): `,
    "apply",
  );
  if (!ok) {
    console.log("Aborted. No writes performed.");
    return;
  }

  let applied = 0;
  for (const game of games) {
    const card = await findResolvedReadableCardById(
      game.cardId,
      game.hostUserId,
    );
    if (!card) {
      console.log(`[skip] game ${game.id} — card not loadable`);
      continue;
    }
    await snapshotScores(game.id, card, game.keyPayload);
    applied += 1;
    console.log(`[ok]   game ${game.id} — snapshots rewritten`);
  }
  console.log();
  console.log(`Done. Rewrote snapshots for ${applied} game(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
