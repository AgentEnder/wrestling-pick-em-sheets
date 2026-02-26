import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getRequestUserId } from '@/lib/server/auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import {
  getLiveGameKeyForHost,
  updateLiveGameKeyForHost,
} from '@/lib/server/repositories/live-games'
import { normalizeLiveKeyPayload } from '@/lib/server/repositories/live-keys'

const answerSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.string().trim().max(200),
  recordedAt: z.string().datetime().nullable(),
  timerId: z.string().trim().min(1).max(200).nullable(),
})

const matchResultSchema = z.object({
  matchId: z.string().uuid(),
  winnerName: z.string().trim().max(160),
  winnerRecordedAt: z.string().datetime().nullable(),
  battleRoyalEntryOrder: z.array(z.string().trim().min(1).max(160)).max(120).optional().default([]),
  bonusAnswers: z.array(answerSchema).max(100),
})

const timerSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().max(160),
  elapsedMs: z.number().min(0).max(1000 * 60 * 60 * 24),
  isRunning: z.boolean(),
  startedAt: z.string().datetime().nullable(),
})

const scoreOverrideSchema = z.object({
  questionId: z.string(),
  playerNickname: z.string(),
  accepted: z.boolean(),
  source: z.enum(['auto', 'host']),
  confidence: z.number().min(0).max(1),
})

const winnerOverrideSchema = z.object({
  matchId: z.string(),
  playerNickname: z.string(),
  accepted: z.boolean(),
  source: z.enum(['auto', 'host']),
  confidence: z.number().min(0).max(1),
})

const liveKeyPayloadSchema = z.object({
  timers: z.array(timerSchema).max(200),
  matchResults: z.array(matchResultSchema).max(100),
  eventBonusAnswers: z.array(answerSchema).max(100),
  tiebreakerAnswer: z.string().trim().max(200),
  tiebreakerRecordedAt: z.string().datetime().nullable(),
  tiebreakerTimerId: z.string().trim().min(1).max(200).nullable(),
  scoreOverrides: z.array(scoreOverrideSchema).max(500).optional().default([]),
  winnerOverrides: z.array(winnerOverrideSchema).max(500).optional().default([]),
})

const liveKeyPutEnvelopeSchema = z.object({
  payload: liveKeyPayloadSchema,
  expectedUpdatedAt: z.string().datetime().optional(),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
) {
  const userId = await getRequestUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { gameId } = await context.params
  const state = await getLiveGameKeyForHost(gameId, userId)

  if (!state) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    data: {
      game: state.game,
      card: state.card,
      key: state.game.keyPayload,
      locks: state.game.lockState,
    },
  })
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
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
  const parsedEnvelope = liveKeyPutEnvelopeSchema.safeParse(body)
  const parsedPayload = liveKeyPayloadSchema.safeParse(body)
  if (!parsedEnvelope.success && !parsedPayload.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsedEnvelope.error.issues,
      },
      { status: 400 },
    )
  }

  const payload = parsedEnvelope.success
    ? parsedEnvelope.data.payload
    : parsedPayload.success
      ? parsedPayload.data
      : null
  const expectedUpdatedAt = parsedEnvelope.success ? parsedEnvelope.data.expectedUpdatedAt : undefined
  if (!payload) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
      },
      { status: 400 },
    )
  }
  const { gameId } = await context.params
  const updated = await updateLiveGameKeyForHost(gameId, userId, normalizeLiveKeyPayload(payload), expectedUpdatedAt)
  if (updated === 'conflict') {
    return NextResponse.json(
      { error: 'Game key changed in another session. Refresh and retry.' },
      { status: 409 },
    )
  }

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ data: updated })
}
