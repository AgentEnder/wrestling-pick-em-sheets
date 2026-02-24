import { LiveGameKeyHostApp } from '@/components/pick-em/live-game-key-host-app'

interface LiveGameHostPageProps {
  params: Promise<{ gameId: string }>
  searchParams: Promise<{ code?: string }>
}

export default async function LiveGameHostPage({ params, searchParams }: LiveGameHostPageProps) {
  const { gameId } = await params
  const { code } = await searchParams

  return <LiveGameKeyHostApp gameId={gameId} joinCodeFromUrl={code ?? null} />
}
