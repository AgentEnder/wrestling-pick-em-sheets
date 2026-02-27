import { LiveGameHostApp } from "@/components/pick-em/live-game-host-app";

interface LiveGameHostPageProps {
  params: Promise<{ cardId: string }>;
}

export default async function LiveGameHostPage({
  params,
}: LiveGameHostPageProps) {
  const { cardId } = await params;
  return <LiveGameHostApp cardId={cardId} />;
}
