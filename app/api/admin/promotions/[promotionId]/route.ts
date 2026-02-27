import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureAdminRequest } from "@/lib/server/admin-auth";
import { enforceSameOrigin } from "@/lib/server/csrf";
import {
  deletePromotion,
  updatePromotion,
} from "@/lib/server/repositories/rosters";

const updatePromotionSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    aliases: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.aliases !== undefined ||
      value.sortOrder !== undefined ||
      value.isActive !== undefined,
    { message: "At least one field must be provided" },
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ promotionId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const adminError = await ensureAdminRequest(request);
  if (adminError) return adminError;

  const body = await request.json().catch(() => null);
  const parsed = updatePromotionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const { promotionId } = await context.params;
  const updated = await updatePromotion(promotionId, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ promotionId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const adminError = await ensureAdminRequest(request);
  if (adminError) return adminError;

  const { promotionId } = await context.params;
  const deleted = await deletePromotion(promotionId);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
