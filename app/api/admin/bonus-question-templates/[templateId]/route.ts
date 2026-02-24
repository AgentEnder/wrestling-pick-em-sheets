import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureAdminRequest } from '@/lib/server/admin-auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import {
  deleteBonusQuestionTemplate,
  updateBonusQuestionTemplate,
} from '@/lib/server/repositories/bonus-question-pools'

const optionSchema = z.string().trim().min(1).max(120)

const updateTemplateSchema = z
  .object({
    poolId: z.string().trim().min(1).max(120).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    questionTemplate: z.string().trim().min(1).max(260).optional(),
    defaultPoints: z.number().int().min(1).max(100).nullable().optional(),
    answerType: z.enum(['write-in', 'multiple-choice']).optional(),
    options: z.array(optionSchema).max(20).optional(),
    valueType: z.enum(['string', 'numerical', 'time', 'rosterMember']).optional(),
    defaultSection: z.enum(['match', 'event']).optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.poolId !== undefined ||
      value.label !== undefined ||
      value.questionTemplate !== undefined ||
      value.defaultPoints !== undefined ||
      value.answerType !== undefined ||
      value.options !== undefined ||
      value.valueType !== undefined ||
      value.defaultSection !== undefined ||
      value.sortOrder !== undefined ||
      value.isActive !== undefined,
    { message: 'At least one field must be provided' },
  )

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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const body = await request.json().catch(() => null)
  const parsed = updateTemplateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const options =
    parsed.data.options === undefined
      ? undefined
      : normalizeOptions(parsed.data.options)

  if (parsed.data.answerType === 'multiple-choice') {
    if (options !== undefined && options.length < 2) {
      return NextResponse.json(
        {
          error: 'Multiple-choice templates require at least two distinct options',
        },
        { status: 400 },
      )
    }
  } else if (parsed.data.answerType === undefined && options !== undefined && options.length === 1) {
    return NextResponse.json(
      {
        error: 'When updating options, provide at least two distinct options',
      },
      { status: 400 },
    )
  }

  const normalizedInput = {
    ...parsed.data,
    options:
      parsed.data.answerType !== undefined && parsed.data.answerType === 'write-in'
        ? []
        : options,
  }

  const { templateId } = await context.params
  const updated = await updateBonusQuestionTemplate(templateId, normalizedInput)

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ templateId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const { templateId } = await context.params
  const deleted = await deleteBonusQuestionTemplate(templateId)

  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}
