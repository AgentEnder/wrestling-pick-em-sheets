# Threshold grading options — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop showing (and stop persisting) `gradingRule` grading controls for bonus questions whose `answerType === "threshold"`. Fix the two editor surfaces that render the stale UI, and add a server-side normalizer so the field never lands in storage for threshold questions.

**Architecture:** Client hides the UI block when `answerType === "threshold"` but does not mutate the question object, so toggling threshold → numerical restores the prior rule from memory. Server runs every `BonusQuestion[]` write path through a single pure normalizer that drops `gradingRule` for threshold questions. No read-side strip, no migration — existing stale rows are inert and get cleaned up the next time the owner saves.

**Tech Stack:** TypeScript, Next.js App Router, Kysely + libSQL, `node:test` + `tsx` test runner, React Server Components + client components.

**Design reference:** [`.ai/plans/2026-04-17-threshold-grading-options-design.md`](./2026-04-17-threshold-grading-options-design.md)
**Issue:** [`.ai/issues/19-threshold-grading-options.md`](../issues/19-threshold-grading-options.md)

---

## Task 1: Add the write-path normalizer (with tests)

**Files:**
- Create: `lib/server/bonus-question-normalize.ts`
- Create: `tests/unit/lib/server/bonus-question-normalize.test.ts`

**Why separate file:** single chokepoint is easier to test as a pure function and easier to reuse if another write path appears later. Keeping it out of `repositories/cards.ts` avoids the circular-import risk when we want to import it from multiple repositories.

### Step 1.1: Write the failing unit test

Create `tests/unit/lib/server/bonus-question-normalize.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { normalizeBonusQuestionForWrite } from "@/lib/server/bonus-question-normalize";
import type { BonusQuestion } from "@/lib/types";

function make(overrides: Partial<BonusQuestion> = {}): BonusQuestion {
  return {
    id: "q1",
    question: "Test",
    points: null,
    answerType: "write-in",
    options: [],
    valueType: "string",
    gradingRule: "exact",
    ...overrides,
  };
}

describe("normalizeBonusQuestionForWrite", () => {
  test("drops gradingRule for threshold questions", () => {
    const input = make({
      answerType: "threshold",
      valueType: "numerical",
      gradingRule: "atOrAbove",
      thresholdValue: 10,
      thresholdLabels: ["Over", "Under"],
    });
    const result = normalizeBonusQuestionForWrite(input);
    assert.equal("gradingRule" in result, false);
    assert.equal(result.thresholdValue, 10);
    assert.deepEqual(result.thresholdLabels, ["Over", "Under"]);
  });

  test("no-op for threshold question without gradingRule", () => {
    const input = make({
      answerType: "threshold",
      valueType: "numerical",
      gradingRule: undefined,
    });
    const result = normalizeBonusQuestionForWrite(input);
    assert.equal("gradingRule" in result, false);
  });

  test("preserves gradingRule for numerical non-threshold questions", () => {
    const input = make({
      answerType: "write-in",
      valueType: "numerical",
      gradingRule: "closest",
    });
    const result = normalizeBonusQuestionForWrite(input);
    assert.equal(result.gradingRule, "closest");
  });

  test("preserves gradingRule for multiple-choice questions", () => {
    const input = make({
      answerType: "multiple-choice",
      valueType: "string",
      gradingRule: "exact",
      options: ["a", "b"],
    });
    const result = normalizeBonusQuestionForWrite(input);
    assert.equal(result.gradingRule, "exact");
  });

  test("does not mutate the input object", () => {
    const input = make({
      answerType: "threshold",
      valueType: "numerical",
      gradingRule: "exact",
    });
    normalizeBonusQuestionForWrite(input);
    assert.equal(input.gradingRule, "exact");
  });
});
```

### Step 1.2: Run the test to verify it fails

Run: `pnpm test:unit -- --test-name-pattern="normalizeBonusQuestionForWrite"`

Expected: all five tests fail — module `@/lib/server/bonus-question-normalize` does not exist.

