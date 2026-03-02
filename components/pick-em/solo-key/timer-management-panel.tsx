"use client";

import React, { useMemo } from "react";
import { Pause, Play, Plus, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLivePayload, useLiveTimerActions } from "@/stores/selectors";
import { useTimerClock } from "@/hooks/use-timer-clock";
import {
  formatDuration,
  getTimerElapsedMs,
  isSystemTimerId,
} from "@/lib/pick-em/timer-utils";

function TimerManagementPanelInner() {
  const payload = useLivePayload();
  const {
    liveStartTimer,
    liveStopTimer,
    liveResetTimer,
    liveAddCustomTimer,
    liveRemoveCustomTimer,
    liveSetTimerLabel,
  } = useLiveTimerActions();

  const customTimers = useMemo(
    () => payload.timers.filter((timer) => !isSystemTimerId(timer.id)),
    [payload.timers],
  );

  const hasRunningCustomTimers = useMemo(
    () => customTimers.some((timer) => timer.isRunning),
    [customTimers],
  );

  const currentTimeMs = useTimerClock(300, hasRunningCustomTimers);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-foreground">Custom Timers</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => liveAddCustomTimer()}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add Timer
        </Button>
      </div>

      {customTimers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No custom timers yet.</p>
      ) : (
        <div className="space-y-2">
          {customTimers.map((timer) => {
            const elapsedMs = getTimerElapsedMs(timer, currentTimeMs);

            return (
              <div
                key={timer.id}
                className="rounded-md border border-border/70 bg-background/35 p-3"
              >
                <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="space-y-1.5">
                    <Label>Timer Label</Label>
                    <Input
                      value={timer.label}
                      onChange={(event) =>
                        liveSetTimerLabel(timer.id, event.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <span className="rounded-md border border-border px-2 py-1 font-mono text-sm">
                      {formatDuration(elapsedMs)}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        timer.isRunning
                          ? liveStopTimer(timer.id)
                          : liveStartTimer(timer.id)
                      }
                    >
                      {timer.isRunning ? (
                        <Pause className="mr-1 h-4 w-4" />
                      ) : (
                        <Play className="mr-1 h-4 w-4" />
                      )}
                      {timer.isRunning ? "Stop" : "Start"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => liveResetTimer(timer.id)}
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span className="sr-only">Reset timer</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => liveRemoveCustomTimer(timer.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Remove timer</span>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export const TimerManagementPanel = React.memo(TimerManagementPanelInner);
