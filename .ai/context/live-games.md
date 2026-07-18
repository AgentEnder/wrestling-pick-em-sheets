# Live games domain

A "live game" is an instance of a card being played live. The host enters real results into a "key" while players submit picks and a leaderboard updates. There are two `mode`s: `room` (multi-player room with join codes / QR / lobby) and `solo` (just the host keying for personal use).

## Surfaces

| Path | Component | Audience |
|---|---|---|
| `app/games/[gameId]/host/page.tsx` | `<LiveGameKeyHostApp>` | Host enters key + manages lobby/locks |
| `app/games/[gameId]/play/page.tsx` | `<LiveGamePlayerApp>` | Player submits picks |
| `app/games/[gameId]/display/page.tsx` | `<LiveGameDisplayApp>` | Big-screen TV display |
| `app/cards/[cardId]/live/page.tsx` | (entry) | Host launches a new live game |
| `app/cards/[cardId]/live/solo/page.tsx` | (entry) | Solo-mode launch |
| `app/join/page.tsx` | `<JoinPageClient>` | Join-by-code landing |

Components are grouped under `components/pick-em/`:

- `live-host/` — host panels (lifecycle controls, locks, fuzzy match review, join requests)
- `live-player/` — player views (`player-ended-view.tsx`)
- `live-display/` — display views (`lobby-view`, `active-game-view`, `ended-view`, `display-header`, `join-overlay`)
- `shared/` — cross-surface (`leaderboard-panel.tsx`)

## Card sections on live surfaces

Cards may define ordered sections (`card.sections`, `match.sectionId` — see cards.md). Live surfaces derive everything section-related from `lib/pick-em/section-utils.ts`; nothing extra is stored per game or snapshot:

- `buildMatchGroups(card)` — shared grouping (unsectioned matches first, then sections in order). Used by the player picks list (`live-game-player-app.tsx`), the host keying view (`live-game-key-host-app.tsx`), and the print sheet, so match numbering (`displayNumber` prop on `PlayerMatchPicks` / `KeyMatchSection`) stays consistent everywhere.
- `computeSectionScores(card, entry.breakdown.perQuestion)` — per-player section totals derived from the leaderboard breakdown rows (buckets: "Other Matches" for unsectioned, each section, "Event Bonuses"). Works retroactively on score snapshots since those store `perQuestion` rows.
- `withSectionScores(card, leaderboard)` — enriches entries for `LeaderboardPanel`, which renders a per-player "Night 1 12 · Night 2 8" line once anything section-scored is keyed.
- `score-breakdown.tsx` groups its rows under section headers with per-section subtotal rows.

- `solo-key/` + `solo-key-app.tsx`

The "app" wrappers (`live-game-player-app.tsx`, `live-game-key-host-app.tsx`, `live-game-display-app.tsx`) own polling, state, and event wiring.

## State / store

`stores/live-game-slice.ts:57-130` (Zustand slice). Holds:

- `livePayload` — host's working `LiveGameKeyPayload` (timers, match results, bonus answers, overrides)
- `liveGameState` — full server-side `LiveGameStateResponse` (card, game, players, leaderboard, events, locks)
- `lockState` — current lock state
- `games` — list of games for the current card
- UI flags

Key actions:

- `loadLiveGameState(gameId, joinCode)` — `GET /api/live-games/:gameId/state`
- `loadLiveGameKey(gameId)` / `syncLiveGameKey(gameId)` — host key fetch/save
- `saveMyLiveGamePicks` / `submitMyLiveGamePicks` — used inside `handleSave()`
- `updateLiveGameStatus(gameId, status, options)` — lifecycle transitions

Selectors live in `stores/selectors.ts`.

## API endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/live-games/:gameId/state?code=...` | Full state for player/display |
| DELETE | `/api/live-games/:gameId` | Soft-delete (host-owner via `getRequestUserId`, CSRF enforced) |
| POST | `/api/live-games/:gameId/restore` | Restore a soft-deleted game within 30 days (host-owner via `getRequestUserId`, CSRF enforced) |
| GET / PUT | `/api/live-games/:gameId/status` | Lifecycle (lobby ↔ live ↔ ended) |
| GET / PUT | `/api/live-games/:gameId/key` | Host's key payload (host only) |
| GET / PUT | `/api/live-games/:gameId/locks` | Host lock controls |
| GET / DELETE | `/api/live-games/:gameId/me` | Player session info |
| PUT | `/api/live-games/:gameId/me/picks` | Save picks (optimistic locking via `expectedUpdatedAt`) |
| POST | `/api/live-games/:gameId/me/submit` | Submit (sets `is_submitted = true`) |
| GET / POST / PUT | `/api/live-games/:gameId/join-requests` | Host approves late joiners |
| GET / POST / DELETE | `/api/live-games/:gameId/push-subscriptions` | Web push |
| GET | `/api/cards/:cardId/live-games` | Host's game list for a card. Accepts `?includeDeleted=true` to surface soft-deleted rows for the "Recently deleted" collapsible. |
| POST | `/api/live-games/join` | Join from code |
| POST | `/api/live-games/join-preview` | Preview join (before committing nickname) |

