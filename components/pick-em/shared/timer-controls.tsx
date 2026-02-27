"use client";

import { Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LiveKeyTimer } from "@/lib/types";
import { formatDuration, getTimerElapsedMs } from "@/lib/pick-em/timer-utils";

interface TimerControlsProps {
  timer: LiveKeyTimer | undefined;
  currentTimeMs: number;
  onStart: (timerId: string) => void;
  onStop: (timerId: string) => void;
  onReset: (timerId: string) => void;
  label?: string;
  disabled?: boolean;
}

export function TimerControls({
  timer,
  currentTimeMs,
  onStart,
  onStop,
  onReset,
  label = "Timer",
  disabled = false,
}: TimerControlsProps) {
  const elapsedMs = timer
    ? getTimerElapsedMs(timer, currentTimeMs)
    : 0;

  return (
    <div className="rounded-md border border-border/70 bg-background/35 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-2xl text-foreground">
        {formatDuration(elapsedMs)}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() => {
            if (!timer) return;
            if (timer.isRunning) {
              onStop(timer.id);
            } else {
              onStart(timer.id);
            }
          }}
          disabled={disabled || !timer}
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
          className="w-full"
          onClick={() => timer && onReset(timer.id)}
          disabled={disabled || !timer}
        >
          <RotateCcw className="mr-1 h-4 w-4" />
          Reset
        </Button>
      </div>
    </div>
  );
}
