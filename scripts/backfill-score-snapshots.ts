/**
 * One-off backfill: re-run snapshotScores for every ended game whose
 * snapshot rows are inconsistent. A row is flagged when any of these hold:
 *
 *   - breakdown_json IS NULL (written pre-migration 0025 — can't verify
 *     internally but definitely renders blank rows in the UI),
 *   - breakdown_json is populated but sum(parsed.score) !== total_score
 *     (the stored aggregate and the stored breakdown disagree — internal
 *     inconsistency in the snapshot row itself),
 *   - fresh computeLeaderboard disagrees with the stored total_score
 *     (stored data is stale relative to the current scoring engine).
 *
 * Fixing a flagged row rewrites total_score, winner/bonus/surprise points,
 * rank, and breakdown_json via snapshotScores — the exact path the app
 * uses at game-end.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-score-snapshots.ts            # dry-run (default)
 *   pnpm tsx scripts/backfill-score-snapshots.ts --apply    # actually writes
 *
 * The script prints the DATABASE_URL / TURSO_DATABASE_URL it will operate
 * on and asks for typed confirmation before applying. Local env files
 * often point to prod — read carefully before confirming.
 */
import "./_load-env-local.ts";

import { createInterface } from "node:readline/promises";

import { db } from "@/lib/server/db/client";
import { findResolvedReadableCardById } from "@/lib/server/repositories/cards";
import {
  computeLeaderboard,
  snapshotScores,
} from "@/lib/server/repositories/live-games";
import { normalizeLiveKeyPayload } from "@/lib/server/repositories/live-keys";
import type {
  BreakdownRow,
  LiveGameKeyPayload,
  LivePlayerPicksPayload,
} from "@/lib/types";

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

interface EndedGame {
  id: string;
  cardId: string;
  hostUserId: string;
  endedAt: string | null;
  keyPayload: LiveGameKeyPayload;
}

async function listEndedGames(): Promise<EndedGame[]> {
  const rows = await db
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

  return rows.map((g) => ({
    id: String(g.id),
    cardId: g.card_id,
    hostUserId: g.host_user_id,
    endedAt: g.ended_at,
    keyPayload: normalizeLiveKeyPayload(
      parseJson<unknown>(g.key_payload_json, {}),
    ),
  }));
}

type FlagReason = "null-breakdown" | "sum-mismatch" | "stale-vs-engine";

interface PlayerDiff {
  playerId: string;
  nickname: string;
  oldTotal: number;
  newTotal: number;
  oldBreakdownSum: number | null; // null when breakdown_json is absent/invalid
  oldWinner: number;
  newWinner: number;
  oldBonus: number;
  newBonus: number;
  oldSurprise: number;
  newSurprise: number;
  reasons: FlagReason[];
}

interface GameDiff {
  game: EndedGame;
  snapshotCount: number;
  players: PlayerDiff[];
}

function sumBreakdown(json: string | null): number | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return (parsed as BreakdownRow[]).reduce(
      (acc, r) => acc + (typeof r.score === "number" ? r.score : 0),
      0,
    );
  } catch {
    return null;
  }
}

