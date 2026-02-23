"use client"

import { EventSettings } from "@/components/event-settings"
import { MatchEditor } from "@/components/match-editor"
import { Button } from "@/components/ui/button"
import type { Match, PickEmSheet } from "@/lib/types"
import { Crown, Swords } from "lucide-react"

interface EditorViewProps {
  sheet: PickEmSheet
  hasMatches: boolean
  onSheetChange: (sheet: PickEmSheet) => void
  onAddMatch: (type: "standard" | "battleRoyal") => void
  onUpdateMatch: (index: number, updated: Match) => void
  onRemoveMatch: (index: number) => void
  onDuplicateMatch: (index: number) => void
  onMoveMatch: (index: number, direction: "up" | "down") => void
}

export function EditorView({
  sheet,
  hasMatches,
  onSheetChange,
  onAddMatch,
  onUpdateMatch,
  onRemoveMatch,
  onDuplicateMatch,
  onMoveMatch,
}: EditorViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border bg-card p-4">
        <EventSettings sheet={sheet} onChange={onSheetChange} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-heading)] text-xl font-bold uppercase tracking-wide text-primary">
            Match Card
          </h2>
          <span className="text-sm text-muted-foreground">
            {sheet.matches.length} match{sheet.matches.length !== 1 ? "es" : ""}
          </span>
        </div>

        {sheet.matches.map((match, i) => (
          <MatchEditor
            key={match.id}
            match={match}
            index={i}
            totalMatches={sheet.matches.length}
            defaultPoints={sheet.defaultPoints}
            onChange={(updated) => onUpdateMatch(i, updated)}
            onRemove={() => onRemoveMatch(i)}
            onDuplicate={() => onDuplicateMatch(i)}
            onMove={(direction) => onMoveMatch(i, direction)}
          />
        ))}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onAddMatch("standard")}
            className="border-dashed border-border hover:border-primary hover:text-primary"
          >
            <Swords className="h-4 w-4 mr-2" />
            Add Standard Match
          </Button>
          <Button
            variant="outline"
            onClick={() => onAddMatch("battleRoyal")}
            className="border-dashed border-border hover:border-primary hover:text-primary"
          >
            <Crown className="h-4 w-4 mr-2" />
            Add Battle Royal
          </Button>
        </div>

        {!hasMatches && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-secondary/30 py-12 text-center">
            <Swords className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground font-medium">No matches yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add matches above to start building your pick em sheet
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
