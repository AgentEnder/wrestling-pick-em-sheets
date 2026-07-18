import assert from "node:assert/strict";
import { describe, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PrintSheet } from "@/components/print-sheet";
import type { BonusQuestion, Match, PickEmSheet } from "@/lib/types";

function createBonusQuestion(
  id: string,
  overrides: Partial<BonusQuestion> = {},
): BonusQuestion {
  return {
    id,
    question: "Bonus question",
    points: null,
    answerType: "write-in",
    options: [],
    valueType: "string",
    gradingRule: "exact",
    ...overrides,
  };
}

function createMatch(id: string, overrides: Partial<Match> = {}): Match {
  return {
    id,
    sectionId: null,
    type: "standard",
    typeLabelOverride: "",
    isBattleRoyal: false,
    isEliminationStyle: false,
    title: "Opening Match",
    description: "",
    participants: ["Wrestler A", "Wrestler B"],
    surpriseSlots: 0,
    surpriseEntrantPoints: null,
    bonusQuestions: [],
    points: null,
    ...overrides,
  };
}

function createSheet(overrides: Partial<PickEmSheet> = {}): PickEmSheet {
  return {
    eventName: "Wrestling Showcase",
    promotionName: "WPS",
    eventDate: "2026-02-24",
    eventTagline: "",
    defaultPoints: 5,
    tiebreakerLabel: "Match length",
    tiebreakerIsTimeBased: false,
    sections: [],
    matches: [createMatch("match-1")],
    eventBonusQuestions: [],
    ...overrides,
  };
}

function renderSheet(sheet: PickEmSheet): string {
  return renderToStaticMarkup(React.createElement(PrintSheet, { sheet }));
}

describe("PrintSheet", () => {
  test("renders total points and tiebreaker text from the sheet", () => {
    const standardMatch = createMatch("match-standard", {
      title: "Singles Match",
      bonusQuestions: [
        createBonusQuestion("bonus-standard", {
          question: "Method of victory?",
          points: 2,
        }),
      ],
    });

    const battleRoyalMatch = createMatch("match-battle-royal", {
      type: "battle-royal",
      isBattleRoyal: true,
      title: "Battle Royal",
      participants: ["A", "B", "C"],
      surpriseSlots: 2,
      points: 4,
      surpriseEntrantPoints: 3,
      bonusQuestions: [
        createBonusQuestion("bonus-battle", {
          question: "Most eliminations?",
          points: null,
        }),
      ],
    });

    const sheet = createSheet({
      eventName: "WrestleFest",
      matches: [standardMatch, battleRoyalMatch],
      eventBonusQuestions: [
        createBonusQuestion("bonus-event", {
          question: "Attendance?",
          points: null,
        }),
      ],
      tiebreakerLabel: "Bell to bell duration",
    });

    const html = renderSheet(sheet);

    assert.match(html, /WrestleFest/);
    assert.match(html, /27 pts possible/);
    assert.match(html, /Bell to bell duration/);
  });

  test("uses compact battle royal rendering when participant count is small", () => {
    const compactBattleRoyal = createMatch("match-compact", {
      type: "battle-royal",
      isBattleRoyal: true,
      participants: ["A", "B", "C"],
      surpriseSlots: 2,
      surpriseEntrantPoints: 2,
      bonusQuestions: [],
    });

    const html = renderSheet(
      createSheet({
        matches: [compactBattleRoyal],
      }),
    );

    assert.match(html, /Surprise guesses \(2 pts each, check winner\):/);
    assert.match(html, /class="print-surprise-num">1\./);
    assert.match(html, /class="print-surprise-num">2\./);
  });

  test("marks low-complexity sheets as sparse and omits empty tiebreaker footer", () => {
    const html = renderSheet(
      createSheet({
        tiebreakerLabel: "",
        matches: [
          createMatch("match-sparse", {
            title: "Simple Match",
            participants: ["A", "B"],
            bonusQuestions: [],
          }),
        ],
      }),
    );

    assert.match(html, /data-density="sparse"/);
    assert.match(html, /--print-dyn-match-gap/);
    assert.doesNotMatch(html, /print-footer/);
  });

  test("renders threshold question with two checkbox options", () => {
    const sheet = createSheet({
      matches: [
        createMatch("m1", {
          bonusQuestions: [
            createBonusQuestion("tq1", {
              question: "Over/Under 15:00?",
              answerType: "threshold",
              valueType: "time",
              thresholdValue: 900,
              thresholdLabels: ["Over", "Under"],
            }),
          ],
        }),
      ],
    });

    const html = renderSheet(sheet);
    assert.ok(html.includes("Over"), "Should render Over label");
    assert.ok(html.includes("Under"), "Should render Under label");
    assert.ok(html.includes("print-checkbox"), "Should render checkboxes");
  });

  test("marks high-complexity sheets as dense", () => {
    const denseMatches = Array.from({ length: 3 }, (_, matchIndex) =>
      createMatch(`match-dense-${matchIndex + 1}`, {
        title: `Dense Match ${matchIndex + 1}`,
        description: "Long description to increase print complexity.",
        participants: Array.from(
          { length: 20 },
          (_, participantIndex) =>
            `Competitor ${matchIndex + 1}-${participantIndex + 1}`,
        ),
        bonusQuestions: Array.from({ length: 4 }, (_, questionIndex) =>
          createBonusQuestion(
            `bonus-dense-${matchIndex + 1}-${questionIndex + 1}`,
            {
              question: `Dense bonus question ${questionIndex + 1}`,
              answerType: "multiple-choice",
              options: ["A", "B", "C", "D", "E"],
            },
          ),
        ),
      }),
    );

    const html = renderSheet(
      createSheet({
        matches: denseMatches,
        eventBonusQuestions: [],
      }),
    );

    assert.match(html, /data-density="dense"/);
  });

  test("groups matches under section headers and keeps numbering continuous", () => {
    const nightOne = "11111111-1111-4111-8111-111111111111";
    const nightTwo = "22222222-2222-4222-8222-222222222222";

    const html = renderSheet(
      createSheet({
        sections: [
          { id: nightOne, name: "Night 1" },
          { id: nightTwo, name: "Night 2" },
        ],
        matches: [
          createMatch("match-dark", { title: "Dark Match", sectionId: null }),
          createMatch("match-n1", {
            title: "Night One Opener",
            sectionId: nightOne,
          }),
          createMatch("match-n2", {
            title: "Night Two Main",
            sectionId: nightTwo,
          }),
        ],
      }),
    );

    assert.match(html, /print-section-header/);
    assert.match(html, /Night 1/);
    assert.match(html, /Night 2/);

    // Unsectioned matches render first (headerless), then sections in order,
    // with one continuous numbering across all groups.
    const darkIndex = html.indexOf("Dark Match");
    const nightOneIndex = html.indexOf("Night One Opener");
    const nightTwoIndex = html.indexOf("Night Two Main");
    assert.ok(darkIndex !== -1 && darkIndex < nightOneIndex);
    assert.ok(nightOneIndex < nightTwoIndex);
    assert.match(html, /3\.<\/span>/);
  });

  test("skips headers for sections with no matches", () => {
    const emptySection = "33333333-3333-4333-8333-333333333333";

    const html = renderSheet(
      createSheet({
        sections: [{ id: emptySection, name: "Ghost Night" }],
        matches: [createMatch("match-1", { sectionId: null })],
      }),
    );

    assert.ok(!html.includes("Ghost Night"));
    assert.ok(!html.includes("print-section-header"));
  });
});
