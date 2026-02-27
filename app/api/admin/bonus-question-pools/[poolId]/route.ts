import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureAdminRequest } from "@/lib/server/admin-auth";
import { enforceSameOrigin } from "@/lib/server/csrf";
import {
  deleteBonusQuestionPool,
  updateBonusQuestionPool,
} from "@/lib/server/repositories/bonus-question-pools";

const updatePoolSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(400).optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    isActive: z.boolean().optional(),
    matchTypeIds: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
    ruleSetIds: z
      .array(z.enum(["timed-entry", "elimination"]))
      .max(10)
      .optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.sortOrder !== undefined ||
      value.isActive !== undefined ||
      value.matchTypeIds !== undefined ||
      value.ruleSetIds !== undefined,
    { message: "At least one field must be provided" },
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ poolId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const adminError = await ensureAdminRequest(request);
  if (adminError) return adminError;

  const body = await request.json().catch(() => null);
  const parsed = updatePoolSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const { poolId } = await context.params;
  const updated = await updateBonusQuestionPool(poolId, parsed.data);

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ poolId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const adminError = await ensureAdminRequest(request);
  if (adminError) return adminError;

  const { poolId } = await context.params;
  const deleted = await deleteBonusQuestionPool(poolId);

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