`app/api/live-games/[gameId]/route.ts` now exists and hosts the `DELETE` method added for issue #23; `app/api/live-games/[gameId]/restore/route.ts` hosts the companion restore endpoint.

## Authorization

- Owner endpoints: `getRequestUserId(request)` (Clerk).
- Host endpoints: `getHostLiveGame(gameId, hostUserId)` in `lib/server/repositories/live-games.ts:1923` — checks `host_user_id == hostUserId` AND `mode == "room"`, returns `null` if unauthorized. Pair this with the card-ownership check via `getCardForGame`.
- Player endpoints: read a session token cookie set during join; see `lib/server/live-game-session.ts`. The cookie maps to a `live_game_players` row.
- CSRF: `lib/server/csrf.ts` — non-GET endpoints validate a CSRF header.

## Lifecycle controls (host)

`components/pick-em/live-host/game-lifecycle-controls.tsx:40-244`:

- "Start Game" → `updateLiveGameStatus(gameId, "live", options)`
- "End Game" → `updateLiveGameStatus(gameId, "ended")` (red destructive style; no deletion)
- "Allow late joins" toggle
- Scheduled start time input

Delete is **not** in `game-lifecycle-controls.tsx`. The delete affordance lives on `LiveGameHostApp` (`components/pick-em/live-game-host-app.tsx`) at `/cards/[cardId]/live` as a kebab (three-dot) menu that opens an `AlertDialog` confirm flow (`components/pick-em/live-host/delete-live-game-dialog.tsx`). Confirming calls `DELETE /api/live-games/:gameId`, which sets `deleted_at` rather than hard-deleting; a sonner toast provides undo within the 30-day window by hitting `POST /api/live-games/:gameId/restore`. Lazy purge removes rows once `deleted_at` is older than 30 days (triggered by `listCardLiveGames`).

### Soft-delete + recovery

Soft-delete semantics for issue #23:

- `live_games.deleted_at` column (nullable ISO timestamp). Non-null = soft-deleted.
- Four repository gatekeepers filter `deleted_at IS NULL` on read/mutate paths: `getHostLiveGame`, `listCardLiveGames` (unless `includeDeleted: true`), `updateLiveGameStatus`/`updateLiveGameLocks`/`updateLiveGameKeyForHost` (mutators return `null` for deleted rows), and `/api/my-games` (player history hides deleted games immediately).
- 30-day lazy purge: every call to `listCardLiveGames` opportunistically runs `purgeExpiredLiveGames()`, which hard-deletes rows where `deleted_at < now - 30d` and lets FK cascades clean up children (`live_game_events`, `live_game_players`, `live_game_score_snapshots`, `live_game_push_subscriptions`).
- Canceled-view: connected players and displays see a dedicated "game canceled" state — `getLiveGameState` reports `status: "canceled"` to active session-token/clerk requesters on a soft-deleted game, and returns `null` to strangers.

See `.ai/plans/2026-04-17-delete-live-games-design.md` for the full design.

## Player save / submit flow

`components/pick-em/live-game-player-app.tsx`:

- `handleSave()` (lines 552–588): `saveMyLiveGamePicks()` then auto-submits if not already submitted.
- The save button lives inside `<PlayerHeader>` rendered at the top (line ~680).
- A "refresh" FAB at `bottom-4 right-4` already exists (lines 740–748) when state is stale — useful precedent for the new save FAB in issue #21.
- `isSaving` is the disabled-state flag; toast feedback is via `sonner`.

## End-game views

- **Player**: `components/pick-em/live-player/player-ended-view.tsx:14-44` — Trophy icon, final rank/score, `<LeaderboardPanel variant="compact" />`.
- **Display (TV)**: `components/pick-em/live-display/ended-view.tsx:13-33` — "Final Standings" + `<LeaderboardPanel variant="display" />`.

Neither view currently shows a per-question score breakdown — this is the gap for issue #22.
