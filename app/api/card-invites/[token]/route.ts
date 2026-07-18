import { NextResponse } from "next/server";

import { getRequestUserId } from "@/lib/server/auth";
import { previewCardInvite } from "@/lib/server/repositories/card-collaborators";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const userId = await getRequestUserId(request);
  const { token } = await context.params;

  const preview = await previewCardInvite(token, userId);
  if (!preview) {
    return NextResponse.json(
      { error: "This invite link is no longer valid" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: preview });
}
