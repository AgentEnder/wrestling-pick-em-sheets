"use client";

import React from "react";
import { Trophy } from "lucide-react";

import type { LiveGameStateResponse } from "@/lib/client/live-games-api";
import { LeaderboardPanel } from "@/components/pick-em/shared/leaderboard-panel";

interface PlayerEndedViewProps {
  state: LiveGameStateResponse;
  myRank: { rank: number; score: number } | null;
}

function PlayerEndedViewInner({ state, myRank }: PlayerEndedViewProps) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="text-center">
        <Trophy className="mx-auto h-12 w-12 text-primary" />
        <h2 className="mt-3 font-heading text-3xl font-semibold uppercase tracking-wide">
          Game Over
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.card.eventName || "Event"} has ended
        </p>
        {myRank ? (
          <div className="mt-4 inline-flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-6 py-3">
            <span className="font-heading text-2xl">#{myRank.rank}</span>
            <span className="text-muted-foreground">|</span>
            <span className="font-mono text-2xl font-semibold">
              {myRank.score} pts
            </span>
          </div>
        ) : null}
      </div>
      <div className="w-full rounded-xl border border-border/70 bg-card/90 p-4 shadow-lg shadow-black/20 backdrop-blur">
        <h3 className="mb-2 font-semibold">Final Leaderboard</h3>
        <LeaderboardPanel
          leaderboard={state.leaderboard}
          variant="compact"
        />
      </div>
    </div>
  );
}

export const PlayerEndedView = React.memo(PlayerEndedViewInner);
