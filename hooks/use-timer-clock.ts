"use client";

import { useEffect, useState } from "react";

/**
 * Maintains a millisecond clock that ticks at the given interval.
 * Only ticks when `enabled` is true. Returns `Date.now()` at each tick.
 */
export function useTimerClock(
  intervalMs: number = 300,
  enabled: boolean = true,
): number {
  const [currentTimeMs, setCurrentTimeMs] = useState(Date.now());

  useEffect(() => {
    if (!enabled) return;

    const intervalId = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [intervalMs, enabled]);

  return currentTimeMs;
}
