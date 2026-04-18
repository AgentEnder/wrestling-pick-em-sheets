# #22 — feat: end game screen on individual views (not TV display) should show breakdown of own score

> **Labels**: priority: high
> **Author**: AgentEnder
> **Created**: 2026-04-17

## Issue body

> Currently the end game screen on the /play page for a card shows the overall leaderboard, but there's no way to validate the scoring since it doesn't show how you earned the points you earned. You should be able to validate your own score, as well as other players. Im imagining a table where there is a row for each match and bonus question. The columns would be selected players, and would default to only showing your personal score changes. The table would be below the leaderboard. Clicking rows in the leaderboard should toggle players from selected -> not selected and back.
>
> Something like:
>
> | Question | Me | Player 2 |
> |--------|--------|--------|
> | Match 1 Winner | - |  +5  |
> | Bonus question 1 | +2 | - |

This is **only** for the per-player `/play` ended view, not the TV `display` view.

## Where it lives

- Player ended view: `components/pick-em/live-player/player-ended-view.tsx:14-44` (Trophy + final rank/score + `<LeaderboardPanel variant="compact" />`).
- Leaderboard panel (with row-click target): `components/pick-em/shared/leaderboard-panel.tsx:8-130` (currently rows are not clickable).
- Scoring orchestration: `lib/server/repositories/live-games.ts:1343-1579` (`computeLeaderboard`).
- Pure scoring: `lib/server/scoring.ts:75-170` (`scoreForQuestion`).
- Leaderboard shape: `LiveGameLeaderboardEntry` in `lib/types.ts:252-264` — only aggregate `breakdown.{winnerPoints, bonusPoints, surprisePoints}`.
- Snapshot table: `migrations/0024_score_snapshots.ts` — also aggregate-only.
- Player API: `GET /api/live-games/:gameId/me` returns the player's own picks; `GET /state` returns leaderboard but **no key answers** to non-host players.

## The central data problem

To render `+5` for "Match 1 Winner" for any player, the client needs:

1. The **question definitions** (already in `state.card`).
2. The **player's pick** for that question (own pick is in `/me`; others' picks are in `state.players[].picks`).
3. The **correct key answer** (currently host-only).
4. The **resolved score** for that pick (= rerun `scoreForQuestion`, including overrides and "closest" cross-player resolution, which is non-trivial client-side).

Two designs to weigh during planning:

- **Server-computed breakdown (preferred).** Extend `computeLeaderboard` to return per-question contributions per player; expose them in `LiveGameLeaderboardEntry` (or a sibling field on the state response). Avoids leaking the key payload, keeps closest-rule logic in one place.
  - Likely shape:
    ```ts
    breakdown: {
      perQuestion: Array<{
        kind: "match-winner" | "match-bonus" | "match-surprise" | "event-bonus";
        matchId?: string;
        questionId?: string;
        label: string;        // or compute label client-side from card definitions
        score: number;
        maxPoints: number;
      }>;
      // existing aggregates
    }
    ```
  - May also want to persist this in `live_game_score_snapshots` (or a sibling table) so historical games render their breakdown after restart.
- **Client-computed breakdown.** Ship the key payload (or a sanitized per-question correct-answer set) to ended players. Simpler server change, but exposes correct answers during the game if anyone leaves the route open and re-enters.

The server-side option likely wins, especially because the "closest" rule (`scoreForQuestion` returning `isClosestCandidate`/`distance`) requires a global pass over all players to resolve.

## UI mechanics

- Below the existing `<LeaderboardPanel variant="compact" />` in `player-ended-view.tsx`.
- Default selected players: just `me`.
- Clicking a leaderboard row toggles that player into/out of the table columns. Need to thread an `onRowToggle` prop into `LeaderboardPanel` (only for the `compact` variant on the ended view, to avoid affecting the TV display variant).
- Row labels: "Match N Winner", optionally "Match N Surprise", and bonus questions by their `question` text. Use `+N` for points earned, `-` for zero (issue example shows `-` for zero, not `0`).
- Sticky header / scrollable horizontally if many players are selected.

## Behavior questions

- Should the breakdown also appear during a live game (when status is still `live`)? Issue title says end-game; sticking to that keeps complexity bounded.
- Tiebreaker — separate row at the bottom?
- What about overrides — show "host accepted" markers next to scores?
- Battle royal surprise points — one row per match or per entrant?

## Cross-cutting

- See `.ai/context/scoring.md` for the full scoring data flow and snapshot shape.
- See `.ai/context/live-games.md` for the player vs display ended-view split (don't change the display variant).
