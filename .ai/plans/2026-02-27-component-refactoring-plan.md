# Component Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate ~4,000-5,000 lines of duplication across 14 feature components by extracting shared utilities, hooks, and UI components using bottom-up extraction.

**Architecture:** Extract in layers — pure utility functions first (no React), then custom hooks (React state logic), then shared UI components (JSX), and finally rewrite the mega-components to compose from the extracted pieces. Each layer depends only on layers below it.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Radix UI, Lucide Icons, Sonner (toast). Tests use Node's built-in `node:test` runner with `node:assert/strict`. Path alias: `@/*` maps to project root.

---

## Task 1: Extract timer-utils.ts

**Files:**
- Create: `lib/pick-em/timer-utils.ts`
- Create: `tests/unit/lib/pick-em/timer-utils.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/lib/pick-em/timer-utils.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatDuration,
  getTimerElapsedMs,
  nowIso,
  nowMs,
  toMatchTimerId,
  toMatchBonusTimerId,
  toEventBonusTimerId,
  isMatchTimerId,
  isMatchBonusTimerId,
  isEventBonusTimerId,
  isSystemTimerId,
} from "@/lib/pick-em/timer-utils";

import type { LiveKeyTimer } from "@/lib/types";

describe("formatDuration", () => {
  test("formats zero milliseconds as 00:00", () => {
    assert.equal(formatDuration(0), "00:00");
  });

  test("formats seconds only", () => {
    assert.equal(formatDuration(5_000), "00:05");
    assert.equal(formatDuration(59_000), "00:59");
  });

  test("formats minutes and seconds", () => {
    assert.equal(formatDuration(61_000), "01:01");
    assert.equal(formatDuration(600_000), "10:00");
  });

  test("formats hours when >= 3600s", () => {
    assert.equal(formatDuration(3_600_000), "1:00:00");
    assert.equal(formatDuration(3_661_000), "1:01:01");
  });

  test("clamps negative values to 00:00", () => {
    assert.equal(formatDuration(-1_000), "00:00");
  });
});

describe("getTimerElapsedMs", () => {
  test("returns elapsedMs when timer is not running", () => {
    const timer: LiveKeyTimer = {
      id: "test",
      label: "Test",
      elapsedMs: 5000,
      isRunning: false,
      startedAt: null,
    };
    assert.equal(getTimerElapsedMs(timer, Date.now()), 5000);
  });

  test("returns elapsedMs when startedAt is null", () => {
    const timer: LiveKeyTimer = {
      id: "test",
      label: "Test",
      elapsedMs: 5000,
      isRunning: true,
      startedAt: null,
    };
    assert.equal(getTimerElapsedMs(timer, Date.now()), 5000);
  });

  test("adds running time to elapsedMs", () => {
    const startedAt = new Date("2025-01-01T00:00:00Z");
    const referenceNow = startedAt.getTime() + 3000;
    const timer: LiveKeyTimer = {
      id: "test",
      label: "Test",
      elapsedMs: 1000,
      isRunning: true,
      startedAt: startedAt.toISOString(),
    };
    assert.equal(getTimerElapsedMs(timer, referenceNow), 4000);
  });

  test("returns elapsedMs for invalid startedAt", () => {
    const timer: LiveKeyTimer = {
      id: "test",
      label: "Test",
      elapsedMs: 2000,
      isRunning: true,
      startedAt: "not-a-date",
    };
    assert.equal(getTimerElapsedMs(timer, Date.now()), 2000);
  });

  test("clamps to zero when reference is before startedAt", () => {
    const startedAt = new Date("2025-01-01T00:00:10Z");
    const referenceNow = new Date("2025-01-01T00:00:00Z").getTime();
    const timer: LiveKeyTimer = {
      id: "test",
      label: "Test",
      elapsedMs: 0,
      isRunning: true,
      startedAt: startedAt.toISOString(),
    };
    assert.equal(getTimerElapsedMs(timer, referenceNow), 0);
  });
});

describe("nowIso", () => {
  test("returns a valid ISO string", () => {
    const result = nowIso();
    assert.ok(!Number.isNaN(Date.parse(result)));
  });
});

describe("nowMs", () => {
  test("returns a number close to Date.now()", () => {
    const before = Date.now();
    const result = nowMs();
    const after = Date.now();
    assert.ok(result >= before && result <= after);
  });
});

describe("timer ID helpers", () => {
  test("toMatchTimerId creates correct ID", () => {
    assert.equal(toMatchTimerId("m1"), "match:m1");
  });

  test("toMatchBonusTimerId creates correct ID", () => {
    assert.equal(toMatchBonusTimerId("m1", "q1"), "match-bonus:m1:q1");
  });

  test("toEventBonusTimerId creates correct ID", () => {
    assert.equal(toEventBonusTimerId("q1"), "event-bonus:q1");
  });

  test("isMatchTimerId identifies match timer IDs", () => {
    assert.equal(isMatchTimerId("match:m1"), true);
    assert.equal(isMatchTimerId("match-bonus:m1:q1"), false);
    assert.equal(isMatchTimerId("custom:c1"), false);
  });

  test("isMatchBonusTimerId identifies match bonus timer IDs", () => {
    assert.equal(isMatchBonusTimerId("match-bonus:m1:q1"), true);
    assert.equal(isMatchBonusTimerId("match:m1"), false);
  });

  test("isEventBonusTimerId identifies event bonus timer IDs", () => {
    assert.equal(isEventBonusTimerId("event-bonus:q1"), true);
    assert.equal(isEventBonusTimerId("match:m1"), false);
  });

  test("isSystemTimerId returns true for all system IDs", () => {
    assert.equal(isSystemTimerId("match:m1"), true);
    assert.equal(isSystemTimerId("match-bonus:m1:q1"), true);
    assert.equal(isSystemTimerId("event-bonus:q1"), true);
    assert.equal(isSystemTimerId("custom:c1"), false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:unit`
Expected: FAIL — module `@/lib/pick-em/timer-utils` does not exist

**Step 3: Write the implementation**

```typescript
// lib/pick-em/timer-utils.ts
import type { LiveKeyTimer } from "@/lib/types";

const MATCH_TIMER_PREFIX = "match:";
const MATCH_BONUS_TIMER_PREFIX = "match-bonus:";
const EVENT_BONUS_TIMER_PREFIX = "event-bonus:";

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getTimerElapsedMs(
  timer: LiveKeyTimer,
  referenceNowMs: number,
): number {
  if (!timer.isRunning || !timer.startedAt) {
    return timer.elapsedMs;
  }

  const startedAtMs = new Date(timer.startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return timer.elapsedMs;
  }

  return Math.max(0, timer.elapsedMs + (referenceNowMs - startedAtMs));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function nowMs(): number {
  return Date.now();
}

export function toMatchTimerId(matchId: string): string {
  return `${MATCH_TIMER_PREFIX}${matchId}`;
}

export function toMatchBonusTimerId(
  matchId: string,
  questionId: string,
): string {
  return `${MATCH_BONUS_TIMER_PREFIX}${matchId}:${questionId}`;
}

export function toEventBonusTimerId(questionId: string): string {
  return `${EVENT_BONUS_TIMER_PREFIX}${questionId}`;
}

export function isMatchTimerId(timerId: string): boolean {
  return timerId.startsWith(MATCH_TIMER_PREFIX);
}

export function isMatchBonusTimerId(timerId: string): boolean {
  return timerId.startsWith(MATCH_BONUS_TIMER_PREFIX);
}

export function isEventBonusTimerId(timerId: string): boolean {
  return timerId.startsWith(EVENT_BONUS_TIMER_PREFIX);
}

export function isSystemTimerId(timerId: string): boolean {
  return (
    isMatchTimerId(timerId) ||
    isMatchBonusTimerId(timerId) ||
    isEventBonusTimerId(timerId)
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test:unit`
Expected: All timer-utils tests PASS

