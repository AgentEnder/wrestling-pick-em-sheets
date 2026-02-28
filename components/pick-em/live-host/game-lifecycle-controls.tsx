"use client";

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useLiveCard, useLiveGames } from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import { updateLiveGameStatus } from "@/lib/client/live-games-api";
import { updateCardOverrides } from "@/lib/client/cards-api";

/* ---- Helpers ---- */

function isoToDatetimeLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const tzOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function datetimeLocalInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/* ---- Props ---- */

interface GameLifecycleControlsProps {
  gameId: string;
}

/* ---- Component ---- */

function GameLifecycleControlsInner({ gameId }: GameLifecycleControlsProps) {
  const card = useLiveCard();
  const games = useLiveGames();

  const game = games.find((g) => g.id === gameId);

  const [isEndingGame, setIsEndingGame] = useState(false);
  const [isStatusSaving, setIsStatusSaving] = useState(false);
  const [eventStartInput, setEventStartInput] = useState("");

  useEffect(() => {
    setEventStartInput(isoToDatetimeLocalInput(card?.eventDate ?? null));
  }, [card?.eventDate]);

  const handleStartGame = useCallback(async () => {
    if (!game) return;
    setIsStatusSaving(true);
    try {
      const updated = await updateLiveGameStatus(gameId, "live", {
        allowLateJoins: game.allowLateJoins,
      });
      useAppStore.getState().setGames([updated]);
      toast.success("Game started");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start game";
      toast.error(message);
    } finally {
      setIsStatusSaving(false);
    }
  }, [game, gameId]);

  const handleEndGame = useCallback(async () => {
    setIsEndingGame(true);
    try {
      const updated = await updateLiveGameStatus(gameId, "ended");
      useAppStore.getState().setGames([updated]);
      toast.success("Game ended");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update status";
      toast.error(message);
    } finally {
      setIsEndingGame(false);
    }
  }, [gameId]);

  const handleAllowLateJoinsChange = useCallback(
    async (allowLateJoins: boolean) => {
      if (!game || game.status === "ended") return;
      setIsStatusSaving(true);
      try {
        const updated = await updateLiveGameStatus(gameId, game.status, {
          allowLateJoins,
        });
        useAppStore.getState().setGames([updated]);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update entry settings";
        toast.error(message);
      } finally {
        setIsStatusSaving(false);
      }
    },
    [game, gameId],
  );

  const handleSaveEventStartTime = useCallback(
    async (forceEventStartAt?: string | null) => {
      if (!game || game.status === "ended") return;
      const eventStartAt =
        typeof forceEventStartAt === "undefined"
          ? datetimeLocalInputToIso(eventStartInput)
          : forceEventStartAt;
      if (
        typeof forceEventStartAt === "undefined" &&
        eventStartInput.trim() &&
        !eventStartAt
      ) {
        toast.error("Invalid start date/time");
        return;
      }
      setIsStatusSaving(true);
      try {
        await updateCardOverrides(game.cardId, { eventDate: eventStartAt });
        const state = useAppStore.getState();
        if (state.liveCard) {
          state.setLiveCard({
            ...state.liveCard,
            eventDate: eventStartAt ?? "",
          });
        }
        toast.success(
          eventStartAt ? "Start time saved" : "Start time cleared",
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update start time";
        toast.error(message);
      } finally {
        setIsStatusSaving(false);
      }
    },
    [game, eventStartInput],
  );

  if (!game) return null;

  return (
    <>
      {/* Start / End game buttons — rendered inline by parent header */}
      <div className="flex flex-wrap items-center gap-2">
        {game.status === "lobby" ? (
          <Button
            onClick={() => void handleStartGame()}
            disabled={isStatusSaving}
          >
            {isStatusSaving ? "Starting..." : "Start Game"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={game.status === "ended" || isEndingGame || isStatusSaving}
          onClick={() => void handleEndGame()}
        >
          {game.status === "ended"
            ? "Ended"
            : isEndingGame
              ? "Ending..."
              : "End Game"}
        </Button>
      </div>

      {/* Mid-game entries */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-medium">Mid-Game Entries</p>
            <p className="text-xs text-muted-foreground">
              Allow new players to join after the game has started.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {game.allowLateJoins ? "Allowed" : "Closed"}
            </span>
            <Switch
              checked={game.allowLateJoins}
              onCheckedChange={(checked) => {
                void handleAllowLateJoinsChange(checked);
              }}
              disabled={game.status === "ended" || isStatusSaving}
            />
          </div>
        </div>
      </section>

      {/* Scheduled start */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="space-y-3">
          <div>
            <p className="font-medium">Scheduled Start</p>
            <p className="text-xs text-muted-foreground">
              Room auto-starts when this time is reached.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Input
              type="datetime-local"
              value={eventStartInput}
              onChange={(event) => setEventStartInput(event.target.value)}
              disabled={game.status === "ended" || isStatusSaving}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEventStartInput("");
                void handleSaveEventStartTime(null);
              }}
              disabled={game.status === "ended" || isStatusSaving}
            >
              Clear
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveEventStartTime()}
              disabled={game.status === "ended" || isStatusSaving}
            >
              {isStatusSaving ? "Saving..." : "Save Start"}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

export const GameLifecycleControls = React.memo(GameLifecycleControlsInner);
