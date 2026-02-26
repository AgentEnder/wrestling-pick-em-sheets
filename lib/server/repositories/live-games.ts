import { createHash, randomBytes, randomUUID } from 'crypto'

import type { Insertable, Selectable } from 'kysely'
import { UAParser } from 'ua-parser-js'

import type { ResolvedCard } from '@/lib/server/repositories/cards'
import { findResolvedReadableCardById } from '@/lib/server/repositories/cards'
import { db } from '@/lib/server/db/client'
import type {
  LiveGameEvents,
  LiveGamePlayers,
  LiveGames,
} from '@/lib/server/db/generated'
import { isCardOwner } from '@/lib/server/db/permissions'
import { sendLiveGamePushToSubscribers } from '@/lib/server/live-game-push'
import { normalizeLiveKeyPayload } from '@/lib/server/repositories/live-keys'
import type {
  BonusGradingRule,
  BonusQuestion,
  LiveGame,
  LiveGameKeyPayload,
  LiveGameLeaderboardEntry,
  LiveGameLockState,
  LiveGameMode,
  LiveGamePlayer,
  LiveGameStatus,
  LiveKeyAnswer,
  LiveKeyMatchResult,
  LiveKeyTimer,
  LivePlayerAnswer,
  LivePlayerMatchPick,
  LivePlayerPicksPayload,
  Match,
} from '@/lib/types'

type LiveGameSelectable = Selectable<LiveGames>
type LiveGamePlayerSelectable = Selectable<LiveGamePlayers>
type LiveGameEventSelectable = Selectable<LiveGameEvents>

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const JOIN_CODE_LENGTH = 6
const LIVE_GAME_DURATION_MS = 1000 * 60 * 60 * 12
const MAX_DETAILED_EVENTS_PER_MUTATION = 30

const EMPTY_PICKS: LivePlayerPicksPayload = {
  matchPicks: [],
  eventBonusAnswers: [],
  tiebreakerAnswer: '',
}

const EMPTY_LOCK_STATE: LiveGameLockState = {
  globalLocked: false,
  matchLocks: {},
  matchBonusLocks: {},
  eventBonusLocks: {},
}

export interface LiveGameEventFeedItem {
  id: string
  type: string
  message: string
  createdAt: string
}

export interface LiveGameComputedState {
  game: LiveGame
  card: ResolvedCard
  joinedPlayers: Array<{
    id: string
    nickname: string
    joinedAt: string
    lastSeenAt: string
    isSubmitted: boolean
    authMethod: 'guest' | 'clerk'
    browserName: string | null
    osName: string | null
    deviceType: string | null
    platform: string | null
    model: string | null
  }>
  leaderboard: LiveGameLeaderboardEntry[]
  pendingJoinRequests: Array<{
    id: string
    nickname: string
    joinedAt: string
    authMethod: 'guest' | 'clerk'
    browserName: string | null
    osName: string | null
    deviceType: string | null
    platform: string | null
    model: string | null
    joinRequestIp: string | null
    joinRequestCity: string | null
    joinRequestCountry: string | null
    joinRequestDistanceKm: number | null
  }>
  events: LiveGameEventFeedItem[]
  playerCount: number
  submittedCount: number
}

export interface LiveGameViewerAccess {
  game: LiveGame
  card: ResolvedCard
  player: LiveGamePlayer | null
  isHost: boolean
}

interface PendingLiveGameEvent {
  type: string
  message: string
}

interface LiveGamePushSubscriptionInput {
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

interface JoinDeviceInfoInput {
  userAgent?: string | null
  userAgentData?: Record<string, unknown>
}

interface ParsedJoinDeviceInfo {
  userAgent: string | null
  userAgentDataJson: string | null
  browserName: string | null
  browserVersion: string | null
  osName: string | null
  osVersion: string | null
  deviceType: string | null
  deviceVendor: string | null
  deviceModel: string | null
  platform: string | null
  platformVersion: string | null
  architecture: string | null
}

interface JoinLiveGameOptions {
  clerkUserId?: string | null
  deviceInfo?: JoinDeviceInfoInput
  requestIp?: string | null
  requestCity?: string | null
  requestCountry?: string | null
  requestLatitude?: number | null
  requestLongitude?: number | null
  bypassSecret?: string | null
}

type JoinDecision = {
  status: 'pending' | 'approved'
  approvedAt: string | null
  distanceKm: number | null
}

const DEFAULT_GEO_RADIUS_KM = 50

function normalizeNickname(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeNicknameKey(value: string): string {
  return normalizeNickname(value).toLowerCase()
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function normalizeIpForComparison(value: string | null): string | null {
  if (!value) return null
  let normalized = value.trim().toLowerCase()
  if (!normalized) return null

  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7)
  }

  const bracketMatch = normalized.match(/^\[([^[\]]+)\](?::\d+)?$/)
  if (bracketMatch?.[1]) {
    normalized = bracketMatch[1]
  } else {
    const ipv4PortMatch = normalized.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
    if (ipv4PortMatch?.[1]) {
      normalized = ipv4PortMatch[1]
    }
  }

  return normalized
}

function parseIpv4(value: string | null): [number, number, number, number] | null {
  if (!value) return null
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const parsed = parts.map((part) => Number.parseInt(part, 10))
  if (parsed.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return [parsed[0], parsed[1], parsed[2], parsed[3]]
}

function isPrivateIpv4(value: string | null): boolean {
  const parsed = parseIpv4(value)
  if (!parsed) return false
  const [a, b] = parsed
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function isSameLanSubnet(requestIp: string | null, hostIp: string | null): boolean {
  if (!isPrivateIpv4(requestIp) || !isPrivateIpv4(hostIp)) return false
  const request = parseIpv4(requestIp)
  const host = parseIpv4(hostIp)
  if (!request || !host) return false
  // Conservative LAN heuristic: same /24 private subnet.
  return request[0] === host[0] && request[1] === host[1] && request[2] === host[2]
}

function shouldLogLobbyDebug(): boolean {
  return process.env.NODE_ENV !== 'test'
}

function lobbyDebugLog(event: string, payload: Record<string, unknown>): void {
  if (!shouldLogLobbyDebug()) return
  console.info(`[live-games:lobby] ${event}`, payload)
}

function degreesToRadians(value: number): number {
  return value * (Math.PI / 180)
}

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const earthRadiusKm = 6371
  const dLat = degreesToRadians(b.latitude - a.latitude)
  const dLon = degreesToRadians(b.longitude - a.longitude)
  const lat1 = degreesToRadians(a.latitude)
  const lat2 = degreesToRadians(b.latitude)

  const term =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(term))
}

function parseJoinDeviceInfo(deviceInfo?: JoinDeviceInfoInput): ParsedJoinDeviceInfo {
  const userAgent = normalizeOptionalText(deviceInfo?.userAgent) ?? null
  const uaData = deviceInfo?.userAgentData ?? null
  const parser = new UAParser(userAgent ?? undefined)
  const parsed = parser.getResult()
  const fallbackPlatform = normalizeOptionalText(uaData?.platform)
  const fallbackPlatformVersion = normalizeOptionalText(uaData?.platformVersion)
  const fallbackArchitecture = normalizeOptionalText(uaData?.architecture)
  const fallbackModel = normalizeOptionalText(uaData?.model)
  const fallbackBrowserName =
    Array.isArray(uaData?.fullVersionList) && uaData.fullVersionList.length > 0
      ? normalizeOptionalText(uaData.fullVersionList[0]?.brand)
      : null
  const fallbackBrowserVersion =
    Array.isArray(uaData?.fullVersionList) && uaData.fullVersionList.length > 0
      ? normalizeOptionalText(uaData.fullVersionList[0]?.version)
      : null

  return {
    userAgent,
    userAgentDataJson: uaData ? JSON.stringify(uaData) : null,
    browserName: normalizeOptionalText(parsed.browser.name) ?? fallbackBrowserName,
    browserVersion: normalizeOptionalText(parsed.browser.version) ?? fallbackBrowserVersion,
    osName: normalizeOptionalText(parsed.os.name) ?? fallbackPlatform,
    osVersion: normalizeOptionalText(parsed.os.version) ?? fallbackPlatformVersion,
    deviceType: normalizeOptionalText(parsed.device.type),
    deviceVendor: normalizeOptionalText(parsed.device.vendor),
    deviceModel: normalizeOptionalText(parsed.device.model) ?? fallbackModel,
    platform: fallbackPlatform ?? normalizeOptionalText(parsed.os.name),
    platformVersion: fallbackPlatformVersion ?? normalizeOptionalText(parsed.os.version),
    architecture: normalizeOptionalText(parsed.cpu.architecture) ?? fallbackArchitecture,
  }
}

function normalizeAnswer(value: unknown): LivePlayerAnswer | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<LivePlayerAnswer>
  if (typeof raw.questionId !== 'string') return null

  return {
    questionId: raw.questionId,
    answer: typeof raw.answer === 'string' ? raw.answer : '',
  }
}

function normalizeMatchPick(value: unknown): LivePlayerMatchPick | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<LivePlayerMatchPick>
  if (typeof raw.matchId !== 'string') return null

  return {
    matchId: raw.matchId,
    winnerName: typeof raw.winnerName === 'string' ? raw.winnerName : '',
    battleRoyalEntrants: Array.isArray(raw.battleRoyalEntrants)
      ? raw.battleRoyalEntrants
        .filter((entrant): entrant is string => typeof entrant === 'string')
        .map((entrant) => entrant.trim())
        .filter((entrant) => entrant.length > 0)
      : [],
    bonusAnswers: Array.isArray(raw.bonusAnswers)
      ? raw.bonusAnswers
        .map((answer) => normalizeAnswer(answer))
        .filter((answer): answer is LivePlayerAnswer => answer !== null)
      : [],
  }
}

export function normalizeLivePlayerPicks(value: unknown): LivePlayerPicksPayload {
  if (!value || typeof value !== 'object') {
    return { ...EMPTY_PICKS }
  }

  const raw = value as Partial<LivePlayerPicksPayload>

  return {
    matchPicks: Array.isArray(raw.matchPicks)
      ? raw.matchPicks
        .map((pick) => normalizeMatchPick(pick))
        .filter((pick): pick is LivePlayerMatchPick => pick !== null)
      : [],
    eventBonusAnswers: Array.isArray(raw.eventBonusAnswers)
      ? raw.eventBonusAnswers
        .map((answer) => normalizeAnswer(answer))
        .filter((answer): answer is LivePlayerAnswer => answer !== null)
      : [],
    tiebreakerAnswer: typeof raw.tiebreakerAnswer === 'string' ? raw.tiebreakerAnswer : '',
  }
}

