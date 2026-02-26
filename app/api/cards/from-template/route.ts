import { NextResponse } from 'next/server'
import { z } from 'zod'

import { enforceSameOrigin } from '@/lib/server/csrf'
import { getRequestUserId } from '@/lib/server/auth'
import { createCardFromTemplate } from '@/lib/server/repositories/cards'

const createFromTemplateSchema = z.object({
  templateCardId: z.string().uuid(),
})

export async function POST(request: Request) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const userId = await getRequestUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = createFromTemplateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const created = await createCardFromTemplate(userId, parsed.data.templateCardId)
  if (!created) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  return NextResponse.json({ data: created }, { status: 201 })
}