**Step 5: Commit**

```bash
git add lib/pick-em/timer-utils.ts tests/unit/lib/pick-em/timer-utils.test.ts
git commit -m "refactor: extract timer-utils from duplicated functions across 4 components"
```

---

## Task 2: Extract text-utils.ts

**Files:**
- Create: `lib/pick-em/text-utils.ts`
- Create: `tests/unit/lib/pick-em/text-utils.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/lib/pick-em/text-utils.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  filterRosterMemberSuggestions,
  normalizeText,
  formatEventTypeLabel,
} from "@/lib/pick-em/text-utils";

describe("filterRosterMemberSuggestions", () => {
  const candidates = [
    "Cody Rhodes",
    "Roman Reigns",
    "Seth Rollins",
    "Rhea Ripley",
    "Bianca Belair",
  ];

  test("returns empty array for empty input", () => {
    assert.deepEqual(filterRosterMemberSuggestions("", candidates), []);
  });

  test("returns empty array for whitespace-only input", () => {
    assert.deepEqual(filterRosterMemberSuggestions("   ", candidates), []);
  });

  test("filters by case-insensitive substring match", () => {
    const result = filterRosterMemberSuggestions("rh", candidates);
    assert.deepEqual(result, ["Cody Rhodes", "Rhea Ripley"]);
  });

  test("deduplicates case-insensitively", () => {
    const dupes = ["Cody Rhodes", "cody rhodes", "CODY RHODES"];
    const result = filterRosterMemberSuggestions("cody", dupes);
    assert.equal(result.length, 1);
  });

  test("limits results to 8", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Wrestler ${i}`);
    const result = filterRosterMemberSuggestions("Wrestler", many);
    assert.equal(result.length, 8);
  });

  test("skips empty candidates", () => {
    const result = filterRosterMemberSuggestions("test", ["", "  ", "test1"]);
    assert.deepEqual(result, ["test1"]);
  });
});

describe("normalizeText", () => {
  test("trims whitespace", () => {
    assert.equal(normalizeText("  hello  "), "hello");
  });

  test("collapses multiple spaces", () => {
    assert.equal(normalizeText("hello   world"), "hello world");
  });

  test("lowercases", () => {
    assert.equal(normalizeText("Hello World"), "hello world");
  });

  test("handles all transformations together", () => {
    assert.equal(normalizeText("  Hello   World  "), "hello world");
  });
});