export function normalizeLiveGameLockState(value: unknown): LiveGameLockState {
  if (!value || typeof value !== 'object') {
    return {
      ...EMPTY_LOCK_STATE,
      matchLocks: {},
      matchBonusLocks: {},
      eventBonusLocks: {},
    }
  }

  const raw = value as Partial<LiveGameLockState>
  const matchLocks = typeof raw.matchLocks === 'object' && raw.matchLocks
    ? Object.fromEntries(
      Object.entries(raw.matchLocks)
        .filter(([key]) => typeof key === 'string' && key.trim().length > 0)
        .map(([key, item]) => {
          const lock = item as { locked?: boolean; source?: 'host' | 'timer' } | null
          const source: 'host' | 'timer' = lock?.source === 'timer' ? 'timer' : 'host'
          return [
            key,
            {
              locked: lock?.locked === true,
              source,
            },
          ]
        }),
    )
    : {}

  const matchBonusLocks = typeof raw.matchBonusLocks === 'object' && raw.matchBonusLocks
    ? Object.fromEntries(
      Object.entries(raw.matchBonusLocks)
        .filter(([key]) => typeof key === 'string' && key.trim().length > 0)
        .map(([key, item]) => {
          const lock = item as { locked?: boolean; source?: 'host' | 'timer' } | null
          const source: 'host' | 'timer' = lock?.source === 'timer' ? 'timer' : 'host'
          return [
            key,
            {
              locked: lock?.locked === true,
              source,
            },
          ]
        }),
    )
    : {}

  const eventBonusLocks = typeof raw.eventBonusLocks === 'object' && raw.eventBonusLocks
    ? Object.fromEntries(
      Object.entries(raw.eventBonusLocks)
        .filter(([key]) => typeof key === 'string' && key.trim().length > 0)
        .map(([key, item]) => {
          const lock = item as { locked?: boolean; source?: 'host' | 'timer' } | null
          const source: 'host' | 'timer' = lock?.source === 'timer' ? 'timer' : 'host'
          return [
            key,
            {
              locked: lock?.locked === true,
              source,
            },
          ]
        }),
    )
    : {}

  return {
    globalLocked: raw.globalLocked === true,
    matchLocks,
    matchBonusLocks,
    eventBonusLocks,
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function hasReachedEventStartTime(eventDate: string | null | undefined): boolean {
  if (!eventDate) return false
  const parsed = new Date(eventDate).getTime()
  if (!Number.isFinite(parsed)) return false
  return parsed <= Date.now()
}

function mapLiveGame(row: LiveGameSelectable): LiveGame {
  const status: LiveGameStatus = row.status === 'live' || row.status === 'ended' ? row.status : 'lobby'
  const mode: LiveGameMode = row.mode === 'solo' ? 'solo' : 'room'

  return {
    id: String(row.id),
    cardId: row.card_id,
    hostUserId: row.host_user_id,
    mode,
    joinCode: row.join_code,
    qrJoinSecret: row.qr_join_secret,
    allowLateJoins: Number(row.allow_late_joins) === 1,
    status,
    hostJoinIp: row.host_join_ip,
    hostGeoCity: row.host_geo_city,
    hostGeoCountry: row.host_geo_country,
    hostGeoLatitude: normalizeOptionalNumber(row.host_geo_latitude),
    hostGeoLongitude: normalizeOptionalNumber(row.host_geo_longitude),
    geoRadiusKm: Number.isFinite(Number(row.geo_radius_km)) ? Number(row.geo_radius_km) : DEFAULT_GEO_RADIUS_KM,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    keyPayload: normalizeLiveKeyPayload(parseJson<unknown>(row.key_payload_json, {})),
    lockState: normalizeLiveGameLockState(parseJson<unknown>(row.lock_state_json, {})),
  }
}

function mapLiveGamePlayer(row: LiveGamePlayerSelectable): LiveGamePlayer {
  return {
    id: String(row.id),
    gameId: row.game_id,
    joinStatus: row.join_status === 'pending' || row.join_status === 'rejected' ? row.join_status : 'approved',
    approvedAt: row.approved_at,
    joinRequestIp: row.join_request_ip,
    joinRequestCity: row.join_request_city,
    joinRequestCountry: row.join_request_country,
    joinRequestLatitude: normalizeOptionalNumber(row.join_request_latitude),
    joinRequestLongitude: normalizeOptionalNumber(row.join_request_longitude),
    joinRequestDistanceKm: normalizeOptionalNumber(row.join_request_distance_km),
    authMethod: row.auth_method === 'clerk' ? 'clerk' : 'guest',
    clerkUserId: row.clerk_user_id,
    nickname: row.nickname,
    picks: normalizeLivePlayerPicks(parseJson<unknown>(row.picks_json, {})),
    isSubmitted: Number(row.is_submitted) === 1,
    submittedAt: row.submitted_at,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at,
    browserName: row.browser_name,
    browserVersion: row.browser_version,
    osName: row.os_name,
    osVersion: row.os_version,
    deviceType: row.device_type,
    deviceVendor: row.device_vendor,
    deviceModel: row.device_model,
    platform: row.platform,
    platformVersion: row.platform_version,
    architecture: row.architecture,
  }
}

function isGameStartedByCardEvent(game: LiveGame, card: ResolvedCard): boolean {
  if (game.status === 'live' || game.status === 'ended') return true
  return hasReachedEventStartTime(card.eventDate)
}

async function autoStartGameForCardEvent(row: LiveGameSelectable, card: ResolvedCard): Promise<LiveGameSelectable> {
  const status: LiveGameStatus = row.status === 'live' || row.status === 'ended' ? row.status : 'lobby'
  if (status !== 'lobby') return row
  if (!hasReachedEventStartTime(card.eventDate)) return row

  const gameId = String(row.id)
  const now = nowIso()
  const updated = await db
    .updateTable('live_games')
    .set({
      status: 'live',
      updated_at: now,
    })
    .where('id', '=', gameId)
    .where('status', '=', 'lobby')
    .returningAll()
    .executeTakeFirst()

  if (updated) {
    await insertLiveGameEvent(gameId, 'game.status', 'Room auto-started at event start time')
    await sendLiveGamePushToSubscribers(gameId, {
      title: 'Live Game Update',
      body: 'Room auto-started.',
      url: `/games/${gameId}/play?code=${encodeURIComponent(updated.join_code)}`,
      tag: `live-game-status:${gameId}`,
    })
    return updated
  }

  const reloaded = await db
    .selectFrom('live_games')
    .selectAll()
    .where('id', '=', gameId)
    .executeTakeFirst()

  return reloaded ?? row
}

function mapLiveGameEvent(row: LiveGameEventSelectable): LiveGameEventFeedItem {
  const payload = parseJson<Record<string, unknown>>(row.event_payload_json, {})
  const message = typeof payload.message === 'string' ? payload.message : row.event_type

  return {
    id: String(row.id),
    type: row.event_type,
    message,
    createdAt: row.created_at,
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function buildJoinCode(): string {
  let code = ''
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    const index = Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)
    code += JOIN_CODE_ALPHABET[index]
  }
  return code
}

function buildJoinBypassSecret(): string {
  return randomBytes(32).toString('base64url')
}

async function createUniqueJoinCode(): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const code = buildJoinCode()
    const existing = await db
      .selectFrom('live_games')
      .select('id')
      .where('join_code', '=', code)
      .executeTakeFirst()

    if (!existing) {
      return code
    }
  }

  throw new Error('Failed to allocate a unique join code')
}

function getQuestionRule(question: BonusQuestion): BonusGradingRule {
  if (question.valueType !== 'numerical' && question.valueType !== 'time') {
    return 'exact'
  }

  if (
    question.gradingRule === 'closest' ||
    question.gradingRule === 'atOrAbove' ||
    question.gradingRule === 'atOrBelow'
  ) {
    return question.gradingRule
  }

  return 'exact'
}

function toMatchBonusKey(matchId: string, questionId: string): string {
  return `${matchId}:${questionId}`
}

function isMatchLocked(lockState: LiveGameLockState, matchId: string): boolean {
  if (lockState.globalLocked) return true
  return lockState.matchLocks[matchId]?.locked === true
}

function isMatchBonusLocked(lockState: LiveGameLockState, matchId: string, questionId: string): boolean {
  if (isMatchLocked(lockState, matchId)) return true
  return lockState.matchBonusLocks[toMatchBonusKey(matchId, questionId)]?.locked === true
}

function isEventBonusLocked(lockState: LiveGameLockState, questionId: string): boolean {
  if (lockState.globalLocked) return true
  return lockState.eventBonusLocks[questionId]?.locked === true
}

function parseNumericLike(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const numberLike = Number.parseFloat(trimmed)
  if (Number.isFinite(numberLike)) {
    return numberLike
  }

  return null
}

function parseTimeLike(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((part) => Number.parseFloat(part))
    if (parts.some((part) => !Number.isFinite(part))) {
      return null
    }

    let total = 0
    for (let i = 0; i < parts.length; i += 1) {
      total = (total * 60) + (parts[i] ?? 0)
    }
    return total
  }

  return parseNumericLike(trimmed)
}

function parseValueByType(value: string, valueType: BonusQuestion['valueType']): number | null {
  if (valueType === 'time') {
    return parseTimeLike(value)
  }

  if (valueType === 'numerical') {
    return parseNumericLike(value)
  }

  return null
}

interface CardLookup {
  matchesById: Map<string, Match>
  matchIndexById: Map<string, number>
  matchBonusByKey: Map<string, BonusQuestion>
  eventBonusById: Map<string, BonusQuestion>
}

