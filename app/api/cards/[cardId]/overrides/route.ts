import { NextResponse } from "next/server";
import { z } from "zod";

import { enforceSameOrigin } from "@/lib/server/csrf";
import { getRequestUserId } from "@/lib/server/auth";
import { updateCardOverrides } from "@/lib/server/repositories/cards";

const updateOverridesSchema = z
  .object({
    name: z.string().trim().min(1).max(160).nullable().optional(),
    eventName: z.string().trim().min(1).max(160).nullable().optional(),
    promotionName: z.string().trim().min(1).max(120).nullable().optional(),
    eventDate: z.string().trim().min(1).max(60).nullable().optional(),
    eventTagline: z.string().trim().max(200).nullable().optional(),
    defaultPoints: z.number().int().min(0).max(100).nullable().optional(),
    tiebreakerLabel: z.string().trim().min(1).max(200).nullable().optional(),
    tiebreakerIsTimeBased: z.boolean().nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.eventName !== undefined ||
      value.promotionName !== undefined ||
      value.eventDate !== undefined ||
      value.eventTagline !== undefined ||
      value.defaultPoints !== undefined ||
      value.tiebreakerLabel !== undefined ||
      value.tiebreakerIsTimeBased !== undefined,
    { message: "At least one override field must be provided" },
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
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
  const parsed = updateOverridesSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const { cardId } = await context.params;
  const updated = await updateCardOverrides(cardId, userId, parsed.data);

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
