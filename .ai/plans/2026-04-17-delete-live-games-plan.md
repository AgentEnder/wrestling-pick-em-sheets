# Delete Live Games Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a host soft-delete a live game from `/cards/[cardId]/live`, restore it for 30 days, and after that have it (and all its player/event/snapshot/push rows) permanently removed via a lazy purge that runs on that same page's list query.

**Architecture:** One new nullable `deleted_at` column on `live_games`. Five existing gatekeeper functions add `WHERE deleted_at IS NULL` so soft-deleted games disappear from every read path that today decides whether a game "exists" for a caller. A new `DELETE /api/live-games/:gameId` + `POST /api/live-games/:gameId/restore` pair wraps two new repository functions that mirror the shipped `archiveCard` / `unarchiveCard` pattern from `lib/server/repositories/cards.ts:1009-1069`. A lazy purge runs on every call to `listCardLiveGames` — when 30 days elapse, the real `DELETE` fires and existing `ON DELETE CASCADE` declarations remove children. Players connected to a game that just got soft-deleted mid-session see a dedicated "canceled" view (distinct from the normal "ended" view) on their next poll. The host UI on `/live` gains a per-row kebab with a "Delete game" action (AlertDialog confirm → optimistic UI update → undo toast) and a collapsible "Recently deleted" section with restore buttons.

**Tech Stack:** Next.js 16 App Router, React 19, Kysely over libSQL/SQLite, Zustand, Radix primitives (`AlertDialog`, `DropdownMenu`, `Collapsible`) via shadcn wrappers, sonner for toasts, `node:test` via `tsx --test` for tests.

**Scope (amended 2026-04-17):** Room-mode games only. Solo-mode deletion is out of scope because `LiveGameHostApp` at `/cards/[cardId]/live` only lists room games (via `listCardLiveGames`'s hard-coded `mode = 'room'` filter) and solo games live elsewhere. See design doc Q1 revision.

**Reference reading before starting** (in this order):
1. `.ai/plans/2026-04-17-delete-live-games-design.md` — full approved design.
2. `.ai/issues/23-delete-live-games.md` — issue body + surface map with line numbers.
3. `migrations/0025_cards_archived_at.ts` — the precedent migration to mirror.
4. `lib/server/repositories/cards.ts:1009-1069` — `archiveCard` / `unarchiveCard` pattern.
5. `tests/unit/repositories/cards-archive.test.ts` — the test style + `tsx --test` bootstrapping.

---

## Commit Plan (5 vertical slices)

| # | Commit | Covers |
|---|---|---|
| 1 | `feat(live-game): soft-delete column, repo functions, gatekeeper filters` | Migration 0026, `softDeleteLiveGame`/`restoreLiveGame`/`purgeExpiredLiveGames`, 5 gatekeeper `deleted_at IS NULL` filters, `listCardLiveGames` gains `includeDeleted`, repo tests |
| 2 | `feat(live-game): DELETE and restore HTTP routes` | New `DELETE /api/live-games/[gameId]`, new `POST /api/live-games/[gameId]/restore`, `GET /api/cards/[cardId]/live-games` accepts `includeDeleted`, route tests |
| 3 | `feat(live-game): delete from /live with kebab + undo toast` | Client API wrappers, kebab menu in `LiveGameHostApp`, `DeleteLiveGameDialog`, optimistic update + undo toast |
| 4 | `feat(live-game): recently-deleted collapsible with restore` | "Recently deleted (N)" section with per-row Restore + countdown, lazy-load on first expand |
| 5 | `feat(live-game): canceled-game view for connected players and displays` | State endpoint's `status: 'deleted'` branch, `PlayerCanceledView`, `DisplayCanceledView`, slice transition |

Each commit is independently shippable in order 1 → 5. Up through commit 2, the feature is server-complete; up through commit 3 it's user-visible; commits 4 and 5 add recovery and mid-session UX respectively.

---

## Task 1: Add `deleted_at` column + partial index + regen types

**Files:**
- Create: `migrations/0026_live_games_soft_delete.ts`
- Regenerate: `lib/server/db/generated.ts` (via `pnpm db:codegen`)

**Step 1: Write the migration.**

Create `migrations/0026_live_games_soft_delete.ts` with the following exact content — mirrors `migrations/0025_cards_archived_at.ts`:

```ts
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('live_games')
    .addColumn('deleted_at', 'text')
    .execute()

  await sql`CREATE INDEX IF NOT EXISTS idx_live_games_active_host_created ON live_games (host_user_id, created_at) WHERE deleted_at IS NULL`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_live_games_active_host_created`.execute(db)
  await db.schema.alterTable('live_games').dropColumn('deleted_at').execute()
}
```

**Step 2: Run the migration locally.**

Run: `pnpm db:migrate:latest`

Expected: "Migration 0026_live_games_soft_delete.ts completed" (or equivalent — no errors).

**Step 3: Regenerate DB types.**

Run: `pnpm db:codegen`

Expected: `lib/server/db/generated.ts` now has `deleted_at: string | null` on the `live_games` table interface. Verify with `grep -n "deleted_at" lib/server/db/generated.ts` — should find exactly one line inside the `LiveGames` interface.

**Step 4: Don't commit yet.** The migration and generated types land with Task 2's repo functions in a single vertical slice (migration has no runtime consumer until the repo uses it).

---

## Task 2: Repository — soft delete, restore, purge, gatekeeper filters

**Files:**
- Modify: `lib/server/repositories/live-games.ts`
  - Gatekeeper filters at lines ~1912 (`listCardLiveGames`), ~1927 (`getHostLiveGame`), ~1948 (`getLiveGameByJoinCode`), ~3071 (`getLiveGameViewerAccess`).
  - Add new `softDeleteLiveGame`, `restoreLiveGame`, `purgeExpiredLiveGames`, `LIVE_GAME_SOFT_DELETE_RETENTION_DAYS` exports.
- Modify: `lib/server/live-game-push.ts` — push delivery gatekeeper.
- Create: `tests/unit/repositories/live-games-delete.test.ts`

**Step 1: Write the failing tests.**

Create `tests/unit/repositories/live-games-delete.test.ts` using the exact bootstrap pattern from `tests/unit/repositories/cards-archive.test.ts`. Full file:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

type LiveGamesRepo = typeof import("@/lib/server/repositories/live-games");
type CardsRepo = typeof import("@/lib/server/repositories/cards");
type DbModule = typeof import("@/lib/server/db/client");

let tmpDir: string;
let db: DbModule["db"];
let liveGames: LiveGamesRepo;
let cards: CardsRepo;

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
  cards = await import("@/lib/server/repositories/cards");

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
      scheduled_start_at: null,
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
        message: "test",
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
});
```

