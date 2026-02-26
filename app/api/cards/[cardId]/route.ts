import { NextResponse } from 'next/server'
import { z } from 'zod'

import { DEFAULT_BATTLE_ROYAL_MATCH_TYPE_ID, DEFAULT_MATCH_TYPE_ID, normalizeMatchTypeId } from '@/lib/match-types'
import { enforceSameOrigin } from '@/lib/server/csrf'
import { getRequestUserId } from '@/lib/server/auth'
import {
  findResolvedReadableCardById,
  persistOwnedCardSheet,
} from '@/lib/server/repositories/cards'

const MAX_MATCHES = 100
const MAX_BONUS_QUESTIONS = 25
const MAX_OPTIONS = 20
const MAX_PARTICIPANTS = 100

const boundedText = (max: number) => z.string().trim().max(max)
const shortName = boundedText(120)

const bonusQuestionSchema = z.object({
  id: z.string().uuid(),
  question: boundedText(200),
  points: z.number().int().min(1).max(100).nullable(),
  answerType: z.enum(['write-in', 'multiple-choice']),
  options: z.array(shortName).max(MAX_OPTIONS),
  valueType: z.enum(['string', 'numerical', 'time', 'rosterMember']).optional().default('string'),
  gradingRule: z.enum(['exact', 'closest', 'atOrAbove', 'atOrBelow']).optional().default('exact'),
})

const normalizedMatchSchema = z.object({
  id: z.string().uuid(),
  type: z.string().trim().min(1).max(120),
  typeLabelOverride: z.string().trim().max(120).optional().default(''),
  isBattleRoyal: z.boolean().optional().default(false),
  isEliminationStyle: z.boolean().optional().default(false),
  title: boundedText(160),
  description: boundedText(500),
  participants: z.array(shortName).max(MAX_PARTICIPANTS).optional().default([]),
  surpriseSlots: z.number().int().min(0).max(100).optional().default(0),
  surpriseEntrantPoints: z.number().int().min(1).max(100).nullable().optional().default(null),
  bonusQuestions: z.array(bonusQuestionSchema).max(MAX_BONUS_QUESTIONS),
  points: z.number().int().min(1).max(100).nullable(),
}).transform((value) => {
  const isBattleRoyal = value.isBattleRoyal === true
  return {
    ...value,
    type: normalizeMatchTypeId(value.type, isBattleRoyal),
    isBattleRoyal,
    isEliminationStyle: value.isEliminationStyle === true,
    surpriseSlots: isBattleRoyal ? value.surpriseSlots : 0,
    surpriseEntrantPoints: isBattleRoyal ? value.surpriseEntrantPoints : null,
  }
})

const legacyStandardMatchSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('standard'),
  title: boundedText(160),
  description: boundedText(500),
  participants: z.array(shortName).max(MAX_PARTICIPANTS),
  typeLabelOverride: z.string().trim().max(120).optional().default(''),
  bonusQuestions: z.array(bonusQuestionSchema).max(MAX_BONUS_QUESTIONS),
  points: z.number().int().min(1).max(100).nullable(),
}).strict().transform((value) => ({
  ...value,
  type: DEFAULT_MATCH_TYPE_ID,
  typeLabelOverride: value.typeLabelOverride,
  isBattleRoyal: false,
  isEliminationStyle: false,
  surpriseSlots: 0,
  surpriseEntrantPoints: null,
}))

const legacyBattleRoyalMatchSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('battleRoyal'),
  title: boundedText(160),
  description: boundedText(500),
  announcedParticipants: z.array(shortName).max(MAX_PARTICIPANTS),
  typeLabelOverride: z.string().trim().max(120).optional().default(''),
  surpriseSlots: z.number().int().min(0).max(100),
  surpriseEntrantPoints: z.number().int().min(1).max(100).nullable().optional().default(null),
  bonusQuestions: z.array(bonusQuestionSchema).max(MAX_BONUS_QUESTIONS),
  points: z.number().int().min(1).max(100).nullable(),
}).strict().transform((value) => ({
  id: value.id,
  type: DEFAULT_BATTLE_ROYAL_MATCH_TYPE_ID,
  typeLabelOverride: value.typeLabelOverride,
  isBattleRoyal: true,
  isEliminationStyle: false,
  title: value.title,
  description: value.description,
  participants: value.announcedParticipants,
  surpriseSlots: value.surpriseSlots,
  surpriseEntrantPoints: value.surpriseEntrantPoints,
  bonusQuestions: value.bonusQuestions,
  points: value.points,
}))

const saveCardSchema = z.object({
  eventName: z.string().trim().max(160),
  promotionName: z.string().trim().max(120),
  eventDate: z.string().trim().max(60),
  eventTagline: z.string().trim().max(200),
  defaultPoints: z.number().int().min(1).max(100),
  tiebreakerLabel: z.string().trim().max(200),
  tiebreakerIsTimeBased: z.boolean().optional().default(false),
  matches: z.array(z.union([legacyStandardMatchSchema, legacyBattleRoyalMatchSchema, normalizedMatchSchema])).max(MAX_MATCHES),
  eventBonusQuestions: z.array(bonusQuestionSchema).max(MAX_BONUS_QUESTIONS).optional().default([]),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const { cardId } = await context.params
  const userId = await getRequestUserId(request)
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
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const userId = await getRequestUserId(request)
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
