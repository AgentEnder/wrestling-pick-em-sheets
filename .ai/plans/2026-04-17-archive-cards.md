# Archive Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Let a card owner archive a saved card so it stops appearing in the default "Continue Editing" list (and in the template gallery, if it is a template). Archive is non-destructive — the card row, its matches, its overrides, and any live games spawned from it stay intact and fully usable. Archived cards are hidden from *every* viewer's card list by default, but a `?includeArchived=true` query param and a "Show archived" toggle in the card manager let the owner surface them again. New live games cannot be launched from an archived card; existing live games (lobby / live / ended) continue to work unchanged.

**Architecture:** Add a nullable `archived_at TEXT` column on `cards` (NULL = active, ISO timestamp = archived). Filter `listReadableCards` and `createCardFromTemplate` on `archived_at IS NULL` by default; accept an owner-scoped `includeArchived` flag. Expose the action via two small route handlers (`POST /api/cards/:cardId/archive` and `.../unarchive`) guarded by `isCardOwner`. On the client, extend `CardSummary`, add API wrappers, and add a kebab menu + "Show archived" switch to `components/pick-em/cards-workspace.tsx`. Add a banner + disabled "Launch" affordance on the card editor when the card is archived. Seed the first repository test file covering the filter, the owner gate, and the template-archive path.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript (strict), Kysely + libSQL, Tailwind + shadcn/ui, `node:test` + `tsx --test`.

**Non-goals:**
- Hard delete of cards (separate concern; archive deliberately sidesteps it).
- Bulk archive UI.
- Auto-archive on event date passing.
- Changing live-game lifecycle in any way.

---

### Task 1: Add `archived_at` column to `cards`

**Files:**
- Create: `migrations/0025_cards_archived_at.ts`
- Regenerate: `lib/server/db/generated.ts` (via `pnpm db:codegen`)

**Step 1: Write migration**

Mirror the style of `migrations/0024_score_snapshots.ts` (Kysely schema builder, `up` + `down`, `ifNotExists`/`ifExists` guards).

```typescript
// migrations/0025_cards_archived_at.ts
import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('cards')
    .addColumn('archived_at', 'text')
    .execute()

  // Partial-ish index for the common "list active cards for this owner" query.
  // SQLite supports partial indexes; libSQL honors the WHERE clause.
  await db.schema
    .createIndex('idx_cards_active_owner_updated')
    .ifNotExists()
    .on('cards')
    .columns(['owner_id', 'updated_at'])
    .where('archived_at', 'is', null)
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_cards_active_owner_updated').ifExists().execute()
  await db.schema.alterTable('cards').dropColumn('archived_at').execute()
}
```

**Step 2: Regenerate Kysely types**

Run: `pnpm db:codegen`
Expected: `lib/server/db/generated.ts` now shows `archived_at: string | null` on the `Cards` interface.

**Step 3: Commit**

```
feat(db): add cards.archived_at column
```

---

### Task 2: Extend permissions + `CardSummary` with archive awareness

**Files:**
- Modify: `lib/server/db/permissions.ts`
- Modify: `lib/server/repositories/cards.ts`
- Modify: `lib/client/cards-api.ts`

**Step 1: Add `isActiveCard` helper**

In `lib/server/db/permissions.ts`, append:

```typescript
export function isActiveCard(eb: ExpressionBuilder<DB, 'cards'>) {
  return eb('archived_at', 'is', null);
}
```

**Step 2: Surface `archivedAt` on `CardRow`, `CardSummary`, `ResolvedCard`**

In `lib/server/repositories/cards.ts`:

- Add `archived_at: string | null;` to the `CardRow` interface (around line 34-51).
- Add `archivedAt: string | null;` to `CardSummary` (around line 106-115) and to `ResolvedCard` (line 117-135).
- Update `asCardRow` (line 137-156) to copy `archived_at: row.archived_at ?? null,`.
- Update `mapSummary` (line 320-331) to return `archivedAt: card.archived_at,`.
- Update `findResolvedReadableCardById` (line 534+) so its returned shape includes `archivedAt: card.archived_at` alongside the other card fields.

**Step 3: Mirror on client API**

