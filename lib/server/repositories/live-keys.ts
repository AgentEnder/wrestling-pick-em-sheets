import { randomBytes, randomUUID } from 'crypto'

import type { Insertable, Selectable } from 'kysely'

import { db } from '@/lib/server/db/client'
import type { LiveGames } from '@/lib/server/db/generated'
import { canReadCard } from '@/lib/server/db/permissions'
import type {
  CardLiveKey,
  CardLiveKeyPayload,
  LiveKeyAnswer,
  LiveKeyMatchResult,
  LiveKeyTimer,
  ScoreOverride,
  WinnerOverride,
} from '@/lib/types'

type LiveGameSelectable = Selectable<LiveGames>

const SOLO_JOIN_CODE_PREFIX = 'SOLO'
const SOLO_EXPIRES_AT = '2100-01-01T00:00:00.000Z'

function normalizeLiveKeyAnswer(value: unknown): LiveKeyAnswer | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<LiveKeyAnswer>
  if (typeof raw.questionId !== 'string') return null

  return {
    questionId: raw.questionId,
    answer: typeof raw.answer === 'string' ? raw.answer : '',
    recordedAt: typeof raw.recordedAt === 'string' ? raw.recordedAt : null,
    timerId: typeof raw.timerId === 'string' ? raw.timerId : null,
  }
}

function normalizeLiveKeyTimer(value: unknown): LiveKeyTimer | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<LiveKeyTimer>
  if (typeof raw.id !== 'string') return null

  return {
    id: raw.id,
    label: typeof raw.label === 'string' ? raw.label : '',
    elapsedMs: typeof raw.elapsedMs === 'number' && Number.isFinite(raw.elapsedMs)
      ? Math.max(0, raw.elapsedMs)
      : 0,
    isRunning: raw.isRunning === true,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
  }
}

function normalizeLiveKeyMatchResult(value: unknown): LiveKeyMatchResult | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<LiveKeyMatchResult>
  if (typeof raw.matchId !== 'string') return null

  const bonusAnswers = Array.isArray(raw.bonusAnswers)
    ? raw.bonusAnswers
      .map((answer) => normalizeLiveKeyAnswer(answer))
      .filter((answer): answer is LiveKeyAnswer => answer !== null)
    : []

  return {
    matchId: raw.matchId,
    winnerName: typeof raw.winnerName === 'string' ? raw.winnerName : '',
    winnerRecordedAt: typeof raw.winnerRecordedAt === 'string' ? raw.winnerRecordedAt : null,
    battleRoyalEntryOrder: Array.isArray(raw.battleRoyalEntryOrder)
      ? raw.battleRoyalEntryOrder
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
      : [],
    bonusAnswers,
  }
}

function normalizeScoreOverride(value: unknown): ScoreOverride | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ScoreOverride>
  if (typeof raw.questionId !== 'string' || typeof raw.playerNickname !== 'string') return null

  return {
    questionId: raw.questionId,
    playerNickname: raw.playerNickname,
    accepted: raw.accepted === true,
    source: raw.source === 'auto' || raw.source === 'host' ? raw.source : 'host',
    confidence: typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : 1,
  }
}

function normalizeWinnerOverride(value: unknown): WinnerOverride | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<WinnerOverride>
  if (typeof raw.matchId !== 'string' || typeof raw.playerNickname !== 'string') return null

  return {
    matchId: raw.matchId,
    playerNickname: raw.playerNickname,
    accepted: raw.accepted === true,
    source: raw.source === 'auto' || raw.source === 'host' ? raw.source : 'host',
    confidence: typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : 1,
  }
}

