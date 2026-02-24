"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  getLiveGameKey,
  getLiveGameState,
  saveLiveGameKey,
  updateLiveGameLocks,
  updateLiveGameStatus,
  type LiveGameStateResponse,
} from '@/lib/client/live-games-api'
import { getConnectionStatus } from '@/lib/client/connection-status'
import { getRosterSuggestions } from '@/lib/client/roster-api'
import type {
  LiveGame,
  LiveGameKeyPayload,
  LiveGameLockState,
  LiveKeyAnswer,
  LiveKeyMatchResult,
  LiveKeyTimer,
} from '@/lib/types'
import { Pause, Play, Plus, RefreshCcw, RotateCcw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface LiveGameKeyHostAppProps {
  gameId: string
  joinCodeFromUrl?: string | null
}

const POLL_INTERVAL_MS = 10_000

function nowIso(): string {
  return new Date().toISOString()
}

function nowMs(): number {
  return Date.now()
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

export function LiveGameKeyHostApp({ gameId, joinCodeFromUrl }: LiveGameKeyHostAppProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isStatusSaving, setIsStatusSaving] = useState(false)
  const [isLockSaving, setIsLockSaving] = useState(false)
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
      void getLiveGameState(gameId, joinCodeFromUrl ?? undefined)
        .then((response) => {
          setState(response)
          setGame((current) => (current ? { ...current, status: response.game.status, updatedAt: response.game.updatedAt } : current))
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
      const saved = await saveLiveGameKey(gameId, currentPayload)
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
  }, [gameId, joinCodeFromUrl])

  async function handleSaveKey() {
    await syncPayload('manual')
  }

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      await load()
      toast.success('Refreshed')
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    if (!hasInitializedRef.current || !isDirty) return

    const timeoutId = window.setTimeout(() => {
      void syncPayload('auto')
    }, 700)

    return () => window.clearTimeout(timeoutId)
  }, [isDirty, payload, syncPayload])

  async function handleStatusChange(status: LiveGame['status']) {
    setIsStatusSaving(true)
    try {
      const updated = await updateLiveGameStatus(gameId, status)
      setGame(updated)
      toast.success(`Status set to ${status}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update status'
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Host Keying Console</h1>
            <p className="text-sm text-muted-foreground">
              Join code <span className="font-mono">{game.joinCode}</span> • {card.eventName || 'Untitled Event'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void handleRefresh()} disabled={isRefreshing}>
              <RefreshCcw className="mr-1 h-4 w-4" />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button onClick={() => void handleSaveKey()} disabled={isSaving}>
              <Save className="mr-1 h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Key'}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {isDirty ? 'Unsynced key changes (auto-saving)...' : 'All key changes synced.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Room status:</span>
          {(['lobby', 'live', 'ended'] as const).map((status) => (
            <Button
              key={status}
              variant={game.status === status ? 'default' : 'outline'}
              size="sm"
              disabled={isStatusSaving}
              onClick={() => void handleStatusChange(status)}
            >
              {status}
            </Button>
          ))}
          <Button asChild size="sm" variant="outline">
            <Link href={`/games/${game.id}/display?code=${encodeURIComponent(game.joinCode)}`}>Open Display</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/join?code=${encodeURIComponent(game.joinCode)}`}>Open Join</Link>
          </Button>
        </div>
      </header>

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
    </div>
  )
}
