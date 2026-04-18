import assert from "node:assert/strict";
import { mkdtempSync, rmSync, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

// Same bootstrap pattern as tests/unit/repositories/cards-archive.test.ts:
// env vars (including TEST_AUTH_MODE) must be set BEFORE importing any
// module that touches lib/server, because lib/server/env.ts parses
// process.env at import time.

type LiveGamesRepo = typeof import("@/lib/server/repositories/live-games");
type DbModule = typeof import("@/lib/server/db/client");

type DeleteRouteModule =
  typeof import("@/app/api/live-games/[gameId]/route");
type RestoreRouteModule =
  typeof import("@/app/api/live-games/[gameId]/restore/route");
type ListCardLiveGamesRouteModule =
  typeof import("@/app/api/cards/[cardId]/live-games/route");

let tmpDir: string;
let db: DbModule["db"];
let liveGames: LiveGamesRepo;
let deleteRoute: DeleteRouteModule;
let restoreRoute: RestoreRouteModule;
let listRoute: ListCardLiveGamesRouteModule;

const TEST_SECRET = "route-test-secret";
const HOST = "user-host-route";
const OTHER = "user-other-route";
const CARD_ID = "card-route-under-test";

// Build a Request that the route handlers accept. Must include:
//  - Origin matching url (for enforceSameOrigin)
//  - x-test-auth-secret + x-test-user-id (to activate the test-auth override)
function makeRequest(
  url: string,
  init: RequestInit & { userId?: string | null; withCsrf?: boolean } = {},
): Request {
  const headers = new Headers(init.headers ?? {});
  const { userId = HOST, withCsrf = true } = init;

  if (withCsrf) {
    // enforceSameOrigin requires origin === URL origin, and fetch-site allowed.
    headers.set("origin", new URL(url).origin);
    headers.set("sec-fetch-site", "same-origin");
  }

  if (userId !== null) {
    headers.set("x-test-auth-secret", TEST_SECRET);
    headers.set("x-test-user-id", userId);
  }

  const {
    userId: _omitUserId,
    withCsrf: _omitWithCsrf,
    headers: _omitHeaders,
    ...rest
  } = init;
  void _omitUserId;
  void _omitWithCsrf;
  void _omitHeaders;

  return new Request(url, { ...rest, headers });
}

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
      join_code: `RT${id.slice(-6).toUpperCase()}`,
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

before(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "live-games-route-test-"));
  const env = process.env as Record<string, string | undefined>;
  env.LOCAL_DATABASE_DIR = tmpDir;
  env.NODE_ENV = "development";
  delete env.USE_TURSO_IN_DEV;
  env.GIT_BRANCH = "live-games-route-test";
  // Activate test-auth override path in lib/server/auth.ts.
  env.TEST_AUTH_MODE = "1";
  env.TEST_AUTH_SECRET = TEST_SECRET;
  delete env.VERCEL;
  delete env.VERCEL_ENV;

  const clientModule = await import("@/lib/server/db/client");
  db = clientModule.db;
  liveGames = await import("@/lib/server/repositories/live-games");

  deleteRoute = await import("@/app/api/live-games/[gameId]/route");
  restoreRoute = await import(
    "@/app/api/live-games/[gameId]/restore/route"
  );
  listRoute = await import("@/app/api/cards/[cardId]/live-games/route");

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

  // Seed: one owned card for HOST.
  const now = new Date().toISOString();
  await db
    .insertInto("cards")
    .values({
      id: CARD_ID,
      owner_id: HOST,
      template_card_id: null,
      name: "Route test card",
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

describe("live games delete route", () => {
  test("DELETE as owner returns 200 with deletedAt populated", async () => {
    await seedGame("game-route-1");
    const request = makeRequest(
      "http://localhost/api/live-games/game-route-1",
      { method: "DELETE", userId: HOST },
    );
    const response = await deleteRoute.DELETE(request, {
      params: Promise.resolve({ gameId: "game-route-1" }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: { id: string; deletedAt: string | null };
    };
    assert.equal(body.data.id, "game-route-1");
    assert.ok(body.data.deletedAt, "deletedAt should be set");
  });

  test("DELETE as non-owner returns 404", async () => {
    await seedGame("game-route-2");
    const request = makeRequest(
      "http://localhost/api/live-games/game-route-2",
      { method: "DELETE", userId: OTHER },
    );
    const response = await deleteRoute.DELETE(request, {
      params: Promise.resolve({ gameId: "game-route-2" }),
    });
    assert.equal(response.status, 404);
  });

  test("DELETE unauthenticated returns 401", async () => {
    await seedGame("game-route-3");
    const request = makeRequest(
      "http://localhost/api/live-games/game-route-3",
      { method: "DELETE", userId: null },
    );
    const response = await deleteRoute.DELETE(request, {
      params: Promise.resolve({ gameId: "game-route-3" }),
    });
    assert.equal(response.status, 401);
  });

  test("DELETE without matching origin (CSRF) returns 403", async () => {
    await seedGame("game-route-4");
    // Use a clean Request — no origin header — but still include auth so we
    // hit the CSRF path, not the 401 path.
    const headers = new Headers();
    headers.set("x-test-auth-secret", TEST_SECRET);
    headers.set("x-test-user-id", HOST);
    const request = new Request(
      "http://localhost/api/live-games/game-route-4",
      { method: "DELETE", headers },
    );
    const response = await deleteRoute.DELETE(request, {
      params: Promise.resolve({ gameId: "game-route-4" }),
    });
    assert.equal(response.status, 403);
  });

  test("POST /restore as owner returns 200 with deletedAt null", async () => {
    await seedGame("game-route-5");
    await liveGames.softDeleteLiveGame("game-route-5", HOST);
    const request = makeRequest(
      "http://localhost/api/live-games/game-route-5/restore",
      { method: "POST", userId: HOST },
    );
    const response = await restoreRoute.POST(request, {
      params: Promise.resolve({ gameId: "game-route-5" }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: { id: string; deletedAt: string | null };
    };
    assert.equal(body.data.id, "game-route-5");
    assert.equal(body.data.deletedAt, null);
  });

  test("POST /restore as non-owner returns 404", async () => {
    await seedGame("game-route-6");
    await liveGames.softDeleteLiveGame("game-route-6", HOST);
    const request = makeRequest(
      "http://localhost/api/live-games/game-route-6/restore",
      { method: "POST", userId: OTHER },
    );
    const response = await restoreRoute.POST(request, {
      params: Promise.resolve({ gameId: "game-route-6" }),
    });
    assert.equal(response.status, 404);
  });

  test("GET list with ?includeDeleted=true shows soft-deleted games for owner", async () => {
    await seedGame("game-route-include-1");
    await liveGames.softDeleteLiveGame("game-route-include-1", HOST);

    const request = makeRequest(
      `http://localhost/api/cards/${CARD_ID}/live-games?includeDeleted=true`,
      { method: "GET", userId: HOST },
    );
    const response = await listRoute.GET(request, {
      params: Promise.resolve({ cardId: CARD_ID }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: Array<{ id: string; deletedAt: string | null }>;
    };
    const ids = body.data.map((g) => g.id);
    assert.ok(
      ids.includes("game-route-include-1"),
      "soft-deleted game should appear when includeDeleted=true",
    );
  });

  test("GET list without includeDeleted hides soft-deleted games", async () => {
    await seedGame("game-route-include-2");
    await liveGames.softDeleteLiveGame("game-route-include-2", HOST);

    const request = makeRequest(
      `http://localhost/api/cards/${CARD_ID}/live-games`,
      { method: "GET", userId: HOST },
    );
    const response = await listRoute.GET(request, {
      params: Promise.resolve({ cardId: CARD_ID }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: Array<{ id: string }>;
    };
    const ids = body.data.map((g) => g.id);
    assert.ok(
      !ids.includes("game-route-include-2"),
      "soft-deleted game should be hidden by default",
    );
  });

  test("GET list as non-owner returns 404 even with includeDeleted=true", async () => {
    const request = makeRequest(
      `http://localhost/api/cards/${CARD_ID}/live-games?includeDeleted=true`,
      { method: "GET", userId: OTHER },
    );
    const response = await listRoute.GET(request, {
      params: Promise.resolve({ cardId: CARD_ID }),
    });
    assert.equal(
      response.status,
      404,
      "non-owner should not leak card's deleted games",
    );
  });
});
