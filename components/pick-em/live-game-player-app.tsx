"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
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
import type { LivePlayerAnswer, LivePlayerMatchPick, LivePlayerPicksPayload } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ArrowDown, ArrowUp, Flame, Plus, RefreshCcw, Save, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface LiveGamePlayerAppProps {
  gameId: string
  joinCodeFromUrl?: string | null
}

const POLL_INTERVAL_MS = 10_000
const HIGHLIGHT_DURATION_MS = 4_000

type LeaderboardEffect = 'rank-up' | 'rank-down' | 'score'

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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [me, setMe] = useState<LiveGameMeResponse | null>(null)
  const [state, setState] = useState<LiveGameStateResponse | null>(null)
  const [picks, setPicks] = useState<LivePlayerPicksPayload | null>(null)
  const [querySuggestions, setQuerySuggestions] = useState<string[]>([])
  const [isLoadingQuerySuggestions, setIsLoadingQuerySuggestions] = useState(false)
  const [activeRosterFieldKey, setActiveRosterFieldKey] = useState<string | null>(null)
  const [activeRosterQuery, setActiveRosterQuery] = useState('')
  const [battleRoyalEntryInputByMatchId, setBattleRoyalEntryInputByMatchId] = useState<Record<string, string>>({})
  const [leaderboardEffects, setLeaderboardEffects] = useState<Record<string, LeaderboardEffect>>({})
  const [newEventIds, setNewEventIds] = useState<string[]>([])
  const [momentHeadline, setMomentHeadline] = useState<string | null>(null)
  const previousStateRef = useRef<LiveGameStateResponse | null>(null)
  const clearEffectsTimeoutRef = useRef<number | null>(null)
  const hasHydratedInitialStateRef = useRef(false)

  const applyGameUpdate = useCallback((nextState: LiveGameStateResponse, nextMe: LiveGameMeResponse, animate: boolean) => {
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

    if (!animate) {
      previousStateRef.current = nextState
      return
    }

    const previousState = previousStateRef.current
    previousStateRef.current = nextState
    if (!previousState) return

    const nextEffects: Record<string, LeaderboardEffect> = {}
    const previousByNickname = new Map(previousState.leaderboard.map((entry) => [entry.nickname, entry]))
    let nextMomentHeadline: string | null = null

    for (const entry of nextState.leaderboard) {
      const prior = previousByNickname.get(entry.nickname)
      if (!prior) continue

      const rankDelta = prior.rank - entry.rank
      const scoreDelta = entry.score - prior.score
      if (rankDelta > 0) {
        nextEffects[entry.nickname] = 'rank-up'
        if (!nextMomentHeadline) nextMomentHeadline = `${entry.nickname} climbs ${rankDelta} place${rankDelta === 1 ? '' : 's'}`
        continue
      }

      if (rankDelta < 0) {
        nextEffects[entry.nickname] = 'rank-down'
        continue
      }

      if (scoreDelta !== 0) {
        nextEffects[entry.nickname] = 'score'
        if (!nextMomentHeadline) nextMomentHeadline = `${entry.nickname} scores +${scoreDelta}`
      }
    }

    const previousEventIds = new Set(previousState.events.map((event) => event.id))
    const addedEvents = nextState.events.filter((event) => !previousEventIds.has(event.id))
    if (addedEvents.length > 0) {
      setNewEventIds(addedEvents.map((event) => event.id))
      if (!nextMomentHeadline) nextMomentHeadline = addedEvents[0].message
    } else {
      setNewEventIds([])
    }

    setLeaderboardEffects(nextEffects)
    setMomentHeadline(nextMomentHeadline)

    if (clearEffectsTimeoutRef.current) {
      window.clearTimeout(clearEffectsTimeoutRef.current)
    }
    clearEffectsTimeoutRef.current = window.setTimeout(() => {
      setLeaderboardEffects({})
      setNewEventIds([])
      setMomentHeadline(null)
    }, HIGHLIGHT_DURATION_MS)
  }, [])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [loadedMe, loadedState] = await Promise.all([
        getLiveGameMe(gameId),
        getLiveGameState(gameId, joinCodeFromUrl ?? undefined),
      ])

      applyGameUpdate(loadedState, loadedMe, false)
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
      void Promise.all([
        getLiveGameState(gameId, joinCodeFromUrl ?? undefined),
        getLiveGameMe(gameId),
      ])
        .then(([nextState, nextMe]) => {
          applyGameUpdate(nextState, nextMe, true)
        })
        .catch(() => {
          // Keep current state when polling fails.
        })
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [applyGameUpdate, gameId, joinCodeFromUrl])

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
    if (clearEffectsTimeoutRef.current) {
      window.clearTimeout(clearEffectsTimeoutRef.current)
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
      toast.success('Refreshed')
    } finally {
      setIsRefreshing(false)
    }
  }

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
    if (!picks) return

    setIsSaving(true)
    try {
      const result = await saveMyLiveGamePicks(gameId, picks)
      setMe((prev) => prev
        ? {
          ...prev,
          player: result.player,
        }
        : prev)

      if (result.ignoredLocks.length > 0) {
        toast.warning(`Saved with ${result.ignoredLocks.length} locked field(s) ignored.`)
      } else {
        toast.success('Picks saved')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save picks'
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSubmit() {
    if (!picks) return

    setIsSubmitting(true)
    try {
      const saved = await saveMyLiveGamePicks(gameId, picks)
      setMe((prev) => prev
        ? {
          ...prev,
          player: saved.player,
        }
        : prev)

      const submitted = await submitMyLiveGamePicks(gameId)
      setMe((prev) => prev
        ? {
          ...prev,
          player: submitted,
        }
        : prev)
      toast.success('Picks submitted')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit picks'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const lockSnapshot = me?.locks

  const myRank = useMemo(
    () => state?.leaderboard.find((entry) => entry.nickname === me?.player.nickname) ?? null,
    [state?.leaderboard, me?.player.nickname],
  )
  const myLeaderboardEffect = me?.player.nickname ? leaderboardEffects[me.player.nickname] : undefined
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
      <header className="rounded-xl border border-border/70 bg-card/90 p-4 shadow-lg shadow-black/20 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-heading font-semibold">{state.card.eventName || 'Live Game'}</h1>
            <p className="text-sm text-muted-foreground">
              Playing as <span className="font-semibold text-foreground">{me.player.nickname}</span> • code{' '}
              <span className="font-mono">{state.game.joinCode}</span>
            </p>
            {myRank ? (
              <p
                className={cn(
                  'text-xs text-muted-foreground',
                  myLeaderboardEffect === 'rank-up' && 'lg-rank-up text-emerald-300',
                  myLeaderboardEffect === 'rank-down' && 'lg-rank-down text-amber-300',
                  myLeaderboardEffect === 'score' && 'lg-score-bump text-primary',
                )}
              >
                Current rank: #{myRank.rank} ({myRank.score} pts)
              </p>
            ) : null}
            {momentHeadline ? (
              <p className="lg-event-pop mt-2 inline-flex max-w-[58ch] items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-xs text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {momentHeadline}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void handleRefresh()} disabled={isRefreshing}>
              <RefreshCcw className="mr-1 h-4 w-4" />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button variant="outline" onClick={() => void handleSave()} disabled={isSaving}>
              <Save className="mr-1 h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Picks'}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={isSubmitting || me.player.isSubmitted}>
              {me.player.isSubmitted ? 'Submitted' : isSubmitting ? 'Submitting...' : 'Submit Picks'}
            </Button>
          </div>
        </div>
      </header>

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
          <section key={match.id} className="rounded-lg border border-border bg-card p-4">
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
              const effect = leaderboardEffects[entry.nickname]

              return (
                <div
                  key={`${entry.rank}:${entry.nickname}`}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1 text-sm transition-colors',
                    effect === 'rank-up' && 'lg-rank-up border-emerald-500/40 bg-emerald-500/10',
                    effect === 'rank-down' && 'lg-rank-down border-amber-500/40 bg-amber-500/10',
                    effect === 'score' && 'lg-score-bump border-primary/45 bg-primary/10',
                  )}
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
                    {effect === 'rank-up' ? <ArrowUp className="ml-1 inline h-3.5 w-3.5 text-emerald-400" /> : null}
                    {effect === 'rank-down' ? <ArrowDown className="ml-1 inline h-3.5 w-3.5 text-amber-400" /> : null}
                    {effect === 'score' ? <Flame className="ml-1 inline h-3.5 w-3.5 text-primary" /> : null}
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
                className={cn(
                  'rounded-md border border-transparent px-2 py-1 text-sm',
                  newEventIds.includes(event.id) && 'lg-event-pop border-primary/45 bg-primary/10',
                )}
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
