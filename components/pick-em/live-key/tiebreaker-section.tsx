"use client";

import React, { useMemo } from "react";
import { Timer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useLiveCard,
  useLivePayload,
  useLivePayloadActions,
} from "@/stores/selectors";
import { useTimerClock } from "@/hooks/use-timer-clock";
import { formatDuration, getTimerElapsedMs } from "@/lib/pick-em/timer-utils";

function formatTimestamp(value: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return parsed.toLocaleString();
}

function TiebreakerSectionInner() {
  const card = useLiveCard();
  const payload = useLivePayload();
  const { setLiveTiebreakerAnswer, setLiveTiebreakerTimerId } =
    useLivePayloadActions();

  const hasRunningTimers = useMemo(
    () => payload.timers.some((timer) => timer.isRunning),
    [payload.timers],
  );
  const currentTimeMs = useTimerClock(300, hasRunningTimers);

  const timersById = useMemo(
    () => new Map(payload.timers.map((timer) => [timer.id, timer])),
    [payload.timers],
  );

  const timerOptions = useMemo(
    () => payload.timers.map((timer) => ({ id: timer.id, label: timer.label })),
    [payload.timers],
  );

  if (!card?.tiebreakerLabel?.trim()) return null;

  function applyTimerValueToTiebreaker() {
    const timerId = payload.tiebreakerTimerId;
    const timer = timerId ? timersById.get(timerId) : undefined;

    if (!timer || !timerId) {
      toast.error("Select a timer first");
      return;
    }

    const timerValue = formatDuration(getTimerElapsedMs(timer, currentTimeMs));
    setLiveTiebreakerAnswer(timerValue);
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold text-foreground">Tiebreaker</h2>
      <div className="mt-2 space-y-1.5">
        <Label>{card.tiebreakerLabel}</Label>
        <Input
          value={payload.tiebreakerAnswer}
          onChange={(event) => setLiveTiebreakerAnswer(event.target.value)}
          placeholder="Record tiebreaker result"
        />
        {card.tiebreakerIsTimeBased ? (
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <Select
                value={payload.tiebreakerTimerId ?? "none"}
                onValueChange={(value) =>
                  setLiveTiebreakerTimerId(value === "none" ? null : value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select timer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No timer</SelectItem>
                  {timerOptions.map((timerOption) => (
                    <SelectItem key={timerOption.id} value={timerOption.id}>
                      {timerOption.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="secondary"
                onClick={applyTimerValueToTiebreaker}
              >
                <Timer className="mr-1 h-4 w-4" />
                Use Timer
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Recorded: {formatTimestamp(payload.tiebreakerRecordedAt)}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export const TiebreakerSection = React.memo(TiebreakerSectionInner);