**Step 2: Run the tests to verify they fail.**

Run: `pnpm test:unit -- --test-name-pattern "live games soft delete"`

Expected: All 10 tests FAIL with errors like `TypeError: liveGames.softDeleteLiveGame is not a function` or `.deleted_at is not a column` (until Task 1's migration is applied to the test DB — the test bootstrap re-runs migrations, so the column will exist; the failures come from missing repo functions).

**Step 3: Add `deletedAt` to the mapped `LiveGame` type and `mapLiveGame` helper.**

In `lib/server/repositories/live-games.ts`, find `mapLiveGame` (search for `function mapLiveGame`). Add `deletedAt: row.deleted_at ?? null` to the returned object. If `LiveGame` is defined in `lib/types.ts`, add `deletedAt: string | null` to that interface — run `grep -n "export interface LiveGame\b" lib/types.ts` to locate.

**Step 4: Add gatekeeper filters.**

In `lib/server/repositories/live-games.ts`, add `.where("deleted_at", "is", null)` to each of the four gatekeeper queries:

- `listCardLiveGames` (line ~1912): add after `.where("mode", "=", "room")`. But also accept a new `opts?: { includeDeleted?: boolean }` parameter; only add the filter when `!opts?.includeDeleted`.

  New signature + body:

  ```ts
  export async function listCardLiveGames(
    cardId: string,
    hostUserId: string,
    opts?: { includeDeleted?: boolean },
  ): Promise<LiveGame[] | null> {
    const ownsCard = await getHostOwnedCard(cardId, hostUserId);
    if (!ownsCard) return null;

    // Opportunistic purge of rows past the retention window. Indexed and cheap.
    await purgeExpiredLiveGames();

    let query = db
      .selectFrom("live_games")
      .selectAll()
      .where("card_id", "=", cardId)
      .where("mode", "=", "room");

    if (!opts?.includeDeleted) {
      query = query.where("deleted_at", "is", null);
    }

    const rows = await query.orderBy("created_at", "desc").execute();
    return rows.map((row) => mapLiveGame(row));
  }
  ```

- `getHostLiveGame` (line ~1927): add `.where("deleted_at", "is", null)` after the `mode` filter.
- `getLiveGameByJoinCode` (line ~1948): add `.where("deleted_at", "is", null)`.
- `getLiveGameViewerAccess` (line ~3071): after the `.executeTakeFirst()` on `gameRow`, if `gameRow.deleted_at` is non-null, return `null`. (We'll add the canceled-branch leak in Task 5; for now treat as not-found.)

**Step 5: Add the three new functions at the end of the file.**

Append to `lib/server/repositories/live-games.ts`:

```ts
export const LIVE_GAME_SOFT_DELETE_RETENTION_DAYS = 30;

export async function softDeleteLiveGame(
  gameId: string,
  hostUserId: string,
): Promise<LiveGame | null> {
  const now = nowIso();

  const result = await db
    .updateTable("live_games")
    .set({ deleted_at: now, updated_at: now })
    .where("id", "=", gameId)
    .where("host_user_id", "=", hostUserId)
    .where("mode", "=", "room")
    .where("deleted_at", "is", null)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows ?? 0) === 0) {
    // Either not owner, not room-mode, already deleted, or missing.
    // All callers treat null the same (404) — no disambiguation needed.
    return null;
  }

  const row = await db
    .selectFrom("live_games")
    .selectAll()
    .where("id", "=", gameId)
    .executeTakeFirstOrThrow();
  return mapLiveGame(row);
}

export async function restoreLiveGame(
  gameId: string,
  hostUserId: string,
): Promise<LiveGame | null> {
  const now = nowIso();

  const result = await db
    .updateTable("live_games")
    .set({ deleted_at: null, updated_at: now })
    .where("id", "=", gameId)
    .where("host_user_id", "=", hostUserId)
    .where("mode", "=", "room")
    .where("deleted_at", "is not", null)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows ?? 0) === 0) return null;

  const row = await db
    .selectFrom("live_games")
    .selectAll()
    .where("id", "=", gameId)
    .executeTakeFirstOrThrow();
  return mapLiveGame(row);
}

export async function purgeExpiredLiveGames(): Promise<number> {
  const cutoff = new Date(
    Date.now() - LIVE_GAME_SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result = await db
    .deleteFrom("live_games")
    .where("deleted_at", "is not", null)
    .where("deleted_at", "<", cutoff)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0);
}
```

Uses the existing `nowIso()` helper — verify it's imported/defined in the file with `grep -n "^function nowIso\\|const nowIso" lib/server/repositories/live-games.ts`.

**Step 6: Filter the push delivery gatekeeper.**

In `lib/server/live-game-push.ts`, locate the query that resolves a game before sending push notifications (search for `.selectFrom("live_games")`). Add `.where("deleted_at", "is", null)` to that query. If it's a join, add the filter to the `live_games` side.

**Step 7: Run the repo tests and verify they pass.**

Run: `pnpm test:unit -- --test-name-pattern "live games soft delete"`

Expected: All 10 tests PASS.

**Step 8: Run the full unit + lint checks.**

Run in parallel:
- `pnpm test:unit`
- `pnpm lint`

Expected: all pre-existing tests still pass; lint clean.

**Step 9: Commit.**

```bash
git add migrations/0026_live_games_soft_delete.ts \
        lib/server/db/generated.ts \
        lib/server/repositories/live-games.ts \
        lib/server/live-game-push.ts \
        lib/types.ts \
        tests/unit/repositories/live-games-delete.test.ts
git commit -m "feat(live-game): soft-delete column, repo functions, gatekeeper filters"
```

---

## Task 3: API — `DELETE` + `restore` + `includeDeleted` list param

**Files:**
- Create: `app/api/live-games/[gameId]/route.ts`
- Create: `app/api/live-games/[gameId]/restore/route.ts`
- Modify: `app/api/cards/[cardId]/live-games/route.ts` (accept `?includeDeleted=true`)
- Create: `tests/unit/api/live-games-delete-route.test.ts` (route-level tests — check whether tests/unit/api exists or if route tests live elsewhere by running `find tests -name "*route*.test.ts" -type f` before writing; adjust path accordingly)

**Step 1: Identify the route test location convention.**

Run: `find tests -name "*route*.test.ts" -type f; find tests -name "*api*.test.ts" -type f`

Pick the directory the existing API tests (if any) use. If there are no existing route tests, put new tests in `tests/unit/api/live-games-delete-route.test.ts` and create the directory.

**Step 2: Write failing route tests.**

Cover these cases (using the same `tsx --test` bootstrap as Task 2 — import the route handlers directly and synthesize `NextRequest` / `Request` objects; see existing API tests if any, else follow the pattern of directly importing the `DELETE`/`POST` handler exports and calling them with a mocked `Request`):

- `DELETE` as owner → 200 + response body has `deletedAt`.
- `DELETE` as non-owner → 404.
- `DELETE` without Clerk auth → 401.
- `DELETE` without valid CSRF header → CSRF error (check behavior matches sibling routes).
- `POST /restore` as owner → 200, game restored.
- `POST /restore` as non-owner → 404.
- `GET /api/cards/:cardId/live-games?includeDeleted=true` → includes soft-deleted games for owner; `?includeDeleted=true` from a non-owner → 404/empty (shouldn't leak other users' deleted games; `listCardLiveGames` already gates on card ownership).

**Step 3: Create `app/api/live-games/[gameId]/route.ts`.**

```ts
import { NextRequest, NextResponse } from "next/server";

import { getRequestUserId } from "@/lib/server/auth";
import { validateCsrf } from "@/lib/server/csrf";
import { softDeleteLiveGame } from "@/lib/server/repositories/live-games";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  await validateCsrf(request);

  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { gameId } = await context.params;
  const game = await softDeleteLiveGame(gameId, userId);
  if (!game) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: { id: game.id, deletedAt: game.deletedAt },
  });
}
```

Cross-check `validateCsrf`'s actual export signature first: `grep -n "export.*validateCsrf\\|export function validateCsrf" lib/server/csrf.ts`. If it throws, wrap in try/catch or let it bubble to match sibling routes.

**Step 4: Create `app/api/live-games/[gameId]/restore/route.ts`.**

```ts
import { NextRequest, NextResponse } from "next/server";

import { getRequestUserId } from "@/lib/server/auth";
import { validateCsrf } from "@/lib/server/csrf";
import { restoreLiveGame } from "@/lib/server/repositories/live-games";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  await validateCsrf(request);

  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { gameId } = await context.params;
  const game = await restoreLiveGame(gameId, userId);
  if (!game) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: { id: game.id, deletedAt: null },
  });
}
```

**Step 5: Modify `app/api/cards/[cardId]/live-games/route.ts`.**

Locate the `GET` handler (around line 179 per our earlier grep). Parse `includeDeleted` from the URL and forward:

```ts
const includeDeleted =
  new URL(request.url).searchParams.get("includeDeleted") === "true";
const games = await listCardLiveGames(cardId, userId, { includeDeleted });
```

Verify the full handler still returns the existing `{ data }` envelope.

**Step 6: Run route tests and verify they pass.**

Run: `pnpm test:unit -- --test-name-pattern "live games delete route"` (or the pattern you chose).

Expected: all route tests PASS.

**Step 7: Full test + lint.**

Run in parallel: `pnpm test:unit`, `pnpm lint`.

**Step 8: Commit.**

```bash
git add app/api/live-games/[gameId]/route.ts \
        app/api/live-games/[gameId]/restore/route.ts \
        app/api/cards/[cardId]/live-games/route.ts \
        tests/unit/api/live-games-delete-route.test.ts
git commit -m "feat(live-game): DELETE and restore HTTP routes"
```

---

## Task 4: Client API wrappers + kebab menu + delete dialog (minimum viable delete)

**Files:**
- Modify: `lib/client/live-games-api.ts` (add `deleteLiveGame`, `restoreLiveGame`, extend `listLiveGames`)
- Create: `components/pick-em/live-host/delete-live-game-dialog.tsx`
- Modify: `components/pick-em/live-game-host-app.tsx`

**Step 1: Add client API wrappers.**

Append to `lib/client/live-games-api.ts`:

```ts
export function deleteLiveGame(gameId: string): Promise<void> {
  return requestJson<void>(`/api/live-games/${gameId}`, { method: "DELETE" });
}

export function restoreLiveGame(gameId: string): Promise<void> {
  return requestJson<void>(`/api/live-games/${gameId}/restore`, {
    method: "POST",
  });
}
```

Extend `listLiveGames` to accept an options param:

```ts
export function listLiveGames(
  cardId: string,
  opts?: { includeDeleted?: boolean },
): Promise<LiveGame[]> {
  const suffix = opts?.includeDeleted ? "?includeDeleted=true" : "";
  return requestJson<LiveGame[]>(`/api/cards/${cardId}/live-games${suffix}`);
}
```

**Step 2: Create the confirmation dialog.**

Create `components/pick-em/live-host/delete-live-game-dialog.tsx`:

```tsx
"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DeleteLiveGameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteLiveGameDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: DeleteLiveGameDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this game?</AlertDialogTitle>
          <AlertDialogDescription>
            This will move the game to trash. Players can&apos;t rejoin, and
            their picks, scores, and event history will be preserved. You can
            restore it within 30 days from the card&apos;s live games page.
            After 30 days it&apos;s permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? "Deleting..." : "Delete game"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Verify `@/components/ui/alert-dialog` exports match — run `grep -n "^export" components/ui/alert-dialog.tsx`. If the file doesn't exist, the shadcn recipe is to run the shadcn CLI or hand-write it; check whether any other component imports AlertDialog first (`grep -rn "AlertDialog" components/`). If nothing imports it, you may need to add the Radix wrapper — it's a standard shadcn block.

**Step 3: Modify `components/pick-em/live-game-host-app.tsx`.**

Add state + handler near the top of the component:

```tsx
const [deletingCandidateId, setDeletingCandidateId] = useState<string | null>(
  null,
);
const [isDeleting, setIsDeleting] = useState(false);

async function handleDelete(gameId: string) {
  setIsDeleting(true);
  const snapshot = games;
  // Optimistic remove.
  setGames((prev) => prev.filter((g) => g.id !== gameId));
  try {
    await deleteLiveGame(gameId);
    toast.success("Game deleted", {
      action: {
        label: "Undo",
        onClick: () => void handleRestore(gameId),
      },
      duration: 8000,
    });
  } catch (error) {
    setGames(snapshot); // roll back
    toast.error(
      error instanceof Error ? error.message : "Failed to delete game",
    );
  } finally {
    setIsDeleting(false);
    setDeletingCandidateId(null);
  }
}

async function handleRestore(gameId: string) {
  try {
    await restoreLiveGame(gameId);
    await loadGames(); // refresh to pick up the restored game in the right spot
    toast.success("Game restored");
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to restore game",
    );
  }
}
```

Add imports at the top: `deleteLiveGame`, `restoreLiveGame` (from `@/lib/client/live-games-api`), `DropdownMenu*` from `@/components/ui/dropdown-menu`, `DeleteLiveGameDialog` from `./live-host/delete-live-game-dialog`, `MoreVertical, Trash2` from `lucide-react`.

Inside each game's `<section>` (around line 152, the row with "Host Keying" and "End Game" buttons), add the kebab menu:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button type="button" variant="ghost" size="icon" aria-label="Game actions">
      <MoreVertical className="h-4 w-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem
      className="text-destructive focus:text-destructive"
      onSelect={(event) => {
        event.preventDefault();
        setDeletingCandidateId(game.id);
      }}
    >
      <Trash2 className="mr-2 h-4 w-4" />
      Delete game
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

At the bottom of the component (just before the closing `</div>`), render the dialog:

```tsx
<DeleteLiveGameDialog
  open={deletingCandidateId !== null}
  onOpenChange={(open) => {
    if (!open) setDeletingCandidateId(null);
  }}
  onConfirm={() => {
    if (deletingCandidateId) void handleDelete(deletingCandidateId);
  }}
  isDeleting={isDeleting}
/>
```

Verify `components/ui/dropdown-menu.tsx` exists: `ls components/ui/dropdown-menu.tsx`. If it doesn't but other files import from `@/components/ui/dropdown-menu`, find the actual path. If the codebase doesn't have one yet, flag before proceeding — another feature likely has the wrapper. Archive-cards PR #25 used a kebab too; `grep -rn "DropdownMenu" components/` will locate it.

**Step 4: Smoke test in the browser.**

Ask the user to run `pnpm dev` (per CLAUDE.md "Don't start dev servers"). Once running, navigate to `/cards/<some-card>/live`, create a game if none exists, click the kebab → Delete game → confirm. Verify the row disappears and the toast offers Undo. Click Undo and verify the row comes back.

**Step 5: Run lint + tests.**

Run in parallel: `pnpm lint`, `pnpm test:unit`.

**Step 6: Commit.**

```bash
git add lib/client/live-games-api.ts \
        components/pick-em/live-host/delete-live-game-dialog.tsx \
        components/pick-em/live-game-host-app.tsx
git commit -m "feat(live-game): delete from /live with kebab + undo toast"
```

---

## Task 5: Recently-deleted collapsible with restore

**Files:**
- Modify: `components/pick-em/live-game-host-app.tsx`
- Potentially create: `components/pick-em/live-host/recently-deleted-section.tsx` (extract if the host-app file grows unwieldy)

**Step 1: Add state + loader for deleted games.**

In `live-game-host-app.tsx`:

```tsx
const [deletedGames, setDeletedGames] = useState<LiveGame[]>([]);
const [isDeletedOpen, setIsDeletedOpen] = useState(false);
const [hasLoadedDeleted, setHasLoadedDeleted] = useState(false);

const loadDeletedGames = useCallback(async () => {
  try {
    const all = await listLiveGames(cardId, { includeDeleted: true });
    const onlyDeleted = all.filter((g) => g.deletedAt !== null);
    setDeletedGames(onlyDeleted);
    setHasLoadedDeleted(true);
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to load deleted games",
    );
  }
}, [cardId]);

