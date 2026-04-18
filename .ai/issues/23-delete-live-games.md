# #23 — Ability to delete live games

> **Labels**: priority: high
> **Author**: AgentEnder
> **Created**: 2026-04-17

## Issue body

> The person who owns the live game should be able to delete it at any time, including any player submissions and scored things, histories, etc associated with that specific game

## Where it lives

- Host UI today: `components/pick-em/live-host/game-lifecycle-controls.tsx:40-244`. Has Start/End buttons, late-join toggle, scheduled start. **No Delete button.** End just sets `status = 'ended'`.
- Host app entry: `components/pick-em/live-game-key-host-app.tsx`.
- Store: `stores/live-game-slice.ts` — would need a `deleteLiveGame` action.
- Lifecycle action used for End today: `updateLiveGameStatus(gameId, "ended")`.
- API: **no `app/api/live-games/[gameId]/route.ts` exists** — file needs to be created with a `DELETE` handler. (Sibling routes for `state`, `status`, `key`, `locks`, `me`, etc. all live under `app/api/live-games/[gameId]/...`.)
- Repository: `lib/server/repositories/live-games.ts` — add a `deleteLiveGame(gameId, hostUserId)` helper.
- Auth helper: `getHostLiveGame(gameId, hostUserId)` (line 1923) gives the right host check (also enforces `mode === "room"`).

## What "delete" cascades to

Schema-level, cascading on `live_games.id ON DELETE CASCADE` (set up in 0012/0019/0024 migrations) covers:

- `live_game_players` — all player join records, picks, submission state
- `live_game_events` — all event history rows
- `live_game_push_subscriptions` — outstanding web push subscriptions
- `live_game_score_snapshots` — score snapshot rows

So a single `DELETE FROM live_games WHERE id = ? AND host_user_id = ?` is enough to drop everything the user listed in the issue. The card itself is not affected (FK is `card_id ON DELETE CASCADE` from `live_games` → `cards`, not the other direction; deleting a game doesn't delete the card).

## Behavior questions for planning

- **Who can delete?** Issue says "owner". The host check (`host_user_id == userId` AND `mode == "room"`) maps to that. Solo-mode games (mode `solo`) — does the user want to delete those too? Trivially extendable by relaxing the mode check.
- **When can they delete?** Any status (lobby, live, ended)? Issue says "at any time" — yes.
- **Soft vs hard delete.** Issue explicitly says "including any player submissions and scored things, histories" — sounds like hard delete is desired. No need for an `is_deleted` column.
- **Confirmation UX.** Destructive — needs an `<AlertDialog>` (Radix) confirmation, double-click, or text-confirm input. Pattern to mirror: existing destructive-style "End Game" button in `game-lifecycle-controls.tsx`.
- **Where is the button?** Probably in `game-lifecycle-controls.tsx` next to "End Game", but visually demoted (lower-priority, danger styling). Consider hiding it inside an "Advanced / danger zone" expandable.
- **After delete, where does the user go?** Likely back to the card page (`/cards/:cardId`) or to `/my-games`. Need toast feedback.
- **Push notification side effects.** Are there active subscriptions? Cascading delete drops the rows; if we send push, we should send a "game deleted" payload first (or just skip — issue doesn't ask).

## Suggested implementation surface

1. Migration: none required (cascades already in place).
2. Repository: `deleteLiveGame(gameId, hostUserId)` returning a boolean / row count.
3. API: new `app/api/live-games/[gameId]/route.ts` with `export async function DELETE(...)` — host check, call repository, 204 / `{ data: { id } }`.
4. Client API: `deleteLiveGame(gameId)` in `lib/client/live-games-api.ts` (or wherever sibling actions live).
5. Store action: `deleteLiveGame(gameId)` in `live-game-slice.ts` — calls API, clears `liveGameState`, optionally redirects.
6. UI: button in `game-lifecycle-controls.tsx` + confirmation dialog.
7. Tests: integration test that creates a game with a few players + events, deletes it, confirms cascade.

## Cross-cutting

- See `.ai/context/live-games.md` (API endpoints + Authorization sections).
- See `.ai/context/auth-and-ownership.md` for the host-check pattern.
- See `.ai/context/data-model.md` (cascading deletes paragraph) for what's wiped.
