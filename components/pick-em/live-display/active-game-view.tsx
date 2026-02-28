"use client";

import React from "react";

import type { LiveGameStateResponse } from "@/lib/client/live-games-api";
import { LeaderboardPanel } from "@/components/pick-em/shared/leaderboard-panel";
import { UpdatesFeed } from "@/components/pick-em/shared/updates-feed";

interface ActiveGameViewProps {
  state: LiveGameStateResponse;
}

function ActiveGameViewInner({ state }: ActiveGameViewProps) {
  return (
    <div className="grid h-full gap-5 lg:grid-cols-[2fr_1fr]">
      <section className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl shadow-black/25 backdrop-blur">
        <LeaderboardPanel
          leaderboard={state.leaderboard}
          variant="display"
        />
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl shadow-black/25 backdrop-blur">
        <h2 className="mb-2 text-sm uppercase tracking-wide text-muted-foreground">
          Recent Updates
        </h2>
        <UpdatesFeed
          events={state.events}
          maxItems={8}
          variant="display"
        />
      </section>
    </div>
  );
}

export const ActiveGameView = React.memo(ActiveGameViewInner);
