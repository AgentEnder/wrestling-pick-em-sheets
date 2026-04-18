# Bottom Save & Submit Button (Issue #21) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a second Save & Submit control beneath the player's picks on the live-game player view so a player on a long card doesn't need to scroll back to the top of the page to submit.

**Architecture:** Single in-flow `<Button>` inserted between `<PlayerTiebreakerInput>` and the Leaderboard/Updates section inside `components/pick-em/live-game-player-app.tsx`. Reuses the existing `handleSave()` handler and `isSaving` disabled-state flag — no new component files, no new store actions, no API changes. Label flips from `Save Picks` to `Update Picks` based on `me.player.isSubmitted`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.7, shadcn-style Button from `components/ui/button`, Tailwind v4.

**Design doc:** `.ai/plans/2026-04-17-fab-save-submit-design.md` — read this first. It covers *why* the choices were made (in-flow over FAB, label swap, scope exclusions).

**Domain context:** `.ai/context/live-games.md` — covers the live-game player surface, state slice, and the existing save/submit flow.

**Scope honesty:** This is a four-line JSX change. One task, not a multi-batch refactor. The plan still specifies exact file paths, before/after snippets, and verification steps so an engineer with zero repo context can execute without re-deriving the design.

---

## Task 1: Add the bottom Save & Submit button

**Files:**
- Modify: `components/pick-em/live-game-player-app.tsx` (around line 801–803)

**Pre-flight context (read before editing):**

- `Button` is already imported at the top of the file: `import { Button } from "@/components/ui/button";` — do not add a new import.
- `handleSave()` is defined around line 552 and already handles both the initial save+submit and subsequent update-only saves. It also manages its own toasts, error handling, and `isSaving` flag. Do not modify it.
- `isSaving` (boolean) and `me.player.isSubmitted` (boolean) are already in scope at the render site.
- The render tree branches on `state.game.status === "ended"` around line 757. The insertion point is inside the `else` fragment (the "not-ended" branch), so the button will naturally not render on ended games.

**Step 1: Open the file and locate the insertion point**

Open `components/pick-em/live-game-player-app.tsx`. Scroll to the `<PlayerTiebreakerInput>` usage (currently ending around line 801). Immediately after its closing `/>`, before the `<section className="grid gap-4 lg:grid-cols-2">` that contains the Leaderboard and Updates panels, is where the new button goes.

Current code (around lines 796–803) looks like:

```tsx
          <PlayerTiebreakerInput
            tiebreakerLabel={state.card.tiebreakerLabel}
            picks={picks}
            locks={lockSnapshot}
            onSetTiebreakerAnswer={setTiebreakerAnswer}
          />

          <section className="grid gap-4 lg:grid-cols-2">
```

**Step 2: Insert the button**

Change the above to:

```tsx
          <PlayerTiebreakerInput
            tiebreakerLabel={state.card.tiebreakerLabel}
            picks={picks}
            locks={lockSnapshot}
            onSetTiebreakerAnswer={setTiebreakerAnswer}
          />

          <div className="flex justify-end">
            <Button
              type="button"
              size="lg"
              onClick={() => void handleSave()}
              disabled={isSaving}
            >
              {isSaving
                ? "Saving..."
                : me.player.isSubmitted
                  ? "Update Picks"
                  : "Save Picks"}
            </Button>
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
```

Nothing else in the file changes. Do not touch `<PlayerHeader>`, `handleSave`, imports, or any other render branch.

**Step 3: Type-check**

Run: `pnpm lint`
Expected: zero errors, zero warnings. (If ESLint complains about `void` on a promise-returning handler, it is correct — that's the same pattern already used at line 733 `onSave={() => void handleSave()}`.)

Run: `pnpm exec tsc --noEmit` (or `pnpm build` if tsc isn't a script)
Expected: no TypeScript errors.

**Step 4: Manual verification**

Ask the user to run `pnpm dev` (do not start it yourself — see CLAUDE.md) and perform:

1. Join or create a live game, navigate to `/games/:gameId/play` while `status === "live"`.
2. Scroll to the bottom of the picks. The new `Save Picks` button is visible, right-aligned, above the Leaderboard/Updates section.
3. Click it. Expect a `Picks saved` toast and that the label flips to `Update Picks` on the next render.
4. Click again. Expect another `Picks saved` toast; label stays `Update Picks`.
5. While a save is in flight the label should briefly read `Saving...` and the button should be disabled.
6. Navigate to a game in `status === "ended"`. Confirm the new button is **not** rendered (the whole tree branches into `<PlayerEndedView>` instead).
7. Navigate to a game in `status === "lobby"`. Confirm the new button **is** rendered and clicking it behaves the same as on the top button.

If the user cannot easily get a game into each status, steps 1–5 alone are sufficient for sign-off; steps 6–7 are verified by code inspection (the existing branch structure handles them).

**Step 5: Commit**

Use `/commit-slices` per CLAUDE.md. Suggested commit message:

```
feat(live-game): add bottom Save & Submit button on player view

Closes #21.

Mirrors the top PlayerHeader Save button so players on long cards
don't have to scroll back up to submit. Reuses handleSave(); no new
store actions or API changes. Label flips between "Save & Submit"
and "Update Picks" based on me.player.isSubmitted.

See .ai/plans/2026-04-17-fab-save-submit-design.md for rationale.
```

---

## No additional tasks

There are no additional tasks. Deliberately not included:

- **No new component file.** Four lines of JSX does not warrant a wrapper component. If a future feature needs to reuse this (unlikely — it's pinned to the player app's specific picks/leaderboard layout), extract then.
- **No dirty-tracking.** The design explicitly rejects this as out of scope.
- **No `<PlayerHeader>` changes.** The top button stays.
- **No unit/component tests.** The button is a pure delegation to `handleSave`, which is already exercised wherever the top button is. No existing component tests exist for `live-game-player-app.tsx` (`tests/unit/components/` contains only `button.test.ts` and `print-sheet.test.ts`), so introducing one here is out of scope. Manual verification is the right bar.
- **No Playwright e2e.** `tests/e2e/` currently contains only `auth-override-safety.spec.js` — there is no live-game player harness to extend. Adding one is its own initiative, not part of this issue.

## Verification summary

- `pnpm lint` → clean
- `pnpm build` → clean
- Manual: button renders, click saves + submits, label swaps on submitted state, not rendered on ended games.

## References

- Design doc: `.ai/plans/2026-04-17-fab-save-submit-design.md`
- Issue: `.ai/issues/21-fab-save-submit.md`
- Live-games domain: `.ai/context/live-games.md`
- Architecture: `.ai/context/architecture.md`
- Key code: `components/pick-em/live-game-player-app.tsx` — `handleSave` at 552, render tree 680–828, insertion point between 801 and 803
