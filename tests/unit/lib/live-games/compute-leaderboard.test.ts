import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeLeaderboard } from "@/lib/server/repositories/live-games";
import type {
  BonusQuestion,
  LiveGameKeyPayload,
  LiveGamePlayer,
  LiveKeyMatchResult,
  LivePlayerMatchPick,
  LivePlayerPicksPayload,
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
    picks: { matchPicks: [], eventBonusAnswers: [], tiebreakerAnswer: "" },
    updatedAt: "2026-04-17T00:00:00Z",
    lastSeenAt: "2026-04-17T00:00:00Z",
    submittedAt: "2026-04-17T00:00:00Z",
    joinedAt: "2026-04-17T00:00:00Z",
  };
  return { ...defaults, ...overrides } as unknown as LiveGamePlayer;
}

export function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1",
    title: "Match 1",
    description: null,
    type: "standard",
    typeLabelOverride: null,
    participants: [],
    isBattleRoyal: false,
    isEliminationStyle: false,
    surpriseSlots: 0,
    surpriseEntrantPoints: null,
    bonusQuestions: [],
    points: null,
    ...overrides,
  } as unknown as Match;
}

export function makeQuestion(overrides: Partial<BonusQuestion> = {}): BonusQuestion {
  return {
    id: "q1",
    question: "Test question",
    points: null,
    answerType: "write-in",
    options: [],
    valueType: "string",
    gradingRule: "exact",
    ...overrides,
  };
}

export function makeMatchResult(
  overrides: Partial<LiveKeyMatchResult> = {},
): LiveKeyMatchResult {
  return {
    matchId: "m1",
    winnerName: "",
    winnerRecordedAt: null,
    battleRoyalEntryOrder: [],
    battleRoyalEliminationOrder: [],
    bonusAnswers: [],
    ...overrides,
  };
}

export function makeMatchPick(
  overrides: Partial<LivePlayerMatchPick> = {},
): LivePlayerMatchPick {
  return {
    matchId: "m1",
    winnerName: "",
    battleRoyalEntrants: [],
    bonusAnswers: [],
    ...overrides,
  };
}

export function makePicks(
  overrides: Partial<LivePlayerPicksPayload> = {},
): LivePlayerPicksPayload {
  return {
    matchPicks: [],
    eventBonusAnswers: [],
    tiebreakerAnswer: "",
    ...overrides,
  };
}

