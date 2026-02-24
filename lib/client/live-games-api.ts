import type {
  LiveGame,
  LiveGameKeyPayload,
  LiveGameLockState,
  LivePlayerPicksPayload,
} from '@/lib/types'
import type { ResolvedCard } from '@/lib/client/cards-api'

interface ApiErrorBody {
  error?: string
}

interface ApiDataEnvelope<T> {
  data: T
}

export interface CreateLiveGameResponse {
  game: LiveGame
  hostUrl: string
  displayUrl: string
  joinUrl: string
}

export interface LiveGameStateResponse {
  game: LiveGame
  card: ResolvedCard
  leaderboard: Array<{
    rank: number
    nickname: string
    score: number
    breakdown: {
      winnerPoints: number
      bonusPoints: number
      surprisePoints: number
    }
    isSubmitted: boolean
    lastUpdatedAt: string
    lastSeenAt: string
  }>
  events: Array<{
    id: string
    type: string
    message: string
    createdAt: string
  }>
  playerCount: number
  submittedCount: number
}

export interface LiveGameMeResponse {
  game: LiveGame
  card: ResolvedCard
  player: {
    id: string
    gameId: string
    nickname: string
    picks: LivePlayerPicksPayload
    isSubmitted: boolean
    submittedAt: string | null
    joinedAt: string
    lastSeenAt: string
    updatedAt: string
  }
  locks: {
    globalLocked: boolean
    matchLocks: Record<string, boolean>
    matchBonusLocks: Record<string, boolean>
    eventBonusLocks: Record<string, boolean>
    tiebreakerLocked: boolean
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`

  try {
    const body = (await response.json()) as ApiErrorBody
    if (body.error && body.error.trim()) {
      return body.error
    }

    return fallback
  } catch {
    return fallback
  }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  const body = (await response.json()) as ApiDataEnvelope<T>
  return body.data
}

export function listLiveGames(cardId: string): Promise<LiveGame[]> {
  return requestJson<LiveGame[]>(`/api/cards/${cardId}/live-games`)
}

export function createLiveGame(cardId: string): Promise<CreateLiveGameResponse> {
  return requestJson<CreateLiveGameResponse>(`/api/cards/${cardId}/live-games`, {
    method: 'POST',
  })
}

export function getLiveGameState(gameId: string, joinCode?: string): Promise<LiveGameStateResponse> {
  const suffix = joinCode ? `?code=${encodeURIComponent(joinCode)}` : ''
  return requestJson<LiveGameStateResponse>(`/api/live-games/${gameId}/state${suffix}`)
}

export function updateLiveGameStatus(gameId: string, status: LiveGame['status']): Promise<LiveGame> {
  return requestJson<LiveGame>(`/api/live-games/${gameId}/status`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ status }),
  })
}

export function updateLiveGameLocks(gameId: string, lockState: LiveGameLockState): Promise<LiveGame> {
  return requestJson<LiveGame>(`/api/live-games/${gameId}/locks`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(lockState),
  })
}

export function getLiveGameKey(gameId: string): Promise<{
  game: LiveGame
  card: ResolvedCard
  key: LiveGameKeyPayload
  locks: LiveGameLockState
}> {
  return requestJson(`/api/live-games/${gameId}/key`)
}

export function saveLiveGameKey(gameId: string, payload: LiveGameKeyPayload): Promise<LiveGame> {
  return requestJson<LiveGame>(`/api/live-games/${gameId}/key`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function joinLiveGame(joinCode: string, nickname: string): Promise<{
  gameId: string
  joinCode: string
  player: LiveGameMeResponse['player']
  isNew: boolean
}> {
  return requestJson('/api/live-games/join', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ joinCode, nickname }),
  })
}

export function getLiveGameMe(gameId: string): Promise<LiveGameMeResponse> {
  return requestJson<LiveGameMeResponse>(`/api/live-games/${gameId}/me`)
}

export function saveMyLiveGamePicks(
  gameId: string,
  picks: LivePlayerPicksPayload,
): Promise<{ player: LiveGameMeResponse['player']; ignoredLocks: string[] }> {
  return requestJson(`/api/live-games/${gameId}/me/picks`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(picks),
  })
}

export function submitMyLiveGamePicks(gameId: string): Promise<LiveGameMeResponse['player']> {
  return requestJson(`/api/live-games/${gameId}/me/submit`, {
    method: 'POST',
  })
}
