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

const liveKeyPayloadSchema = z.object({
  timers: z.array(timerSchema).max(200),
  matchResults: z.array(matchResultSchema).max(100),
  eventBonusAnswers: z.array(answerSchema).max(100),
  tiebreakerAnswer: z.string().trim().max(200),
  tiebreakerRecordedAt: z.string().datetime().nullable(),
  tiebreakerTimerId: z.string().trim().min(1).max(200).nullable(),
})

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameId: string }> },
) {
  const userId = await getRequestUserId()
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

  const userId = await getRequestUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = liveKeyPayloadSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const { gameId } = await context.params
  const updated = await updateLiveGameKeyForHost(gameId, userId, normalizeLiveKeyPayload(parsed.data))

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ data: updated })
}
