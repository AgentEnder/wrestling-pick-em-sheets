# End-game + submitted-during-live score breakdown — design

> Issue: [.ai/issues/22-end-game-score-breakdown.md](../issues/22-end-game-score-breakdown.md)
> Date: 2026-04-17
> Status: design approved; ready for implementation plan

## Goal

Let a player validate their own score (and compare against other players they toggle in) by showing a per-question score-contribution table/card-list on two surfaces:

1. `PlayerEndedView` (`/play` when `game.status === "ended"`)
2. A **new** `PlayerSubmittedView`, rendered on `/play` while the game is live and the player has submitted

The TV `display` surface is untouched.

Scope deliberately includes an "Edit answers" affordance on the submitted view that flips local state back to the existing pick UI — no un-submit, no new endpoint.

## Scoring & data flow (server)

### Where breakdowns are produced

`computeLeaderboard` (`lib/server/repositories/live-games.ts:1343-1579`) already walks every submitted player's picks, runs `scoreForQuestion` (`lib/server/scoring.ts:75-170`) per question, and resolves closest-rule winners across players via `closestBuckets` (1535-1549). Today the per-question contributions are aggregated into three totals (`winnerPoints`, `bonusPoints`, `surprisePoints`) and discarded.

We extend the per-player `ScoreAccumulator` to collect `perQuestion: BreakdownRow[]` alongside the existing totals and attach it to each `LiveGameLeaderboardEntry`.

### Row shape (server → client)

```ts
type BreakdownRow =
  | { kind: "match-winner";   matchId: string; score: number; maxPoints: number }
  | { kind: "match-bonus";    matchId: string; questionId: string; score: number; maxPoints: number }
  | { kind: "event-bonus";    questionId: string; score: number; maxPoints: number }
  | { kind: "match-surprise"; matchId: string; entrantName: string; score: number; maxPoints: number };
```

No label strings — the client already has `state.card` and composes labels locally. Keeps payload lean and avoids server/client drift.

### Visibility rules

A row is emitted **only** when the host has keyed the relevant answer:

- `match-winner`: `keyPayload.matchResults[matchId]` is present.
- `match-bonus` / `event-bonus`: `keyPayload.bonusAnswers[questionId]` is present (or an override exists).
- `match-surprise`: one row per `(matchId, entrantName)` where the entrant appears in the host's `surpriseEntrants[matchId]` **and** ≥1 submitted player picked that name. Entrants that no player guessed don't produce a row.

Players who didn't pick a given entrant/answer still see the row with `score = 0` (renders as `—`). The row existence is driven by the *key*, the cell value is driven by the *pick*.

### Closest-rule interaction

For closest-rule questions, the winner is resolved in a second pass over `closestBuckets`. Per-question rows must be finalized **after** that pass, not during it, so the closest winner shows `+N` instead of `+0`. Restructure: (1) first pass collects raw per-question contributions and closest candidates; (2) second pass applies closest-rule scores and back-fills the corresponding `perQuestion` entries.

### Surprise attribution

Today `surprisePoints` is a running per-player total. To emit per-entrant rows, the accumulator needs per-`(matchId, entrantName)` attribution. Track `surpriseByEntrant: Map<string, Map<string, number>>` (`matchId` → `entrantName` → `points`) during the per-match loop, then fold into `perQuestion` at the end.

## API / types

### `lib/types.ts`

```ts
interface LiveGameLeaderboardEntry {
  rank: number; nickname: string; score: number;
  breakdown: {
    winnerPoints: number;
    bonusPoints: number;
    surprisePoints: number;
    perQuestion: BreakdownRow[]; // new
  };
  isSubmitted: boolean; lastUpdatedAt: string; lastSeenAt: string;
}
```

`BreakdownRow` exported from the same file. No change to `LiveGameStateResponse` shape — the new field rides on the existing leaderboard entries.

### Endpoints

**No new endpoints.** `/state` continues to carry the leaderboard; it now just has richer entries. The "Edit answers" button reuses `PUT /api/live-games/:gameId/me/picks`, which already rejects writes to locked questions via `lib/server/repositories/live-games.ts:668-690`.

## Snapshot caching

### Migration `0025_score_snapshot_breakdown.ts`

```ts
await db.schema
  .alterTable("live_game_score_snapshots")
  .addColumn("breakdown_json", "text") // nullable
  .execute();
```

Regenerate `lib/server/db/generated.ts` via `pnpm db:codegen`.

### Write path

