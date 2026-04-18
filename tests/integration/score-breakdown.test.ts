import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { BreakdownRow } from "@/lib/types";

describe("breakdown_json round-trip", () => {
  test("JSON.stringify/parse preserves BreakdownRow shape", () => {
    const rows: BreakdownRow[] = [
      { kind: "match-winner", matchId: "m1", score: 10, maxPoints: 10 },
      {
        kind: "match-bonus",
        matchId: "m1",
        questionId: "q1",
        score: 0,
        maxPoints: 3,
      },
      { kind: "event-bonus", questionId: "eq1", score: 5, maxPoints: 5 },
      {
        kind: "match-surprise",
        matchId: "m1",
        entrantName: "Sting",
        score: 7,
        maxPoints: 7,
      },
    ];
    const serialized = JSON.stringify(rows);
    const parsed = JSON.parse(serialized) as BreakdownRow[];
    assert.deepEqual(parsed, rows);
  });
});
