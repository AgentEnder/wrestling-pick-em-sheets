"use client";

import React from "react";
import { UserRound } from "lucide-react";

export interface JoinOverlayEntry {
  id: string;
  message: string;
  addedAt: number;
}

interface JoinOverlayProps {
  entries: JoinOverlayEntry[];
  onDismiss: () => void;
}

function JoinOverlayInner({ entries, onDismiss }: JoinOverlayProps) {
  if (entries.length === 0) return null;

  return (
    <div
      className="lg-fullscreen-effect lg-fullscreen-effect-joins"
      onClick={onDismiss}
    >
      <div className="lg-fullscreen-effect-panel lg-join-overlay-panel">
        <div className="lg-fullscreen-effect-title">
          <UserRound className="h-6 w-6" />
          <span className="font-heading text-2xl uppercase tracking-wide">
            Player Joined
          </span>
        </div>
        <div className="lg-fullscreen-effect-body">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="lg-fullscreen-event-item lg-join-overlay-entry"
            >
              <p className="text-base text-foreground">{entry.message}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const JoinOverlay = React.memo(JoinOverlayInner);
