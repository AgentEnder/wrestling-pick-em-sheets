import { NextResponse } from "next/server";

import { getRequestUserId } from "@/lib/server/auth";
import { readLiveGameSessionTokenFromRequest } from "@/lib/server/live-game-session";
import {
  getLiveGameMe,
  hashLiveGameSessionToken,
} from "@/lib/server/repositories/live-games";

export async function GET(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
) {
  const sessionToken = readLiveGameSessionTokenFromRequest(request);
  const clerkUserId = await getRequestUserId(request);
  if (!sessionToken && !clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { gameId } = await context.params;
  const me = await getLiveGameMe(gameId, {
    sessionTokenHash: sessionToken
      ? hashLiveGameSessionToken(sessionToken)
      : null,
    clerkUserId,
  });

  if (!me) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: me });
}
