"use client";

import React, { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useLiveGameState } from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import {
  getLiveGameState,
  reviewLiveGameJoinRequest,
} from "@/lib/client/live-games-api";

/* ---- Props ---- */

interface JoinRequestsPanelProps {
  gameId: string;
  joinCode?: string | null;
}

/* ---- Component ---- */

function JoinRequestsPanelInner({
  gameId,
  joinCode,
}: JoinRequestsPanelProps) {
  const gameState = useLiveGameState();
  const [activeReviewPlayerId, setActiveReviewPlayerId] = useState<
    string | null
  >(null);

  const handleReviewJoinRequest = useCallback(
    async (playerId: string, action: "approve" | "deny") => {
      setActiveReviewPlayerId(playerId);
      try {
        await reviewLiveGameJoinRequest(gameId, playerId, action);
        const refreshed = await getLiveGameState(
          gameId,
          joinCode ?? undefined,
        );
        useAppStore.getState().setLiveGameState(refreshed);
        toast.success(
          action === "approve" ? "Player approved" : "Player denied",
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update join request";
        toast.error(message);
      } finally {
        setActiveReviewPlayerId(null);
      }
    },
    [gameId, joinCode],
  );

  const pendingRequests = gameState?.pendingJoinRequests ?? [];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="font-medium">Join Lobby</p>
          <p className="text-xs text-muted-foreground">
            Guests outside your network/proximity wait here for host approval.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Pending: {pendingRequests.length}
        </p>
      </div>

      {pendingRequests.length > 0 ? (
        <div className="mt-3 space-y-2">
          {pendingRequests.map((request) => (
            <div
              key={request.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background/40 px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{request.nickname}</p>
                <p className="text-xs text-muted-foreground">
                  {request.joinRequestCity || "Unknown city"}
                  {request.joinRequestCountry
                    ? `, ${request.joinRequestCountry}`
                    : ""}
                  {typeof request.joinRequestDistanceKm === "number"
                    ? ` \u2022 ${request.joinRequestDistanceKm.toFixed(1)}km`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={activeReviewPlayerId === request.id}
                  onClick={() =>
                    void handleReviewJoinRequest(request.id, "deny")
                  }
                >
                  Deny
                </Button>
                <Button
                  size="sm"
                  disabled={activeReviewPlayerId === request.id}
                  onClick={() =>
                    void handleReviewJoinRequest(request.id, "approve")
                  }
                >
                  Approve
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No pending join requests.
        </p>
      )}
    </section>
  );
}

export const JoinRequestsPanel = React.memo(JoinRequestsPanelInner);
