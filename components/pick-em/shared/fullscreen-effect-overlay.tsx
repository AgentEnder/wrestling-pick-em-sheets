"use client";

import React from "react";
import { Reorder } from "motion/react";
import { Sparkles, Trophy } from "lucide-react";

import type {
  FullscreenEffect,
} from "@/hooks/use-fullscreen-effects";
import { formatEventTypeLabel } from "@/lib/pick-em/text-utils";
import { cn } from "@/lib/utils";

interface FullscreenEffectOverlayProps {
  activeEffect: FullscreenEffect | null;
  animatedLeaderboardOrder: string[];
  onDismiss: () => void;
}

function FullscreenEffectOverlayInner({
  activeEffect,
  animatedLeaderboardOrder,
  onDismiss,
}: FullscreenEffectOverlayProps) {
  if (!activeEffect) return null;

  return (
    <div
      className={cn(
        "lg-fullscreen-effect",
        activeEffect.kind === "events"
          ? "lg-fullscreen-effect-events"
          : "lg-fullscreen-effect-leaderboard",
      )}
      onClick={onDismiss}
    >
      {activeEffect.kind === "events" ? (
        <div className="lg-fullscreen-effect-panel">
          <div className="lg-fullscreen-effect-title">
            <Sparkles className="h-6 w-6" />
            <span className="font-heading text-3xl uppercase tracking-wide">
              Live Results
            </span>
          </div>
          <div className="lg-fullscreen-effect-body">
            {activeEffect.events.map((event, index) => (
              <div
                key={event.id}
                className="lg-fullscreen-event-item"
                style={{ animationDelay: `${index * 110}ms` }}
              >
                <p className="text-sm uppercase tracking-wide text-primary/90">
                  {formatEventTypeLabel(event.type)}
                </p>
                <p className="text-lg text-foreground">{event.message}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <LeaderboardShiftPanel
          activeEffect={activeEffect}
          animatedLeaderboardOrder={animatedLeaderboardOrder}
        />
      )}
    </div>
  );
}

interface LeaderboardShiftPanelProps {
  activeEffect: Extract<FullscreenEffect, { kind: "leaderboard" }>;
  animatedLeaderboardOrder: string[];
}

function LeaderboardShiftPanel({
  activeEffect,
  animatedLeaderboardOrder,
}: LeaderboardShiftPanelProps) {
  const currentByNickname = new Map(
    activeEffect.current.map((entry) => [entry.nickname, entry]),
  );
  const previousByNickname = new Map(
    activeEffect.previous.map((entry) => [entry.nickname, entry]),
  );
  const order =
    animatedLeaderboardOrder.length > 0
      ? animatedLeaderboardOrder
      : activeEffect.previous.map((entry) => entry.nickname);

  return (
    <div className="lg-fullscreen-effect-panel">
      <div className="lg-fullscreen-effect-title">
        <Trophy className="h-6 w-6" />
        <span className="font-heading text-3xl uppercase tracking-wide">
          Leaderboard Shift
        </span>
      </div>
      <div className="lg-fullscreen-effect-body">
        <Reorder.Group
          axis="y"
          values={order}
          onReorder={() => {}}
          className="lg-fullscreen-reorder-list"
        >
          {order.map((nickname) => {
            const entry = currentByNickname.get(nickname);
            if (!entry) return null;
            const previousRank =
              previousByNickname.get(nickname)?.rank ?? null;
            const rankDelta =
              previousRank == null ? 0 : previousRank - entry.rank;

            return (
              <Reorder.Item
                key={`fullscreen-lb-${nickname}`}
                value={nickname}
                className="lg-fullscreen-leaderboard-row"
                transition={{
                  duration: 0.9,
                  ease: [0.2, 0.8, 0.2, 1],
                }}
              >
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">
                    #{entry.rank} {entry.nickname}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {previousRank == null
                      ? "New to board"
                      : `Was #${previousRank}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xl font-semibold">
                    {entry.score}
                  </p>
                  {rankDelta > 0 ? (
                    <p className="text-xs text-emerald-300">
                      +{rankDelta} rank
                    </p>
                  ) : null}
                  {rankDelta < 0 ? (
                    <p className="text-xs text-amber-300">
                      {rankDelta} rank
                    </p>
                  ) : null}
                </div>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      </div>
    </div>
  );
}

export const FullscreenEffectOverlay = React.memo(
  FullscreenEffectOverlayInner,
);