function handleDeletedOpenChange(open: boolean) {
  setIsDeletedOpen(open);
  if (open && !hasLoadedDeleted) {
    void loadDeletedGames();
  }
}
```

**Step 2: Update `handleDelete` and `handleRestore` to keep both arrays in sync.**

When delete succeeds: push the soft-deleted game onto `deletedGames` (mark `hasLoadedDeleted = true` if first time).

When restore succeeds: remove from `deletedGames`, push to `games` (or just call `loadGames()` to re-sort).

**Step 3: Render the section below the active games grid.**

Add imports: `ChevronDown, ChevronRight, RotateCcw` from `lucide-react`. Use shadcn `<Collapsible>` from `@/components/ui/collapsible` (verify exists with `ls components/ui/collapsible.tsx`).

```tsx
{(hasLoadedDeleted ? deletedGames.length > 0 : true) && (
  <Collapsible open={isDeletedOpen} onOpenChange={handleDeletedOpenChange}>
    <CollapsibleTrigger asChild>
      <Button variant="ghost" className="w-full justify-start">
        {isDeletedOpen ? (
          <ChevronDown className="mr-2 h-4 w-4" />
        ) : (
          <ChevronRight className="mr-2 h-4 w-4" />
        )}
        Recently deleted
        {hasLoadedDeleted ? ` (${deletedGames.length})` : ""}
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent className="mt-2 space-y-2">
      {deletedGames.length === 0 && hasLoadedDeleted ? (
        <p className="text-sm text-muted-foreground px-2">
          No recently-deleted games.
        </p>
      ) : (
        deletedGames.map((game) => (
          <section
            key={game.id}
            className="rounded-lg border border-border bg-muted/40 p-3 opacity-80"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-semibold">
                  {game.joinCode}
                </p>
                <p className="text-xs text-muted-foreground">
                  Deletes in {daysUntilPurge(game.deletedAt)} day(s)
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleRestore(game.id)}
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                Restore
              </Button>
            </div>
          </section>
        ))
      )}
    </CollapsibleContent>
  </Collapsible>
)}
```

Add the helper at the top of the file:

```tsx
function daysUntilPurge(deletedAt: string | null): number {
  if (!deletedAt) return 0;
  const cutoff = new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000;
  const remaining = Math.max(0, cutoff - Date.now());
  return Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}
