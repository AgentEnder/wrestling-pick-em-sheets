"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNavbar } from "@/components/pick-em/app-navbar";
import { Button } from "@/components/ui/button";
import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
} from "@/lib/client/clerk-test-mode";
import { listCards, type CardSummary } from "@/lib/client/cards-api";
import { fetchMyGames, type MyActiveGame } from "@/lib/client/my-games-api";
import { ArrowRight, FolderOpen, Swords, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const ADMIN_EMAIL = "craigorycoppola@gmail.com";

function toTimestamp(value: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  return parsed.getTime();
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown update time";
  return parsed.toLocaleString();
}

export function HomeHub() {
  const { user } = useUser();
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeGames, setActiveGames] = useState<MyActiveGame[]>([]);

  const isAdminUser = useMemo(() => {
    const emailAddresses = Array.isArray(user?.emailAddresses)
      ? user.emailAddresses
      : [];
    const primary =
      emailAddresses.find(
        (email) => email.id === user?.primaryEmailAddressId,
      ) ?? emailAddresses[0];

    const email = primary?.emailAddress?.trim().toLowerCase();
    return email === ADMIN_EMAIL;
  }, [user]);

  const accountLabel = useMemo(() => {
    if (!user) return null;

    const fullName = user.fullName?.trim();
    if (fullName) return fullName;

    const username = user.username?.trim();
    if (username) return username;

    return user.primaryEmailAddress?.emailAddress ?? null;
  }, [user]);

  const loadCards = useCallback(async () => {
    setIsLoading(true);
    try {
      const loaded = await listCards();
      setCards(loaded);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load cards";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  useEffect(() => {
    if (!user) return;
    void fetchMyGames()
      .then((data) => setActiveGames(data.activeGames))
      .catch(() => {});
  }, [user]);

  const lastEditedCard = useMemo(
    () =>
      cards
        .filter((card) => Boolean(card.ownerId) && !card.isTemplate)
        .sort(
          (a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt),
        )[0] ?? null,
    [cards],
  );

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(230,170,60,0.20),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(130,160,255,0.12),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_35%)]" />
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
              <Swords className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="font-[family-name:var(--font-heading)] text-xl font-bold uppercase tracking-wider text-foreground leading-tight">
                Pick Em Hub
              </h1>
              <p className="text-sm text-muted-foreground leading-tight">
                Join live rooms fast and manage your workspace
              </p>
            </div>
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <AppNavbar isAdminUser={isAdminUser} />
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

      <main className="relative z-10 mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-border/70 bg-card/75 p-5 shadow-[0_20px_40px_rgba(0,0,0,0.25)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.18em] text-primary">
            Live Rooms
          </p>
          <h2 className="mt-2 text-3xl font-semibold leading-tight">
            Join A Running Game
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter a room code or scan the TV QR code to jump into picks
            immediately.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Link
              href="/join"
              className="group rounded-2xl border border-primary/40 bg-primary/10 p-5 transition-colors hover:bg-primary/15"
            >
              <div className="flex items-center justify-between">
                <Users className="h-6 w-6 text-primary" />
                <ArrowRight className="h-5 w-5 text-primary transition-transform group-hover:translate-x-1" />
              </div>
              <p className="mt-4 text-xl font-semibold">Join Live Game</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Use a join code on your phone.
              </p>
            </Link>
            <Link
              href="/cards"
              className="group rounded-2xl border border-border/70 bg-background/45 p-5 transition-colors hover:bg-background/60"
            >
              <div className="flex items-center justify-between">
                <FolderOpen className="h-6 w-6 text-foreground" />
                <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </div>
              <p className="mt-4 text-xl font-semibold">Cards Workspace</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create cards, templates, and host rooms.
              </p>
            </Link>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-[0_20px_40px_rgba(0,0,0,0.25)] backdrop-blur">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Account
            </p>
            <SignedIn>
              <p className="mt-2 text-sm">
                Signed in as{" "}
                <span className="font-medium">
                  {accountLabel ?? "Unknown user"}
                </span>
              </p>
            </SignedIn>
            <SignedOut>
              <p className="mt-2 text-sm text-muted-foreground">
                You can join as guest, or sign in for account-linked joins.
              </p>
              <SignInButton mode="modal">
                <Button variant="outline" size="sm" className="mt-3">
                  Sign in to continue
                </Button>
              </SignInButton>
            </SignedOut>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-[0_20px_40px_rgba(0,0,0,0.25)] backdrop-blur">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Last Edited Card
            </p>
            {isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Loading cards...
              </p>
            ) : lastEditedCard ? (
              <div className="mt-2">
                <p className="font-medium">{lastEditedCard.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Updated {formatDate(lastEditedCard.updatedAt)}
                </p>
                <Button asChild size="sm" variant="secondary" className="mt-3">
                  <Link href={`/cards/${lastEditedCard.id}`}>Open Card</Link>
                </Button>
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-sm text-muted-foreground">
                  No saved cards yet.
                </p>
                <Button asChild size="sm" variant="secondary" className="mt-3">
                  <Link href="/cards">Go To Cards</Link>
                </Button>
              </div>
            )}
          </div>

          {activeGames.length > 0 && (
            <div className="rounded-2xl border border-border/70 bg-card/75 p-5 shadow-[0_20px_40px_rgba(0,0,0,0.25)] backdrop-blur">
              <h3 className="mb-3 text-xs uppercase tracking-[0.18em] text-primary">
                Active Games
              </h3>
              <div className="flex flex-col gap-2">
                {activeGames.slice(0, 3).map((game) => (
                  <Link
                    key={game.gameId}
                    href={`/games/${game.gameId}/play?code=${encodeURIComponent(game.joinCode)}`}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {game.eventName || game.cardName}
                      </p>
                      {game.promotionName && (
                        <p className="truncate text-xs text-muted-foreground">
                          {game.promotionName}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={
                        game.status === "live" ? "default" : "secondary"
                      }
                      className="ml-2 shrink-0"
                    >
                      {game.status === "live" ? "Live" : "Lobby"}
                    </Badge>
                  </Link>
                ))}
              </div>
              {activeGames.length > 3 && (
                <Link
                  href="/my-games"
                  className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View all games
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
              <Link
                href="/my-games"
                className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                View game history
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
