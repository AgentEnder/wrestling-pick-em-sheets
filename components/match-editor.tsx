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
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Plus,
  Trash2,
  X,
  Swords,
  Crown,
  HelpCircle,
  ListChecks,
  PenLine,
} from "lucide-react"
import type { Match, BonusQuestion, StandardMatch, BattleRoyalMatch } from "@/lib/types"

interface MatchEditorProps {
  match: Match
  index: number
  totalMatches: number
  defaultPoints: number
  onChange: (match: Match) => void
  onRemove: () => void
  onDuplicate: () => void
  onMove: (direction: "up" | "down") => void
}

export function MatchEditor({
  match,
  index,
  totalMatches,
  defaultPoints,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
}: MatchEditorProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [newParticipant, setNewParticipant] = useState("")
  const [newOptionInputs, setNewOptionInputs] = useState<Record<string, string>>({})

  const effectivePoints = match.points ?? defaultPoints

  function addParticipant() {
    const name = newParticipant.trim()
    if (!name) return
    if (match.type === "standard") {
      onChange({ ...match, participants: [...match.participants, name] })
    } else {
      onChange({ ...match, announcedParticipants: [...match.announcedParticipants, name] })
    }
    setNewParticipant("")
  }

  function removeParticipant(idx: number) {
    if (match.type === "standard") {
      onChange({ ...match, participants: match.participants.filter((_, i) => i !== idx) })
    } else {
      onChange({ ...match, announcedParticipants: match.announcedParticipants.filter((_, i) => i !== idx) })
    }
  }

  function addBonusQuestion() {
    const q: BonusQuestion = {
      id: crypto.randomUUID(),
      question: "",
      points: null,
      answerType: "write-in",
      options: [],
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
    onChange({ ...match, bonusQuestions: match.bonusQuestions.filter((_, i) => i !== qIndex) })
  }

  function addOption(qIndex: number) {
    const q = match.bonusQuestions[qIndex]
    const val = (newOptionInputs[q.id] || "").trim()
    if (!val) return
    updateBonusQuestion(qIndex, { options: [...q.options, val] })
    setNewOptionInputs((prev) => ({ ...prev, [q.id]: "" }))
  }

  function removeOption(qIndex: number, optIndex: number) {
    const q = match.bonusQuestions[qIndex]
    updateBonusQuestion(qIndex, { options: q.options.filter((_, i) => i !== optIndex) })
  }

  const participants = match.type === "standard" ? match.participants : match.announcedParticipants
  const participantCount = participants.length
  const matchLabel = match.type === "battleRoyal" ? "Battle Royal" : `${participantCount > 0 ? participantCount + "-Way" : "Standard"} Match`

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-border bg-card">
        {/* Header row with reorder + trigger */}
        <div className="flex items-center">
          <div className="flex flex-col border-r border-border">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onMove("up")}
              className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors"
              aria-label="Move match up"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              disabled={index === totalMatches - 1}
              onClick={() => onMove("down")}
              className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors"
              aria-label="Move match down"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/50 transition-colors rounded-tr-lg"
            >
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
        </div>

        <CollapsibleContent>
          <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
            {/* Title, Description, Points */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
              <div className="flex flex-col gap-3">
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
                    Description{" "}
                    <span className="text-xs text-muted-foreground">(optional, shown on sheet)</span>
                  </Label>
                  <Input
                    placeholder="e.g. Tables, Ladders & Chairs -- first to retrieve the briefcase wins"
                    value={match.description}
                    onChange={(e) => onChange({ ...match, description: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>
                  Points{" "}
                  <span className="text-xs text-muted-foreground">
                    (blank = {defaultPoints})
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
                <Button type="button" variant="secondary" size="sm" onClick={addParticipant} className="shrink-0">
                  <Plus className="h-4 w-4" />
                  <span className="sr-only">Add participant</span>
                </Button>
              </div>
            </div>

            {/* Battle Royal surprise slots */}
            {match.type === "battleRoyal" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_auto] sm:items-end sm:justify-start">
                <div className="flex flex-col gap-1.5">
                  <Label>Surprise Entrant Slots</Label>
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
                    Write-in lines on the sheet for guessing guest entrants
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Guest Spot Pts</Label>
                  <Input
                    type="number"
                    min={1}
                    className="w-24"
                    placeholder={String(defaultPoints)}
                    value={(match as BattleRoyalMatch).surprisePoints ?? ""}
                    onChange={(e) => {
                      const val = e.target.value
                      onChange({
                        ...match,
                        surprisePoints: val === "" ? null : Math.max(1, parseInt(val) || 1),
                      } as BattleRoyalMatch)
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Points per correct guest spot guess (blank = {defaultPoints})
                  </p>
                </div>
              </div>
            )}

            {/* Bonus Questions */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-primary" />
                <Label>Bonus Questions</Label>
              </div>
              {match.bonusQuestions.map((q, qi) => (
                <div key={q.id} className="rounded-md border border-border bg-secondary/30 p-3 flex flex-col gap-2">
                  {/* Question text + points + remove */}
                  <div className="flex items-start gap-2">
                    <Input
                      placeholder="e.g. How will the match end?"
                      value={q.question}
                      onChange={(e) => updateBonusQuestion(qi, { question: e.target.value })}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      min={1}
                      placeholder={String(defaultPoints)}
                      value={q.points ?? ""}
                      onChange={(e) => {
                        const val = e.target.value
                        updateBonusQuestion(qi, {
                          points: val === "" ? null : Math.max(1, parseInt(val) || 1),
                        })
                      }}
                      className="w-20"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeBonusQuestion(qi)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                      <span className="sr-only">Remove question</span>
                    </Button>
                  </div>

                  {/* Answer type toggle */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Answer type:</span>
                    <button
                      type="button"
                      onClick={() => updateBonusQuestion(qi, { answerType: "write-in" })}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                        q.answerType === "write-in"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      }`}
                    >
                      <PenLine className="h-3 w-3" />
                      Write-in
                    </button>
                    <button
                      type="button"
                      onClick={() => updateBonusQuestion(qi, { answerType: "multiple-choice" })}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                        q.answerType === "multiple-choice"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      }`}
                    >
                      <ListChecks className="h-3 w-3" />
                      Multiple Choice
                    </button>
                  </div>

                  {/* Multiple choice options editor */}
                  {q.answerType === "multiple-choice" && (
                    <div className="flex flex-col gap-1.5 pl-2">
                      <div className="flex flex-wrap gap-1.5">
                        {q.options.map((opt, oi) => (
                          <span
                            key={oi}
                            className="inline-flex items-center gap-1 rounded bg-card px-2 py-0.5 text-xs text-card-foreground border border-border"
                          >
                            {opt}
                            <button
                              type="button"
                              onClick={() => removeOption(qi, oi)}
                              className="hover:text-destructive transition-colors"
                              aria-label={`Remove option ${opt}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Add answer option..."
                          value={newOptionInputs[q.id] || ""}
                          onChange={(e) =>
                            setNewOptionInputs((prev) => ({ ...prev, [q.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              addOption(qi)
                            }
                          }}
                          className="text-sm"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => addOption(qi)}
                          className="shrink-0"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addBonusQuestion} className="self-start">
                <Plus className="h-4 w-4 mr-1" />
                Add Bonus Question
              </Button>
            </div>

            {/* Actions */}
            <div className="flex justify-between border-t border-border pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDuplicate}
                className="text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-4 w-4 mr-1" />
                Duplicate
              </Button>
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