```

The `Math.max(1, ...)` avoids displaying "Deletes in 0 days" — if the purge is that close it'll be gone by the next `listCardLiveGames` call anyway.

**Step 4: Smoke test in the browser.**

Delete a game, expand "Recently deleted", verify it shows with a countdown, click Restore, verify it moves back to the active list.

**Step 5: Run lint + tests.**

Run in parallel: `pnpm lint`, `pnpm test:unit`.

**Step 6: Commit.**

```bash
git add components/pick-em/live-game-host-app.tsx
git commit -m "feat(live-game): recently-deleted collapsible with restore"
```

---

## Task 6: Canceled-game view for players and displays

**Files:**
- Modify: `lib/server/repositories/live-games.ts` (`getLiveGameState` / `getLiveGameViewerAccess` canceled branch)
- Modify: `app/api/live-games/[gameId]/state/route.ts` if the handler needs to pass through a new status.
- Modify: `stores/live-game-slice.ts` (handle the new status)
- Create: `components/pick-em/live-player/player-canceled-view.tsx`
- Create: `components/pick-em/live-display/display-canceled-view.tsx`
- Modify: `components/pick-em/live-game-player-app.tsx` (render canceled view on new status)
- Modify: `components/pick-em/live-game-display-app.tsx` (render canceled view on new status)

**Step 1: Write the canceled-branch test.**

Extend `tests/unit/repositories/live-games-delete.test.ts` (Task 2) with:

```ts
test("getLiveGameState exposes canceled status to in-game player session", async () => {
  // Seed a game, a player on it, then soft-delete.
  await seedGame("game-canceled");
  const sessionTokenHash = "hash-player-a";
  await db
    .insertInto("live_game_players")
    .values({
      id: "player-a",
      game_id: "game-canceled",
      nickname: "Alice",
      session_token_hash: sessionTokenHash,
      join_status: "approved",
      is_submitted: 0,
      picks_json: "{}",
      auth_method: "guest",
      clerk_user_id: null,
      joined_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
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
  assert.equal(state!.status, "canceled");
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
```

The exact column list for `live_game_players` may differ from above — run `grep -A 40 "'live_game_players'" migrations/*.ts` to get the real schema and adjust the insert.

**Step 2: Run tests to verify failure.**

Run: `pnpm test:unit -- --test-name-pattern "canceled"`.

Expected: FAIL because `getLiveGameState` currently returns `null` for soft-deleted games (Task 2 gatekeepered it).

**Step 3: Add the canceled branch in `getLiveGameViewerAccess` / `getLiveGameState`.**

Update `getLiveGameViewerAccess` (line ~3071) to handle the soft-deleted case AFTER trying to resolve a player session:

```ts
export async function getLiveGameViewerAccess(
  gameId: string,
  options: { /* ... */ },
): Promise<LiveGameViewerAccess | null> {
  const gameRow = await db
    .selectFrom("live_games")
    .selectAll()
    .where("id", "=", gameId)
    .executeTakeFirst();

  if (!gameRow) return null;

  // Deleted games are only visible to existing players (for the canceled view).
  if (gameRow.deleted_at) {
    const playerFromSession = options.sessionTokenHash
      ? await findLiveGamePlayerBySession(gameId, options.sessionTokenHash)
      : null;
    const player =
      playerFromSession ??
      (options.clerkUserId
        ? await findLiveGamePlayerByClerkUserId(gameId, options.clerkUserId)
        : null);
    if (!player) return null;

    const card = await getCardForGame(gameRow.card_id, gameRow.host_user_id);
    if (!card) return null;

    return {
      game: mapLiveGame(gameRow),
      card,
      player,
      isHost: false,
      isCanceled: true,
    };
  }

  // ... existing non-deleted flow unchanged ...
}
```

Add `isCanceled?: boolean` to the `LiveGameViewerAccess` type.

In `getLiveGameState`, check `access.isCanceled` and return a minimal state object:

```ts
if (access.isCanceled) {
  return {
    status: "canceled",
    game: access.game,
    card: { id: access.card.id, eventName: access.card.eventName },
    players: [],
    events: [],
    leaderboard: [],
    // ... only the fields the player-canceled-view needs
  };
}
```

Check the actual `LiveGameComputedState` type shape and adjust to satisfy it — the "canceled" status is a new allowed value. Update the enum if one exists (likely `LiveGameStatus` in `lib/types.ts` or a sibling `status` type on the state response).

**Step 4: Run repo tests.**

Run: `pnpm test:unit -- --test-name-pattern "canceled"`.

Expected: PASS.

**Step 5: Create `components/pick-em/live-player/player-canceled-view.tsx`.**

```tsx
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";

export function PlayerCanceledView() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <Ban className="h-12 w-12 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold">Game canceled</h1>
      <p className="text-sm text-muted-foreground">
        The host ended this game early. Your picks and any scoring for this
        session have been removed.
      </p>
      <Button asChild variant="outline" className="mt-4">
        <Link href="/">Return home</Link>
      </Button>
    </div>
  );
}
```

**Step 6: Create `components/pick-em/live-display/display-canceled-view.tsx`.**

Display-scale variant:

```tsx
export function DisplayCanceledView() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 text-center">
      <h1 className="text-6xl font-bold">Game canceled</h1>
      <p className="text-2xl text-muted-foreground">
        This live game has been canceled by the host.
      </p>
    </div>
  );
}
```

**Step 7: Wire up in `LiveGamePlayerApp` and `LiveGameDisplayApp`.**

In `components/pick-em/live-game-player-app.tsx`, near where other status branches (e.g. `ended`) are rendered, add:

```tsx
if (liveGameState?.status === "canceled") {
  return <PlayerCanceledView />;
}
```

Same for `components/pick-em/live-game-display-app.tsx` with `<DisplayCanceledView />`.

Imports need adding at the top of each file.

**Step 8: Update the Zustand slice to accept the new status.**

In `stores/live-game-slice.ts`, the `liveGameState` type / setter may narrow `status` to a union. Extend the union to include `"canceled"`. Find: `grep -n "status:" stores/live-game-slice.ts`. No action logic changes — `loadLiveGameState` just stores what the server returned.

**Step 9: Smoke test.**

Dev server running: join a game as a player (in one browser tab), then as host in another tab delete the game from `/live`. Watch the player tab: within the normal poll interval, it should switch to "Game canceled".

**Step 10: Run lint + tests.**

Run in parallel: `pnpm lint`, `pnpm test:unit`, `pnpm test:integration` if any exists for this area.

**Step 11: Commit.**

```bash
git add lib/server/repositories/live-games.ts \
        app/api/live-games/[gameId]/state/route.ts \
        stores/live-game-slice.ts \
        lib/types.ts \
        components/pick-em/live-player/player-canceled-view.tsx \
        components/pick-em/live-display/display-canceled-view.tsx \
        components/pick-em/live-game-player-app.tsx \
        components/pick-em/live-game-display-app.tsx \
        tests/unit/repositories/live-games-delete.test.ts