describe("computeLeaderboard — perQuestion breakdown", () => {
  test("scaffolding compiles and runs", () => {
    const result = computeLeaderboard(makeCard(), makeKey(), []);
    assert.deepEqual(result, []);
  });

  test("emits match-winner row when host keyed the winner and player picked correctly", () => {
    const match = { id: "m1", title: "Main Event", points: 10, bonusQuestions: [], isBattleRoyal: false, surpriseSlots: 0, surpriseEntrantPoints: null, participants: [], type: "standard", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
    const card = makeCard({ matches: [match] });
    const key = makeKey({ matchResults: [{ matchId: "m1", winnerName: "Cody", winnerRecordedAt: null, battleRoyalEntryOrder: [], battleRoyalEliminationOrder: [], bonusAnswers: [] }] });
    const player = makePlayer({ picks: { matchPicks: [{ matchId: "m1", winnerName: "Cody", battleRoyalEntrants: [], bonusAnswers: [] }], eventBonusAnswers: [], tiebreakerAnswer: "" } });

    const [entry] = computeLeaderboard(card, key, [player]);

    assert.equal(entry.score, 10);
    assert.deepEqual(entry.breakdown.perQuestion, [
      { kind: "match-winner", matchId: "m1", score: 10, maxPoints: 10 },
    ]);
  });

  test("does not emit match-winner row when host has not keyed the match", () => {
    const match = { id: "m1", title: "Main Event", points: 10, bonusQuestions: [], isBattleRoyal: false, surpriseSlots: 0, surpriseEntrantPoints: null, participants: [], type: "standard", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
    const card = makeCard({ matches: [match] });
    const player = makePlayer({ picks: { matchPicks: [{ matchId: "m1", winnerName: "Cody", battleRoyalEntrants: [], bonusAnswers: [] }], eventBonusAnswers: [], tiebreakerAnswer: "" } });

    const [entry] = computeLeaderboard(card, makeKey(), [player]);

    assert.deepEqual(entry.breakdown.perQuestion, []);
  });

  test("emits match-winner row with score=0 when player picked wrong", () => {
    const match = { id: "m1", title: "Main Event", points: 10, bonusQuestions: [], isBattleRoyal: false, surpriseSlots: 0, surpriseEntrantPoints: null, participants: [], type: "standard", typeLabelOverride: null, isEliminationStyle: false, description: null } as unknown as Match;
    const card = makeCard({ matches: [match] });
    const key = makeKey({ matchResults: [{ matchId: "m1", winnerName: "Cody", winnerRecordedAt: null, battleRoyalEntryOrder: [], battleRoyalEliminationOrder: [], bonusAnswers: [] }] });
    const player = makePlayer({ picks: { matchPicks: [{ matchId: "m1", winnerName: "Roman", battleRoyalEntrants: [], bonusAnswers: [] }], eventBonusAnswers: [], tiebreakerAnswer: "" } });

    const [entry] = computeLeaderboard(card, key, [player]);

    assert.deepEqual(entry.breakdown.perQuestion, [
      { kind: "match-winner", matchId: "m1", score: 0, maxPoints: 10 },
    ]);
  });

  test("emits match-bonus row with score>0 for correct answer", () => {
    const question = makeQuestion({ id: "q1", question: "First finisher?", points: 3 });
    const match = makeMatch({ id: "m1", bonusQuestions: [question] });
    const card = makeCard({ matches: [match], defaultPoints: 5 });
    const key = makeKey({
      matchResults: [
        makeMatchResult({
          matchId: "m1",
          bonusAnswers: [
            { questionId: "q1", answer: "Cross Rhodes", recordedAt: null, timerId: null },
          ],
        }),
      ],
    });
    const player = makePlayer({
      picks: makePicks({
        matchPicks: [
          makeMatchPick({
            matchId: "m1",
            bonusAnswers: [{ questionId: "q1", answer: "Cross Rhodes" }],
          }),
        ],
      }),
    });

    const [entry] = computeLeaderboard(card, key, [player]);

    assert.equal(entry.score, 3);
    assert.deepEqual(entry.breakdown.perQuestion, [
      { kind: "match-bonus", matchId: "m1", questionId: "q1", score: 3, maxPoints: 3 },
    ]);
  });

  test("emits event-bonus row for correct event-level answer", () => {
    const question = makeQuestion({
      id: "eq1",
      question: "How many matches?",
      points: null,
      valueType: "numerical",
    });
    const card = makeCard({ eventBonusQuestions: [question], defaultPoints: 5 });
    const key = makeKey({
      eventBonusAnswers: [
        { questionId: "eq1", answer: "10", recordedAt: null, timerId: null },
      ],
    });
    const player = makePlayer({
      picks: makePicks({
        eventBonusAnswers: [{ questionId: "eq1", answer: "10" }],
      }),
    });

    const [entry] = computeLeaderboard(card, key, [player]);

    assert.equal(entry.score, 5);
    assert.deepEqual(entry.breakdown.perQuestion, [
      { kind: "event-bonus", questionId: "eq1", score: 5, maxPoints: 5 },
    ]);
  });

  test("does not emit bonus row when host has not keyed an answer", () => {
    const question = makeQuestion({ id: "q1", question: "First finisher?", points: 3 });
    const match = makeMatch({ id: "m1", bonusQuestions: [question] });
    const card = makeCard({ matches: [match] });
    const key = makeKey({ matchResults: [makeMatchResult({ matchId: "m1" })] });
    const player = makePlayer({
      picks: makePicks({
        matchPicks: [
          makeMatchPick({
            matchId: "m1",
            bonusAnswers: [{ questionId: "q1", answer: "Cross Rhodes" }],
          }),
        ],
      }),
    });

    const [entry] = computeLeaderboard(card, key, [player]);

    assert.deepEqual(entry.breakdown.perQuestion, []);
  });
});
