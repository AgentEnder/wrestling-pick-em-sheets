"use client";

import React from "react";

import type { LiveGameStateResponse } from "@/lib/client/live-games-api";

interface DisplayHeaderProps {
  state: LiveGameStateResponse;
  lobbyCountdownMs: number | null;
  lobbyStartAtLabel: string | null;
}

function formatCountdown(msRemaining: number): string {
  const totalMinutes = Math.max(0, Math.floor(msRemaining / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return `${days} days, ${hours} hours, ${minutes} minutes`;
}

function DisplayHeaderInner({
  state,
  lobbyCountdownMs,
  lobbyStartAtLabel,
}: DisplayHeaderProps) {
  return (
    <header className="mb-6 rounded-2xl border border-border/70 bg-card/90 p-5 shadow-xl shadow-black/25 backdrop-blur">
      <div className="lg:flex lg:items-end lg:justify-between lg:gap-6">
        <div>
          <p className="text-lg uppercase tracking-widest text-primary">
            {state.game.status === "lobby"
              ? "Live Lobby"
              : "Live Leaderboard"}
          </p>
          <h1 className="text-6xl font-heading font-semibold leading-tight">
            {state.card.eventName || "Untitled Event"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Join code{" "}
            <span className="font-mono text-2xl text-foreground">
              {state.game.joinCode}
            </span>
          </p>
          {state.game.status === "lobby" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {lobbyCountdownMs != null
                ? `Event starts in ${formatCountdown(lobbyCountdownMs)}${lobbyStartAtLabel ? ` (${lobbyStartAtLabel})` : ""}`
                : "Event start time not set"}
            </p>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm text-muted-foreground sm:mt-4 sm:max-w-xl lg:mt-0 lg:min-w-[460px]">
          <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-center">
            <p className="text-base uppercase tracking-wide">Players</p>
            <p className="text-3xl font-semibold text-foreground">
              {state.playerCount}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-center">
            <p className="text-base uppercase tracking-wide">Submitted</p>
            <p className="text-3xl font-semibold text-foreground">
              {state.submittedCount}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-center">
            <p className="text-base uppercase tracking-wide">Status</p>
            <p className="text-3xl font-semibold capitalize text-foreground">
              {state.game.status}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

export const DisplayHeader = React.memo(DisplayHeaderInner);
