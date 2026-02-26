import { NextResponse } from 'next/server'
import { z } from 'zod'

import { enforceSameOrigin } from '@/lib/server/csrf'
import { readLiveGameSessionTokenFromRequest } from '@/lib/server/live-game-session'
import {
  hashLiveGameSessionToken,
  removeLiveGamePushSubscriptionForPlayer,
  upsertLiveGamePushSubscriptionForPlayer,
} from '@/lib/server/repositories/live-games'

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional().default(null),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) return csrfError

  const sessionToken = readLiveGameSessionTokenFromRequest(request)
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = pushSubscriptionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', issues: parsed.error.issues }, { status: 400 })
  }

  const { gameId } = await context.params
  const result = await upsertLiveGamePushSubscriptionForPlayer(
    gameId,
    hashLiveGameSessionToken(sessionToken),
    parsed.data,
  )

  if (result === 'unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (result === 'inactive') {
    return NextResponse.json({ error: 'Game is not active' }, { status: 409 })
  }

  return NextResponse.json({ data: { ok: true } })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) return csrfError

  const sessionToken = readLiveGameSessionTokenFromRequest(request)
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = unsubscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', issues: parsed.error.issues }, { status: 400 })
  }

  const { gameId } = await context.params
  const ok = await removeLiveGamePushSubscriptionForPlayer(
    gameId,
    hashLiveGameSessionToken(sessionToken),
    parsed.data.endpoint,
  )

  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ data: { ok: true } })
}
