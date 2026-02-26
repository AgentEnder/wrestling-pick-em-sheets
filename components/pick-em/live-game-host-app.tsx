"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  createLiveGame,
  listLiveGames,
  updateLiveGameStatus,
} from "@/lib/client/live-games-api";
import type { LiveGame } from "@/lib/types";
import { RefreshCcw, Tv, Users } from "lucide-react";
import { toast } from "sonner";

interface LiveGameHostAppProps {
  cardId: string;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function LiveGameHostApp({ cardId }: LiveGameHostAppProps) {
  const [games, setGames] = useState<LiveGame[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [endingGameId, setEndingGameId] = useState<string | null>(null);

  const loadGames = useCallback(async () => {
    setIsLoading(true);
    try {
      const loaded = await listLiveGames(cardId);
      setGames(loaded);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load live games";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  async function handleCreateGame() {
    setIsCreating(true);
    try {
      const created = await createLiveGame(cardId);
      setGames((prev) => [created.game, ...prev]);
      toast.success("Live game created");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create game";
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleEndGame(gameId: string) {
    setEndingGameId(gameId);
    try {
      const updated = await updateLiveGameStatus(gameId, "ended");
      setGames((prev) =>
        prev.map((game) => (game.id === gameId ? updated : game)),
      );
      toast.success("Game ended");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update status";
      toast.error(message);
    } finally {
      setEndingGameId(null);
    }
  }

  const activeCount = useMemo(
    () => games.filter((game) => game.status !== "ended").length,
    [games],
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <header className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Live Game Rooms</h1>
            <p className="text-sm text-muted-foreground">
              Manage room-owned game keys, join codes, and display screens.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline">
              <Link href={`/cards/${cardId}/live/solo`}>Solo Key</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => void loadGames()}
              disabled={isLoading}
            >
              <RefreshCcw className="mr-1 h-4 w-4" />
              {isLoading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button
              onClick={() => void handleCreateGame()}
              disabled={isCreating}
            >
              {isCreating ? "Creating..." : "Create Game"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {activeCount} active game{activeCount === 1 ? "" : "s"}
        </p>
      </header>

      {games.length === 0 ? (
        <section className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No live game rooms yet.
        </section>
      ) : (
        <div className="grid gap-3">
          {games.map((game) => {
            const secretSuffix = game.qrJoinSecret
              ? `&s=${encodeURIComponent(game.qrJoinSecret)}`
              : "";
            const joinUrl = `/join?code=${encodeURIComponent(game.joinCode)}${secretSuffix}`;
            const displayUrl = `/games/${game.id}/display?code=${encodeURIComponent(game.joinCode)}${secretSuffix}`;

            return (
              <section
                key={game.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Join code
                    </p>
                    <p className="font-mono text-2xl font-semibold tracking-wider">
                      {game.joinCode}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Updated {formatDate(game.updatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Button asChild size="sm">
                      <Link href={`/games/${game.id}/host`}>Host Keying</Link>
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={
                        game.status === "ended" || endingGameId === game.id
                      }
                      onClick={() => void handleEndGame(game.id)}
                    >
                      {game.status === "ended"
                        ? "Ended"
                        : endingGameId === game.id
                          ? "Ending..."
                          : "End Game"}
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={joinUrl}>
                      <Users className="mr-1 h-4 w-4" />
                      Join Page
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={displayUrl}>
                      <Tv className="mr-1 h-4 w-4" />
                      Display
                    </Link>
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
