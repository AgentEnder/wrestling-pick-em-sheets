# #21 — feat: FAB / bottom button to save + submit picks for live game

> **Labels**: priority: high
> **Author**: AgentEnder
> **Created**: 2026-04-17

## Issue body

> (Empty — title carries the intent.)
>
> Today the only Save+Submit control on the player view is at the top. The user wants a floating action button (or persistent bottom button) so a player on a long card doesn't need to scroll back up to submit.

## Where it lives

`components/pick-em/live-game-player-app.tsx`:

- `handleSave()` — lines 552–588. Calls `saveMyLiveGamePicks()` then auto-submits via `submitMyLiveGamePicks()` if not already submitted.
- Render tree starts at ~line 680 with `<PlayerHeader>` (which contains the existing top Save button).
- An existing **refresh FAB** is already wired up at `bottom-4 right-4` (lines 740–748), shown only when `isRefreshStale`. This is a useful precedent for positioning + z-index of the new save FAB.

State source: `stores/live-game-slice.ts` — `saveMyLiveGamePicks`, `submitMyLiveGamePicks`, plus an `isSaving` flag for disabled state. Toasts go through `sonner`.

## Behavior questions for planning

- **One button or two?** The "Save" path auto-submits when not yet submitted. A single "Save & Submit" FAB probably matches that, but we may want a distinct visual when the player is already submitted (different label, e.g. "Update").
- **When to show the FAB?**
  - Always on `/games/:gameId/play` (lobby + live + ended)?
  - Or only while `status === "live"` and the player has unsaved picks?
- **Conflict with the existing refresh FAB.** Both currently want `bottom-4 right-4`. Either stack them (`flex-col-reverse gap-2` container) or place the save FAB on the left.
- **Mobile keyboard behavior.** A FAB anchored to `bottom` of the viewport can be obscured by the iOS keyboard when typing into write-in inputs. Consider safe-area insets / `position: sticky` on the form footer as alternatives.
- **Accessibility.** FAB needs an accessible label, and shouldn't trap focus. Should be reachable in the keyboard tab order (or duplicated as a bottom-of-page button).

## Suggested implementation surface

- Likely just a new component placed alongside the existing refresh FAB in `live-game-player-app.tsx`.
- Reuse `handleSave()` directly — no new store action required.
- Mind the existing `<PlayerHeader>` button; this is *additive*, not a replacement.

## Cross-cutting

- See `.ai/context/live-games.md` (Player save / submit flow section) for related store actions.
- The refresh FAB pattern (`live-game-player-app.tsx:740-748`) is the model to copy.
