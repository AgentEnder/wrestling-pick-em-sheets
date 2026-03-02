import { SoloKeyApp } from "@/components/pick-em/solo-key-app";

interface SoloLiveKeyPageProps {
  params: Promise<{ cardId: string }>;
}

export default async function SoloLiveKeyPage({
  params,
}: SoloLiveKeyPageProps) {
  const { cardId } = await params;
  return <SoloKeyApp cardId={cardId} />;
}
