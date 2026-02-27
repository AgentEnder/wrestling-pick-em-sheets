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
