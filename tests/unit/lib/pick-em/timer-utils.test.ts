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
