# #16 — feat: archive cards to hide from continue editing without deleting

> **Labels**: priority: high
> **Author**: AgentEnder
> **Created**: 2026-04-17

## Issue body

(Body intentionally left empty in GitHub — title carries the intent.)

Inferred requirements:

- An owner can archive a saved card so it stops appearing in the default "Continue Editing" list.
- Archive is non-destructive — the data, including any live games, stays.
- There should be a way to view archived cards and unarchive them.
- Templates and other users' public cards probably shouldn't be archivable (only your own owned cards).

## Where it lives

- List UI: `components/pick-em/cards-workspace.tsx:115-436` ("Continue Editing" section at 327–371). No per-row action menu today.
- Secondary picker: `components/pick-em/card-library.tsx:31-146` (loaded-card dropdown — no destructive UI either).
- API:
  - `GET /api/cards` (`app/api/cards/route.ts:16-48`) — `listReadableCards(userId)`, no filters.
  - `GET/PUT /api/cards/[cardId]` (`app/api/cards/[cardId]/route.ts:164-213`) — no `DELETE` either.
- Repository: `lib/server/repositories/cards.ts`
  - `listReadableCards` (line 345)
  - `findResolvedReadableCardById` (line 534)
  - `persistOwnedCardSheet` (line 803)
  - No archive/delete helpers exist.
- Permissions: `lib/server/db/permissions.ts` — `isCardOwner` is the right gate.
- Client API: `lib/client/cards-api.ts:82-154` — `listCards`, `CardSummary` (no `archived*` field).

## Schema work

The `cards` table (`migrations/0001_initial.ts:20-45`) has no archive column. A new migration is required, e.g.:

```sql
ALTER TABLE cards ADD COLUMN archived_at TEXT; -- NULL = active
```

Then `pnpm db:codegen` to refresh `lib/server/db/generated.ts`.

## Behavior questions worth resolving during planning

- Should archived cards be excluded from `listReadableCards` by default *for everyone*, or only when the current user is the owner?
- Should an owner still be able to **launch a new live game** from an archived card, or is archive a "read-only" state?
- Existing live games on an archived card — keep playable? Hide from `/api/cards/:cardId/live-games`?
- Is "archive" the same as "soft delete" or do we eventually want both? (Today there's no delete at all; introducing archive first sidesteps that decision.)
- Where does the unarchive UI live — a tab in `CardsWorkspace`, a filter toggle, or a separate "Archived" view?

## Likely implementation surface area

- Migration: add `archived_at`.
- Repository: filter `archived_at IS NULL` in `listReadableCards` (with an opt-in `includeArchived` flag); add `archiveCard(cardId, userId)` / `unarchiveCard(cardId, userId)`.
- API: new endpoint(s) — either `POST /api/cards/:cardId/archive` + `POST .../unarchive`, or `PATCH /api/cards/:cardId` accepting `{ archived: boolean }`. Add `?includeArchived=true` to list endpoint.
- Client API: `archiveCard`, `unarchiveCard`, optional list filter.
- UI: per-card action menu (kebab) in `cards-workspace.tsx`, a section/toggle to show archived cards.
- Tests: none today for card CRUD; this is a good time to seed the first ones.

## Cross-cutting

- See `.ai/context/cards.md` (APIs + repository function locations) and `.ai/context/data-model.md` (cards schema, permissions).
- See `.ai/context/auth-and-ownership.md` for the owner-check pattern to reuse on the new endpoint.

## Resolution (2026-04-17)

Landed via plan `docs/plans/2026-04-17-archive-cards.md`. Decisions:

- **Global hiding**, owner-scoped widening: archived cards are hidden from every viewer's list by default. `GET /api/cards?includeArchived=true` only widens the filter for the caller's *own* archived cards — other users' archived public cards stay hidden.
- **Templates are archivable** (past-event use case). Archiving a public template drops it from the Start From Template gallery and `createCardFromTemplate` refuses to clone archived templates.
- **Archive ≠ launch-block.** Existing live games on an archived card keep working (lobby, live, and ended). New live games cannot be launched until the card is unarchived — enforced at the page level in `app/cards/[cardId]/live/page.tsx` and `.../live/solo/page.tsx`, plus a disabled "Live Game" button on the editor.
- **Archive is non-destructive.** No DELETE was introduced; `findResolvedReadableCardById` does not filter on `archived_at`, so deep links to archived cards still resolve.
- **UI:** kebab menu on owned-card rows with Archive/Unarchive; a `Show archived` switch in the Continue Editing header persists to `localStorage` under `pick-em-cards-workspace-show-archived`.
