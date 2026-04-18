import { NextResponse } from "next/server";

import { enforceSameOrigin } from "@/lib/server/csrf";
import { getRequestUserId } from "@/lib/server/auth";
import { unarchiveCard } from "@/lib/server/repositories/cards";

export async function POST(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cardId } = await context.params;
  const summary = await unarchiveCard(cardId, userId);
  if (!summary) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: summary });
}
