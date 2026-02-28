"use client";

import React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LivePlayerPicksPayload } from "@/lib/types";
import type { LiveGameMeResponse } from "@/lib/client/live-games-api";

interface PlayerTiebreakerInputProps {
  tiebreakerLabel: string;
  picks: LivePlayerPicksPayload;
  locks: LiveGameMeResponse["locks"];
  onSetTiebreakerAnswer: (answer: string) => void;
}

function PlayerTiebreakerInputInner({
  tiebreakerLabel,
  picks,
  locks,
  onSetTiebreakerAnswer,
}: PlayerTiebreakerInputProps) {
  if (!tiebreakerLabel.trim()) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <Label>{tiebreakerLabel}</Label>
      <Input
        className="mt-2"
        value={picks.tiebreakerAnswer}
        onChange={(event) => onSetTiebreakerAnswer(event.target.value)}
        disabled={locks.tiebreakerLocked}
        placeholder="Your tiebreaker answer"
      />
      {locks.tiebreakerLocked ? (
        <p className="mt-1 text-xs text-amber-500">Locked</p>
      ) : null}
    </section>
  );
}

export const PlayerTiebreakerInput = React.memo(PlayerTiebreakerInputInner);
