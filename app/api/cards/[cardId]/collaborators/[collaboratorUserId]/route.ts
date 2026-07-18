import { NextResponse } from "next/server";

import { enforceSameOrigin } from "@/lib/server/csrf";
import { getRequestUserId } from "@/lib/server/auth";
import { removeCardCollaborator } from "@/lib/server/repositories/card-collaborators";

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ cardId: string; collaboratorUserId: string }>;
  },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cardId, collaboratorUserId } = await context.params;
  const removed = await removeCardCollaborator(
    cardId,
    decodeURIComponent(collaboratorUserId),
    userId,
  );
  if (!removed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
