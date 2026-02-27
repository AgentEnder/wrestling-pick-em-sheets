import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  filterRosterMemberSuggestions,
  normalizeText,
  formatEventTypeLabel,
} from "@/lib/pick-em/text-utils";

describe("filterRosterMemberSuggestions", () => {
  const candidates = [
    "Cody Rhodes",
    "Roman Reigns",
    "Seth Rollins",
    "Rhea Ripley",
    "Bianca Belair",
  ];

  test("returns empty array for empty input", () => {
    assert.deepEqual(filterRosterMemberSuggestions("", candidates), []);
  });

  test("returns empty array for whitespace-only input", () => {
    assert.deepEqual(filterRosterMemberSuggestions("   ", candidates), []);
  });

  test("filters by case-insensitive substring match", () => {
    const result = filterRosterMemberSuggestions("rh", candidates);
    assert.deepEqual(result, ["Cody Rhodes", "Rhea Ripley"]);
  });

  test("deduplicates case-insensitively", () => {
    const dupes = ["Cody Rhodes", "cody rhodes", "CODY RHODES"];
    const result = filterRosterMemberSuggestions("cody", dupes);
    assert.equal(result.length, 1);
  });

  test("limits results to 8", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Wrestler ${i}`);
    const result = filterRosterMemberSuggestions("Wrestler", many);
    assert.equal(result.length, 8);
  });

  test("skips empty candidates", () => {
    const result = filterRosterMemberSuggestions("test", ["", "  ", "test1"]);
    assert.deepEqual(result, ["test1"]);
  });
});

describe("normalizeText", () => {
  test("trims whitespace", () => {
    assert.equal(normalizeText("  hello  "), "hello");
  });

  test("collapses multiple spaces", () => {
    assert.equal(normalizeText("hello   world"), "hello world");
  });

  test("lowercases", () => {
    assert.equal(normalizeText("Hello World"), "hello world");
  });

  test("handles all transformations together", () => {
    assert.equal(normalizeText("  Hello   World  "), "hello world");
  });
});

describe("formatEventTypeLabel", () => {
  test("maps bonus types", () => {
    assert.equal(formatEventTypeLabel("match_bonus"), "Bonus Question");
    assert.equal(formatEventTypeLabel("event_bonus"), "Bonus Question");
  });

  test("maps result types", () => {
    assert.equal(formatEventTypeLabel("match_result"), "Match Result");
  });

  test("maps tiebreaker types", () => {
    assert.equal(formatEventTypeLabel("tiebreaker_update"), "Tiebreaker");
  });

  test("falls back to cleaned string", () => {
    assert.equal(formatEventTypeLabel("custom_event"), "custom event");
    assert.equal(formatEventTypeLabel("some-thing"), "some thing");
  });
});
