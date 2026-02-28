"use client";

import React from "react";
import {
  Globe,
  Laptop,
  Monitor,
  Smartphone,
  UserRound,
} from "lucide-react";

import { getConnectionStatus } from "@/lib/client/connection-status";
import type { LiveGameStateResponse } from "@/lib/client/live-games-api";

function formatDeviceType(type: string | null): string {
  if (!type) return "Desktop";
  const normalized = type.toLowerCase();
  if (normalized.includes("mobile")) return "Mobile";
  if (normalized.includes("tablet")) return "Tablet";
  if (normalized.includes("smarttv")) return "TV";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

interface LobbyViewProps {
  state: LiveGameStateResponse;
  joinQrCodeDataUrl: string | null;
  joinBaseOrigin: string | null;
}

function LobbyViewInner({
  state,
  joinQrCodeDataUrl,
  joinBaseOrigin,
}: LobbyViewProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1.4fr] lg:items-start">
      <section className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl shadow-black/25 backdrop-blur">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">
          Scan To Join
        </h2>
        <div className="mt-3 flex justify-center rounded-xl border border-border/70 bg-background/45 p-5">
          {joinQrCodeDataUrl ? (
            <img
              src={joinQrCodeDataUrl}
              alt={`QR code to join room ${state.game.joinCode}`}
              className="h-72 w-72 rounded-md bg-white p-2 lg:h-80 lg:w-80"
            />
          ) : (
            <p className="py-24 text-sm text-muted-foreground">
              Waiting for LAN/public URL...
            </p>
          )}
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Open{" "}
          <span className="font-mono text-foreground">
            {joinBaseOrigin ? `${joinBaseOrigin}/join` : ".../join"}
          </span>{" "}
          and enter{" "}
          <span className="font-mono text-foreground">
            {state.game.joinCode}
          </span>
        </p>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl shadow-black/25 backdrop-blur">
        <h2 className="mb-2 text-sm uppercase tracking-wide text-muted-foreground">
          Joined Players
        </h2>
        <div className="space-y-2">
          {state.joinedPlayers.length > 0 ? (
            state.joinedPlayers.map((player) => {
              const presence = getConnectionStatus(player.lastSeenAt);
              const dotClass =
                presence.state === "online"
                  ? "bg-emerald-500"
                  : presence.state === "idle"
                    ? "bg-amber-500"
                    : "bg-slate-400";

              const DeviceIcon =
                player.deviceType &&
                player.deviceType.toLowerCase().includes("mobile")
                  ? Smartphone
                  : player.deviceType &&
                      player.deviceType.toLowerCase().includes("tablet")
                    ? Smartphone
                    : player.deviceType &&
                        player.deviceType.toLowerCase().includes("desktop")
                      ? Monitor
                      : Laptop;

              return (
                <div
                  key={player.id}
                  className="rounded-md border border-border/70 bg-background/45 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold">
                        <UserRound className="mr-1 inline h-4 w-4" />
                        {player.nickname}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Joined{" "}
                        {new Date(player.joinedAt).toLocaleTimeString()}
                        {player.authMethod === "clerk"
                          ? " \u2022 Account"
                          : " \u2022 Guest"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${dotClass}`}
                      />
                      <span className="capitalize">{presence.state}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/60 px-2 py-1">
                      <Globe className="h-3.5 w-3.5" />
                      {player.browserName ?? "Unknown browser"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/60 px-2 py-1">
                      <DeviceIcon className="h-3.5 w-3.5" />
                      {player.osName ?? player.platform ?? "Unknown OS"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/60 px-2 py-1">
                      <Monitor className="h-3.5 w-3.5" />
                      {formatDeviceType(player.deviceType)}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Waiting for players to join...
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

export const LobbyView = React.memo(LobbyViewInner);
