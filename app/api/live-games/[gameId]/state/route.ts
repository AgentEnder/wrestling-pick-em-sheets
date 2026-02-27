import { NextResponse } from "next/server";

import { getRequestUserId } from "@/lib/server/auth";
import { readLiveGameSessionTokenFromRequest } from "@/lib/server/live-game-session";
import {
  getLiveGameState,
  hashLiveGameSessionToken,
} from "@/lib/server/repositories/live-games";

export async function GET(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await context.params;
  const userId = await getRequestUserId(request);
  const sessionToken = readLiveGameSessionTokenFromRequest(request);
  const joinCode = new URL(request.url).searchParams.get("code");

  const state = await getLiveGameState(gameId, {
    hostUserId: userId,
    sessionTokenHash: sessionToken
      ? hashLiveGameSessionToken(sessionToken)
      : null,
    joinCode,
  });

  if (!state) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: state });
}
