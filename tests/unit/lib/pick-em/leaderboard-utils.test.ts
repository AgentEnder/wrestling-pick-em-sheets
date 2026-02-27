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
