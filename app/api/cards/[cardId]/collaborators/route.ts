import { NextResponse } from "next/server";

import { getRequestUserId } from "@/lib/server/auth";
import { listCardCollaborators } from "@/lib/server/repositories/card-collaborators";

export async function GET(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cardId } = await context.params;
  const collaborators = await listCardCollaborators(cardId, userId);
  if (!collaborators) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: collaborators });
}
