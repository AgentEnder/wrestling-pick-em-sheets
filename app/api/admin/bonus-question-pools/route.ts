import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureAdminRequest } from "@/lib/server/admin-auth";
import { enforceSameOrigin } from "@/lib/server/csrf";
import {
  createBonusQuestionPool,
  listBonusQuestionPools,
} from "@/lib/server/repositories/bonus-question-pools";

const createPoolSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional().default(""),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
  isActive: z.boolean().optional().default(true),
  matchTypeIds: z
    .array(z.string().trim().min(1).max(120))
    .max(40)
    .optional()
    .default([]),
  ruleSetIds: z
    .array(z.enum(["timed-entry", "elimination"]))
    .max(10)
    .optional()
    .default([]),
});

export async function GET(request: Request) {
  const adminError = await ensureAdminRequest(request);
  if (adminError) return adminError;

  const pools = await listBonusQuestionPools({ includeInactive: true });
  return NextResponse.json({ data: pools });
}

export async function POST(request: Request) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const adminError = await ensureAdminRequest(request);
  if (adminError) return adminError;

  const body = await request.json().catch(() => null);
  const parsed = createPoolSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const created = await createBonusQuestionPool(parsed.data);
  return NextResponse.json({ data: created }, { status: 201 });
}
