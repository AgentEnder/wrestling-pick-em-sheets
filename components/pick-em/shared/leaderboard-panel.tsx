"use client";

import React from "react";
import { Trophy } from "lucide-react";

import { getConnectionStatus } from "@/lib/client/connection-status";

interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  lastSeenAt: string;
}

interface LeaderboardPanelProps {
  leaderboard: LeaderboardEntry[];
  maxItems?: number;
  /** Variant controls visual density: "display" for TV-style, "compact" for player sidebar */
  variant?: "display" | "compact";
  /** When provided (compact variant only), rows become buttons that fire this callback with the row's nickname. */
  onRowToggle?: (nickname: string) => void;
  /** When provided alongside `onRowToggle`, rows whose nickname is in this list render in the selected visual state. */
  selectedNicknames?: string[];
}

function LeaderboardPanelInner({
  leaderboard,
  maxItems,
  variant = "compact",
  onRowToggle,
  selectedNicknames,
}: LeaderboardPanelProps) {
  const entries = maxItems ? leaderboard.slice(0, maxItems) : leaderboard;

  if (variant === "display") {
    return (
      <>
        <div className="grid grid-cols-[72px_1fr_170px_90px] gap-2 border-b border-border/70 pb-2 text-base uppercase tracking-wide text-muted-foreground">
          <span>Rank</span>
          <span>Player</span>
          <span>Status</span>
          <span className="text-right">Score</span>
        </div>
        <div className="mt-2 space-y-1">
          {entries.length > 0 ? (
            entries.map((entry) => {
              const presence = getConnectionStatus(entry.lastSeenAt);
              const dotClass =
                presence.state === "online"
                  ? "bg-emerald-500"
                  : presence.state === "idle"
                    ? "bg-amber-500"
                    : "bg-slate-400";

              return (
                <div
                  key={`${entry.rank}:${entry.nickname}`}
                  className="relative grid grid-cols-[72px_1fr_170px_90px] items-center gap-2 rounded-md border border-border/70 bg-background/45 px-3 py-2"
                >
                  {entry.rank === 1 ? (
                    <div className="absolute -left-2 -top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                      <Trophy className="mr-1 inline h-3 w-3" />
                      Leader
                    </div>
                  ) : null}
                  <span className="font-mono text-3xl font-semibold">
                    #{entry.rank}
                  </span>
                  <span className="truncate text-2xl">{entry.nickname}</span>
                  <div className="flex items-center gap-2 text-lg text-muted-foreground">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${dotClass}`}
                    />
                    <span className="capitalize">{presence.state}</span>
                    <span>{presence.ageLabel}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-4xl font-semibold">
                      {entry.score}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Waiting for submitted picks...
            </p>
          )}
        </div>
      </>
    );
  }

  // Compact variant (player sidebar)
  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        const presence = getConnectionStatus(entry.lastSeenAt);
        const dotClass =
          presence.state === "online"
            ? "bg-emerald-500"
            : presence.state === "idle"
              ? "bg-amber-500"
              : "bg-slate-400";
        const isSelected =
          selectedNicknames?.includes(entry.nickname) ?? false;
        const baseRowClass =
          "flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1 text-sm";
        const interactiveRowClass = `flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm transition-colors cursor-pointer ${
          isSelected
            ? "border-primary/60 bg-primary/10 ring-1 ring-primary/40"
            : "border-transparent"
        }`;

        const content = (
          <>
            <div className="min-w-0">
              <p className="truncate">
                #{entry.rank} {entry.nickname}
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                <span className="capitalize">{presence.state}</span>
                <span>{presence.ageLabel}</span>
              </div>
            </div>
            <div className="shrink-0">
              <span className="font-mono">{entry.score}</span>
            </div>
          </>
        );

        if (onRowToggle) {
          return (
            <button
              key={`${entry.rank}:${entry.nickname}`}
              type="button"
              onClick={() => onRowToggle(entry.nickname)}
              className={`${interactiveRowClass} w-full text-left`}
              aria-pressed={isSelected}
            >
              {content}
            </button>
          );
        }

        return (
          <div
            key={`${entry.rank}:${entry.nickname}`}
            className={baseRowClass}
          >
            {content}
          </div>
        );
      })}
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Leaderboard appears after submissions.
        </p>
      ) : null}
    </div>
  );
}

export const LeaderboardPanel = React.memo(LeaderboardPanelInner);
