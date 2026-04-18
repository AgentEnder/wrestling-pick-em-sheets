import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { normalizeBonusQuestionForWrite } from "@/lib/server/bonus-question-normalize";
import type { BonusQuestion } from "@/lib/types";

function make(overrides: Partial<BonusQuestion> = {}): BonusQuestion {
  return {
    id: "q1",
    question: "Test",
    points: null,
    answerType: "write-in",
    options: [],
    valueType: "string",
    gradingRule: "exact",
    ...overrides,
  };
}

describe("normalizeBonusQuestionForWrite", () => {
  test("drops gradingRule for threshold questions", () => {
    const input = make({
      answerType: "threshold",
      valueType: "numerical",
      gradingRule: "atOrAbove",
      thresholdValue: 10,
      thresholdLabels: ["Over", "Under"],
    });
    const result = normalizeBonusQuestionForWrite(input);
    assert.equal("gradingRule" in result, false);
    assert.equal(result.thresholdValue, 10);
    assert.deepEqual(result.thresholdLabels, ["Over", "Under"]);
  });

  test("no-op for threshold question without gradingRule", () => {
    const input = make({
      answerType: "threshold",
      valueType: "numerical",
      gradingRule: undefined,
    });
    const result = normalizeBonusQuestionForWrite(input);
    assert.equal("gradingRule" in result, false);
  });

  test("preserves gradingRule for numerical non-threshold questions", () => {
    const input = make({
      answerType: "write-in",
      valueType: "numerical",
      gradingRule: "closest",
    });
    const result = normalizeBonusQuestionForWrite(input);
    assert.equal(result.gradingRule, "closest");
  });

  test("preserves gradingRule for multiple-choice questions", () => {
    const input = make({
      answerType: "multiple-choice",
      valueType: "string",
      gradingRule: "exact",
      options: ["a", "b"],
    });
    const result = normalizeBonusQuestionForWrite(input);
    assert.equal(result.gradingRule, "exact");
  });

  test("does not mutate the input object", () => {
    const input = make({
      answerType: "threshold",
      valueType: "numerical",
      gradingRule: "exact",
    });
    normalizeBonusQuestionForWrite(input);
    assert.equal(input.gradingRule, "exact");
  });
});
