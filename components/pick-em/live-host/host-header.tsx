"use client";

import React from "react";
import Link from "next/link";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLiveCard, useLiveGames, useLiveUi } from "@/stores/selectors";

/* ---- Props ---- */

interface HostHeaderProps {
  gameId: string;
  onSave: () => void;
}

/* ---- Component ---- */

function HostHeaderInner({ gameId, onSave }: HostHeaderProps) {
  const card = useLiveCard();
  const ui = useLiveUi();
  const games = useLiveGames();

  const game = games.find((g) => g.id === gameId);
  if (!game || !card) return null;

  const secretSuffix = game.qrJoinSecret
    ? `&s=${encodeURIComponent(game.qrJoinSecret)}`
    : "";
  const displayUrl = `/games/${game.id}/display?code=${encodeURIComponent(game.joinCode)}${secretSuffix}`;
  const joinUrl = `/join?code=${encodeURIComponent(game.joinCode)}${secretSuffix}`;

  return (
    <header className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Host Keying Console</h1>
          <p className="text-sm text-muted-foreground">
            Join code <span className="font-mono">{game.joinCode}</span> •{" "}
            {card.eventName || "Untitled Event"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Status:{" "}
            <span className="capitalize text-foreground">{game.status}</span>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {ui.isDirty
              ? "Unsynced key changes (auto-saving)..."
              : "All key changes synced."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={displayUrl}>Open Display</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={joinUrl}>Open Join</Link>
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button onClick={onSave} disabled={ui.isSaving}>
            <Save className="mr-1 h-4 w-4" />
            {ui.isSaving ? "Saving..." : "Save Key"}
          </Button>
        </div>
      </div>
    </header>
  );
}

export const HostHeader = React.memo(HostHeaderInner);
