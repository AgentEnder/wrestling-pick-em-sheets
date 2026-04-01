"use client";

import { Pause, Play, RotateCcw, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LiveKeyTimer } from "@/lib/types";
import { formatDuration, getTimerElapsedMs } from "@/lib/pick-em/timer-utils";

interface BonusTimerCaptureProps {
  timer: LiveKeyTimer | null | undefined;
  currentTimeMs: number;
  onStart: (timerId: string) => void;
  onStop: (timerId: string) => void;
  onReset: (timerId: string) => void;
  onCapture: (formattedTime: string) => void;
  captureLabel?: string;
}

export function BonusTimerCapture({
  timer,
  currentTimeMs,
  onStart,
  onStop,
  onReset,
  onCapture,
  captureLabel = "Capture Time",
}: BonusTimerCaptureProps) {
  const elapsed = timer
    ? formatDuration(getTimerElapsedMs(timer, currentTimeMs))
    : "--:--";

  return (
    <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-2.5">
      <p className="text-xs text-muted-foreground">Question Timer</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-border px-2 py-1 font-mono text-sm">
          {elapsed}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (!timer) return;
            if (timer.isRunning) {
              onStop(timer.id);
            } else {
              onStart(timer.id);
            }
          }}
          disabled={!timer}
        >
          {timer?.isRunning ? (
            <Pause className="mr-1 h-4 w-4" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          {timer?.isRunning ? "Stop" : "Start"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => timer && onReset(timer.id)}
          disabled={!timer}
        >
          <RotateCcw className="h-4 w-4" />
          <span className="sr-only">Reset bonus timer</span>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (!timer) return;
            const elapsedMs = getTimerElapsedMs(timer, Date.now());
            const timerValue = formatDuration(elapsedMs);
            onCapture(timerValue);
          }}
          disabled={!timer}
        >
          <Timer className="mr-1 h-4 w-4" />
          {captureLabel}
        </Button>
      </div>
    </div>
  );
}
