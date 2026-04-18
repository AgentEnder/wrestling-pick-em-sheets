# End-Game Score Breakdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship per-question score breakdown on the player `/play` surface for submitted-during-live and ended-game states, plus an "Edit answers" affordance that flips back to the pick UI.

**Architecture:** Extend `computeLeaderboard` (in `lib/server/repositories/live-games.ts`) to emit per-question `BreakdownRow[]` on each leaderboard entry. Cache the breakdown as `breakdown_json` on `live_game_score_snapshots` via migration 0025, with recompute fallback when the column is null. Client gets a new `<ScoreBreakdown>` component (responsive table/card list) and a new `<PlayerSubmittedView>` sibling to `<PlayerEndedView>`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5.7 strict, Kysely + libSQL, Tailwind v4, `tsx --test` (unit/integration), Playwright (e2e).

**Design doc:** [.ai/plans/2026-04-17-end-game-score-breakdown-design.md](./2026-04-17-end-game-score-breakdown-design.md)

**Pre-flight assumptions** (verify once before starting):
- You are in the worktree at `/Users/agentender/.superset/worktrees/wrestling-pick-em-sheets/planning-issue-22-implementation/` on branch `planning-issue-22-implementation`.
- `pnpm install` has been run recently.
- A local dev DB exists at `.local-db/` and `pnpm db:migrate:latest` succeeds before you start. If not, run it.

---

## Task 1: Migration 0025 — add `breakdown_json` column

**Files:**
- Create: `migrations/0025_score_snapshot_breakdown.ts`
- Modify (regen): `lib/server/db/generated.ts`

**Step 1: Write the migration**

```ts
// migrations/0025_score_snapshot_breakdown.ts
import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('live_game_score_snapshots')
    .addColumn('breakdown_json', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('live_game_score_snapshots')
    .dropColumn('breakdown_json')
    .execute()
}
```

**Step 2: Run the migration**

```bash
pnpm db:migrate:latest
```

Expected: output shows `0025_score_snapshot_breakdown` applied. No errors.

**Step 3: Regenerate types**

```bash
pnpm db:codegen
```

Expected: `lib/server/db/generated.ts` now has `breakdown_json: string | null` on the `LiveGameScoreSnapshots` interface.

**Step 4: Verify**

```bash
grep -n "breakdown_json" lib/server/db/generated.ts
```

Expected: one hit inside `LiveGameScoreSnapshots`.

**Step 5: Commit**

```bash
git add migrations/0025_score_snapshot_breakdown.ts lib/server/db/generated.ts
git commit -m "feat(db): add breakdown_json column to score snapshots"
```

---

## Task 2: Add `BreakdownRow` type + extend leaderboard entry

**Files:**
- Modify: `lib/types.ts` (around line 252)

**Step 1: Edit `lib/types.ts`**

Add the `BreakdownRow` union type and extend `LiveGameLeaderboardEntry.breakdown` with `perQuestion`:

```ts
export type BreakdownRow =
  | { kind: "match-winner"; matchId: string; score: number; maxPoints: number }
  | { kind: "match-bonus"; matchId: string; questionId: string; score: number; maxPoints: number }
  | { kind: "event-bonus"; questionId: string; score: number; maxPoints: number }
  | { kind: "match-surprise"; matchId: string; entrantName: string; score: number; maxPoints: number };

export interface LiveGameLeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  breakdown: {
    winnerPoints: number;
    bonusPoints: number;
    surprisePoints: number;
    perQuestion: BreakdownRow[];
  };
  isSubmitted: boolean;
  lastUpdatedAt: string;
  lastSeenAt: string;
}
```

**Step 2: Make `computeLeaderboard` compile with an empty array placeholder**

In `lib/server/repositories/live-games.ts`, around line 1569, update the returned entries to include `perQuestion: []`:

```ts
breakdown: {
  winnerPoints: entry.winnerPoints,
  bonusPoints: entry.bonusPoints,
  surprisePoints: entry.surprisePoints,
  perQuestion: [], // TODO: populated in subsequent tasks
},
```

And around line 3171 (the snapshot read path) do the same:

```ts
breakdown: {
  winnerPoints: snap.winner_points,
  bonusPoints: snap.bonus_points,
  surprisePoints: snap.surprise_points,
  perQuestion: [],
},
```

**Step 3: Verify type-check**

```bash
pnpm typecheck || pnpm build 2>&1 | head -40
```

Expected: no new TypeScript errors (or if no `typecheck` script exists, `pnpm build` passes; if time-consuming, `npx tsc --noEmit` is the fastest check).

**Step 4: Commit**

```bash
git add lib/types.ts lib/server/repositories/live-games.ts
git commit -m "feat(types): add BreakdownRow type and perQuestion field placeholder"
```

---

## Task 3: Export `computeLeaderboard` + unit test scaffolding

**Files:**
- Modify: `lib/server/repositories/live-games.ts` (line 1343 — flip `function` → `export function`)
- Create: `tests/unit/lib/live-games/compute-leaderboard.test.ts`

**Step 1: Export the function**

In `lib/server/repositories/live-games.ts`:

```ts
// line 1343 — was: function computeLeaderboard(
export function computeLeaderboard(
```

**Step 2: Write the scaffolding test**

```ts
// tests/unit/lib/live-games/compute-leaderboard.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeLeaderboard } from "@/lib/server/repositories/live-games";
import type {
  BonusQuestion,
  LiveGameKeyPayload,
  LiveGamePlayer,
  Match,
} from "@/lib/types";
import type { ResolvedCard } from "@/lib/server/repositories/cards";

export function makeCard(overrides: Partial<ResolvedCard> = {}): ResolvedCard {
  return {
    id: "card1",
    ownerId: null,
    eventName: "Test Event",
    promotionName: null,
    eventDate: null,
    eventTagline: null,
    defaultPoints: 5,
    tiebreakerLabel: null,
    tiebreakerIsTimeBased: false,
    matches: [],
    eventBonusQuestions: [],
    ...overrides,
  } as unknown as ResolvedCard;
}

export function makeKey(overrides: Partial<LiveGameKeyPayload> = {}): LiveGameKeyPayload {
  return {
    matchResults: [],
    eventBonusAnswers: [],
    winnerOverrides: [],
    scoreOverrides: [],
    timers: [],
    ...overrides,
  } as LiveGameKeyPayload;
}

export function makePlayer(overrides: Partial<LiveGamePlayer> = {}): LiveGamePlayer {
  const defaults = {
    id: "p1",
    gameId: "g1",
    joinStatus: "approved" as const,
    nickname: "Alice",
    isSubmitted: true,
    picks: { matchPicks: [], eventBonusAnswers: [], tiebreakerAnswer: null },
    updatedAt: "2026-04-17T00:00:00Z",
    lastSeenAt: "2026-04-17T00:00:00Z",
    submittedAt: "2026-04-17T00:00:00Z",
    joinedAt: "2026-04-17T00:00:00Z",
  };
  return { ...defaults, ...overrides } as unknown as LiveGamePlayer;
}

describe("computeLeaderboard — perQuestion breakdown", () => {
  test("scaffolding compiles and runs", () => {
    const result = computeLeaderboard(makeCard(), makeKey(), []);
    assert.deepEqual(result, []);
  });
});
```

**Step 3: Run the test**

```bash
pnpm test:unit -- --test-name-pattern="scaffolding"
```

