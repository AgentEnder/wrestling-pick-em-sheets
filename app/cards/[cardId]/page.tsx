import { PickEmEditorApp } from "@/components/pick-em/pick-em-editor-app";
import { getRequestUserId } from "@/lib/server/auth";
import { findResolvedReadableCardById } from "@/lib/server/repositories/cards";

interface CardEditorPageProps {
  params: Promise<{
    cardId: string;
  }>;
}

export default async function CardEditorPage({ params }: CardEditorPageProps) {
  const { cardId } = await params;

  const userId = await getRequestUserId();
  const card = await findResolvedReadableCardById(cardId, userId);

  return (
    <PickEmEditorApp
      cardId={cardId}
      archivedAt={card?.archivedAt ?? null}
      viewerRole={card?.viewerRole ?? null}
    />
  );
}
