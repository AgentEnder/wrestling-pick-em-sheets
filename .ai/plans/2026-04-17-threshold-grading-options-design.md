# Threshold grading options — design

> Issue: [#19 — fix: threshold questions shouldn't show grading options](../issues/19-threshold-grading-options.md)
> Date: 2026-04-17
> Status: design approved, ready for implementation plan

## Problem

The bonus-question editor renders the "Grading" rule controls (`exact` / `closest` / `atOrAbove` / `atOrBelow`) whenever `valueType` is `time` or `numerical`, regardless of `answerType`. For threshold questions these options are meaningless — threshold scoring is a binary compare of the key's category against the player's pick (`lib/server/scoring.ts:96-120`), with no `closest` / `atOrAbove` semantics.

Two editor surfaces carry duplicated copies of the same block:

- `components/match-editor.tsx:1047` — match-level bonus questions
- `components/pick-em/editor-view.tsx:484` — event-level bonus questions

(The issue doc pointed at `event-settings.tsx`; the actual file is `editor-view.tsx`. Worth updating the issue doc as a drive-by.)

## Approach: client hides, server strips

- **Client**: hide the grading controls when `answerType === "threshold"`. Do *not* mutate `gradingRule` on the question object — leave the value in memory so that toggling Threshold → numerical/time restores the previously-chosen rule. The "remembered" behavior already falls out of the existing `q.gradingRule ?? "exact"` fallbacks on the valueType handlers.
- **Server**: strip `gradingRule` at write time whenever `answerType === "threshold"`. A single pure normalizer applied at every write path that takes `BonusQuestion[]`.
- **No backfill, no read-side strip.** Existing stale rows are inert — scoring ignores `gradingRule` for thresholds, and the client no longer renders UI that reveals the field. Any next edit to such a question cleans it up via the write-path normalizer.

## Section 1 — Client (UI fix)

Two near-identical edits, one per editor file.

### `components/match-editor.tsx:1047`

```tsx
// before
{(q.valueType === "time" || q.valueType === "numerical") && (

// after
{q.answerType !== "threshold" &&
  (q.valueType === "time" || q.valueType === "numerical") && (
```

### `components/pick-em/editor-view.tsx:484`

Same shape applied to the sibling block (currently `question.valueType === "time" || question.valueType === "numerical" ? (...) : null`).

### Deliberately unchanged

- The Threshold answer-type button handler at `match-editor.tsx:949-961`. It switches `valueType` off `string`/`rosterMember` but leaves `gradingRule` intact — which is what "client remembers" requires.
- The Time/Count valueType handlers at `match-editor.tsx:1018,1034` and their twins in `editor-view.tsx`. Their `gradingRule: q.gradingRule ?? "exact"` fallback is the mechanism that restores the stored rule when the user comes back from threshold.

### Consolidation

The two duplicated blocks are an obvious consolidation target, and a prior plan (`docs/plans/2026-03-02-consolidate-key-components.md`) already covers that kind of work. For a priority-high bug fix, duplicating a one-line conditional beats introducing a shared component. Out of scope here.

## Section 2 — Server (write-time strip)

### Invariant

When `answerType === "threshold"`, `gradingRule` must not be persisted.

### Normalizer

Single pure helper. Location: `lib/server/repositories/cards.ts` (or a dedicated `lib/server/bonus-question-normalize.ts` module — implementation's choice).

```ts
export function normalizeBonusQuestionForWrite(q: BonusQuestion): BonusQuestion {
  if (q.answerType === "threshold") {
    const { gradingRule: _drop, ...rest } = q;
    return rest;
  }
  return q;
}
```

Destructure-and-drop (rather than assigning `undefined`) keeps the persisted JSON blob clean — no `"gradingRule": null` showing up in storage.

### Call sites

Every server write path that accepts `BonusQuestion[]` maps through the normalizer:

1. **`persistOwnedCardSheet`** (`lib/server/repositories/cards.ts:803`) — two write spots:
   - `event_bonus_questions_json` (line 848) — `input.eventBonusQuestions.map(normalizeBonusQuestionForWrite)` before `JSON.stringify`.
   - The match-bonus insert loop further down in the same function — same transform on each match's `bonusQuestions`.
2. **`updateCardOverrides`** path (also in `persistOwnedCardSheet`, the template-override branch, lines 867 and 880) — same transform on `input.eventBonusQuestions` before `JSON.stringify`.
3. **`bonus-question-pools.ts`** — verify during implementation whether it persists `BonusQuestion`-shaped rows. If yes, apply the normalizer there too.

### Not changed

- **Read path** (`findResolvedReadableCardById`). Stale `gradingRule` on existing threshold rows stays inert — scoring ignores it and the client no longer shows the UI. The next user edit to such a question cleans it up automatically via the write-path normalizer.
- **Scoring engine** (`lib/server/scoring.ts`). Already ignores `gradingRule` for threshold questions.

### Why a helper rather than inline ifs

Single chokepoint is trivially testable as a pure function. Inline branches scatter the invariant across the repository file and make it easy for a future write path to miss.

## Section 3 — Tests and rollout

### Unit — normalizer

New file (e.g. `tests/unit/lib/server/bonus-question-normalize.test.ts`):

- Threshold question with `gradingRule: "exact"` → `gradingRule` is absent (not just `undefined`) on the returned object.
- Threshold question with no `gradingRule` → unchanged.
- Numerical + `gradingRule: "atOrAbove"` → passthrough, rule preserved.
- Multiple-choice + `gradingRule` somehow set → passthrough. We only strip for threshold; other answer types keep theirs.
- Immutability check: input object not mutated.

### Integration — write paths

Extend existing cards-repository tests (or add one):

- Save a card with a threshold match-bonus carrying `gradingRule` → read back via `findResolvedReadableCardById`, assert `gradingRule` is absent.
- Same for event bonuses, covered in both the owned-card branch and the template-override branch.
- Non-threshold question with `gradingRule` round-trips unchanged.

### Component — editor

New file `tests/unit/components/match-editor.test.tsx` (react-testing-library):

- `answerType: "threshold"` → Grading row is not rendered.
- `answerType` with numerical value type and `gradingRule: "closest"` → Grading row rendered, Closest highlighted.
- Toggle numerical → threshold → numerical — Grading row reappears with the prior rule still selected (the "client remembers" behavior).

Skip the equivalent for `editor-view.tsx` unless trivially cheap; the fix is mechanically identical.

### Manual smoke

- Open a card, create a threshold bonus — no grading buttons shown.
- Set a grading rule on a numerical question, toggle to threshold, toggle back — rule restored.
- Save and reload — non-threshold questions retain their rule; thresholds saved after this change have no `gradingRule` on reload.

### Rollout

- No migration, no feature flag.
- No backfill — forward-only fix; stale rows are inert.

## Explicitly out of scope

- Consolidating the two duplicated editor blocks into a shared component.
- Read-side normalization of `gradingRule`.
- Database migration / backfill to clear stale `gradingRule` values on existing threshold rows.