function abbreviateLabel(value: string, maxLength = 72): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(1, maxLength - 3))}...`
}

function formatDurationFromMs(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function buildCardLookup(card: ResolvedCard): CardLookup {
  const matchesById = new Map<string, Match>()
  const matchIndexById = new Map<string, number>()
  const matchBonusByKey = new Map<string, BonusQuestion>()
  const eventBonusById = new Map<string, BonusQuestion>()

  for (let matchIndex = 0; matchIndex < card.matches.length; matchIndex += 1) {
    const match = card.matches[matchIndex]
    matchesById.set(match.id, match)
    matchIndexById.set(match.id, matchIndex)

    for (const question of match.bonusQuestions) {
      matchBonusByKey.set(toMatchBonusKey(match.id, question.id), question)
    }
  }

  for (const question of card.eventBonusQuestions) {
    eventBonusById.set(question.id, question)
  }

  return {
    matchesById,
    matchIndexById,
    matchBonusByKey,
    eventBonusById,
  }
}

function getMatchLabel(lookup: CardLookup, matchId: string): string {
  const match = lookup.matchesById.get(matchId)
  const matchIndex = lookup.matchIndexById.get(matchId)
  const baseLabel = typeof matchIndex === 'number' ? `Match ${matchIndex + 1}` : `Match ${matchId.slice(0, 8)}`
  const title = match ? abbreviateLabel(match.title, 48) : ''

  if (title) {
    return `${baseLabel} (${title})`
  }

  return baseLabel
}

function getQuestionLabel(question: BonusQuestion | undefined, fallbackLabel: string): string {
  const label = question ? abbreviateLabel(question.question, 64) : ''
  return label || fallbackLabel
}

function parseMatchBonusLockKey(key: string): { matchId: string; questionId: string } | null {
  const delimiterIndex = key.indexOf(':')
  if (delimiterIndex <= 0 || delimiterIndex >= key.length - 1) {
    return null
  }

  return {
    matchId: key.slice(0, delimiterIndex),
    questionId: key.slice(delimiterIndex + 1),
  }
}

function valuesEqualByType(
  valueType: BonusQuestion['valueType'] | 'string',
  previousValue: string,
  nextValue: string,
): boolean {
  const previousTrimmed = previousValue.trim()
  const nextTrimmed = nextValue.trim()
  if (!previousTrimmed && !nextTrimmed) return true

  if (valueType === 'numerical' || valueType === 'time') {
    const previousParsed = parseValueByType(previousValue, valueType)
    const nextParsed = parseValueByType(nextValue, valueType)
    if (previousParsed !== null && nextParsed !== null) {
      return Math.abs(previousParsed - nextParsed) < 0.0001
    }
  }

  return normalizeText(previousValue) === normalizeText(nextValue)
}

function normalizeNameList(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function equalNameListWithOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i += 1) {
    if (normalizeText(a[i]) !== normalizeText(b[i])) {
      return false
    }
  }

  return true
}

function getTimerLabelForEvent(lookup: CardLookup, timer: LiveKeyTimer): string {
  const matchId = parseMatchTimerId(timer.id)
  if (matchId) {
    return `${getMatchLabel(lookup, matchId)} timer`
  }

  const label = abbreviateLabel(timer.label, 40)
  if (label) {
    return `Timer "${label}"`
  }

  return 'Timer'
}

function trimDetailedEvents(events: PendingLiveGameEvent[]): PendingLiveGameEvent[] {
  if (events.length <= MAX_DETAILED_EVENTS_PER_MUTATION) {
    return events
  }

  const kept = events.slice(0, MAX_DETAILED_EVENTS_PER_MUTATION)
  kept.push({
    type: 'game.changes',
    message: `${events.length - MAX_DETAILED_EVENTS_PER_MUTATION} additional changes applied`,
  })
  return kept
}

function buildKeyMutationEvents(
  card: ResolvedCard,
  previousPayload: LiveGameKeyPayload,
  nextPayload: LiveGameKeyPayload,
): PendingLiveGameEvent[] {
  const lookup = buildCardLookup(card)
  const events: PendingLiveGameEvent[] = []

  const previousResultsByMatchId = new Map(previousPayload.matchResults.map((result) => [result.matchId, result]))
  const nextResultsByMatchId = new Map(nextPayload.matchResults.map((result) => [result.matchId, result]))

  for (const match of card.matches) {
    const matchLabel = getMatchLabel(lookup, match.id)
    const previousResult = previousResultsByMatchId.get(match.id)
    const nextResult = nextResultsByMatchId.get(match.id)

    const previousWinner = previousResult?.winnerName ?? ''
    const nextWinner = nextResult?.winnerName ?? ''

    if (!valuesEqualByType('string', previousWinner, nextWinner)) {
      const previousWinnerTrimmed = abbreviateLabel(previousWinner, 56)
      const nextWinnerTrimmed = abbreviateLabel(nextWinner, 56)

      if (!nextWinnerTrimmed) {
        events.push({
          type: 'key.winner',
          message: `${matchLabel} winner cleared`,
        })
      } else if (!previousWinnerTrimmed) {
        events.push({
          type: 'key.winner',
          message: `${matchLabel} winner set to ${nextWinnerTrimmed}`,
        })
      } else {
        events.push({
          type: 'key.winner',
          message: `${matchLabel} winner changed: ${previousWinnerTrimmed} -> ${nextWinnerTrimmed}`,
        })
      }
    }

    const previousEntryOrder = normalizeNameList(previousResult?.battleRoyalEntryOrder ?? [])
    const nextEntryOrder = normalizeNameList(nextResult?.battleRoyalEntryOrder ?? [])
    if (!equalNameListWithOrder(previousEntryOrder, nextEntryOrder)) {
      if (nextEntryOrder.length === 0) {
        events.push({
          type: 'key.entryOrder',
          message: `${matchLabel} entrant order cleared`,
        })
      } else if (previousEntryOrder.length === 0) {
        events.push({
          type: 'key.entryOrder',
          message: `${matchLabel} entrant order started (${nextEntryOrder.length} recorded)`,
        })
      } else if (
        nextEntryOrder.length > previousEntryOrder.length &&
        equalNameListWithOrder(previousEntryOrder, nextEntryOrder.slice(0, previousEntryOrder.length))
      ) {
        const entrant = abbreviateLabel(nextEntryOrder[nextEntryOrder.length - 1], 56)
        events.push({
          type: 'key.entryOrder',
          message: `${matchLabel} entrant #${nextEntryOrder.length} recorded: ${entrant || 'Unknown'}`,
        })
      } else {
        events.push({
          type: 'key.entryOrder',
          message: `${matchLabel} entrant order updated (${nextEntryOrder.length} recorded)`,
        })
      }
    }

    for (const question of match.bonusQuestions) {
      const previousAnswer = previousResult?.bonusAnswers.find((answer) => answer.questionId === question.id)?.answer ?? ''
      const nextAnswer = nextResult?.bonusAnswers.find((answer) => answer.questionId === question.id)?.answer ?? ''
      if (valuesEqualByType(question.valueType, previousAnswer, nextAnswer)) {
        continue
      }

      const questionLabel = getQuestionLabel(question, 'Bonus question')
      const previousTrimmed = previousAnswer.trim()
      const nextTrimmed = nextAnswer.trim()

      if (question.valueType === 'time') {
        if (!nextTrimmed) {
          events.push({
            type: 'key.time',
            message: `${matchLabel} cleared recorded time for "${questionLabel}"`,
          })
        } else if (!previousTrimmed) {
          events.push({
            type: 'key.time',
            message: `${matchLabel} recorded time for "${questionLabel}": ${abbreviateLabel(nextTrimmed, 24)}`,
          })
        } else {
          events.push({
            type: 'key.time',
            message: `${matchLabel} updated time for "${questionLabel}": ${abbreviateLabel(previousTrimmed, 24)} -> ${abbreviateLabel(nextTrimmed, 24)}`,
          })
        }
        continue
      }

      if (question.valueType === 'numerical') {
        if (!nextTrimmed) {
          events.push({
            type: 'key.count',
            message: `${matchLabel} cleared count for "${questionLabel}"`,
          })
        } else if (!previousTrimmed) {
          events.push({
            type: 'key.count',
            message: `${matchLabel} set count for "${questionLabel}": ${abbreviateLabel(nextTrimmed, 24)}`,
          })
        } else {
          events.push({
            type: 'key.count',
            message: `${matchLabel} changed count for "${questionLabel}": ${abbreviateLabel(previousTrimmed, 24)} -> ${abbreviateLabel(nextTrimmed, 24)}`,
          })
        }
        continue
      }

      if (!previousTrimmed && nextTrimmed) {
        events.push({
          type: 'key.answer',
          message: `${matchLabel} set answer for "${questionLabel}"`,
        })
      } else if (previousTrimmed && !nextTrimmed) {
        events.push({
          type: 'key.answer',
          message: `${matchLabel} cleared answer for "${questionLabel}"`,
        })
      }
    }
  }

  const previousEventAnswersByQuestion = new Map(previousPayload.eventBonusAnswers.map((answer) => [answer.questionId, answer.answer]))
  const nextEventAnswersByQuestion = new Map(nextPayload.eventBonusAnswers.map((answer) => [answer.questionId, answer.answer]))

  for (const question of card.eventBonusQuestions) {
    const previousAnswer = previousEventAnswersByQuestion.get(question.id) ?? ''
    const nextAnswer = nextEventAnswersByQuestion.get(question.id) ?? ''

    if (valuesEqualByType(question.valueType, previousAnswer, nextAnswer)) {
      continue
    }

    const questionLabel = getQuestionLabel(question, 'Event bonus')
    const previousTrimmed = previousAnswer.trim()
    const nextTrimmed = nextAnswer.trim()

    if (question.valueType === 'time') {
      if (!nextTrimmed) {
        events.push({
          type: 'key.time',
          message: `Event bonus cleared recorded time for "${questionLabel}"`,
        })
      } else if (!previousTrimmed) {
        events.push({
          type: 'key.time',
          message: `Event bonus recorded time for "${questionLabel}": ${abbreviateLabel(nextTrimmed, 24)}`,
        })
      } else {
        events.push({
          type: 'key.time',
          message: `Event bonus updated time for "${questionLabel}": ${abbreviateLabel(previousTrimmed, 24)} -> ${abbreviateLabel(nextTrimmed, 24)}`,
        })
      }
      continue
    }

    if (question.valueType === 'numerical') {
      if (!nextTrimmed) {
        events.push({
          type: 'key.count',
          message: `Event bonus cleared count for "${questionLabel}"`,
        })
      } else if (!previousTrimmed) {
        events.push({
          type: 'key.count',
          message: `Event bonus set count for "${questionLabel}": ${abbreviateLabel(nextTrimmed, 24)}`,
        })
      } else {
        events.push({
          type: 'key.count',
          message: `Event bonus changed count for "${questionLabel}": ${abbreviateLabel(previousTrimmed, 24)} -> ${abbreviateLabel(nextTrimmed, 24)}`,
        })
      }
      continue
    }

    if (!previousTrimmed && nextTrimmed) {
      events.push({
        type: 'key.answer',
        message: `Event bonus set answer for "${questionLabel}"`,
      })
    } else if (previousTrimmed && !nextTrimmed) {
      events.push({
        type: 'key.answer',
        message: `Event bonus cleared answer for "${questionLabel}"`,
      })
    }
  }

  const tiebreakerValueType: BonusQuestion['valueType'] = card.tiebreakerIsTimeBased ? 'time' : 'string'
  const previousTiebreaker = previousPayload.tiebreakerAnswer ?? ''
  const nextTiebreaker = nextPayload.tiebreakerAnswer ?? ''
  if (!valuesEqualByType(tiebreakerValueType, previousTiebreaker, nextTiebreaker)) {
    const label = abbreviateLabel(card.tiebreakerLabel, 48) || 'Tiebreaker'
    const previousTrimmed = previousTiebreaker.trim()
    const nextTrimmed = nextTiebreaker.trim()

    if (card.tiebreakerIsTimeBased) {
      if (!nextTrimmed) {
        events.push({
          type: 'key.time',
          message: `${label} time cleared`,
        })
      } else if (!previousTrimmed) {
        events.push({
          type: 'key.time',
          message: `${label} time recorded: ${abbreviateLabel(nextTrimmed, 24)}`,
        })
      } else {
        events.push({
          type: 'key.time',
          message: `${label} time updated: ${abbreviateLabel(previousTrimmed, 24)} -> ${abbreviateLabel(nextTrimmed, 24)}`,
        })
      }
    } else if (!nextTrimmed) {
      events.push({
        type: 'key.tiebreaker',
        message: `${label} cleared`,
      })
    } else if (!previousTrimmed) {
      events.push({
        type: 'key.tiebreaker',
        message: `${label} set`,
      })
    } else {
      events.push({
        type: 'key.tiebreaker',
        message: `${label} updated`,
      })
    }
  }

  const previousTimersById = new Map(previousPayload.timers.map((timer) => [timer.id, timer]))
  for (const nextTimer of nextPayload.timers) {
    const previousTimer = previousTimersById.get(nextTimer.id)
    if (!previousTimer) continue

    const timerLabel = getTimerLabelForEvent(lookup, nextTimer)
    const wasRunning = previousTimer.isRunning === true
    const isRunning = nextTimer.isRunning === true

    if (!wasRunning && isRunning) {
      events.push({
        type: 'timer.started',
        message: `${timerLabel} started`,
      })
      continue
    }

    if (wasRunning && !isRunning) {
      events.push({
        type: 'timer.stopped',
        message: `${timerLabel} stopped at ${formatDurationFromMs(nextTimer.elapsedMs)}`,
      })
      continue
    }

    if (!wasRunning && !isRunning && previousTimer.elapsedMs > 0 && nextTimer.elapsedMs === 0) {
      events.push({
        type: 'timer.reset',
        message: `${timerLabel} reset`,
      })
    }
  }

  return trimDetailedEvents(events)
}

