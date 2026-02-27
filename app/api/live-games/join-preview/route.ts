import { NextResponse } from "next/server";
import { z } from "zod";

import { getLiveGameJoinPreview } from "@/lib/server/repositories/live-games";

const querySchema = z.object({
  code: z.string().trim().min(4).max(24),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    code: url.searchParams.get("code") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid join code" }, { status: 400 });
  }

  const preview = await getLiveGameJoinPreview(parsed.data.code);
  if (!preview) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      gameId: preview.game.id,
      joinCode: preview.game.joinCode,
      eventName: preview.eventName,
      status: preview.game.status,
      eventStartAt: preview.eventStartAt,
      isStarted: preview.isStarted,
      allowLateJoins: preview.game.allowLateJoins,
    },
  });
}
