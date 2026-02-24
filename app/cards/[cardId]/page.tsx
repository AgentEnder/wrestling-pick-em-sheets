import { PickEmEditorApp } from "@/components/pick-em/pick-em-editor-app"

interface CardEditorPageProps {
  params: Promise<{
    cardId: string
  }>
}

export default async function CardEditorPage({ params }: CardEditorPageProps) {
  const { cardId } = await params
  return <PickEmEditorApp cardId={cardId} />
}