function buildLockMutationEvents(
  card: ResolvedCard,
  previousLockState: LiveGameLockState,
  nextLockState: LiveGameLockState,
): PendingLiveGameEvent[] {
  const lookup = buildCardLookup(card)
  const previous = normalizeLiveGameLockState(previousLockState)
  const next = normalizeLiveGameLockState(nextLockState)
  const events: PendingLiveGameEvent[] = []

  if (previous.globalLocked !== next.globalLocked) {
    events.push({
      type: 'lock.global',
      message: next.globalLocked ? 'Global lock enabled' : 'Global lock disabled',
    })
  }

  const matchKeys = new Set<string>([
    ...Object.keys(previous.matchLocks),
    ...Object.keys(next.matchLocks),
    ...card.matches.map((match) => match.id),
  ])

  for (const matchId of matchKeys) {
    const previousLocked = previous.matchLocks[matchId]?.locked === true
    const nextLocked = next.matchLocks[matchId]?.locked === true
    if (previousLocked === nextLocked) continue

    const source = next.matchLocks[matchId]?.source ?? 'host'
    const matchLabel = getMatchLabel(lookup, matchId)

    if (nextLocked) {
      events.push({
        type: 'lock.match',
        message: source === 'timer'
          ? `${matchLabel} auto-locked when timer started`
          : `${matchLabel} locked`,
      })
    } else {
      events.push({
        type: 'lock.match',
        message: `${matchLabel} unlocked`,
      })
    }
  }

  const matchBonusKeys = new Set<string>([
    ...Object.keys(previous.matchBonusLocks),
    ...Object.keys(next.matchBonusLocks),
  ])

  for (const key of matchBonusKeys) {
    const previousLocked = previous.matchBonusLocks[key]?.locked === true
    const nextLocked = next.matchBonusLocks[key]?.locked === true
    if (previousLocked === nextLocked) continue

    const parsedKey = parseMatchBonusLockKey(key)
    const source = next.matchBonusLocks[key]?.source ?? 'host'

    let contextLabel = `Match bonus ${key}`
    if (parsedKey) {
      const question = lookup.matchBonusByKey.get(key)
      const questionLabel = getQuestionLabel(question, 'Bonus question')
      contextLabel = `${getMatchLabel(lookup, parsedKey.matchId)} bonus "${questionLabel}"`
    }

    if (nextLocked) {
      events.push({
        type: 'lock.matchBonus',
        message: source === 'timer'
          ? `${contextLabel} auto-locked`
          : `${contextLabel} locked`,
      })
    } else {
      events.push({
        type: 'lock.matchBonus',
        message: `${contextLabel} unlocked`,
      })
    }
  }

  const eventBonusKeys = new Set<string>([
    ...Object.keys(previous.eventBonusLocks),
    ...Object.keys(next.eventBonusLocks),
    ...card.eventBonusQuestions.map((question) => question.id),
  ])

  for (const questionId of eventBonusKeys) {
    const previousLocked = previous.eventBonusLocks[questionId]?.locked === true
    const nextLocked = next.eventBonusLocks[questionId]?.locked === true
    if (previousLocked === nextLocked) continue

    const source = next.eventBonusLocks[questionId]?.source ?? 'host'
    const question = lookup.eventBonusById.get(questionId)
    const questionLabel = getQuestionLabel(question, questionId.slice(0, 8))
    const contextLabel = `Event bonus "${questionLabel}"`

    if (nextLocked) {
      events.push({
        type: 'lock.eventBonus',
        message: source === 'timer'
          ? `${contextLabel} auto-locked`
          : `${contextLabel} locked`,
      })
    } else {
      events.push({
        type: 'lock.eventBonus',
        message: `${contextLabel} unlocked`,
      })
    }
  }

  return trimDetailedEvents(events)
}

function answerEquals(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false
  return normalizeText(a) === normalizeText(b)
}

function pickBonusAnswer(answers: LivePlayerAnswer[], questionId: string): string {
  const found = answers.find((answer) => answer.questionId === questionId)
  return found?.answer ?? ''
}

function pickMatchPick(matchPicks: LivePlayerMatchPick[], matchId: string): LivePlayerMatchPick | null {
  const found = matchPicks.find((pick) => pick.matchId === matchId)
  return found ?? null
}

interface ScoreAccumulator {
  playerId: string
  nickname: string
  score: number
  winnerPoints: number
  bonusPoints: number
  surprisePoints: number
  isSubmitted: boolean
  updatedAt: string
  lastSeenAt: string
}

interface ClosestBucket {
  key: string
  points: number
  entries: Array<{ playerId: string; distance: number }>
}

function scoreForQuestion(
  question: BonusQuestion,
  defaultPoints: number,
  keyAnswer: string,
  playerAnswer: string,
): { score: number; isClosestCandidate: boolean; distance?: number } {
  const points = question.points ?? defaultPoints
  if (!keyAnswer.trim() || !playerAnswer.trim() || points <= 0) {
    return { score: 0, isClosestCandidate: false }
  }

  const rule = getQuestionRule(question)

  if (rule === 'exact') {
    if (question.valueType === 'numerical' || question.valueType === 'time') {
      const keyValue = parseValueByType(keyAnswer, question.valueType)
      const playerValue = parseValueByType(playerAnswer, question.valueType)

      if (keyValue !== null && playerValue !== null) {
        return {
          score: Math.abs(keyValue - playerValue) < 0.0001 ? points : 0,
          isClosestCandidate: false,
        }
      }
    }

    return {
      score: answerEquals(keyAnswer, playerAnswer) ? points : 0,
      isClosestCandidate: false,
    }
  }

  const keyValue = parseValueByType(keyAnswer, question.valueType)
  const playerValue = parseValueByType(playerAnswer, question.valueType)

  if (keyValue === null || playerValue === null) {
    return { score: 0, isClosestCandidate: false }
  }

  if (rule === 'atOrAbove') {
    return { score: playerValue >= keyValue ? points : 0, isClosestCandidate: false }
  }

  if (rule === 'atOrBelow') {
    return { score: playerValue <= keyValue ? points : 0, isClosestCandidate: false }
  }

  return {
    score: 0,
    isClosestCandidate: true,
    distance: Math.abs(playerValue - keyValue),
  }
}

function computeLeaderboard(
  card: ResolvedCard,
  keyPayload: LiveGameKeyPayload,
  players: LiveGamePlayer[],
): LiveGameLeaderboardEntry[] {
  const submittedPlayers = players.filter((player) => player.isSubmitted)
  const accumulators = new Map<string, ScoreAccumulator>()
  const closestBuckets = new Map<string, ClosestBucket>()

  for (const player of submittedPlayers) {
    accumulators.set(player.id, {
      playerId: player.id,
      nickname: player.nickname,
      score: 0,
      winnerPoints: 0,
      bonusPoints: 0,
      surprisePoints: 0,
      isSubmitted: player.isSubmitted,
      updatedAt: player.updatedAt,
      lastSeenAt: player.lastSeenAt,
    })
  }

  for (const match of card.matches) {
    const keyMatchResult = keyPayload.matchResults.find((result) => result.matchId === match.id)
    if (!keyMatchResult) continue

    const winnerPoints = match.points ?? card.defaultPoints
    const surprisePoints = match.surpriseEntrantPoints ?? card.defaultPoints

    for (const player of submittedPlayers) {
      const score = accumulators.get(player.id)
      if (!score) continue

      const playerMatchPick = pickMatchPick(player.picks.matchPicks, match.id)

      if (keyMatchResult.winnerName.trim() && playerMatchPick?.winnerName && answerEquals(keyMatchResult.winnerName, playerMatchPick.winnerName)) {
        score.score += winnerPoints
        score.winnerPoints += winnerPoints
      }

      if (match.isBattleRoyal && keyMatchResult.battleRoyalEntryOrder.length > 0) {
        const keyedEntrants = new Set(keyMatchResult.battleRoyalEntryOrder.map((entrant) => normalizeText(entrant)))
        const playerSet = new Set((playerMatchPick?.battleRoyalEntrants ?? []).map((entrant) => normalizeText(entrant)))
        let matchesCount = 0
        for (const entrant of playerSet) {
          if (keyedEntrants.has(entrant)) {
            matchesCount += 1
          }
        }

        const cappedMatches = Math.min(matchesCount, Math.max(0, match.surpriseSlots))
        const points = cappedMatches * surprisePoints
        if (points > 0) {
          score.score += points
          score.surprisePoints += points
        }
      }

      for (const question of match.bonusQuestions) {
        const keyAnswer = keyMatchResult.bonusAnswers.find((answer) => answer.questionId === question.id)?.answer ?? ''
        const playerAnswer = pickBonusAnswer(playerMatchPick?.bonusAnswers ?? [], question.id)
        const result = scoreForQuestion(question, card.defaultPoints, keyAnswer, playerAnswer)

        if (result.score > 0) {
          score.score += result.score
          score.bonusPoints += result.score
          continue
        }

        if (result.isClosestCandidate && typeof result.distance === 'number') {
          const key = `match:${match.id}:${question.id}`
          const points = question.points ?? card.defaultPoints
          const existing = closestBuckets.get(key)
          if (existing) {
            existing.entries.push({ playerId: player.id, distance: result.distance })
          } else {
            closestBuckets.set(key, {
              key,
              points,
              entries: [{ playerId: player.id, distance: result.distance }],
            })
          }
        }
      }
    }
  }

  for (const question of card.eventBonusQuestions) {
    const keyAnswer = keyPayload.eventBonusAnswers.find((answer) => answer.questionId === question.id)?.answer ?? ''

    for (const player of submittedPlayers) {
      const score = accumulators.get(player.id)
      if (!score) continue

      const playerAnswer = pickBonusAnswer(player.picks.eventBonusAnswers, question.id)
      const result = scoreForQuestion(question, card.defaultPoints, keyAnswer, playerAnswer)

      if (result.score > 0) {
        score.score += result.score
        score.bonusPoints += result.score
        continue
      }

      if (result.isClosestCandidate && typeof result.distance === 'number') {
        const key = `event:${question.id}`
        const points = question.points ?? card.defaultPoints
        const existing = closestBuckets.get(key)
        if (existing) {
          existing.entries.push({ playerId: player.id, distance: result.distance })
        } else {
          closestBuckets.set(key, {
            key,
            points,
            entries: [{ playerId: player.id, distance: result.distance }],
          })
        }
      }
    }
  }

  for (const bucket of closestBuckets.values()) {
    if (bucket.entries.length === 0 || bucket.points <= 0) continue

    const minDistance = Math.min(...bucket.entries.map((entry) => entry.distance))
    for (const entry of bucket.entries) {
      if (Math.abs(entry.distance - minDistance) > 0.0001) continue

      const score = accumulators.get(entry.playerId)
      if (!score) continue
      score.score += bucket.points
      score.bonusPoints += bucket.points
    }
  }

  const ranked = Array.from(accumulators.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.nickname.localeCompare(b.nickname)
    })

  let currentRank = 0
  let previousScore: number | null = null

  return ranked.map((entry, index) => {
    if (previousScore === null || entry.score < previousScore) {
      currentRank = index + 1
      previousScore = entry.score
    }

    return {
      rank: currentRank,
      nickname: entry.nickname,
      score: entry.score,
      breakdown: {
        winnerPoints: entry.winnerPoints,
        bonusPoints: entry.bonusPoints,
        surprisePoints: entry.surprisePoints,
      },
      isSubmitted: entry.isSubmitted,
      lastUpdatedAt: entry.updatedAt,
      lastSeenAt: entry.lastSeenAt,
    }
  })
}

async function insertLiveGameEvent(gameId: string, eventType: string, message: string): Promise<void> {
  await db
    .insertInto('live_game_events')
    .values({
      id: randomUUID(),
      game_id: gameId,
      event_type: eventType,
      event_payload_json: JSON.stringify({ message }),
      created_at: nowIso(),
    })
    .execute()
}

async function insertLiveGameEvents(gameId: string, events: PendingLiveGameEvent[]): Promise<void> {
  for (const event of events) {
    await insertLiveGameEvent(gameId, event.type, event.message)
  }
}

async function getCardForGame(cardId: string, hostUserId: string): Promise<ResolvedCard | null> {
  return findResolvedReadableCardById(cardId, hostUserId)
}

async function getHostOwnedCard(cardId: string, hostUserId: string): Promise<boolean> {
  const row = await db
    .selectFrom('cards')
    .select('id')
    .where('id', '=', cardId)
    .where((eb) => isCardOwner(eb, hostUserId))
    .executeTakeFirst()

  return Boolean(row)
}

function parseMatchTimerId(timerId: string): string | null {
  if (!timerId.startsWith('match:')) return null
  const matchId = timerId.slice('match:'.length).trim()
  return matchId.length > 0 ? matchId : null
}

function hasNonEmptyValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function mergeKeyAnswers(previous: LiveKeyAnswer[], incoming: LiveKeyAnswer[]): LiveKeyAnswer[] {
  const incomingByQuestionId = new Map(incoming.map((answer) => [answer.questionId, answer]))
  const merged: LiveKeyAnswer[] = []
  const seen = new Set<string>()

  for (const previousAnswer of previous) {
    const nextAnswer = incomingByQuestionId.get(previousAnswer.questionId)
    merged.push(nextAnswer ?? previousAnswer)
    seen.add(previousAnswer.questionId)
  }

  for (const incomingAnswer of incoming) {
    if (seen.has(incomingAnswer.questionId)) continue
    merged.push(incomingAnswer)
  }

  return merged
}

