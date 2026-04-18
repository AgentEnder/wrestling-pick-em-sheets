# Delete live games — design

> Issue: [#23 — Ability to delete live games](../issues/23-delete-live-games.md)
> Date: 2026-04-17
> Status: design approved, ready for implementation plan

## Problem

Hosts have no way to remove a live game they own. The lifecycle controls (`components/pick-em/live-host/game-lifecycle-controls.tsx`) offer Start / End / late-join toggle / scheduled start — nothing for disposal. "End" sets `status = 'ended'`; the row and all associated picks, events, and snapshots linger forever.

Issue #23 asks for the owner to be able to delete a game "at any time, including any player submissions and scored things, histories, etc associated with that specific game."

## Approach: soft delete with 30-day recovery, lazy purge

A single nullable `deleted_at` column on `live_games`. Soft-deleted games are hidden from all read paths via filters at ~5 gatekeeper functions. The row and its child data are physically untouched during the soft-delete window — no cascade fires because we never actually `DELETE` the row. After 30 days, a lazy purge issued on `listCardLiveGames` reads runs the real `DELETE`, which then triggers the existing FK cascades and permanently wipes children.

### Why soft, not hard

The issue text is satisfied either way — child rows are "gone" from the user's perspective as soon as gatekeepers stop returning the game. Soft delete adds recoverability for the "I deleted the wrong game" case with modest additional cost (one column, ~5 filter additions, one restore surface). The hard purge that eventually fires still honors the issue's "gets rid of it" intent.

### Precedent

Archive-cards (#16, migration 0025) is the closest shipped analog and shapes the design:

- Nullable timestamp column as the flag (`cards.archived_at` → `live_games.deleted_at`)
- Partial index on the "active" slice for query performance
- Reversible via a sibling repo function (`unarchiveCard` → `restoreLiveGame`)
- `listReadableCards` takes `includeArchived` → `listCardLiveGames` takes `includeDeleted`

The deliberate divergence: archive used `POST /archive` + `POST /unarchive` sub-routes. Delete uses `DELETE /api/live-games/:gameId` because `DELETE` is the semantically correct verb from the caller's perspective, even when implemented as soft.

## Decision summary

| Question | Decision |
|---|---|
| Hard vs soft delete | Soft (nullable `deleted_at`), with 30-day lazy purge into real `DELETE` + cascade |
| Scope: room + solo? | **Room only.** The `/cards/[cardId]/live` surface (our only delete entry point per Q9) already filters `mode === 'room'` via `listCardLiveGames`; solo games are managed in-place via `solo-key-app.tsx` and aren't listed anywhere. Solo deletion can be a separate issue once the room pattern ships. |
| Allowed statuses | Any — lobby, live, ended |
| Confirmation UX | `<AlertDialog>` explaining the 30-day trash + restore, single Cancel / Delete action |
| Retention | 30 days, lazy purge on `listCardLiveGames` reads (no cron) |
| Button placement | Kebab (⋮) on each game row in `LiveGameHostApp` at `/cards/[cardId]/live`. Not inside `game-lifecycle-controls.tsx`, not inside `solo-key-app.tsx` |
| Restore UX | Collapsible "Recently deleted" section on same `/live` page, with "Deletes in N days" countdown and per-row Restore button |
| Post-delete redirect | None (user is already on `/live`). List re-renders; toast shows "Game deleted · [Undo]" for 8s |
| Player view on mid-game delete | New dedicated `PlayerCanceledView` — distinct from the existing `PlayerEndedView`, no trophy/leaderboard, clearly communicates cancellation |
| Display (TV) view on delete | Parallel new `DisplayCanceledView` |
| Push notifications | No proactive "canceled" push. Gatekeeper filter on `live-game-push.ts` prevents sending about soft-deleted games |

## Section 1 — Data model & migration

New migration: `migrations/0026_live_games_soft_delete.ts`.

```ts
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("live_games")
    .addColumn("deleted_at", "text")
    .execute();

  // Partial index mirrors the pattern from migration 0025 (cards_archived_at):
  // "active live games for this host" is the hot path; archived rows don't
  // need to be in the index.
  await db.schema
    .createIndex("idx_live_games_active_host_created")
    .on("live_games")
    .columns(["host_user_id", "created_at"])
    .where(sql`deleted_at IS NULL`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("idx_live_games_active_host_created").execute();
  await db.schema.alterTable("live_games").dropColumn("deleted_at").execute();
}
```

After the migration: `pnpm db:codegen` regenerates `lib/server/db/generated.ts`.

No child-table schema changes. Cascades (on `live_game_players`, `live_game_events`, `live_game_push_subscriptions`, `live_game_score_snapshots`) stay as-is; they only fire when the 30-day purge runs an actual `DELETE`.

## Section 2 — Server: gatekeepers + repository

### Gatekeepers — add `deleted_at IS NULL` filter

| # | Function | File | Role |
|---|---|---|---|
| 1 | `getHostLiveGame` | `lib/server/repositories/live-games.ts:1923` | Host endpoints (room only) |
| 2 | `getLiveGameViewerAccess` | same, ~1999 | Player/display state |
| 3 | `listCardLiveGames` | same, ~1905 | Card's active games list. Accepts new `{ includeDeleted?: boolean }` option |
| 4 | `findLiveGameByJoinCode` (join flow) | `lib/server/repositories/live-keys.ts` | Join-by-code resolution |
| 5 | Push delivery resolver | `lib/server/live-game-push.ts` | Pre-send gatekeeping |

Each change is a single `.where("deleted_at", "is", null)` clause. Downstream queries against child tables need no changes — they only run after a gatekeeper returns a non-deleted game.

### New repository functions (add to `live-games.ts`)

```ts
// Scoped to room-mode games owned by the caller. Mirrors getHostLiveGame's
// filters (host_user_id + mode='room') and lets the caller opt into seeing
// soft-deleted rows (needed for restore).
export async function softDeleteLiveGame(
  gameId: string,
  userId: string
): Promise<LiveGame | null>
// UPDATE live_games SET deleted_at = now() WHERE id=? AND host_user_id=? AND mode='room' AND deleted_at IS NULL

export async function restoreLiveGame(
  gameId: string,
  userId: string
): Promise<LiveGame | null>
// UPDATE live_games SET deleted_at = NULL WHERE id=? AND host_user_id=? AND mode='room' AND deleted_at IS NOT NULL

export async function purgeExpiredLiveGames(): Promise<number>
// DELETE FROM live_games WHERE deleted_at IS NOT NULL AND deleted_at < now() - 30d
// Cascades fire here and wipe child rows permanently.

export const LIVE_GAME_SOFT_DELETE_RETENTION_DAYS = 30;
```

No new "ownership helper" is needed. Both mutating functions replicate the `host_user_id + mode='room'` guard that `getHostLiveGame` uses today — consistent with the scope-narrowed Q1 decision.

### Lazy purge wiring

At the top of `listCardLiveGames`, call `await purgeExpiredLiveGames()`. No throttling — the partial index on `deleted_at IS NULL` means the purge query touches only the "deleted slice" (small by construction), and expired rows in that slice are the only candidates. When there's nothing to delete, the query is near-free.

### Canceled-state branch for players

`getLiveGameState(gameId, options)` gains one branch before the gatekeeper filter:

1. Fetch the row directly (bypass gatekeeper).
2. If `deleted_at IS NOT NULL` and the requester has a valid `live_game_players` session for this game (`getLiveGameSession(request, gameId)` returns non-null), return `{ status: 'deleted', cardTitle }`.
3. Otherwise, apply the normal gatekeeper filter and return null / 404 as today.

This is the only place where a soft-deleted row is allowed to "leak", and only to users who were already in the game.

## Section 3 — API routes

### New: `app/api/live-games/[gameId]/route.ts`

```ts
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  await validateCsrf(request);
  const { gameId } = await params;
  const userId = await getRequestUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const game = await softDeleteLiveGame(gameId, userId);
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ data: { id: gameId, deletedAt: game.deletedAt } });
}
```

The 404 covers three cases uniformly: game doesn't exist, user isn't the owner, game already deleted. No need to distinguish — 404 is accurate from the caller's perspective.

### New: `app/api/live-games/[gameId]/restore/route.ts`

`POST` method, same auth + CSRF, calls `restoreLiveGame`. Chose a sub-route rather than overloading the top-level route file because restore is semantically distinct from the `DELETE` half.

### Modify: `GET /api/live-games/[gameId]/state` (existing)

Add the canceled-state branch described in Section 2. Response shape gains a new `status: 'deleted'` variant; existing players' poll loop picks this up naturally.

### Modify: `GET /api/cards/[cardId]/live-games` (existing)

Accept `?includeDeleted=true` param, pipe through to `listCardLiveGames(cardId, userId, { includeDeleted: true })`. Mirrors the shipped `listReadableCards` `includeArchived` pattern.

### CSRF

Both new mutating routes call `validateCsrf(request)` at the top, matching every other non-GET route per `.ai/context/auth-and-ownership.md`.

## Section 4 — Client data flow & state

### Client API wrappers (`lib/client/live-games-api.ts`)

```ts
export async function deleteLiveGame(gameId: string): Promise<void>
export async function restoreLiveGame(gameId: string): Promise<void>
```

Both use the existing CSRF-aware fetch wrapper and throw on non-2xx.

### Zustand slice (`stores/live-game-slice.ts`)

```ts
deleteLiveGame: (gameId: string) => Promise<void>
restoreLiveGame: (gameId: string) => Promise<void>
deletedGames: LiveGame[]            // new
loadCardLiveGames: (cardId: string, opts?: { includeDeleted?: boolean }) => Promise<void>   // extended
```

Both actions are **optimistic**: move the game between `games` and `deletedGames` arrays immediately on call; roll back on API failure and surface an error toast. Optimistic UX matters here because the user is watching the list on `/live` — a pessimistic wait-for-server refresh feels laggy for a reversible action.

The existing `liveGameState` field gains a `status: 'canceled'` variant handled by `loadLiveGameState`.

### Undo toast

```ts
await deleteLiveGame(gameId);
toast.success("Game deleted", {
  action: { label: "Undo", onClick: () => restoreLiveGame(gameId) },
  duration: 8000,
});
```

The 8s window covers "oh wait" cases; the 30-day card-page restore path is the longer safety net.

## Section 5 — UI components

### Modify `components/pick-em/live-game-host-app.tsx`

- **Per-row kebab menu** — in the existing `games.map((game) => ...)` block (~line 128), wrap the row in a `<DropdownMenu>` with a single "Delete game" item (destructive variant, trash icon). Identical for room and solo; the kebab doesn't branch on `game.mode`.
- **"Recently deleted" collapsible** — render below the active games list. Header: "Recently deleted (N)". Defaults collapsed. First expansion triggers `loadCardLiveGames(cardId, { includeDeleted: true })` (result cached). Each deleted row: title + date, "Deletes in N days" countdown (computed from `deletedAt + 30d`), "Restore" button. Muted styling (`opacity-70`). Hidden entirely when `deletedGames.length === 0`.

### New component: `components/pick-em/live-host/delete-live-game-dialog.tsx`

Wraps Radix `<AlertDialog>`.

- Title: "Delete this game?"
- Body: "This will move the game to trash. Players can't rejoin, and their picks, scores, and event history will be preserved. You can restore it within 30 days from the card's live games page. After 30 days it's permanently deleted."
- Buttons: `Cancel` / `Delete game` (destructive).
- Parent wires `gameId` and an `onConfirm` handler that calls the store action.

### New: `components/pick-em/live-player/player-canceled-view.tsx`

~30 lines. Plain message: "This game was canceled by the host." + "Return home" button linking to `/`. No trophy, no leaderboard, no rank. Rendered by `LiveGamePlayerApp` when `liveGameState.status === 'canceled'`.

### New: `components/pick-em/live-display/display-canceled-view.tsx`

Parallel to the player variant but at big-screen typography scale. No standings. Rendered by `LiveGameDisplayApp`.

### Untouched

- `components/pick-em/live-host/game-lifecycle-controls.tsx` — deletion is not part of in-host flow.
- `components/pick-em/solo-key-app.tsx` — deletion is not part of solo-key flow either. Single canonical entry point is `/live`.

## Section 6 — Testing

Model after `tests/unit/repositories/cards-archive.test.ts` (shipped with #16).

### `tests/integration/repositories/live-games-delete.test.ts`

1. **Soft delete happy path** — create game + 2 players + events + snapshot; `softDeleteLiveGame` sets `deleted_at`; all child rows still present (no cascade).
2. **Gatekeepers filter** — `getHostLiveGame`, `getLiveGameViewerAccess`, `listCardLiveGames`, join-by-code all skip the deleted game.
3. **`listCardLiveGames({ includeDeleted: true })`** — surfaces the deleted game with `deletedAt`.
4. **Restore** — flips `deleted_at` back; gatekeepers resume returning the game; children untouched.
5. **Non-owner blocked** — 404-equivalent null return; row untouched.
6. **Solo-mode blocked** — `softDeleteLiveGame` on a `mode='solo'` row returns null; row untouched. Scope is room-only per the amended Q1.
7. **Idempotent re-delete** — re-delete returns null; `deleted_at` unchanged.
8. **30-day purge** — insert a row with `deleted_at = now - 31d` + child rows; `purgeExpiredLiveGames` deletes the row AND the children (cascade fires). A row at 29d survives.

### `tests/integration/api/live-games-delete.test.ts`

- `DELETE /api/live-games/:gameId` as owner → 200 + soft-deleted.
- Non-owner → 404.
- Unauthenticated → 401.
- Missing CSRF → CSRF error.
- `POST /api/live-games/:gameId/restore` as owner → restores.
- `GET /api/live-games/:gameId/state` as in-game player on a deleted game → `{ data: { status: 'deleted' } }`.
- Same endpoint, non-session requester → 404.

### Skipped

- Component unit tests for the new dialog + canceled views — thin enough that integration coverage is sufficient.
- E2E — integration coverage of the soft-delete + restore flow is adequate; can add Playwright later if UX regressions surface.

## Cross-cutting notes

- **Archive-cards precedent** (`.ai/context/cards.md`, migration 0025) is the template. Mirror the partial-index pattern and the `includeX` param naming.
- **Deliberate API divergence from archive**: `DELETE /api/live-games/:gameId` instead of a `POST /archive` sub-route, because "delete" is the user-facing verb (issue wording) and we want the HTTP verb to match. Restore uses `POST /restore` sub-route for symmetry with sibling live-game sub-routes.
- **Cascade semantics reminder**: soft delete does NOT cascade (we never run `DELETE`). Only the 30-day purge cascades. The schema `ON DELETE CASCADE` declarations remain unchanged.