Expected: PASS. (If the flag syntax differs, just run `pnpm test:unit` and confirm this new file's single test passes.)

**Step 4: Commit**

```bash
git add lib/server/repositories/live-games.ts tests/unit/lib/live-games/compute-leaderboard.test.ts
git commit -m "test: scaffold compute-leaderboard unit tests and export function"
```

---

## Task 4: Emit `match-winner` breakdown rows (TDD)

**Files:**
- Modify: `lib/server/repositories/live-games.ts` (ScoreAccumulator + match-winner block around lines 1325-1400)
- Modify: `tests/unit/lib/live-games/compute-leaderboard.test.ts`

**Step 1: Write the failing test**

Append to `compute-leaderboard.test.ts`:

```ts
test("emits match-winner row when host keyed the winner and player picked correctly", () => {
  const match = { id: "m1", title: "Main Event", points: 10, bonusQuestions: [], isBattleRoyal: false, surpriseSlots: 0, surpriseEntrantPoints: null, participants: [], type: "standard", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
  const card = makeCard({ matches: [match] });
  const key = makeKey({ matchResults: [{ matchId: "m1", winnerName: "Cody", battleRoyalEntryOrder: [], bonusAnswers: [] }] });
  const player = makePlayer({ picks: { matchPicks: [{ matchId: "m1", winnerName: "Cody", battleRoyalEntrants: [], bonusAnswers: [] }], eventBonusAnswers: [], tiebreakerAnswer: null } });

  const [entry] = computeLeaderboard(card, key, [player]);

  assert.equal(entry.score, 10);
  assert.deepEqual(entry.breakdown.perQuestion, [
    { kind: "match-winner", matchId: "m1", score: 10, maxPoints: 10 },
  ]);
});

test("does not emit match-winner row when host has not keyed the match", () => {
  const match = { id: "m1", title: "Main Event", points: 10, bonusQuestions: [], isBattleRoyal: false, surpriseSlots: 0, surpriseEntrantPoints: null, participants: [], type: "standard", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
  const card = makeCard({ matches: [match] });
  const player = makePlayer({ picks: { matchPicks: [{ matchId: "m1", winnerName: "Cody", battleRoyalEntrants: [], bonusAnswers: [] }], eventBonusAnswers: [], tiebreakerAnswer: null } });

  const [entry] = computeLeaderboard(card, makeKey(), [player]);

  assert.deepEqual(entry.breakdown.perQuestion, []);
});

test("emits match-winner row with score=0 when player picked wrong", () => {
  const match = { id: "m1", title: "Main Event", points: 10, bonusQuestions: [], isBattleRoyal: false, surpriseSlots: 0, surpriseEntrantPoints: null, participants: [], type: "standard", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
  const card = makeCard({ matches: [match] });
  const key = makeKey({ matchResults: [{ matchId: "m1", winnerName: "Cody", battleRoyalEntryOrder: [], bonusAnswers: [] }] });
  const player = makePlayer({ picks: { matchPicks: [{ matchId: "m1", winnerName: "Roman", battleRoyalEntrants: [], bonusAnswers: [] }], eventBonusAnswers: [], tiebreakerAnswer: null } });

  const [entry] = computeLeaderboard(card, key, [player]);

  assert.deepEqual(entry.breakdown.perQuestion, [
    { kind: "match-winner", matchId: "m1", score: 0, maxPoints: 10 },
  ]);
});
```

**Step 2: Run tests — expect failure**

```bash
pnpm test:unit
```

Expected: three new tests FAIL (empty `perQuestion` vs expected rows).

**Step 3: Extend `ScoreAccumulator` + match-winner emission**

In `lib/server/repositories/live-games.ts:1325-1335`:

```ts
interface ScoreAccumulator {
  playerId: string;
  nickname: string;
  score: number;
  winnerPoints: number;
  bonusPoints: number;
  surprisePoints: number;
  perQuestion: BreakdownRow[]; // NEW
  isSubmitted: boolean;
  updatedAt: string;
  lastSeenAt: string;
}
```

Import `BreakdownRow`:

```ts
import type {
  // ... existing imports
  BreakdownRow,
} from "@/lib/types";
```

Initialize `perQuestion: []` in the accumulator setup (around line 1352-1363).

After the match-winner logic at line 1399 (just after `score.winnerPoints += winnerPoints;` closes the `else if` branch — outside the override/correct branches but still inside the per-player loop), emit the row. Key change: every keyed match should produce a row for every player, with `score` = the points they earned (0 or winnerPoints):

Replace lines 1387-1400 with:

```ts
let matchWinnerScore = 0;
if (winnerOverride) {
  if (winnerOverride.accepted) {
    matchWinnerScore = winnerPoints;
  }
} else if (
  keyMatchResult.winnerName.trim() &&
  playerMatchPick?.winnerName &&
  answerEquals(keyMatchResult.winnerName, playerMatchPick.winnerName)
) {
  matchWinnerScore = winnerPoints;
}

if (matchWinnerScore > 0) {
  score.score += matchWinnerScore;
  score.winnerPoints += matchWinnerScore;
}

if (keyMatchResult.winnerName.trim() || winnerOverride) {
  score.perQuestion.push({
    kind: "match-winner",
    matchId: match.id,
    score: matchWinnerScore,
    maxPoints: winnerPoints,
  });
}
```

Finally, update the returned entry at line 1569 to include `perQuestion: entry.perQuestion`.

**Step 4: Run tests**

```bash
pnpm test:unit
```

Expected: all `computeLeaderboard — perQuestion breakdown` tests PASS. Existing scoring tests still pass.

**Step 5: Commit**

```bash
git add lib/server/repositories/live-games.ts tests/unit/lib/live-games/compute-leaderboard.test.ts
git commit -m "feat(scoring): emit per-question breakdown rows for match winners"
```

---

## Task 5: Emit `match-bonus` + `event-bonus` rows (non-closest case)

**Files:**
- Modify: `lib/server/repositories/live-games.ts` (bonus question blocks, lines 1433-1533)
- Modify: `tests/unit/lib/live-games/compute-leaderboard.test.ts`

**Step 1: Write failing tests**

```ts
test("emits match-bonus row with score>0 for correct answer", () => {
  const question: BonusQuestion = {
    id: "q1", question: "First finisher?", points: 3,
    answerType: "write-in", options: [], valueType: "string", gradingRule: "exact",
  };
  const match = { id: "m1", title: "Main Event", points: null, bonusQuestions: [question], isBattleRoyal: false, surpriseSlots: 0, surpriseEntrantPoints: null, participants: [], type: "standard", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
  const card = makeCard({ matches: [match], defaultPoints: 5 });
  const key = makeKey({ matchResults: [{ matchId: "m1", winnerName: "", battleRoyalEntryOrder: [], bonusAnswers: [{ questionId: "q1", answer: "Cross Rhodes" }] }] });
  const player = makePlayer({ picks: { matchPicks: [{ matchId: "m1", winnerName: "", battleRoyalEntrants: [], bonusAnswers: [{ questionId: "q1", answer: "Cross Rhodes" }] }], eventBonusAnswers: [], tiebreakerAnswer: null } });

  const [entry] = computeLeaderboard(card, key, [player]);

  assert.equal(entry.score, 3);
  assert.deepEqual(entry.breakdown.perQuestion, [
    { kind: "match-bonus", matchId: "m1", questionId: "q1", score: 3, maxPoints: 3 },
  ]);
});

test("emits event-bonus row for correct event-level answer", () => {
  const question: BonusQuestion = {
    id: "eq1", question: "How many matches?", points: null,
    answerType: "write-in", options: [], valueType: "numerical", gradingRule: "exact",
  };
  const card = makeCard({ eventBonusQuestions: [question], defaultPoints: 5 });
  const key = makeKey({ eventBonusAnswers: [{ questionId: "eq1", answer: "10" }] });
  const player = makePlayer({ picks: { matchPicks: [], eventBonusAnswers: [{ questionId: "eq1", answer: "10" }], tiebreakerAnswer: null } });

  const [entry] = computeLeaderboard(card, key, [player]);

  assert.equal(entry.score, 5);
  assert.deepEqual(entry.breakdown.perQuestion, [
    { kind: "event-bonus", questionId: "eq1", score: 5, maxPoints: 5 },
  ]);
});

test("does not emit bonus row when host has not keyed an answer", () => {
  const question: BonusQuestion = {
    id: "q1", question: "First finisher?", points: 3,
    answerType: "write-in", options: [], valueType: "string", gradingRule: "exact",
  };
  const match = { id: "m1", title: "Main Event", points: null, bonusQuestions: [question], isBattleRoyal: false, surpriseSlots: 0, surpriseEntrantPoints: null, participants: [], type: "standard", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
  const card = makeCard({ matches: [match] });
  const key = makeKey({ matchResults: [{ matchId: "m1", winnerName: "", battleRoyalEntryOrder: [], bonusAnswers: [] }] });
  const player = makePlayer({ picks: { matchPicks: [{ matchId: "m1", winnerName: "", battleRoyalEntrants: [], bonusAnswers: [{ questionId: "q1", answer: "Cross Rhodes" }] }], eventBonusAnswers: [], tiebreakerAnswer: null } });

  const [entry] = computeLeaderboard(card, key, [player]);

  assert.deepEqual(entry.breakdown.perQuestion, []);
});
```

**Step 2: Run — expect fail**

```bash
pnpm test:unit
```

Expected: three new tests FAIL.

**Step 3: Implement match-bonus rows**

In the match-bonus loop (lines 1433-1478), replace the inner body to emit rows. The key condition: a row is emitted iff `keyAnswer.trim() !== ""` OR `override` exists. For closest-rule candidates, emit a placeholder row with `score: 0` now; Task 7 will back-fill via the second pass.

Find `for (const question of match.bonusQuestions) {` and replace the body:

```ts
for (const question of match.bonusQuestions) {
  const keyAnswerRow = keyMatchResult.bonusAnswers.find(
    (answer) => answer.questionId === question.id,
  );
  const keyAnswer = keyAnswerRow?.answer ?? "";
  const playerAnswer = pickBonusAnswer(
    playerMatchPick?.bonusAnswers ?? [],
    question.id,
  );
  const override = keyPayload.scoreOverrides.find(
    (o) =>
      o.questionId === question.id &&
      normalizeText(o.playerNickname) === normalizeText(player.nickname),
  );
  const hasKey = keyAnswer.trim() !== "" || !!override;
  if (!hasKey) continue;

  const maxPoints = question.points ?? card.defaultPoints;
  const result = scoreForQuestion(
    question,
    card.defaultPoints,
    keyAnswer,
    playerAnswer,
    override,
  );

  if (result.score > 0) {
    score.score += result.score;
    score.bonusPoints += result.score;
    score.perQuestion.push({
      kind: "match-bonus",
      matchId: match.id,
      questionId: question.id,
      score: result.score,
      maxPoints,
    });
    continue;
  }

  if (result.isClosestCandidate && typeof result.distance === "number") {
    const key = `match:${match.id}:${question.id}`;
    const points = maxPoints;
    const existing = closestBuckets.get(key);
    if (existing) {
      existing.entries.push({ playerId: player.id, distance: result.distance });
    } else {
      closestBuckets.set(key, {
        key,
        points,
        entries: [{ playerId: player.id, distance: result.distance }],
      });
    }
    // Placeholder row — Task 7 back-fills score for the winner
    score.perQuestion.push({
      kind: "match-bonus",
      matchId: match.id,
      questionId: question.id,
      score: 0,
      maxPoints,
    });
    continue;
  }

  // Keyed but player got 0 and not a closest candidate
  score.perQuestion.push({
    kind: "match-bonus",
    matchId: match.id,
    questionId: question.id,
    score: 0,
    maxPoints,
  });
}
```

**Step 4: Implement event-bonus rows (same shape)**

Apply the analogous change to the event-bonus loop (lines 1482-1533). `kind: "event-bonus"`, no `matchId`.

**Step 5: Run tests**

```bash
pnpm test:unit
```

Expected: all tests PASS. (Closest-rule tests come in Task 7.)

**Step 6: Commit**

```bash
git add lib/server/repositories/live-games.ts tests/unit/lib/live-games/compute-leaderboard.test.ts
git commit -m "feat(scoring): emit per-question breakdown rows for bonus questions"
```

---

## Task 6: Closest-rule back-fill

**Files:**
- Modify: `lib/server/repositories/live-games.ts` (closest-bucket resolution, lines 1535-1549)
- Modify: `tests/unit/lib/live-games/compute-leaderboard.test.ts`

**Step 1: Write the failing test**

```ts
test("closest-rule: winner's per-question row gets back-filled with the points", () => {
  const question: BonusQuestion = {
    id: "q1", question: "Duration?", points: 4,
    answerType: "write-in", options: [], valueType: "numerical", gradingRule: "closest",
  };
  const card = makeCard({ eventBonusQuestions: [question] });
  const key = makeKey({ eventBonusAnswers: [{ questionId: "q1", answer: "30" }] });
  const closer = makePlayer({ id: "p1", nickname: "Alice", picks: { matchPicks: [], eventBonusAnswers: [{ questionId: "q1", answer: "28" }], tiebreakerAnswer: null } });
  const farther = makePlayer({ id: "p2", nickname: "Bob", picks: { matchPicks: [], eventBonusAnswers: [{ questionId: "q1", answer: "50" }], tiebreakerAnswer: null } });

  const leaderboard = computeLeaderboard(card, key, [closer, farther]);
  const alice = leaderboard.find((e) => e.nickname === "Alice")!;
  const bob = leaderboard.find((e) => e.nickname === "Bob")!;

  assert.equal(alice.score, 4);
  assert.deepEqual(alice.breakdown.perQuestion, [
    { kind: "event-bonus", questionId: "q1", score: 4, maxPoints: 4 },
  ]);
  assert.equal(bob.score, 0);
  assert.deepEqual(bob.breakdown.perQuestion, [
    { kind: "event-bonus", questionId: "q1", score: 0, maxPoints: 4 },
  ]);
});
```

**Step 2: Run — expect fail**

```bash
pnpm test:unit
```

Expected: FAIL — `alice.breakdown.perQuestion[0].score` is 0 because the placeholder row was never back-filled.

**Step 3: Back-fill closest-rule winner rows**

In the closest-bucket resolution loop (currently lines 1535-1549), after awarding points, locate the placeholder row in that player's `perQuestion` and update its `score`. Parse the bucket `key` (format: `match:{matchId}:{questionId}` or `event:{questionId}`) to find the matching row.

Replace lines 1535-1549:

```ts
for (const bucket of closestBuckets.values()) {
  if (bucket.entries.length === 0 || bucket.points <= 0) continue;

  const minDistance = Math.min(
    ...bucket.entries.map((entry) => entry.distance),
  );
  for (const entry of bucket.entries) {
    if (Math.abs(entry.distance - minDistance) > 0.0001) continue;

    const score = accumulators.get(entry.playerId);
    if (!score) continue;
    score.score += bucket.points;
    score.bonusPoints += bucket.points;

    // Back-fill the placeholder perQuestion row
    const parts = bucket.key.split(":");
    if (parts[0] === "match" && parts[1] && parts[2]) {
      const matchId = parts[1];
      const questionId = parts[2];
      const row = score.perQuestion.find(
        (r) => r.kind === "match-bonus" && r.matchId === matchId && r.questionId === questionId,
      );
      if (row) row.score = bucket.points;
    } else if (parts[0] === "event" && parts[1]) {
      const questionId = parts[1];
      const row = score.perQuestion.find(
        (r) => r.kind === "event-bonus" && r.questionId === questionId,
      );
      if (row) row.score = bucket.points;
    }
  }
}
```

**Step 4: Run tests**

```bash
pnpm test:unit
```

Expected: PASS.

**Step 5: Commit**

```bash
git add lib/server/repositories/live-games.ts tests/unit/lib/live-games/compute-leaderboard.test.ts
git commit -m "feat(scoring): back-fill per-question score for closest-rule winners"
```

---

## Task 7: `match-surprise` per-entrant rows

**Files:**
- Modify: `lib/server/repositories/live-games.ts` (battle-royal block, lines 1401-1431)
- Modify: `tests/unit/lib/live-games/compute-leaderboard.test.ts`

**Step 1: Write failing tests**

```ts
test("surprise: emits one row per entrant guessed by ≥1 player", () => {
  const match = { id: "m1", title: "Royal Rumble", points: null, bonusQuestions: [], isBattleRoyal: true, surpriseSlots: 2, surpriseEntrantPoints: 7, participants: [], type: "battle-royal", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
  const card = makeCard({ matches: [match] });
  const key = makeKey({ matchResults: [{ matchId: "m1", winnerName: "", battleRoyalEntryOrder: ["Sting", "Jarrett"], bonusAnswers: [] }] });
  const alice = makePlayer({ id: "p1", nickname: "Alice", picks: { matchPicks: [{ matchId: "m1", winnerName: "", battleRoyalEntrants: ["Sting"], bonusAnswers: [] }], eventBonusAnswers: [], tiebreakerAnswer: null } });
  const bob = makePlayer({ id: "p2", nickname: "Bob", picks: { matchPicks: [{ matchId: "m1", winnerName: "", battleRoyalEntrants: ["Sting", "Jarrett"], bonusAnswers: [] }], eventBonusAnswers: [], tiebreakerAnswer: null } });

  const leaderboard = computeLeaderboard(card, key, [alice, bob]);
  const aliceRows = leaderboard.find((e) => e.nickname === "Alice")!.breakdown.perQuestion;
  const bobRows = leaderboard.find((e) => e.nickname === "Bob")!.breakdown.perQuestion;

  // Sting was guessed (by both); Jarrett was guessed (by Bob); both entrants emit rows.
  assert.deepEqual(aliceRows, [
    { kind: "match-surprise", matchId: "m1", entrantName: "Sting", score: 7, maxPoints: 7 },
    { kind: "match-surprise", matchId: "m1", entrantName: "Jarrett", score: 0, maxPoints: 7 },
  ]);
  assert.deepEqual(bobRows, [
    { kind: "match-surprise", matchId: "m1", entrantName: "Sting", score: 7, maxPoints: 7 },
    { kind: "match-surprise", matchId: "m1", entrantName: "Jarrett", score: 7, maxPoints: 7 },
  ]);
});

test("surprise: entrant nobody picked produces no row", () => {
  const match = { id: "m1", title: "Royal Rumble", points: null, bonusQuestions: [], isBattleRoyal: true, surpriseSlots: 2, surpriseEntrantPoints: 7, participants: [], type: "battle-royal", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
  const card = makeCard({ matches: [match] });
  const key = makeKey({ matchResults: [{ matchId: "m1", winnerName: "", battleRoyalEntryOrder: ["Sting", "Jarrett"], bonusAnswers: [] }] });
  const alice = makePlayer({ picks: { matchPicks: [{ matchId: "m1", winnerName: "", battleRoyalEntrants: ["Sting"], bonusAnswers: [] }], eventBonusAnswers: [], tiebreakerAnswer: null } });

  const [entry] = computeLeaderboard(card, key, [alice]);
  const surpriseRows = entry.breakdown.perQuestion.filter((r) => r.kind === "match-surprise");

  assert.deepEqual(surpriseRows, [
    { kind: "match-surprise", matchId: "m1", entrantName: "Sting", score: 7, maxPoints: 7 },
  ]);
});
```

**Step 2: Run — expect fail**

```bash
pnpm test:unit
```

Expected: FAIL — no surprise rows emitted yet.

**Step 3: Rewrite the battle-royal block**

Replace lines 1401-1431:

```ts
if (
  match.isBattleRoyal &&
  keyMatchResult.battleRoyalEntryOrder.length > 0
) {
  const playerPickedNormalized = new Set(
    (playerMatchPick?.battleRoyalEntrants ?? []).map((e) => normalizeText(e)),
  );

  // Per-entrant attribution — one row per keyed entrant guessed by ≥1 player.
  // We need the list of entrants guessed by ANY submitted player (not just this one),
  // so we do it once at the end of the match loop. Collect for now.
  // (This per-player pass only needs to know: did THIS player guess this entrant?)
  // Use the cap via surpriseSlots below.
  const cappedMax = Math.max(0, match.surpriseSlots);
  let awarded = 0;
  for (const keyedEntrantRaw of keyMatchResult.battleRoyalEntryOrder) {
    const entrantNorm = normalizeText(keyedEntrantRaw);
    const playerPickedThis = playerPickedNormalized.has(entrantNorm);
    const earned = playerPickedThis && awarded < cappedMax ? surprisePoints : 0;
    if (earned > 0) {
      awarded += 1;
      score.score += earned;
      score.surprisePoints += earned;
    }
    // Row emission handled in a per-match post-pass once we know who else guessed.
    // Stash pending info on the accumulator for this match:
    // we'll resolve emission after the player loop finishes.
  }
}
```

Wait — emitting per-entrant rows requires knowing, across all players, which entrants were guessed by ≥1. That needs a per-match post-pass after the per-player loop. Restructure as follows:

**Restructure the match-level block (lines 1366-1480) into two passes:**

Pass 1 (existing per-player loop) — compute scores (winner, bonuses, surprise totals) and push match-winner + bonus rows as before; for surprise, only track which entrants THIS player guessed (store on accumulator in a temp map keyed by match).

Pass 2 (new per-match post-pass) — for each keyed entrant, check whether ≥1 player guessed it; if yes, emit a `match-surprise` row on every submitted player's `perQuestion` with the correct score.

Cleaner implementation: after the per-player loop for a match, run:

```ts
// after the per-player loop inside `for (const match of card.matches)`:
if (match.isBattleRoyal && keyMatchResult.battleRoyalEntryOrder.length > 0) {
  const pickedByAnyNorm = new Set<string>();
  const pickedByPlayerNorm = new Map<string, Set<string>>();
  for (const player of submittedPlayers) {
    const pick = pickMatchPick(player.picks.matchPicks, match.id);
    const normSet = new Set((pick?.battleRoyalEntrants ?? []).map((e) => normalizeText(e)));
    pickedByPlayerNorm.set(player.id, normSet);
    for (const n of normSet) pickedByAnyNorm.add(n);
  }

  for (const keyedRaw of keyMatchResult.battleRoyalEntryOrder) {
    const keyedNorm = normalizeText(keyedRaw);
    if (!pickedByAnyNorm.has(keyedNorm)) continue;
    for (const player of submittedPlayers) {
      const acc = accumulators.get(player.id);
      if (!acc) continue;
      const guessed = pickedByPlayerNorm.get(player.id)?.has(keyedNorm) ?? false;
      acc.perQuestion.push({
        kind: "match-surprise",
        matchId: match.id,
        entrantName: keyedRaw,
        score: guessed ? surprisePoints : 0,
        maxPoints: surprisePoints,
      });
    }
  }
}
```

**Important:** remove the old score-adding code inside the per-player loop's battle-royal block. Score contribution (for scoring totals) must now happen in the post-pass — but only up to `match.surpriseSlots` per player. Update the post-pass: instead of `acc.score += surprisePoints`, iterate per player with a per-player counter capped at `surpriseSlots`. Full version:

```ts
if (match.isBattleRoyal && keyMatchResult.battleRoyalEntryOrder.length > 0) {
  const keyedEntrants = keyMatchResult.battleRoyalEntryOrder;
  const pickedByAnyNorm = new Set<string>();
  const pickedByPlayerNorm = new Map<string, Set<string>>();
  for (const player of submittedPlayers) {
    const pick = pickMatchPick(player.picks.matchPicks, match.id);
    const normSet = new Set((pick?.battleRoyalEntrants ?? []).map((e) => normalizeText(e)));
    pickedByPlayerNorm.set(player.id, normSet);
    for (const n of normSet) pickedByAnyNorm.add(n);
  }

  const cappedMax = Math.max(0, match.surpriseSlots);
  const awardedByPlayer = new Map<string, number>();

  for (const keyedRaw of keyedEntrants) {
    const keyedNorm = normalizeText(keyedRaw);
    if (!pickedByAnyNorm.has(keyedNorm)) continue;

    for (const player of submittedPlayers) {
      const acc = accumulators.get(player.id);
      if (!acc) continue;
      const guessed = pickedByPlayerNorm.get(player.id)?.has(keyedNorm) ?? false;
      const prior = awardedByPlayer.get(player.id) ?? 0;
      const canAward = guessed && prior < cappedMax;
      const earned = canAward ? surprisePoints : 0;
      if (earned > 0) {
        acc.score += earned;
        acc.surprisePoints += earned;
        awardedByPlayer.set(player.id, prior + 1);
      }
      acc.perQuestion.push({
        kind: "match-surprise",
        matchId: match.id,
        entrantName: keyedRaw,
        score: earned,
        maxPoints: surprisePoints,
      });
    }
  }
}
```

**Delete** the old battle-royal block inside the per-player loop (the one you previously saw at lines 1401-1431) so surprise points aren't counted twice. Move the block above to run *after* the per-player loop but *inside* `for (const match of card.matches) { ... }`.

**Step 4: Run tests**

```bash
pnpm test:unit
```

Expected: all tests PASS, including the two new surprise tests. Existing surprise tests in `scoring.test.ts` still pass.

**Step 5: Commit**

```bash
git add lib/server/repositories/live-games.ts tests/unit/lib/live-games/compute-leaderboard.test.ts
git commit -m "feat(scoring): emit per-surprise-entrant breakdown rows"
```

---

## Task 8: Invariant test (sum equals aggregate)

**Files:**
- Modify: `tests/unit/lib/live-games/compute-leaderboard.test.ts`

**Step 1: Write the test**

```ts
test("invariant: sum of perQuestion.score equals winnerPoints + bonusPoints + surprisePoints for every entry", () => {
  const question: BonusQuestion = {
    id: "q1", question: "First finisher?", points: 3,
    answerType: "write-in", options: [], valueType: "string", gradingRule: "exact",
  };
  const match = { id: "m1", title: "Main Event", points: 10, bonusQuestions: [question], isBattleRoyal: true, surpriseSlots: 1, surpriseEntrantPoints: 5, participants: [], type: "standard", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
  const card = makeCard({ matches: [match], eventBonusQuestions: [] });
  const key = makeKey({ matchResults: [{ matchId: "m1", winnerName: "Cody", battleRoyalEntryOrder: ["Sting"], bonusAnswers: [{ questionId: "q1", answer: "Cross Rhodes" }] }] });
  const alice = makePlayer({ id: "p1", nickname: "Alice", picks: { matchPicks: [{ matchId: "m1", winnerName: "Cody", battleRoyalEntrants: ["Sting"], bonusAnswers: [{ questionId: "q1", answer: "Cross Rhodes" }] }], eventBonusAnswers: [], tiebreakerAnswer: null } });
  const bob = makePlayer({ id: "p2", nickname: "Bob", picks: { matchPicks: [{ matchId: "m1", winnerName: "Roman", battleRoyalEntrants: [], bonusAnswers: [{ questionId: "q1", answer: "Wrong" }] }], eventBonusAnswers: [], tiebreakerAnswer: null } });

  for (const entry of computeLeaderboard(card, key, [alice, bob])) {
    const perQuestionSum = entry.breakdown.perQuestion.reduce((s, r) => s + r.score, 0);
    const aggregateSum = entry.breakdown.winnerPoints + entry.breakdown.bonusPoints + entry.breakdown.surprisePoints;
    assert.equal(perQuestionSum, aggregateSum, `Mismatch for ${entry.nickname}`);
    assert.equal(perQuestionSum, entry.score, `Total mismatch for ${entry.nickname}`);
  }
});
```

**Step 2: Run — expect pass**

```bash
pnpm test:unit
```

Expected: PASS (invariants already hold from Tasks 4-7).

**Step 3: Commit**

```bash
git add tests/unit/lib/live-games/compute-leaderboard.test.ts
git commit -m "test: assert per-question sum invariant across scoring categories"
```

---

## Task 9: Snapshot write path (serialize `breakdown_json`)

**Files:**
- Modify: `lib/server/repositories/live-games.ts` (`snapshotScores`, lines 2215-2280)

**Step 1: Update the insert + `.onConflict` clauses**

In `snapshotScores`, inside the `for (const entry of leaderboard)` loop, add `breakdown_json: JSON.stringify(entry.breakdown.perQuestion)` to both the `.values({...})` object and the `.doUpdateSet({...})` object:

```ts
await db
  .insertInto("live_game_score_snapshots")
  .values({
    game_id: gameId,
    player_id: playerId,
    total_score: entry.score,
    max_possible_points: maxPossiblePoints,
    winner_points: entry.breakdown.winnerPoints,
    bonus_points: entry.breakdown.bonusPoints,
    surprise_points: entry.breakdown.surprisePoints,
    rank: entry.rank,
    player_count: submittedCount,
    score_percentage: Math.round(percentage * 100) / 100,
    breakdown_json: JSON.stringify(entry.breakdown.perQuestion), // NEW
    updated_at: now,
  })
  .onConflict((oc) =>
    oc.columns(["game_id", "player_id"]).doUpdateSet({
      total_score: entry.score,
      max_possible_points: maxPossiblePoints,
      winner_points: entry.breakdown.winnerPoints,
      bonus_points: entry.breakdown.bonusPoints,
      surprise_points: entry.breakdown.surprisePoints,
      rank: entry.rank,
      player_count: submittedCount,
      score_percentage: Math.round(percentage * 100) / 100,
      breakdown_json: JSON.stringify(entry.breakdown.perQuestion), // NEW
      updated_at: now,
    }),
  )
  .execute();
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add lib/server/repositories/live-games.ts
git commit -m "feat(snapshots): persist per-question breakdown in live_game_score_snapshots"
```

---

## Task 10: Snapshot read path (deserialize with recompute fallback)

**Files:**
- Modify: `lib/server/repositories/live-games.ts` (snapshot read branch at line 3157)

**Step 1: Update the mapper**

In the branch that maps snapshot rows to leaderboard entries (around lines 3163-3182), parse `breakdown_json`:

```ts
leaderboard = snapshotRows
  .map((snap) => {
    const player = playerIdToPlayer.get(snap.player_id);
    if (!player) return null;
    let perQuestion: BreakdownRow[] = [];
    if (snap.breakdown_json) {
      try {
        perQuestion = JSON.parse(snap.breakdown_json) as BreakdownRow[];
      } catch {
        perQuestion = [];
      }
    }
    return {
      rank: snap.rank,
      nickname: player.nickname,
      score: snap.total_score,
      breakdown: {
        winnerPoints: snap.winner_points,
        bonusPoints: snap.bonus_points,
        surprisePoints: snap.surprise_points,
        perQuestion,
      },
      isSubmitted: player.isSubmitted,
      lastUpdatedAt: player.updatedAt,
      lastSeenAt: player.lastSeenAt,
    } satisfies LiveGameLeaderboardEntry;
  })
  .filter((entry): entry is LiveGameLeaderboardEntry => entry !== null)
  .sort((a, b) => a.rank - b.rank);

// If any snapshot was missing breakdown_json, recompute the whole leaderboard
// (cheap — pure function over already-loaded data) so perQuestion is always populated.
if (snapshotRows.some((snap) => !snap.breakdown_json)) {
  const recomputed = computeLeaderboard(
    access.card,
    access.game.keyPayload,
    approvedPlayers,
  );
  const recomputedByNickname = new Map(recomputed.map((e) => [e.nickname, e]));
  leaderboard = leaderboard.map((entry) => {
    if (entry.breakdown.perQuestion.length > 0) return entry;
    const fresh = recomputedByNickname.get(entry.nickname);
    if (!fresh) return entry;
    return {
      ...entry,
      breakdown: {
        ...entry.breakdown,
        perQuestion: fresh.breakdown.perQuestion,
      },
    };
  });
}
```

Import `BreakdownRow` at the top if not already imported.

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add lib/server/repositories/live-games.ts
git commit -m "feat(snapshots): deserialize breakdown_json with recompute fallback"
```

---

## Task 11: Integration test — state API round-trips breakdown

**Files:**
- Create: `tests/integration/score-breakdown.test.ts`

**Pre-work:** Look at the existing `tests/integration/auth-override-resolution.test.ts` for the setup pattern. You may need to use the in-memory libsql test harness. If no such harness exists in this repo yet, this test can be a unit-adjacent test that: (a) inserts a fake snapshot row with `breakdown_json`, (b) reads it back via a helper, (c) asserts the shape. If the harness setup gets complex, defer the full `/state` roundtrip to e2e and keep this task as a focused serialize/deserialize round-trip check.

**Step 1: Write the test**

```ts
// tests/integration/score-breakdown.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { BreakdownRow } from "@/lib/types";

describe("breakdown_json round-trip", () => {
  test("JSON.stringify/parse preserves BreakdownRow shape", () => {
    const rows: BreakdownRow[] = [
      { kind: "match-winner", matchId: "m1", score: 10, maxPoints: 10 },
      { kind: "match-bonus", matchId: "m1", questionId: "q1", score: 0, maxPoints: 3 },
      { kind: "event-bonus", questionId: "eq1", score: 5, maxPoints: 5 },
      { kind: "match-surprise", matchId: "m1", entrantName: "Sting", score: 7, maxPoints: 7 },
    ];
    const serialized = JSON.stringify(rows);
    const parsed = JSON.parse(serialized) as BreakdownRow[];
    assert.deepEqual(parsed, rows);
  });
});
```

**Step 2: Run**

```bash
pnpm test:integration
```

Expected: PASS.

**Step 3: Commit**

```bash
git add tests/integration/score-breakdown.test.ts
git commit -m "test(integration): breakdown_json serialization round-trip"
```

---

## Task 12: `<ScoreBreakdown>` — desktop table

**Files:**
- Create: `components/pick-em/shared/score-breakdown.tsx`

**Step 1: Implement the component with the desktop table only (mobile follows in Task 13)**

```tsx
// components/pick-em/shared/score-breakdown.tsx
"use client";

import React from "react";

import type {
  BreakdownRow,
  LiveGameLeaderboardEntry,
} from "@/lib/types";
import type { ResolvedCard } from "@/lib/server/repositories/cards";

interface ScoreBreakdownProps {
  card: ResolvedCard;
  leaderboard: LiveGameLeaderboardEntry[];
  selectedNicknames: string[];
  meNickname: string | null;
}

interface CanonicalRow {
  key: string;
  label: string;
  order: number;
  scoresByNickname: Map<string, number>;
}

function rowKeyFor(row: BreakdownRow): string {
  switch (row.kind) {
    case "match-winner": return `match-winner:${row.matchId}`;
    case "match-bonus": return `match-bonus:${row.matchId}:${row.questionId}`;
    case "event-bonus": return `event-bonus:${row.questionId}`;
    case "match-surprise": return `match-surprise:${row.matchId}:${row.entrantName}`;
  }
}

function labelAndOrderFor(
  row: BreakdownRow,
  card: ResolvedCard,
): { label: string; order: number } {
  switch (row.kind) {
    case "match-winner": {
      const idx = card.matches.findIndex((m) => m.id === row.matchId);
      return { label: `Match ${idx + 1} Winner`, order: idx * 1000 };
    }
    case "match-surprise": {
      const idx = card.matches.findIndex((m) => m.id === row.matchId);
      return { label: `Match ${idx + 1} Surprise — ${row.entrantName}`, order: idx * 1000 + 100 };
    }
    case "match-bonus": {
      const idx = card.matches.findIndex((m) => m.id === row.matchId);
      const match = card.matches[idx];
      const q = match?.bonusQuestions.find((q) => q.id === row.questionId);
      const qIdx = match?.bonusQuestions.findIndex((q) => q.id === row.questionId) ?? 0;
      return { label: q?.question ?? "(unknown)", order: idx * 1000 + 200 + qIdx };
    }
    case "event-bonus": {
      const qIdx = card.eventBonusQuestions.findIndex((q) => q.id === row.questionId);
      const q = card.eventBonusQuestions[qIdx];
      return { label: q?.question ?? "(unknown)", order: 1_000_000 + qIdx };
    }
  }
}

function canonicalize(
  leaderboard: LiveGameLeaderboardEntry[],
  card: ResolvedCard,
): CanonicalRow[] {
  const map = new Map<string, CanonicalRow>();
  for (const entry of leaderboard) {
    for (const row of entry.breakdown.perQuestion) {
      const k = rowKeyFor(row);
      if (!map.has(k)) {
        const { label, order } = labelAndOrderFor(row, card);
        map.set(k, { key: k, label, order, scoresByNickname: new Map() });
      }
      map.get(k)!.scoresByNickname.set(entry.nickname, row.score);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.order - b.order);
}

function formatCell(score: number | undefined): string {
  if (score === undefined || score === 0) return "—";
  return `+${score}`;
}

function ScoreBreakdownInner({
  card,
  leaderboard,
  selectedNicknames,
  meNickname,
}: ScoreBreakdownProps) {
  const selected = leaderboard.filter((e) => selectedNicknames.includes(e.nickname));
  const rows = canonicalize(selected, card);

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Score breakdown will appear here as answers are revealed.
      </p>
    );
  }

  const columnHeader = (nickname: string) =>
    meNickname && nickname === meNickname ? "Me" : nickname;
  const totals = new Map<string, number>();
  for (const nick of selectedNicknames) {
    const entry = leaderboard.find((e) => e.nickname === nick);
    totals.set(nick, entry?.score ?? 0);
  }

  return (
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-semibold">
              Question
            </th>
            {selectedNicknames.map((nick) => (
              <th key={nick} className="px-3 py-2 text-right font-semibold">
                {columnHeader(nick)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border/40">
              <td className="sticky left-0 z-10 bg-card px-3 py-2">{row.label}</td>
              {selectedNicknames.map((nick) => (
                <td key={nick} className="px-3 py-2 text-right font-mono">
                  {formatCell(row.scoresByNickname.get(nick))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="sticky bottom-0 bg-card">
            <td className="sticky left-0 z-10 bg-card px-3 py-2 font-semibold">Total</td>
            {selectedNicknames.map((nick) => (
              <td key={nick} className="px-3 py-2 text-right font-mono font-semibold">
                {totals.get(nick) ?? 0}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export const ScoreBreakdown = React.memo(ScoreBreakdownInner);
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If `ResolvedCard` doesn't match up cleanly (server-only import into a client component), switch to a minimal structural interface in `lib/types.ts` shared between both surfaces.

**Step 3: Commit**

```bash
git add components/pick-em/shared/score-breakdown.tsx
git commit -m "feat(ui): add ScoreBreakdown desktop table"
```

---

## Task 13: `<ScoreBreakdown>` — mobile card list

**Files:**
- Modify: `components/pick-em/shared/score-breakdown.tsx`

**Step 1: Add a mobile-only render below the desktop table**

Append a `<div className="md:hidden">` block after the existing `<div className="hidden md:block ...">`:

```tsx
{/* Mobile: card list */}
<div className="md:hidden space-y-3">
  <div className="rounded-lg border border-border/70 bg-card/80 px-3 py-2">
    <div className="text-xs uppercase tracking-wide text-muted-foreground">Totals</div>
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {selectedNicknames.map((nick) => (
        <span key={nick} className="font-mono">
          {columnHeader(nick)}: <strong>{totals.get(nick) ?? 0}</strong>
        </span>
      ))}
    </div>
  </div>
  {rows.map((row) => (
    <div
      key={row.key}
      className="rounded-lg border border-border/70 bg-card/90 p-3 shadow-sm"
    >
      <div className="font-medium">{row.label}</div>
      <ul className="mt-2 space-y-1 text-sm">
        {selectedNicknames.map((nick) => (
          <li key={nick} className="flex items-center justify-between">
            <span className="text-muted-foreground">{columnHeader(nick)}</span>
            <span className="font-mono">{formatCell(row.scoresByNickname.get(nick))}</span>
          </li>
        ))}
      </ul>
    </div>
  ))}
</div>
```

Wrap both the desktop and mobile blocks in a single parent `<div>` so the component returns one element.

**Step 2: Visual check (manual)**

Ask the user to start `pnpm dev` and navigate to a `/play` page once the wire-up tasks (15-17) are done. You can't visually test this in isolation without wiring, so just confirm it type-checks here.

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add components/pick-em/shared/score-breakdown.tsx
git commit -m "feat(ui): add ScoreBreakdown mobile card list variant"
```

---

## Task 14: `LeaderboardPanel` — add `onRowToggle` / `selectedNicknames` props

**Files:**
- Modify: `components/pick-em/shared/leaderboard-panel.tsx`

**Step 1: Extend props + wire into compact variant only**

Update `LeaderboardPanelProps`:

```ts
interface LeaderboardPanelProps {
  leaderboard: LeaderboardEntry[];
  maxItems?: number;
  variant?: "display" | "compact";
  onRowToggle?: (nickname: string) => void;
  selectedNicknames?: string[];
}
```

In the compact-variant render (lines 89-127), wrap each row in a `<button>` when `onRowToggle` is provided:

```tsx
// Compact variant (player sidebar)
return (
  <div className="space-y-1">
    {entries.map((entry) => {
      const presence = getConnectionStatus(entry.lastSeenAt);
      const dotClass = /* existing */;
      const isSelected = selectedNicknames?.includes(entry.nickname) ?? false;
      const rowClass = `flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm transition-colors ${
        onRowToggle ? "cursor-pointer" : ""
      } ${
        isSelected
          ? "border-primary/60 bg-primary/10 ring-1 ring-primary/40"
          : "border-transparent"
      }`;

      const content = (
        <>
          <div className="min-w-0">
            <p className="truncate">
              #{entry.rank} {entry.nickname}
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${dotClass}`} />
              <span className="capitalize">{presence.state}</span>
              <span>{presence.ageLabel}</span>
            </div>
          </div>
          <div className="shrink-0">
            <span className="font-mono">{entry.score}</span>
          </div>
        </>
      );

      if (onRowToggle) {
        return (
          <button
            key={`${entry.rank}:${entry.nickname}`}
            type="button"
            onClick={() => onRowToggle(entry.nickname)}
            className={`${rowClass} w-full text-left`}
            aria-pressed={isSelected}
          >
            {content}
          </button>
        );
      }
      return (
        <div key={`${entry.rank}:${entry.nickname}`} className={rowClass}>
          {content}
        </div>
      );
    })}
    {entries.length === 0 ? (
      <p className="text-xs text-muted-foreground">
        Leaderboard appears after submissions.
      </p>
    ) : null}
  </div>
);
```

The `display` variant (lines 29-86) is untouched — TV surface stays read-only.

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add components/pick-em/shared/leaderboard-panel.tsx
git commit -m "feat(ui): add optional row-toggle props to LeaderboardPanel compact variant"
```

---

## Task 15: `<PlayerSubmittedView>` component

**Files:**
- Create: `components/pick-em/live-player/player-submitted-view.tsx`

**Step 1: Write the component**

```tsx
// components/pick-em/live-player/player-submitted-view.tsx
"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

import type { LiveGameStateResponse } from "@/lib/client/live-games-api";
import { LeaderboardPanel } from "@/components/pick-em/shared/leaderboard-panel";
import { ScoreBreakdown } from "@/components/pick-em/shared/score-breakdown";
import { UpdatesFeed } from "@/components/pick-em/shared/updates-feed"; // adjust if path differs

interface PlayerSubmittedViewProps {
  state: LiveGameStateResponse;
  meNickname: string | null;
  myRank: { rank: number; score: number } | null;
  onEdit: () => void;
}

function PlayerSubmittedViewInner({
  state,
  meNickname,
  myRank,
  onEdit,
}: PlayerSubmittedViewProps) {
  const initialSelected = useMemo(
    () => (meNickname ? [meNickname] : []),
    [meNickname],
  );
  const [selected, setSelected] = useState<string[]>(initialSelected);

  const toggle = (nickname: string) => {
    setSelected((prev) =>
      prev.includes(nickname)
        ? prev.filter((n) => n !== nickname)
        : [...prev, nickname],
    );
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <h2 className="font-heading text-2xl font-semibold uppercase tracking-wide">
          Submitted — Watching Live
        </h2>
        {myRank ? (
          <div className="mt-3 inline-flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-5 py-2">
            <span className="font-heading text-xl">#{myRank.rank}</span>
            <span className="text-muted-foreground">|</span>
            <span className="font-mono text-xl font-semibold">{myRank.score} pts</span>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-border/70 bg-card/90 p-4">
        <h3 className="mb-2 font-semibold">Leaderboard</h3>
        <LeaderboardPanel
          leaderboard={state.leaderboard}
          variant="compact"
          onRowToggle={toggle}
          selectedNicknames={selected}
        />
      </div>

      <div className="rounded-xl border border-border/70 bg-card/90 p-4">
        <h3 className="mb-2 font-semibold">Your Score Breakdown</h3>
        <ScoreBreakdown
          card={state.card}
          leaderboard={state.leaderboard}
          selectedNicknames={selected}
          meNickname={meNickname}
        />
      </div>

      <div className="flex justify-center">
        <Button type="button" onClick={onEdit} variant="secondary">
          Edit answers
        </Button>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/90 p-4">
        <h3 className="mb-2 font-semibold">Updates</h3>
        <UpdatesFeed events={state.events} maxItems={12} variant="compact" />
      </div>
    </div>
  );
}

export const PlayerSubmittedView = React.memo(PlayerSubmittedViewInner);
```

**Note:** verify the import path for `UpdatesFeed` — in the existing player-app it's imported as some local path; match whatever is there. Verify `Button` exists in `components/ui/button`.

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. Fix any path issues.

**Step 3: Commit**

```bash
git add components/pick-em/live-player/player-submitted-view.tsx
git commit -m "feat(ui): add PlayerSubmittedView component"
```

---

## Task 16: Wire `isEditing` flag + routing in `LiveGamePlayerApp`

**Files:**
- Modify: `components/pick-em/live-game-player-app.tsx` (around lines 57 + 757-826)

**Step 1: Add imports + state**

Near the existing `import { PlayerEndedView } ...` line:

```tsx
import { PlayerSubmittedView } from "./live-player/player-submitted-view";
```

Find the component's `useState` cluster (near the top of the exported function body) and add:

```tsx
const [isEditing, setIsEditing] = useState(false);
```

**Step 2: Replace the conditional render**

Locate the existing conditional at line 757:

```tsx
{state.game.status === "ended" ? (
  <PlayerEndedView ... />
) : (
  <>
    {/* existing pick UI */}
  </>
)}
```

Replace with:

```tsx
{state.game.status === "ended" ? (
  <PlayerEndedView
    state={state}
    myRank={myRank ? { rank: myRank.rank, score: myRank.score } : null}
  />
) : me?.player.isSubmitted && !isEditing ? (
  <PlayerSubmittedView
    state={state}
    meNickname={me?.player.nickname ?? null}
    myRank={myRank ? { rank: myRank.rank, score: myRank.score } : null}
    onEdit={() => setIsEditing(true)}
  />
) : (
  <>
    {state.card.matches.map(/* unchanged */)}
    <PlayerEventBonusPicks /* unchanged */ />
    <PlayerTiebreakerInput /* unchanged */ />
    <section className="grid gap-4 lg:grid-cols-2">
      {/* unchanged leaderboard + updates */}
    </section>
    {me?.player.isSubmitted ? (
      <div className="flex justify-center">
        <Button type="button" onClick={() => setIsEditing(false)} variant="secondary">
          Done editing
        </Button>
      </div>
    ) : null}
  </>
)}
```

(Verify the exact path to access `me.player.isSubmitted` — match how the existing code references it; look at line 180 and 269 which already use `nextMe.player.isSubmitted`.)

**Step 3: Type-check and visual smoke**

```bash
npx tsc --noEmit
```

Expected: no errors.

Ask the user to start `pnpm dev`, create/join a live game, submit picks, and verify: they land on the new submitted view; the Edit button returns them to the pick UI; the Done button returns them to the submitted view.

**Step 4: Commit**

```bash
git add components/pick-em/live-game-player-app.tsx
git commit -m "feat(live-game): route submitted-during-live players to new view with edit toggle"
```

---

## Task 17: `PlayerEndedView` — add breakdown + leaderboard toggle wiring

**Files:**
- Modify: `components/pick-em/live-player/player-ended-view.tsx`

**Step 1: Update component**

```tsx
"use client";

import React, { useMemo, useState } from "react";
import { Trophy } from "lucide-react";

import type { LiveGameStateResponse } from "@/lib/client/live-games-api";
import { LeaderboardPanel } from "@/components/pick-em/shared/leaderboard-panel";
import { ScoreBreakdown } from "@/components/pick-em/shared/score-breakdown";

interface PlayerEndedViewProps {
  state: LiveGameStateResponse;
  meNickname: string | null;
  myRank: { rank: number; score: number } | null;
}

function PlayerEndedViewInner({ state, meNickname, myRank }: PlayerEndedViewProps) {
  const initialSelected = useMemo(
    () => (meNickname ? [meNickname] : []),
    [meNickname],
  );
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const toggle = (nickname: string) =>
    setSelected((prev) =>
      prev.includes(nickname)
        ? prev.filter((n) => n !== nickname)
        : [...prev, nickname],
    );

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="text-center">
        <Trophy className="mx-auto h-12 w-12 text-primary" />
        <h2 className="mt-3 font-heading text-3xl font-semibold uppercase tracking-wide">
          Game Over
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.card.eventName || "Event"} has ended
        </p>
        {myRank ? (
          <div className="mt-4 inline-flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-6 py-3">
            <span className="font-heading text-2xl">#{myRank.rank}</span>
            <span className="text-muted-foreground">|</span>
            <span className="font-mono text-2xl font-semibold">{myRank.score} pts</span>
          </div>
        ) : null}
      </div>
      <div className="w-full rounded-xl border border-border/70 bg-card/90 p-4 shadow-lg shadow-black/20 backdrop-blur">
        <h3 className="mb-2 font-semibold">Final Leaderboard</h3>
        <LeaderboardPanel
          leaderboard={state.leaderboard}
          variant="compact"
          onRowToggle={toggle}
          selectedNicknames={selected}
        />
      </div>
      <div className="w-full rounded-xl border border-border/70 bg-card/90 p-4 shadow-lg shadow-black/20 backdrop-blur">
        <h3 className="mb-2 font-semibold">Score Breakdown</h3>
        <ScoreBreakdown
          card={state.card}
          leaderboard={state.leaderboard}
          selectedNicknames={selected}
          meNickname={meNickname}
        />
      </div>
    </div>
  );
}

export const PlayerEndedView = React.memo(PlayerEndedViewInner);
```

**Step 2: Update the caller at `live-game-player-app.tsx`**

Pass `meNickname` to `<PlayerEndedView>`:

```tsx
<PlayerEndedView
  state={state}
  meNickname={me?.player.nickname ?? null}
  myRank={myRank ? { rank: myRank.rank, score: myRank.score } : null}
/>
```

**Step 3: Type-check + manual verify**

```bash
npx tsc --noEmit
```

Expected: no errors.

Manual: user ends a live game (via host) and verifies the player ended view now shows the breakdown below the leaderboard, with row-toggle adding/removing columns.

**Step 4: Commit**

```bash
git add components/pick-em/live-player/player-ended-view.tsx components/pick-em/live-game-player-app.tsx
git commit -m "feat(ended-view): add per-question breakdown with leaderboard toggle"
```

---

## Task 18: Final check — lint, all tests, build

**Files:** none modified.

**Step 1: Run all tests + lint + build**

```bash
pnpm lint
pnpm test
pnpm build
```

Expected: all green.

**Step 2: If any red**

Fix forward (do not skip hooks). Create follow-up commits per fix.

**Step 3: Final commit**

Nothing to commit if everything was clean. If fixes were needed, commit them with descriptive messages and re-run the full green gauntlet before declaring done.

---

## Out of scope (do not add)

- Override-accepted badges in the breakdown UI.
- Tiebreaker row.
- URL-param comparison sharing.
- Hard cap on selected players.
- TV display variant changes.
- An un-submit endpoint.

## Files touched (summary)

| Purpose | File | Status |
|---|---|---|
| Migration | `migrations/0025_score_snapshot_breakdown.ts` | new |
| Generated types | `lib/server/db/generated.ts` | regen |
| Domain types | `lib/types.ts` | modify |
| Scoring orchestration | `lib/server/repositories/live-games.ts` | modify |
| Breakdown UI | `components/pick-em/shared/score-breakdown.tsx` | new |
| Leaderboard panel | `components/pick-em/shared/leaderboard-panel.tsx` | modify |
| Player submitted view | `components/pick-em/live-player/player-submitted-view.tsx` | new |
| Player ended view | `components/pick-em/live-player/player-ended-view.tsx` | modify |
| Player app routing | `components/pick-em/live-game-player-app.tsx` | modify |
| Unit tests | `tests/unit/lib/live-games/compute-leaderboard.test.ts` | new |
| Integration tests | `tests/integration/score-breakdown.test.ts` | new |