(If the `-- --test-name-pattern` arg isn't wired through, fall back to running the full unit suite: `pnpm test:unit`. The five new failures should be clearly scoped to the new file.)

### Step 1.3: Implement the normalizer

Create `lib/server/bonus-question-normalize.ts`:

```ts
import type { BonusQuestion } from "@/lib/types";

export function normalizeBonusQuestionForWrite(
  q: BonusQuestion,
): BonusQuestion {
  if (q.answerType === "threshold") {
    const { gradingRule: _drop, ...rest } = q;
    return rest;
  }
  return q;
}
```

Destructure-and-drop (rather than `{ ...q, gradingRule: undefined }`) keeps the persisted JSON blob clean — no `"gradingRule": null` showing up in storage.

### Step 1.4: Run the test to verify it passes

Run: `pnpm test:unit`

Expected: all five new tests pass; existing suites unchanged.

### Step 1.5: Commit

```bash
git add lib/server/bonus-question-normalize.ts tests/unit/lib/server/bonus-question-normalize.test.ts
git commit -m "feat(server): add normalizeBonusQuestionForWrite to strip gradingRule from threshold questions"
```

---

## Task 2: Apply the normalizer in `persistOwnedCardSheet`

**Files:**
- Modify: `lib/server/repositories/cards.ts:803-976`

There are three effective write spots inside the function:

- Line 848 — `event_bonus_questions_json: card.template_card_id ? "[]" : JSON.stringify(input.eventBonusQuestions)` (owned-card branch writes to `cards.event_bonus_questions_json`).
- Lines 867 and 880 — template-derived branch writes to `card_overrides.event_bonus_questions_json` (insert and onConflict update).
- Lines 938-940 and 967-969 — both branches write match bonus questions through `toCardMatchInsert`, which calls `JSON.stringify(match.bonusQuestions)` inside.

Simplest fix: normalize the input once at the top of the function and use the normalized arrays everywhere below. `toCardMatchInsert` needs no changes.

### Step 2.1: Add the normalization at the top of the function

Modify `lib/server/repositories/cards.ts`. Just after the `if (!card) return null;` check (around line 825), before `const now = ...`:

```ts
import { normalizeBonusQuestionForWrite } from "@/lib/server/bonus-question-normalize";
```

Add the import near the other `@/lib/...` imports at the top of the file (group with existing server-local imports).

Then inside `persistOwnedCardSheet`, right after `if (!card) return null;`:

```ts
const normalizedEventBonuses = input.eventBonusQuestions.map(
  normalizeBonusQuestionForWrite,
);
const normalizedMatches = input.matches.map((match) => ({
  ...match,
  bonusQuestions: match.bonusQuestions.map(normalizeBonusQuestionForWrite),
}));
```

### Step 2.2: Replace every downstream use with the normalized versions

In the same function:

- Line 848 (owned-card branch, `cards` update): replace `JSON.stringify(input.eventBonusQuestions)` with `JSON.stringify(normalizedEventBonuses)`.
- Line 867 (template-override insert): replace `JSON.stringify(input.eventBonusQuestions)` with `JSON.stringify(normalizedEventBonuses)`.
- Line 881 (template-override onConflict update): replace `JSON.stringify(input.eventBonusQuestions)` with `JSON.stringify(normalizedEventBonuses)`.
- Line 938 (template-override match insert mapping): replace `input.matches.map((match, index) => toCardMatchInsert(cardId, match, index + 1, 1, now))` with `normalizedMatches.map((match, index) => toCardMatchInsert(cardId, match, index + 1, 1, now))`.
- Line 967 (owned-card match insert mapping): replace `input.matches.map((match, index) => toCardMatchInsert(cardId, match, index + 1, 0, now))` with `normalizedMatches.map((match, index) => toCardMatchInsert(cardId, match, index + 1, 0, now))`.

Do not touch `toCardMatchInsert` itself — the normalization has already happened upstream.

### Step 2.3: Typecheck

Run: `pnpm exec tsc --noEmit`

Expected: zero errors. If there's an error about `match.bonusQuestions` not being spreadable, the spread at Step 2.1 is the likely culprit — verify the `Match` type (`lib/types.ts:158-165`) matches the spread shape.

### Step 2.4: Re-run the unit tests

Run: `pnpm test:unit`

Expected: all pass, including the five from Task 1.

### Step 2.5: Commit

```bash
git add lib/server/repositories/cards.ts
git commit -m "fix(cards): strip gradingRule from threshold bonus questions on write"
```

---

## Task 3: Hide the grading-rule UI in `match-editor.tsx`

**Files:**
- Modify: `components/match-editor.tsx:1047-1080`

Per-match bonus question editor. The grading-rule block is currently rendered whenever `valueType` is `time` or `numerical`, regardless of `answerType`. It must also require `answerType !== "threshold"`.

### Step 3.1: Update the conditional

Modify `components/match-editor.tsx`. Change the opening of the grading-rule block at line 1047:

```tsx
// before
{(q.valueType === "time" ||
  q.valueType === "numerical") && (

// after
{q.answerType !== "threshold" &&
  (q.valueType === "time" || q.valueType === "numerical") && (
```

Leave everything else — the Threshold button handler at `match-editor.tsx:949-961`, the Time/Count valueType handlers at `match-editor.tsx:1018,1034` with their `q.gradingRule ?? "exact"` fallback — untouched. That fallback is what preserves the prior rule when the user toggles Threshold → Numerical.

### Step 3.2: Manual smoke (pre-commit)

Run: `pnpm dev` (ask the human partner to run this; don't start long-lived processes yourself).

In the browser, on a card editor page:
- Add a bonus question, set answer type to Threshold → Grading row should not render.
- Change answer type to Write-in (or Multiple Choice) with value type Count → Grading row renders with default "Exact".
- Click "At/Above", then switch answer type to Threshold → Grading row disappears.
- Switch back to Write-in → Grading row reappears with "At/Above" still highlighted.
- Save the card and reload; same behavior should persist.

### Step 3.3: Typecheck + lint

Run: `pnpm exec tsc --noEmit && pnpm lint`

Expected: zero errors.

### Step 3.4: Commit

```bash
git add components/match-editor.tsx
git commit -m "fix(match-editor): hide grading-rule controls for threshold questions"
```

---

## Task 4: Hide the grading-rule UI in `editor-view.tsx`

**Files:**
- Modify: `components/pick-em/editor-view.tsx:484-515`

Event-level bonus question editor. Same bug, same shape of fix. (The issue doc pointed at `components/event-settings.tsx`, but the file that actually owns this block is `components/pick-em/editor-view.tsx`. Drive-by: update the issue doc's "Where it lives" section at `.ai/issues/19-threshold-grading-options.md:15` to cite `components/pick-em/editor-view.tsx` alongside `components/match-editor.tsx` so the next reader isn't misled.)

### Step 4.1: Update the conditional

Modify `components/pick-em/editor-view.tsx`. Change the opening of the grading-rule block at line 484:

```tsx
// before
{question.valueType === "time" ||
question.valueType === "numerical" ? (

// after
{question.answerType !== "threshold" &&
(question.valueType === "time" || question.valueType === "numerical") ? (
```

Leave the surrounding handlers alone for the same reason as Task 3 — the `question.gradingRule ?? "exact"` fallback at lines 455 and 471 is what makes "client remembers" work.

### Step 4.2: Update the issue doc (drive-by)

Modify `.ai/issues/19-threshold-grading-options.md`. In the "Where it lives" section (line 15), replace:

```md
`components/match-editor.tsx`. Same control set is reused via `event-settings.tsx` for event-level bonus questions — both surfaces inherit the bug.
```

with:

```md
`components/match-editor.tsx` (match-level bonuses) and `components/pick-em/editor-view.tsx` (event-level bonuses). Both surfaces carry a duplicated copy of the grading-rule block.
```

### Step 4.3: Manual smoke

Repeat the Task 3 smoke on the event-level bonus questions surface (the Event Settings tab/section of the card editor).

### Step 4.4: Typecheck + lint

Run: `pnpm exec tsc --noEmit && pnpm lint`

Expected: zero errors.

### Step 4.5: Commit

```bash
git add components/pick-em/editor-view.tsx .ai/issues/19-threshold-grading-options.md
git commit -m "fix(editor-view): hide grading-rule controls for threshold event bonuses"
```

---

## Task 5: Full verification sweep

### Step 5.1: Full test run

Run: `pnpm test`

Expected: all unit and integration suites pass.

### Step 5.2: Lint + typecheck

Run: `pnpm exec tsc --noEmit && pnpm lint`

Expected: zero errors, zero warnings.

### Step 5.3: End-to-end manual verification

On a dev server:

1. Create a new card.
2. Add a match → add a bonus question. Set answerType to numerical Count with `gradingRule: "atOrAbove"`. Save.
3. Switch that question to Threshold. Save.
4. Reload the card — confirm the question is still Threshold, no grading UI visible.
5. Inspect the persisted JSON (DB or network response) for this question — confirm `gradingRule` is absent.
6. Switch the question back to Write-in/Count — Grading row reappears, default "Exact" (because the previous save cleared `gradingRule` at write time — this is expected and consistent with option A of the design: the field is only "remembered" in memory for the current editing session).
7. Repeat steps 2–6 on an event-level bonus question via the Event Settings panel.

### Step 5.4: No additional commit unless issues surface

If any test, lint, typecheck, or manual step fails, stop and debug. Do not skip or paper over failures.

---

## Explicitly out of scope

- Consolidating the two duplicated editor blocks (`match-editor.tsx:1047-1080` and `editor-view.tsx:484-515`) into a shared component. Prior plan exists for that work.
- Read-side normalization / strip of `gradingRule` on load.
- Database migration or backfill to clear stale `gradingRule` values on existing threshold rows. Per the design, they're inert: scoring ignores them and the editor no longer renders them.
- Component tests for the editor conditional. The project's unit harness uses `renderToStaticMarkup` without jsdom; the invariant is a one-line JSX conditional whose correctness is self-evident from the diff, and the write-path unit test + integration smoke cover the behavior that actually matters.

---

## Summary of changes

| File | Change |
|---|---|
| `lib/server/bonus-question-normalize.ts` | **new** — pure normalizer |
| `tests/unit/lib/server/bonus-question-normalize.test.ts` | **new** — 5 unit tests |
| `lib/server/repositories/cards.ts` | Apply normalizer to all write paths inside `persistOwnedCardSheet` |
| `components/match-editor.tsx` | Add `answerType !== "threshold"` guard to grading-rule block |
| `components/pick-em/editor-view.tsx` | Same guard on the event-level grading-rule block |
| `.ai/issues/19-threshold-grading-options.md` | Drive-by: correct "Where it lives" file reference |
