"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createLiveGame,
  deleteLiveGame,
  listLiveGames,
  restoreLiveGame,
  updateLiveGameStatus,
} from "@/lib/client/live-games-api";
import type { LiveGame } from "@/lib/types";
import {
  ChevronDown,
  ChevronRight,
  MoreVertical,
  RefreshCcw,
  RotateCcw,
  Trash2,
  Tv,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { DeleteLiveGameDialog } from "./live-host/delete-live-game-dialog";

interface LiveGameHostAppProps {
  cardId: string;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function daysUntilPurge(deletedAt: string | null): number {
  if (!deletedAt) return 0;
  const cutoff = new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000;
  const remaining = Math.max(0, cutoff - Date.now());
  return Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

export function LiveGameHostApp({ cardId }: LiveGameHostAppProps) {
  const [games, setGames] = useState<LiveGame[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [endingGameId, setEndingGameId] = useState<string | null>(null);
  const [deletingCandidateId, setDeletingCandidateId] = useState<string | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletedGames, setDeletedGames] = useState<LiveGame[]>([]);
  const [isDeletedOpen, setIsDeletedOpen] = useState(false);
  const [hasLoadedDeleted, setHasLoadedDeleted] = useState(false);

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

  const loadDeletedGames = useCallback(async () => {
    try {
      const all = await listLiveGames(cardId, { includeDeleted: true });
      const onlyDeleted = all.filter((g) => g.deletedAt !== null);
      setDeletedGames(onlyDeleted);
      setHasLoadedDeleted(true);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load deleted games";
      toast.error(message);
    }
  }, [cardId]);

  function handleDeletedOpenChange(open: boolean) {
    setIsDeletedOpen(open);
    if (open && !hasLoadedDeleted) {
      void loadDeletedGames();
    }
  }

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

  async function handleRestore(gameId: string) {
    try {
      await restoreLiveGame(gameId);
      setDeletedGames((prev) => prev.filter((g) => g.id !== gameId));
      await loadGames();
      toast.success("Game restored");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to restore game";
      toast.error(message);
    }
  }

  async function handleDelete(gameId: string) {
    setIsDeleting(true);
    const snapshot = games;
    const deletedSnapshot = deletedGames;
    const target = games.find((g) => g.id === gameId);
    setGames((prev) => prev.filter((g) => g.id !== gameId));
    try {
      const nowIso = new Date().toISOString();
      await deleteLiveGame(gameId);
      if (target) {
        const optimistic: LiveGame = {
          ...target,
          deletedAt: nowIso,
          updatedAt: nowIso,
        };
        setDeletedGames((prev) => [optimistic, ...prev]);
        setHasLoadedDeleted(true);
      }
      toast.success("Game deleted", {
        action: {
          label: "Undo",
          onClick: () => void handleRestore(gameId),
        },
        duration: 8000,
      });
    } catch (error) {
      setGames(snapshot);
      setDeletedGames(deletedSnapshot);
      const message =
        error instanceof Error ? error.message : "Failed to delete game";
      toast.error(message);
    } finally {
      setIsDeleting(false);
      setDeletingCandidateId(null);
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Game actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={(event) => {
                            event.preventDefault();
                            setDeletingCandidateId(game.id);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete game
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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

      {(!hasLoadedDeleted || deletedGames.length > 0) && (
        <Collapsible
          open={isDeletedOpen}
          onOpenChange={handleDeletedOpenChange}
        >
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-start">
              {isDeletedOpen ? (
                <ChevronDown className="mr-2 h-4 w-4" />
              ) : (
                <ChevronRight className="mr-2 h-4 w-4" />
              )}
              Recently deleted
              {hasLoadedDeleted ? ` (${deletedGames.length})` : ""}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {deletedGames.length === 0 && hasLoadedDeleted ? (
              <p className="px-2 text-sm text-muted-foreground">
                No recently-deleted games.
              </p>
            ) : (
              deletedGames.map((game) => (
                <section
                  key={game.id}
                  className="rounded-lg border border-border bg-muted/40 p-3 opacity-80"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold">
                        {game.joinCode}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Deletes in {daysUntilPurge(game.deletedAt)} day(s)
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRestore(game.id)}
                    >
                      <RotateCcw className="mr-1 h-4 w-4" />
                      Restore
                    </Button>
                  </div>
                </section>
              ))
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      <DeleteLiveGameDialog
        open={deletingCandidateId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingCandidateId(null);
        }}
        onConfirm={() => {
          if (deletingCandidateId) void handleDelete(deletingCandidateId);
        }}
        isDeleting={isDeleting}
      />
    </div>
  );
}
