"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Trash2,
  X,
  Swords,
  Crown,
  HelpCircle,
} from "lucide-react"
import type { Match, BonusQuestion, StandardMatch, BattleRoyalMatch } from "@/lib/types"

interface MatchEditorProps {
  match: Match
  index: number
  defaultPoints: number
  onChange: (match: Match) => void
  onRemove: () => void
}

export function MatchEditor({ match, index, defaultPoints, onChange, onRemove }: MatchEditorProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [newParticipant, setNewParticipant] = useState("")

  const effectivePoints = match.points ?? defaultPoints

  function addParticipant() {
    const name = newParticipant.trim()
    if (!name) return

    if (match.type === "standard") {
      onChange({
        ...match,
        participants: [...match.participants, name],
      })
    } else {
      onChange({
        ...match,
        announcedParticipants: [...match.announcedParticipants, name],
      })
    }
    setNewParticipant("")
  }

  function removeParticipant(idx: number) {
    if (match.type === "standard") {
      onChange({
        ...match,
        participants: match.participants.filter((_, i) => i !== idx),
      })
    } else {
      onChange({
        ...match,
        announcedParticipants: match.announcedParticipants.filter((_, i) => i !== idx),
      })
    }
  }

  function addBonusQuestion() {
    const q: BonusQuestion = {
      id: crypto.randomUUID(),
      question: "",
      points: null,
    }
    onChange({ ...match, bonusQuestions: [...match.bonusQuestions, q] })
  }

  function updateBonusQuestion(qIndex: number, updates: Partial<BonusQuestion>) {
    const updated = match.bonusQuestions.map((q, i) =>
      i === qIndex ? { ...q, ...updates } : q
    )
    onChange({ ...match, bonusQuestions: updated })
  }

  function removeBonusQuestion(qIndex: number) {
    onChange({
      ...match,
      bonusQuestions: match.bonusQuestions.filter((_, i) => i !== qIndex),
    })
  }

  const participants =
    match.type === "standard" ? match.participants : match.announcedParticipants
  const participantCount = participants.length

  const matchLabel =
    match.type === "battleRoyal" ? "Battle Royal" : `${participantCount}-Way Match`

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/50 transition-colors rounded-t-lg"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-2 shrink-0">
              {match.type === "battleRoyal" ? (
                <Crown className="h-4 w-4 text-primary" />
              ) : (
                <Swords className="h-4 w-4 text-primary" />
              )}
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Match {index + 1}
              </span>
            </div>
            <span className="font-semibold text-card-foreground truncate">
              {match.title || "Untitled Match"}
            </span>
            <span className="ml-auto text-xs text-muted-foreground shrink-0">
              {matchLabel} &middot; {effectivePoints}pt{effectivePoints !== 1 ? "s" : ""}
            </span>
            {isOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
            {/* Match title and points */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
              <div className="flex flex-col gap-1.5">
                <Label>Match Title / Stipulation</Label>
                <Input
                  placeholder="e.g. World Heavyweight Championship"
                  value={match.title}
                  onChange={(e) => onChange({ ...match, title: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>
                  Points{" "}
                  <span className="text-xs text-muted-foreground">
                    (blank = default {defaultPoints})
                  </span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  className="w-24"
                  placeholder={String(defaultPoints)}
                  value={match.points ?? ""}
                  onChange={(e) => {
                    const val = e.target.value
                    onChange({
                      ...match,
                      points: val === "" ? null : Math.max(1, parseInt(val) || 1),
                    })
                  }}
                />
              </div>
            </div>

            {/* Participants */}
            <div className="flex flex-col gap-2">
              <Label>
                {match.type === "battleRoyal" ? "Announced Participants" : "Participants"}
              </Label>
              <div className="flex flex-wrap gap-2">
                {participants.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-sm text-secondary-foreground"
                  >
                    {p}
                    <button
                      type="button"
                      onClick={() => removeParticipant(i)}
                      className="rounded-sm hover:text-destructive transition-colors"
                      aria-label={`Remove ${p}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Add participant or team name..."
                  value={newParticipant}
                  onChange={(e) => setNewParticipant(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addParticipant()
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={addParticipant}
                  className="shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  <span className="sr-only">Add participant</span>
                </Button>
              </div>
            </div>

            {/* Battle Royal surprise slots */}
            {match.type === "battleRoyal" && (
              <div className="flex flex-col gap-1.5">
                <Label>Number of Surprise Entrant Slots</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  className="w-24"
                  value={(match as BattleRoyalMatch).surpriseSlots}
                  onChange={(e) =>
                    onChange({
                      ...match,
                      surpriseSlots: Math.max(0, parseInt(e.target.value) || 0),
                    } as BattleRoyalMatch)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Blank lines on the printed sheet for guessing surprise entrants
                </p>
              </div>
            )}

            {/* Bonus Questions */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-primary" />
                <Label>Bonus Questions</Label>
              </div>
              {match.bonusQuestions.map((q, i) => (
                <div key={q.id} className="flex items-start gap-2">
                  <Input
                    placeholder="e.g. How will the match end?"
                    value={q.question}
                    onChange={(e) =>
                      updateBonusQuestion(i, { question: e.target.value })
                    }
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={1}
                    placeholder={String(defaultPoints)}
                    value={q.points ?? ""}
                    onChange={(e) => {
                      const val = e.target.value
                      updateBonusQuestion(i, {
                        points: val === "" ? null : Math.max(1, parseInt(val) || 1),
                      })
                    }}
                    className="w-20"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeBonusQuestion(i)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Remove question</span>
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addBonusQuestion}
                className="self-start"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Bonus Question
              </Button>
            </div>

            {/* Remove match */}
            <div className="flex justify-end border-t border-border pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemove}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Remove Match
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
