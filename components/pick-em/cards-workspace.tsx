"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { SignInButton, SignedIn, SignedOut, UserButton, useAuth, useUser } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { AppNavbar } from "@/components/pick-em/app-navbar"
import { createCard, createCardFromTemplate, listCards, type CardSummary } from "@/lib/client/cards-api"
import type { PickEmSheet } from "@/lib/types"
import { ArrowRight, CalendarDays, FolderOpen, Plus, RefreshCcw, Sparkles, Swords, Users } from "lucide-react"
import { toast } from "sonner"

const ADMIN_EMAIL = "craigorycoppola@gmail.com"
const LOCAL_DRAFT_STORAGE_KEY = "pick-em-editor-draft-v2"

const INITIAL_LOCAL_SHEET: PickEmSheet = {
  eventName: "",
  promotionName: "",
  eventDate: "",
  eventTagline: "",
  defaultPoints: 1,
  tiebreakerLabel: "Main event total match time (mins)",
  tiebreakerIsTimeBased: true,
  matches: [],
  eventBonusQuestions: [],
}

interface LocalDraftState {
  draftsByCardId: Record<string, PickEmSheet>
  dirtyByCardId: Record<string, boolean>
}

function addLocalDraftCard(cardId: string, sheet: PickEmSheet) {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<LocalDraftState>) : {}
    const draftsByCardId =
      parsed.draftsByCardId && typeof parsed.draftsByCardId === "object" ? parsed.draftsByCardId : {}
    const dirtyByCardId =
      parsed.dirtyByCardId && typeof parsed.dirtyByCardId === "object" ? parsed.dirtyByCardId : {}

    draftsByCardId[cardId] = sheet
    dirtyByCardId[cardId] = false

    localStorage.setItem(
      LOCAL_DRAFT_STORAGE_KEY,
      JSON.stringify({
        draftsByCardId,
        dirtyByCardId,
      } satisfies LocalDraftState),
    )
  } catch {
    localStorage.setItem(
      LOCAL_DRAFT_STORAGE_KEY,
      JSON.stringify({
        draftsByCardId: {
          [cardId]: sheet,
        },
        dirtyByCardId: {
          [cardId]: false,
        },
      } satisfies LocalDraftState),
    )
  }
}

function formatDate(value: string): string {
  if (!value) return "Unknown update time"

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Unknown update time"
  return parsed.toLocaleString()
}

function toTimestamp(value: string): number {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 0
  return parsed.getTime()
}

