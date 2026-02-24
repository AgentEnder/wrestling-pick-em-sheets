import { NextResponse } from 'next/server'
import { z } from 'zod'

import { enforceSameOrigin } from '@/lib/server/csrf'
import { readLiveGameSessionTokenFromRequest, writeLiveGameSessionToken } from '@/lib/server/live-game-session'
import { checkRateLimit } from '@/lib/server/rate-limit'
import {
  createLiveGameSessionToken,
  hashLiveGameSessionToken,
  joinLiveGameWithNickname,
} from '@/lib/server/repositories/live-games'

const joinSchema = z.object({
  joinCode: z.string().trim().min(4).max(24),
  nickname: z.string().trim().min(1).max(60),
})

function requestKey(request: Request): string {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return ip && ip.length > 0 ? ip : 'anon'
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const rate = checkRateLimit(`join:${requestKey(request)}`, 30, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: 'Too many join attempts. Please wait a moment.',
        retryAfterMs: rate.retryAfterMs,
      },
      { status: 429 },
    )
  }

  const body = await request.json().catch(() => null)
  const parsed = joinSchema.safeParse(body)
  if (!parsed.success) {
    return badRequest('Invalid request body')
  }

  const existingToken = readLiveGameSessionTokenFromRequest(request)
  const token = existingToken ?? createLiveGameSessionToken()
  const sessionHash = hashLiveGameSessionToken(token)

  const joined = await joinLiveGameWithNickname(
    parsed.data.joinCode,
    parsed.data.nickname,
    sessionHash,
  )

  if (!joined.ok) {
    if (joined.reason === 'not-found') {
      return badRequest('Join code not found', 404)
    }

    if (joined.reason === 'ended') {
      return badRequest('This game has ended', 409)
    }

    if (joined.reason === 'expired') {
      return badRequest('This game code has expired', 410)
    }

    return badRequest('Nickname is already taken in this room', 409)
  }

  const response = NextResponse.json({
    data: {
      gameId: joined.game.id,
      joinCode: joined.game.joinCode,
      player: joined.player,
      isNew: joined.isNew,
    },
  })

  writeLiveGameSessionToken(response, token, request)
  return response
}
