import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getRequestUserId } from '@/lib/server/auth'
import {
  findResolvedReadableCardById,
  persistOwnedCardSheet,
} from '@/lib/server/repositories/cards'

const bonusQuestionSchema = z.object({
  id: z.string().uuid(),
  question: z.string().trim(),
  points: z.number().int().min(1).max(100).nullable(),
  answerType: z.enum(['write-in', 'multiple-choice']),
  options: z.array(z.string().trim()),
})

const standardMatchSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('standard'),
  title: z.string().trim(),
  description: z.string(),
  participants: z.array(z.string()),
  bonusQuestions: z.array(bonusQuestionSchema),
  points: z.number().int().min(1).max(100).nullable(),
})

const battleRoyalMatchSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('battleRoyal'),
  title: z.string().trim(),
  description: z.string(),
  announcedParticipants: z.array(z.string()),
  surpriseSlots: z.number().int().min(0).max(100),
  bonusQuestions: z.array(bonusQuestionSchema),
  points: z.number().int().min(1).max(100).nullable(),
})

const saveCardSchema = z.object({
  eventName: z.string().trim().max(160),
  eventDate: z.string().trim().max(60),
  eventTagline: z.string().trim().max(200),
  defaultPoints: z.number().int().min(1).max(100),
  tiebreakerLabel: z.string().trim().max(200),
  matches: z.array(z.union([standardMatchSchema, battleRoyalMatchSchema])),
})

export async function GET(
  _request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const { cardId } = await context.params
  const userId = await getRequestUserId()
  const card = await findResolvedReadableCardById(cardId, userId)

  if (!card) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ data: card })
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const userId = await getRequestUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = saveCardSchema.safeParse(body)
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
  const saved = await persistOwnedCardSheet(cardId, userId, parsed.data)

  if (!saved) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ data: saved })
}
