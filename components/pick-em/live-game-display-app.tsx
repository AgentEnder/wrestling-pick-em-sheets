"use client"

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Flame, Sparkles, Trophy } from 'lucide-react'

import { getLiveGameState, type LiveGameStateResponse } from '@/lib/client/live-games-api'
import { getConnectionStatus } from '@/lib/client/connection-status'
import { cn } from '@/lib/utils'

interface LiveGameDisplayAppProps {
  gameId: string
  joinCodeFromUrl?: string | null
}

const POLL_INTERVAL_MS = 10_000
const HIGHLIGHT_DURATION_MS = 4_000

type LeaderboardEffect = 'rank-up' | 'rank-down' | 'score'

export function LiveGameDisplayApp({ gameId, joinCodeFromUrl }: LiveGameDisplayAppProps) {
  const [state, setState] = useState<LiveGameStateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leaderboardEffects, setLeaderboardEffects] = useState<Record<string, LeaderboardEffect>>({})
  const [newEventIds, setNewEventIds] = useState<string[]>([])
  const [momentHeadline, setMomentHeadline] = useState<string | null>(null)
  const previousStateRef = useRef<LiveGameStateResponse | null>(null)
  const clearEffectsTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadState() {
      try {
        const loaded = await getLiveGameState(gameId, joinCodeFromUrl ?? undefined)
        if (cancelled) return

        const previous = previousStateRef.current
        if (previous) {
          const nextEffects: Record<string, LeaderboardEffect> = {}
          const previousByNickname = new Map(previous.leaderboard.map((entry) => [entry.nickname, entry]))

          let topMoment: string | null = null
          for (const entry of loaded.leaderboard) {
            const prior = previousByNickname.get(entry.nickname)
            if (!prior) continue

            const rankDelta = prior.rank - entry.rank
            const scoreDelta = entry.score - prior.score
            if (rankDelta > 0) {
              nextEffects[entry.nickname] = 'rank-up'
              if (!topMoment) topMoment = `${entry.nickname} climbs ${rankDelta} spot${rankDelta === 1 ? '' : 's'}`
              continue
            }

            if (rankDelta < 0) {
              nextEffects[entry.nickname] = 'rank-down'
              continue
            }

            if (scoreDelta !== 0) {
              nextEffects[entry.nickname] = 'score'
              if (!topMoment) topMoment = `${entry.nickname} scores +${scoreDelta}`
            }
          }

          const previousEventIds = new Set(previous.events.map((event) => event.id))
          const addedEvents = loaded.events.filter((event) => !previousEventIds.has(event.id))
          if (addedEvents.length > 0) {
            setNewEventIds(addedEvents.map((event) => event.id))
            if (!topMoment) topMoment = addedEvents[0].message
          }

          setLeaderboardEffects(nextEffects)
          setMomentHeadline(topMoment)

          if (clearEffectsTimeoutRef.current) {
            window.clearTimeout(clearEffectsTimeoutRef.current)
          }
          clearEffectsTimeoutRef.current = window.setTimeout(() => {
            setLeaderboardEffects({})
            setNewEventIds([])
            setMomentHeadline(null)
          }, HIGHLIGHT_DURATION_MS)
        }

        previousStateRef.current = loaded
        setState(loaded)
        setError(null)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to load display state'
        setError(message)
      }
    }

    void loadState()
    const intervalId = window.setInterval(() => {
      void loadState()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      if (clearEffectsTimeoutRef.current) {
        window.clearTimeout(clearEffectsTimeoutRef.current)
      }
    }
  }, [gameId, joinCodeFromUrl])

  if (!state) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6 text-lg text-muted-foreground">
        {error ?? 'Loading live leaderboard...'}
      </div>
    )
  }

  return (
    <div className="min-h-screen px-6 py-6">
      <header className="mb-6 rounded-2xl border border-border/70 bg-card/90 p-5 shadow-xl shadow-black/25 backdrop-blur">
        <div>
          <p className="text-sm uppercase tracking-widest text-primary">Live Leaderboard</p>
          <h1 className="text-4xl font-heading font-semibold leading-tight">{state.card.eventName || 'Untitled Event'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Join code <span className="font-mono text-lg text-foreground">{state.game.joinCode}</span>
          </p>
          {momentHeadline ? (
            <div className="lg-event-pop mt-3 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-sm text-primary">
              <Sparkles className="h-4 w-4" />
              <span className="max-w-[52ch] truncate">{momentHeadline}</span>
            </div>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm text-muted-foreground sm:mt-4 sm:max-w-xl">
          <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-center">
            <p className="text-xs uppercase tracking-wide">Players</p>
            <p className="text-xl font-semibold text-foreground">{state.playerCount}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-center">
            <p className="text-xs uppercase tracking-wide">Submitted</p>
            <p className="text-xl font-semibold text-foreground">{state.submittedCount}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-center">
            <p className="text-xs uppercase tracking-wide">Status</p>
            <p className="text-xl font-semibold capitalize text-foreground">{state.game.status}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl shadow-black/25 backdrop-blur">
          <div className="grid grid-cols-[72px_1fr_170px_90px] gap-2 border-b border-border/70 pb-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>Rank</span>
            <span>Player</span>
            <span>Status</span>
            <span className="text-right">Score</span>
          </div>
          <div className="mt-2 space-y-1">
            {state.leaderboard.length > 0 ? (
              state.leaderboard.map((entry, index) => {
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
                      'relative grid grid-cols-[72px_1fr_170px_90px] items-center gap-2 rounded-md border border-border/70 bg-background/45 px-3 py-2 transition-colors',
                      effect === 'rank-up' && 'lg-rank-up border-emerald-400/65 bg-emerald-400/10',
                      effect === 'rank-down' && 'lg-rank-down border-amber-400/65 bg-amber-400/10',
                      effect === 'score' && 'lg-score-bump border-primary/60 bg-primary/10',
                    )}
                  >
                    {index === 0 ? (
                      <div className="absolute -left-2 -top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                        <Trophy className="mr-1 inline h-3 w-3" />
                        Leader
                      </div>
                    ) : null}
                    <span className="font-mono text-xl font-semibold">#{entry.rank}</span>
                    <span className="truncate text-lg">{entry.nickname}</span>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
                      <span className="capitalize">{presence.state}</span>
                      <span>{presence.ageLabel}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-2xl font-semibold">{entry.score}</span>
                      {effect === 'rank-up' ? <ArrowUp className="ml-1 inline h-4 w-4 text-emerald-400" /> : null}
                      {effect === 'rank-down' ? <ArrowDown className="ml-1 inline h-4 w-4 text-amber-400" /> : null}
                      {effect === 'score' ? <Flame className="ml-1 inline h-4 w-4 text-primary" /> : null}
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Waiting for submitted picks...</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl shadow-black/25 backdrop-blur">
          <h2 className="mb-2 text-sm uppercase tracking-wide text-muted-foreground">Recent Updates</h2>
          <div className="space-y-2">
            {state.events.length > 0 ? (
              state.events.slice(0, 15).map((event) => (
                <div
                  key={event.id}
                  className={cn(
                    'rounded-md border border-border/70 bg-background/45 p-2',
                    newEventIds.includes(event.id) && 'lg-event-pop border-primary/60 bg-primary/10',
                  )}
                >
                  <p className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleTimeString()}</p>
                  <p className="text-sm">{event.message}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
