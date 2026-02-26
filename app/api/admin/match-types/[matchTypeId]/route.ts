import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureAdminRequest } from '@/lib/server/admin-auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import { deleteMatchType, updateMatchType } from '@/lib/server/repositories/match-types'

const updateMatchTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    isActive: z.boolean().optional(),
    defaultRuleSetIds: z.array(z.enum(['timed-entry', 'elimination'])).max(10).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.sortOrder !== undefined ||
      value.isActive !== undefined ||
      value.defaultRuleSetIds !== undefined,
    { message: 'At least one field must be provided' },
  )

export async function PATCH(
  request: Request,
  context: { params: Promise<{ matchTypeId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const adminError = await ensureAdminRequest(request)
  if (adminError) return adminError

  const body = await request.json().catch(() => null)
  const parsed = updateMatchTypeSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const { matchTypeId } = await context.params
  const updated = await updateMatchType(matchTypeId, parsed.data)

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ matchTypeId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const adminError = await ensureAdminRequest(request)
  if (adminError) return adminError

  const { matchTypeId } = await context.params
  const deleted = await deleteMatchType(matchTypeId)

  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}
