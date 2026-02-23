"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PrintSheet } from "@/components/print-sheet"
import { CardLibrary } from "@/components/pick-em/card-library"
import { EditorView } from "@/components/pick-em/editor-view"
import { PageHeader } from "@/components/pick-em/page-header"
import { PreviewView } from "@/components/pick-em/preview-view"
import {
  createCard,
  createCardFromTemplate,
  getCard,
  listCards,
  saveCardSheet,
  updateCardOverrides,
} from "@/lib/client/cards-api"
import { useAuth } from "@clerk/nextjs"
import type {
  BonusQuestion,
  BattleRoyalMatch,
  Match,
  PickEmSheet,
  StandardMatch,
} from "@/lib/types"
import { toast } from "sonner"

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

const LOCAL_DRAFT_STORAGE_KEY = "pick-em-draft-v1"

interface LocalDraftState {
  selectedCardId: string | null
  draftsByCardId: Record<string, PickEmSheet>
  unsavedSheet: PickEmSheet | null
}

const EMPTY_LOCAL_DRAFT_STATE: LocalDraftState = {
  selectedCardId: null,
  draftsByCardId: {},
  unsavedSheet: null,
}

function readLocalDraftState(): LocalDraftState {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY)
    if (!raw) {
      return { ...EMPTY_LOCAL_DRAFT_STATE, draftsByCardId: {} }
    }

    const parsed = JSON.parse(raw) as Partial<LocalDraftState>
    return {
      selectedCardId: typeof parsed.selectedCardId === "string" ? parsed.selectedCardId : null,
      draftsByCardId:
        parsed.draftsByCardId && typeof parsed.draftsByCardId === "object"
          ? (parsed.draftsByCardId as Record<string, PickEmSheet>)
          : {},
      unsavedSheet:
        parsed.unsavedSheet && typeof parsed.unsavedSheet === "object"
          ? (parsed.unsavedSheet as PickEmSheet)
          : null,
    }
  } catch {
    return { ...EMPTY_LOCAL_DRAFT_STATE, draftsByCardId: {} }
  }
}

function writeLocalDraftState(state: LocalDraftState) {
  localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, JSON.stringify(state))
}

function toSheet(card: {
  eventName: string
  eventDate: string
  eventTagline: string
  defaultPoints: number
  tiebreakerLabel: string
  matches: Match[]
}): PickEmSheet {
  return {
    eventName: card.eventName,
    eventDate: card.eventDate,
    eventTagline: card.eventTagline,
    defaultPoints: card.defaultPoints,
    tiebreakerLabel: card.tiebreakerLabel,
    matches: card.matches,
  }
}

function normalizeNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function PickEmApp() {
  const { userId, isLoaded: isAuthLoaded } = useAuth()
  const [sheet, setSheet] = useState<PickEmSheet>(INITIAL_SHEET)
  const [activeTab, setActiveTab] = useState("editor")
  const [cards, setCards] = useState<Awaited<ReturnType<typeof listCards>>>([])
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [isLoadingCards, setIsLoadingCards] = useState(false)
  const [isLoadingCard, setIsLoadingCard] = useState(false)
  const [isSyncingOverrides, setIsSyncingOverrides] = useState(false)
  const [isSavingSheet, setIsSavingSheet] = useState(false)
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false)

  const printRef = useRef<HTMLDivElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const resetSheetRef = useRef<PickEmSheet>(INITIAL_SHEET)
  const selectedCardIdRef = useRef<string | null>(null)
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localDraftRef = useRef<LocalDraftState>({
    selectedCardId: null,
    draftsByCardId: {},
    unsavedSheet: null,
  })

  const hasMatches = sheet.matches.length > 0
  const hasEventName = sheet.eventName.trim().length > 0

  useEffect(() => {
    selectedCardIdRef.current = selectedCardId
  }, [selectedCardId])

  useEffect(() => {
    const localDraft = readLocalDraftState()
    localDraftRef.current = localDraft

    if (localDraft.selectedCardId) {
      selectedCardIdRef.current = localDraft.selectedCardId
      setSelectedCardId(localDraft.selectedCardId)

      const draftForCard = localDraft.draftsByCardId[localDraft.selectedCardId]
      if (draftForCard) {
        setSheet(draftForCard)
        resetSheetRef.current = draftForCard
      }
    } else if (localDraft.unsavedSheet) {
      setSheet(localDraft.unsavedSheet)
      resetSheetRef.current = localDraft.unsavedSheet
    }

    setHasHydratedDraft(true)
  }, [])

  const loadCards = useCallback(async (preferredCardId?: string) => {
    setIsLoadingCards(true)

    try {
      const data = await listCards()
      setCards(data)

      if (data.length === 0) {
        setSelectedCardId(null)
        const unsavedSheet = localDraftRef.current.unsavedSheet ?? INITIAL_SHEET
        setSheet(unsavedSheet)
        resetSheetRef.current = unsavedSheet
        return
      }

      const fallbackCardId = data.find((card) => !card.isTemplate)?.id ?? data[0]?.id ?? null
      const currentCardId = preferredCardId ?? selectedCardIdRef.current
      const nextCardId =
        currentCardId && data.some((card) => card.id === currentCardId)
          ? currentCardId
          : fallbackCardId

      setSelectedCardId(nextCardId)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load cards"
      toast.error(message)
    } finally {
      setIsLoadingCards(false)
    }
  }, [])

  useEffect(() => {
    if (!hasHydratedDraft) {
      return
    }

    void loadCards(localDraftRef.current.selectedCardId ?? undefined)
  }, [hasHydratedDraft, loadCards])

  useEffect(() => {
    if (!selectedCardId) {
      const unsavedSheet = localDraftRef.current.unsavedSheet
      if (unsavedSheet) {
        setSheet(unsavedSheet)
        resetSheetRef.current = unsavedSheet
      }
      return
    }

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current)
      syncTimeoutRef.current = null
    }

    const controller = new AbortController()
    const cardId = selectedCardId
    const draftForCard = localDraftRef.current.draftsByCardId[cardId]

    if (draftForCard) {
      setSheet(draftForCard)
      resetSheetRef.current = draftForCard
      setIsLoadingCard(false)
      return
    }

    async function loadSelectedCard() {
      setIsLoadingCard(true)

      try {
        const card = await getCard(cardId)
        if (controller.signal.aborted) {
          return
        }

        const cardSheet = toSheet(card)
        setSheet(cardSheet)
        resetSheetRef.current = cardSheet
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "Failed to load card"
          toast.error(message)
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingCard(false)
        }
      }
    }

    void loadSelectedCard()

    return () => {
      controller.abort()
    }
  }, [selectedCardId])

  useEffect(() => {
    if (!hasHydratedDraft) {
      return
    }

    localDraftRef.current.selectedCardId = selectedCardId
    writeLocalDraftState(localDraftRef.current)
  }, [selectedCardId, hasHydratedDraft])

  useEffect(() => {
    if (!hasHydratedDraft) {
      return
    }

    if (selectedCardId) {
      localDraftRef.current.draftsByCardId[selectedCardId] = sheet
      localDraftRef.current.unsavedSheet = null
    } else {
      localDraftRef.current.unsavedSheet = sheet
    }

    writeLocalDraftState(localDraftRef.current)
  }, [sheet, hasHydratedDraft])

  useEffect(() => {
    function onError(event: ErrorEvent) {
      toast.error(event.message || "An unexpected error occurred")
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const message =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason)
      toast.error(message || "An unexpected error occurred")
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onUnhandledRejection)

    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
    }
  }, [])

  function queueOverrideSync(nextSheet: PickEmSheet) {
    if (!selectedCardId) {
      return
    }

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current)
    }

    syncTimeoutRef.current = setTimeout(async () => {
      setIsSyncingOverrides(true)

      try {
        await updateCardOverrides(selectedCardId, {
          eventName: normalizeNullable(nextSheet.eventName),
          eventDate: normalizeNullable(nextSheet.eventDate),
          eventTagline: normalizeNullable(nextSheet.eventTagline),
          defaultPoints: nextSheet.defaultPoints,
          tiebreakerLabel: normalizeNullable(nextSheet.tiebreakerLabel),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to sync card overrides"
        toast.error(message)
      } finally {
        setIsSyncingOverrides(false)
      }
    }, 500)
  }

  function addMatch(type: "standard" | "battleRoyal") {
    const newMatch: Match = type === "standard" ? createStandardMatch() : createBattleRoyal()

    setSheet((prev) => ({
      ...prev,
      matches: [...prev.matches, newMatch],
    }))
  }

  function updateMatch(index: number, updated: Match) {
    setSheet((prev) => ({
      ...prev,
      matches: prev.matches.map((match, i) => (i === index ? updated : match)),
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

      if (swapIndex < 0 || swapIndex >= newMatches.length) {
        return prev
      }

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

      clone.bonusQuestions = clone.bonusQuestions.map((question: BonusQuestion) => ({
        ...question,
        id: crypto.randomUUID(),
      }))

      const newMatches = [...prev.matches]
      newMatches.splice(index + 1, 0, clone)
      return { ...prev, matches: newMatches }
    })
  }

  function handlePrint() {
    window.print()
  }

  function handleReset() {
    setSheet(resetSheetRef.current)
    setActiveTab("editor")
  }

  function handleExport() {
    const json = JSON.stringify(sheet, null, 2)
    const bytes = new TextEncoder().encode(json)
    let binary = ""

    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte)
    })

    const encoded = btoa(binary)
    const blob = new Blob([encoded], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url

    const safeName = (sheet.eventName.trim() || "pick-em-sheet")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")

    anchor.download = `${safeName}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function handleImportClick() {
    importInputRef.current?.click()
  }

  function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      try {
        const raw = loadEvent.target?.result as string
        const decoded = atob(raw.trim())
        const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
        const json = new TextDecoder().decode(bytes)
        const parsed = JSON.parse(json) as PickEmSheet
        setSheet(parsed)
        setActiveTab("editor")
      } catch {
        toast.error("Failed to import: the file appears to be invalid.")
      }
    }

    reader.readAsText(file)
    event.target.value = ""
  }

  function handleEventSettingsChange(nextSheet: PickEmSheet) {
    setSheet(nextSheet)
    queueOverrideSync(nextSheet)
  }

  async function handleCreateFromTemplate(templateCardId: string) {
    try {
      const created = await createCardFromTemplate(templateCardId)
      toast.success("Card created from template")
      await loadCards(created.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create card"
      toast.error(message)
    }
  }

  async function handleSaveSheet() {
    if (!userId) {
      toast.error("Sign in to save your card")
      return
    }

    setIsSavingSheet(true)
    try {
      let cardId = selectedCardId

      if (!cardId) {
        const created = await createCard({
          name: sheet.eventName.trim() || "Untitled card",
        })
        cardId = created.id
        setSelectedCardId(created.id)
      }

      const saved = await saveCardSheet(cardId, sheet)
      const savedSheet = toSheet(saved)
      setSheet(savedSheet)
      resetSheetRef.current = savedSheet
      localDraftRef.current.draftsByCardId[cardId] = savedSheet
      localDraftRef.current.unsavedSheet = null
      localDraftRef.current.selectedCardId = cardId
      writeLocalDraftState(localDraftRef.current)
      toast.success("Card saved")
      void loadCards(cardId)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save card"
      toast.error(message)
    } finally {
      setIsSavingSheet(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background print:bg-white">
      <div className="no-print pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(230,170,60,0.20),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(130,160,255,0.12),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_35%)]" />
      <PageHeader
        hasMatches={hasMatches}
        hasEventName={hasEventName}
        onImportClick={handleImportClick}
        onExport={handleExport}
        onReset={handleReset}
        onPrint={handlePrint}
        onSave={() => {
          void handleSaveSheet()
        }}
        isSaving={isSavingSheet}
        canSave={isAuthLoaded && Boolean(userId) && !isLoadingCards}
      />

      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
      />

      <main className="no-print relative z-10 mx-auto max-w-7xl px-4 py-6 lg:py-8">
        <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-24">
            <CardLibrary
              cards={cards}
              selectedCardId={selectedCardId}
              isLoading={isLoadingCards || isLoadingCard}
              isSyncingOverrides={isSyncingOverrides}
              onRefresh={() => {
                void loadCards()
              }}
              onSelectCard={(cardId) => {
                setSelectedCardId(cardId)
                setActiveTab("editor")
              }}
              onCreateFromTemplate={(templateCardId) => {
                void handleCreateFromTemplate(templateCardId)
              }}
            />
          </aside>

          <section className="rounded-2xl border border-border/70 bg-card/65 p-4 shadow-[0_24px_50px_rgba(0,0,0,0.28)] backdrop-blur lg:p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <TabsList className="bg-secondary/80">
                  <TabsTrigger
                    value="editor"
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                  >
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
                <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                  Match edits are local for now. Event details auto-sync to the selected card.
                </div>
              </div>

              <TabsContent value="editor" className="mt-0">
                {isLoadingCard ? (
                  <div className="rounded-lg border border-border bg-background/50 p-8 text-center text-muted-foreground">
                    Loading selected card...
                  </div>
                ) : (
                  <EditorView
                    sheet={sheet}
                    hasMatches={hasMatches}
                    onSheetChange={handleEventSettingsChange}
                    onAddMatch={addMatch}
                    onUpdateMatch={updateMatch}
                    onRemoveMatch={removeMatch}
                    onDuplicateMatch={duplicateMatch}
                    onMoveMatch={moveMatch}
                  />
                )}
              </TabsContent>

              <TabsContent value="preview" className="mt-0">
                <PreviewView
                  sheet={sheet}
                  hasMatches={hasMatches}
                  printRef={printRef}
                  onPrint={handlePrint}
                />
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </main>

      <div className="print-only-wrapper">
        <PrintSheet sheet={sheet} />
      </div>
    </div>
  )
}
