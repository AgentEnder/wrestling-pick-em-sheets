import assert from "node:assert/strict";
import { mkdtempSync, rmSync, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

// All imports that reach through @/lib/server must be dynamic, because
// lib/server/db/client.ts resolves its SQLite path at module-import time
// from process.env.LOCAL_DATABASE_DIR. We set that env var in the first
// before() block and only then pull in the repository code.

type CardsRepo = typeof import("@/lib/server/repositories/cards");
type DbModule = typeof import("@/lib/server/db/client");

let tmpDir: string;
let db: DbModule["db"];
let cards: CardsRepo;

const OWNER_A = "user-owner-a";
const OWNER_B = "user-owner-b";

const IDS = {
  activeA: "card-active-a",
  archivedA: "card-archived-a",
  templateActive: "card-template-active",
  templateArchived: "card-template-archived",
  archivedBPublic: "card-archived-b-public",
};

async function seed(): Promise<void> {
  const now = new Date().toISOString();
  const rows = [
    {
      id: IDS.activeA,
      owner_id: OWNER_A,
      name: "A active",
      public: 0,
      is_template: 0,
      archived_at: null,
    },
    {
      id: IDS.archivedA,
      owner_id: OWNER_A,
      name: "A archived",
      public: 0,
      is_template: 0,
      archived_at: now,
    },
    {
      id: IDS.templateActive,
      owner_id: OWNER_A,
      name: "Active template",
      public: 1,
      is_template: 1,
      archived_at: null,
    },
    {
      id: IDS.templateArchived,
      owner_id: OWNER_A,
      name: "Archived template",
      public: 1,
      is_template: 1,
      archived_at: now,
    },
    {
      id: IDS.archivedBPublic,
      owner_id: OWNER_B,
      name: "B archived public",
      public: 1,
      is_template: 0,
      archived_at: now,
    },
  ];

  for (const row of rows) {
    await db
      .insertInto("cards")
      .values({
        id: row.id,
        owner_id: row.owner_id,
        template_card_id: null,
        name: row.name,
        event_name: "",
        promotion_name: "",
        event_date: "",
        event_tagline: "",
        default_points: 1,
        tiebreaker_label: "",
        tiebreaker_is_time_based: 0,
        event_bonus_questions_json: "[]",
        public: row.public,
        is_template: row.is_template,
        archived_at: row.archived_at,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }
}

before(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "card-archive-test-"));
  const env = process.env as Record<string, string | undefined>;
  env.LOCAL_DATABASE_DIR = tmpDir;
  env.NODE_ENV = "development";
  // Ensure the DB module treats us as local-dev, not turso.
  delete env.USE_TURSO_IN_DEV;
  // Stable branch name -> stable file name inside tmpDir.
  env.GIT_BRANCH = "archive-test";

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

  await seed();
});

after(async () => {
  if (db) await db.destroy();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("cards archive", () => {
  test("listReadableCards hides archived cards by default", async () => {
    const rows = await cards.listReadableCards(OWNER_A);
    const ids = rows.map((c) => c.id);
    assert.ok(ids.includes(IDS.activeA), "active card should appear");
    assert.ok(
      !ids.includes(IDS.archivedA),
      "archived card should not appear by default",
    );
    assert.ok(
      !ids.includes(IDS.templateArchived),
      "archived template should not appear",
    );
  });

  test("listReadableCards returns archived when includeArchived=true and caller is owner", async () => {
    const rows = await cards.listReadableCards(OWNER_A, {
      includeArchived: true,
    });
    const ids = rows.map((c) => c.id);
    assert.ok(ids.includes(IDS.activeA));
    assert.ok(ids.includes(IDS.archivedA));
  });

  test("includeArchived does not leak other users' archived cards", async () => {
    const rows = await cards.listReadableCards(OWNER_A, {
      includeArchived: true,
    });
    const ids = rows.map((c) => c.id);
    assert.ok(
      !ids.includes(IDS.archivedBPublic),
      "owner A should not see owner B's archived public card",
    );
  });

  test("archiveCard refuses non-owners", async () => {
    const result = await cards.archiveCard(IDS.activeA, OWNER_B);
    assert.equal(result, null);
  });

  test("archiveCard sets archived_at and is idempotent for the owner", async () => {
    const first = await cards.archiveCard(IDS.activeA, OWNER_A);
    assert.ok(first, "archive should succeed for owner");
    assert.ok(first!.archivedAt, "archivedAt should be set");

    const second = await cards.archiveCard(IDS.activeA, OWNER_A);
    assert.ok(second, "idempotent second call should still return summary");
    assert.equal(
      second!.archivedAt,
      first!.archivedAt,
      "second archive should not bump archivedAt",
    );

    // Restore for downstream tests.
    await cards.unarchiveCard(IDS.activeA, OWNER_A);
  });

  test("unarchiveCard refuses non-owners", async () => {
    const result = await cards.unarchiveCard(IDS.archivedA, OWNER_B);
    assert.equal(result, null);
  });

  test("unarchiveCard clears archived_at for the owner", async () => {
    const restored = await cards.unarchiveCard(IDS.archivedA, OWNER_A);
    assert.ok(restored);
    assert.equal(restored!.archivedAt, null);

    // Re-archive so the hidden-by-default test that runs in a new describe
    // still holds (tests share state; seed is done once).
    await cards.archiveCard(IDS.archivedA, OWNER_A);
  });

  test("createCardFromTemplate refuses archived templates", async () => {
    const cloned = await cards.createCardFromTemplate(
      OWNER_B,
      IDS.templateArchived,
    );
    assert.equal(cloned, null);
  });

  test("createCardFromTemplate still works for active templates", async () => {
    const cloned = await cards.createCardFromTemplate(
      OWNER_B,
      IDS.templateActive,
    );
    assert.ok(cloned, "active template should clone");
  });
});
