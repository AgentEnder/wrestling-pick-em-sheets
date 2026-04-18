import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeLeaderboard } from "@/lib/server/repositories/live-games";
import type {
  LiveGameKeyPayload,
  LiveGamePlayer,
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