export function normalizeLiveKeyPayload(value: unknown): CardLiveKeyPayload {
  if (!value || typeof value !== 'object') {
    return {
      timers: [],
      matchResults: [],
      eventBonusAnswers: [],
      tiebreakerAnswer: '',
      tiebreakerRecordedAt: null,
      tiebreakerTimerId: null,
      scoreOverrides: [],
      winnerOverrides: [],
    }
  }

  const raw = value as Partial<CardLiveKeyPayload>

  return {
    timers: Array.isArray(raw.timers)
      ? raw.timers
        .map((timer) => normalizeLiveKeyTimer(timer))
        .filter((timer): timer is LiveKeyTimer => timer !== null)
      : [],
    matchResults: Array.isArray(raw.matchResults)
      ? raw.matchResults
        .map((result) => normalizeLiveKeyMatchResult(result))
        .filter((result): result is LiveKeyMatchResult => result !== null)
      : [],
    eventBonusAnswers: Array.isArray(raw.eventBonusAnswers)
      ? raw.eventBonusAnswers
        .map((answer) => normalizeLiveKeyAnswer(answer))
        .filter((answer): answer is LiveKeyAnswer => answer !== null)
      : [],
    tiebreakerAnswer: typeof raw.tiebreakerAnswer === 'string' ? raw.tiebreakerAnswer : '',
    tiebreakerRecordedAt: typeof raw.tiebreakerRecordedAt === 'string' ? raw.tiebreakerRecordedAt : null,
    tiebreakerTimerId: typeof raw.tiebreakerTimerId === 'string' ? raw.tiebreakerTimerId : null,
    scoreOverrides: Array.isArray(raw.scoreOverrides)
      ? raw.scoreOverrides
        .map((override) => normalizeScoreOverride(override))
        .filter((override): override is ScoreOverride => override !== null)
      : [],
    winnerOverrides: Array.isArray(raw.winnerOverrides)
      ? raw.winnerOverrides
        .map((override) => normalizeWinnerOverride(override))
        .filter((override): override is WinnerOverride => override !== null)
      : [],
  }
}

function parsePayloadJson(payloadJson: string): CardLiveKeyPayload {
  try {
    const parsed = JSON.parse(payloadJson) as unknown
    return normalizeLiveKeyPayload(parsed)
  } catch {
    return normalizeLiveKeyPayload(null)
  }
}

function mapCardLiveKey(row: LiveGameSelectable): CardLiveKey {
  return {
    userId: row.host_user_id,
    cardId: row.card_id,
    updatedAt: row.updated_at,
    payload: parsePayloadJson(row.key_payload_json),
  }
}

export interface LiveKeyState {
  key: CardLiveKey
}

async function findReadableCard(cardId: string, userId: string) {
  return db
    .selectFrom('cards')
    .select(['id', 'owner_id'])
    .where('id', '=', cardId)
    .where((eb) => canReadCard(eb, userId))
    .executeTakeFirst()
}

async function createUniqueSoloJoinCode(): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const code = `${SOLO_JOIN_CODE_PREFIX}${randomBytes(5).toString('hex').toUpperCase()}`
    const existing = await db
      .selectFrom('live_games')
      .select('id')
      .where('join_code', '=', code)
      .executeTakeFirst()

    if (!existing) {
      return code
    }
  }

  throw new Error('Failed to allocate a unique solo join code')
}

async function ensureSoloLiveGame(cardId: string, userId: string): Promise<LiveGameSelectable> {
  const existing = await db
    .selectFrom('live_games')
    .selectAll()
    .where('card_id', '=', cardId)
    .where('host_user_id', '=', userId)
    .where('mode', '=', 'solo')
    .orderBy('updated_at', 'desc')
    .executeTakeFirst()

  if (existing) {
    return existing
  }

  const now = new Date().toISOString()
  const id = randomUUID()
  const joinCode = await createUniqueSoloJoinCode()

  const values: Insertable<LiveGames> = {
    id,
    card_id: cardId,
    host_user_id: userId,
    mode: 'solo',
    join_code: joinCode,
    status: 'lobby',
    key_payload_json: JSON.stringify(normalizeLiveKeyPayload(null)),
    lock_state_json: JSON.stringify({}),
    expires_at: SOLO_EXPIRES_AT,
    ended_at: null,
    created_at: now,
    updated_at: now,
  }

  await db
    .insertInto('live_games')
    .values(values)
    .execute()

  return db
    .selectFrom('live_games')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
}

export async function getLiveKeyStateForUser(cardId: string, userId: string): Promise<LiveKeyState | null> {
  const card = await findReadableCard(cardId, userId)
  if (!card) return null

  const ownRow = await ensureSoloLiveGame(cardId, userId)

  return {
    key: mapCardLiveKey(ownRow),
  }
}

export async function upsertLiveKeyForUser(
  cardId: string,
  userId: string,
  payload: CardLiveKeyPayload,
): Promise<CardLiveKey | null> {
  const card = await findReadableCard(cardId, userId)
  if (!card) return null

  const ownRow = await ensureSoloLiveGame(cardId, userId)
  const now = new Date().toISOString()

  await db
    .updateTable('live_games')
    .set({
      key_payload_json: JSON.stringify(payload),
      updated_at: now,
    })
    .where('id', '=', String(ownRow.id))
    .execute()

  const updated = await db
    .selectFrom('live_games')
    .selectAll()
    .where('id', '=', String(ownRow.id))
    .executeTakeFirstOrThrow()

  return mapCardLiveKey(updated)
}
