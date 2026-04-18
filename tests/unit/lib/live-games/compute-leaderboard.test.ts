import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeLeaderboard } from "@/lib/server/repositories/live-games";
import type {
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
});
