import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EVENT_BUCKET_KEY,
  OTHER_BUCKET_KEY,
  buildMatchGroups,
  computeSectionScores,
  withSectionScores,
} from "@/lib/pick-em/section-utils";
import type { BreakdownRow, CardSection, Match } from "@/lib/types";

const NIGHT_ONE: CardSection = { id: "section-n1", name: "Night 1" };
const NIGHT_TWO: CardSection = { id: "section-n2", name: "Night 2" };

function makeMatch(id: string, sectionId: string | null): Match {
  return {
    id,
    sectionId,
    type: "singles",
    typeLabelOverride: "",
    isBattleRoyal: false,
    isEliminationStyle: false,
    title: id,
    description: "",
    participants: ["A", "B"],
    surpriseSlots: 0,
    surpriseEntrantPoints: null,
    bonusQuestions: [],
    points: null,
  };
}

describe("buildMatchGroups", () => {
  test("unsectioned first, sections in order, empty sections skipped", () => {
    const card = {
      sections: [NIGHT_ONE, NIGHT_TWO, { id: "section-empty", name: "Ghost" }],
      matches: [
        makeMatch("m-n2", NIGHT_TWO.id),
        makeMatch("m-dark", null),
        makeMatch("m-n1", NIGHT_ONE.id),
        makeMatch("m-dangling", "section-unknown"),
      ],
    };

    const groups = buildMatchGroups(card);
    assert.deepEqual(
      groups.map((group) => ({
        section: group.section?.id ?? null,
        matches: group.matches.map((match) => match.id),
      })),
      [
        { section: null, matches: ["m-dark", "m-dangling"] },
        { section: NIGHT_ONE.id, matches: ["m-n1"] },
        { section: NIGHT_TWO.id, matches: ["m-n2"] },
      ],
    );
  });

  test("no sections yields one headerless group", () => {
    const card = {
      sections: [],
      matches: [makeMatch("m-1", null), makeMatch("m-2", null)],
    };
    const groups = buildMatchGroups(card);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].section, null);
    assert.equal(groups[0].matches.length, 2);
  });
});

describe("computeSectionScores", () => {
  const card = {
    sections: [NIGHT_ONE, NIGHT_TWO],
    matches: [
      makeMatch("m-n1", NIGHT_ONE.id),
      makeMatch("m-n2", NIGHT_TWO.id),
      makeMatch("m-dark", null),
    ],
  };

  const rows: BreakdownRow[] = [
    { kind: "match-winner", matchId: "m-n1", score: 2, maxPoints: 2 },
    {
      kind: "match-bonus",
      matchId: "m-n1",
      questionId: "q1",
      score: 0,
      maxPoints: 3,
    },
    { kind: "match-winner", matchId: "m-n2", score: 4, maxPoints: 4 },
    {
      kind: "match-surprise",
      matchId: "m-n2",
      entrantName: "Surprise Guy",
      score: 1,
      maxPoints: 1,
    },
    { kind: "match-winner", matchId: "m-dark", score: 1, maxPoints: 1 },
    { kind: "event-bonus", questionId: "eq1", score: 5, maxPoints: 5 },
  ];

  test("buckets scores by section with other/event buckets", () => {
    const scores = computeSectionScores(card, rows);
    assert.deepEqual(scores, [
      {
        key: OTHER_BUCKET_KEY,
        name: "Other Matches",
        score: 1,
        maxPoints: 1,
      },
      { key: NIGHT_ONE.id, name: "Night 1", score: 2, maxPoints: 5 },
      { key: NIGHT_TWO.id, name: "Night 2", score: 5, maxPoints: 5 },
      { key: EVENT_BUCKET_KEY, name: "Event Bonuses", score: 5, maxPoints: 5 },
    ]);

    const total = scores.reduce((sum, section) => sum + section.score, 0);
    assert.equal(
      total,
      rows.reduce((sum, row) => sum + row.score, 0),
      "section totals must add up to the overall score",
    );
  });

  test("all sections appear even with no keyed rows; empty buckets omitted", () => {
    const scores = computeSectionScores(card, [
      { kind: "match-winner", matchId: "m-n1", score: 2, maxPoints: 2 },
    ]);
    assert.deepEqual(scores, [
      { key: NIGHT_ONE.id, name: "Night 1", score: 2, maxPoints: 2 },
      { key: NIGHT_TWO.id, name: "Night 2", score: 0, maxPoints: 0 },
    ]);
  });

  test("returns [] when the card has no sections", () => {
    const scores = computeSectionScores(
      { sections: [], matches: [makeMatch("m-1", null)] },
      rows,
    );
    assert.deepEqual(scores, []);
  });

  test("unnamed sections get a positional fallback name", () => {
    const scores = computeSectionScores(
      {
        sections: [{ id: "s-1", name: "  " }],
        matches: [makeMatch("m-1", "s-1")],
      },
      [{ kind: "match-winner", matchId: "m-1", score: 1, maxPoints: 1 }],
    );
    assert.equal(scores[0].name, "Part 1");
  });
});

describe("withSectionScores", () => {
  test("enriches leaderboard entries per player", () => {
    const card = {
      sections: [NIGHT_ONE],
      matches: [makeMatch("m-n1", NIGHT_ONE.id)],
    };
    const leaderboard = [
      {
        nickname: "Alice",
        breakdown: {
          perQuestion: [
            {
              kind: "match-winner",
              matchId: "m-n1",
              score: 2,
              maxPoints: 2,
            },
          ] as BreakdownRow[],
        },
      },
      {
        nickname: "Bob",
        breakdown: {
          perQuestion: [
            {
              kind: "match-winner",
              matchId: "m-n1",
              score: 0,
              maxPoints: 2,
            },
          ] as BreakdownRow[],
        },
      },
    ];

    const enriched = withSectionScores(card, leaderboard);
    assert.equal(enriched[0].sectionScores[0].score, 2);
    assert.equal(enriched[1].sectionScores[0].score, 0);
    assert.equal(enriched[0].nickname, "Alice");
  });

  test("returns empty sectionScores when the card has no sections", () => {
    const enriched = withSectionScores(
      { sections: [], matches: [] },
      [{ nickname: "Alice", breakdown: { perQuestion: [] } }],
    );
    assert.deepEqual(enriched[0].sectionScores, []);
  });
});
