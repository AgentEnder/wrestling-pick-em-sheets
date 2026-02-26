import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureAdminRequest } from '@/lib/server/admin-auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import { createBonusQuestionTemplate } from '@/lib/server/repositories/bonus-question-pools'

const optionSchema = z.string().trim().min(1).max(120)

const createTemplateSchema = z
  .object({
    poolId: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    questionTemplate: z.string().trim().min(1).max(260),
    defaultPoints: z.number().int().min(1).max(100).nullable().optional().default(null),
    answerType: z.enum(['write-in', 'multiple-choice']),
    options: z.array(optionSchema).max(20).optional().default([]),
    valueType: z.enum(['string', 'numerical', 'time', 'rosterMember']).optional().default('string'),
    defaultSection: z.enum(['match', 'event']).optional().default('match'),
    sortOrder: z.number().int().min(0).max(10000).optional().default(0),
    isActive: z.boolean().optional().default(true),
  })
  .refine((value) => value.answerType !== 'multiple-choice' || value.options.length >= 2, {
    path: ['options'],
    message: 'Multiple-choice templates require at least two options',
  })

function normalizeOptions(options: string[]): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const option of options) {
    const trimmed = option.trim()
    if (!trimmed) continue

    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    deduped.push(trimmed)
  }

  return deduped
}

export async function POST(request: Request) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const adminError = await ensureAdminRequest(request)
  if (adminError) return adminError

  const body = await request.json().catch(() => null)
  const parsed = createTemplateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const normalizedOptions = normalizeOptions(parsed.data.options)
  const options = parsed.data.answerType === 'multiple-choice' ? normalizedOptions : []

  if (parsed.data.answerType === 'multiple-choice' && options.length < 2) {
    return NextResponse.json(
      {
        error: 'Multiple-choice templates require at least two distinct options',
      },
      { status: 400 },
    )
  }

  const created = await createBonusQuestionTemplate({
    ...parsed.data,
    options,
  })

  if (!created) {
    return NextResponse.json({ error: 'Pool not found' }, { status: 404 })
  }

  return NextResponse.json({ data: created }, { status: 201 })
}
