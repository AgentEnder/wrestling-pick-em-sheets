import { NextResponse } from "next/server";

import { getRequestUserId } from "@/lib/server/auth";
import { enforceSameOrigin } from "@/lib/server/csrf";
import { restoreLiveGame } from "@/lib/server/repositories/live-games";

export async function POST(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { gameId } = await context.params;
  const game = await restoreLiveGame(gameId, userId);
  if (!game) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: { id: game.id, deletedAt: null },
  });
}
