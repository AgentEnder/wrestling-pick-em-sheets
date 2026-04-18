import assert from "node:assert/strict";
import { mkdtempSync, rmSync, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

type LiveGamesRepo = typeof import("@/lib/server/repositories/live-games");
type DbModule = typeof import("@/lib/server/db/client");

let tmpDir: string;
let db: DbModule["db"];
let liveGames: LiveGamesRepo;

const HOST = "user-host";
const OTHER = "user-other";
const CARD_ID = "card-under-test";

before(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "live-games-delete-test-"));
  const env = process.env as Record<string, string | undefined>;
  env.LOCAL_DATABASE_DIR = tmpDir;
  env.NODE_ENV = "development";
  delete env.USE_TURSO_IN_DEV;
  env.GIT_BRANCH = "live-games-delete-test";

  const clientModule = await import("@/lib/server/db/client");
  db = clientModule.db;
  liveGames = await import("@/lib/server/repositories/live-games");

  const { FileMigrationProvider, Migrator } = await import("kysely");
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs: fsp,
      path,
      migrationFolder: path.join(process.cwd(), "migrations"),
    }),
  });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;

  // Seed: one owned card, then host creates a room game on it.
  const now = new Date().toISOString();
  await db
    .insertInto("cards")
    .values({
      id: CARD_ID,
      owner_id: HOST,
      template_card_id: null,
      name: "Test card",
      event_name: "Event",
      promotion_name: "",
      event_date: "",
      event_tagline: "",
      default_points: 1,
      tiebreaker_label: "",
      tiebreaker_is_time_based: 0,
      event_bonus_questions_json: "[]",
      public: 0,
      is_template: 0,
      archived_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
});

