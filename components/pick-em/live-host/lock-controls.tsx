"use client";

import React, { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useLiveLockState, useLiveGames } from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import { updateLiveGameLocks } from "@/lib/client/live-games-api";
import type { LiveGameLockState } from "@/lib/types";

/* ---- Props ---- */

interface LockControlsProps {
  gameId: string;
}

/* ---- Component ---- */

function LockControlsInner({ gameId }: LockControlsProps) {
  const lockState = useLiveLockState();
  const games = useLiveGames();
  const [isLockSaving, setIsLockSaving] = useState(false);

  const game = games.find((g) => g.id === gameId);

  const saveLocks = useCallback(
    async (next: LiveGameLockState) => {
      setIsLockSaving(true);
      try {
        const updated = await updateLiveGameLocks(gameId, next);
        const store = useAppStore.getState();
        store.setLockState(updated.lockState);
        store.setGames([updated]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update locks";
        toast.error(message);
      } finally {
        setIsLockSaving(false);
      }
    },
    [gameId],
  );

  const toggleGlobalLock = useCallback(() => {
    if (!lockState) return;
    void saveLocks({
      ...lockState,
      globalLocked: !lockState.globalLocked,
    });
  }, [lockState, saveLocks]);

  if (!lockState || !game) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Locks</p>
        <Button
          size="sm"
          variant={lockState.globalLocked ? "default" : "outline"}
          onClick={toggleGlobalLock}
          disabled={isLockSaving}
        >
          {lockState.globalLocked ? "Unlock All" : "Lock All"}
        </Button>
      </div>
    </section>
  );
}

export const LockControls = React.memo(LockControlsInner);
