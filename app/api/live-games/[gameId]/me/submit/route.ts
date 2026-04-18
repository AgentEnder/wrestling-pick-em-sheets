import { NextResponse } from "next/server";

import { getRequestUserId } from "@/lib/server/auth";
import { enforceSameOrigin } from "@/lib/server/csrf";
import { readLiveGameSessionTokenFromRequest } from "@/lib/server/live-game-session";
import { checkRateLimit } from "@/lib/server/rate-limit";
import {
  hashLiveGameSessionToken,
  submitLiveGamePlayer,
} from "@/lib/server/repositories/live-games";

function requestKey(
  request: Request,
  identity: { sessionToken?: string | null; clerkUserId?: string | null },
): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipPart = ip && ip.length > 0 ? ip : "anon";
  if (identity.sessionToken) {
    return `${ipPart}:s:${identity.sessionToken.slice(0, 12)}`;
  }
  if (identity.clerkUserId) {
    return `${ipPart}:c:${identity.clerkUserId.slice(0, 24)}`;
  }
  return ipPart;
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
  const clerkUserId = await getRequestUserId(request);
  if (!sessionToken && !clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = checkRateLimit(
    `submit:${requestKey(request, { sessionToken, clerkUserId })}`,
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
  const submitted = await submitLiveGamePlayer(gameId, {
    sessionTokenHash: sessionToken
      ? hashLiveGameSessionToken(sessionToken)
      : null,
    clerkUserId,
  });

  if (!submitted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: submitted });
}
