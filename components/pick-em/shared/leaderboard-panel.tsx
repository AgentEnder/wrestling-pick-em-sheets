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
}

function LeaderboardPanelInner({
  leaderboard,
  maxItems,
  variant = "compact",
}: LeaderboardPanelProps) {
  const entries = maxItems ? leaderboard.slice(0, maxItems) : leaderboard;

  if (variant === "display") {
    return (
      <>
        <div className="grid grid-cols-[72px_1fr_170px_90px] gap-2 border-b border-border/70 pb-2 text-sm uppercase tracking-wide text-muted-foreground">
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
                  <span className="font-mono text-2xl font-semibold">
                    #{entry.rank}
                  </span>
                  <span className="truncate text-xl">{entry.nickname}</span>
                  <div className="flex items-center gap-2 text-base text-muted-foreground">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${dotClass}`}
                    />
                    <span className="capitalize">{presence.state}</span>
                    <span>{presence.ageLabel}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-3xl font-semibold">
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
        return (
          <div
            key={`${entry.rank}:${entry.nickname}`}
            className="flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1 text-sm"
          >
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