git commit -m "feat(live-game): canceled-game view for connected players and displays"
```

---

## Final verification

After all 5 commits:

1. **Branch diff** — run `git log --oneline origin/main..HEAD` and confirm 6 commits total (the original design-doc commit `a474763` + amendment `b37d16e` + five feature commits).
2. **Full test suite** — `pnpm test` (runs unit + integration).
3. **Lint clean** — `pnpm lint`.
4. **Build clean** — `pnpm build` (catches Next.js App Router type / route issues that `tsc --noEmit` wouldn't).
5. **Manual smoke paths** (dev server running — ask user to start it):
   - Delete an active game from `/cards/[cardId]/live` → row disappears, toast Undo works within 8s window.
   - Delete, expand "Recently deleted" → game appears with countdown.
   - Click Restore → game moves back to active list.
   - Open game as a player, have host delete from `/live` → player tab flips to "Game canceled" on next poll.
   - Wait for a game with `deleted_at < now() - 30d` (manually tweak the DB to simulate), reload `/live` → row is purged from DB, no longer appears even with `includeDeleted=true`.

## Drive-by improvements to avoid (out of scope)

- **Don't change `updateLiveGameStatus` to `PUT`** even though `.ai/context/live-games.md:50` claims that shape — the handler uses `PATCH`. If you touch the context doc, flag it separately.
- **Don't refactor `getLiveGameViewerAccess`** beyond the canceled branch; it got touched in PR #28 for Clerk-user-id resolution and there's no reason to re-layer it here.
- **Don't add a `/trash` route** or global "my deleted games" surface — the design explicitly scoped recovery to the per-card `/live` page.

## Skill handoff

Once execution starts, the implementing session should use `superpowers:executing-plans` to run these tasks task-by-task with verification between each. For TDD discipline inside each task (write failing test → implement → green), lean on `superpowers:test-driven-development`.
