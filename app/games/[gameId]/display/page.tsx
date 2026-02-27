import { LiveGameDisplayApp } from "@/components/pick-em/live-game-display-app";

interface LiveGameDisplayPageProps {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ code?: string }>;
}

export default async function LiveGameDisplayPage({
  params,
  searchParams,
}: LiveGameDisplayPageProps) {
  const { gameId } = await params;
  const { code } = await searchParams;

  return <LiveGameDisplayApp gameId={gameId} joinCodeFromUrl={code ?? null} />;
}
