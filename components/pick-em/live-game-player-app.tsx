"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Reorder } from 'motion/react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getRosterSuggestions } from '@/lib/client/roster-api'
import {
  getLiveGameMe,
  getLiveGameState,
  saveMyLiveGamePicks,
  submitMyLiveGamePicks,
  type LiveGameMeResponse,
  type LiveGameStateResponse,
} from '@/lib/client/live-games-api'
import { getConnectionStatus } from '@/lib/client/connection-status'
import {
  createScreenWakeLockManager,
  getNotificationPermission,
  isWebPushSupported,
  registerLiveGameServiceWorker,
  requestNotificationPermission,
  subscribeToLiveGamePush,
  subscribeToLiveGameSwMessages,
  unsubscribeFromLiveGamePush,
  vibrateForeground,
  type WakeLockManager,
} from '@/lib/client/live-game-pwa'
import type { LivePlayerAnswer, LivePlayerMatchPick, LivePlayerPicksPayload } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Bell, BellOff, Maximize2, Minimize2, Plus, RefreshCcw, Save, Sparkles, Trash2, Trophy, Tv, Zap } from 'lucide-react'
import { toast } from 'sonner'

interface LiveGamePlayerAppProps {
  gameId: string
  joinCodeFromUrl?: string | null
}

const POLL_INTERVAL_MS = 10_000
const REFRESH_STALE_THRESHOLD_MS = POLL_INTERVAL_MS * 5
const FULLSCREEN_EFFECT_DURATION_MS = 15_000
const FULLSCREEN_LEADERBOARD_LIMIT = 8
const LEADERBOARD_SWAP_DURATION_MS = 1_000
const LEADERBOARD_FINAL_PAUSE_MS = 5_000
const UPDATE_VIBRATE_PATTERN = [110, 60, 110]

function getPushPromptStorageKey(gameId: string, playerId: string): string {
  return `live-game-push-prompted:${gameId}:${playerId}`
}

type FullscreenEffect =
  | {
    kind: 'events'
    events: LiveGameStateResponse['events']
  }
  | {
    kind: 'leaderboard'
    previous: LiveGameStateResponse['leaderboard']
    current: LiveGameStateResponse['leaderboard']
    swapCount: number
  }

function formatEventTypeLabel(type: string): string {
  const normalized = type.toLowerCase()
  if (normalized.includes('bonus')) return 'Bonus Question'
  if (normalized.includes('result')) return 'Match Result'
  if (normalized.includes('tiebreaker')) return 'Tiebreaker'
  return type.replace(/[_-]/g, ' ')
}

function hasLeaderboardChanged(previous: LiveGameStateResponse, next: LiveGameStateResponse): boolean {
  if (previous.leaderboard.length !== next.leaderboard.length) return true
  for (let index = 0; index < next.leaderboard.length; index += 1) {
    const prior = previous.leaderboard[index]
    const current = next.leaderboard[index]
    if (!prior || !current) return true
    if (prior.nickname !== current.nickname) return true
    if (prior.rank !== current.rank) return true
    if (prior.score !== current.score) return true
  }
  return false
}

function buildBubbleSortSteps(previous: string[], current: string[]): string[][] {
  const currentSet = new Set(current)
  const start = [
    ...previous.filter((name) => currentSet.has(name)),
    ...current.filter((name) => !previous.includes(name)),
  ]
  const steps: string[][] = [start]
  const working = [...start]
  const targetIndex = new Map(current.map((name, index) => [name, index]))

  for (let outer = 0; outer < working.length; outer += 1) {
    let swapped = false
    for (let inner = 0; inner < working.length - 1; inner += 1) {
      const left = working[inner]
      const right = working[inner + 1]
      if ((targetIndex.get(left) ?? Infinity) <= (targetIndex.get(right) ?? Infinity)) continue
      working[inner] = right
      working[inner + 1] = left
      steps.push([...working])
      swapped = true
    }
    if (!swapped) break
  }

  const finalOrder = steps[steps.length - 1]
  if (finalOrder.length !== current.length || finalOrder.some((name, index) => name !== current[index])) {
    steps.push([...current])
  }

  return steps
}

function getFullscreenEffectDurationMs(effect: FullscreenEffect): number {
  if (effect.kind === 'events') return FULLSCREEN_EFFECT_DURATION_MS
  return (effect.swapCount * LEADERBOARD_SWAP_DURATION_MS) + LEADERBOARD_FINAL_PAUSE_MS
}

