# Architecture

## Stack

- **Framework**: Next.js 16 (App Router), React 19
- **Language**: TypeScript 5.7 (strict)
- **Auth**: Clerk (`@clerk/nextjs`) for owners; guest sessions for live-game players
- **Database**: libSQL (local SQLite for dev at `.local-db/`, Turso/libSQL in prod) accessed via Kysely
- **Migrations**: hand-rolled in `migrations/NNNN_*.ts`, run with `pnpm db:migrate:latest`
- **Generated DB types**: `lib/server/db/generated.ts` via `kysely-codegen` — regenerate with `pnpm db:codegen`
- **State**: Zustand (`stores/app-store.ts` is the root; `editor-slice.ts`, `live-game-slice.ts` are slices)
- **UI**: Radix primitives + shadcn-style wrappers in `components/ui/`, Tailwind v4 (`app/globals.css` holds tokens + print styles)
- **Forms / validation**: react-hook-form + zod
- **Push notifications**: `web-push` (live-game host pushes)
- **Tests**: `tsx --test` for unit/integration (`tests/unit`, `tests/integration`); Playwright for e2e (`tests/`)

## Directory layout

```
app/                    # Next.js App Router
  admin/                # Admin UIs (bonus questions, rosters)
  api/                  # Route handlers (server)
    cards/              # Card CRUD, overrides, live-key, live-games
    live-games/         # Game state/status, locks, join, push, player picks/submit
    admin/              # Admin-only (promotions, match types, templates)
    runtime/            # Misc (lan-origin)
  cards/[cardId]/       # Card editor + live entry points (live, live/solo)
  games/[gameId]/       # Live game surfaces: host, play, display
  join/                 # Join-by-code landing
  my-games/             # User game history
components/
  pick-em/              # Feature components, grouped by surface
    live-host/          # Host-only panels (lifecycle, locks, join requests)
    live-player/        # Player-only views (ended view, etc.)
    live-display/       # TV display views (lobby, active, ended, join overlay)
    shared/             # Cross-surface (leaderboard panel, etc.)
    solo-key/           # Solo-mode key entry
  ui/                   # Radix wrappers (button, dialog, input, etc.)
  match-editor.tsx      # Big editor for matches + bonus questions on a card
  event-settings.tsx    # Event-level card settings
  print-sheet.tsx       # Printable card view
lib/
  client/               # Client-side API wrappers + helpers
  server/               # Server-only logic
    repositories/       # DB access (cards, live-games, live-keys, rosters, ...)
    scoring.ts          # Pure scoring functions (per-question)
    scoring-utils.ts    # Max possible points, etc.
    auth.ts             # Auth helpers
    csrf.ts             # CSRF protection
    live-game-session.ts# Guest session token handling
    live-game-push.ts   # Web push to players
    db/                 # DB connection, generated types, permission helpers
  pick-em/              # Shared client/server helpers (leaderboard utils, etc.)
  types.ts              # Domain types (BonusQuestion, LiveGame*, PickEmSheet, ...)
  match-types.ts        # Match type metadata
  fuzzy-match.ts        # Fuzzy nickname matching
stores/
  app-store.ts          # Zustand root
  editor-slice.ts       # Card editor state
  live-game-slice.ts    # Live game state (host + player)
  selectors.ts          # Memoized selectors
migrations/             # Hand-rolled Kysely migrations
docs/                   # Existing design + plan docs
tests/
  unit/                 # tsx --test
  integration/          # tsx --test against an in-memory libsql
  *.spec.ts             # Playwright e2e
```

## Conventions worth knowing

- **API route handlers** export `GET/POST/PUT/DELETE` from `app/api/.../route.ts`. They typically call into `lib/server/repositories/*` and return `NextResponse.json({ data, error })`.
- **Server vs client**: anything inside `lib/server/` must never be imported by client code. Client API wrappers live in `lib/client/*-api.ts`.
- **Zustand**: feature slices export `create*Slice` functions composed in `stores/app-store.ts`. Selectors live in `stores/selectors.ts`.
- **Auth pattern**: server routes call `getRequestUserId(request)` (Clerk-backed) for owner-authenticated endpoints. Live-game player endpoints use a session-token cookie set by the join flow (see `lib/server/live-game-session.ts`).
- **Card resolution**: cards may be derived from a `template_card_id` with overrides; always go through `findResolvedReadableCardById` instead of reading the raw row.
- **No backwards compatibility shims** — feature branches replace code rather than running both old and new paths. Match this style when planning.

## Build / verify commands

```bash
pnpm dev                 # next dev
pnpm build               # next build
pnpm test                # unit + integration
pnpm test:unit
pnpm test:integration
pnpm test:e2e            # playwright (don't auto-start dev server here)
pnpm lint                # eslint
pnpm db:migrate:latest   # run new migrations
pnpm db:codegen          # regenerate lib/server/db/generated.ts
```

> Never run `pnpm dev` in an automation context — the user prefers to start long-lived processes manually (CLAUDE.md guidance).
