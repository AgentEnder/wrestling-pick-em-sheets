# 2026-04-17 — Bottom Save & Submit Button (Issue #21) — Design

> Issue: [#21 — FAB / bottom button to save + submit picks for live game](../issues/21-fab-save-submit.md)
> Status: design approved 2026-04-17

## Problem

On the player live-game view (`/games/:gameId/play`), the only save/submit control lives at the top of the page inside `<PlayerHeader>`. On a long card, a player finishing their last pick has to scroll back up to submit. The fix: a second save control beneath the picks so the top of the page is reachable only when desired, not required.

The final labels on the new button are `Save Picks` (before first submit) and `Update Picks` (after submit). These match the top `<PlayerHeader>` button's `Save Picks` verb — adding `& Submit` on the new button was considered and rejected to keep the two buttons' verbs consistent. The post-submit `Update Picks` flip is kept because it gives honest feedback that the submission has already landed.

## Decision summary

| Question | Decision |
|---|---|
| Shape | Plain in-flow `<Button>` (not a fixed FAB, not a sticky footer) |
| Placement | Between `<PlayerTiebreakerInput>` and the Leaderboard/Updates section in `live-game-player-app.tsx` |
| Label | `Save Picks` before first submit; `Update Picks` after; `Saving...` while in-flight |
| Status gate | Implicit — lives inside the `status !== "ended"` render branch |
| Handler | Reuses existing `handleSave()` — no new store actions, no new API |
| `<PlayerHeader>` top button | Unchanged |
| Dirty-tracking (disable when no changes) | Out of scope |

## Why in-flow over FAB or sticky footer

The issue framed the control as "FAB / bottom button" and flagged three concerns with a fixed/sticky approach:

- iOS virtual keyboard covers a `position: fixed` button when a write-in input is focused.
- The existing refresh FAB at `live-game-player-app.tsx:740-755` already owns `bottom-4 right-4`, so a new FAB would need stacking logic.
- A sticky footer permanently consumes vertical space and needs `env(safe-area-inset-bottom)` tuning.

An in-flow button sidesteps all three. It also nudges the player to scroll through their picks before submitting, rather than firing a submit from anywhere on the page. The refresh FAB remains the right pattern for *its* use case (rare, stateful, indicator-like), so the asymmetry is intentional — the two controls serve different roles.

## Implementation surface

Single-file change: `components/pick-em/live-game-player-app.tsx`.

Insert the button between the tiebreaker input and the leaderboard section (currently between line 801 and line 803):

```tsx
<PlayerTiebreakerInput ... />

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

<section className="grid gap-4 lg:grid-cols-2"> ... </section>
```

`Button` is already imported from `components/ui/button`. `isSaving` and `me.player.isSubmitted` are already in scope.

## Explicitly out of scope

- No changes to `<PlayerHeader>` — top button stays exactly as-is.
- No dirty-tracking / "no changes to save" state. Would require net-new infrastructure for marginal UX gain.
- No changes to `handleSave`, `saveMyLiveGamePicks`, `submitMyLiveGamePicks`, or any API route.
- No new component file. The button is four lines of meaningful JSX; a wrapper would be premature abstraction.

## Verification

- **Manual**: open `/games/:gameId/play` on a live game, scroll to bottom, click button, confirm toast and label flip (`Save Picks` → `Update Picks`).
- **Ended-game check**: confirm the button does *not* render when `game.status === "ended"` (it shouldn't — the render branches into `<PlayerEndedView>` before reaching the button).
- **Lint/build**: `pnpm lint`, `pnpm build`.
- **E2E**: if a Playwright player-flow test exists in `tests/`, extend it to exercise the new bottom button; otherwise skip — the handler is already covered wherever the top button is tested.

## References

- Issue: `.ai/issues/21-fab-save-submit.md`
- Live-games domain: `.ai/context/live-games.md`
- Architecture: `.ai/context/architecture.md`
- Key code: `components/pick-em/live-game-player-app.tsx` (`handleSave` at 552, render tree 680–828, refresh FAB 740–755)