`snapshotScores` (`live-games.ts:2215-2280`) serializes each entry's `perQuestion` into `breakdown_json` alongside the existing aggregate writes. The `.onConflict().doUpdateSet({...})` clause gains `breakdown_json` as well.

### Read path

The ended-game branch at `live-games.ts:3141` deserializes `breakdown_json` into the leaderboard entry's `perQuestion`. If the column is `null` (games that ended before the migration, or a race between migration and the next snapshot write), fall back to running `computeLeaderboard` on the still-present `key_payload_json` + `picks_json`. Same function call path — no shape drift risk.

### Why cache

Breakdowns are a pure function of `(card, keyPayload, picks)` so recomputation is always possible. We cache because (a) the aggregate snapshot already does, so keeping them together keeps read semantics uniform, and (b) ended-game reads skip the per-player `computeLeaderboard` pass today; we want to preserve that property.

## Player app — view routing

### New component

`components/pick-em/live-player/player-submitted-view.tsx`, sibling to `player-ended-view.tsx`.

### Routing inside `LiveGamePlayerApp` (`components/pick-em/live-game-player-app.tsx`)

Replaces the current `status === "ended" ? <PlayerEndedView/> : <picks UI>` ternary at line 757:

```tsx
if (state.game.status === "ended") return <PlayerEndedView ... />;
if (me?.isSubmitted && !isEditing) return <PlayerSubmittedView ... onEdit={() => setIsEditing(true)} />;
return <>{/* existing pick UI, with optional "Done" if isEditing */}</>;
```

`isEditing` is a `useState` flag on `LiveGamePlayerApp`. Refresh resets it — a reloaded submitted player lands back on the submitted view, which is the desired default.

### `PlayerSubmittedView` layout

