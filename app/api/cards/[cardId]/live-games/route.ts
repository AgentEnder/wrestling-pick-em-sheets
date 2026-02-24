import { NextResponse } from 'next/server'

import { getRequestUserId } from '@/lib/server/auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import { createLiveGame, listCardLiveGames } from '@/lib/server/repositories/live-games'

function buildHostUrls(request: Request, gameId: string, joinCode: string) {
  const origin = new URL(request.url).origin
  return {
    hostUrl: `${origin}/games/${gameId}/host`,
    displayUrl: `${origin}/games/${gameId}/display?code=${encodeURIComponent(joinCode)}`,
    joinUrl: `${origin}/join?code=${encodeURIComponent(joinCode)}`,
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const userId = await getRequestUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { cardId } = await context.params
  const games = await listCardLiveGames(cardId, userId)

  if (!games) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ data: games })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const userId = await getRequestUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { cardId } = await context.params
  const game = await createLiveGame(cardId, userId)

  if (!game) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(
    {
      data: {
        game,
        ...buildHostUrls(request, game.id, game.joinCode),
      },
    },
    { status: 201 },
  )
}