async function buildGameDiff(game: EndedGame): Promise<GameDiff | null> {
  const card = await findResolvedReadableCardById(game.cardId, game.hostUserId);
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
  })) as unknown as Parameters<typeof computeLeaderboard>[2];

  const leaderboard = computeLeaderboard(card, game.keyPayload, players);
  const freshByNickname = new Map(
    leaderboard.map((e) => [e.nickname.trim().toLowerCase(), e]),
  );

  const snapshots = await db
    .selectFrom("live_game_score_snapshots")
    .select([
      "player_id",
      "total_score",
      "winner_points",
      "bonus_points",
      "surprise_points",
      "breakdown_json",
    ])
    .where("game_id", "=", game.id)
    .execute();

  const nicknameById = new Map(
    playerRows.map((p) => [String(p.id), p.nickname]),
  );

  const out: PlayerDiff[] = [];
  for (const snap of snapshots) {
    const nickname = nicknameById.get(snap.player_id) ?? "(unknown)";
    const fresh = freshByNickname.get(nickname.trim().toLowerCase());
    const breakdownSum = sumBreakdown(snap.breakdown_json);

    const reasons: FlagReason[] = [];
    if (snap.breakdown_json === null) {
      reasons.push("null-breakdown");
    } else if (breakdownSum !== null && breakdownSum !== snap.total_score) {
      reasons.push("sum-mismatch");
    }
    if (fresh && fresh.score !== snap.total_score) {
      reasons.push("stale-vs-engine");
    }

    if (reasons.length === 0) continue;

    out.push({
      playerId: snap.player_id,
      nickname,
      oldTotal: snap.total_score,
      newTotal: fresh?.score ?? snap.total_score,
      oldBreakdownSum: breakdownSum,
      oldWinner: snap.winner_points,
      newWinner: fresh?.breakdown.winnerPoints ?? snap.winner_points,
      oldBonus: snap.bonus_points,
      newBonus: fresh?.breakdown.bonusPoints ?? snap.bonus_points,
      oldSurprise: snap.surprise_points,
      newSurprise: fresh?.breakdown.surprisePoints ?? snap.surprise_points,
      reasons,
    });
  }

  return { game, snapshotCount: snapshots.length, players: out };
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

  const endedGames = await listEndedGames();
  console.log(`Scanning ${endedGames.length} ended game(s)...`);
  console.log();

  const flaggedGames: GameDiff[] = [];
  for (const game of endedGames) {
    const diff = await buildGameDiff(game);
    if (!diff) {
      console.log(`[skip] game ${game.id} — could not load card ${game.cardId}`);
      continue;
    }
    if (diff.players.length > 0) flaggedGames.push(diff);
  }

  if (flaggedGames.length === 0) {
    console.log("No inconsistent snapshots. Nothing to do.");
    return;
  }

  let totalPlayerRows = 0;
  const reasonCounts = {
    "null-breakdown": 0,
    "sum-mismatch": 0,
    "stale-vs-engine": 0,
  };

  for (const { game, snapshotCount, players } of flaggedGames) {
    totalPlayerRows += players.length;
    for (const p of players) for (const r of p.reasons) reasonCounts[r] += 1;

    console.log(`Game ${game.id}  (ended ${game.endedAt ?? "?"})`);
    console.log(
      `  snapshots=${snapshotCount}  flagged=${players.length}`,
    );
    console.log(
      "    player                total (old→new)   win     bonus   surp    reasons",
    );
    for (const p of players) {
      const reasonLabel = p.reasons
        .map((r) =>
          r === "null-breakdown"
            ? "null"
            : r === "sum-mismatch"
              ? `sum=${p.oldBreakdownSum ?? "?"}≠total=${p.oldTotal}`
              : "stale",
        )
        .join(",");
      console.log(
        `    ${p.nickname.padEnd(22).slice(0, 22)}  ${String(p.oldTotal).padStart(4)}→${String(p.newTotal).padEnd(4)}${formatDelta(p.oldTotal, p.newTotal)}${formatDelta(p.oldWinner, p.newWinner)}${formatDelta(p.oldBonus, p.newBonus)}${formatDelta(p.oldSurprise, p.newSurprise)}   ${reasonLabel}`,
      );
    }
    console.log();
  }

  console.log("-".repeat(70));
  console.log(
    `Summary: ${flaggedGames.length} game(s), ${totalPlayerRows} player row(s) flagged.`,
  );
  console.log(
    `  null-breakdown=${reasonCounts["null-breakdown"]}  sum-mismatch=${reasonCounts["sum-mismatch"]}  stale-vs-engine=${reasonCounts["stale-vs-engine"]}`,
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
  for (const { game } of flaggedGames) {
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