function mergeKeyTimers(previous: LiveKeyTimer[], incoming: LiveKeyTimer[]): LiveKeyTimer[] {
  const incomingById = new Map(incoming.map((timer) => [timer.id, timer]))
  const merged: LiveKeyTimer[] = []
  const seen = new Set<string>()

  for (const previousTimer of previous) {
    const nextTimer = incomingById.get(previousTimer.id)
    merged.push(nextTimer ?? previousTimer)
    seen.add(previousTimer.id)
  }

  for (const incomingTimer of incoming) {
    if (seen.has(incomingTimer.id)) continue
    merged.push(incomingTimer)
  }

  return merged
}

function mergeKeyMatchResults(previous: LiveKeyMatchResult[], incoming: LiveKeyMatchResult[]): LiveKeyMatchResult[] {
  const previousByMatchId = new Map(previous.map((result) => [result.matchId, result]))
  const merged: LiveKeyMatchResult[] = []
  const seen = new Set<string>()

  for (const incomingResult of incoming) {
    const previousResult = previousByMatchId.get(incomingResult.matchId)
    merged.push({
      ...incomingResult,
      bonusAnswers: mergeKeyAnswers(previousResult?.bonusAnswers ?? [], incomingResult.bonusAnswers),
    })
    seen.add(incomingResult.matchId)
  }

  for (const previousResult of previous) {
    if (seen.has(previousResult.matchId)) continue
    merged.push(previousResult)
  }

  return merged
}

function mergeLiveKeyPayload(previous: LiveGameKeyPayload, incoming: LiveGameKeyPayload): LiveGameKeyPayload {
  return normalizeLiveKeyPayload({
    timers: mergeKeyTimers(previous.timers, incoming.timers),
    matchResults: mergeKeyMatchResults(previous.matchResults, incoming.matchResults),
    eventBonusAnswers: mergeKeyAnswers(previous.eventBonusAnswers, incoming.eventBonusAnswers),
    tiebreakerAnswer: incoming.tiebreakerAnswer,
    tiebreakerRecordedAt: incoming.tiebreakerRecordedAt,
    tiebreakerTimerId: incoming.tiebreakerTimerId,
    scoreOverrides: incoming.scoreOverrides,
    winnerOverrides: incoming.winnerOverrides,
  })
}

function autoApplyTimerLocks(
  previousPayload: LiveGameKeyPayload,
  nextPayload: LiveGameKeyPayload,
  lockState: LiveGameLockState,
): LiveGameLockState {
  const nextLockState = normalizeLiveGameLockState(lockState)
  const previousTimers = new Map(previousPayload.timers.map((timer) => [timer.id, timer]))

  for (const timer of nextPayload.timers) {
    const matchId = parseMatchTimerId(timer.id)
    if (!matchId) continue

    const previousTimer = previousTimers.get(timer.id)
    const wasRunning = previousTimer?.isRunning === true
    const isRunning = timer.isRunning === true

    if (!wasRunning && isRunning) {
      nextLockState.matchLocks[matchId] = {
        locked: true,
        source: 'timer',
      }
    }
  }

  return nextLockState
}

function autoApplyValueLocks(
  previousPayload: LiveGameKeyPayload,
  nextPayload: LiveGameKeyPayload,
  lockState: LiveGameLockState,
): LiveGameLockState {
  const nextLockState = normalizeLiveGameLockState(lockState)
  const previousMatchResults = new Map(previousPayload.matchResults.map((result) => [result.matchId, result]))
  const previousEventAnswers = new Map(previousPayload.eventBonusAnswers.map((answer) => [answer.questionId, answer.answer]))

  for (const result of nextPayload.matchResults) {
    const previousResult = previousMatchResults.get(result.matchId)
    if (!hasNonEmptyValue(previousResult?.winnerName) && hasNonEmptyValue(result.winnerName)) {
      nextLockState.matchLocks[result.matchId] = {
        locked: true,
        source: 'host',
      }
    }

    const previousBonusAnswers = new Map((previousResult?.bonusAnswers ?? []).map((answer) => [answer.questionId, answer.answer]))
    for (const answer of result.bonusAnswers) {
      if (hasNonEmptyValue(previousBonusAnswers.get(answer.questionId))) continue
      if (!hasNonEmptyValue(answer.answer)) continue

      nextLockState.matchBonusLocks[toMatchBonusKey(result.matchId, answer.questionId)] = {
        locked: true,
        source: 'host',
      }
    }
  }

  for (const answer of nextPayload.eventBonusAnswers) {
    if (hasNonEmptyValue(previousEventAnswers.get(answer.questionId))) continue
    if (!hasNonEmptyValue(answer.answer)) continue

    nextLockState.eventBonusLocks[answer.questionId] = {
      locked: true,
      source: 'host',
    }
  }

  return nextLockState
}

export function createLiveGameSessionToken(): string {
  return randomBytes(24).toString('base64url')
}

export function hashLiveGameSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createLiveGame(
  cardId: string,
  hostUserId: string,
  options?: {
    hostIp?: string | null
    hostCity?: string | null
    hostCountry?: string | null
    hostLatitude?: number | null
    hostLongitude?: number | null
  },
): Promise<LiveGame | null> {
  const ownsCard = await getHostOwnedCard(cardId, hostUserId)
  if (!ownsCard) return null

  const now = nowIso()
  const joinCode = await createUniqueJoinCode()
  const qrJoinSecret = buildJoinBypassSecret()
  const id = randomUUID()

  const values: Insertable<LiveGames> = {
    id,
    card_id: cardId,
    host_user_id: hostUserId,
    mode: 'room',
    join_code: joinCode,
    allow_late_joins: 1,
    status: 'lobby',
    host_join_ip: normalizeOptionalText(options?.hostIp),
    host_geo_city: normalizeOptionalText(options?.hostCity),
    host_geo_country: normalizeOptionalText(options?.hostCountry),
    host_geo_latitude: normalizeOptionalNumber(options?.hostLatitude),
    host_geo_longitude: normalizeOptionalNumber(options?.hostLongitude),
    geo_radius_km: DEFAULT_GEO_RADIUS_KM,
    qr_join_secret: qrJoinSecret,
    key_payload_json: JSON.stringify(normalizeLiveKeyPayload(null)),
    lock_state_json: JSON.stringify(normalizeLiveGameLockState(null)),
    expires_at: new Date(Date.now() + LIVE_GAME_DURATION_MS).toISOString(),
    ended_at: null,
    created_at: now,
    updated_at: now,
  }

  lobbyDebugLog('host-room-created', {
    gameId: id,
    joinCode,
    hostUserId,
    hostJoinIp: values.host_join_ip ?? null,
    hostJoinIpNormalized: normalizeIpForComparison(values.host_join_ip ?? null),
    hostGeoCity: values.host_geo_city ?? null,
    hostGeoCountry: values.host_geo_country ?? null,
    hostGeoLatitude: values.host_geo_latitude ?? null,
    hostGeoLongitude: values.host_geo_longitude ?? null,
    geoRadiusKm: values.geo_radius_km ?? DEFAULT_GEO_RADIUS_KM,
    hasQrJoinSecret: typeof values.qr_join_secret === 'string' && values.qr_join_secret.length > 0,
  })

  await db.insertInto('live_games').values(values).execute()

  await insertLiveGameEvent(id, 'game.created', 'Game room created')

  const created = await db
    .selectFrom('live_games')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

  return mapLiveGame(created)
}

export async function listCardLiveGames(cardId: string, hostUserId: string): Promise<LiveGame[] | null> {
  const ownsCard = await getHostOwnedCard(cardId, hostUserId)
  if (!ownsCard) return null

  const rows = await db
    .selectFrom('live_games')
    .selectAll()
    .where('card_id', '=', cardId)
    .where('mode', '=', 'room')
    .orderBy('created_at', 'desc')
    .execute()

  return rows.map((row) => mapLiveGame(row))
}

export async function getHostLiveGame(gameId: string, hostUserId: string): Promise<LiveGame | null> {
  const row = await db
    .selectFrom('live_games')
    .selectAll()
    .where('id', '=', gameId)
    .where('host_user_id', '=', hostUserId)
    .where('mode', '=', 'room')
    .executeTakeFirst()

  if (!row) return null

  const card = await getCardForGame(row.card_id, hostUserId)
  if (!card) return null

  const hydrated = await autoStartGameForCardEvent(row, card)
  return mapLiveGame(hydrated)
}

export async function getLiveGameByJoinCode(joinCode: string): Promise<LiveGame | null> {
  const row = await db
    .selectFrom('live_games')
    .selectAll()
    .where('join_code', '=', joinCode.trim().toUpperCase())
    .where('mode', '=', 'room')
    .executeTakeFirst()

  if (!row) return null

  const card = await getCardForGame(row.card_id, row.host_user_id)
  if (!card) return null

  const hydrated = await autoStartGameForCardEvent(row, card)
  return mapLiveGame(hydrated)
}

export async function getLiveGameJoinPreview(joinCode: string): Promise<{
  game: LiveGame
  eventName: string
  eventStartAt: string | null
  isStarted: boolean
} | null> {
  const game = await getLiveGameByJoinCode(joinCode)
  if (!game) return null

  const card = await getCardForGame(game.cardId, game.hostUserId)
  if (!card) return null

  return {
    game,
    eventName: card.eventName || 'Untitled Event',
    eventStartAt: card.eventDate.trim() ? card.eventDate : null,
    isStarted: isGameStartedByCardEvent(game, card),
  }
}

export async function updateLiveGameStatus(
  gameId: string,
  hostUserId: string,
  next: {
    status?: LiveGameStatus
    allowLateJoins?: boolean
  },
): Promise<LiveGame | null> {
  if (typeof next.status === 'undefined' && typeof next.allowLateJoins === 'undefined') {
    return null
  }

  const row = await db
    .selectFrom('live_games')
    .selectAll()
    .where('id', '=', gameId)
    .where('host_user_id', '=', hostUserId)
    .executeTakeFirst()

  if (!row) return null

  const current = mapLiveGame(row)
  const status = next.status ?? current.status
  const allowLateJoins = typeof next.allowLateJoins === 'boolean' ? next.allowLateJoins : current.allowLateJoins
  const now = nowIso()
  const nextExpiresAt = new Date(Date.now() + LIVE_GAME_DURATION_MS).toISOString()

  const updated = await db
    .updateTable('live_games')
    .set({
      status,
      allow_late_joins: allowLateJoins ? 1 : 0,
      expires_at: status === 'ended' ? undefined : nextExpiresAt,
      ended_at: status === 'ended' ? now : null,
      updated_at: now,
    })
    .where('id', '=', gameId)
    .where('host_user_id', '=', hostUserId)
    .returningAll()
    .executeTakeFirst()

  if (!updated) return null

  if (current.status !== status) {
    await insertLiveGameEvent(gameId, 'game.status', `Room status changed to ${status}`)
  }
  if (current.allowLateJoins !== allowLateJoins) {
    await insertLiveGameEvent(
      gameId,
      'game.entries',
      allowLateJoins ? 'Mid-game entries enabled' : 'Mid-game entries disabled',
    )
  }

  await sendLiveGamePushToSubscribers(gameId, {
    title: 'Live Game Update',
    body: current.status !== status
      ? `Room status changed to ${status}.`
      : current.allowLateJoins !== allowLateJoins
        ? allowLateJoins
          ? 'Mid-game entries enabled.'
          : 'Mid-game entries disabled.'
        : 'Room settings updated.',
    url: `/games/${gameId}/play?code=${encodeURIComponent(updated.join_code)}`,
    tag: `live-game-status:${gameId}`,
  })

  if (status === 'ended') {
    await db
      .deleteFrom('live_game_push_subscriptions')
      .where('game_id', '=', gameId)
      .execute()
  }

  return mapLiveGame(updated)
}

