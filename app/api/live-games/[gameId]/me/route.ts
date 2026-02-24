import { NextResponse } from 'next/server'

import { readLiveGameSessionTokenFromRequest } from '@/lib/server/live-game-session'
import { getLiveGameMe, hashLiveGameSessionToken } from '@/lib/server/repositories/live-games'

export async function GET(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
) {
  const sessionToken = readLiveGameSessionTokenFromRequest(request)
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { gameId } = await context.params
  const me = await getLiveGameMe(gameId, hashLiveGameSessionToken(sessionToken))

  if (!me) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ data: me })
}