after(async () => {
  if (db) await db.destroy();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

async function seedGame(id: string, mode: "room" | "solo" = "room") {
  const now = new Date().toISOString();
  await db
    .insertInto("live_games")
    .values({
      id,
      card_id: CARD_ID,
      host_user_id: HOST,
      mode,
      status: "lobby",
      join_code: `CODE${id.slice(-4).toUpperCase()}`,
      qr_join_secret: null,
      allow_late_joins: 1,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ended_at: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

describe("live games soft delete", () => {
  test("softDeleteLiveGame sets deleted_at for owner", async () => {
    await seedGame("game-softdel-1");
    const result = await liveGames.softDeleteLiveGame("game-softdel-1", HOST);
    assert.ok(result, "returns the deleted game");
    assert.ok(result!.deletedAt, "deletedAt populated");
  });

  test("getHostLiveGame hides soft-deleted games", async () => {
    await seedGame("game-softdel-2");
    await liveGames.softDeleteLiveGame("game-softdel-2", HOST);
    const found = await liveGames.getHostLiveGame("game-softdel-2", HOST);
    assert.equal(found, null);
  });

  test("listCardLiveGames hides soft-deleted by default, surfaces with includeDeleted", async () => {
    await seedGame("game-softdel-3");
    await liveGames.softDeleteLiveGame("game-softdel-3", HOST);

    const activeOnly = await liveGames.listCardLiveGames(CARD_ID, HOST);
    const activeIds = (activeOnly ?? []).map((g) => g.id);
    assert.ok(!activeIds.includes("game-softdel-3"), "hidden by default");

    const withDeleted = await liveGames.listCardLiveGames(CARD_ID, HOST, {
      includeDeleted: true,
    });
    const allIds = (withDeleted ?? []).map((g) => g.id);
    assert.ok(allIds.includes("game-softdel-3"), "visible with includeDeleted");
  });

  test("softDeleteLiveGame refuses non-owner", async () => {
    await seedGame("game-softdel-4");
    const result = await liveGames.softDeleteLiveGame("game-softdel-4", OTHER);
    assert.equal(result, null);
  });

  test("softDeleteLiveGame refuses solo-mode games (scope: room only)", async () => {
    await seedGame("game-softdel-solo", "solo");
    const result = await liveGames.softDeleteLiveGame(
      "game-softdel-solo",
      HOST,
    );
    assert.equal(result, null, "solo games out of scope");
  });

  test("softDeleteLiveGame is idempotent (second call returns null)", async () => {
    await seedGame("game-softdel-5");
    const first = await liveGames.softDeleteLiveGame("game-softdel-5", HOST);
    assert.ok(first);
    const second = await liveGames.softDeleteLiveGame("game-softdel-5", HOST);
    assert.equal(second, null, "second soft delete no-ops");
  });

  test("restoreLiveGame clears deleted_at and restores visibility", async () => {
    await seedGame("game-softdel-6");
    await liveGames.softDeleteLiveGame("game-softdel-6", HOST);
    const restored = await liveGames.restoreLiveGame("game-softdel-6", HOST);
    assert.ok(restored);
    assert.equal(restored!.deletedAt, null);
    const found = await liveGames.getHostLiveGame("game-softdel-6", HOST);
    assert.ok(found, "visible again");
  });

  test("restoreLiveGame refuses non-owner", async () => {
    await seedGame("game-softdel-7");
    await liveGames.softDeleteLiveGame("game-softdel-7", HOST);
    const result = await liveGames.restoreLiveGame("game-softdel-7", OTHER);
    assert.equal(result, null);
  });

  test("purgeExpiredLiveGames deletes rows older than 30 days and fires cascade", async () => {
    // Seed a game with deleted_at = 31 days ago, plus one child row.
    const thirtyOneDaysAgo = new Date(
      Date.now() - 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await seedGame("game-softdel-expired");
    await db
      .updateTable("live_games")
      .set({ deleted_at: thirtyOneDaysAgo })
      .where("id", "=", "game-softdel-expired")
      .execute();
    await db
      .insertInto("live_game_events")
      .values({
        id: "event-to-cascade",
        game_id: "game-softdel-expired",
        event_type: "game.created",
        event_payload_json: "{}",
        created_at: new Date().toISOString(),
      })
      .execute();

    const purged = await liveGames.purgeExpiredLiveGames();
    assert.ok(purged >= 1, "at least the expired game was purged");

    const rowCheck = await db
      .selectFrom("live_games")
      .select("id")
      .where("id", "=", "game-softdel-expired")
      .executeTakeFirst();
    assert.equal(rowCheck, undefined, "game row physically gone");

    const childCheck = await db
      .selectFrom("live_game_events")
      .select("id")
      .where("id", "=", "event-to-cascade")
      .executeTakeFirst();
    assert.equal(childCheck, undefined, "child cascaded away");
  });

  test("purgeExpiredLiveGames preserves rows under 30 days", async () => {
    await seedGame("game-softdel-recent");
    await liveGames.softDeleteLiveGame("game-softdel-recent", HOST);
    await liveGames.purgeExpiredLiveGames();
    const row = await db
      .selectFrom("live_games")
      .select("id")
      .where("id", "=", "game-softdel-recent")
      .executeTakeFirst();
    assert.ok(row, "recent soft-deleted game survives");
  });

  test("getLiveGameState exposes canceled status to in-game player session", async () => {
    // Seed a game, a player on it, then soft-delete.
    await seedGame("game-canceled");
    const sessionTokenHash = "hash-player-a";
    const now = new Date().toISOString();
    await db
      .insertInto("live_game_players")
      .values({
        id: "player-a",
        game_id: "game-canceled",
        nickname: "Alice",
        normalized_nickname: "alice",
        session_token_hash: sessionTokenHash,
        join_status: "approved",
        is_submitted: 0,
        picks_json: "{}",
        auth_method: "guest",
        clerk_user_id: null,
        joined_at: now,
        last_seen_at: now,
        updated_at: now,
      })
      .execute();
    await liveGames.softDeleteLiveGame("game-canceled", HOST);

    const state = await liveGames.getLiveGameState("game-canceled", {
      hostUserId: null,
      sessionTokenHash,
      clerkUserId: null,
      joinCode: null,
    });

    assert.ok(state, "returns state");
    assert.equal(state!.game.status, "canceled");
  });

  test("updateLiveGameStatus refuses soft-deleted game", async () => {
    await seedGame("game-mutator-status");
    await liveGames.softDeleteLiveGame("game-mutator-status", HOST);
    const result = await liveGames.updateLiveGameStatus(
      "game-mutator-status",
      HOST,
      { status: "live" },
    );
    assert.equal(result, null);
  });

  test("updateLiveGameLocks refuses soft-deleted game", async () => {
    await seedGame("game-mutator-locks");
    await liveGames.softDeleteLiveGame("game-mutator-locks", HOST);
    const result = await liveGames.updateLiveGameLocks(
      "game-mutator-locks",
      HOST,
      {
        globalLocked: false,
        matchLocks: {},
        matchBonusLocks: {},
        eventBonusLocks: {},
      },
    );
    assert.equal(result, null);
  });

  test("updateLiveGameKeyForHost refuses soft-deleted game", async () => {
    await seedGame("game-mutator-key");
    await liveGames.softDeleteLiveGame("game-mutator-key", HOST);
    const result = await liveGames.updateLiveGameKeyForHost(
      "game-mutator-key",
      HOST,
      {
        timers: [],
        matchResults: [],
        eventBonusAnswers: [],
        tiebreakerAnswer: "",
        tiebreakerRecordedAt: null,
        tiebreakerTimerId: null,
        scoreOverrides: [],
        winnerOverrides: [],
      },
    );
    assert.equal(result, null);
  });

  test("getLiveGameState returns null for deleted game to non-session requester", async () => {
    await seedGame("game-canceled-stranger");
    await liveGames.softDeleteLiveGame("game-canceled-stranger", HOST);

    const state = await liveGames.getLiveGameState("game-canceled-stranger", {
      hostUserId: null,
      sessionTokenHash: null,
      clerkUserId: null,
      joinCode: null,
    });

    assert.equal(state, null);
  });
});