export function CardsWorkspace() {
  const router = useRouter()
  const { userId, isLoaded: isAuthLoaded } = useAuth()
  const { user } = useUser()
  const [cards, setCards] = useState<CardSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreatingCard, setIsCreatingCard] = useState(false)
  const [isUsingTemplateId, setIsUsingTemplateId] = useState<string | null>(null)

  const ownedCards = useMemo(
    () => cards.filter((card) => Boolean(card.ownerId) && !card.isTemplate),
    [cards],
  )

  const publicTemplates = useMemo(
    () => cards.filter((card) => card.isTemplate && card.isPublic),
    [cards],
  )
  const recentOwnedCards = useMemo(
    () => [...ownedCards].sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt)),
    [ownedCards],
  )
  const recentTemplates = useMemo(
    () =>
      [...publicTemplates]
        .sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt))
        .slice(0, 6),
    [publicTemplates],
  )
  const isAdminUser = useMemo(() => {
    const emailAddresses = Array.isArray(user?.emailAddresses) ? user.emailAddresses : []
    const primary =
      emailAddresses.find((email) => email.id === user?.primaryEmailAddressId) ??
      emailAddresses[0]

    const email = primary?.emailAddress?.trim().toLowerCase()
    return email === ADMIN_EMAIL
  }, [user])

  const loadCards = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await listCards()
      setCards(data)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load cards"
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCards()
  }, [loadCards])

  async function handleCreateCard() {
    setIsCreatingCard(true)
    try {
      if (userId) {
        const created = await createCard({
          name: "Untitled card",
        })
        router.push(`/cards/${created.id}`)
        return
      }

      const localCardId = `local-${crypto.randomUUID()}`
      addLocalDraftCard(localCardId, INITIAL_LOCAL_SHEET)
      router.push(`/cards/${localCardId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create card"
      toast.error(message)
    } finally {
      setIsCreatingCard(false)
    }
  }

  async function handleUseTemplate(templateCardId: string) {
    if (!userId) {
      toast.error("Sign in to create a card from a template")
      return
    }

    setIsUsingTemplateId(templateCardId)
    try {
      const created = await createCardFromTemplate(templateCardId)
      router.push(`/cards/${created.id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create card from template"
      toast.error(message)
    } finally {
      setIsUsingTemplateId(null)
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(230,170,60,0.20),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(130,160,255,0.12),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_35%)]" />
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
              <Swords className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="font-[family-name:var(--font-heading)] text-xl font-bold uppercase tracking-wider text-foreground leading-tight">
                Pick Em Workspace
              </h1>
              <p className="text-sm text-muted-foreground leading-tight">
                Create cards and browse templates before editing
              </p>
            </div>
          </Link>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <AppNavbar isAdminUser={isAdminUser} />
            <Button variant="outline" size="sm" onClick={() => void loadCards()} disabled={isLoading}>
              <RefreshCcw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <SignedOut>
              <SignInButton mode="modal">
                <Button variant="outline" size="sm">
                  Sign in
                </Button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:py-8">
        <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Card className="border-border/70 bg-card/70 shadow-[0_20px_40px_rgba(0,0,0,0.25)] backdrop-blur">
            <CardHeader className="gap-4">
              <div>
                <CardTitle className="text-xl">Start Here</CardTitle>
                <CardDescription className="mt-1">
                  Jump back into editing, join a live room, or spin up a new card.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    void handleCreateCard()
                  }}
                  disabled={isCreatingCard}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {isCreatingCard ? "Creating..." : "New Card"}
                </Button>
                <Button asChild variant="secondary">
                  <Link href="/join">
                    <Users className="h-4 w-4 mr-1" />
                    Join Live Game
                  </Link>
                </Button>
              </div>
            </CardHeader>
          </Card>

          <Card className="border-border/70 bg-card/70 shadow-[0_20px_40px_rgba(0,0,0,0.25)] backdrop-blur">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
                Workspace Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Your cards</p>
                <p className="text-lg font-semibold">{ownedCards.length}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Templates</p>
                <p className="text-lg font-semibold">{publicTemplates.length}</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="border-border/70 bg-card/70 shadow-[0_20px_40px_rgba(0,0,0,0.25)] backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-primary" />
                Continue Editing
              </CardTitle>
              <CardDescription>
                {ownedCards.length} saved card{ownedCards.length === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentOwnedCards.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                  Create your first card to start editing.
                </p>
              ) : (
                recentOwnedCards.map((card) => (
                  <div
                    key={card.id}
                    className="rounded-md border border-border/80 bg-background/45 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{card.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Updated {formatDate(card.updatedAt)}
                        </p>
                      </div>
                      <Button asChild size="sm" variant="secondary">
                        <Link href={`/cards/${card.id}`}>
                          Edit
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="border-border/70 bg-card/70 shadow-[0_20px_40px_rgba(0,0,0,0.25)] backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Start From Template
              </CardTitle>
              <CardDescription>
                Pick a template and create a fresh card from it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentTemplates.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                  No templates are currently available.
                </p>
              ) : (
                recentTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="rounded-md border border-border/80 bg-background/45 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{template.name}</p>
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarDays className="h-3 w-3" />
                          Updated {formatDate(template.updatedAt)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!isAuthLoaded || !userId || isUsingTemplateId === template.id}
                        onClick={() => {
                          void handleUseTemplate(template.id)
                        }}
                      >
                        {isUsingTemplateId === template.id ? "Using..." : "Use Template"}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
            {publicTemplates.length > 6 ? (
              <CardFooter className="border-t border-border/70 text-xs text-muted-foreground">
                Showing the 6 most recently updated templates.
              </CardFooter>
            ) : null}
          </Card>
        </section>
      </main>
    </div>
  )
}
