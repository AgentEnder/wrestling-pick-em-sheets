"use client";

import React from "react";

import { useLiveGameState } from "@/stores/selectors";
import { getConnectionStatus } from "@/lib/client/connection-status";

/* ---- Component ---- */

function HostDashboardPanelsInner() {
  const gameState = useLiveGameState();

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold">Leaderboard</h3>
        <div className="mt-2 space-y-1">
          {(gameState?.leaderboard ?? []).slice(0, 10).map((entry) => {
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
                className="flex items-center justify-between gap-2 text-sm"
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
                <span className="font-mono">{entry.score}</span>
              </div>
            );
          })}
          {(gameState?.leaderboard ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No submitted players yet.
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold">Change Feed</h3>
        <div className="mt-2 space-y-1">
          {(gameState?.events ?? []).slice(0, 10).map((event) => (
            <p key={event.id} className="text-sm">
              <span className="text-muted-foreground">
                {new Date(event.createdAt).toLocaleTimeString()}{" "}
              </span>
              {event.message}
            </p>
          ))}
          {(gameState?.events ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No events yet.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export const HostDashboardPanels = React.memo(HostDashboardPanelsInner);
