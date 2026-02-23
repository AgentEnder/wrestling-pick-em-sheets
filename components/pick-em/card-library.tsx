"use client"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CardSummary } from "@/lib/client/cards-api"
import { LibraryBig, RefreshCcw, Sparkles } from "lucide-react"
import { useMemo, useState } from "react"

interface CardLibraryProps {
  cards: CardSummary[]
  selectedCardId: string | null
  isLoading: boolean
  isSyncingOverrides: boolean
  onRefresh: () => void
  onSelectCard: (cardId: string) => void
  onCreateFromTemplate: (templateCardId: string) => void
}

function cardLabel(card: CardSummary): string {
  const visibility = card.isPublic ? "Public" : "Private"
  const kind = card.isTemplate ? "Template" : "Card"
  return `${card.name} (${kind}, ${visibility})`
}

export function CardLibrary({
  cards,
  selectedCardId,
  isLoading,
  isSyncingOverrides,
  onRefresh,
  onSelectCard,
  onCreateFromTemplate,
}: CardLibraryProps) {
  const [templateToUse, setTemplateToUse] = useState<string>("")

  const templateCards = useMemo(
    () => cards.filter((card) => card.isTemplate && card.isPublic),
    [cards],
  )

  return (
    <section className="rounded-2xl border border-border/80 bg-card/70 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.25)] backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
            <LibraryBig className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Card Workspace</p>
            <p className="text-xs text-muted-foreground">{cards.length} available</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Loaded Card
          </label>
          <Select
            value={selectedCardId ?? ""}
            onValueChange={onSelectCard}
            disabled={isLoading || cards.length === 0}
          >
            <SelectTrigger className="w-full min-w-0 bg-background/50">
              <SelectValue placeholder={cards.length === 0 ? "No cards available" : "Select a card"} />
            </SelectTrigger>
            <SelectContent>
              {cards.map((card) => (
                <SelectItem key={card.id} value={card.id}>
                  {cardLabel(card)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-xl border border-border/80 bg-background/40 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Auto-save
          </p>
          <p className="mt-1 text-xs text-foreground/90">
            {isSyncingOverrides
              ? "Syncing event settings to card overrides..."
              : "Event settings sync directly to the API for your owned cards."}
          </p>
        </div>

        <div className="border-t border-border/70 pt-4">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Create From Template
          </label>
          <div className="mt-2 flex gap-2">
            <Select value={templateToUse} onValueChange={setTemplateToUse}>
              <SelectTrigger className="w-full min-w-0 bg-background/50">
                <SelectValue placeholder="Select a public template" />
              </SelectTrigger>
              <SelectContent>
                {templateCards.map((card) => (
                  <SelectItem key={card.id} value={card.id}>
                    {card.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              size="sm"
              disabled={!templateToUse}
              onClick={() => {
                onCreateFromTemplate(templateToUse)
                setTemplateToUse("")
              }}
            >
              <Sparkles className="h-4 w-4" />
              Use
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
