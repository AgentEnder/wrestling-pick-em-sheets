import Link from "next/link";

import { SoloKeyApp } from "@/components/pick-em/solo-key-app";
import { Button } from "@/components/ui/button";
import { getRequestUserId } from "@/lib/server/auth";
import { findResolvedReadableCardById } from "@/lib/server/repositories/cards";

interface SoloLiveKeyPageProps {
  params: Promise<{ cardId: string }>;
}

export default async function SoloLiveKeyPage({
  params,
}: SoloLiveKeyPageProps) {
  const { cardId } = await params;

  const userId = await getRequestUserId();
  const card = await findResolvedReadableCardById(cardId, userId);

  if (card?.archivedAt) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-lg font-semibold">Card is archived</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Unarchive this card from the Cards workspace before starting a new
          live game. Existing live games on this card continue to work.
        </p>
        <Button asChild variant="secondary" className="mt-4">
          <Link href="/cards">Back to cards</Link>
        </Button>
      </div>
    );
  }

  return <SoloKeyApp cardId={cardId} />;
}
