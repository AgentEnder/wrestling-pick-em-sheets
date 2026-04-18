# Scoring

## Pure scoring (per question)

`lib/server/scoring.ts:75-170`:

```ts
export function scoreForQuestion(
  question: BonusQuestion,
  defaultPoints: number,
  keyAnswer: string,
  playerAnswer: string,
  override?: { accepted: boolean; source: string; confidence: number },
): { score: number; isClosestCandidate: boolean; distance?: number }
```

Handles:

- **Override precedence** — if accepted, awards `points`; if rejected, returns 0 regardless of pick.
- **Threshold questions** (lines ~96–120) — derives Over/Under labels from `thresholdValue`.
- **Exact strings** — case-insensitive via `normalizeText()`.
- **Numerical / time** — `parseValueByType()` parses values, supports `exact`, `closest`, `atOrAbove`, `atOrBelow` rules.
- **Closest** — returns `distance` so the orchestrator can pick "closest candidate" winners across all players.

Max-possible scoring lives in `lib/server/scoring-utils.ts:14-39` (`computeMaxPossiblePoints(card)`).

## Orchestration: `computeLeaderboard`

`lib/server/repositories/live-games.ts:1343-1579`. Walks every submitted player and accumulates into a per-player `ScoreAccumulator`:

```ts
interface ScoreAccumulator {
  playerId; nickname; score;
  winnerPoints;       // match-winner picks
  bonusPoints;        // match + event bonus questions
  surprisePoints;     // battle royal surprise entrants
  isSubmitted; updatedAt; lastSeenAt;
}
```

Steps:

1. **Match winner pick** (1366–1400): if normalized pick equals key result (or `winnerOverride` accepts it) → add `match.points ?? card.defaultPoints` to `winnerPoints`.
2. **Battle royal surprise entrants** (1401–1431): count matching entrants, cap at `match.surpriseSlots`, multiply by `surpriseEntrantPoints`.
3. **Match bonus questions** (1433–1478): per-question `scoreForQuestion()` → `bonusPoints`. Tracks closest-rule candidates in a `closestBuckets` map (1535–1549) so the closest player wins the points.
4. **Event bonus questions** (1482–1533): same logic against `card.eventBonusQuestions`.

The function knows per-question contributions during iteration but **does not return them** — only the three aggregate categories per player.

## Leaderboard shape returned to clients

`LiveGameLeaderboardEntry` in `lib/types.ts:252-264`:

```ts
{ rank; nickname; score;
  breakdown: { winnerPoints; bonusPoints; surprisePoints };
  isSubmitted; lastUpdatedAt; lastSeenAt; }
```

Returned in `LiveGameStateResponse` (`lib/client/live-games-api.ts`). Rendered by `components/pick-em/shared/leaderboard-panel.tsx:8-130` with two variants (`compact` for player sidebar, `display` for TV).

## Score snapshots

`migrations/0024_score_snapshots.ts` adds `live_game_score_snapshots`:

```sql
total_score, winner_points, bonus_points, surprise_points,
max_possible_points, rank, score_percentage
```

Same three-category aggregate — **no per-question breakdown is persisted**.

## What the client has access to today

On `/games/:gameId/play`:

- `LiveGameStateResponse` from `/state`: `card` (definitions only), `players`, `leaderboard` (aggregate breakdown), events.
- `LiveGameMeResponse` from `/me`: the **current player's own picks**.
- The host key (`keyPayload`, the correct answers) is **not exposed to non-host players**. Only the host route `/key` returns it.

This is the central constraint for issue #22: to show "Match 1 winner: +5 / Bonus #3: +0" rows, the client either (a) needs the key answers (security trade-off), or (b) needs the server to do the per-question scoring and ship the result.

## Existing tests

- `tests/unit/lib/scoring.test.ts` — overrides, threshold (over/under, time), exact matching, closest distance, atOrAbove/atOrBelow.
- `tests/unit/lib/pick-em/leaderboard-utils.test.ts` — `hasLeaderboardChanged`, bubble-sort animation steps.
- `tests/integration/auth-override-resolution.test.ts` — auth + override resolution.
- No end-to-end `computeLeaderboard` integration test.