export async function updateLiveGameLocks(
  gameId: string,
  hostUserId: string,
  lockState: LiveGameLockState,
): Promise<LiveGame | null> {
  const row = await db
    .selectFrom('live_games')
    .selectAll()
    .where('id', '=', gameId)
    .where('host_user_id', '=', hostUserId)
    .executeTakeFirst()

  if (!row) return null

  const previousGame = mapLiveGame(row)
  const card = await getCardForGame(previousGame.cardId, hostUserId)
  if (!card) return null

  const now = nowIso()
  const normalizedLockState = normalizeLiveGameLockState(lockState)

  const updated = await db
    .updateTable('live_games')
    .set({
      lock_state_json: JSON.stringify(normalizedLockState),
      updated_at: now,
    })
    .where('id', '=', gameId)
    .where('host_user_id', '=', hostUserId)
    .returningAll()
    .executeTakeFirst()

  if (!updated) return null

  const lockEvents = buildLockMutationEvents(card, previousGame.lockState, normalizedLockState)
  if (lockEvents.length > 0) {
    await insertLiveGameEvents(gameId, lockEvents)
    await sendLiveGamePushToSubscribers(gameId, {
      title: 'Live Game Update',
      body: lockEvents[0]?.message ?? 'Pick locks were updated.',
      url: `/games/${gameId}/play?code=${encodeURIComponent(updated.join_code)}`,
      tag: `live-game-locks:${gameId}`,
    })
  }

  return mapLiveGame(updated)
}

export async function getLiveGameKeyForHost(
  gameId: string,
  hostUserId: string,
): Promise<{ game: LiveGame; card: ResolvedCard } | null> {
  const game = await getHostLiveGame(gameId, hostUserId)
  if (!game) return null

  const card = await getCardForGame(game.cardId, hostUserId)
  if (!card) return null

  return { game, card }
}

export async function updateLiveGameKeyForHost(
  gameId: string,
  hostUserId: string,
  payload: LiveGameKeyPayload,
  expectedUpdatedAt?: string,
): Promise<LiveGame | 'conflict' | null> {
  const row = await db
    .selectFrom('live_games')
    .selectAll()
    .where('id', '=', gameId)
    .where('host_user_id', '=', hostUserId)
    .executeTakeFirst()

  if (!row) return null

  const previousGame = mapLiveGame(row)
  const card = await getCardForGame(previousGame.cardId, hostUserId)
  if (!card) return null
  if (expectedUpdatedAt && row.updated_at !== expectedUpdatedAt) {
    return 'conflict'
  }

  const normalizedPayload = normalizeLiveKeyPayload(payload)
  const mergedPayload = mergeLiveKeyPayload(previousGame.keyPayload, normalizedPayload)
  const valueLockedState = autoApplyValueLocks(previousGame.keyPayload, mergedPayload, previousGame.lockState)
  const nextLockState = autoApplyTimerLocks(previousGame.keyPayload, mergedPayload, valueLockedState)
  const now = nowIso()

  const updated = await db
    .updateTable('live_games')
    .set({
      key_payload_json: JSON.stringify(mergedPayload),
      lock_state_json: JSON.stringify(nextLockState),
      updated_at: now,
    })
    .where('id', '=', gameId)
    .where('host_user_id', '=', hostUserId)
    .returningAll()
    .executeTakeFirst()

  if (!updated) return null

  const events = [
    ...buildKeyMutationEvents(card, previousGame.keyPayload, mergedPayload),
    ...buildLockMutationEvents(card, previousGame.lockState, nextLockState),
  ]

  if (events.length > 0) {
    await insertLiveGameEvents(gameId, events)
    await sendLiveGamePushToSubscribers(gameId, {
      title: 'Live Game Update',
      body: events[0]?.message ?? 'New scoring updates are available.',
      url: `/games/${gameId}/play?code=${encodeURIComponent(updated.join_code)}`,
      tag: `live-game-score:${gameId}`,
    })
  }

  return mapLiveGame(updated)
}

export async function findLiveGamePlayerBySession(
  gameId: string,
  sessionTokenHash: string,
  options?: { includeNonApproved?: boolean },
): Promise<LiveGamePlayer | null> {
  let query = db
    .selectFrom('live_game_players')
    .selectAll()
    .where('game_id', '=', gameId)
    .where('session_token_hash', '=', sessionTokenHash)
  if (!options?.includeNonApproved) {
    query = query.where('join_status', '=', 'approved')
  }
  const row = await query.executeTakeFirst()

  if (!row) return null
  return mapLiveGamePlayer(row)
}

function evaluateJoinDecision(game: LiveGame, options?: JoinLiveGameOptions): JoinDecision {
  const requestIp = normalizeOptionalText(options?.requestIp)
  const requestIpNormalized = normalizeIpForComparison(requestIp)
  const hostIpNormalized = normalizeIpForComparison(game.hostJoinIp)
  const bypassSecret = normalizeOptionalText(options?.bypassSecret)
  const requestLatitude = normalizeOptionalNumber(options?.requestLatitude)
  const requestLongitude = normalizeOptionalNumber(options?.requestLongitude)
  const hasHostCoordinates = game.hostGeoLatitude !== null && game.hostGeoLongitude !== null
  const hasGuardrails = Boolean(game.hostJoinIp) || hasHostCoordinates || Boolean(game.qrJoinSecret)
  const hasBypassSecret = Boolean(bypassSecret)
  const bypassMatched = Boolean(bypassSecret && game.qrJoinSecret && bypassSecret === game.qrJoinSecret)
  const sameIpMatched = Boolean(
    requestIp
    && game.hostJoinIp
    && requestIpNormalized
    && hostIpNormalized
    && requestIpNormalized === hostIpNormalized,
  )
  const sameLanMatched = isSameLanSubnet(requestIpNormalized, hostIpNormalized)

  if (!hasGuardrails) {
    lobbyDebugLog('join-decision', {
      gameId: game.id,
      joinCode: game.joinCode,
      reason: 'no-guardrails-configured',
      decision: 'approved',
      requestIp,
      requestIpNormalized,
      hostIp: game.hostJoinIp,
      hostIpNormalized,
      hasBypassSecret,
      bypassMatched,
    })
    return {
      status: 'approved',
      approvedAt: nowIso(),
      distanceKm: null,
    }
  }

  if (bypassMatched) {
    lobbyDebugLog('join-decision', {
      gameId: game.id,
      joinCode: game.joinCode,
      reason: 'qr-secret-match',
      decision: 'approved',
      requestIp,
      requestIpNormalized,
      hostIp: game.hostJoinIp,
      hostIpNormalized,
      hasBypassSecret,
      bypassMatched,
    })
    return {
      status: 'approved',
      approvedAt: nowIso(),
      distanceKm: null,
    }
  }

  if (sameIpMatched) {
    lobbyDebugLog('join-decision', {
      gameId: game.id,
      joinCode: game.joinCode,
      reason: 'same-public-ip-match',
      decision: 'approved',
      requestIp,
      requestIpNormalized,
      hostIp: game.hostJoinIp,
      hostIpNormalized,
      hasBypassSecret,
      bypassMatched,
    })
    return {
      status: 'approved',
      approvedAt: nowIso(),
      distanceKm: null,
    }
  }

  if (sameLanMatched) {
    lobbyDebugLog('join-decision', {
      gameId: game.id,
      joinCode: game.joinCode,
      reason: 'same-lan-subnet-match',
      decision: 'approved',
      requestIp,
      requestIpNormalized,
      hostIp: game.hostJoinIp,
      hostIpNormalized,
      hasBypassSecret,
      bypassMatched,
    })
    return {
      status: 'approved',
      approvedAt: nowIso(),
      distanceKm: null,
    }
  }

  if (
    hasHostCoordinates
    && requestLatitude !== null
    && requestLongitude !== null
    && game.hostGeoLatitude !== null
    && game.hostGeoLongitude !== null
  ) {
    const distanceKm = haversineKm(
      { latitude: requestLatitude, longitude: requestLongitude },
      { latitude: game.hostGeoLatitude, longitude: game.hostGeoLongitude },
    )
    const radiusKm = Math.max(0, game.geoRadiusKm || DEFAULT_GEO_RADIUS_KM)

    if (distanceKm <= radiusKm) {
      lobbyDebugLog('join-decision', {
        gameId: game.id,
        joinCode: game.joinCode,
        reason: 'geo-within-radius',
        decision: 'approved',
        requestIp,
        requestIpNormalized,
        hostIp: game.hostJoinIp,
        hostIpNormalized,
        requestLatitude,
        requestLongitude,
        hostLatitude: game.hostGeoLatitude,
        hostLongitude: game.hostGeoLongitude,
        distanceKm,
        radiusKm,
        hasBypassSecret,
        bypassMatched,
      })
      return {
        status: 'approved',
        approvedAt: nowIso(),
        distanceKm,
      }
    }

    lobbyDebugLog('join-decision', {
      gameId: game.id,
      joinCode: game.joinCode,
      reason: 'geo-outside-radius',
      decision: 'pending',
      requestIp,
      requestIpNormalized,
      hostIp: game.hostJoinIp,
      hostIpNormalized,
      requestLatitude,
      requestLongitude,
      hostLatitude: game.hostGeoLatitude,
      hostLongitude: game.hostGeoLongitude,
      distanceKm,
      radiusKm,
      hasBypassSecret,
      bypassMatched,
    })
    return {
      status: 'pending',
      approvedAt: null,
      distanceKm,
    }
  }

  lobbyDebugLog('join-decision', {
    gameId: game.id,
    joinCode: game.joinCode,
    reason: 'no-auto-approval-signal',
    decision: 'pending',
    requestIp,
    requestIpNormalized,
    hostIp: game.hostJoinIp,
    hostIpNormalized,
    requestLatitude,
    requestLongitude,
    hostLatitude: game.hostGeoLatitude,
    hostLongitude: game.hostGeoLongitude,
    hasHostCoordinates,
    hasBypassSecret,
    bypassMatched,
    sameIpMatched,
    sameLanMatched,
  })
  return {
    status: 'pending',
    approvedAt: null,
    distanceKm: null,
  }
}

export async function joinLiveGameWithNickname(
  joinCode: string,
  nickname: string,
  sessionTokenHash: string | null,
  options?: JoinLiveGameOptions,
): Promise<
  | { ok: true; game: LiveGame; player: LiveGamePlayer; isNew: boolean }
  | { ok: false; reason: 'not-found' | 'expired' | 'ended' | 'entry-closed' | 'nickname-taken' | 'session-mismatch' | 'pending-approval' | 'rejected' }
