import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureAdminRequest } from '@/lib/server/admin-auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import { createPromotion, listPromotions } from '@/lib/server/repositories/rosters'

const createPromotionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(30).optional().default([]),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
  isActive: z.boolean().optional().default(true),
})

export async function GET(request: Request) {
  const adminError = await ensureAdminRequest(request)
  if (adminError) return adminError

  const promotions = await listPromotions({ includeInactive: true })
  return NextResponse.json({ data: promotions })
}

export async function POST(request: Request) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) return csrfError

  const adminError = await ensureAdminRequest(request)
  if (adminError) return adminError

  const body = await request.json().catch(() => null)
  const parsed = createPromotionSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const created = await createPromotion(parsed.data)
  return NextResponse.json({ data: created }, { status: 201 })
}
