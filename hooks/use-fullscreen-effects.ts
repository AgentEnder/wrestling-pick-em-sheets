"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildBubbleSortSteps } from "@/lib/pick-em/leaderboard-utils";

import type { LiveGameLeaderboardEntry } from "@/lib/types";

export interface FullscreenEventsEffect {
  kind: "events";
  events: { id: string; type: string; message: string }[];
}

export interface FullscreenLeaderboardEffect {
  kind: "leaderboard";
  previous: LiveGameLeaderboardEntry[];
  current: LiveGameLeaderboardEntry[];
  swapCount: number;
}

export type FullscreenEffect =
  | FullscreenEventsEffect
  | FullscreenLeaderboardEffect;

const LEADERBOARD_SWAP_DURATION_MS = 400;
const EVENT_EFFECT_DURATION_MS = 4_000;
const LEADERBOARD_EFFECT_BASE_DURATION_MS = 3_000;

function getFullscreenEffectDurationMs(effect: FullscreenEffect): number {
  if (effect.kind === "events") return EVENT_EFFECT_DURATION_MS;
  return (
    LEADERBOARD_EFFECT_BASE_DURATION_MS +
    effect.swapCount * LEADERBOARD_SWAP_DURATION_MS
  );
}

interface UseFullscreenEffectsReturn {
  activeEffect: FullscreenEffect | null;
  animatedLeaderboardOrder: string[];
  queueEffects: (effects: FullscreenEffect[]) => void;
  dismiss: () => void;
}

export function useFullscreenEffects(): UseFullscreenEffectsReturn {
  const [queue, setQueue] = useState<FullscreenEffect[]>([]);
  const [activeEffect, setActiveEffect] = useState<FullscreenEffect | null>(
    null,
  );
  const [animatedLeaderboardOrder, setAnimatedLeaderboardOrder] = useState<
    string[]
  >([]);

  const effectTimeoutRef = useRef<number | null>(null);
  const stepIntervalRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (effectTimeoutRef.current) {
      window.clearTimeout(effectTimeoutRef.current);
      effectTimeoutRef.current = null;
    }
    if (stepIntervalRef.current) {
      window.clearInterval(stepIntervalRef.current);
      stepIntervalRef.current = null;
    }
    setAnimatedLeaderboardOrder([]);
    setActiveEffect(null);
  }, []);

  const queueEffects = useCallback((effects: FullscreenEffect[]) => {
    if (effects.length === 0) return;
    setQueue((previous) => [...previous, ...effects]);
  }, []);

  useEffect(() => {
    if (activeEffect || queue.length === 0) return;

    const [nextEffect, ...remaining] = queue;
    setQueue(remaining);
    setActiveEffect(nextEffect);

    if (effectTimeoutRef.current) {
      window.clearTimeout(effectTimeoutRef.current);
    }
    effectTimeoutRef.current = window.setTimeout(() => {
      setActiveEffect(null);
    }, getFullscreenEffectDurationMs(nextEffect));
  }, [activeEffect, queue]);

  useEffect(() => {
    if (stepIntervalRef.current) {
      window.clearInterval(stepIntervalRef.current);
      stepIntervalRef.current = null;
    }

    if (!activeEffect || activeEffect.kind !== "leaderboard") {
      setAnimatedLeaderboardOrder([]);
      return;
    }

    const steps = buildBubbleSortSteps(
      activeEffect.previous.map((entry) => entry.nickname),
      activeEffect.current.map((entry) => entry.nickname),
    );
    setAnimatedLeaderboardOrder(steps[0] ?? []);

    if (steps.length > 1) {
      let stepIndex = 0;
      stepIntervalRef.current = window.setInterval(() => {
        stepIndex += 1;
        if (stepIndex >= steps.length) {
          if (stepIntervalRef.current) {
            window.clearInterval(stepIntervalRef.current);
            stepIntervalRef.current = null;
          }
          return;
        }
        setAnimatedLeaderboardOrder(steps[stepIndex]);
      }, LEADERBOARD_SWAP_DURATION_MS);
    }

    return () => {
      if (stepIntervalRef.current) {
        window.clearInterval(stepIntervalRef.current);
        stepIntervalRef.current = null;
      }
    };
  }, [activeEffect]);

  return { activeEffect, animatedLeaderboardOrder, queueEffects, dismiss };
}
