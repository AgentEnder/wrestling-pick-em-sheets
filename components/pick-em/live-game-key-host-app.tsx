"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { updateCardOverrides } from '@/lib/client/cards-api'
import {
  getLiveGameKey,
  getLiveGameState,
  reviewLiveGameJoinRequest,
  saveLiveGameKey,
  updateLiveGameLocks,
  updateLiveGameStatus,
  type LiveGameStateResponse,
} from '@/lib/client/live-games-api'
import { getConnectionStatus } from '@/lib/client/connection-status'
import { computeFuzzyConfidence } from '@/lib/fuzzy-match'
import { getRosterSuggestions } from '@/lib/client/roster-api'
import type {
  LiveGame,
  LiveGameKeyPayload,
  LiveGameLockState,
  LiveKeyAnswer,
  LiveKeyMatchResult,
  LiveKeyTimer,
  ScoreOverride,
  WinnerOverride,
} from '@/lib/types'
import { Pause, Play, Plus, RefreshCcw, RotateCcw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface LiveGameKeyHostAppProps {
  gameId: string
  joinCodeFromUrl?: string | null
}

const POLL_INTERVAL_MS = 10_000
const REFRESH_STALE_THRESHOLD_MS = POLL_INTERVAL_MS * 5
const FUZZY_AUTO_THRESHOLD = 0.90
const FUZZY_REVIEW_THRESHOLD = 0.60

interface FuzzyCandidate {
  playerNickname: string
  normalizedNickname: string
  playerAnswer: string
  confidence: number
  isAutoAccepted: boolean
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function nowIso(): string {
  return new Date().toISOString()
}

function nowMs(): number {
  return Date.now()
}

function isoToDatetimeLocalInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const tzOffsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16)
}

