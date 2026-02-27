import { LiveKeyApp } from "@/components/pick-em/live-key-app";

interface SoloLiveKeyPageProps {
  params: Promise<{ cardId: string }>;
}

export default async function SoloLiveKeyPage({
  params,
}: SoloLiveKeyPageProps) {
  const { cardId } = await params;
  return <LiveKeyApp cardId={cardId} />;
}
