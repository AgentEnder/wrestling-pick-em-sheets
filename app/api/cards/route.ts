import { NextResponse } from 'next/server'
import { z } from 'zod'

import { enforceSameOrigin } from '@/lib/server/csrf'
import { getRequestUserId } from '@/lib/server/auth'
import { createOwnedCard, listReadableCards } from '@/lib/server/repositories/cards'

const createCardSchema = z.object({
  name: z.string().trim().max(160).optional(),
  isPublic: z.boolean().optional().default(false),
})

export async function GET() {
  const userId = await getRequestUserId()
  const cards = await listReadableCards(userId)

  return NextResponse.json({ data: cards })
}

export async function POST(request: Request) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const userId = await getRequestUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = createCardSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const created = await createOwnedCard(userId, parsed.data)
  return NextResponse.json({ data: created }, { status: 201 })
}
