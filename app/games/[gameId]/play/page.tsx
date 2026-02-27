import { LiveGamePlayerApp } from "@/components/pick-em/live-game-player-app";

interface LiveGamePlayPageProps {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ code?: string }>;
}

export default async function LiveGamePlayPage({
  params,
  searchParams,
}: LiveGamePlayPageProps) {
  const { gameId } = await params;
  const { code } = await searchParams;

  return <LiveGamePlayerApp gameId={gameId} joinCodeFromUrl={code ?? null} />;
}
