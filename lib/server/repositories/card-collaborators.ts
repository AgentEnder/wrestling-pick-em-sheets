import { randomBytes, randomUUID } from "crypto";

import { db } from "@/lib/server/db/client";
import { isCardOwner } from "@/lib/server/db/permissions";
import { requireDbId } from "@/lib/server/db/types";

export interface CardInviteSummary {
  id: string;
  cardId: string;
  token: string;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface CardCollaboratorSummary {
  id: string;
  cardId: string;
  userId: string;
  userEmail: string | null;
  addedAt: string;
}

export interface CardInvitePreview {
  cardId: string;
  cardName: string;
  eventName: string;
  viewerIsOwner: boolean;
  viewerIsCollaborator: boolean;
}

export type AcceptCardInviteResult =
  | { status: "joined" | "already-collaborator" | "owner"; cardId: string }
  | { status: "invalid" };

async function findOwnedCardId(
  cardId: string,
  ownerId: string,
): Promise<string | null> {
  const card = await db
    .selectFrom("cards")
    .select(["id"])
    .where("id", "=", cardId)
    .where((eb) => isCardOwner(eb, ownerId))
    .executeTakeFirst();

  return card ? requireDbId(card.id, "cards.id") : null;
}

export async function createCardInvite(
  cardId: string,
  ownerId: string,
): Promise<CardInviteSummary | null> {
  const ownedCardId = await findOwnedCardId(cardId, ownerId);
  if (!ownedCardId) return null;

  const now = new Date().toISOString();
  const id = randomUUID();
  const token = randomBytes(24).toString("base64url");

  await db
    .insertInto("card_invites")
    .values({
      id,
      card_id: ownedCardId,
      token,
      created_by: ownerId,
      created_at: now,
      expires_at: null,
      revoked_at: null,
    })
    .execute();

  return {
    id,
    cardId: ownedCardId,
    token,
    createdBy: ownerId,
    createdAt: now,
    revokedAt: null,
  };
}

export async function listCardInvites(
  cardId: string,
  ownerId: string,
): Promise<CardInviteSummary[] | null> {
  const ownedCardId = await findOwnedCardId(cardId, ownerId);
  if (!ownedCardId) return null;

  const rows = await db
    .selectFrom("card_invites")
    .selectAll()
    .where("card_id", "=", ownedCardId)
    .where("revoked_at", "is", null)
    .orderBy("created_at", "desc")
    .execute();

  return rows.map((row) => ({
    id: requireDbId(row.id, "card_invites.id"),
    cardId: row.card_id,
    token: row.token,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeCardInvite(
  cardId: string,
  inviteId: string,
  ownerId: string,
): Promise<boolean> {
  const ownedCardId = await findOwnedCardId(cardId, ownerId);
  if (!ownedCardId) return false;

  const result = await db
    .updateTable("card_invites")
    .set({ revoked_at: new Date().toISOString() })
    .where("id", "=", inviteId)
    .where("card_id", "=", ownedCardId)
    .where("revoked_at", "is", null)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0) > 0;
}

interface ActiveInviteRow {
  id: string;
  card_id: string;
  card_name: string | null;
  card_event_name: string | null;
  card_owner_id: string | null;
}

function isInviteExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) && parsed <= Date.now();
}

async function findActiveInviteByToken(
  token: string,
): Promise<ActiveInviteRow | null> {
  const row = await db
    .selectFrom("card_invites")
    .innerJoin("cards", "cards.id", "card_invites.card_id")
    .select([
      "card_invites.id as id",
      "card_invites.card_id as card_id",
      "card_invites.expires_at as expires_at",
      "cards.name as card_name",
      "cards.event_name as card_event_name",
      "cards.owner_id as card_owner_id",
    ])
    .where("card_invites.token", "=", token)
    .where("card_invites.revoked_at", "is", null)
    .executeTakeFirst();

  if (!row || isInviteExpired(row.expires_at)) return null;

  return {
    id: requireDbId(row.id, "card_invites.id"),
    card_id: row.card_id,
    card_name: row.card_name,
    card_event_name: row.card_event_name,
    card_owner_id: row.card_owner_id,
  };
}

export async function previewCardInvite(
  token: string,
  userId: string | null,
): Promise<CardInvitePreview | null> {
  const invite = await findActiveInviteByToken(token);
  if (!invite) return null;

  let viewerIsCollaborator = false;
  if (userId) {
    const collaborator = await db
      .selectFrom("card_collaborators")
      .select(["id"])
      .where("card_id", "=", invite.card_id)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    viewerIsCollaborator = Boolean(collaborator);
  }

  return {
    cardId: invite.card_id,
    cardName: invite.card_name ?? "Untitled card",
    eventName: invite.card_event_name ?? "",
    viewerIsOwner: Boolean(userId) && invite.card_owner_id === userId,
    viewerIsCollaborator,
  };
}

export async function acceptCardInvite(
  token: string,
  userId: string,
  userEmail: string | null,
): Promise<AcceptCardInviteResult> {
  const invite = await findActiveInviteByToken(token);
  if (!invite) return { status: "invalid" };

  if (invite.card_owner_id === userId) {
    return { status: "owner", cardId: invite.card_id };
  }

  const existing = await db
    .selectFrom("card_collaborators")
    .select(["id"])
    .where("card_id", "=", invite.card_id)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (existing) {
    return { status: "already-collaborator", cardId: invite.card_id };
  }

  await db
    .insertInto("card_collaborators")
    .values({
      id: randomUUID(),
      card_id: invite.card_id,
      user_id: userId,
      user_email: userEmail,
      invite_id: invite.id,
      added_at: new Date().toISOString(),
    })
    .onConflict((oc) => oc.columns(["card_id", "user_id"]).doNothing())
    .execute();

  return { status: "joined", cardId: invite.card_id };
}

export async function listCardCollaborators(
  cardId: string,
  ownerId: string,
): Promise<CardCollaboratorSummary[] | null> {
  const ownedCardId = await findOwnedCardId(cardId, ownerId);
  if (!ownedCardId) return null;

  const rows = await db
    .selectFrom("card_collaborators")
    .selectAll()
    .where("card_id", "=", ownedCardId)
    .orderBy("added_at", "asc")
    .execute();

  return rows.map((row) => ({
    id: requireDbId(row.id, "card_collaborators.id"),
    cardId: row.card_id,
    userId: row.user_id,
    userEmail: row.user_email,
    addedAt: row.added_at,
  }));
}

export async function removeCardCollaborator(
  cardId: string,
  collaboratorUserId: string,
  requesterId: string,
): Promise<boolean> {
  // The owner can remove anyone; a collaborator can only remove themselves.
  if (collaboratorUserId !== requesterId) {
    const ownedCardId = await findOwnedCardId(cardId, requesterId);
    if (!ownedCardId) return false;
  }

  const result = await db
    .deleteFrom("card_collaborators")
    .where("card_id", "=", cardId)
    .where("user_id", "=", collaboratorUserId)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}
