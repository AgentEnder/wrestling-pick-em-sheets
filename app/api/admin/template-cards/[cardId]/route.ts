import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureAdminRequest } from '@/lib/server/admin-auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import {
  deleteTemplateCardForAdmin,
  updateTemplateCardForAdmin,
} from '@/lib/server/repositories/cards'

const updateTemplateCardSchema = z
  .object({
    name: z.string().trim().max(160).optional(),
    isPublic: z.boolean().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.isPublic !== undefined,
    { message: 'At least one field must be provided' },
  )

export async function PATCH(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const body = await request.json().catch(() => null)
  const parsed = updateTemplateCardSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const { cardId } = await context.params
  const updated = await updateTemplateCardForAdmin(cardId, parsed.data)

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const { cardId } = await context.params
  const deleted = await deleteTemplateCardForAdmin(cardId)

  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}
