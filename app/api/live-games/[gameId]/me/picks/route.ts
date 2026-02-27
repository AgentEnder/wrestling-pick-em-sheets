import { NextResponse } from "next/server";
import { z } from "zod";

import { enforceSameOrigin } from "@/lib/server/csrf";
import { readLiveGameSessionTokenFromRequest } from "@/lib/server/live-game-session";
import { checkRateLimit } from "@/lib/server/rate-limit";
import {
  hashLiveGameSessionToken,
  saveLiveGamePlayerPicks,
} from "@/lib/server/repositories/live-games";

const answerSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.string().trim().max(200),
});

const matchPickSchema = z.object({
  matchId: z.string().uuid(),
  winnerName: z.string().trim().max(160),
  battleRoyalEntrants: z
    .array(z.string().trim().min(1).max(160))
    .max(120)
    .optional()
    .default([]),
  bonusAnswers: z.array(answerSchema).max(100),
});

const picksSchema = z.object({
  matchPicks: z.array(matchPickSchema).max(100),
  eventBonusAnswers: z.array(answerSchema).max(100),
  tiebreakerAnswer: z.string().trim().max(200),
});

const picksEnvelopeSchema = z.object({
  picks: picksSchema,
  expectedUpdatedAt: z.string().datetime().optional(),
});

function requestKey(request: Request, sessionToken: string): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${ip && ip.length > 0 ? ip : "anon"}:${sessionToken.slice(0, 12)}`;
}

export async function PUT(
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
    `picks:${requestKey(request, sessionToken)}`,
    120,
    60_000,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: "Too many updates. Please wait and retry.",
        retryAfterMs: rate.retryAfterMs,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedEnvelope = picksEnvelopeSchema.safeParse(body);
  const parsedPicks = picksSchema.safeParse(body);
  if (!parsedEnvelope.success && !parsedPicks.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsedEnvelope.error.issues },
      { status: 400 },
    );
  }

  const picks = parsedEnvelope.success
    ? parsedEnvelope.data.picks
    : parsedPicks.success
      ? parsedPicks.data
      : null;
  const expectedUpdatedAt = parsedEnvelope.success
    ? parsedEnvelope.data.expectedUpdatedAt
    : undefined;
  if (!picks) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { gameId } = await context.params;
  const saved = await saveLiveGamePlayerPicks(
    gameId,
    hashLiveGameSessionToken(sessionToken),
    picks,
    expectedUpdatedAt,
  );
  if (saved === "conflict") {
    return NextResponse.json(
      { error: "Your picks changed in another session. Refresh and retry." },
      { status: 409 },
    );
  }

  if (!saved) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: saved });
}
