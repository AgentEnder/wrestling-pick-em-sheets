"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  Bell,
  BellOff,
  Maximize2,
  Minimize2,
  Save,
  Tv,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LiveGameMeResponse, LiveGameStateResponse } from "@/lib/client/live-games-api";

interface PlayerHeaderProps {
  gameId: string;
  joinCodeFromUrl?: string | null;
  state: LiveGameStateResponse;
  me: LiveGameMeResponse;
  myRank: { rank: number; score: number } | null;
  lobbyCountdownMs: number | null;
  lobbyStartAtLabel: string | null;
  isSaving: boolean;
  isPageFullscreen: boolean;
  isWakeLockActive: boolean;
  wakeLockSupported: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  isPushSubscribed: boolean;
  isPushSubscribing: boolean;
  onSave: () => void;
  onToggleFullscreen: () => void;
  onToggleWakeLock: () => void;
  onEnableNotifications: () => void;
  onOpenPushPrompt: () => void;
}

function formatCountdown(msRemaining: number): string {
  const totalMinutes = Math.max(0, Math.floor(msRemaining / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return `${days} days, ${hours} hours, ${minutes} minutes`;
}

function PlayerHeaderInner({
  gameId,
  joinCodeFromUrl,
  state,
  me,
  myRank,
  lobbyCountdownMs,
  lobbyStartAtLabel,
  isSaving,
  isPageFullscreen,
  isWakeLockActive,
  wakeLockSupported,
  notificationPermission,
  isPushSubscribed,
  isPushSubscribing,
  onSave,
  onToggleFullscreen,
  onToggleWakeLock,
  onEnableNotifications,
  onOpenPushPrompt,
}: PlayerHeaderProps) {
  const displayHref = useMemo(
    () =>
      `/games/${gameId}/display?code=${encodeURIComponent(state.game.joinCode ?? joinCodeFromUrl ?? "")}`,
    [gameId, joinCodeFromUrl, state.game.joinCode],
  );

  return (
    <header className="rounded-xl border border-border/70 bg-card/90 p-4 shadow-lg shadow-black/20 backdrop-blur">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-heading font-semibold">
            {state.card.eventName || "Live Game"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Playing as{" "}
            <span className="font-semibold text-foreground">
              {me.player.nickname}
            </span>{" "}
            • code <span className="font-mono">{state.game.joinCode}</span>
          </p>
          {myRank ? (
            <p className="text-xs text-muted-foreground">
              Current rank: #{myRank.rank} ({myRank.score} pts)
            </p>
          ) : null}
          {state.game.status === "lobby" ? (
            <p className="text-xs text-muted-foreground">
              {lobbyCountdownMs != null
                ? `Event starts in ${formatCountdown(lobbyCountdownMs)}${lobbyStartAtLabel ? ` (${lobbyStartAtLabel})` : ""}`
                : "Event start time not set"}
            </p>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Button onClick={onSave} disabled={isSaving}>
            <Save className="mr-1 h-4 w-4" />
            {isSaving ? "Saving..." : "Save Picks"}
          </Button>
          <Button variant="outline" onClick={onToggleFullscreen}>
            {isPageFullscreen ? (
              <Minimize2 className="mr-1 h-4 w-4" />
            ) : (
              <Maximize2 className="mr-1 h-4 w-4" />
            )}
            {isPageFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </Button>
          <Button
            variant="outline"
            onClick={onToggleWakeLock}
            disabled={!wakeLockSupported}
          >
            <Zap className="mr-1 h-4 w-4" />
            {isWakeLockActive ? "Wake Lock On" : "Keep Screen Awake"}
          </Button>
          {notificationPermission === "granted" && isPushSubscribed ? (
            <Button variant="outline" disabled>
              <BellOff className="mr-1 h-4 w-4" />
              Alerts Enabled
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                if (notificationPermission === "default") {
                  onOpenPushPrompt();
                  return;
                }
                onEnableNotifications();
              }}
              disabled={
                notificationPermission === "unsupported" || isPushSubscribing
              }
            >
              <Bell className="mr-1 h-4 w-4" />
              {isPushSubscribing ? "Enabling..." : "Enable Alerts"}
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={displayHref} target="_blank" rel="noreferrer">
              <Tv className="mr-1 h-4 w-4" />
              TV Display
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

export const PlayerHeader = React.memo(PlayerHeaderInner);
