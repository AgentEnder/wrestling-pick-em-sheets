"use client";

import React from "react";
import { Trophy } from "lucide-react";

import type { LiveGameStateResponse } from "@/lib/client/live-games-api";
import { LeaderboardPanel } from "@/components/pick-em/shared/leaderboard-panel";

interface EndedViewProps {
  state: LiveGameStateResponse;
}

function EndedViewInner({ state }: EndedViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-center">
        <Trophy className="mx-auto h-16 w-16 text-primary" />
        <h2 className="mt-4 font-heading text-5xl font-semibold uppercase tracking-wide">
          Final Standings
        </h2>
        <p className="mt-2 text-lg text-muted-foreground">
          {state.card.eventName || "Event"} has ended
        </p>
      </div>
      <div className="w-full max-w-3xl rounded-2xl border border-border/70 bg-card/90 p-6 shadow-xl shadow-black/25 backdrop-blur">
        <LeaderboardPanel
          leaderboard={state.leaderboard}
          variant="display"
        />
      </div>
    </div>
  );
}

export const EndedView = React.memo(EndedViewInner);
