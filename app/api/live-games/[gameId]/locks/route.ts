import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestUserId } from "@/lib/server/auth";
import { enforceSameOrigin } from "@/lib/server/csrf";
import { updateLiveGameLocks } from "@/lib/server/repositories/live-games";

const lockItemSchema = z.object({
  locked: z.boolean(),
  source: z.enum(["host", "timer"]).optional().default("host"),
});

const lockStateSchema = z.object({
  globalLocked: z.boolean().optional().default(false),
  matchLocks: z.record(z.string(), lockItemSchema).optional().default({}),
  matchBonusLocks: z.record(z.string(), lockItemSchema).optional().default({}),
  eventBonusLocks: z.record(z.string(), lockItemSchema).optional().default({}),
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
  const parsed = lockStateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { gameId } = await context.params;
  const updated = await updateLiveGameLocks(gameId, userId, parsed.data);

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: updated });
}
