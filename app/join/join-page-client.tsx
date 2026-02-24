"use client"

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { joinLiveGame } from '@/lib/client/live-games-api'

export default function JoinPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialCode = useMemo(() => searchParams.get('code') ?? '', [searchParams])

  const [joinCode, setJoinCode] = useState(initialCode)
  const [nickname, setNickname] = useState('')
  const [isJoining, setIsJoining] = useState(false)

  async function handleJoin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsJoining(true)

    try {
      const joined = await joinLiveGame(joinCode, nickname)
      router.push(`/games/${joined.gameId}/play?code=${encodeURIComponent(joined.joinCode)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join game'
      toast.error(message)
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <form onSubmit={handleJoin} className="w-full rounded-xl border border-border bg-card p-5">
        <h1 className="text-2xl font-semibold">Join Live Game</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the room code from the TV and choose a nickname.</p>

        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="join-code" className="text-xs text-muted-foreground">Join code</label>
            <Input
              id="join-code"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={24}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="nickname" className="text-xs text-muted-foreground">Nickname</label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="Your nickname"
              maxLength={60}
              required
            />
          </div>
        </div>

        <Button type="submit" className="mt-4 w-full" disabled={isJoining}>
          {isJoining ? 'Joining...' : 'Join Game'}
        </Button>
      </form>
    </div>
  )
}
