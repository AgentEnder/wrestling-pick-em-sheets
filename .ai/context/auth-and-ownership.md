# Auth & ownership

## Three identity types

1. **Card owners** — Clerk-authenticated users (cookies via `@clerk/nextjs`). Identified server-side by `getRequestUserId(request)` (`lib/server/auth.ts`). Owners can create/edit cards and host live games.
2. **Live-game hosts** — same as card owners; "host" = "owner of the card the game was launched from". A host check is `host_user_id == userId` AND `mode == "room"` via `getHostLiveGame` (`lib/server/repositories/live-games.ts:1923`).
3. **Live-game players** — guest sessions identified by a hashed session-token cookie. Set during the join flow. See `lib/server/live-game-session.ts`. A player can also optionally be Clerk-authenticated (`live_game_players.auth_method = 'clerk'` and `clerk_user_id`).

## CSRF

`lib/server/csrf.ts` — non-GET endpoints validate a CSRF header. Client wrappers (`lib/client/*`) attach the token automatically.

## Common patterns to follow when adding endpoints

```ts
// Owner-protected (e.g., card edit, live-game delete)
const userId = await getRequestUserId(request);
if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

const game = await getHostLiveGame(gameId, userId);
if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
```

```ts
// Player-protected (live game pick endpoints)
const session = await getLiveGameSession(request, gameId);
if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
```

## Cascading deletes

The schema is set up so that deleting a `live_games` row (issue #23) automatically removes:

- `live_game_players` rows (cascading FK on `game_id`)
- `live_game_events` rows (cascading FK)
- `live_game_push_subscriptions` rows
- `live_game_score_snapshots` rows

So issue #23's server-side work is small: a single DELETE with the host check, plus the route handler. The cascade does the rest.

For issue #16 (archive cards), we **don't** want a DELETE — we want a soft "hide from default listing". A new column + filter does the job.

## Where to add new endpoints

Follow the file colocation pattern:

- New top-level method on a live game: `app/api/live-games/[gameId]/route.ts` (file does not exist yet — create it for issue #23 with `DELETE`).
- New method on a card: `app/api/cards/[cardId]/route.ts` (already has `GET` and `PUT`; add `DELETE` or `POST .../archive` for #16).
