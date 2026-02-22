"use client"

import { useState, useRef, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EventSettings } from "@/components/event-settings"
import { MatchEditor } from "@/components/match-editor"
import { PrintSheet } from "@/components/print-sheet"
import {
  EllipsisVertical,
  Printer,
  Swords,
  Crown,
  RotateCcw,
  Download,
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs"
import type { PickEmSheet, Match, StandardMatch, BattleRoyalMatch, BonusQuestion } from "@/lib/types"

const LOCAL_STORAGE_KEY = "pick-em-sheet"

function createStandardMatch(): StandardMatch {
  return {
    id: crypto.randomUUID(),
    type: "standard",
    title: "",
    description: "",
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
    description: "",
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
  tiebreakerLabel: "Main event total match time (mins)",
  matches: [],
}

export default function PickEmPage() {
  const [sheet, setSheet] = useState<PickEmSheet>(INITIAL_SHEET)
  const [hasHydrated, setHasHydrated] = useState(false)
  const [activeTab, setActiveTab] = useState("editor")
  const printRef = useRef<HTMLDivElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (saved) {
        setSheet(JSON.parse(saved))
      }
    } catch (err) {
      console.warn("Failed to restore saved sheet from localStorage:", err)
    } finally {
      setHasHydrated(true)
    }
  }, [])

  // Persist to localStorage only after hydration to avoid overwriting saved data
  useEffect(() => {
    if (!hasHydrated) return
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sheet))
  }, [sheet, hasHydrated])

  // Global unhandled error / promise-rejection toasts
  useEffect(() => {
    function onError(event: ErrorEvent) {
      toast.error(event.message || "An unexpected error occurred")
    }
    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const msg =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason)
      toast.error(msg || "An unexpected error occurred")
    }
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onUnhandledRejection)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
    }
  }, [])

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
      clone.bonusQuestions = clone.bonusQuestions.map((q: BonusQuestion) => ({
        ...q,
        id: crypto.randomUUID(),
      }))
      const newMatches = [...prev.matches]
      newMatches.splice(index + 1, 0, clone)
      return { ...prev, matches: newMatches }
    })
  }

  function printViaIframe() {
    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.width = "0"
    iframe.style.height = "0"
    iframe.style.border = "0"
    iframe.style.opacity = "0"
    iframe.style.pointerEvents = "none"
    iframe.setAttribute("aria-hidden", "true")

    let hasPrinted = false

    const cleanup = () => {
      window.setTimeout(() => {
        iframe.remove()
      }, 500)
    }

    iframe.onload = () => {
      if (hasPrinted) return
      hasPrinted = true

      const frameWindow = iframe.contentWindow
      const frameDocument = iframe.contentDocument

      if (!frameWindow || !frameDocument) {
        toast.error("Failed to open print dialog")
        cleanup()
        return
      }

      frameDocument.title = sheet.eventName || "Pick Em Sheet"

      Array.from(document.querySelectorAll("style, link[rel='stylesheet']")).forEach((node) => {
        frameDocument.head.appendChild(node.cloneNode(true))
      })

      const printRoot = frameDocument.createElement("div")
      frameDocument.body.appendChild(printRoot)

      const root = createRoot(printRoot)
      root.render(<PrintSheet sheet={sheet} />)

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          frameWindow.focus()
          frameWindow.print()
          root.unmount()
          cleanup()
        })
      })
    }

    document.body.appendChild(iframe)
  }

  function handlePrint() {
    printViaIframe()
  }

  function handleReset() {
    setSheet(INITIAL_SHEET)
    localStorage.removeItem(LOCAL_STORAGE_KEY)
    setActiveTab("editor")
  }

  function handleExport() {
    const json = JSON.stringify(sheet, null, 2)
    const bytes = new TextEncoder().encode(json)
    // Build binary string without spread to avoid stack overflow on large payloads
    let binary = ""
    bytes.forEach((b) => { binary += String.fromCharCode(b) })
    const encoded = btoa(binary)
    const blob = new Blob([encoded], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const safeName = (sheet.eventName.trim() || "pick-em-sheet")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
    a.download = `${safeName}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportClick() {
    importInputRef.current?.click()
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const raw = ev.target?.result as string
        const decoded = atob(raw.trim())
        const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0))
        const json = new TextDecoder().decode(bytes)
        const parsed = JSON.parse(json) as PickEmSheet
        setSheet(parsed)
        setActiveTab("editor")
      } catch {
        toast.error("Failed to import: the file appears to be invalid.")
      }
    }
    reader.readAsText(file)
    // Reset input so the same file can be re-imported
    e.target.value = ""
  }

  const hasMatches = sheet.matches.length > 0
  const hasEventName = sheet.eventName.trim().length > 0

  return (
    <div className="bg-background min-h-screen print:bg-white">
      {/* Top bar */}
      <header className="no-print sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  <EllipsisVertical className="h-4 w-4" />
                  <span className="sr-only">Open actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleImportClick}>
                  <Upload className="h-4 w-4" />
                  Import
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExport}>
                  <Download className="h-4 w-4" />
                  Export
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleReset}>
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              onClick={handlePrint}
              disabled={!hasMatches || !hasEventName}
              title={
                !hasEventName
                  ? "Enter an event name to enable printing"
                  : !hasMatches
                  ? "Add at least one match to enable printing"
                  : undefined
              }
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Printer className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Print Sheet</span>
            </Button>
            <SignedOut>
              <SignInButton mode="modal">
                <Button variant="outline" size="sm">Sign in</Button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
        </div>
      </header>
      {/* Hidden file input for import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
      />

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

      {/* Print-only version: hidden on screen, visible when printing */}
      <div className="print-only-wrapper">
        <PrintSheet sheet={sheet} />
      </div>
    </div>
  )
}
