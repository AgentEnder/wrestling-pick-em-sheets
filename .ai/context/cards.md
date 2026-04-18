# Cards domain

Cards are the durable artifact: an event's matches, bonus questions, tiebreaker. Live games run *on top of* a card.

## Surfaces

| Path | Purpose |
|---|---|
| `app/cards/page.tsx` | "Cards Workspace" hub — wraps `<CardsWorkspace />` |
| `app/cards/[cardId]/page.tsx` | Card editor (matches, bonus questions, settings) |
| `app/cards/[cardId]/live/page.tsx` | Host live entry from a card |
| `app/cards/[cardId]/live/solo/page.tsx` | Solo-mode live entry |
| `components/pick-em/cards-workspace.tsx` | Workspace listing — "Continue Editing", template gallery |
| `components/pick-em/card-library.tsx` | Inline card picker used inside the editor |
| `components/match-editor.tsx` | Big editor for matches + their bonus questions |
| `components/event-settings.tsx` | Event-level metadata + event bonuses |
| `components/print-sheet.tsx` | Print view of a card |

## Card list / "Continue Editing"

`components/pick-em/cards-workspace.tsx:115-436`:

- Memo-derives `ownedCards` (`!card.isTemplate` AND owner) → `recentOwnedCards` (sorted by `updatedAt desc`).
- Renders each as a row: name, "Updated <date>", "Edit" button → `/cards/<id>`.
- **No per-row action menu** — there's no delete, duplicate, or archive UI today.
- Workspace also shows total count + a separate template gallery.

`components/pick-em/card-library.tsx:31-146` is a secondary picker used inside the editor (loaded-card dropdown, "create from template" links, refresh/auto-save status). Also no destructive actions.

## Card APIs

| Method | Path | Notes |
|---|---|---|
| GET | `/api/cards` | `listReadableCards(userId)` — owned + public. **No filter params.** |
| POST | `/api/cards` | Create new owned card |
| GET | `/api/cards/:cardId` | Single card via `findResolvedReadableCardById` |
| PUT | `/api/cards/:cardId` | `persistOwnedCardSheet` (saves the sheet) |
| PUT | `/api/cards/:cardId/overrides` | Override fields when card is template-derived |
| GET/PUT | `/api/cards/:cardId/live-key` | Host's solo-mode live key |
| GET | `/api/cards/:cardId/live-games` | List live games for this card |
| POST | `/api/cards/from-template` | Clone template into a new owned card |

**No DELETE on `/api/cards/:cardId` exists.** No archive endpoint either.

Repository file: `lib/server/repositories/cards.ts`. Key functions:

- `listReadableCards(userId)` — line 345
- `findResolvedReadableCardById(cardId, userId)` — line 534
- `createOwnedCard(ownerId, input)` — line 416
- `persistOwnedCardSheet(cardId, ownerId, input)` — line 803
- `updateCardOverrides(...)` — line 461

Client wrappers: `lib/client/cards-api.ts:82-154` (`listCards`, `CardSummary`, etc.).

## Bonus question editor

`components/match-editor.tsx` holds the per-match bonus question editor. The same control set is reused for event-level bonuses (via `event-settings.tsx`).

Key spans (in `match-editor.tsx`):

- **Answer type** (`write-in` / `multiple-choice` / `threshold`): lines 911–971
- **Value type** (`string` / `rosterMember` / `time` / `numerical`): lines 973–1045 — note: `string` and `rosterMember` are hidden when `answerType === "threshold"`
- **Grading rule** (`exact` / `closest` / `atOrAbove` / `atOrBelow`): lines 1047–1080 — *currently shown whenever `valueType` is `time` or `numerical`, regardless of `answerType`*. This is the bug behind issue #19.
- **Threshold value + labels**: lines 1082–1147 — correctly gated on `q.answerType === "threshold"`.

## Print view

`components/print-sheet.tsx`. The bonus-question rendering inside `BonusQuestionsBlock` (lines 64–116) handles three answer types:

- `multiple-choice`: maps `q.options` to `<span class="print-mc-option"><checkbox/><label/></span>`
- `threshold`: maps `q.thresholdLabels ?? ["Over", "Under"]` to the same structure
- write-in (else): renders a `print-write-line-inline` (a long underline)

Layout (CSS in `app/globals.css:712+`):

- `.print-bonus-q-row` is a 2-column grid: main content (`1fr`) + points (`56px`).
- `.print-bonus-main` is `display: flex; align-items: baseline; flex-wrap: wrap;`
- `.print-mc-options` is `display: inline-flex; flex-wrap: wrap; gap: ... 8px;`
- `.print-mc-option` is `display: inline-flex; align-items: center; gap: ...;`
- `.print-checkbox` is a square border (`var(--print-checkbox-size) + var(--print-dyn-checkbox-bump)`).

Because checkboxes flow inline with the question text and wrap with it, multi-question stacks don't visually align their checkboxes — see issue #14.

## Tests

- `tests/unit/components/print-sheet.test.ts` — covers threshold/MC rendering presence (does not verify alignment).
- No existing tests for card CRUD or for the editor's grading-rule conditional.