In `lib/client/cards-api.ts`, add `archivedAt: string | null;` to both `CardSummary` and `ResolvedCard`. No runtime change here — this just keeps the types honest.

**Step 4: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: No errors. (You'll get errors in UI files that destructure `CardSummary`; those remain red until Task 6 fixes them. If so, verify only `lib/server/**` and `lib/client/**` are clean at this point.)

**Step 5: Commit**

```
refactor(cards): thread archivedAt through row/summary types
```

---

### Task 3: Archive filtering + archive/unarchive repository functions

**Files:**
- Modify: `lib/server/repositories/cards.ts`

**Step 1: Add `includeArchived` flag to `listReadableCards`**

Replace `listReadableCards` (current: lines 345-362) with:

```typescript
export async function listReadableCards(
  userId: string | null,
  options: { includeArchived?: boolean } = {},
): Promise<CardSummary[]> {
  const { includeArchived = false } = options;

  const rows = await db
    .selectFrom('cards')
    .selectAll()
    .where((eb) => canReadCard(eb, userId))
    .where((eb) => {
      if (!includeArchived) {
        return isActiveCard(eb);
      }
      // includeArchived widening is owner-scoped: show archived rows only
      // when the viewer is the owner. Other users' archived cards stay hidden.
      if (!userId) {
        return isActiveCard(eb);
      }
      return eb.or([isActiveCard(eb), eb('owner_id', '=', userId)]);
    })
    .orderBy('updated_at', 'desc')
    .execute();

  return rows.map((row) => {
    const card = asCardRow(row);
    return {
      ...mapSummary(card),
      ownerId: card.owner_id === userId ? card.owner_id : null,
    };
  });
}
```

Add the import: `import { canReadCard, isActiveCard, isCardOwner } from '@/lib/server/db/permissions';` (merge with the existing permissions import — don't duplicate).

**Step 2: Block cloning from archived templates**

In `createCardFromTemplate` (line 364-414), tighten the template lookup:

```typescript
const template = await db
  .selectFrom('cards')
  .selectAll()
  .where('id', '=', templateCardId)
  .where('is_template', '=', 1)
  .where('public', '=', 1)
  .where('archived_at', 'is', null)   // <-- new
  .executeTakeFirst();
```

No other logic change — the existing `if (!template) return null;` covers the archived case and the API layer already translates `null` into a 404.

**Step 3: Add `archiveCard` + `unarchiveCard`**

Append to `lib/server/repositories/cards.ts` (near the other owner-gated mutators):

```typescript
export async function archiveCard(
  cardId: string,
  ownerId: string,
): Promise<CardSummary | null> {
  const now = new Date().toISOString();
  const result = await db
    .updateTable('cards')
    .set({ archived_at: now, updated_at: now })
    .where('id', '=', cardId)
    .where((eb) => isCardOwner(eb, ownerId))
    .where('archived_at', 'is', null) // idempotent: only archive if currently active
    .executeTakeFirst();

  if (result.numUpdatedRows === 0n) {
    // Either not owner, not found, or already archived — disambiguate.
    const row = await db
      .selectFrom('cards')
      .selectAll()
      .where('id', '=', cardId)
      .where((eb) => isCardOwner(eb, ownerId))
      .executeTakeFirst();
    if (!row) return null;
    const card = asCardRow(row);
    return { ...mapSummary(card), ownerId };
  }

  const row = await db
    .selectFrom('cards')
    .selectAll()
    .where('id', '=', cardId)
    .executeTakeFirstOrThrow();
  const card = asCardRow(row);
  return { ...mapSummary(card), ownerId };
}

export async function unarchiveCard(
  cardId: string,
  ownerId: string,
): Promise<CardSummary | null> {
  const now = new Date().toISOString();
  const result = await db
    .updateTable('cards')
    .set({ archived_at: null, updated_at: now })
    .where('id', '=', cardId)
    .where((eb) => isCardOwner(eb, ownerId))
    .executeTakeFirst();

  if (result.numUpdatedRows === 0n) {
    return null; // not owner or not found
  }

  const row = await db
    .selectFrom('cards')
    .selectAll()
    .where('id', '=', cardId)
    .executeTakeFirstOrThrow();
  const card = asCardRow(row);
  return { ...mapSummary(card), ownerId };
}
```

Design notes (inline here, not in the code):
- Both functions enforce ownership via `isCardOwner` in the UPDATE `WHERE`. A non-owner gets a `null` return — **not** a cross-tenant info leak — because the UPDATE never touches their row and the follow-up SELECT also requires ownership (in `archiveCard`'s disambiguation branch) or doesn't happen (in `unarchiveCard`).
- `archiveCard` is idempotent on an already-archived row: it returns the current summary unchanged.
- Both bump `updated_at` so the row sorts correctly in "recently updated" lists once unarchived.

**Step 4: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: clean for `lib/server/**`.

**Step 5: Commit**

```
feat(cards): add archive/unarchive repository functions + listReadableCards filter
```

---

### Task 4: API endpoints for archive / unarchive + `includeArchived` query param

**Files:**
- Create: `app/api/cards/[cardId]/archive/route.ts`
- Create: `app/api/cards/[cardId]/unarchive/route.ts`
- Modify: `app/api/cards/route.ts`

**Step 1: Archive endpoint**

```typescript
// app/api/cards/[cardId]/archive/route.ts
import { NextResponse } from 'next/server';

import { enforceSameOrigin } from '@/lib/server/csrf';
import { getRequestUserId } from '@/lib/server/auth';
import { archiveCard } from '@/lib/server/repositories/cards';

export async function POST(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { cardId } = await context.params;
  const summary = await archiveCard(cardId, userId);
  if (!summary) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ data: summary });
}
```

**Step 2: Unarchive endpoint**

Same shape, calling `unarchiveCard`:

```typescript
// app/api/cards/[cardId]/unarchive/route.ts
import { NextResponse } from 'next/server';

import { enforceSameOrigin } from '@/lib/server/csrf';
import { getRequestUserId } from '@/lib/server/auth';
import { unarchiveCard } from '@/lib/server/repositories/cards';

export async function POST(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { cardId } = await context.params;
  const summary = await unarchiveCard(cardId, userId);
  if (!summary) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ data: summary });
}
```

**Step 3: Pass `includeArchived` through `GET /api/cards`**

Edit `app/api/cards/route.ts`:

```typescript
export async function GET(request: Request) {
  const userId = await getRequestUserId(request);

  const url = new URL(request.url);
  const includeArchived = url.searchParams.get('includeArchived') === 'true';

  const cards = await listReadableCards(userId, { includeArchived });

  return NextResponse.json({ data: cards });
}
```

(CSRF is not added to GET — consistent with the rest of the GET handlers. The repository layer already enforces the owner-scoped widening.)

**Step 4: Verify**

Manually exercise with `curl` against `pnpm dev` (ask the user to run the dev server). You can skip this if you've already written the repository tests and they cover the filter — verification happens via tests in Task 8.

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: clean across `app/**`.

**Step 5: Commit**

```
feat(api): POST /api/cards/:id/archive + unarchive + includeArchived query
```

---

### Task 5: Client API wrappers

**Files:**
- Modify: `lib/client/cards-api.ts`

**Step 1: Extend `listCards` with optional `includeArchived`**

Replace the current `listCards` (line 82-84) with:

```typescript
export function listCards(
  options: { includeArchived?: boolean } = {},
): Promise<CardSummary[]> {
  const qs = options.includeArchived ? '?includeArchived=true' : '';
  return requestJson<CardSummary[]>(`/api/cards${qs}`);
}
```

**Step 2: Add `archiveCard` / `unarchiveCard`**

Append to the same file:

```typescript
export function archiveCard(cardId: string): Promise<CardSummary> {
  return requestJson<CardSummary>(`/api/cards/${cardId}/archive`, {
    method: 'POST',
  });
}

export function unarchiveCard(cardId: string): Promise<CardSummary> {
  return requestJson<CardSummary>(`/api/cards/${cardId}/unarchive`, {
    method: 'POST',
  });
}
```

(`requestJson` already throws on non-2xx; the UI layer handles the rejection via its `try/catch` + toast convention.)

**Step 3: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: clean in `lib/client/**`.

**Step 4: Commit**

```
feat(cards-api): client wrappers for archive/unarchive + includeArchived
```

---

### Task 6: Card manager UI — kebab menu, "Show archived" toggle, archived badge

**Files:**
- Modify: `components/pick-em/cards-workspace.tsx`

**Step 1: Import the UI primitives**

At the existing imports block (around line 1-42), add:

```tsx
import { MoreHorizontal, Archive, ArchiveRestore } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
```

And extend the `listCards`/`archiveCard`/`unarchiveCard` imports from `@/lib/client/cards-api`:

```tsx
import {
  archiveCard,
  createCard,
  createCardFromTemplate,
  listCards,
  unarchiveCard,
  type CardSummary,
} from '@/lib/client/cards-api';
```

**Step 2: Add `showArchived` state + persist to `localStorage`**

Inside the `CardsWorkspace` component body, alongside the existing state, add:

```tsx
const SHOW_ARCHIVED_STORAGE_KEY = 'pick-em-cards-workspace-show-archived';

const [showArchived, setShowArchived] = useState(false);

// Hydrate from localStorage on mount (match the existing pattern used for
// LOCAL_DRAFT_STORAGE_KEY elsewhere in this file).
useEffect(() => {
  try {
    const stored = window.localStorage.getItem(SHOW_ARCHIVED_STORAGE_KEY);
    if (stored === 'true') setShowArchived(true);
  } catch {
    /* localStorage may be unavailable; silently ignore. */
  }
}, []);

useEffect(() => {
  try {
    window.localStorage.setItem(
      SHOW_ARCHIVED_STORAGE_KEY,
      showArchived ? 'true' : 'false',
    );
  } catch {
    /* noop */
  }
}, [showArchived]);
```

**Step 3: Re-fetch cards when `showArchived` flips**

The existing `listCards()` call (find it in the file — it's the one that populates the `cards` state) needs to become:

```tsx
const cards = await listCards({ includeArchived: showArchived });
```

And add `showArchived` to the effect's dependency array so toggling re-fetches. If the current fetch is inside a `useCallback`/`useEffect` pair, extend the dependency list accordingly. Do not memoize around this — the refetch is fast and avoiding stale card lists matters.

**Step 4: Derive `archivedOwnedCards` + adjust `recentOwnedCards`**

Where `ownedCards` / `recentOwnedCards` are memo-derived (around lines 115-180 — find the `useMemo` block), split into:

```tsx
const ownedActiveCards = useMemo(
  () => cards.filter((c) => !c.isTemplate && c.ownerId && !c.archivedAt),
  [cards],
);
const ownedArchivedCards = useMemo(
  () => cards.filter((c) => !c.isTemplate && c.ownerId && c.archivedAt),
  [cards],
);
const recentOwnedCards = useMemo(
  () => [...ownedActiveCards].sort(/* existing updatedAt desc sort */),
  [ownedActiveCards],
);
const recentArchivedCards = useMemo(
  () => [...ownedArchivedCards].sort(/* same sort */),
  [ownedArchivedCards],
);
```

(Keep the existing `ownedCards` identifier if other spots in the file reference it — make it `= ownedActiveCards` as an alias.)

**Step 5: Add the "Show archived" switch to the Continue Editing header**

Replace the `<CardHeader>` of the Continue Editing card (current lines 329-338) with:

```tsx
<CardHeader>
  <div className="flex items-start justify-between gap-3">
    <div>
      <CardTitle className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-primary" />
        Continue Editing
      </CardTitle>
      <CardDescription>
        {ownedActiveCards.length} saved card
        {ownedActiveCards.length === 1 ? '' : 's'}
      </CardDescription>
    </div>
    <div className="flex items-center gap-2">
      <Switch
        id="show-archived"
        checked={showArchived}
        onCheckedChange={setShowArchived}
      />
      <Label htmlFor="show-archived" className="text-xs">
        Show archived
      </Label>
    </div>
  </div>
</CardHeader>
```

**Step 6: Add the kebab menu to each active-card row**

In the `recentOwnedCards.map(...)` row (current lines 345-367), wrap the right-hand side with a flex container and add the menu:

```tsx
<div className="flex items-center gap-2">
  <Button asChild size="sm" variant="secondary">
    <Link href={`/cards/${card.id}`}>
      Edit
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  </Button>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button size="icon" variant="ghost" aria-label="Card actions">
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem
        onClick={() => {
          void handleArchive(card.id);
        }}
      >
        <Archive className="mr-2 h-4 w-4" />
        Archive
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</div>
```

**Step 7: Render the archived section when `showArchived` is on**

Directly below the Continue Editing `<Card>` (after its closing `</Card>` tag at line 370), add:

```tsx
{showArchived && recentArchivedCards.length > 0 ? (
  <Card className="border-border/70 bg-card/40 shadow-[0_20px_40px_rgba(0,0,0,0.25)] backdrop-blur">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Archive className="h-4 w-4 text-muted-foreground" />
        Archived
      </CardTitle>
      <CardDescription>
        {recentArchivedCards.length} archived card
        {recentArchivedCards.length === 1 ? '' : 's'}
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {recentArchivedCards.map((card) => (
        <div
          key={card.id}
          className="rounded-md border border-border/70 bg-background/30 px-3 py-2 opacity-80"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">
                {card.name}
                <Badge variant="outline" className="ml-2 text-[10px]">
                  Archived
                </Badge>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Archived {formatDate(card.archivedAt ?? card.updatedAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link href={`/cards/${card.id}`}>
                  View
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label="Card actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      void handleUnarchive(card.id);
                    }}
                  >
                    <ArchiveRestore className="mr-2 h-4 w-4" />
                    Unarchive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      ))}
    </CardContent>
  </Card>
) : null}
```

**Step 8: Add `handleArchive` / `handleUnarchive` callbacks**

Inside the component, near the other action handlers (e.g., `handleUseTemplate`), add:

```tsx
const handleArchive = useCallback(
  async (cardId: string) => {
    try {
      await archiveCard(cardId);
      // Optimistic local update: flip archivedAt on the matching row.
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId ? { ...c, archivedAt: new Date().toISOString() } : c,
        ),
      );
      toast.success('Card archived');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not archive card');
    }
  },
  [],
);

const handleUnarchive = useCallback(
  async (cardId: string) => {
    try {
      await unarchiveCard(cardId);
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, archivedAt: null } : c)),
      );
      toast.success('Card unarchived');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unarchive card');
    }
  },
  [],
);
```

(If the state setter isn't named `setCards`, use whichever setter the file currently uses for the list of cards.)

**Step 9: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: clean.

Ask the user to start `pnpm dev` and walk through: archive an owned card → it drops from Continue Editing → flip "Show archived" → the row reappears in the Archived section with the badge → Unarchive → it returns to Continue Editing. Confirm the switch state persists across reload.

**Step 10: Commit**

```
feat(cards-workspace): archive / unarchive UI + show-archived toggle
```

---

### Task 7: Archived-state affordances on the card editor page

**Files:**
- Modify: `components/pick-em/card-library.tsx` (secondary picker inside the editor)
- Modify: `app/cards/[cardId]/live/page.tsx` (launch-live entry point)

**Step 1: Block "Launch live game" on archived cards**

`app/cards/[cardId]/live/page.tsx` is the page that starts a new live game from a card. After it fetches the card:

```tsx
if (card.archivedAt) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-lg font-semibold">Card is archived</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Unarchive this card from the Cards workspace before starting a new live game.
      </p>
      <Button asChild variant="secondary" className="mt-4">
        <Link href="/cards">Back to cards</Link>
      </Button>
    </div>
  );
}
```

Place this before the rest of the page's live-launch UI renders. This is a host-only surface (owners only), so the extra permission check already lives upstream.

Do **not** touch `app/cards/[cardId]/live/solo/page.tsx` beyond the same check — solo mode is also "new live game" for the purposes of archive.

Apply the same gate to `app/cards/[cardId]/live/solo/page.tsx` — same block pattern.

**Step 2: Show archived banner on the editor**

In `components/pick-em/card-library.tsx` (or wherever the editor header banner lives — grep for the "loaded card" status row that shows auto-save), render a small archived indicator when the loaded card's `archivedAt` is non-null:

```tsx
{card.archivedAt ? (
  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
    This card is archived. Editing is allowed, but new live games can't be launched until you unarchive it.
  </div>
) : null}
```

(Wording can be adjusted — the important bit is an ambient signal that explains why "Launch live game" will be refused.)

**Step 3: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: clean.

Manual: start `pnpm dev`, archive a card, navigate to `/cards/<id>` — banner appears. Navigate to `/cards/<id>/live` — the "archived" guard renders instead of the live-launch UI.

**Step 4: Commit**

```
feat(cards): block launch + show banner for archived cards in editor
```

---

### Task 8: First repository tests for archive behavior

**Files:**
- Create: `tests/unit/lib/server/repositories/cards.archive.test.ts`

This is the first test file under `tests/unit/lib/server/repositories/` — it's fine that the directory doesn't exist yet; `tsx --test tests/unit/**/*.test.ts` (see `package.json:10`) globs recursively.

**Step 1: Understand how existing tests get a DB**

Before writing, read:

- `tests/integration/auth-override-resolution.test.ts` — pattern for `node:test` + `assert`.
- `scripts/migrate.ts` — how migrations run; these tests will want to run them against an in-memory libSQL URL.
- `lib/server/db/index.ts` (if it exists) — current DB singleton; the test likely needs to point it at a fresh in-memory DB.

If the repository tests cannot cleanly use the singleton `db` (because it reads a fixed env var), the simplest pragmatic path is:

1. Set `process.env.TURSO_DATABASE_URL = 'file::memory:?cache=shared'` before importing anything from `@/lib/server/**`.
2. Call the migrator programmatically (import from `scripts/migrate.ts` or replicate its body) to bring the schema up.
3. Seed two users' worth of rows via direct `db.insertInto('cards')` calls.

If the DB module resists that (reads env at module-load time in a way that makes `process.env` mutation a race), stop and escalate — do **not** introduce a new test-only DB abstraction to the production code just to make tests convenient.

**Step 2: Write the tests**

Cover at minimum:

```typescript
import assert from 'node:assert/strict';
import { describe, test, before, beforeEach } from 'node:test';

// ... test DB setup per Step 1 ...

describe('cards archive', () => {
  before(async () => {
    // migrate + seed: owner A, owner B, one active card owned by A, one archived card owned by A,
    // one public template (active), one public template (archived).
  });

  test('listReadableCards hides archived cards by default', async () => {
    const cards = await listReadableCards('owner-a');
    const ids = cards.map((c) => c.id);
    assert.ok(!ids.includes('archived-a'));
    assert.ok(ids.includes('active-a'));
  });

  test('listReadableCards returns archived when includeArchived=true and caller is owner', async () => {
    const cards = await listReadableCards('owner-a', { includeArchived: true });
    const ids = cards.map((c) => c.id);
    assert.ok(ids.includes('archived-a'));
  });

  test('includeArchived does not leak other users archived cards', async () => {
    // Seed: owner B has an archived public card.
    const cards = await listReadableCards('owner-a', { includeArchived: true });
    const ids = cards.map((c) => c.id);
    assert.ok(!ids.includes('archived-b-public'));
  });

  test('archiveCard sets archived_at and is idempotent', async () => {
    const first = await archiveCard('active-a', 'owner-a');
    assert.ok(first?.archivedAt);
    const second = await archiveCard('active-a', 'owner-a');
    assert.ok(second?.archivedAt);
    assert.equal(second!.archivedAt, first!.archivedAt, 'second archive is a no-op');
  });

  test('archiveCard refuses non-owners', async () => {
    const result = await archiveCard('active-a', 'owner-b');
    assert.equal(result, null);
  });

  test('unarchiveCard clears archived_at for the owner', async () => {
    await archiveCard('active-a', 'owner-a');
    const restored = await unarchiveCard('active-a', 'owner-a');
    assert.equal(restored?.archivedAt, null);
  });

  test('unarchiveCard refuses non-owners', async () => {
    await archiveCard('active-a', 'owner-a');
    const result = await unarchiveCard('active-a', 'owner-b');
    assert.equal(result, null);
  });

  test('createCardFromTemplate refuses archived templates', async () => {
    const cloned = await createCardFromTemplate('owner-a', 'template-archived');
    assert.equal(cloned, null);
  });

  test('createCardFromTemplate still works for active templates', async () => {
    const cloned = await createCardFromTemplate('owner-a', 'template-active');
    assert.ok(cloned);
  });

  test('archiving a template hides it from listReadableCards', async () => {
    await archiveCard('template-active', 'owner-a');
    const cards = await listReadableCards('owner-b'); // any viewer
    assert.ok(!cards.map((c) => c.id).includes('template-active'));
  });
});
```

**Step 3: Run the tests**

Run: `pnpm test:unit`
Expected: all new tests pass, no regression in existing ones.

**Step 4: Commit**

```
test(cards): cover archive filtering + owner gate + template archive
```

---

### Task 9: Documentation sync

**Files:**
- Modify: `.ai/context/cards.md`
- Modify: `.ai/context/data-model.md`
- Modify: `.ai/context/auth-and-ownership.md`
- Modify: `.ai/issues/16-archive-cards.md` (mark the resolved questions)

**Step 1: Update cards.md**

Under "Card APIs", replace the "No DELETE... No archive endpoint either." line with the new surface (`POST /api/cards/:cardId/archive`, `POST /api/cards/:cardId/unarchive`, `GET /api/cards?includeArchived=true`). Under "Cards list / Continue Editing", note the kebab menu + Show archived switch.

**Step 2: Update data-model.md**

Under "Cards", remove the "**No `archived` / `archived_at` column exists**" line; add `archived_at text` to the schema block.

**Step 3: Update auth-and-ownership.md**

The "For issue #16 (archive cards), we **don't** want a DELETE" note can now say "done — see migration 0025 + archive endpoints" or be removed entirely.

**Step 4: Update the issue file**

Append a short "Resolution" block to `.ai/issues/16-archive-cards.md` summarizing the resolved questions (templates archivable; archived hidden globally except via owner-scoped `includeArchived`; existing live games unaffected; no launching new games from archived cards).

**Step 5: Commit**

```
docs: update .ai/context + issue 16 for archive cards landing
```

---

## Verification checklist (run before opening PR)

- [ ] `pnpm db:migrate:latest` runs clean against a scratch libSQL file.
- [ ] `pnpm db:codegen` shows `archived_at: string | null` on `Cards` in `lib/server/db/generated.ts`.
- [ ] `npx tsc --noEmit` is clean.
- [ ] `pnpm lint` is clean.
- [ ] `pnpm test:unit` — new repository tests pass.
- [ ] `pnpm test:integration` — still green.
- [ ] Manual smoke (`pnpm dev`):
  - [ ] Archive an owned card → drops from Continue Editing.
  - [ ] Toggle "Show archived" on → row reappears with Archived badge.
  - [ ] Unarchive → returns to Continue Editing.
  - [ ] Archiving a public template removes it from the Start From Template gallery for *other* users.
  - [ ] `/cards/<archived-id>/live` refuses with a clear message.
  - [ ] Existing live games on an archived card still load and play.
  - [ ] "Show archived" switch state persists across reload.
- [ ] Owner check: attempt to archive another user's public card via `curl` → 404.

## Open questions (resolved — keep for reference)

- Global hiding vs owner-only: **global hiding** (other viewers never see archived cards), with owner-scoped `includeArchived` widening to surface their own archive.
- Templates archivable: **yes**, mainly for past-event templates.
- Launch new live games from archived: **no**, requires unarchiving first.
- Existing live games: **fully visible** across lobby / live / ended — archive is a card-list concern only.
- Archive vs soft delete: **archive only** for now; delete remains a separate future concern.

## Risks / things to watch

- **`includeArchived=true` owner widening** — the repository filter intentionally ORs `archived_at IS NULL` with `owner_id = userId`. Get this wrong and you either (a) leak others' archived public cards or (b) still hide the caller's own archived cards. Test 3 in Task 8 specifically defends the (a) case.
- **Public-template archive behavior** — archiving a public template silently removes it from the gallery for everyone. That's desired, but be ready for "where did it go?" reports if we ever have heavy template users.
- **Resolver reads the row directly** — `findResolvedReadableCardById` does not filter on `archived_at`, which is correct: someone on a deep-link to an archived card should still be able to view it. Do not accidentally add the filter here.
- **Tests need a DB** — if seeding the test DB bloats this plan, cut Task 8 down to a single happy-path test and file a follow-up; do **not** let test scaffolding block the feature.
