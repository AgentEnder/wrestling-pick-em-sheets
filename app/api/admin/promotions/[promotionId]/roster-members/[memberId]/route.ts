import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureAdminRequest } from '@/lib/server/admin-auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import {
  deletePromotionRosterMember,
  updatePromotionRosterMember,
} from '@/lib/server/repositories/rosters'

const updateRosterMemberSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    aliases: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.aliases !== undefined ||
      value.isActive !== undefined,
    { message: 'At least one field must be provided' },
  )

export async function PATCH(
  request: Request,
  context: { params: Promise<{ promotionId: string; memberId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) return csrfError

  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const body = await request.json().catch(() => null)
  const parsed = updateRosterMemberSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const { promotionId, memberId } = await context.params
  const updated = await updatePromotionRosterMember(promotionId, memberId, parsed.data)
  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ promotionId: string; memberId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) return csrfError

  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const { promotionId, memberId } = await context.params
  const deleted = await deletePromotionRosterMember(promotionId, memberId)
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}
