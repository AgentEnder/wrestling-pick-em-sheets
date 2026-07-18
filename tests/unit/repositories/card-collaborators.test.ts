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
type CollaboratorsRepo =
  typeof import("@/lib/server/repositories/card-collaborators");
type DbModule = typeof import("@/lib/server/db/client");

let tmpDir: string;
let db: DbModule["db"];
let cards: CardsRepo;
let collaborators: CollaboratorsRepo;

const OWNER = "user-owner";
const FRIEND = "user-friend";
const STRANGER = "user-stranger";

const CARD_ID = "card-shared";
const OTHER_CARD_ID = "card-private";

async function seedCard(id: string, ownerId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto("cards")
    .values({
      id,
      owner_id: ownerId,
      template_card_id: null,
      name: `${id} name`,
      event_name: `${id} event`,
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
}

before(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "card-collaborators-test-"));
  const env = process.env as Record<string, string | undefined>;
  env.LOCAL_DATABASE_DIR = tmpDir;
  env.NODE_ENV = "development";
  delete env.USE_TURSO_IN_DEV;
  env.GIT_BRANCH = "collaborators-test";

  const clientModule = await import("@/lib/server/db/client");
  db = clientModule.db;
  cards = await import("@/lib/server/repositories/cards");
  collaborators = await import(
    "@/lib/server/repositories/card-collaborators"
  );

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

  await seedCard(CARD_ID, OWNER);
  await seedCard(OTHER_CARD_ID, OWNER);
});

after(async () => {
  if (db) await db.destroy();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("card invites", () => {
  test("createCardInvite refuses non-owners", async () => {
    const invite = await collaborators.createCardInvite(CARD_ID, FRIEND);
    assert.equal(invite, null);
  });

  test("owner can create an invite and preview resolves the card", async () => {
    const invite = await collaborators.createCardInvite(CARD_ID, OWNER);
    assert.ok(invite, "owner should be able to create an invite");
    assert.ok(invite!.token.length > 20, "token should be generated");

    const preview = await collaborators.previewCardInvite(
      invite!.token,
      FRIEND,
    );
    assert.ok(preview);
    assert.equal(preview!.cardId, CARD_ID);
    assert.equal(preview!.viewerIsOwner, false);
    assert.equal(preview!.viewerIsCollaborator, false);

    const ownerPreview = await collaborators.previewCardInvite(
      invite!.token,
      OWNER,
    );
    assert.equal(ownerPreview!.viewerIsOwner, true);
  });

  test("accepting an invite makes the user a collaborator", async () => {
    const invite = await collaborators.createCardInvite(CARD_ID, OWNER);
    const result = await collaborators.acceptCardInvite(
      invite!.token,
      FRIEND,
      "friend@example.com",
    );
    assert.deepEqual(result, { status: "joined", cardId: CARD_ID });

    const again = await collaborators.acceptCardInvite(
      invite!.token,
      FRIEND,
      "friend@example.com",
    );
    assert.deepEqual(again, {
      status: "already-collaborator",
      cardId: CARD_ID,
    });

    const asOwner = await collaborators.acceptCardInvite(
      invite!.token,
      OWNER,
      null,
    );
    assert.deepEqual(asOwner, { status: "owner", cardId: CARD_ID });

    const list = await collaborators.listCardCollaborators(CARD_ID, OWNER);
    assert.ok(list);
    assert.equal(list!.length, 1);
    assert.equal(list![0].userId, FRIEND);
    assert.equal(list![0].userEmail, "friend@example.com");
  });

  test("listCardCollaborators refuses non-owners", async () => {
    const list = await collaborators.listCardCollaborators(CARD_ID, FRIEND);
    assert.equal(list, null);
  });

  test("revoked invites stop resolving and cannot be accepted", async () => {
    const invite = await collaborators.createCardInvite(CARD_ID, OWNER);

    const revokedByStranger = await collaborators.revokeCardInvite(
      CARD_ID,
      invite!.id,
      STRANGER,
    );
    assert.equal(revokedByStranger, false);

    const revoked = await collaborators.revokeCardInvite(
      CARD_ID,
      invite!.id,
      OWNER,
    );
    assert.equal(revoked, true);

    const preview = await collaborators.previewCardInvite(
      invite!.token,
      STRANGER,
    );
    assert.equal(preview, null);

    const result = await collaborators.acceptCardInvite(
      invite!.token,
      STRANGER,
      null,
    );
    assert.deepEqual(result, { status: "invalid" });
  });
});

describe("collaborator permissions", () => {
  test("collaborators can read the card with viewerRole=collaborator", async () => {
    const resolved = await cards.findResolvedReadableCardById(CARD_ID, FRIEND);
    assert.ok(resolved, "collaborator should read a private shared card");
    assert.equal(resolved!.viewerRole, "collaborator");
    assert.equal(resolved!.ownerId, null);

    const strangerView = await cards.findResolvedReadableCardById(
      CARD_ID,
      STRANGER,
    );
    assert.equal(strangerView, null);
  });

  test("listReadableCards includes shared cards for collaborators", async () => {
    const rows = await cards.listReadableCards(FRIEND);
    const shared = rows.find((card) => card.id === CARD_ID);
    assert.ok(shared, "shared card should be listed");
    assert.equal(shared!.viewerRole, "collaborator");
    assert.ok(
      !rows.some((card) => card.id === OTHER_CARD_ID),
      "unshared private card should stay hidden",
    );
  });

  test("collaborators can save the sheet, strangers cannot", async () => {
    const input = {
      eventName: "Two Night Spectacular",
      promotionName: "WPS",
      eventDate: "2026-08-01",
      eventTagline: "",
      defaultPoints: 2,
      tiebreakerLabel: "Main event time",
      tiebreakerIsTimeBased: true,
      sections: [],
      matches: [],
      eventBonusQuestions: [],
    };

    const savedByStranger = await cards.persistOwnedCardSheet(
      CARD_ID,
      STRANGER,
      input,
    );
    assert.equal(savedByStranger, null);

    const savedByFriend = await cards.persistOwnedCardSheet(
      CARD_ID,
      FRIEND,
      input,
    );
    assert.ok(savedByFriend, "collaborator save should succeed");
    assert.equal(savedByFriend!.eventName, "Two Night Spectacular");
  });

  test("archive stays owner-only", async () => {
    const archived = await cards.archiveCard(CARD_ID, FRIEND);
    assert.equal(archived, null);
  });

  test("collaborators can leave, owner can remove, strangers cannot", async () => {
    const removedByStranger = await collaborators.removeCardCollaborator(
      CARD_ID,
      FRIEND,
      STRANGER,
    );
    assert.equal(removedByStranger, false);

    const selfLeave = await collaborators.removeCardCollaborator(
      CARD_ID,
      FRIEND,
      FRIEND,
    );
    assert.equal(selfLeave, true);

    // Re-add via a fresh invite, then let the owner remove them.
    const invite = await collaborators.createCardInvite(CARD_ID, OWNER);
    await collaborators.acceptCardInvite(invite!.token, FRIEND, null);

    const removedByOwner = await collaborators.removeCardCollaborator(
      CARD_ID,
      FRIEND,
      OWNER,
    );
    assert.equal(removedByOwner, true);

    const resolved = await cards.findResolvedReadableCardById(CARD_ID, FRIEND);
    assert.equal(resolved, null, "removed collaborator loses access");
  });
});
