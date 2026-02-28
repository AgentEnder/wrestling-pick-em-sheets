"use client";

import React from "react";

interface GameEvent {
  id: string;
  type: string;
  message: string;
  createdAt: string;
}

interface UpdatesFeedProps {
  events: GameEvent[];
  maxItems?: number;
  /** Variant controls visual density: "display" for TV-style, "compact" for player sidebar */
  variant?: "display" | "compact";
}

function UpdatesFeedInner({
  events,
  maxItems = 15,
  variant = "compact",
}: UpdatesFeedProps) {
  const visibleEvents = events.slice(0, maxItems);

  if (variant === "display") {
    return (
      <div className="space-y-2">
        {visibleEvents.length > 0 ? (
          visibleEvents.map((event) => (
            <div
              key={event.id}
              className="rounded-md border border-border/70 bg-background/45 p-2"
            >
              <p className="text-xs text-muted-foreground">
                {new Date(event.createdAt).toLocaleTimeString()}
              </p>
              <p className="text-sm">{event.message}</p>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        )}
      </div>
    );
  }

  // Compact variant (player sidebar)
  return (
    <div className="space-y-1">
      {visibleEvents.map((event) => (
        <p
          key={event.id}
          className="rounded-md border border-transparent px-2 py-1 text-sm"
        >
          <span className="text-muted-foreground">
            {new Date(event.createdAt).toLocaleTimeString()}{" "}
          </span>
          {event.message}
        </p>
      ))}
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No events yet.</p>
      ) : null}
    </div>
  );
}

export const UpdatesFeed = React.memo(UpdatesFeedInner);
