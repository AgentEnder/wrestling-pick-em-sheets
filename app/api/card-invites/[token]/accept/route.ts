import { NextResponse } from "next/server";

import { enforceSameOrigin } from "@/lib/server/csrf";
import { getRequestUserEmail, getRequestUserId } from "@/lib/server/auth";
import { acceptCardInvite } from "@/lib/server/repositories/card-collaborators";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await context.params;
  const userEmail = await getRequestUserEmail(request);
  const result = await acceptCardInvite(token, userId, userEmail);

  if (result.status === "invalid") {
    return NextResponse.json(
      { error: "This invite link is no longer valid" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: result });
}