> {
  const game = await getLiveGameByJoinCode(joinCode)
  if (!game) {
    return { ok: false, reason: 'not-found' }
  }

  if (game.status === 'ended') {
    return { ok: false, reason: 'ended' }
  }

  if (new Date(game.expiresAt).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  const cleanedNickname = normalizeNickname(nickname)
  const nicknameKey = normalizeNicknameKey(cleanedNickname)
  const now = nowIso()
  const deviceInfo = parseJoinDeviceInfo(options?.deviceInfo)
  const normalizedClerkUserId = normalizeOptionalText(options?.clerkUserId)
  const requestIp = normalizeOptionalText(options?.requestIp)
  const requestCity = normalizeOptionalText(options?.requestCity)
  const requestCountry = normalizeOptionalText(options?.requestCountry)
  const requestLatitude = normalizeOptionalNumber(options?.requestLatitude)
  const requestLongitude = normalizeOptionalNumber(options?.requestLongitude)
  const joinDecision = evaluateJoinDecision(game, options)

  if (normalizedClerkUserId) {
    const existingByClerkUser = await db
      .selectFrom('live_game_players')
      .selectAll()
      .where('game_id', '=', game.id)
      .where('clerk_user_id', '=', normalizedClerkUserId)
      .executeTakeFirst()

    if (existingByClerkUser) {
      const nicknameChanged = normalizeNicknameKey(existingByClerkUser.nickname) !== nicknameKey

      if (nicknameChanged) {
        const nicknameTakenByOther = await db
          .selectFrom('live_game_players')
          .select('id')
          .where('game_id', '=', game.id)
          .where('normalized_nickname', '=', nicknameKey)
          .where('id', '!=', String(existingByClerkUser.id))
          .executeTakeFirst()

        if (nicknameTakenByOther) {
          return { ok: false, reason: 'nickname-taken' }
        }
      }

      await db
        .updateTable('live_game_players')
        .set({
          nickname: nicknameChanged ? cleanedNickname : existingByClerkUser.nickname,
          normalized_nickname: nicknameChanged ? nicknameKey : normalizeNicknameKey(existingByClerkUser.nickname),
          auth_method: 'clerk',
          session_token_hash: sessionTokenHash ?? existingByClerkUser.session_token_hash,
          last_seen_at: now,
          updated_at: now,
          user_agent: deviceInfo.userAgent,
          user_agent_data_json: deviceInfo.userAgentDataJson,
          browser_name: deviceInfo.browserName,
          browser_version: deviceInfo.browserVersion,
          os_name: deviceInfo.osName,
          os_version: deviceInfo.osVersion,
          device_type: deviceInfo.deviceType,
          device_vendor: deviceInfo.deviceVendor,
          device_model: deviceInfo.deviceModel,
          platform: deviceInfo.platform,
          platform_version: deviceInfo.platformVersion,
          architecture: deviceInfo.architecture,
          join_request_ip: requestIp ?? existingByClerkUser.join_request_ip,
          join_request_city: requestCity ?? existingByClerkUser.join_request_city,
          join_request_country: requestCountry ?? existingByClerkUser.join_request_country,
          join_request_latitude: requestLatitude ?? existingByClerkUser.join_request_latitude,
          join_request_longitude: requestLongitude ?? existingByClerkUser.join_request_longitude,
          join_request_distance_km: joinDecision.distanceKm ?? existingByClerkUser.join_request_distance_km,
          join_status: existingByClerkUser.join_status === 'rejected'
            ? 'rejected'
            : joinDecision.status === 'approved'
              ? 'approved'
              : existingByClerkUser.join_status === 'pending'
                ? 'pending'
                : 'approved',
          approved_at: existingByClerkUser.join_status === 'rejected'
            ? existingByClerkUser.approved_at
            : joinDecision.status === 'approved'
              ? now
              : existingByClerkUser.approved_at,
        })
        .where('id', '=', String(existingByClerkUser.id))
        .execute()

      const refreshed = await db
        .selectFrom('live_game_players')
        .selectAll()
        .where('id', '=', String(existingByClerkUser.id))
        .executeTakeFirstOrThrow()

      const mapped = mapLiveGamePlayer(refreshed)
      if (mapped.joinStatus === 'pending') {
        return { ok: false, reason: 'pending-approval' }
      }
      if (mapped.joinStatus === 'rejected') {
        return { ok: false, reason: 'rejected' }
      }

      return {
        ok: true,
        game,
        player: mapped,
        isNew: false,
      }
    }
  }

  if (sessionTokenHash) {
    const existingBySession = await findLiveGamePlayerBySession(game.id, sessionTokenHash, {
      includeNonApproved: true,
    })
    if (existingBySession) {
      if (normalizeNicknameKey(existingBySession.nickname) !== nicknameKey) {
        return { ok: false, reason: 'session-mismatch' }
      }

      if (existingBySession.joinStatus === 'rejected') {
        return { ok: false, reason: 'rejected' }
      }

      const nextJoinStatus = joinDecision.status === 'approved' ? 'approved' : existingBySession.joinStatus

      await db
        .updateTable('live_game_players')
        .set({
          auth_method: normalizedClerkUserId ? 'clerk' : existingBySession.authMethod,
          clerk_user_id: normalizedClerkUserId ?? existingBySession.clerkUserId,
          last_seen_at: now,
          updated_at: now,
          user_agent: deviceInfo.userAgent,
          user_agent_data_json: deviceInfo.userAgentDataJson,
          browser_name: deviceInfo.browserName,
          browser_version: deviceInfo.browserVersion,
          os_name: deviceInfo.osName,
          os_version: deviceInfo.osVersion,
          device_type: deviceInfo.deviceType,
          device_vendor: deviceInfo.deviceVendor,
          device_model: deviceInfo.deviceModel,
          platform: deviceInfo.platform,
          platform_version: deviceInfo.platformVersion,
          architecture: deviceInfo.architecture,
          join_request_ip: requestIp ?? existingBySession.joinRequestIp,
          join_request_city: requestCity ?? existingBySession.joinRequestCity,
          join_request_country: requestCountry ?? existingBySession.joinRequestCountry,
          join_request_latitude: requestLatitude ?? existingBySession.joinRequestLatitude,
          join_request_longitude: requestLongitude ?? existingBySession.joinRequestLongitude,
          join_request_distance_km: joinDecision.distanceKm ?? existingBySession.joinRequestDistanceKm,
          join_status: nextJoinStatus,
          approved_at: nextJoinStatus === 'approved' ? now : existingBySession.approvedAt,
        })
        .where('id', '=', existingBySession.id)
        .execute()

      if (nextJoinStatus === 'pending') {
        return { ok: false, reason: 'pending-approval' }
      }

      return {
        ok: true,
        game,
        player: {
          ...existingBySession,
          authMethod: normalizedClerkUserId ? 'clerk' : existingBySession.authMethod,
          clerkUserId: normalizedClerkUserId ?? existingBySession.clerkUserId,
          lastSeenAt: now,
          updatedAt: now,
          browserName: deviceInfo.browserName,
          browserVersion: deviceInfo.browserVersion,
          osName: deviceInfo.osName,
          osVersion: deviceInfo.osVersion,
          deviceType: deviceInfo.deviceType,
          deviceVendor: deviceInfo.deviceVendor,
          deviceModel: deviceInfo.deviceModel,
          platform: deviceInfo.platform,
          platformVersion: deviceInfo.platformVersion,
          architecture: deviceInfo.architecture,
          joinStatus: nextJoinStatus,
          approvedAt: nextJoinStatus === 'approved' ? now : existingBySession.approvedAt,
          joinRequestIp: requestIp ?? existingBySession.joinRequestIp,
          joinRequestCity: requestCity ?? existingBySession.joinRequestCity,
          joinRequestCountry: requestCountry ?? existingBySession.joinRequestCountry,
          joinRequestLatitude: requestLatitude ?? existingBySession.joinRequestLatitude,
          joinRequestLongitude: requestLongitude ?? existingBySession.joinRequestLongitude,
          joinRequestDistanceKm: joinDecision.distanceKm ?? existingBySession.joinRequestDistanceKm,
        },
        isNew: false,
      }
    }
  }

  if (game.status === 'live' && !game.allowLateJoins) {
    return { ok: false, reason: 'entry-closed' }
  }

  const existingByNickname = await db
    .selectFrom('live_game_players')
    .select('id')
    .where('game_id', '=', game.id)
    .where('normalized_nickname', '=', nicknameKey)
    .executeTakeFirst()

  if (existingByNickname) {
    return { ok: false, reason: 'nickname-taken' }
  }

  const playerId = randomUUID()

  await db
    .insertInto('live_game_players')
    .values({
      id: playerId,
      game_id: game.id,
      nickname: cleanedNickname,
      normalized_nickname: nicknameKey,
      auth_method: normalizedClerkUserId ? 'clerk' : 'guest',
      clerk_user_id: normalizedClerkUserId,
      session_token_hash: sessionTokenHash ?? hashLiveGameSessionToken(createLiveGameSessionToken()),
      picks_json: JSON.stringify(normalizeLivePlayerPicks(null)),
      is_submitted: 0,
      submitted_at: null,
      joined_at: now,
      last_seen_at: now,
      updated_at: now,
      user_agent: deviceInfo.userAgent,
      user_agent_data_json: deviceInfo.userAgentDataJson,
      browser_name: deviceInfo.browserName,
      browser_version: deviceInfo.browserVersion,
      os_name: deviceInfo.osName,
      os_version: deviceInfo.osVersion,
      device_type: deviceInfo.deviceType,
      device_vendor: deviceInfo.deviceVendor,
      device_model: deviceInfo.deviceModel,
      platform: deviceInfo.platform,
      platform_version: deviceInfo.platformVersion,
      architecture: deviceInfo.architecture,
      join_status: joinDecision.status,
      approved_at: joinDecision.status === 'approved' ? joinDecision.approvedAt : null,
      join_request_ip: requestIp,
      join_request_city: requestCity,
      join_request_country: requestCountry,
      join_request_latitude: requestLatitude,
      join_request_longitude: requestLongitude,
      join_request_distance_km: joinDecision.distanceKm,
    })
    .execute()

  if (joinDecision.status === 'approved') {
    await insertLiveGameEvent(game.id, 'player.joined', `${cleanedNickname} joined the game`)
  } else {
    await insertLiveGameEvent(game.id, 'player.pending', `${cleanedNickname} is waiting for host approval`)
  }

  const playerRow = await db
    .selectFrom('live_game_players')
    .selectAll()
    .where('id', '=', playerId)
    .executeTakeFirstOrThrow()

  const mapped = mapLiveGamePlayer(playerRow)
  if (mapped.joinStatus === 'pending') {
    return { ok: false, reason: 'pending-approval' }
  }

  return {
    ok: true,
    game,
    player: mapped,
    isNew: true,
  }
}

export function buildEffectiveLockSnapshot(
  game: LiveGame,
  card: ResolvedCard,
): {
  globalLocked: boolean
  matchLocks: Record<string, boolean>
  matchBonusLocks: Record<string, boolean>
  eventBonusLocks: Record<string, boolean>
  tiebreakerLocked: boolean
} {
  const matchLocks: Record<string, boolean> = {}
  const matchBonusLocks: Record<string, boolean> = {}
  const eventBonusLocks: Record<string, boolean> = {}

  for (const match of card.matches) {
    matchLocks[match.id] = isMatchLocked(game.lockState, match.id)

    for (const question of match.bonusQuestions) {
      const key = toMatchBonusKey(match.id, question.id)
      matchBonusLocks[key] = isMatchBonusLocked(game.lockState, match.id, question.id)
    }
  }

  for (const question of card.eventBonusQuestions) {
    eventBonusLocks[question.id] = isEventBonusLocked(game.lockState, question.id)
  }

  return {
    globalLocked: game.lockState.globalLocked,
    matchLocks,
    matchBonusLocks,
    eventBonusLocks,
    tiebreakerLocked: game.lockState.globalLocked,
  }
}

function mergeAnswerByLock(
  incoming: LivePlayerAnswer[],
  existing: LivePlayerAnswer[],
  isLocked: (questionId: string) => boolean,
): LivePlayerAnswer[] {
  const incomingByQuestion = new Map(incoming.map((answer) => [answer.questionId, answer]))
  const existingByQuestion = new Map(existing.map((answer) => [answer.questionId, answer]))
  const keys = new Set([...incomingByQuestion.keys(), ...existingByQuestion.keys()])

  const merged: LivePlayerAnswer[] = []

  for (const key of keys) {
    const incomingAnswer = incomingByQuestion.get(key)
    const existingAnswer = existingByQuestion.get(key)

    if (isLocked(key)) {
      if (existingAnswer) {
        merged.push(existingAnswer)
      }
      continue
    }

    if (incomingAnswer) {
      merged.push(incomingAnswer)
    }
  }

  return merged
}

function mergePicksWithLocks(
  card: ResolvedCard,
  lockState: LiveGameLockState,
  incoming: LivePlayerPicksPayload,
  existing: LivePlayerPicksPayload,
): { picks: LivePlayerPicksPayload; ignoredLocks: string[] } {
  const ignoredLocks: string[] = []

  const incomingByMatchId = new Map(incoming.matchPicks.map((pick) => [pick.matchId, pick]))
  const existingByMatchId = new Map(existing.matchPicks.map((pick) => [pick.matchId, pick]))

  const mergedMatchPicks: LivePlayerMatchPick[] = []

  for (const match of card.matches) {
    const incomingMatchPick = incomingByMatchId.get(match.id)
    const existingMatchPick = existingByMatchId.get(match.id) ?? {
      matchId: match.id,
      winnerName: '',
      battleRoyalEntrants: [],
      bonusAnswers: [],
    }

    if (!incomingMatchPick) {
      mergedMatchPicks.push(existingMatchPick)
      continue
    }

    if (isMatchLocked(lockState, match.id)) {
      if (
        incomingMatchPick.winnerName !== existingMatchPick.winnerName ||
        JSON.stringify(incomingMatchPick.battleRoyalEntrants) !== JSON.stringify(existingMatchPick.battleRoyalEntrants)
      ) {
        ignoredLocks.push(`match:${match.id}`)
      }

      for (const question of match.bonusQuestions) {
        const incomingAnswer = pickBonusAnswer(incomingMatchPick.bonusAnswers, question.id)
        const existingAnswer = pickBonusAnswer(existingMatchPick.bonusAnswers, question.id)
        if (incomingAnswer !== existingAnswer) {
          ignoredLocks.push(`match-bonus:${match.id}:${question.id}`)
        }
      }

      mergedMatchPicks.push(existingMatchPick)
      continue
    }

    const mergedBonusAnswers = mergeAnswerByLock(
      incomingMatchPick.bonusAnswers,
      existingMatchPick.bonusAnswers,
      (questionId) => {
        const locked = isMatchBonusLocked(lockState, match.id, questionId)
        if (locked && pickBonusAnswer(incomingMatchPick.bonusAnswers, questionId) !== pickBonusAnswer(existingMatchPick.bonusAnswers, questionId)) {
          ignoredLocks.push(`match-bonus:${match.id}:${questionId}`)
        }
        return locked
      },
    )

    mergedMatchPicks.push({
      matchId: match.id,
      winnerName: incomingMatchPick.winnerName,
      battleRoyalEntrants: incomingMatchPick.battleRoyalEntrants,
      bonusAnswers: mergedBonusAnswers,
    })
  }

  const mergedEventBonusAnswers = mergeAnswerByLock(
    incoming.eventBonusAnswers,
    existing.eventBonusAnswers,
    (questionId) => {
      const locked = isEventBonusLocked(lockState, questionId)
      if (locked && pickBonusAnswer(incoming.eventBonusAnswers, questionId) !== pickBonusAnswer(existing.eventBonusAnswers, questionId)) {
        ignoredLocks.push(`event-bonus:${questionId}`)
      }
      return locked
    },
  )

  let tiebreakerAnswer = incoming.tiebreakerAnswer
  if (lockState.globalLocked) {
    if (incoming.tiebreakerAnswer !== existing.tiebreakerAnswer) {
      ignoredLocks.push('tiebreaker')
    }
    tiebreakerAnswer = existing.tiebreakerAnswer
  }

  return {
    picks: {
      matchPicks: mergedMatchPicks,
      eventBonusAnswers: mergedEventBonusAnswers,
      tiebreakerAnswer,
    },
    ignoredLocks,
  }
}

export async function getLiveGameViewerAccess(
  gameId: string,
  options: {
    hostUserId?: string | null
    sessionTokenHash?: string | null
    joinCode?: string | null
  },
): Promise<LiveGameViewerAccess | null> {
  const gameRow = await db
    .selectFrom('live_games')
    .selectAll()
    .where('id', '=', gameId)
    .executeTakeFirst()

  if (!gameRow) return null

  const card = await getCardForGame(gameRow.card_id, gameRow.host_user_id)
  if (!card) return null
  const hydratedGameRow = await autoStartGameForCardEvent(gameRow, card)
  const game = mapLiveGame(hydratedGameRow)

  if (options.hostUserId && options.hostUserId === game.hostUserId) {
    return {
      game,
      card,
      player: null,
      isHost: true,
    }
  }

  if (options.joinCode && options.joinCode.trim().toUpperCase() === game.joinCode.trim().toUpperCase()) {
    return {
      game,
      card,
      player: null,
      isHost: false,
    }
  }

  if (options.sessionTokenHash) {
    const player = await findLiveGamePlayerBySession(game.id, options.sessionTokenHash)
    if (!player) return null

    const now = nowIso()
    await db
      .updateTable('live_game_players')
      .set({
        last_seen_at: now,
      })
      .where('id', '=', player.id)
      .execute()

    return {
      game,
      card,
      player: {
        ...player,
        lastSeenAt: now,
      },
      isHost: false,
    }
  }

  return null
}

export async function getLiveGameState(
  gameId: string,
  options: {
    hostUserId?: string | null
    sessionTokenHash?: string | null
    joinCode?: string | null
  },
): Promise<LiveGameComputedState | null> {
  const access = await getLiveGameViewerAccess(gameId, options)
  if (!access) return null

  const [playerRows, eventRows] = await Promise.all([
    db
      .selectFrom('live_game_players')
      .selectAll()
      .where('game_id', '=', gameId)
      .orderBy('joined_at', 'asc')
      .execute(),
    db
      .selectFrom('live_game_events')
      .selectAll()
      .where('game_id', '=', gameId)
      .orderBy('created_at', 'desc')
      .limit(30)
      .execute(),
  ])

  const players = playerRows.map((row) => mapLiveGamePlayer(row))
  const approvedPlayers = players.filter((player) => player.joinStatus === 'approved')
  const pendingPlayers = access.isHost
    ? players.filter((player) => player.joinStatus === 'pending')
    : []
  const leaderboard = computeLeaderboard(access.card, access.game.keyPayload, approvedPlayers)

  return {
    game: access.game,
    card: access.card,
    joinedPlayers: approvedPlayers.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      joinedAt: player.joinedAt,
      lastSeenAt: player.lastSeenAt,
      isSubmitted: player.isSubmitted,
      authMethod: player.authMethod,
      browserName: player.browserName,
      osName: player.osName,
      deviceType: player.deviceType,
      platform: player.platform,
      model: player.deviceModel,
    })),
    pendingJoinRequests: pendingPlayers.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      joinedAt: player.joinedAt,
      authMethod: player.authMethod,
      browserName: player.browserName,
      osName: player.osName,
      deviceType: player.deviceType,
      platform: player.platform,
      model: player.deviceModel,
      joinRequestIp: player.joinRequestIp,
      joinRequestCity: player.joinRequestCity,
      joinRequestCountry: player.joinRequestCountry,
      joinRequestDistanceKm: player.joinRequestDistanceKm,
    })),
    leaderboard,
    events: eventRows.map((row) => mapLiveGameEvent(row)),
    playerCount: approvedPlayers.length,
    submittedCount: approvedPlayers.filter((player) => player.isSubmitted).length,
  }
}

