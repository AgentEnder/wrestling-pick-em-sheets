import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestUserId } from "@/lib/server/auth";
import { enforceSameOrigin } from "@/lib/server/csrf";
import { reviewLiveGameJoinRequest } from "@/lib/server/repositories/live-games";

const reviewJoinRequestSchema = z.object({
  playerId: z.string().trim().min(1),
  action: z.enum(["approve", "deny"]),
});

export async function PATCH(
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

  const body = await request.json().catch(() => null);
  const parsed = reviewJoinRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { gameId } = await context.params;
  const result = await reviewLiveGameJoinRequest(
    gameId,
    userId,
    parsed.data.playerId,
    parsed.data.action,
  );

  if (result !== "ok") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: { ok: true } });
}
