import { NextResponse } from "next/server";

import { enforceSameOrigin } from "@/lib/server/csrf";
import { getRequestUserId } from "@/lib/server/auth";
import {
  createCardInvite,
  listCardInvites,
} from "@/lib/server/repositories/card-collaborators";

export async function GET(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cardId } = await context.params;
  const invites = await listCardInvites(cardId, userId);
  if (!invites) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: invites });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cardId } = await context.params;
  const invite = await createCardInvite(cardId, userId);
  if (!invite) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: invite }, { status: 201 });
}
