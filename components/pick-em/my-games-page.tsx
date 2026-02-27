"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Gamepad2, History, Swords, Trophy } from "lucide-react";
import { toast } from "sonner";

import { AppNavbar } from "@/components/pick-em/app-navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  useAuth,
  useUser,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from "@/lib/client/clerk-test-mode";
import {
  fetchMyGames,
  type MyActiveGame,
  type MyCompletedGame,
  type MyGamesStats,
} from "@/lib/client/my-games-api";

const ADMIN_EMAIL = "craigorycoppola@gmail.com";

export function MyGamesPage() {
  const { isLoaded: isAuthLoaded } = useAuth();
  const { user } = useUser();

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

  const [activeGames, setActiveGames] = useState<MyActiveGame[]>([]);
  const [completedGames, setCompletedGames] = useState<MyCompletedGame[]>([]);
  const [stats, setStats] = useState<MyGamesStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadGames = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchMyGames();
      setActiveGames(data.activeGames);
      setCompletedGames(data.completedGames);
      setStats(data.stats);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load games",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthLoaded && user) {
      void loadGames();
    }
  }, [isAuthLoaded, user, loadGames]);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      {/* Gradient overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(circle at 10% 0%, rgba(230,170,60,0.20), transparent 35%), radial-gradient(circle at 90% 100%, rgba(59,130,246,0.10), transparent 35%)",
        }}
      />

      {/* Sticky header */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-primary" />
              <span className="font-[family-name:var(--font-heading)] text-lg font-bold tracking-wide">
                Pick Em Sheets
              </span>
            </Link>
            <AppNavbar isAdminUser={isAdminUser} />
          </div>
          <div className="flex items-center gap-2">
            <SignedOut>
              <SignInButton mode="modal">
                <Button size="sm" variant="outline">
                  Sign in
                </Button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:py-8">
        <div className="flex items-center gap-3">
          <Trophy className="h-6 w-6 text-primary" />
          <h1 className="font-[family-name:var(--font-heading)] text-2xl font-bold tracking-wide">
            My Games
          </h1>
        </div>

        {!isAuthLoaded || isLoading ? (
          <p className="text-sm text-muted-foreground">Loading games...</p>
        ) : !user ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">
                Sign in to see your game history.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Stats bar */}
            {stats && stats.gamesPlayed > 0 && <StatsBar stats={stats} />}

            {/* Trend chart */}
            {stats && stats.trendData.length > 1 && (
              <TrendChart data={stats.trendData} />
            )}

            {/* Active games */}
            {activeGames.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary">
                  <Gamepad2 className="h-4 w-4" />
                  Active Games
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {activeGames.map((game) => (
                    <ActiveGameCard key={game.gameId} game={game} />
                  ))}
                </div>
              </section>
            )}

            {/* History */}
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary">
                <History className="h-4 w-4" />
                History
              </h2>
              {completedGames.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No completed games yet. Join a live game to get started!
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {completedGames.map((game) => (
                    <CompletedGameCard key={game.gameId} game={game} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

/* ── Stub sub-components (replaced in later tasks) ── */

function StatsBar({ stats }: { stats: MyGamesStats }) {
  return <div>Stats: {stats.gamesPlayed} games</div>;
}

function TrendChart({ data }: { data: MyGamesStats["trendData"] }) {
  return <div>Trend chart ({data.length} points)</div>;
}

function ActiveGameCard({ game }: { game: MyActiveGame }) {
  return <div>{game.eventName || game.cardName}</div>;
}

function CompletedGameCard({ game }: { game: MyCompletedGame }) {
  return <div>{game.eventName || game.cardName}</div>;
}
