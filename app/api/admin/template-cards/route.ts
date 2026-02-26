import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureAdminRequest } from '@/lib/server/admin-auth'
import { getRequestUserId } from '@/lib/server/auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import {
  createTemplateCardForAdmin,
  listTemplateCardsForAdmin,
} from '@/lib/server/repositories/cards'

const createTemplateCardSchema = z.object({
  name: z.string().trim().max(160).optional(),
  isPublic: z.boolean().optional().default(true),
})

export async function GET(request: Request) {
  const adminError = await ensureAdminRequest(request)
  if (adminError) return adminError

  const cards = await listTemplateCardsForAdmin()
  return NextResponse.json({ data: cards })
}

export async function POST(request: Request) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const adminError = await ensureAdminRequest(request)
  if (adminError) return adminError

  const userId = await getRequestUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = createTemplateCardSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const created = await createTemplateCardForAdmin(userId, parsed.data)
  return NextResponse.json({ data: created }, { status: 201 })
}