export async function reviewLiveGameJoinRequest(
  gameId: string,
  hostUserId: string,
  playerId: string,
  action: 'approve' | 'deny',
): Promise<'ok' | 'not-found'> {
  const game = await getHostLiveGame(gameId, hostUserId)
  if (!game) return 'not-found'

  const nextStatus = action === 'approve' ? 'approved' : 'rejected'
  const now = nowIso()

  const updated = await db
    .updateTable('live_game_players')
    .set({
      join_status: nextStatus,
      approved_at: action === 'approve' ? now : null,
      updated_at: now,
    })
    .where('id', '=', playerId)
    .where('game_id', '=', gameId)
    .where('join_status', '=', 'pending')
    .returningAll()
    .executeTakeFirst()

  if (!updated) return 'not-found'

  await insertLiveGameEvent(
    gameId,
    action === 'approve' ? 'player.approved' : 'player.denied',
    action === 'approve'
      ? `${updated.nickname} was approved to join`
      : `${updated.nickname} was denied entry`,
  )

  return 'ok'
}

export async function getLiveGameMe(
  gameId: string,
  sessionTokenHash: string,
): Promise<
  | {
    game: LiveGame
    card: ResolvedCard
    player: LiveGamePlayer
    locks: ReturnType<typeof buildEffectiveLockSnapshot>
  }
  | null
> {
  const access = await getLiveGameViewerAccess(gameId, {
    sessionTokenHash,
  })

  if (!access?.player) return null

  return {
    game: access.game,
    card: access.card,
    player: access.player,
    locks: buildEffectiveLockSnapshot(access.game, access.card),
  }
}

export async function upsertLiveGamePushSubscriptionForPlayer(
  gameId: string,
  sessionTokenHash: string,
  subscription: LiveGamePushSubscriptionInput,
): Promise<'ok' | 'unauthorized' | 'inactive'> {
  const access = await getLiveGameViewerAccess(gameId, {
    sessionTokenHash,
  })

  if (!access?.player) return 'unauthorized'
  if (access.game.status === 'ended') return 'inactive'
  if (new Date(access.game.expiresAt).getTime() <= Date.now()) return 'inactive'

  const now = nowIso()
  const playerId = access.player.id

  await db
    .insertInto('live_game_push_subscriptions')
    .values({
      id: randomUUID(),
      game_id: gameId,
      player_id: playerId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      expiration_time: subscription.expirationTime,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc
      .columns(['game_id', 'endpoint'])
      .doUpdateSet({
        player_id: playerId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expiration_time: subscription.expirationTime,
        updated_at: now,
      }))
    .execute()

  return 'ok'
}

export async function removeLiveGamePushSubscriptionForPlayer(
  gameId: string,
  sessionTokenHash: string,
  endpoint: string,
): Promise<boolean> {
  const access = await getLiveGameViewerAccess(gameId, {
    sessionTokenHash,
  })

  if (!access?.player) return false

  await db
    .deleteFrom('live_game_push_subscriptions')
    .where('game_id', '=', gameId)
    .where('endpoint', '=', endpoint)
    .execute()

  return true
}

export async function saveLiveGamePlayerPicks(
  gameId: string,
  sessionTokenHash: string,
  incoming: LivePlayerPicksPayload,
  expectedUpdatedAt?: string,
): Promise<{ player: LiveGamePlayer; ignoredLocks: string[] } | 'conflict' | null> {
  const access = await getLiveGameViewerAccess(gameId, {
    sessionTokenHash,
  })

  if (!access?.player) return null
  if (expectedUpdatedAt && access.player.updatedAt !== expectedUpdatedAt) {
    return 'conflict'
  }

  const merged = mergePicksWithLocks(
    access.card,
    access.game.lockState,
    normalizeLivePlayerPicks(incoming),
    access.player.picks,
  )

  const now = nowIso()

  await db
    .updateTable('live_game_players')
    .set({
      picks_json: JSON.stringify(merged.picks),
      last_seen_at: now,
      updated_at: now,
    })
    .where('id', '=', access.player.id)
    .execute()

  const row = await db
    .selectFrom('live_game_players')
    .selectAll()
    .where('id', '=', access.player.id)
    .executeTakeFirstOrThrow()

  return {
    player: mapLiveGamePlayer(row),
    ignoredLocks: merged.ignoredLocks,
  }
}

export async function submitLiveGamePlayer(
  gameId: string,
  sessionTokenHash: string,
): Promise<LiveGamePlayer | null> {
  const access = await getLiveGameViewerAccess(gameId, {
    sessionTokenHash,
  })

  if (!access?.player) return null

  const now = nowIso()

  await db
    .updateTable('live_game_players')
    .set({
      is_submitted: 1,
      submitted_at: now,
      last_seen_at: now,
      updated_at: now,
    })
    .where('id', '=', access.player.id)
    .execute()

  await insertLiveGameEvent(gameId, 'player.submitted', `${access.player.nickname} submitted picks`)

  const updated = await db
    .selectFrom('live_game_players')
    .selectAll()
    .where('id', '=', access.player.id)
    .executeTakeFirstOrThrow()

  return mapLiveGamePlayer(updated)
}
