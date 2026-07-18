import assert from "node:assert/strict";
import { mkdtempSync, rmSync, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { randomUUID } from "node:crypto";

import type { Match } from "@/lib/types";

// All imports that reach through @/lib/server must be dynamic, because
// lib/server/db/client.ts resolves its SQLite path at module-import time
// from process.env.LOCAL_DATABASE_DIR. We set that env var in the first
// before() block and only then pull in the repository code.

type CardsRepo = typeof import("@/lib/server/repositories/cards");
type DbModule = typeof import("@/lib/server/db/client");

let tmpDir: string;
let db: DbModule["db"];
let cards: CardsRepo;

const OWNER = "user-owner";
const CARD_ID = "card-sections";

const NIGHT_ONE = randomUUID();
const NIGHT_TWO = randomUUID();

function makeMatch(title: string, sectionId: string | null): Match {
  return {
    id: randomUUID(),
    sectionId,
    type: "singles",
    typeLabelOverride: "",
    isBattleRoyal: false,
    isEliminationStyle: false,
    title,
    description: "",
    participants: ["A", "B"],
    surpriseSlots: 0,
    surpriseEntrantPoints: null,
    bonusQuestions: [],
    points: null,
  };
}

before(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "card-sections-test-"));
  const env = process.env as Record<string, string | undefined>;
  env.LOCAL_DATABASE_DIR = tmpDir;
  env.NODE_ENV = "development";
  delete env.USE_TURSO_IN_DEV;
  env.GIT_BRANCH = "sections-test";

  const clientModule = await import("@/lib/server/db/client");
  db = clientModule.db;
  cards = await import("@/lib/server/repositories/cards");

  const { FileMigrationProvider, Migrator } = await import("kysely");
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs: fsp,
      path,
      migrationFolder: path.join(process.cwd(), "migrations"),
    }),
  });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;

  const now = new Date().toISOString();
  await db
    .insertInto("cards")
    .values({
      id: CARD_ID,
      owner_id: OWNER,
      template_card_id: null,
      name: "Sections card",
      event_name: "",
      promotion_name: "",
      event_date: "",
      event_tagline: "",
      default_points: 1,
      tiebreaker_label: "",
      tiebreaker_is_time_based: 0,
      event_bonus_questions_json: "[]",
      sections_json: "[]",
      public: 0,
      is_template: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
});

after(async () => {
  if (db) await db.destroy();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("card sections", () => {
  test("sections and match assignments round-trip through persist/resolve", async () => {
    const saved = await cards.persistOwnedCardSheet(CARD_ID, OWNER, {
      eventName: "Two Night Event",
      promotionName: "WPS",
      eventDate: "2026-08-01",
      eventTagline: "",
      defaultPoints: 1,
      tiebreakerLabel: "",
      tiebreakerIsTimeBased: false,
      sections: [
        { id: NIGHT_ONE, name: "Night 1" },
        { id: NIGHT_TWO, name: "Night 2" },
      ],
      matches: [
        makeMatch("Opener", NIGHT_ONE),
        makeMatch("Main Event", NIGHT_TWO),
        makeMatch("Dark Match", null),
      ],
      eventBonusQuestions: [],
    });

    assert.ok(saved);
    assert.deepEqual(saved!.sections, [
      { id: NIGHT_ONE, name: "Night 1" },
      { id: NIGHT_TWO, name: "Night 2" },
    ]);
    assert.equal(saved!.matches.length, 3);
    assert.equal(saved!.matches[0].sectionId, NIGHT_ONE);
    assert.equal(saved!.matches[1].sectionId, NIGHT_TWO);
    assert.equal(saved!.matches[2].sectionId, null);

    const reloaded = await cards.findResolvedReadableCardById(CARD_ID, OWNER);
    assert.ok(reloaded);
    assert.deepEqual(
      reloaded!.sections.map((section) => section.name),
      ["Night 1", "Night 2"],
    );
    assert.equal(reloaded!.matches[0].sectionId, NIGHT_ONE);
  });

  test("dangling section assignments are dropped on save", async () => {
    const unknownSectionId = randomUUID();
    const saved = await cards.persistOwnedCardSheet(CARD_ID, OWNER, {
      eventName: "Two Night Event",
      promotionName: "WPS",
      eventDate: "2026-08-01",
      eventTagline: "",
      defaultPoints: 1,
      tiebreakerLabel: "",
      tiebreakerIsTimeBased: false,
      sections: [{ id: NIGHT_ONE, name: "Night 1" }],
      matches: [makeMatch("Orphan", unknownSectionId)],
      eventBonusQuestions: [],
    });

    assert.ok(saved);
    assert.equal(saved!.matches[0].sectionId, null);
  });

  test("removing all sections clears them from the resolved card", async () => {
    const saved = await cards.persistOwnedCardSheet(CARD_ID, OWNER, {
      eventName: "Two Night Event",
      promotionName: "WPS",
      eventDate: "2026-08-01",
      eventTagline: "",
      defaultPoints: 1,
      tiebreakerLabel: "",
      tiebreakerIsTimeBased: false,
      sections: [],
      matches: [makeMatch("Solo", null)],
      eventBonusQuestions: [],
    });

    assert.ok(saved);
    assert.deepEqual(saved!.sections, []);
  });
});