function findMatchPick(picks: LivePlayerPicksPayload, matchId: string): LivePlayerMatchPick | null {
  return picks.matchPicks.find((pick) => pick.matchId === matchId) ?? null
}

function findAnswer(answers: LivePlayerAnswer[], questionId: string): LivePlayerAnswer | null {
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

export function LiveGamePlayerApp({ gameId, joinCodeFromUrl }: LiveGamePlayerAppProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [me, setMe] = useState<LiveGameMeResponse | null>(null)
  const [state, setState] = useState<LiveGameStateResponse | null>(null)
  const [picks, setPicks] = useState<LivePlayerPicksPayload | null>(null)
  const [querySuggestions, setQuerySuggestions] = useState<string[]>([])
  const [isLoadingQuerySuggestions, setIsLoadingQuerySuggestions] = useState(false)
  const [activeRosterFieldKey, setActiveRosterFieldKey] = useState<string | null>(null)
  const [activeRosterQuery, setActiveRosterQuery] = useState('')
  const [battleRoyalEntryInputByMatchId, setBattleRoyalEntryInputByMatchId] = useState<Record<string, string>>({})
  const [fullscreenEffectQueue, setFullscreenEffectQueue] = useState<FullscreenEffect[]>([])
  const [activeFullscreenEffect, setActiveFullscreenEffect] = useState<FullscreenEffect | null>(null)
  const [animatedLeaderboardOrder, setAnimatedLeaderboardOrder] = useState<string[]>([])
  const [isPageFullscreen, setIsPageFullscreen] = useState(false)
  const [isWakeLockActive, setIsWakeLockActive] = useState(false)
  const [wakeLockSupported, setWakeLockSupported] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [isPushSupported, setIsPushSupported] = useState(false)
  const [isPushPromptOpen, setIsPushPromptOpen] = useState(false)
  const [isPushSubscribed, setIsPushSubscribed] = useState(false)
  const [isPushSubscribing, setIsPushSubscribing] = useState(false)
  const [lastRefreshAtMs, setLastRefreshAtMs] = useState<number | null>(null)
  const [nowTickMs, setNowTickMs] = useState(Date.now())
  const previousStateRef = useRef<LiveGameStateResponse | null>(null)
  const fullscreenEffectTimeoutRef = useRef<number | null>(null)
  const leaderboardStepIntervalRef = useRef<number | null>(null)
  const hasHydratedInitialStateRef = useRef(false)
  const wakeLockManagerRef = useRef<WakeLockManager | null>(null)

  function queueFullscreenEffects(effects: FullscreenEffect[]) {
    if (effects.length === 0) return
    setFullscreenEffectQueue((previous) => [...previous, ...effects])
  }

  function dismissActiveFullscreenEffect() {
    if (fullscreenEffectTimeoutRef.current) {
      window.clearTimeout(fullscreenEffectTimeoutRef.current)
      fullscreenEffectTimeoutRef.current = null
    }
    if (leaderboardStepIntervalRef.current) {
      window.clearInterval(leaderboardStepIntervalRef.current)
      leaderboardStepIntervalRef.current = null
    }
    setAnimatedLeaderboardOrder([])
    setActiveFullscreenEffect(null)
  }

  useEffect(() => {
    if (activeFullscreenEffect || fullscreenEffectQueue.length === 0) return

    const [nextEffect, ...remaining] = fullscreenEffectQueue
    setFullscreenEffectQueue(remaining)
    setActiveFullscreenEffect(nextEffect)

    if (fullscreenEffectTimeoutRef.current) {
      window.clearTimeout(fullscreenEffectTimeoutRef.current)
    }
    fullscreenEffectTimeoutRef.current = window.setTimeout(() => {
      setActiveFullscreenEffect(null)
    }, getFullscreenEffectDurationMs(nextEffect))
  }, [activeFullscreenEffect, fullscreenEffectQueue])

  useEffect(() => {
    if (leaderboardStepIntervalRef.current) {
      window.clearInterval(leaderboardStepIntervalRef.current)
      leaderboardStepIntervalRef.current = null
    }

    if (!activeFullscreenEffect || activeFullscreenEffect.kind !== 'leaderboard') {
      setAnimatedLeaderboardOrder([])
      return
    }

    const steps = buildBubbleSortSteps(
      activeFullscreenEffect.previous.map((entry) => entry.nickname),
      activeFullscreenEffect.current.map((entry) => entry.nickname),
    )
    setAnimatedLeaderboardOrder(steps[0] ?? [])

    if (steps.length > 1) {
      let stepIndex = 0
      leaderboardStepIntervalRef.current = window.setInterval(() => {
        stepIndex += 1
        if (stepIndex >= steps.length) {
          if (leaderboardStepIntervalRef.current) {
            window.clearInterval(leaderboardStepIntervalRef.current)
            leaderboardStepIntervalRef.current = null
          }
          return
        }
        setAnimatedLeaderboardOrder(steps[stepIndex])
      }, LEADERBOARD_SWAP_DURATION_MS)
    }

    return () => {
      if (leaderboardStepIntervalRef.current) {
        window.clearInterval(leaderboardStepIntervalRef.current)
        leaderboardStepIntervalRef.current = null
      }
    }
  }, [activeFullscreenEffect])

  const applyGameUpdate = useCallback((nextState: LiveGameStateResponse, nextMe: LiveGameMeResponse, animate: boolean) => {
    if (!animate) {
      previousStateRef.current = nextState
      setState(nextState)
      setMe((current) => {
        if (!current) return nextMe
        return {
          ...current,
          game: nextMe.game,
          locks: nextMe.locks,
          player: {
            ...current.player,
            isSubmitted: nextMe.player.isSubmitted,
            submittedAt: nextMe.player.submittedAt,
            updatedAt: nextMe.player.updatedAt,
          },
        }
      })
      if (!hasHydratedInitialStateRef.current) {
        setPicks(nextMe.player.picks)
        hasHydratedInitialStateRef.current = true
      }
      return
    }

    const previousState = previousStateRef.current
    previousStateRef.current = nextState
    if (!previousState) return

    const previousEventIds = new Set(previousState.events.map((event) => event.id))
    const addedEvents = nextState.events.filter((event) => !previousEventIds.has(event.id))
    const leaderboardChanged = hasLeaderboardChanged(previousState, nextState)

    const queuedFullscreenEffects: FullscreenEffect[] = []
    if (addedEvents.length > 0) {
      queuedFullscreenEffects.push({
        kind: 'events',
        events: addedEvents.slice(0, 4),
      })
      vibrateForeground(UPDATE_VIBRATE_PATTERN)
    }
    if (leaderboardChanged) {
      const bubbleSteps = buildBubbleSortSteps(
        previousState.leaderboard.slice(0, FULLSCREEN_LEADERBOARD_LIMIT).map((entry) => entry.nickname),
        nextState.leaderboard.slice(0, FULLSCREEN_LEADERBOARD_LIMIT).map((entry) => entry.nickname),
      )
      queuedFullscreenEffects.push({
        kind: 'leaderboard',
        previous: previousState.leaderboard.slice(0, FULLSCREEN_LEADERBOARD_LIMIT),
        current: nextState.leaderboard.slice(0, FULLSCREEN_LEADERBOARD_LIMIT),
        swapCount: Math.max(1, bubbleSteps.length - 1),
      })
    }
    queueFullscreenEffects(queuedFullscreenEffects)

    setState(nextState)
    setMe((current) => {
      if (!current) return nextMe
      return {
        ...current,
        game: nextMe.game,
        locks: nextMe.locks,
        player: {
          ...current.player,
          isSubmitted: nextMe.player.isSubmitted,
          submittedAt: nextMe.player.submittedAt,
          updatedAt: nextMe.player.updatedAt,
        },
      }
    })
    if (!hasHydratedInitialStateRef.current) {
      setPicks(nextMe.player.picks)
      hasHydratedInitialStateRef.current = true
    }
  }, [])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [loadedMe, loadedState] = await Promise.all([
        getLiveGameMe(gameId),
        getLiveGameState(gameId, joinCodeFromUrl ?? undefined),
      ])

      applyGameUpdate(loadedState, loadedMe, false)
      setLastRefreshAtMs(Date.now())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load game'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [applyGameUpdate, gameId, joinCodeFromUrl])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTickMs(Date.now())
    }, 1_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    setWakeLockSupported('wakeLock' in navigator)
    setIsPushSupported(isWebPushSupported())
    setNotificationPermission(getNotificationPermission())

    void registerLiveGameServiceWorker().catch(() => {})
    const unsubscribeMessages = subscribeToLiveGameSwMessages(() => {
      vibrateForeground(UPDATE_VIBRATE_PATTERN)
      void load()
    })

    const manager = createScreenWakeLockManager((isActive) => {
      setIsWakeLockActive(isActive)
    })
    wakeLockManagerRef.current = manager

    return () => {
      unsubscribeMessages()
      wakeLockManagerRef.current = null
      void manager.destroy()
    }
  }, [load])

  useEffect(() => {
    if (!isPushSupported || !me) return

    const promptStorageKey = getPushPromptStorageKey(gameId, me.player.id)
    const promptedBefore = window.localStorage.getItem(promptStorageKey) === '1'

    if (notificationPermission === 'granted') {
      if (isPushSubscribed || isPushSubscribing) return
      setIsPushSubscribing(true)
      void subscribeToLiveGamePush(gameId)
        .then(() => {
          setIsPushSubscribed(true)
        })
        .catch(() => {
          setIsPushSubscribed(false)
        })
        .finally(() => {
          setIsPushSubscribing(false)
        })
      return
    }

    if (notificationPermission === 'default' && !promptedBefore) {
      setIsPushPromptOpen(true)
    }
  }, [
    gameId,
    isPushSubscribed,
    isPushSubscribing,
    isPushSupported,
    me,
    notificationPermission,
  ])

  useEffect(() => {
    const hasPushTransport = notificationPermission === 'granted' && isPushSubscribed
    if (hasPushTransport) {
      return () => {}
    }

    const intervalId = window.setInterval(() => {
      void Promise.all([
        getLiveGameState(gameId, joinCodeFromUrl ?? undefined),
        getLiveGameMe(gameId),
      ])
        .then(([nextState, nextMe]) => {
          applyGameUpdate(nextState, nextMe, true)
          setLastRefreshAtMs(Date.now())
        })
        .catch(() => {
          // Keep current state when polling fails.
        })
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [applyGameUpdate, gameId, isPushSubscribed, joinCodeFromUrl, notificationPermission])

  useEffect(() => {
    const promotionName = state?.card.promotionName?.trim() ?? ''
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
  }, [activeRosterQuery, state?.card.promotionName])

  useEffect(() => () => {
    if (fullscreenEffectTimeoutRef.current) {
      window.clearTimeout(fullscreenEffectTimeoutRef.current)
    }
    if (leaderboardStepIntervalRef.current) {
      window.clearInterval(leaderboardStepIntervalRef.current)
    }
  }, [])

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsPageFullscreen(document.fullscreenElement != null)
    }

    syncFullscreenState()
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState)
    }
  }, [])

  function setActiveRosterInput(fieldKey: string, value: string) {
    setActiveRosterFieldKey(fieldKey)
    setActiveRosterQuery(value)
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

  function setMatchWinner(matchId: string, winnerName: string) {
    setPicks((prev) => {
      if (!prev) return prev
      const nextMatchPicks = [...prev.matchPicks]
      const index = nextMatchPicks.findIndex((pick) => pick.matchId === matchId)

      const nextPick: LivePlayerMatchPick = {
        matchId,
        winnerName,
        battleRoyalEntrants: index === -1 ? [] : nextMatchPicks[index].battleRoyalEntrants,
        bonusAnswers: index === -1 ? [] : nextMatchPicks[index].bonusAnswers,
      }

      if (index === -1) {
        nextMatchPicks.push(nextPick)
      } else {
        nextMatchPicks[index] = nextPick
      }

      return {
        ...prev,
        matchPicks: nextMatchPicks,
      }
    })
  }

  function addBattleRoyalEntrant(matchId: string, entrantName: string) {
    const entrant = entrantName.trim()
    if (!entrant) return

    setPicks((prev) => {
      if (!prev) return prev

      const nextMatchPicks = [...prev.matchPicks]
      let index = nextMatchPicks.findIndex((pick) => pick.matchId === matchId)

      if (index === -1) {
        nextMatchPicks.push({
          matchId,
          winnerName: '',
          battleRoyalEntrants: [],
          bonusAnswers: [],
        })
        index = nextMatchPicks.length - 1
      }

      const existingEntrants = nextMatchPicks[index].battleRoyalEntrants
      const hasDuplicate = existingEntrants.some((item) => item.toLowerCase() === entrant.toLowerCase())
      if (hasDuplicate) {
        return prev
      }

      nextMatchPicks[index] = {
        ...nextMatchPicks[index],
        battleRoyalEntrants: [...existingEntrants, entrant],
      }

      return {
        ...prev,
        matchPicks: nextMatchPicks,
      }
    })

    setBattleRoyalEntryInputByMatchId((prev) => ({ ...prev, [matchId]: '' }))
    setActiveRosterFieldKey(`battleRoyal:${matchId}`)
    setActiveRosterQuery('')
  }

  function removeBattleRoyalEntrant(matchId: string, entrantIndex: number) {
    setPicks((prev) => {
      if (!prev) return prev

      const nextMatchPicks = [...prev.matchPicks]
      const index = nextMatchPicks.findIndex((pick) => pick.matchId === matchId)
      if (index === -1) return prev

      nextMatchPicks[index] = {
        ...nextMatchPicks[index],
        battleRoyalEntrants: nextMatchPicks[index].battleRoyalEntrants.filter((_, i) => i !== entrantIndex),
      }

      return {
        ...prev,
        matchPicks: nextMatchPicks,
      }
    })
  }

  function setMatchBonusAnswer(matchId: string, questionId: string, answer: string) {
    setPicks((prev) => {
      if (!prev) return prev

      const nextMatchPicks = [...prev.matchPicks]
      let index = nextMatchPicks.findIndex((pick) => pick.matchId === matchId)
      if (index === -1) {
        nextMatchPicks.push({
          matchId,
          winnerName: '',
          battleRoyalEntrants: [],
          bonusAnswers: [],
        })
        index = nextMatchPicks.length - 1
      }

      const current = nextMatchPicks[index]
      const nextAnswers = [...current.bonusAnswers]
      const answerIndex = nextAnswers.findIndex((item) => item.questionId === questionId)

      if (answerIndex === -1) {
        nextAnswers.push({ questionId, answer })
      } else {
        nextAnswers[answerIndex] = { questionId, answer }
      }

      nextMatchPicks[index] = {
        ...current,
        bonusAnswers: nextAnswers,
      }

      return {
        ...prev,
        matchPicks: nextMatchPicks,
      }
    })
  }

  function setEventBonusAnswer(questionId: string, answer: string) {
    setPicks((prev) => {
      if (!prev) return prev
      const nextAnswers = [...prev.eventBonusAnswers]
      const index = nextAnswers.findIndex((item) => item.questionId === questionId)

      if (index === -1) {
        nextAnswers.push({ questionId, answer })
      } else {
        nextAnswers[index] = { questionId, answer }
      }

      return {
        ...prev,
        eventBonusAnswers: nextAnswers,
      }
    })
  }

  function setTiebreakerAnswer(answer: string) {
    setPicks((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        tiebreakerAnswer: answer,
      }
    })
  }

  async function handleSave() {
    if (!picks || !me) return

    setIsSaving(true)
    try {
      const saved = await saveMyLiveGamePicks(gameId, picks, {
        expectedUpdatedAt: me.player.updatedAt,
      })
      setMe((prev) => prev
        ? {
          ...prev,
          player: saved.player,
        }
        : prev)

      if (!saved.player.isSubmitted) {
        const submitted = await submitMyLiveGamePicks(gameId)
        setMe((prev) => prev
          ? {
            ...prev,
            player: submitted,
          }
          : prev)
      }

      if (saved.ignoredLocks.length > 0) {
        toast.warning(`Saved with ${saved.ignoredLocks.length} locked field(s) ignored.`)
      } else {
        toast.success('Picks saved')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save picks'
      if (message.includes('changed in another session')) {
        await load()
      }
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleTogglePageFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to toggle fullscreen mode'
      toast.error(message)
    }
  }

  async function handleToggleWakeLock() {
    const manager = wakeLockManagerRef.current
    if (!manager) return
    if (isWakeLockActive) {
      await manager.release()
      return
    }

    const locked = await manager.request()
    if (!locked) {
      toast.error('Wake lock unavailable. Keep this page visible and retry.')
    }
  }

  async function handleEnableNotifications() {
    if (!isPushSupported) {
      toast.error('Push notifications are not supported in this browser.')
      return
    }

    if (!me) return

    const promptStorageKey = getPushPromptStorageKey(gameId, me.player.id)
    window.localStorage.setItem(promptStorageKey, '1')

    const nextPermission = await requestNotificationPermission()
    setNotificationPermission(nextPermission)

    if (nextPermission === 'granted') {
      setIsPushSubscribing(true)
      try {
        await subscribeToLiveGamePush(gameId)
        setIsPushSubscribed(true)
        toast.success('Notifications enabled')
      } catch {
        setIsPushSubscribed(false)
        toast.error('Unable to enable push notifications for this game')
      } finally {
        setIsPushSubscribing(false)
      }
    } else if (nextPermission === 'denied') {
      toast.error('Notifications blocked in browser settings')
      await unsubscribeFromLiveGamePush(gameId)
      setIsPushSubscribed(false)
    }

    setIsPushPromptOpen(false)
  }

  function handleDismissPushPrompt() {
    if (me) {
      const promptStorageKey = getPushPromptStorageKey(gameId, me.player.id)
      window.localStorage.setItem(promptStorageKey, '1')
    }
    setIsPushPromptOpen(false)
  }

  const lockSnapshot = me?.locks

  const myRank = useMemo(
    () => state?.leaderboard.find((entry) => entry.nickname === me?.player.nickname) ?? null,
    [state?.leaderboard, me?.player.nickname],
  )
  const displayHref = useMemo(
    () => `/games/${gameId}/display?code=${encodeURIComponent(state?.game.joinCode ?? joinCodeFromUrl ?? '')}`,
    [gameId, joinCodeFromUrl, state?.game.joinCode],
  )
  const eventParticipantCandidates = useMemo(
    () => Array.from(new Set((state?.card.matches ?? []).flatMap((match) => match.participants))),
    [state?.card.matches],
  )

  if (isLoading || !me || !state || !picks || !lockSnapshot) {
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 text-sm text-muted-foreground">
        Loading game...
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <Dialog
        open={isPushPromptOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsPushPromptOpen(true)
            return
          }
          handleDismissPushPrompt()
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Enable Live Game Alerts?</DialogTitle>
            <DialogDescription>
              We use push notifications to alert you about scoring updates while this live game is in progress,
              including when the app is backgrounded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleDismissPushPrompt}>
              Not Now
            </Button>
            <Button onClick={() => void handleEnableNotifications()}>
              Enable Notifications
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {activeFullscreenEffect ? (
        <div
          className={cn(
            'lg-fullscreen-effect',
            activeFullscreenEffect.kind === 'events' ? 'lg-fullscreen-effect-events' : 'lg-fullscreen-effect-leaderboard',
          )}
          onClick={dismissActiveFullscreenEffect}
        >
          {activeFullscreenEffect.kind === 'events' ? (
            <div className="lg-fullscreen-effect-panel">
              <div className="lg-fullscreen-effect-title">
                <Sparkles className="h-6 w-6" />
                <span className="font-heading text-2xl uppercase tracking-wide">Live Results</span>
              </div>
              <div className="lg-fullscreen-effect-body">
                {activeFullscreenEffect.events.map((event, index) => (
                  <div
                    key={event.id}
                    className="lg-fullscreen-event-item"
                    style={{ animationDelay: `${index * 110}ms` }}
                  >
                    <p className="text-xs uppercase tracking-wide text-primary/90">
                      {formatEventTypeLabel(event.type)}
                    </p>
                    <p className="text-base text-foreground">{event.message}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="lg-fullscreen-effect-panel">
              <div className="lg-fullscreen-effect-title">
                <Trophy className="h-6 w-6" />
                <span className="font-heading text-2xl uppercase tracking-wide">Leaderboard Shift</span>
              </div>
              <div
                className="lg-fullscreen-effect-body"
              >
                {(() => {
                  const currentByNickname = new Map(activeFullscreenEffect.current.map((entry) => [entry.nickname, entry]))
                  const previousByNickname = new Map(activeFullscreenEffect.previous.map((entry) => [entry.nickname, entry]))
                  const order = animatedLeaderboardOrder.length > 0
                    ? animatedLeaderboardOrder
                    : activeFullscreenEffect.previous.map((entry) => entry.nickname)

                  return (
                    <Reorder.Group
                      axis="y"
                      values={order}
                      onReorder={() => {}}
                      className="lg-fullscreen-reorder-list"
                    >
                      {order.map((nickname) => {
                        const entry = currentByNickname.get(nickname)
                        if (!entry) return null
                        const previousRank = previousByNickname.get(nickname)?.rank ?? null
                        const rankDelta = previousRank == null ? 0 : previousRank - entry.rank

                        return (
                          <Reorder.Item
                            key={`fullscreen-lb-${nickname}`}
                            value={nickname}
                            className="lg-fullscreen-leaderboard-row"
                            transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold">#{entry.rank} {entry.nickname}</p>
                              <p className="text-xs text-muted-foreground">
                                {previousRank == null ? 'New to board' : `Was #${previousRank}`}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-mono text-lg font-semibold">{entry.score}</p>
                              {rankDelta > 0 ? <p className="text-xs text-emerald-300">+{rankDelta} rank</p> : null}
                              {rankDelta < 0 ? <p className="text-xs text-amber-300">{rankDelta} rank</p> : null}
                            </div>
                          </Reorder.Item>
                        )
                      })}
                    </Reorder.Group>
                  )
                })()}
              </div>
            </div>
          )}
        </div>
      ) : null}
      <header className="rounded-xl border border-border/70 bg-card/90 p-4 shadow-lg shadow-black/20 backdrop-blur">
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="text-2xl font-heading font-semibold">{state.card.eventName || 'Live Game'}</h1>
            <p className="text-sm text-muted-foreground">
              Playing as <span className="font-semibold text-foreground">{me.player.nickname}</span> • code{' '}
              <span className="font-mono">{state.game.joinCode}</span>
            </p>
            {myRank ? <p className="text-xs text-muted-foreground">Current rank: #{myRank.rank} ({myRank.score} pts)</p> : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Button onClick={() => void handleSave()} disabled={isSaving}>
              <Save className="mr-1 h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Picks'}
            </Button>
            <Button variant="outline" onClick={() => void handleTogglePageFullscreen()}>
              {isPageFullscreen ? <Minimize2 className="mr-1 h-4 w-4" /> : <Maximize2 className="mr-1 h-4 w-4" />}
              {isPageFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </Button>
            <Button variant="outline" onClick={() => void handleToggleWakeLock()} disabled={!wakeLockSupported}>
              <Zap className="mr-1 h-4 w-4" />
              {isWakeLockActive ? 'Wake Lock On' : 'Keep Screen Awake'}
            </Button>
            {notificationPermission === 'granted' && isPushSubscribed ? (
              <Button variant="outline" disabled>
                <BellOff className="mr-1 h-4 w-4" />
                Alerts Enabled
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  if (notificationPermission === 'default') {
                    setIsPushPromptOpen(true)
                    return
                  }
                  void handleEnableNotifications()
                }}
                disabled={notificationPermission === 'unsupported' || isPushSubscribing}
              >
                <Bell className="mr-1 h-4 w-4" />
                {isPushSubscribing ? 'Enabling...' : 'Enable Alerts'}
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={displayHref} target="_blank" rel="noreferrer">
                <Tv className="mr-1 h-4 w-4" />
                TV Display
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {isRefreshStale ? (
        <div className="fixed bottom-4 right-4 z-40">
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

      {state.card.matches.map((match, index) => {
        const matchPick = findMatchPick(picks, match.id)
        const isMatchLocked = lockSnapshot.matchLocks[match.id] === true || lockSnapshot.globalLocked
        const battleRoyalEntrants = matchPick?.battleRoyalEntrants ?? []
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
            .filter((candidate) => !battleRoyalEntrants.some((entrant) => entrant.toLowerCase() === candidate.toLowerCase()))
            .slice(0, 8)
          : []

        return (
          <section
            key={match.id}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-semibold">Match {index + 1}: {match.title || 'Untitled Match'}</h2>
              {isMatchLocked ? <span className="text-xs text-amber-500">Locked</span> : null}
            </div>

            <div className="space-y-2">
              <Label>Winner</Label>
              <Select
                value={matchPick?.winnerName || '__none__'}
                onValueChange={(value) => setMatchWinner(match.id, value === '__none__' ? '' : value)}
                disabled={isMatchLocked}
              >
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
                  <Label>Surprise Entrants</Label>
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
                        if (isMatchLocked) return
                        addBattleRoyalEntrant(match.id, battleRoyalEntryInput)
                      }}
                      disabled={isMatchLocked}
                      placeholder="Add entrant"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => addBattleRoyalEntrant(match.id, battleRoyalEntryInput)}
                      disabled={isMatchLocked}
                    >
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
                              disabled={isMatchLocked}
                              className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {candidate}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {battleRoyalEntrants.length > 0 ? (
                    <div className="space-y-1.5 rounded-md border border-border/70 bg-background/35 p-2.5">
                      {battleRoyalEntrants.map((entrant, entrantIndex) => (
                        <div key={`${match.id}:${entrant}:${entrantIndex}`} className="flex items-center justify-between gap-2">
                          <span className="text-sm text-foreground">
                            {entrantIndex + 1}. {entrant}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removeBattleRoyalEntrant(match.id, entrantIndex)}
                            disabled={isMatchLocked}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Remove entrant</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {match.bonusQuestions.length > 0 ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-medium">Bonus Picks</p>
                {match.bonusQuestions.map((question) => {
                  const answer = findAnswer(matchPick?.bonusAnswers ?? [], question.id)
                  const isLocked = lockSnapshot.matchBonusLocks[toLockKey(match.id, question.id)] === true || isMatchLocked
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
                    <div key={question.id} className="space-y-1.5 rounded-md border border-border/70 p-2.5">
                      <Label>{question.question || 'Bonus question'}</Label>
                      <Input
                        value={answer?.answer ?? ''}
                        onChange={(event) => {
                          setMatchBonusAnswer(match.id, question.id, event.target.value)
                          setActiveRosterInput(rosterFieldKey, event.target.value)
                        }}
                        onFocus={() => setActiveRosterInput(rosterFieldKey, answer?.answer ?? '')}
                        disabled={isLocked}
                        placeholder={isRosterMemberType ? 'Start typing a roster member...' : 'Your answer'}
                      />
                      {isRosterMemberType && ((activeRosterFieldKey === rosterFieldKey && isLoadingQuerySuggestions) || filteredRosterSuggestions.length > 0) ? (
                        <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2">
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
                                  disabled={isLocked}
                                  className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {candidate}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {isLocked ? <p className="text-xs text-amber-500">Locked</p> : null}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>
        )
      })}

      {state.card.eventBonusQuestions.length > 0 ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-semibold">Event Bonus Picks</h2>
          <div className="mt-3 space-y-2">
            {state.card.eventBonusQuestions.map((question) => {
              const answer = findAnswer(picks.eventBonusAnswers, question.id)
              const isLocked = lockSnapshot.eventBonusLocks[question.id] === true || lockSnapshot.globalLocked
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
                <div key={question.id} className="space-y-1.5 rounded-md border border-border/70 p-2.5">
                  <Label>{question.question || 'Event bonus'}</Label>
                  <Input
                    value={answer?.answer ?? ''}
                    onChange={(event) => {
                      setEventBonusAnswer(question.id, event.target.value)
                      setActiveRosterInput(rosterFieldKey, event.target.value)
                    }}
                    onFocus={() => setActiveRosterInput(rosterFieldKey, answer?.answer ?? '')}
                    disabled={isLocked}
                    placeholder={isRosterMemberType ? 'Start typing a roster member...' : 'Your answer'}
                  />
                  {isRosterMemberType && ((activeRosterFieldKey === rosterFieldKey && isLoadingQuerySuggestions) || filteredRosterSuggestions.length > 0) ? (
                    <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2">
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
                              disabled={isLocked}
                              className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {candidate}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {isLocked ? <p className="text-xs text-amber-500">Locked</p> : null}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {state.card.tiebreakerLabel.trim() ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <Label>{state.card.tiebreakerLabel}</Label>
          <Input
            className="mt-2"
            value={picks.tiebreakerAnswer}
            onChange={(event) => setTiebreakerAnswer(event.target.value)}
            disabled={lockSnapshot.tiebreakerLocked}
            placeholder="Your tiebreaker answer"
          />
          {lockSnapshot.tiebreakerLocked ? <p className="mt-1 text-xs text-amber-500">Locked</p> : null}
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card/90 p-4 shadow-lg shadow-black/20 backdrop-blur">
          <h3 className="font-semibold">Leaderboard</h3>
          <div className="mt-2 space-y-1">
            {state.leaderboard.slice(0, 12).map((entry) => {
              const presence = getConnectionStatus(entry.lastSeenAt)
              const dotClass = presence.state === 'online'
                ? 'bg-emerald-500'
                : presence.state === 'idle'
                  ? 'bg-amber-500'
                  : 'bg-slate-400'
              return (
                <div
                  key={`${entry.rank}:${entry.nickname}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate">#{entry.rank} {entry.nickname}</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                      <span className="capitalize">{presence.state}</span>
                      <span>{presence.ageLabel}</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <span className="font-mono">{entry.score}</span>
                  </div>
                </div>
              )
            })}
            {state.leaderboard.length === 0 ? (
              <p className="text-xs text-muted-foreground">Leaderboard appears after submissions.</p>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/90 p-4 shadow-lg shadow-black/20 backdrop-blur">
          <h3 className="font-semibold">Updates</h3>
          <div className="mt-2 space-y-1">
            {state.events.slice(0, 12).map((event) => (
              <p
                key={event.id}
                className="rounded-md border border-transparent px-2 py-1 text-sm"
              >
                <span className="text-muted-foreground">{new Date(event.createdAt).toLocaleTimeString()} </span>
                {event.message}
              </p>
            ))}
            {state.events.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events yet.</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