function datetimeLocalInputToIso(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function getTimerElapsedMs(timer: LiveKeyTimer, referenceNowMs: number): number {
  if (!timer.isRunning || !timer.startedAt) {
    return timer.elapsedMs
  }

  const startedAtMs = new Date(timer.startedAt).getTime()
  if (!Number.isFinite(startedAtMs)) {
    return timer.elapsedMs
  }

  return Math.max(0, timer.elapsedMs + (referenceNowMs - startedAtMs))
}

function ensureMatchTimer(payload: LiveGameKeyPayload, matchId: string, label: string): LiveGameKeyPayload {
  const timerId = `match:${matchId}`
  const found = payload.timers.find((timer) => timer.id === timerId)

  if (found) {
    return {
      ...payload,
      timers: payload.timers.map((timer) => (
        timer.id === timerId
          ? { ...timer, label }
          : timer
      )),
    }
  }

  return {
    ...payload,
    timers: [
      ...payload.timers,
      {
        id: timerId,
        label,
        elapsedMs: 0,
        isRunning: false,
        startedAt: null,
      },
    ],
  }
}

function ensureAllMatchTimers(payload: LiveGameKeyPayload, matches: Array<{ id: string; title: string }>): LiveGameKeyPayload {
  return matches.reduce(
    (acc, match, index) => ensureMatchTimer(acc, match.id, `Match ${index + 1}: ${match.title || 'Untitled'}`),
    payload,
  )
}

function findMatchResult(payload: LiveGameKeyPayload, matchId: string): LiveKeyMatchResult | null {
  return payload.matchResults.find((result) => result.matchId === matchId) ?? null
}

function findAnswer(answers: LiveKeyAnswer[], questionId: string): LiveKeyAnswer | null {
  return answers.find((answer) => answer.questionId === questionId) ?? null
}

function toLockKey(matchId: string, questionId: string): string {
  return `${matchId}:${questionId}`
}

function filterRosterMemberSuggestions(input: string, candidates: string[]): string[] {
  const normalizedInput = input.trim().toLowerCase()
  if (!normalizedInput) return []

  const deduped: string[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue

    const normalizedCandidate = trimmed.toLowerCase()
    if (!normalizedCandidate.includes(normalizedInput)) continue
    if (seen.has(normalizedCandidate)) continue

    seen.add(normalizedCandidate)
    deduped.push(trimmed)

    if (deduped.length >= 8) {
      break
    }
  }

  return deduped
}

function snapshotPayload(payload: LiveGameKeyPayload): string {
  return JSON.stringify(payload)
}

function FuzzyReviewPanel({
  candidates,
  onAccept,
  onReject,
}: {
  candidates: FuzzyCandidate[]
  onAccept: (normalizedNickname: string) => void
  onReject: (normalizedNickname: string) => void
}) {
  if (candidates.length === 0) return null

  return (
    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 space-y-1.5">
      <p className="text-xs font-medium text-amber-600">Fuzzy Matches</p>
      {candidates.map((c) => (
        <div key={c.normalizedNickname} className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate">
            <span className="font-medium">{c.playerNickname}</span>
            {' answered '}
            <span className="italic">&ldquo;{c.playerAnswer}&rdquo;</span>
            {' \u2014 '}
            <span className="font-mono">{Math.round(c.confidence * 100)}%</span>
            {c.isAutoAccepted ? <span className="ml-1 text-emerald-600">(auto)</span> : null}
          </span>
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onAccept(c.normalizedNickname)}
              className="rounded bg-emerald-600 px-2 py-0.5 text-white hover:bg-emerald-700"
            >
              &#10003;
            </button>
            <button
              type="button"
              onClick={() => onReject(c.normalizedNickname)}
              className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700"
            >
              &#10007;
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function computeFuzzyCandidatesForAnswer(
  keyAnswer: string,
  playerAnswers: Array<{ nickname: string; normalizedNickname: string; answer: string }>,
  existingOverrides: Array<{ playerNickname: string; accepted: boolean }>,
): FuzzyCandidate[] {
  if (!keyAnswer.trim()) return []

  const candidates: FuzzyCandidate[] = []

  for (const pa of playerAnswers) {
    if (!pa.answer.trim()) continue

    // Skip if exact match (already scored correctly)
    const normKey = normalizeText(keyAnswer)
    const normPlayer = normalizeText(pa.answer)
    if (normKey === normPlayer) continue

    // Skip if already has an override
    const hasOverride = existingOverrides.some(
      (o) => normalizeText(o.playerNickname) === pa.normalizedNickname
    )
    if (hasOverride) continue

    const confidence = computeFuzzyConfidence(pa.answer, keyAnswer)
    if (confidence >= FUZZY_REVIEW_THRESHOLD) {
      candidates.push({
        playerNickname: pa.nickname,
        normalizedNickname: pa.normalizedNickname,
        playerAnswer: pa.answer,
        confidence,
        isAutoAccepted: confidence >= FUZZY_AUTO_THRESHOLD,
      })
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence)
}

export function LiveGameKeyHostApp({ gameId, joinCodeFromUrl }: LiveGameKeyHostAppProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isEndingGame, setIsEndingGame] = useState(false)
  const [isStatusSaving, setIsStatusSaving] = useState(false)
  const [isLockSaving, setIsLockSaving] = useState(false)
  const [activeJoinReviewPlayerId, setActiveJoinReviewPlayerId] = useState<string | null>(null)
  const [payload, setPayload] = useState<LiveGameKeyPayload | null>(null)
  const [game, setGame] = useState<LiveGame | null>(null)
  const [card, setCard] = useState<LiveGameStateResponse['card'] | null>(null)
  const [lockState, setLockState] = useState<LiveGameLockState | null>(null)
  const [state, setState] = useState<LiveGameStateResponse | null>(null)
  const [clockMs, setClockMs] = useState(nowMs())
  const [isDirty, setIsDirty] = useState(false)
  const [querySuggestions, setQuerySuggestions] = useState<string[]>([])
  const [isLoadingQuerySuggestions, setIsLoadingQuerySuggestions] = useState(false)
  const [activeRosterFieldKey, setActiveRosterFieldKey] = useState<string | null>(null)
  const [activeRosterQuery, setActiveRosterQuery] = useState('')
  const [battleRoyalEntryInputByMatchId, setBattleRoyalEntryInputByMatchId] = useState<Record<string, string>>({})
  const [eventStartInput, setEventStartInput] = useState('')
  const [lastRefreshAtMs, setLastRefreshAtMs] = useState<number | null>(null)
  const [nowTickMs, setNowTickMs] = useState(nowMs())

  const hasInitializedRef = useRef(false)
  const payloadRef = useRef<LiveGameKeyPayload | null>(null)
  const lastSyncedSnapshotRef = useRef<string | null>(null)
  const isSyncingRef = useRef(false)
  const pendingAutoSyncRef = useRef(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [keyResponse, stateResponse] = await Promise.all([
        getLiveGameKey(gameId),
        getLiveGameState(gameId, joinCodeFromUrl ?? undefined),
      ])
      const nextPayload = ensureAllMatchTimers(keyResponse.key, keyResponse.card.matches)
      setGame(keyResponse.game)
      setCard(keyResponse.card)
      setPayload(nextPayload)
      setLockState(keyResponse.locks)
      setState(stateResponse)
      setLastRefreshAtMs(nowMs())
      payloadRef.current = nextPayload
      lastSyncedSnapshotRef.current = snapshotPayload(nextPayload)
      hasInitializedRef.current = true
      setIsDirty(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load game key'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [gameId, joinCodeFromUrl])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockMs(nowMs())
    }, 300)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTickMs(nowMs())
    }, 1_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void getLiveGameState(gameId, joinCodeFromUrl ?? undefined)
        .then((response) => {
          setState(response)
          setLastRefreshAtMs(nowMs())
          setGame((current) => (
            current
              ? {
                ...current,
                status: response.game.status,
                allowLateJoins: response.game.allowLateJoins,
                updatedAt: response.game.updatedAt,
              }
              : current
          ))
        })
        .catch(() => {
          // keep existing state if poll fails
        })
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [gameId, joinCodeFromUrl])

  useEffect(() => {
    payloadRef.current = payload
  }, [payload])

  useEffect(() => {
    setEventStartInput(isoToDatetimeLocalInput(card?.eventDate ?? null))
  }, [card?.eventDate])

  useEffect(() => {
    const promotionName = card?.promotionName?.trim() ?? ''
    const query = activeRosterQuery.trim()
    if (!promotionName || query.length < 2) {
      setQuerySuggestions([])
      setIsLoadingQuerySuggestions(false)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      setIsLoadingQuerySuggestions(true)
      void getRosterSuggestions(promotionName, query)
        .then((response) => {
          if (cancelled) return
          setQuerySuggestions(response.names)
        })
        .catch(() => {
          if (cancelled) return
          setQuerySuggestions([])
        })
        .finally(() => {
          if (cancelled) return
          setIsLoadingQuerySuggestions(false)
        })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [activeRosterQuery, card?.promotionName])

  function setActiveRosterInput(fieldKey: string, value: string) {
    setActiveRosterFieldKey(fieldKey)
    setActiveRosterQuery(value)
  }

  useEffect(() => {
    if (!hasInitializedRef.current || !payload || !lastSyncedSnapshotRef.current) return
    setIsDirty(snapshotPayload(payload) !== lastSyncedSnapshotRef.current)
  }, [payload])

  const timerById = useMemo(
    () => new Map((payload?.timers ?? []).map((timer) => [timer.id, timer])),
    [payload?.timers],
  )
  const eventParticipantCandidates = useMemo(
    () => Array.from(new Set((card?.matches ?? []).flatMap((match) => match.participants))),
    [card?.matches],
  )

  function setMatchWinner(matchId: string, winnerName: string) {
    if (!payload) return

    setPayload((prev) => {
      if (!prev) return prev
      const nextResults = [...prev.matchResults]
      const index = nextResults.findIndex((result) => result.matchId === matchId)

      const nextResult: LiveKeyMatchResult = {
        matchId,
        winnerName,
        winnerRecordedAt: winnerName.trim() ? nowIso() : null,
        battleRoyalEntryOrder: index === -1 ? [] : nextResults[index].battleRoyalEntryOrder,
        bonusAnswers: index === -1 ? [] : nextResults[index].bonusAnswers,
      }

      if (index === -1) {
        nextResults.push(nextResult)
      } else {
        nextResults[index] = {
          ...nextResults[index],
          winnerName: nextResult.winnerName,
          winnerRecordedAt: nextResult.winnerRecordedAt,
        }
      }

      return {
        ...prev,
        matchResults: nextResults,
      }
    })
  }

  function addBattleRoyalEntrant(matchId: string, entrantName: string) {
    const entrant = entrantName.trim()
    if (!entrant) return

    setPayload((prev) => {
      if (!prev) return prev

      const nextResults = [...prev.matchResults]
      let index = nextResults.findIndex((result) => result.matchId === matchId)

      if (index === -1) {
        nextResults.push({
          matchId,
          winnerName: '',
          winnerRecordedAt: null,
          battleRoyalEntryOrder: [],
          bonusAnswers: [],
        })
        index = nextResults.length - 1
      }

      const existingEntries = nextResults[index].battleRoyalEntryOrder
      const hasDuplicate = existingEntries.some((entry) => entry.toLowerCase() === entrant.toLowerCase())
      if (hasDuplicate) {
        return prev
      }

      nextResults[index] = {
        ...nextResults[index],
        battleRoyalEntryOrder: [...existingEntries, entrant],
      }

      return {
        ...prev,
        matchResults: nextResults,
      }
    })

    setBattleRoyalEntryInputByMatchId((prev) => ({ ...prev, [matchId]: '' }))
    setActiveRosterFieldKey(`battleRoyal:${matchId}`)
    setActiveRosterQuery('')
  }

  function removeBattleRoyalEntrant(matchId: string, entrantIndex: number) {
    setPayload((prev) => {
      if (!prev) return prev
      const nextResults = [...prev.matchResults]
      const index = nextResults.findIndex((result) => result.matchId === matchId)
      if (index === -1) return prev

      nextResults[index] = {
        ...nextResults[index],
        battleRoyalEntryOrder: nextResults[index].battleRoyalEntryOrder.filter((_, i) => i !== entrantIndex),
      }

      return {
        ...prev,
        matchResults: nextResults,
      }
    })
  }

  function setMatchBonusAnswer(matchId: string, questionId: string, answer: string) {
    setPayload((prev) => {
      if (!prev) return prev

      const nextResults = [...prev.matchResults]
      let resultIndex = nextResults.findIndex((result) => result.matchId === matchId)
      if (resultIndex === -1) {
        nextResults.push({
          matchId,
          winnerName: '',
          winnerRecordedAt: null,
          battleRoyalEntryOrder: [],
          bonusAnswers: [],
        })
        resultIndex = nextResults.length - 1
      }

      const currentResult = nextResults[resultIndex]
      const nextAnswers = [...currentResult.bonusAnswers]
      const answerIndex = nextAnswers.findIndex((item) => item.questionId === questionId)

      const nextAnswer: LiveKeyAnswer = {
        questionId,
        answer,
        recordedAt: answer.trim() ? nowIso() : null,
        timerId: null,
      }

      if (answerIndex === -1) {
        nextAnswers.push(nextAnswer)
      } else {
        nextAnswers[answerIndex] = {
          ...nextAnswers[answerIndex],
          answer,
          recordedAt: nextAnswer.recordedAt,
        }
      }

      nextResults[resultIndex] = {
        ...currentResult,
        bonusAnswers: nextAnswers,
      }

      return {
        ...prev,
        matchResults: nextResults,
      }
    })
  }

  function setEventBonusAnswer(questionId: string, answer: string) {
    setPayload((prev) => {
      if (!prev) return prev

      const nextAnswers = [...prev.eventBonusAnswers]
      const index = nextAnswers.findIndex((item) => item.questionId === questionId)
      const nextAnswer: LiveKeyAnswer = {
        questionId,
        answer,
        recordedAt: answer.trim() ? nowIso() : null,
        timerId: null,
      }

      if (index === -1) {
        nextAnswers.push(nextAnswer)
      } else {
        nextAnswers[index] = {
          ...nextAnswers[index],
          answer,
          recordedAt: nextAnswer.recordedAt,
        }
      }

      return {
        ...prev,
        eventBonusAnswers: nextAnswers,
      }
    })
  }

  function handleAcceptOverride(
    type: 'score' | 'winner',
    questionOrMatchId: string,
    normalizedNickname: string,
    confidence: number,
  ) {
    setPayload((prev) => {
      if (!prev) return prev

      if (type === 'score') {
        return {
          ...prev,
          scoreOverrides: [
            ...prev.scoreOverrides.filter(
              (o) => !(o.questionId === questionOrMatchId && normalizeText(o.playerNickname) === normalizedNickname)
            ),
            {
              questionId: questionOrMatchId,
              playerNickname: normalizedNickname,
              accepted: true,
              source: 'host' as const,
              confidence,
            },
          ],
        }
      }

      return {
        ...prev,
        winnerOverrides: [
          ...prev.winnerOverrides.filter(
            (o) => !(o.matchId === questionOrMatchId && normalizeText(o.playerNickname) === normalizedNickname)
          ),
          {
            matchId: questionOrMatchId,
            playerNickname: normalizedNickname,
            accepted: true,
            source: 'host' as const,
            confidence,
          },
        ],
      }
    })
  }

  function handleRejectOverride(
    type: 'score' | 'winner',
    questionOrMatchId: string,
    normalizedNickname: string,
  ) {
    setPayload((prev) => {
      if (!prev) return prev

      if (type === 'score') {
        return {
          ...prev,
          scoreOverrides: [
            ...prev.scoreOverrides.filter(
              (o) => !(o.questionId === questionOrMatchId && normalizeText(o.playerNickname) === normalizedNickname)
            ),
            {
              questionId: questionOrMatchId,
              playerNickname: normalizedNickname,
              accepted: false,
              source: 'host' as const,
              confidence: 0,
            },
          ],
        }
      }

      return {
        ...prev,
        winnerOverrides: [
          ...prev.winnerOverrides.filter(
            (o) => !(o.matchId === questionOrMatchId && normalizeText(o.playerNickname) === normalizedNickname)
          ),
          {
            matchId: questionOrMatchId,
            playerNickname: normalizedNickname,
            accepted: false,
            source: 'host' as const,
            confidence: 0,
          },
        ],
      }
    })
  }

  function setTiebreakerAnswer(answer: string) {
    setPayload((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        tiebreakerAnswer: answer,
        tiebreakerRecordedAt: answer.trim() ? nowIso() : null,
      }
    })
  }

  function updateTimer(timerId: string, updater: (timer: LiveKeyTimer) => LiveKeyTimer) {
    setPayload((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        timers: prev.timers.map((timer) => (timer.id === timerId ? updater(timer) : timer)),
      }
    })
  }

  function startTimer(timerId: string) {
    updateTimer(timerId, (timer) => {
      if (timer.isRunning) return timer
      return {
        ...timer,
        isRunning: true,
        startedAt: nowIso(),
      }
    })
  }

  function stopTimer(timerId: string) {
    updateTimer(timerId, (timer) => {
      if (!timer.isRunning) return timer
      return {
        ...timer,
        isRunning: false,
        elapsedMs: getTimerElapsedMs(timer, nowMs()),
        startedAt: null,
      }
    })
  }

  function resetTimer(timerId: string) {
    updateTimer(timerId, (timer) => ({
      ...timer,
      isRunning: false,
      elapsedMs: 0,
      startedAt: null,
    }))
  }

  const syncPayload = useCallback(async (mode: 'manual' | 'auto') => {
    const currentPayload = payloadRef.current
    if (!currentPayload) return false

    if (mode === 'auto' && isSyncingRef.current) {
      pendingAutoSyncRef.current = true
      return false
    }

    if (mode === 'manual') {
      setIsSaving(true)
    }

    const payloadSnapshot = snapshotPayload(currentPayload)
    isSyncingRef.current = true

    try {
      const saved = await saveLiveGameKey(gameId, currentPayload, {
        expectedUpdatedAt: game?.updatedAt,
      })
      setGame(saved)
      setLockState(saved.lockState)
      lastSyncedSnapshotRef.current = payloadSnapshot

      if (payloadRef.current && snapshotPayload(payloadRef.current) === payloadSnapshot) {
        setIsDirty(false)
      }

      void getLiveGameState(gameId, joinCodeFromUrl ?? undefined)
        .then((response) => {
          setState(response)
        })
        .catch(() => {
          // keep previous state on refresh failure
        })

      if (mode === 'manual') {
        toast.success('Room key saved')
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save room key'
      if (message.includes('changed in another session')) {
        await load()
      }
      if (mode === 'manual') {
        toast.error(message)
      }
      return false
    } finally {
      isSyncingRef.current = false
      if (mode === 'manual') {
        setIsSaving(false)
      }
      if (pendingAutoSyncRef.current) {
        pendingAutoSyncRef.current = false
        void syncPayload('auto')
      }
    }
  }, [game?.updatedAt, gameId, joinCodeFromUrl, load])

  async function handleSaveKey() {
    await syncPayload('manual')
  }

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      await load()
    } finally {
      setIsRefreshing(false)
    }
  }

  const isRefreshStale = lastRefreshAtMs !== null && (nowTickMs - lastRefreshAtMs) > REFRESH_STALE_THRESHOLD_MS

  useEffect(() => {
    if (!hasInitializedRef.current || !isDirty) return

    const timeoutId = window.setTimeout(() => {
      void syncPayload('auto')
    }, 700)

    return () => window.clearTimeout(timeoutId)
  }, [isDirty, payload, syncPayload])

  async function handleEndGame() {
    setIsEndingGame(true)
    try {
      const updated = await updateLiveGameStatus(gameId, 'ended')
      setGame(updated)
      toast.success('Game ended')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update status'
      toast.error(message)
    } finally {
      setIsEndingGame(false)
    }
  }

  async function handleStartGame() {
    if (!game) return

    setIsStatusSaving(true)
    try {
      const updated = await updateLiveGameStatus(gameId, 'live', {
        allowLateJoins: game.allowLateJoins,
      })
      setGame(updated)
      toast.success('Game started')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start game'
      toast.error(message)
    } finally {
      setIsStatusSaving(false)
    }
  }

  async function handleAllowLateJoinsChange(allowLateJoins: boolean) {
    if (!game || game.status === 'ended') return

    setIsStatusSaving(true)
    try {
      const updated = await updateLiveGameStatus(gameId, game.status, {
        allowLateJoins,
      })
      setGame(updated)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update entry settings'
      toast.error(message)
    } finally {
      setIsStatusSaving(false)
    }
  }

  async function handleReviewJoinRequest(playerId: string, action: 'approve' | 'deny') {
    setActiveJoinReviewPlayerId(playerId)
    try {
      await reviewLiveGameJoinRequest(gameId, playerId, action)
      const refreshed = await getLiveGameState(gameId, joinCodeFromUrl ?? undefined)
      setState(refreshed)
      toast.success(action === 'approve' ? 'Player approved' : 'Player denied')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update join request'
      toast.error(message)
    } finally {
      setActiveJoinReviewPlayerId(null)
    }
  }

  async function handleSaveEventStartTime(forceEventStartAt?: string | null) {
    if (!game || game.status === 'ended') return

    const eventStartAt = typeof forceEventStartAt === 'undefined'
      ? datetimeLocalInputToIso(eventStartInput)
      : forceEventStartAt
    if (typeof forceEventStartAt === 'undefined' && eventStartInput.trim() && !eventStartAt) {
      toast.error('Invalid start date/time')
      return
    }

    setIsStatusSaving(true)
    try {
      await updateCardOverrides(game.cardId, {
        eventDate: eventStartAt,
      })
      setCard((current) => (current
        ? {
          ...current,
          eventDate: eventStartAt ?? '',
        }
        : current))
      toast.success(eventStartAt ? 'Start time saved' : 'Start time cleared')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update start time'
      toast.error(message)
    } finally {
      setIsStatusSaving(false)
    }
  }

  async function saveLocks(next: LiveGameLockState) {
    setIsLockSaving(true)
    try {
      const updated = await updateLiveGameLocks(gameId, next)
      setLockState(updated.lockState)
      setGame(updated)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update locks'
      toast.error(message)
    } finally {
      setIsLockSaving(false)
    }
  }

  function toggleGlobalLock() {
    if (!lockState) return
    const next = {
      ...lockState,
      globalLocked: !lockState.globalLocked,
    }
    void saveLocks(next)
  }

  function toggleMatchLock(matchId: string) {
    if (!lockState) return
    const existing = lockState.matchLocks[matchId]
    const next = {
      ...lockState,
      matchLocks: {
        ...lockState.matchLocks,
        [matchId]: {
          locked: !(existing?.locked === true),
          source: 'host' as const,
        },
      },
    }
    void saveLocks(next)
  }

  function toggleMatchBonusLock(matchId: string, questionId: string) {
    if (!lockState) return
    const key = toLockKey(matchId, questionId)
    const existing = lockState.matchBonusLocks[key]
    const next = {
      ...lockState,
      matchBonusLocks: {
        ...lockState.matchBonusLocks,
        [key]: {
          locked: !(existing?.locked === true),
          source: 'host' as const,
        },
      },
    }
    void saveLocks(next)
  }

  function toggleEventBonusLock(questionId: string) {
    if (!lockState) return
    const existing = lockState.eventBonusLocks[questionId]
    const next = {
      ...lockState,
      eventBonusLocks: {
        ...lockState.eventBonusLocks,
        [questionId]: {
          locked: !(existing?.locked === true),
          source: 'host' as const,
        },
      },
    }
    void saveLocks(next)
  }

  // Auto-accept high-confidence fuzzy matches
  useEffect(() => {
    if (!state?.playerAnswerSummaries?.length || !payload) return

    // Check all match bonus questions
    for (const match of card?.matches ?? []) {
      const matchResult = payload.matchResults.find((r) => r.matchId === match.id)
      if (!matchResult) continue

      // Winner auto-accept
      if (matchResult.winnerName.trim()) {
        const playerWinners = (state.playerAnswerSummaries ?? []).map((p) => ({
          nickname: p.nickname,
          normalizedNickname: p.normalizedNickname,
          answer: p.matchPicks.find((mp) => mp.matchId === match.id)?.winnerName ?? '',
        }))
        for (const pa of playerWinners) {
          if (!pa.answer.trim()) continue
          if (normalizeText(pa.answer) === normalizeText(matchResult.winnerName)) continue
          const existingOverride = payload.winnerOverrides.some(
            (o) => o.matchId === match.id && normalizeText(o.playerNickname) === pa.normalizedNickname
          )
          if (existingOverride) continue
          const confidence = computeFuzzyConfidence(pa.answer, matchResult.winnerName)
          if (confidence >= FUZZY_AUTO_THRESHOLD) {
            handleAcceptOverride('winner', match.id, pa.normalizedNickname, confidence)
          }
        }
      }

      // Bonus question auto-accept
      for (const question of match.bonusQuestions) {
        if (question.answerType !== 'write-in' || (question.valueType !== 'string' && question.valueType !== 'rosterMember')) continue
        const keyAnswer = matchResult.bonusAnswers.find((a) => a.questionId === question.id)?.answer ?? ''
        if (!keyAnswer.trim()) continue

        const playerAnswers = (state.playerAnswerSummaries ?? []).map((p) => ({
          nickname: p.nickname,
          normalizedNickname: p.normalizedNickname,
          answer: p.matchPicks.find((mp) => mp.matchId === match.id)
            ?.bonusAnswers.find((ba) => ba.questionId === question.id)?.answer ?? '',
        }))
        for (const pa of playerAnswers) {
          if (!pa.answer.trim()) continue
          if (normalizeText(pa.answer) === normalizeText(keyAnswer)) continue
          const existingOverride = payload.scoreOverrides.some(
            (o) => o.questionId === question.id && normalizeText(o.playerNickname) === pa.normalizedNickname
          )
          if (existingOverride) continue
          const confidence = computeFuzzyConfidence(pa.answer, keyAnswer)
          if (confidence >= FUZZY_AUTO_THRESHOLD) {
            handleAcceptOverride('score', question.id, pa.normalizedNickname, confidence)
          }
        }
      }
    }

    // Event bonus auto-accept
    for (const question of card?.eventBonusQuestions ?? []) {
      if (question.answerType !== 'write-in' || (question.valueType !== 'string' && question.valueType !== 'rosterMember')) continue
      const keyAnswer = payload.eventBonusAnswers.find((a) => a.questionId === question.id)?.answer ?? ''
      if (!keyAnswer.trim()) continue

      const playerAnswers = (state.playerAnswerSummaries ?? []).map((p) => ({
        nickname: p.nickname,
        normalizedNickname: p.normalizedNickname,
        answer: p.eventBonusAnswers.find((ba) => ba.questionId === question.id)?.answer ?? '',
      }))
      for (const pa of playerAnswers) {
        if (!pa.answer.trim()) continue
        if (normalizeText(pa.answer) === normalizeText(keyAnswer)) continue
        const existingOverride = payload.scoreOverrides.some(
          (o) => o.questionId === question.id && normalizeText(o.playerNickname) === pa.normalizedNickname
        )
        if (existingOverride) continue
        const confidence = computeFuzzyConfidence(pa.answer, keyAnswer)
        if (confidence >= FUZZY_AUTO_THRESHOLD) {
          handleAcceptOverride('score', question.id, pa.normalizedNickname, confidence)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.playerAnswerSummaries, payload?.matchResults, payload?.eventBonusAnswers, payload?.scoreOverrides, payload?.winnerOverrides])

  if (isLoading || !payload || !game || !card || !lockState) {
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 text-sm text-muted-foreground">
        Loading game host tools...
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <header className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Host Keying Console</h1>
            <p className="text-sm text-muted-foreground">
              Join code <span className="font-mono">{game.joinCode}</span> • {card.eventName || 'Untitled Event'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Status: <span className="capitalize text-foreground">{game.status}</span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {isDirty ? 'Unsynced key changes (auto-saving)...' : 'All key changes synced.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(() => {
                const secretSuffix = game.qrJoinSecret ? `&s=${encodeURIComponent(game.qrJoinSecret)}` : ''
                const displayUrl = `/games/${game.id}/display?code=${encodeURIComponent(game.joinCode)}${secretSuffix}`
                const joinUrl = `/join?code=${encodeURIComponent(game.joinCode)}${secretSuffix}`
                return (
                  <>
                    <Button asChild size="sm" variant="outline">
                      <Link href={displayUrl}>Open Display</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={joinUrl}>Open Join</Link>
                    </Button>
                  </>
                )
              })()}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button onClick={() => void handleSaveKey()} disabled={isSaving}>
              <Save className="mr-1 h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Key'}
            </Button>
            {game.status === 'lobby' ? (
              <Button onClick={() => void handleStartGame()} disabled={isStatusSaving}>
                {isStatusSaving ? 'Starting...' : 'Start Game'}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={game.status === 'ended' || isEndingGame || isStatusSaving}
              onClick={() => void handleEndGame()}
            >
              {game.status === 'ended' ? 'Ended' : isEndingGame ? 'Ending...' : 'End Game'}
            </Button>
          </div>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-medium">Mid-Game Entries</p>
            <p className="text-xs text-muted-foreground">
              Allow new players to join after the game has started.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{game.allowLateJoins ? 'Allowed' : 'Closed'}</span>
            <Switch
              checked={game.allowLateJoins}
              onCheckedChange={(checked) => {
                void handleAllowLateJoinsChange(checked)
              }}
              disabled={game.status === 'ended' || isStatusSaving}
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-medium">Join Lobby</p>
            <p className="text-xs text-muted-foreground">
              Guests outside your network/proximity wait here for host approval.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Pending: {state?.pendingJoinRequests.length ?? 0}
          </p>
        </div>

        {state?.pendingJoinRequests.length ? (
          <div className="mt-3 space-y-2">
            {state.pendingJoinRequests.map((request) => (
              <div
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background/40 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{request.nickname}</p>
                  <p className="text-xs text-muted-foreground">
                    {request.joinRequestCity || 'Unknown city'}
                    {request.joinRequestCountry ? `, ${request.joinRequestCountry}` : ''}
                    {typeof request.joinRequestDistanceKm === 'number' ? ` • ${request.joinRequestDistanceKm.toFixed(1)}km` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={activeJoinReviewPlayerId === request.id}
                    onClick={() => void handleReviewJoinRequest(request.id, 'deny')}
                  >
                    Deny
                  </Button>
                  <Button
                    size="sm"
                    disabled={activeJoinReviewPlayerId === request.id}
                    onClick={() => void handleReviewJoinRequest(request.id, 'approve')}
                  >
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No pending join requests.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="space-y-3">
          <div>
            <p className="font-medium">Scheduled Start</p>
            <p className="text-xs text-muted-foreground">
              Room auto-starts when this time is reached.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Input
              type="datetime-local"
              value={eventStartInput}
              onChange={(event) => setEventStartInput(event.target.value)}
              disabled={game.status === 'ended' || isStatusSaving}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEventStartInput('')
                void handleSaveEventStartTime(null)
              }}
              disabled={game.status === 'ended' || isStatusSaving}
            >
              Clear
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveEventStartTime()}
              disabled={game.status === 'ended' || isStatusSaving}
            >
              {isStatusSaving ? 'Saving...' : 'Save Start'}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Locks</p>
          <Button size="sm" variant={lockState.globalLocked ? 'default' : 'outline'} onClick={toggleGlobalLock} disabled={isLockSaving}>
            {lockState.globalLocked ? 'Unlock All' : 'Lock All'}
          </Button>
        </div>
      </section>

      {card.matches.map((match, index) => {
        const matchResult = findMatchResult(payload, match.id)
        const timerId = `match:${match.id}`
        const timer = timerById.get(timerId)
        const timerElapsed = timer ? formatDuration(getTimerElapsedMs(timer, clockMs)) : '--:--'
        const battleRoyalEntryOrder = matchResult?.battleRoyalEntryOrder ?? []
        const battleRoyalEntryInput = battleRoyalEntryInputByMatchId[match.id] ?? ''
        const battleRoyalFieldKey = `battleRoyal:${match.id}`
        const normalizedBattleRoyalEntryInput = battleRoyalEntryInput.trim().toLowerCase()
        const battleRoyalSuggestions = activeRosterFieldKey === battleRoyalFieldKey ? querySuggestions : []
        const battleRoyalCandidates = match.isBattleRoyal
          ? Array.from(new Set([...match.participants, ...battleRoyalSuggestions]))
          : []
        const filteredBattleRoyalSuggestions = normalizedBattleRoyalEntryInput
          ? battleRoyalCandidates
            .filter((candidate) => candidate.toLowerCase().includes(normalizedBattleRoyalEntryInput))
            .filter((candidate) => !battleRoyalEntryOrder.some((entry) => entry.toLowerCase() === candidate.toLowerCase()))
            .slice(0, 8)
          : []

        return (
          <section key={match.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Match {index + 1}: {match.title || 'Untitled Match'}</h2>
              <Button
                size="sm"
                variant={lockState.matchLocks[match.id]?.locked ? 'default' : 'outline'}
                onClick={() => toggleMatchLock(match.id)}
                disabled={isLockSaving}
              >
                {lockState.matchLocks[match.id]?.locked ? 'Unlock Match' : 'Lock Match'}
              </Button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label>Winner</Label>
                <Select value={matchResult?.winnerName || '__none__'} onValueChange={(value) => setMatchWinner(match.id, value === '__none__' ? '' : value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select winner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unanswered</SelectItem>
                    {match.participants.map((participant) => (
                      <SelectItem key={participant} value={participant}>{participant}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {state?.playerAnswerSummaries && matchResult?.winnerName?.trim() && (
                  <FuzzyReviewPanel
                    candidates={computeFuzzyCandidatesForAnswer(
                      matchResult.winnerName,
                      (state.playerAnswerSummaries ?? []).map((p) => {
                        const pick = p.matchPicks.find((mp) => mp.matchId === match.id)
                        return {
                          nickname: p.nickname,
                          normalizedNickname: p.normalizedNickname,
                          answer: pick?.winnerName ?? '',
                        }
                      }),
                      payload.winnerOverrides.filter((o) => o.matchId === match.id),
                    )}
                    onAccept={(nn) => {
                      const candidates = computeFuzzyCandidatesForAnswer(
                        matchResult.winnerName,
                        (state.playerAnswerSummaries ?? []).map((p) => {
                          const pick = p.matchPicks.find((mp) => mp.matchId === match.id)
                          return {
                            nickname: p.nickname,
                            normalizedNickname: p.normalizedNickname,
                            answer: pick?.winnerName ?? '',
                          }
                        }),
                        payload.winnerOverrides.filter((o) => o.matchId === match.id),
                      )
                      const candidate = candidates.find((c) => c.normalizedNickname === nn)
                      if (candidate) handleAcceptOverride('winner', match.id, nn, candidate.confidence)
                    }}
                    onReject={(nn) => handleRejectOverride('winner', match.id, nn)}
                  />
                )}

                {match.isBattleRoyal ? (
                  <div className="space-y-2">
                    <Label>Entry Order</Label>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <Input
                        value={battleRoyalEntryInput}
                        onChange={(event) => {
                          setBattleRoyalEntryInputByMatchId((prev) => ({ ...prev, [match.id]: event.target.value }))
                          setActiveRosterInput(battleRoyalFieldKey, event.target.value)
                        }}
                        onFocus={() => setActiveRosterInput(battleRoyalFieldKey, battleRoyalEntryInput)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return
                          event.preventDefault()
                          addBattleRoyalEntrant(match.id, battleRoyalEntryInput)
                        }}
                        placeholder="Add entrant"
                      />
                      <Button type="button" variant="secondary" onClick={() => addBattleRoyalEntrant(match.id, battleRoyalEntryInput)}>
                        <Plus className="mr-1 h-4 w-4" />
                        Add Entrant
                      </Button>
                    </div>
                    {((activeRosterFieldKey === battleRoyalFieldKey && isLoadingQuerySuggestions) || filteredBattleRoyalSuggestions.length > 0) ? (
                      <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2">
                        <p className="text-[11px] text-muted-foreground">
                          {activeRosterFieldKey === battleRoyalFieldKey && isLoadingQuerySuggestions ? 'Loading roster suggestions...' : 'Autocomplete from promotion roster'}
                        </p>
                        {filteredBattleRoyalSuggestions.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {filteredBattleRoyalSuggestions.map((candidate) => (
                              <button
                                key={candidate}
                                type="button"
                                onClick={() => addBattleRoyalEntrant(match.id, candidate)}
                                className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary"
                              >
                                {candidate}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {battleRoyalEntryOrder.length > 0 ? (
                      <div className="space-y-1.5 rounded-md border border-border/70 bg-background/35 p-2.5">
                        {battleRoyalEntryOrder.map((entrant, entrantIndex) => (
                          <div key={`${match.id}:${entrant}:${entrantIndex}`} className="flex items-center justify-between gap-2">
                            <span className="text-sm text-foreground">
                              {entrantIndex + 1}. {entrant}
                            </span>
                            <Button type="button" variant="outline" size="sm" onClick={() => removeBattleRoyalEntrant(match.id, entrantIndex)}>
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">Remove entrant</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-xs text-muted-foreground">Entrants are recorded in the order you add them.</p>
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-border/70 p-3">
                <p className="text-xs text-muted-foreground">Match Timer</p>
                <p className="font-mono text-lg">{timerElapsed}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => timer && (timer.isRunning ? stopTimer(timerId) : startTimer(timerId))}
                  >
                    {timer?.isRunning ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
                    {timer?.isRunning ? 'Stop' : 'Start'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => resetTimer(timerId)}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {match.bonusQuestions.length > 0 ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-medium">Bonus Results</p>
                {match.bonusQuestions.map((question) => {
                  const answer = findAnswer(matchResult?.bonusAnswers ?? [], question.id)
                  const lockKey = toLockKey(match.id, question.id)
                  const isLocked = lockState.matchBonusLocks[lockKey]?.locked === true || lockState.matchLocks[match.id]?.locked === true || lockState.globalLocked
                  const isRosterMemberType = question.valueType === 'rosterMember'
                  const rosterFieldKey = `matchBonus:${match.id}:${question.id}`
                  const rosterQuerySuggestions = activeRosterFieldKey === rosterFieldKey ? querySuggestions : []
                  const filteredRosterSuggestions = isRosterMemberType
                    ? filterRosterMemberSuggestions(
                      answer?.answer ?? '',
                      Array.from(new Set([...match.participants, ...rosterQuerySuggestions])),
                    )
                    : []

                  return (
                    <div key={question.id} className="rounded-md border border-border/70 p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <Label>{question.question || 'Bonus question'}</Label>
                        <Button size="sm" variant={isLocked ? 'default' : 'outline'} onClick={() => toggleMatchBonusLock(match.id, question.id)} disabled={isLockSaving}>
                          {isLocked ? 'Unlock' : 'Lock'}
                        </Button>
                      </div>
                      <Input
                        value={answer?.answer ?? ''}
                        onChange={(event) => {
                          setMatchBonusAnswer(match.id, question.id, event.target.value)
                          setActiveRosterInput(rosterFieldKey, event.target.value)
                        }}
                        onFocus={() => setActiveRosterInput(rosterFieldKey, answer?.answer ?? '')}
                        placeholder={isRosterMemberType ? 'Start typing a roster member...' : 'Key answer'}
                      />
                      {isRosterMemberType && ((activeRosterFieldKey === rosterFieldKey && isLoadingQuerySuggestions) || filteredRosterSuggestions.length > 0) ? (
                        <div className="mt-2 rounded-md border border-border/70 bg-background/35 px-3 py-2">
                          <p className="text-[11px] text-muted-foreground">
                            {activeRosterFieldKey === rosterFieldKey && isLoadingQuerySuggestions ? 'Loading roster suggestions...' : 'Autocomplete from promotion roster'}
                          </p>
                          {filteredRosterSuggestions.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {filteredRosterSuggestions.map((candidate) => (
                                <button
                                  key={`${question.id}:${candidate}`}
                                  type="button"
                                  onClick={() => setMatchBonusAnswer(match.id, question.id, candidate)}
                                  className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary"
                                >
                                  {candidate}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {state?.playerAnswerSummaries && (
                        <FuzzyReviewPanel
                          candidates={computeFuzzyCandidatesForAnswer(
                            answer?.answer ?? '',
                            (state.playerAnswerSummaries ?? []).map((p) => ({
                              nickname: p.nickname,
                              normalizedNickname: p.normalizedNickname,
                              answer: p.matchPicks.find((mp) => mp.matchId === match.id)
                                ?.bonusAnswers.find((ba) => ba.questionId === question.id)?.answer ?? '',
                            })),
                            payload.scoreOverrides.filter((o) => o.questionId === question.id),
                          )}
                          onAccept={(nn) => {
                            const candidates = computeFuzzyCandidatesForAnswer(
                              answer?.answer ?? '',
                              (state.playerAnswerSummaries ?? []).map((p) => ({
                                nickname: p.nickname,
                                normalizedNickname: p.normalizedNickname,
                                answer: p.matchPicks.find((mp) => mp.matchId === match.id)
                                  ?.bonusAnswers.find((ba) => ba.questionId === question.id)?.answer ?? '',
                              })),
                              payload.scoreOverrides.filter((o) => o.questionId === question.id),
                            )
                            const candidate = candidates.find((c) => c.normalizedNickname === nn)
                            if (candidate) handleAcceptOverride('score', question.id, nn, candidate.confidence)
                          }}
                          onReject={(nn) => handleRejectOverride('score', question.id, nn)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>
        )
      })}

      {card.eventBonusQuestions.length > 0 ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-semibold">Event Bonus Results</h2>
          <div className="mt-3 space-y-2">
            {card.eventBonusQuestions.map((question) => {
              const answer = findAnswer(payload.eventBonusAnswers, question.id)
              const isLocked = lockState.eventBonusLocks[question.id]?.locked === true || lockState.globalLocked
              const isRosterMemberType = question.valueType === 'rosterMember'
              const rosterFieldKey = `eventBonus:${question.id}`
              const rosterQuerySuggestions = activeRosterFieldKey === rosterFieldKey ? querySuggestions : []
              const filteredRosterSuggestions = isRosterMemberType
                ? filterRosterMemberSuggestions(
                  answer?.answer ?? '',
                  Array.from(new Set([...eventParticipantCandidates, ...rosterQuerySuggestions])),
                )
                : []

              return (
                <div key={question.id} className="rounded-md border border-border/70 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <Label>{question.question || 'Event bonus'}</Label>
                    <Button size="sm" variant={isLocked ? 'default' : 'outline'} onClick={() => toggleEventBonusLock(question.id)} disabled={isLockSaving}>
                      {isLocked ? 'Unlock' : 'Lock'}
                    </Button>
                  </div>
                  <Input
                    value={answer?.answer ?? ''}
                    onChange={(event) => {
                      setEventBonusAnswer(question.id, event.target.value)
                      setActiveRosterInput(rosterFieldKey, event.target.value)
                    }}
                    onFocus={() => setActiveRosterInput(rosterFieldKey, answer?.answer ?? '')}
                    placeholder={isRosterMemberType ? 'Start typing a roster member...' : 'Key answer'}
                  />
                  {isRosterMemberType && ((activeRosterFieldKey === rosterFieldKey && isLoadingQuerySuggestions) || filteredRosterSuggestions.length > 0) ? (
                    <div className="mt-2 rounded-md border border-border/70 bg-background/35 px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">
                        {activeRosterFieldKey === rosterFieldKey && isLoadingQuerySuggestions ? 'Loading roster suggestions...' : 'Autocomplete from promotion roster'}
                      </p>
                      {filteredRosterSuggestions.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {filteredRosterSuggestions.map((candidate) => (
                            <button
                              key={`${question.id}:${candidate}`}
                              type="button"
                              onClick={() => setEventBonusAnswer(question.id, candidate)}
                              className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary"
                            >
                              {candidate}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {state?.playerAnswerSummaries && (
                    <FuzzyReviewPanel
                      candidates={computeFuzzyCandidatesForAnswer(
                        answer?.answer ?? '',
                        (state.playerAnswerSummaries ?? []).map((p) => ({
                          nickname: p.nickname,
                          normalizedNickname: p.normalizedNickname,
                          answer: p.eventBonusAnswers.find((ba) => ba.questionId === question.id)?.answer ?? '',
                        })),
                        payload.scoreOverrides.filter((o) => o.questionId === question.id),
                      )}
                      onAccept={(nn) => {
                        const candidates = computeFuzzyCandidatesForAnswer(
                          answer?.answer ?? '',
                          (state.playerAnswerSummaries ?? []).map((p) => ({
                            nickname: p.nickname,
                            normalizedNickname: p.normalizedNickname,
                            answer: p.eventBonusAnswers.find((ba) => ba.questionId === question.id)?.answer ?? '',
                          })),
                          payload.scoreOverrides.filter((o) => o.questionId === question.id),
                        )
                        const candidate = candidates.find((c) => c.normalizedNickname === nn)
                        if (candidate) handleAcceptOverride('score', question.id, nn, candidate.confidence)
                      }}
                      onReject={(nn) => handleRejectOverride('score', question.id, nn)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {card.tiebreakerLabel.trim() ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <Label>{card.tiebreakerLabel}</Label>
          <Input
            className="mt-2"
            value={payload.tiebreakerAnswer}
            onChange={(event) => setTiebreakerAnswer(event.target.value)}
            placeholder="Key tiebreaker result"
          />
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold">Leaderboard</h3>
          <div className="mt-2 space-y-1">
            {(state?.leaderboard ?? []).slice(0, 10).map((entry) => {
              const presence = getConnectionStatus(entry.lastSeenAt)
              const dotClass = presence.state === 'online'
                ? 'bg-emerald-500'
                : presence.state === 'idle'
                  ? 'bg-amber-500'
                  : 'bg-slate-400'

              return (
                <div key={`${entry.rank}:${entry.nickname}`} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">#{entry.rank} {entry.nickname}</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                      <span className="capitalize">{presence.state}</span>
                      <span>{presence.ageLabel}</span>
                    </div>
                  </div>
                  <span className="font-mono">{entry.score}</span>
                </div>
              )
            })}
            {(state?.leaderboard ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No submitted players yet.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold">Change Feed</h3>
          <div className="mt-2 space-y-1">
            {(state?.events ?? []).slice(0, 10).map((event) => (
              <p key={event.id} className="text-sm">
                <span className="text-muted-foreground">{new Date(event.createdAt).toLocaleTimeString()} </span>
                {event.message}
              </p>
            ))}
            {(state?.events ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No events yet.</p>
            ) : null}
          </div>
        </div>
      </section>

      {isRefreshStale ? (
        <div className="fixed bottom-20 right-4 z-40">
          <Button
            type="button"
            size="icon"
            className="h-12 w-12 rounded-full shadow-lg"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            title={isRefreshing ? 'Refreshing...' : 'Refresh now'}
          >
            <RefreshCcw className={isRefreshing ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
          </Button>
        </div>
      ) : null}

      {isDirty ? (
        <div className="fixed inset-x-0 bottom-3 z-40 px-4">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
            <p className="text-sm text-amber-200">Unsaved key changes. Auto-save is in progress.</p>
            <Button size="sm" onClick={() => void handleSaveKey()} disabled={isSaving}>
              <Save className="mr-1 h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Now'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
