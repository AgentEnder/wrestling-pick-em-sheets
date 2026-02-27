import { NextResponse } from "next/server";

import { enforceSameOrigin } from "@/lib/server/csrf";
import { readLiveGameSessionTokenFromRequest } from "@/lib/server/live-game-session";
import { checkRateLimit } from "@/lib/server/rate-limit";
import {
  hashLiveGameSessionToken,
  submitLiveGamePlayer,
} from "@/lib/server/repositories/live-games";

function requestKey(request: Request, sessionToken: string): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${ip && ip.length > 0 ? ip : "anon"}:${sessionToken.slice(0, 12)}`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const sessionToken = readLiveGameSessionTokenFromRequest(request);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = checkRateLimit(
    `submit:${requestKey(request, sessionToken)}`,
    20,
    60_000,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: "Too many submit attempts. Please wait and retry.",
        retryAfterMs: rate.retryAfterMs,
      },
      { status: 429 },
    );
  }

  const { gameId } = await context.params;
  const submitted = await submitLiveGamePlayer(
    gameId,
    hashLiveGameSessionToken(sessionToken),
  );

  if (!submitted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: submitted });
}