describe("formatEventTypeLabel", () => {
  test("maps bonus types", () => {
    assert.equal(formatEventTypeLabel("match_bonus"), "Bonus Question");
    assert.equal(formatEventTypeLabel("event_bonus"), "Bonus Question");
  });

  test("maps result types", () => {
    assert.equal(formatEventTypeLabel("match_result"), "Match Result");
  });

  test("maps tiebreaker types", () => {
    assert.equal(formatEventTypeLabel("tiebreaker_update"), "Tiebreaker");
  });

  test("falls back to cleaned string", () => {
    assert.equal(formatEventTypeLabel("custom_event"), "custom event");
    assert.equal(formatEventTypeLabel("some-thing"), "some thing");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:unit`
Expected: FAIL — module `@/lib/pick-em/text-utils` does not exist

**Step 3: Write the implementation**

```typescript
// lib/pick-em/text-utils.ts
export function filterRosterMemberSuggestions(
  input: string,
  candidates: string[],
): string[] {
  const normalizedInput = input.trim().toLowerCase();
  if (!normalizedInput) return [];

  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;

    const normalizedCandidate = trimmed.toLowerCase();
    if (!normalizedCandidate.includes(normalizedInput)) continue;
    if (seen.has(normalizedCandidate)) continue;

    seen.add(normalizedCandidate);
    deduped.push(trimmed);

    if (deduped.length >= 8) {
      break;
    }
  }

  return deduped;
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function formatEventTypeLabel(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes("bonus")) return "Bonus Question";
  if (normalized.includes("result")) return "Match Result";
  if (normalized.includes("tiebreaker")) return "Tiebreaker";
  return type.replace(/[_-]/g, " ");
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test:unit`
Expected: All text-utils tests PASS

**Step 5: Commit**

```bash
git add lib/pick-em/text-utils.ts tests/unit/lib/pick-em/text-utils.test.ts
git commit -m "refactor: extract text-utils from 3 components (roster filter, normalize, event labels)"
```

---

## Task 3: Extract leaderboard-utils.ts

**Files:**
- Create: `lib/pick-em/leaderboard-utils.ts`
- Create: `tests/unit/lib/pick-em/leaderboard-utils.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/lib/pick-em/leaderboard-utils.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  hasLeaderboardChanged,
  buildBubbleSortSteps,
} from "@/lib/pick-em/leaderboard-utils";

import type { LiveGameLeaderboardEntry } from "@/lib/types";

function makeEntry(
  nickname: string,
  rank: number,
  score: number,
): LiveGameLeaderboardEntry {
  return {
    nickname,
    rank,
    score,
    breakdown: { winnerPoints: 0, bonusPoints: 0, surprisePoints: 0 },
    isSubmitted: true,
    lastUpdatedAt: "2025-01-01T00:00:00Z",
    lastSeenAt: "2025-01-01T00:00:00Z",
  };
}

describe("hasLeaderboardChanged", () => {
  test("returns false for identical leaderboards", () => {
    const state = {
      leaderboard: [makeEntry("A", 1, 10), makeEntry("B", 2, 5)],
    };
    assert.equal(
      hasLeaderboardChanged(state as never, state as never),
      false,
    );
  });

  test("returns true when length changes", () => {
    const previous = { leaderboard: [makeEntry("A", 1, 10)] };
    const next = {
      leaderboard: [makeEntry("A", 1, 10), makeEntry("B", 2, 5)],
    };
    assert.equal(
      hasLeaderboardChanged(previous as never, next as never),
      true,
    );
  });

  test("returns true when nickname changes", () => {
    const previous = { leaderboard: [makeEntry("A", 1, 10)] };
    const next = { leaderboard: [makeEntry("B", 1, 10)] };
    assert.equal(
      hasLeaderboardChanged(previous as never, next as never),
      true,
    );
  });

  test("returns true when rank changes", () => {
    const previous = { leaderboard: [makeEntry("A", 1, 10)] };
    const next = { leaderboard: [makeEntry("A", 2, 10)] };
    assert.equal(
      hasLeaderboardChanged(previous as never, next as never),
      true,
    );
  });

  test("returns true when score changes", () => {
    const previous = { leaderboard: [makeEntry("A", 1, 10)] };
    const next = { leaderboard: [makeEntry("A", 1, 20)] };
    assert.equal(
      hasLeaderboardChanged(previous as never, next as never),
      true,
    );
  });
});

describe("buildBubbleSortSteps", () => {
  test("returns single step for identical lists", () => {
    const result = buildBubbleSortSteps(["A", "B", "C"], ["A", "B", "C"]);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], ["A", "B", "C"]);
  });

  test("returns steps for a simple swap", () => {
    const result = buildBubbleSortSteps(["A", "B"], ["B", "A"]);
    assert.ok(result.length >= 2);
    assert.deepEqual(result[result.length - 1], ["B", "A"]);
  });

  test("handles new entries not in previous", () => {
    const result = buildBubbleSortSteps(["A"], ["A", "B"]);
    assert.deepEqual(result[result.length - 1], ["A", "B"]);
  });

  test("handles removed entries", () => {
    const result = buildBubbleSortSteps(["A", "B", "C"], ["A", "C"]);
    assert.deepEqual(result[result.length - 1], ["A", "C"]);
  });

  test("returns empty-array step for empty inputs", () => {
    const result = buildBubbleSortSteps([], []);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], []);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:unit`
Expected: FAIL — module `@/lib/pick-em/leaderboard-utils` does not exist

**Step 3: Write the implementation**

```typescript
// lib/pick-em/leaderboard-utils.ts
import type { LiveGameLeaderboardEntry } from "@/lib/types";

interface LeaderboardState {
  leaderboard: LiveGameLeaderboardEntry[];
}

export function hasLeaderboardChanged(
  previous: LeaderboardState,
  next: LeaderboardState,
): boolean {
  if (previous.leaderboard.length !== next.leaderboard.length) return true;
  for (let index = 0; index < next.leaderboard.length; index += 1) {
    const prior = previous.leaderboard[index];
    const current = next.leaderboard[index];
    if (!prior || !current) return true;
    if (prior.nickname !== current.nickname) return true;
    if (prior.rank !== current.rank) return true;
    if (prior.score !== current.score) return true;
  }
  return false;
}

export function buildBubbleSortSteps(
  previous: string[],
  current: string[],
): string[][] {
  const currentSet = new Set(current);
  const start = [
    ...previous.filter((name) => currentSet.has(name)),
    ...current.filter((name) => !previous.includes(name)),
  ];
  const steps: string[][] = [start];
  const working = [...start];
  const targetIndex = new Map(current.map((name, index) => [name, index]));

  for (let outer = 0; outer < working.length; outer += 1) {
    let swapped = false;
    for (let inner = 0; inner < working.length - 1; inner += 1) {
      const left = working[inner];
      const right = working[inner + 1];
      if (
        (targetIndex.get(left) ?? Infinity) <=
        (targetIndex.get(right) ?? Infinity)
      )
        continue;
      working[inner] = right;
      working[inner + 1] = left;
      steps.push([...working]);
      swapped = true;
    }
    if (!swapped) break;
  }

  const finalOrder = steps[steps.length - 1];
  if (
    finalOrder.length !== current.length ||
    finalOrder.some((name, index) => name !== current[index])
  ) {
    steps.push([...current]);
  }

  return steps;
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test:unit`
Expected: All leaderboard-utils tests PASS

**Step 5: Commit**

```bash
git add lib/pick-em/leaderboard-utils.ts tests/unit/lib/pick-em/leaderboard-utils.test.ts
git commit -m "refactor: extract leaderboard-utils from player and display components"
```

---

## Task 4: Extract payload-utils.ts

**Files:**
- Create: `lib/pick-em/payload-utils.ts`
- Create: `tests/unit/lib/pick-em/payload-utils.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/lib/pick-em/payload-utils.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  findMatchResult,
  findAnswer,
  toLockKey,
  snapshotPayload,
  updateMatchWinner,
  addBattleRoyalEntrant,
  removeBattleRoyalEntrant,
  setBattleRoyalEntryOrder,
  updateMatchBonusAnswer,
  updateEventBonusAnswer,
} from "@/lib/pick-em/payload-utils";

import type { CardLiveKeyPayload, LiveKeyMatchResult } from "@/lib/types";

function emptyPayload(): CardLiveKeyPayload {
  return {
    timers: [],
    matchResults: [],
    eventBonusAnswers: [],
    tiebreakerAnswer: "",
    tiebreakerRecordedAt: null,
    tiebreakerTimerId: null,
    scoreOverrides: [],
    winnerOverrides: [],
  };
}

describe("findMatchResult", () => {
  test("returns the matching result", () => {
    const payload = emptyPayload();
    const result: LiveKeyMatchResult = {
      matchId: "m1",
      winnerName: "Cody",
      winnerRecordedAt: null,
      battleRoyalEntryOrder: [],
      bonusAnswers: [],
    };
    payload.matchResults = [result];
    assert.deepEqual(findMatchResult(payload, "m1"), result);
  });

  test("returns undefined for missing match", () => {
    assert.equal(findMatchResult(emptyPayload(), "m1"), undefined);
  });
});

describe("findAnswer", () => {
  test("returns the matching answer", () => {
    const answers = [
      { questionId: "q1", answer: "yes", recordedAt: null, timerId: null },
    ];
    assert.deepEqual(findAnswer(answers, "q1"), answers[0]);
  });

  test("returns undefined for missing answer", () => {
    assert.equal(findAnswer([], "q1"), undefined);
  });
});

describe("toLockKey", () => {
  test("builds match:question key", () => {
    assert.equal(toLockKey("m1", "q1"), "m1:q1");
  });
});

describe("snapshotPayload", () => {
  test("returns JSON string", () => {
    const payload = emptyPayload();
    const snapshot = snapshotPayload(payload);
    assert.equal(typeof snapshot, "string");
    assert.deepEqual(JSON.parse(snapshot), payload);
  });
});

describe("updateMatchWinner", () => {
  test("creates new result when match not found", () => {
    const payload = emptyPayload();
    const next = updateMatchWinner(payload, "m1", "Cody");
    assert.equal(next.matchResults.length, 1);
    assert.equal(next.matchResults[0].matchId, "m1");
    assert.equal(next.matchResults[0].winnerName, "Cody");
    assert.ok(next.matchResults[0].winnerRecordedAt);
  });

  test("updates existing result", () => {
    const payload = emptyPayload();
    payload.matchResults = [
      {
        matchId: "m1",
        winnerName: "Old",
        winnerRecordedAt: null,
        battleRoyalEntryOrder: [],
        bonusAnswers: [],
      },
    ];
    const next = updateMatchWinner(payload, "m1", "New");
    assert.equal(next.matchResults.length, 1);
    assert.equal(next.matchResults[0].winnerName, "New");
  });

  test("clears recordedAt when winnerName is empty", () => {
    const payload = emptyPayload();
    const next = updateMatchWinner(payload, "m1", "");
    assert.equal(next.matchResults[0].winnerRecordedAt, null);
  });

  test("does not mutate original payload", () => {
    const payload = emptyPayload();
    updateMatchWinner(payload, "m1", "Cody");
    assert.equal(payload.matchResults.length, 0);
  });
});

describe("addBattleRoyalEntrant", () => {
  test("adds entrant to new match result", () => {
    const next = addBattleRoyalEntrant(emptyPayload(), "m1", "Wrestler A");
    const result = findMatchResult(next, "m1");
    assert.deepEqual(result?.battleRoyalEntryOrder, ["Wrestler A"]);
  });

  test("appends entrant to existing list", () => {
    const payload = emptyPayload();
    payload.matchResults = [
      {
        matchId: "m1",
        winnerName: "",
        winnerRecordedAt: null,
        battleRoyalEntryOrder: ["A"],
        bonusAnswers: [],
      },
    ];
    const next = addBattleRoyalEntrant(payload, "m1", "B");
    assert.deepEqual(findMatchResult(next, "m1")?.battleRoyalEntryOrder, [
      "A",
      "B",
    ]);
  });
});

describe("removeBattleRoyalEntrant", () => {
  test("removes entrant by index", () => {
    const payload = emptyPayload();
    payload.matchResults = [
      {
        matchId: "m1",
        winnerName: "",
        winnerRecordedAt: null,
        battleRoyalEntryOrder: ["A", "B", "C"],
        bonusAnswers: [],
      },
    ];
    const next = removeBattleRoyalEntrant(payload, "m1", 1);
    assert.deepEqual(findMatchResult(next, "m1")?.battleRoyalEntryOrder, [
      "A",
      "C",
    ]);
  });
});

describe("setBattleRoyalEntryOrder", () => {
  test("replaces entry order", () => {
    const payload = emptyPayload();
    const next = setBattleRoyalEntryOrder(payload, "m1", ["C", "B", "A"]);
    assert.deepEqual(findMatchResult(next, "m1")?.battleRoyalEntryOrder, [
      "C",
      "B",
      "A",
    ]);
  });
});

describe("updateMatchBonusAnswer", () => {
  test("adds answer to new match result", () => {
    const next = updateMatchBonusAnswer(
      emptyPayload(),
      "m1",
      "q1",
      "yes",
      false,
    );
    const result = findMatchResult(next, "m1");
    assert.equal(result?.bonusAnswers.length, 1);
    assert.equal(result?.bonusAnswers[0].answer, "yes");
  });

  test("updates existing answer", () => {
    const payload = emptyPayload();
    payload.matchResults = [
      {
        matchId: "m1",
        winnerName: "",
        winnerRecordedAt: null,
        battleRoyalEntryOrder: [],
        bonusAnswers: [
          { questionId: "q1", answer: "old", recordedAt: null, timerId: null },
        ],
      },
    ];
    const next = updateMatchBonusAnswer(payload, "m1", "q1", "new", false);
    assert.equal(findMatchResult(next, "m1")?.bonusAnswers[0].answer, "new");
  });
});

describe("updateEventBonusAnswer", () => {
  test("adds new event bonus answer", () => {
    const next = updateEventBonusAnswer(emptyPayload(), "q1", "answer", false);
    assert.equal(next.eventBonusAnswers.length, 1);
    assert.equal(next.eventBonusAnswers[0].answer, "answer");
  });

  test("updates existing event bonus answer", () => {
    const payload = emptyPayload();
    payload.eventBonusAnswers = [
      { questionId: "q1", answer: "old", recordedAt: null, timerId: null },
    ];
    const next = updateEventBonusAnswer(payload, "q1", "new", false);
    assert.equal(next.eventBonusAnswers.length, 1);
    assert.equal(next.eventBonusAnswers[0].answer, "new");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:unit`
Expected: FAIL — module `@/lib/pick-em/payload-utils` does not exist

**Step 3: Write the implementation**

```typescript
// lib/pick-em/payload-utils.ts
import type {
  CardLiveKeyPayload,
  LiveKeyAnswer,
  LiveKeyMatchResult,
} from "@/lib/types";
import { nowIso, toMatchBonusTimerId, toEventBonusTimerId } from "./timer-utils";

export function findMatchResult(
  payload: CardLiveKeyPayload,
  matchId: string,
): LiveKeyMatchResult | undefined {
  return payload.matchResults.find((result) => result.matchId === matchId);
}

export function findAnswer(
  answers: { questionId: string; answer: string }[],
  questionId: string,
): (typeof answers)[number] | undefined {
  return answers.find((answer) => answer.questionId === questionId);
}

export function toLockKey(matchId: string, questionId: string): string {
  return `${matchId}:${questionId}`;
}

export function snapshotPayload(payload: CardLiveKeyPayload): string {
  return JSON.stringify(payload);
}

function ensureMatchResult(
  payload: CardLiveKeyPayload,
  matchId: string,
): { results: LiveKeyMatchResult[]; index: number } {
  const results = [...payload.matchResults];
  let index = results.findIndex((result) => result.matchId === matchId);

  if (index === -1) {
    results.push({
      matchId,
      winnerName: "",
      winnerRecordedAt: null,
      battleRoyalEntryOrder: [],
      bonusAnswers: [],
    });
    index = results.length - 1;
  }

  return { results, index };
}

export function updateMatchWinner(
  payload: CardLiveKeyPayload,
  matchId: string,
  winnerName: string,
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  results[index] = {
    ...results[index],
    winnerName,
    winnerRecordedAt: winnerName.trim() ? nowIso() : null,
  };
  return { ...payload, matchResults: results };
}

export function addBattleRoyalEntrant(
  payload: CardLiveKeyPayload,
  matchId: string,
  entrantName: string,
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  results[index] = {
    ...results[index],
    battleRoyalEntryOrder: [
      ...results[index].battleRoyalEntryOrder,
      entrantName,
    ],
  };
  return { ...payload, matchResults: results };
}

export function removeBattleRoyalEntrant(
  payload: CardLiveKeyPayload,
  matchId: string,
  entryIndex: number,
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  results[index] = {
    ...results[index],
    battleRoyalEntryOrder: results[index].battleRoyalEntryOrder.filter(
      (_, i) => i !== entryIndex,
    ),
  };
  return { ...payload, matchResults: results };
}

export function setBattleRoyalEntryOrder(
  payload: CardLiveKeyPayload,
  matchId: string,
  entryOrder: string[],
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  results[index] = {
    ...results[index],
    battleRoyalEntryOrder: entryOrder,
  };
  return { ...payload, matchResults: results };
}

export function updateMatchBonusAnswer(
  payload: CardLiveKeyPayload,
  matchId: string,
  questionId: string,
  answer: string,
  isTimeBased: boolean,
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  const existingResult = results[index];
  const nextAnswers = [...existingResult.bonusAnswers];
  const existingAnswerIndex = nextAnswers.findIndex(
    (item) => item.questionId === questionId,
  );
  const existingAnswer =
    existingAnswerIndex === -1 ? undefined : nextAnswers[existingAnswerIndex];
  const recordedAt = isTimeBased && answer.trim() ? nowIso() : null;
  const timerId = isTimeBased
    ? (existingAnswer?.timerId ?? toMatchBonusTimerId(matchId, questionId))
    : null;

  const newAnswer: LiveKeyAnswer = { questionId, answer, recordedAt, timerId };
  if (existingAnswerIndex === -1) {
    nextAnswers.push(newAnswer);
  } else {
    nextAnswers[existingAnswerIndex] = newAnswer;
  }

  results[index] = { ...existingResult, bonusAnswers: nextAnswers };
  return { ...payload, matchResults: results };
}

export function updateEventBonusAnswer(
  payload: CardLiveKeyPayload,
  questionId: string,
  answer: string,
  isTimeBased: boolean,
): CardLiveKeyPayload {
  const nextAnswers = [...payload.eventBonusAnswers];
  const existingIndex = nextAnswers.findIndex(
    (item) => item.questionId === questionId,
  );
  const existingAnswer =
    existingIndex === -1 ? undefined : nextAnswers[existingIndex];
  const recordedAt = isTimeBased && answer.trim() ? nowIso() : null;
  const timerId = isTimeBased
    ? (existingAnswer?.timerId ?? toEventBonusTimerId(questionId))
    : null;

  const newAnswer: LiveKeyAnswer = { questionId, answer, recordedAt, timerId };
  if (existingIndex === -1) {
    nextAnswers.push(newAnswer);
  } else {
    nextAnswers[existingIndex] = newAnswer;
  }

  return { ...payload, eventBonusAnswers: nextAnswers };
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test:unit`
Expected: All payload-utils tests PASS

**Step 5: Commit**

```bash
git add lib/pick-em/payload-utils.ts tests/unit/lib/pick-em/payload-utils.test.ts
git commit -m "refactor: extract payload-utils with immutable updaters from 3 components"
```

---

## Task 5: Create use-timer-clock hook

**Files:**
- Create: `hooks/use-timer-clock.ts`

**Step 1: Write the implementation**

No test file needed for this hook — it's a thin wrapper around `setInterval` with React state. Testing hooks requires a React testing harness which isn't set up in this project. The behavior will be verified through the existing app functionality.

```typescript
// hooks/use-timer-clock.ts
"use client";

import { useEffect, useState } from "react";

/**
 * Maintains a millisecond clock that ticks at the given interval.
 * Only ticks when `enabled` is true. Returns `Date.now()` at each tick.
 */
export function useTimerClock(
  intervalMs: number = 300,
  enabled: boolean = true,
): number {
  const [currentTimeMs, setCurrentTimeMs] = useState(Date.now());

  useEffect(() => {
    if (!enabled) return;

    const intervalId = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [intervalMs, enabled]);

  return currentTimeMs;
}
```

**Step 2: Commit**

```bash
git add hooks/use-timer-clock.ts
git commit -m "refactor: extract use-timer-clock hook from 4 components"
```

---

## Task 6: Create use-roster-suggestions hook

**Files:**
- Create: `hooks/use-roster-suggestions.ts`

**Step 1: Write the implementation**

```typescript
// hooks/use-roster-suggestions.ts
"use client";

import { useCallback, useEffect, useState } from "react";

import { getRosterSuggestions } from "@/lib/client/roster-api";
import { filterRosterMemberSuggestions } from "@/lib/pick-em/text-utils";

interface UseRosterSuggestionsOptions {
  promotionName: string | undefined | null;
}

interface UseRosterSuggestionsReturn {
  activeFieldKey: string | null;
  query: string;
  suggestions: string[];
  isLoading: boolean;
  setActiveInput: (fieldKey: string, value: string) => void;
  clearSuggestions: () => void;
  getFilteredSuggestions: (currentValue: string) => string[];
}

export function useRosterSuggestions({
  promotionName,
}: UseRosterSuggestionsOptions): UseRosterSuggestionsReturn {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [querySuggestions, setQuerySuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const trimmedPromotion = promotionName?.trim() ?? "";
    const trimmedQuery = query.trim();
    if (!trimmedPromotion || trimmedQuery.length < 2) {
      setQuerySuggestions([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      void getRosterSuggestions(trimmedPromotion, trimmedQuery)
        .then((response) => {
          if (cancelled) return;
          setQuerySuggestions(response.names);
        })
        .catch(() => {
          if (cancelled) return;
          setQuerySuggestions([]);
        })
        .finally(() => {
          if (cancelled) return;
          setIsLoading(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query, promotionName]);

  const setActiveInput = useCallback(
    (fieldKey: string, value: string) => {
      setActiveFieldKey(fieldKey);
      setQuery(value);
    },
    [],
  );

  const clearSuggestions = useCallback(() => {
    setActiveFieldKey(null);
    setQuery("");
  }, []);

  const getFilteredSuggestions = useCallback(
    (currentValue: string) => {
      return filterRosterMemberSuggestions(currentValue, querySuggestions);
    },
    [querySuggestions],
  );

  return {
    activeFieldKey,
    query,
    suggestions: querySuggestions,
    isLoading,
    setActiveInput,
    clearSuggestions,
    getFilteredSuggestions,
  };
}
```

**Step 2: Commit**

```bash
git add hooks/use-roster-suggestions.ts
git commit -m "refactor: extract use-roster-suggestions hook from 3 components"
```

---

## Task 7: Create use-fullscreen-effects hook

**Files:**
- Create: `hooks/use-fullscreen-effects.ts`

**Step 1: Write the implementation**

This hook needs to reference the `FullscreenEffect` type and `getFullscreenEffectDurationMs` function. Check how these are defined in the existing components first (they may be inline types), and extract them into the hook file or a shared types location.

Look at: `components/pick-em/live-game-player-app.tsx` around lines 30-100 for the `FullscreenEffect` type definition and `LEADERBOARD_SWAP_DURATION_MS` constant.

```typescript
// hooks/use-fullscreen-effects.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildBubbleSortSteps } from "@/lib/pick-em/leaderboard-utils";

// These types should be extracted from the existing component definitions.
// Check live-game-player-app.tsx and live-game-display-app.tsx for the exact
// FullscreenEffect type union and adjust as needed.

import type { LiveGameLeaderboardEntry } from "@/lib/types";

export interface FullscreenEventsEffect {
  kind: "events";
  events: { id: string; type: string; message: string }[];
}

export interface FullscreenLeaderboardEffect {
  kind: "leaderboard";
  previous: LiveGameLeaderboardEntry[];
  current: LiveGameLeaderboardEntry[];
  swapCount: number;
}

export type FullscreenEffect =
  | FullscreenEventsEffect
  | FullscreenLeaderboardEffect;

const LEADERBOARD_SWAP_DURATION_MS = 400;
const EVENT_EFFECT_DURATION_MS = 4_000;
const LEADERBOARD_EFFECT_BASE_DURATION_MS = 3_000;

function getFullscreenEffectDurationMs(effect: FullscreenEffect): number {
  if (effect.kind === "events") return EVENT_EFFECT_DURATION_MS;
  return (
    LEADERBOARD_EFFECT_BASE_DURATION_MS +
    effect.swapCount * LEADERBOARD_SWAP_DURATION_MS
  );
}

interface UseFullscreenEffectsReturn {
  activeEffect: FullscreenEffect | null;
  animatedLeaderboardOrder: string[];
  queueEffects: (effects: FullscreenEffect[]) => void;
  dismiss: () => void;
}

export function useFullscreenEffects(): UseFullscreenEffectsReturn {
  const [queue, setQueue] = useState<FullscreenEffect[]>([]);
  const [activeEffect, setActiveEffect] = useState<FullscreenEffect | null>(
    null,
  );
  const [animatedLeaderboardOrder, setAnimatedLeaderboardOrder] = useState<
    string[]
  >([]);

  const effectTimeoutRef = useRef<number | null>(null);
  const stepIntervalRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (effectTimeoutRef.current) {
      window.clearTimeout(effectTimeoutRef.current);
      effectTimeoutRef.current = null;
    }
    if (stepIntervalRef.current) {
      window.clearInterval(stepIntervalRef.current);
      stepIntervalRef.current = null;
    }
    setAnimatedLeaderboardOrder([]);
    setActiveEffect(null);
  }, []);

  const queueEffects = useCallback((effects: FullscreenEffect[]) => {
    if (effects.length === 0) return;
    setQueue((previous) => [...previous, ...effects]);
  }, []);

  // Process queue
  useEffect(() => {
    if (activeEffect || queue.length === 0) return;

    const [nextEffect, ...remaining] = queue;
    setQueue(remaining);
    setActiveEffect(nextEffect);

    if (effectTimeoutRef.current) {
      window.clearTimeout(effectTimeoutRef.current);
    }
    effectTimeoutRef.current = window.setTimeout(() => {
      setActiveEffect(null);
    }, getFullscreenEffectDurationMs(nextEffect));
  }, [activeEffect, queue]);

  // Leaderboard animation
  useEffect(() => {
    if (stepIntervalRef.current) {
      window.clearInterval(stepIntervalRef.current);
      stepIntervalRef.current = null;
    }

    if (!activeEffect || activeEffect.kind !== "leaderboard") {
      setAnimatedLeaderboardOrder([]);
      return;
    }

    const steps = buildBubbleSortSteps(
      activeEffect.previous.map((entry) => entry.nickname),
      activeEffect.current.map((entry) => entry.nickname),
    );
    setAnimatedLeaderboardOrder(steps[0] ?? []);

    if (steps.length > 1) {
      let stepIndex = 0;
      stepIntervalRef.current = window.setInterval(() => {
        stepIndex += 1;
        if (stepIndex >= steps.length) {
          if (stepIntervalRef.current) {
            window.clearInterval(stepIntervalRef.current);
            stepIntervalRef.current = null;
          }
          return;
        }
        setAnimatedLeaderboardOrder(steps[stepIndex]);
      }, LEADERBOARD_SWAP_DURATION_MS);
    }

    return () => {
      if (stepIntervalRef.current) {
        window.clearInterval(stepIntervalRef.current);
        stepIntervalRef.current = null;
      }
    };
  }, [activeEffect]);

  return { activeEffect, animatedLeaderboardOrder, queueEffects, dismiss };
}
```

**Step 2: Commit**

```bash
git add hooks/use-fullscreen-effects.ts
git commit -m "refactor: extract use-fullscreen-effects hook from player and display components"
```

---

## Task 8: Create use-async-action hook

**Files:**
- Create: `hooks/use-async-action.ts`

**Step 1: Write the implementation**

```typescript
// hooks/use-async-action.ts
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

/**
 * Wraps an async action with loading state and error handling via toast.
 * Eliminates the repeated try/catch/finally + isLoading pattern.
 */
export function useAsyncAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>,
  fallbackMessage: string = "An error occurred",
): { execute: (...args: Args) => Promise<void>; isRunning: boolean } {
  const [isRunning, setIsRunning] = useState(false);

  const execute = useCallback(
    async (...args: Args) => {
      setIsRunning(true);
      try {
        await action(...args);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : fallbackMessage;
        toast.error(message);
      } finally {
        setIsRunning(false);
      }
    },
    [action, fallbackMessage],
  );

  return { execute, isRunning };
}
```

**Step 2: Commit**

```bash
git add hooks/use-async-action.ts
git commit -m "refactor: extract use-async-action hook from repeated async patterns"
```

---

## Task 9: Wire utilities into live-key-app.tsx

**Files:**
- Modify: `components/pick-em/live-key-app.tsx`

**Step 1: Replace inline utility functions with imports**

At the top of the file, add imports:
```typescript
import {
  formatDuration,
  getTimerElapsedMs,
  nowIso,
  nowMs,
  toMatchTimerId,
  toMatchBonusTimerId,
  toEventBonusTimerId,
  isMatchTimerId,
  isMatchBonusTimerId,
  isEventBonusTimerId,
  isSystemTimerId,
} from "@/lib/pick-em/timer-utils";
import {
  findMatchResult,
  findAnswer,
  snapshotPayload,
  updateMatchWinner,
  addBattleRoyalEntrant as addBattleRoyalEntrantPayload,
  removeBattleRoyalEntrant as removeBattleRoyalEntrantPayload,
  setBattleRoyalEntryOrder as setBattleRoyalEntryOrderPayload,
  updateMatchBonusAnswer,
  updateEventBonusAnswer,
} from "@/lib/pick-em/payload-utils";
import { filterRosterMemberSuggestions } from "@/lib/pick-em/text-utils";
```

Then delete the inline copies of these functions:
- Lines 41-44: MATCH_TIMER_PREFIX, MATCH_BONUS_TIMER_PREFIX, EVENT_BONUS_TIMER_PREFIX, CUSTOM_TIMER_PREFIX constants (keep CUSTOM_TIMER_PREFIX since it's only in this file)
- Lines 349-355: `nowIso`, `nowMs`
- Lines 357-359: `snapshotPayload`
- Lines 369-396: `filterRosterMemberSuggestions`
- Lines 419-431: `findMatchResult`, `findAnswer`
- Lines 433-463: Timer ID helpers (toMatchTimerId, etc.)
- Lines 465-489: `formatDuration`, `getTimerElapsedMs`

Replace the `useCallback` updaters (setMatchWinner, setBattleRoyalEntryOrder, etc.) with calls to the pure payload-utils functions inside their `setPayload` calls.

**Step 2: Replace timer clock state with use-timer-clock hook**

Replace the manual `useEffect` + `setInterval` for `currentTimeMs` with:
```typescript
import { useTimerClock } from "@/hooks/use-timer-clock";
// ...
const currentTimeMs = useTimerClock(300, hasRunningTimers);
```

Delete the `currentTimeMs` useState and the associated useEffect.

**Step 3: Replace roster suggestion state with use-roster-suggestions hook**

Replace the manual state management with:
```typescript
import { useRosterSuggestions } from "@/hooks/use-roster-suggestions";
// ...
const roster = useRosterSuggestions({ promotionName: card?.promotionName });
```

Delete the manual `activeRosterFieldKey`, `activeRosterQuery`, `querySuggestions`, `isLoadingQuerySuggestions` state declarations and the associated useEffect.

Update all references to use `roster.setActiveInput(...)`, `roster.getFilteredSuggestions(...)`, `roster.isLoading`, `roster.activeFieldKey`.

**Step 4: Verify the app builds**

Run: `npx next build`
Expected: Build succeeds with no TypeScript errors

**Step 5: Commit**

```bash
git add components/pick-em/live-key-app.tsx
git commit -m "refactor: wire shared utils and hooks into live-key-app"
```

---

## Task 10: Wire utilities into live-game-key-host-app.tsx

**Files:**
- Modify: `components/pick-em/live-game-key-host-app.tsx`

**Step 1: Replace inline utility functions with imports**

Same pattern as Task 9. Add imports from `@/lib/pick-em/timer-utils`, `@/lib/pick-em/payload-utils`, `@/lib/pick-em/text-utils`.

Delete the inline copies:
- Lines 54-55: `POLL_INTERVAL_MS`, `REFRESH_STALE_THRESHOLD_MS` (keep these as local constants since polling hook isn't integrated yet in this task)
- Lines 67-77: `normalizeText`, `nowIso`, `nowMs`
- Lines 95-122: `formatDuration`, `getTimerElapsedMs`
- Lines 150-195: Timer ensuring functions (adapt to use timer-utils)
- Lines 197-215: `findMatchResult`, `findAnswer`, `toLockKey`
- Lines 217-244: `filterRosterMemberSuggestions`
- Lines 246-248: `snapshotPayload`

**Step 2: Replace timer clock and roster hooks**

Same pattern as Task 9 — use `useTimerClock` and `useRosterSuggestions`.

**Step 3: Verify the app builds**

Run: `npx next build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add components/pick-em/live-game-key-host-app.tsx
git commit -m "refactor: wire shared utils and hooks into live-game-key-host-app"
```

---

## Task 11: Wire utilities into live-game-player-app.tsx

**Files:**
- Modify: `components/pick-em/live-game-player-app.tsx`

**Step 1: Replace inline functions with imports**

Add imports from `@/lib/pick-em/text-utils`, `@/lib/pick-em/leaderboard-utils`.

Delete:
- Lines 74-75: `POLL_INTERVAL_MS`, `REFRESH_STALE_THRESHOLD_MS`
- Lines 106-112: `formatEventTypeLabel`
- Lines 114-128: `hasLeaderboardChanged`
- Lines 130-170: `buildBubbleSortSteps`
- Lines 194-203: `findAnswer`, `toLockKey`
- Lines 205-232: `filterRosterMemberSuggestions`
- Lines 234-236: `normalizeForCompare`

**Step 2: Replace fullscreen effects with hook**

Replace the inline state management with:
```typescript
import { useFullscreenEffects } from "@/hooks/use-fullscreen-effects";
// ...
const { activeEffect, animatedLeaderboardOrder, queueEffects, dismiss } =
  useFullscreenEffects();
```

Delete the inline fullscreen effect state, refs, and useEffects (lines 257-357 approximately).

Update the `FullscreenEffect` type references to import from the hook.

**Step 3: Replace roster suggestions with hook**

Use `useRosterSuggestions` hook.

**Step 4: Verify the app builds**

Run: `npx next build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add components/pick-em/live-game-player-app.tsx
git commit -m "refactor: wire shared utils and hooks into live-game-player-app"
```

---

## Task 12: Wire utilities into live-game-display-app.tsx

**Files:**
- Modify: `components/pick-em/live-game-display-app.tsx`

**Step 1: Replace inline functions with imports**

Add imports from `@/lib/pick-em/text-utils`, `@/lib/pick-em/leaderboard-utils`.

Delete:
- Lines 37-38: `POLL_INTERVAL_MS`, `REFRESH_STALE_THRESHOLD_MS`
- Lines 75-81: `formatEventTypeLabel`
- Lines 83-97: `hasLeaderboardChanged`
- Lines 124-164: `buildBubbleSortSteps`

**Step 2: Replace fullscreen effects with hook**

Same as Task 11.

**Step 3: Verify the app builds**

Run: `npx next build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add components/pick-em/live-game-display-app.tsx
git commit -m "refactor: wire shared utils and hooks into live-game-display-app"
```

---

## Task 13: Create shared SectionCard component

**Files:**
- Create: `components/pick-em/shared/section-card.tsx`

**Step 1: Write the implementation**

```tsx
// components/pick-em/shared/section-card.tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className,
}: SectionCardProps) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-card p-4", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="font-semibold text-foreground">{title}</h2>
          {subtitle ? (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
```

**Step 2: Commit**

```bash
git add components/pick-em/shared/section-card.tsx
git commit -m "refactor: create shared SectionCard component"
```

---

## Task 14: Create shared TimerControls component

**Files:**
- Create: `components/pick-em/shared/timer-controls.tsx`

**Step 1: Write the implementation**

```tsx
// components/pick-em/shared/timer-controls.tsx
"use client";

import { Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LiveKeyTimer } from "@/lib/types";
import { formatDuration, getTimerElapsedMs } from "@/lib/pick-em/timer-utils";

interface TimerControlsProps {
  timer: LiveKeyTimer | undefined;
  currentTimeMs: number;
  onStart: (timerId: string) => void;
  onStop: (timerId: string) => void;
  onReset: (timerId: string) => void;
  label?: string;
  disabled?: boolean;
}

export function TimerControls({
  timer,
  currentTimeMs,
  onStart,
  onStop,
  onReset,
  label = "Timer",
  disabled = false,
}: TimerControlsProps) {
  const elapsedMs = timer
    ? getTimerElapsedMs(timer, currentTimeMs)
    : 0;

  return (
    <div className="rounded-md border border-border/70 bg-background/35 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-2xl text-foreground">
        {formatDuration(elapsedMs)}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() => {
            if (!timer) return;
            if (timer.isRunning) {
              onStop(timer.id);
            } else {
              onStart(timer.id);
            }
          }}
          disabled={disabled || !timer}
        >
          {timer?.isRunning ? (
            <Pause className="mr-1 h-4 w-4" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          {timer?.isRunning ? "Stop" : "Start"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => timer && onReset(timer.id)}
          disabled={disabled || !timer}
        >
          <RotateCcw className="mr-1 h-4 w-4" />
          Reset
        </Button>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/pick-em/shared/timer-controls.tsx
git commit -m "refactor: create shared TimerControls component"
```

---

## Task 15: Create shared RosterAutocompleteInput component

**Files:**
- Create: `components/pick-em/shared/roster-autocomplete-input.tsx`

**Step 1: Write the implementation**

```tsx
// components/pick-em/shared/roster-autocomplete-input.tsx
"use client";

import { Input } from "@/components/ui/input";

interface RosterAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  suggestions: string[];
  isLoadingSuggestions: boolean;
  activeFieldKey: string | null;
  fieldKey: string;
  onSelectSuggestion: (suggestion: string) => void;
}

export function RosterAutocompleteInput({
  value,
  onChange,
  onFocus,
  onKeyDown,
  placeholder = "Start typing a roster member...",
  readOnly = false,
  disabled = false,
  className,
  suggestions,
  isLoadingSuggestions,
  activeFieldKey,
  fieldKey,
  onSelectSuggestion,
}: RosterAutocompleteInputProps) {
  const isActive = activeFieldKey === fieldKey;
  const showSuggestions =
    (isActive && isLoadingSuggestions) || suggestions.length > 0;

  return (
    <div className={className}>
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        disabled={disabled}
      />
      {showSuggestions ? (
        <div className="mt-2 rounded-md border border-border/70 bg-background/35 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            {isActive && isLoadingSuggestions
              ? "Loading roster suggestions..."
              : "Autocomplete from promotion roster"}
          </p>
          {suggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onSelectSuggestion(suggestion)}
                  className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/pick-em/shared/roster-autocomplete-input.tsx
git commit -m "refactor: create shared RosterAutocompleteInput component"
```

---

## Task 16: Create shared BonusQuestionInput component

**Files:**
- Create: `components/pick-em/shared/bonus-question-input.tsx`

**Step 1: Write the implementation**

```tsx
// components/pick-em/shared/bonus-question-input.tsx
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BonusQuestion, LiveKeyAnswer } from "@/lib/types";

interface BonusQuestionInputProps {
  question: BonusQuestion;
  answer: LiveKeyAnswer | { questionId: string; answer: string } | undefined;
  onChange: (answer: string) => void;
  readOnly?: boolean;
  children?: React.ReactNode;
}

export function BonusQuestionInput({
  question,
  answer,
  onChange,
  readOnly = false,
  children,
}: BonusQuestionInputProps) {
  const currentAnswer = answer?.answer ?? "";

  return (
    <div className="rounded-md border border-border/70 bg-background/35 p-3">
      <Label>{question.question || "Bonus question"}</Label>
      <div className="mt-2 flex flex-col gap-2">
        {question.answerType === "multiple-choice" ? (
          <Select
            value={currentAnswer}
            onValueChange={onChange}
            disabled={readOnly}
          >
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Select option" />
            </SelectTrigger>
            <SelectContent>
              {question.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            placeholder={
              question.valueType === "rosterMember"
                ? "Start typing a roster member..."
                : "Record result"
            }
            value={currentAnswer}
            onChange={(event) => onChange(event.target.value)}
            readOnly={readOnly}
          />
        )}
        {children}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/pick-em/shared/bonus-question-input.tsx
git commit -m "refactor: create shared BonusQuestionInput component"
```

---

## Task 17: Wire shared UI components into live-key-app.tsx

**Files:**
- Modify: `components/pick-em/live-key-app.tsx`

**Step 1: Import shared components**

```typescript
import { SectionCard } from "@/components/pick-em/shared/section-card";
import { TimerControls } from "@/components/pick-em/shared/timer-controls";
import { BonusQuestionInput } from "@/components/pick-em/shared/bonus-question-input";
import { RosterAutocompleteInput } from "@/components/pick-em/shared/roster-autocomplete-input";
```

**Step 2: Replace inline section wrappers with SectionCard**

Find all `<section className="rounded-lg border border-border bg-card p-4">` patterns and replace with `<SectionCard title={...}>`.

**Step 3: Replace inline timer UIs with TimerControls**

Find the timer display + play/stop/reset button patterns and replace with `<TimerControls timer={...} currentTimeMs={...} onStart={...} onStop={...} onReset={...} />`.

**Step 4: Replace inline bonus question inputs with BonusQuestionInput**

Find the bonus question answer input patterns and replace with `<BonusQuestionInput question={...} answer={...} onChange={...} />`.

**Step 5: Verify the app builds**

Run: `npx next build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add components/pick-em/live-key-app.tsx
git commit -m "refactor: wire shared UI components into live-key-app"
```

---

## Task 18: Wire shared UI components into live-game-key-host-app.tsx

Same approach as Task 17 but for the host component. Import and replace the same patterns. The host has additional unique elements (FuzzyReviewPanel, lock toggles) that should remain inline.

**Step 1-5: Same pattern as Task 17**

**Step 6: Commit**

```bash
git add components/pick-em/live-game-key-host-app.tsx
git commit -m "refactor: wire shared UI components into live-game-key-host-app"
```

---

## Task 19: Wire shared UI components into player and display apps

**Files:**
- Modify: `components/pick-em/live-game-player-app.tsx`
- Modify: `components/pick-em/live-game-display-app.tsx`

Replace the relevant shared patterns in both files. Focus on:
- RosterAutocompleteInput in the player app
- SectionCard wrappers in both

**Commit:**

```bash
git add components/pick-em/live-game-player-app.tsx components/pick-em/live-game-display-app.tsx
git commit -m "refactor: wire shared UI components into player and display apps"
```

---

## Task 20: Decompose match-editor.tsx

**Files:**
- Modify: `components/pick-em/match-editor.tsx` (was `components/match-editor.tsx`)
- May create: `components/pick-em/match-editor/participant-list.tsx`
- May create: `components/pick-em/match-editor/bonus-question-editor.tsx`

**Step 1: Identify sections to extract**

Read `components/match-editor.tsx` and identify the main rendering sections:
1. Match type selector
2. Participant list management (add/remove/reorder)
3. Bonus question editing (add/remove questions)
4. Match settings (title, description, points)

**Step 2: Extract participant list into its own component**

Create a `ParticipantList` component with props for participants, onAdd, onRemove, onReorder, rosterSuggestions.

**Step 3: Extract bonus question editor**

Create a `BonusQuestionEditor` component with props for questions, onAdd, onRemove, onUpdate.

**Step 4: Verify the app builds**

Run: `npx next build`

**Step 5: Commit**

```bash
git add components/match-editor.tsx components/pick-em/match-editor/
git commit -m "refactor: decompose match-editor into focused sub-components"
```

---

## Task 21: Decompose bonus-question-admin-screen.tsx

**Files:**
- Modify: `components/admin/bonus-question-admin-screen.tsx`
- May create sub-components in `components/admin/bonus-question-admin/`

**Step 1: Identify sections**

Read the file and identify the major sections:
1. Pool list management
2. Template editing within a pool
3. Rule set configuration
4. Match type association

**Step 2: Extract pool management**

Create focused components for each section.

**Step 3: Verify and commit**

```bash
git add components/admin/
git commit -m "refactor: decompose bonus-question-admin-screen into sub-components"
```

---

## Task 22: Decompose remaining components

**Files:**
- `components/pick-em/editor-view.tsx`
- `components/admin/roster-admin-screen.tsx`
- `components/print-sheet.tsx`

For each file:
1. Read the file to identify extractable sections
2. Extract focused sub-components where sections are self-contained
3. Use shared components (SectionCard, etc.) where applicable
4. Verify builds

**Commit:**

```bash
git add components/
git commit -m "refactor: decompose editor-view, roster-admin, and print-sheet"
```

---

## Task 23: Final verification and cleanup

**Step 1: Run full test suite**

```bash
pnpm test:unit
```

Expected: All tests pass

**Step 2: Run build**

```bash
npx next build
```

Expected: Build succeeds with no errors

**Step 3: Run linter**

```bash
pnpm lint
```

Expected: No lint errors

**Step 4: Check for unused imports**

Grep for any remaining imports of the old inline functions that should have been removed.

**Step 5: Final commit**

```bash
git add -A
git commit -m "refactor: cleanup unused imports and finalize component refactoring"
```

---

## Summary

| Task | Description | Est. Lines Changed |
|------|-------------|-------------------|
| 1 | timer-utils.ts + tests | ~200 new |
| 2 | text-utils.ts + tests | ~100 new |
| 3 | leaderboard-utils.ts + tests | ~150 new |
| 4 | payload-utils.ts + tests | ~300 new |
| 5 | use-timer-clock hook | ~25 new |
| 6 | use-roster-suggestions hook | ~80 new |
| 7 | use-fullscreen-effects hook | ~120 new |
| 8 | use-async-action hook | ~30 new |
| 9 | Wire into live-key-app | ~500 removed |
| 10 | Wire into live-game-key-host-app | ~400 removed |
| 11 | Wire into live-game-player-app | ~350 removed |
| 12 | Wire into live-game-display-app | ~200 removed |
| 13 | SectionCard component | ~30 new |
| 14 | TimerControls component | ~70 new |
| 15 | RosterAutocompleteInput component | ~70 new |
| 16 | BonusQuestionInput component | ~60 new |
| 17-19 | Wire shared UI into all apps | ~800 removed |
| 20-22 | Decompose editor, admin, print | ~200 refactored |
| 23 | Final verification | ~0 |
