"use client";

import React, { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { withSectionScores } from "@/lib/pick-em/section-utils";
import { LeaderboardPanel } from "@/components/pick-em/shared/leaderboard-panel";
import { ScoreBreakdown } from "@/components/pick-em/shared/score-breakdown";
import { UpdatesFeed } from "@/components/pick-em/shared/updates-feed";
import type { LiveGameStateResponse } from "@/lib/client/live-games-api";

interface PlayerSubmittedViewProps {
  state: LiveGameStateResponse;
  meNickname: string | null;
  myRank: { rank: number; score: number } | null;
  onEdit: () => void;
}

function PlayerSubmittedViewInner({
  state,
  meNickname,
  myRank,
  onEdit,
}: PlayerSubmittedViewProps) {
  const initialSelected = useMemo(
    () => (meNickname ? [meNickname] : []),
    [meNickname],
  );
  const [selected, setSelected] = useState<string[]>(initialSelected);

  const toggle = (nickname: string) => {
    setSelected((prev) =>
      prev.includes(nickname)
        ? prev.filter((n) => n !== nickname)
        : [...prev, nickname],
    );
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <h2 className="font-heading text-2xl font-semibold uppercase tracking-wide">
          Submitted — Watching Live
        </h2>
        {myRank ? (
          <div className="mt-3 inline-flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-5 py-2">
            <span className="font-heading text-xl">#{myRank.rank}</span>
            <span className="text-muted-foreground">|</span>
            <span className="font-mono text-xl font-semibold">
              {myRank.score} pts
            </span>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-border/70 bg-card/90 p-4">
        <h3 className="mb-2 font-semibold">Leaderboard</h3>
        <LeaderboardPanel
          leaderboard={withSectionScores(state.card, state.leaderboard)}
          variant="compact"
          onRowToggle={toggle}
          selectedNicknames={selected}
        />
      </div>

      <div className="rounded-xl border border-border/70 bg-card/90 p-4">
        <h3 className="mb-2 font-semibold">Your Score Breakdown</h3>
        <ScoreBreakdown
          card={state.card}
          leaderboard={state.leaderboard}
          selectedNicknames={selected}
          meNickname={meNickname}
        />
      </div>

      <div className="flex justify-center">
        <Button type="button" onClick={onEdit} variant="secondary">
          Edit answers
        </Button>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/90 p-4">
        <h3 className="mb-2 font-semibold">Updates</h3>
        <UpdatesFeed events={state.events} maxItems={12} variant="compact" />
      </div>
    </div>
  );
}

export const PlayerSubmittedView = React.memo(PlayerSubmittedViewInner);