- Compact header: "Submitted — watching live" + current rank/score badge (mirrors `PlayerEndedView`'s trophy block, minus the trophy).
- `<LeaderboardPanel variant="compact" onRowToggle selectedNicknames />` (new props — see below).
- `<ScoreBreakdown />` below the leaderboard.
- `UpdatesFeed` (moved from the old picks-view layout at line 815) so players still see host updates.
- "Edit answers" button, primary style, positioned below the breakdown.

### `PlayerEndedView` parallel changes

Same `<LeaderboardPanel onRowToggle>` + `<ScoreBreakdown>` layered below the existing final-leaderboard card in `components/pick-em/live-player/player-ended-view.tsx`. No Edit button (game is over).

## Breakdown component

### File

`components/pick-em/shared/score-breakdown.tsx`, shared between `PlayerSubmittedView` and `PlayerEndedView`.

### Props

```ts
{
  card: ResolvedCard;
  leaderboard: LiveGameLeaderboardEntry[];
  selectedNicknames: string[];  // controlled; default [meNickname]
  meNickname: string | null;    // rendered as "Me" in the header
}
```

### Row collapsing

Collect every selected entry's `perQuestion[]`, canonicalize by row key:

| Kind | Key | Label |
|---|---|---|
| `match-winner` | `match-winner:{matchId}` | `Match {N} Winner` (N = 1-based index) |
| `match-bonus` | `match-bonus:{matchId}:{questionId}` | question text from `card.matches[].bonusQuestions` |
| `event-bonus` | `event-bonus:{questionId}` | question text from `card.eventBonusQuestions` |
| `match-surprise` | `match-surprise:{matchId}:{entrantName}` | `Match {N} Surprise — {entrantName}` |

Row order: match index → within a match: winner → surprise entrants → match bonuses → (afterwards) event bonuses.

A row appears iff ≥1 selected player has an entry for that key OR the key is present in *any* entry (so players who missed a question still show a `—` cell).

### Responsive rendering

**≥ `md` (768px): table.**
- Sticky first column (question label).
- Player columns scroll horizontally past the viewport's capacity.
- Cells: `+N` for positive, `—` for zero.
- Sticky bottom **total row** summing each column — serves the "validate my score" intent by letting players confirm column totals match the leaderboard score above.

**< `md`: card list.**
- One card per scoring event (one per row in the table version).
- Card header: question label.
- Card body: list of `{nickname} · {+N | —}` rows for each selected player.
- Persistent summary bar above the list: `Me: 42 pts` (or all selected players' totals if multiple).

### Leaderboard row toggling

`components/pick-em/shared/leaderboard-panel.tsx` gains two optional props:

```ts
onRowToggle?: (nickname: string) => void;
selectedNicknames?: string[];
```

Only the `compact` variant wires them. When `onRowToggle` is provided, compact rows become `<button>` elements with a selected visual state (ring + slightly raised bg). Absence of `onRowToggle` → existing behavior. The `display` (TV) variant ignores both props — no regression, no new feature on TV.

### Selection state

Owned by `PlayerSubmittedView` and `PlayerEndedView` independently as `useState<Set<string>>(new Set([meNickname]))`. No URL state, no cap, no persistence across reload.

## Tests

### Unit (`tests/unit/lib/scoring.test.ts` + new `tests/unit/lib/live-games/compute-leaderboard.test.ts`)

- Unkeyed question → no `perQuestion` row for any player.
- Keyed question, player picked correctly → `perQuestion` row with `score > 0`.
- Keyed question, player picked wrong → `perQuestion` row with `score === 0`.
- Closest-rule: after the second pass, the closest player's `perQuestion` row has the full point value; others have `0`.
- Surprise: entrant nobody picked → no row; entrant picked by two players → one row; only guessers show `score > 0`.
- Overrides: accepted override for a match produces a `perQuestion` row with the awarded score; rejected override → `score: 0`.
- Invariant: `sum(perQuestion.score) === winnerPoints + bonusPoints + surprisePoints` for every entry.

### Integration (`tests/integration/`)

- `/state` for a live game with partial key → leaderboard entries include only keyed rows.
- End a game → `breakdown_json` populated in `live_game_score_snapshots` for every submitted player.
- `/state` for an ended game → `perQuestion` matches what was snapshotted (round-trip).
- `/state` for an ended game with `breakdown_json = null` → falls back to recompute and returns the same shape.

### E2E (optional Playwright)

1. Player submits.
2. Lands on submitted view; sees their row in breakdown (empty or with already-keyed rows).
3. Toggles another player from leaderboard → breakdown gains a column.
4. Host keys a match → on next poll, a new row appears in breakdown.
5. Click "Edit answers" → pick UI shown with existing picks preserved and locked questions disabled.
6. Click "Done" → back on submitted view.

## Out of scope

- *Override visual badges.* Scores reflect overrides, but no "host accepted" marker. Revisit if useful.
- *Tiebreaker row.* Tiebreaker doesn't award points; it's a sorting rule.
- *URL-sharable comparison.* `?compare=` param deferred — comparisons are ephemeral for an active game.
- *Hard cap on selected players.* Sticky-column + horizontal scroll is the escape hatch. Revisit if users regularly select >5.
- *Post-end key edits drift.* If a host re-ends or edits the key after a game ends, snapshot drift mirrors existing aggregate drift — no new problem introduced.

## Implementation order

1. Migration `0025_score_snapshot_breakdown.ts` + `pnpm db:codegen`.
2. `BreakdownRow` type in `lib/types.ts` + extend `ScoreAccumulator` + update `computeLeaderboard` (including closest-pass restructure and surprise per-entrant attribution).
3. Snapshot write/read path: `snapshotScores` serializes, ended-game state fetch deserializes with recompute fallback.
4. `ScoreBreakdown` component (table ≥md, card list <md).
5. `LeaderboardPanel` `onRowToggle` + `selectedNicknames` props (compact variant only).
6. `PlayerSubmittedView` component + `isEditing` flag in `LiveGamePlayerApp`.
7. `PlayerEndedView` adds the breakdown + leaderboard toggle wiring.
8. Unit + integration tests; optional e2e.

## Files touched (summary)

| Purpose | File |
|---|---|
| Migration | `migrations/0025_score_snapshot_breakdown.ts` (new) |
| Generated types | `lib/server/db/generated.ts` (regen) |
| Domain types | `lib/types.ts` |
| Scoring orchestration | `lib/server/repositories/live-games.ts` (`computeLeaderboard`, `snapshotScores`, ended-game read branch) |
| Breakdown UI | `components/pick-em/shared/score-breakdown.tsx` (new) |
| Leaderboard panel | `components/pick-em/shared/leaderboard-panel.tsx` |
| Player submitted view | `components/pick-em/live-player/player-submitted-view.tsx` (new) |
| Player ended view | `components/pick-em/live-player/player-ended-view.tsx` |
| Player app routing | `components/pick-em/live-game-player-app.tsx` |
| Unit tests | `tests/unit/lib/scoring.test.ts`, new `tests/unit/lib/live-games/compute-leaderboard.test.ts` |
| Integration tests | new `tests/integration/score-breakdown.test.ts` |
