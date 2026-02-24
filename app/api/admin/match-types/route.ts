import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureAdminRequest } from '@/lib/server/admin-auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import { createMatchType, listMatchTypes } from '@/lib/server/repositories/match-types'

const createMatchTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
  isActive: z.boolean().optional().default(true),
  defaultRuleSetIds: z.array(z.enum(['timed-entry', 'elimination'])).max(10).optional().default([]),
})

export async function GET() {
  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const matchTypes = await listMatchTypes({ includeInactive: true })
  return NextResponse.json({ data: matchTypes })
}

export async function POST(request: Request) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const body = await request.json().catch(() => null)
  const parsed = createMatchTypeSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const created = await createMatchType(parsed.data)
  return NextResponse.json({ data: created }, { status: 201 })
}
