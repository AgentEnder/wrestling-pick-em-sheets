"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EventSettings } from "@/components/event-settings"
import { MatchEditor } from "@/components/match-editor"
import { PrintSheet } from "@/components/print-sheet"
import { Printer, Swords, Crown, RotateCcw } from "lucide-react"
import type { PickEmSheet, Match, StandardMatch, BattleRoyalMatch } from "@/lib/types"

function createStandardMatch(): StandardMatch {
  return {
    id: crypto.randomUUID(),
    type: "standard",
    title: "",
    participants: [],
    bonusQuestions: [],
    points: null,
  }
}

function createBattleRoyal(): BattleRoyalMatch {
  return {
    id: crypto.randomUUID(),
    type: "battleRoyal",
    title: "",
    announcedParticipants: [],
    surpriseSlots: 5,
    bonusQuestions: [],
    points: null,
  }
}

const INITIAL_SHEET: PickEmSheet = {
  eventName: "",
  eventDate: "",
  eventTagline: "",
  defaultPoints: 1,
  matches: [],
}

export default function PickEmPage() {
  const [sheet, setSheet] = useState<PickEmSheet>(INITIAL_SHEET)
  const [activeTab, setActiveTab] = useState("editor")
  const printRef = useRef<HTMLDivElement>(null)

  function addMatch(type: "standard" | "battleRoyal") {
    const newMatch: Match =
      type === "standard" ? createStandardMatch() : createBattleRoyal()
    setSheet((prev) => ({
      ...prev,
      matches: [...prev.matches, newMatch],
    }))
  }

  function updateMatch(index: number, updated: Match) {
    setSheet((prev) => ({
      ...prev,
      matches: prev.matches.map((m, i) => (i === index ? updated : m)),
    }))
  }

  function removeMatch(index: number) {
    setSheet((prev) => ({
      ...prev,
      matches: prev.matches.filter((_, i) => i !== index),
    }))
  }

  function moveMatch(index: number, direction: "up" | "down") {
    setSheet((prev) => {
      const newMatches = [...prev.matches]
      const swapIndex = direction === "up" ? index - 1 : index + 1
      if (swapIndex < 0 || swapIndex >= newMatches.length) return prev
      ;[newMatches[index], newMatches[swapIndex]] = [newMatches[swapIndex], newMatches[index]]
      return { ...prev, matches: newMatches }
    })
  }

  function duplicateMatch(index: number) {
    setSheet((prev) => {
      const source = prev.matches[index]
      const clone = {
        ...JSON.parse(JSON.stringify(source)),
        id: crypto.randomUUID(),
      }
      // Give bonus questions new IDs too
      clone.bonusQuestions = clone.bonusQuestions.map((q: { id: string }) => ({
        ...q,
        id: crypto.randomUUID(),
      }))
      const newMatches = [...prev.matches]
      newMatches.splice(index + 1, 0, clone)
      return { ...prev, matches: newMatches }
    })
  }

  function handlePrint() {
    setActiveTab("preview")
    setTimeout(() => {
      window.print()
    }, 300)
  }

  function handleReset() {
    setSheet(INITIAL_SHEET)
    setActiveTab("editor")
  }

  const hasMatches = sheet.matches.length > 0
  const hasEventName = sheet.eventName.trim().length > 0

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="no-print sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
              <Swords className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-[family-name:var(--font-heading)] text-lg font-bold uppercase tracking-wider text-foreground leading-tight">
                Pick Em Generator
              </h1>
              <p className="text-xs text-muted-foreground leading-tight">
                Create printable pick sheets for wrestling events
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-muted-foreground"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handlePrint}
              disabled={!hasMatches || !hasEventName}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Printer className="h-4 w-4 mr-1" />
              Print Sheet
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="no-print mx-auto max-w-5xl px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 bg-secondary">
            <TabsTrigger value="editor" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Editor
            </TabsTrigger>
            <TabsTrigger
              value="preview"
              disabled={!hasMatches}
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Print Preview
            </TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="flex flex-col gap-6">
            {/* Event settings */}
            <section className="rounded-lg border border-border bg-card p-4">
              <EventSettings sheet={sheet} onChange={setSheet} />
            </section>

            {/* Matches */}
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
                  onChange={(updated) => updateMatch(i, updated)}
                  onRemove={() => removeMatch(i)}
                  onDuplicate={() => duplicateMatch(i)}
                  onMove={(direction) => moveMatch(i, direction)}
                />
              ))}

              {/* Add match buttons */}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => addMatch("standard")}
                  className="border-dashed border-border hover:border-primary hover:text-primary"
                >
                  <Swords className="h-4 w-4 mr-2" />
                  Add Standard Match
                </Button>
                <Button
                  variant="outline"
                  onClick={() => addMatch("battleRoyal")}
                  className="border-dashed border-border hover:border-primary hover:text-primary"
                >
                  <Crown className="h-4 w-4 mr-2" />
                  Add Battle Royal
                </Button>
              </div>

              {!hasMatches && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-secondary/30 py-12 text-center">
                  <Swords className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground font-medium">
                    No matches yet
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Add matches above to start building your pick em sheet
                  </p>
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="preview">
            {hasMatches ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    This is how your sheet will look when printed. Click
                    &ldquo;Print Sheet&rdquo; to print it.
                  </p>
                  <Button
                    size="sm"
                    onClick={handlePrint}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Printer className="h-4 w-4 mr-1" />
                    Print
                  </Button>
                </div>
                <div className="mx-auto rounded-lg border border-border bg-card p-2 shadow-lg overflow-auto">
                  <div ref={printRef}>
                    <PrintSheet sheet={sheet} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-muted-foreground">
                  Add some matches first to preview your sheet.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Print-only version: rendered off-screen but visible to print */}
      <div className="hidden print:block">
        <PrintSheet sheet={sheet} />
      </div>
    </div>
  )
}
