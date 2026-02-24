import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureAdminRequest } from '@/lib/server/admin-auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import {
  createPromotionRosterMember,
  listPromotionRosterMembers,
} from '@/lib/server/repositories/rosters'

const createRosterMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(30).optional().default([]),
  isActive: z.boolean().optional().default(true),
})

export async function GET(
  _request: Request,
  context: { params: Promise<{ promotionId: string }> },
) {
  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const { promotionId } = await context.params
  const members = await listPromotionRosterMembers(promotionId, { includeInactive: true })
  return NextResponse.json({ data: members })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ promotionId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) return csrfError

  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const body = await request.json().catch(() => null)
  const parsed = createRosterMemberSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const { promotionId } = await context.params
  const created = await createPromotionRosterMember(promotionId, parsed.data)
  if (!created) {
    return NextResponse.json({ error: 'Promotion not found' }, { status: 404 })
  }

  return NextResponse.json({ data: created }, { status: 201 })
}
