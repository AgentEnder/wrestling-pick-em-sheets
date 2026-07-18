import type { ExpressionBuilder } from "kysely";

import type { DB } from "@/lib/server/db/generated";

export function isCardCollaborator(
  eb: ExpressionBuilder<DB, "cards">,
  userId: string,
) {
  return eb.exists(
    eb
      .selectFrom("card_collaborators")
      .select("card_collaborators.id")
      .whereRef("card_collaborators.card_id", "=", "cards.id")
      .where("card_collaborators.user_id", "=", userId),
  );
}

export function canReadCard(
  eb: ExpressionBuilder<DB, "cards">,
  userId: string | null,
) {
  if (!userId) {
    return eb("public", "=", 1);
  }

  return eb.or([
    eb("owner_id", "=", userId),
    eb("public", "=", 1),
    isCardCollaborator(eb, userId),
  ]);
}

export function isCardOwner(
  eb: ExpressionBuilder<DB, "cards">,
  userId: string,
) {
  return eb("owner_id", "=", userId);
}

export function canEditCard(
  eb: ExpressionBuilder<DB, "cards">,
  userId: string,
) {
  return eb.or([isCardOwner(eb, userId), isCardCollaborator(eb, userId)]);
}

export function isActiveCard(eb: ExpressionBuilder<DB, "cards">) {
  return eb("archived_at", "is", null);
}
