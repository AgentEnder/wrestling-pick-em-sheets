import type { LiveKeyTimer } from "@/lib/types";

const MATCH_TIMER_PREFIX = "match:";
const MATCH_BONUS_TIMER_PREFIX = "match-bonus:";
const EVENT_BONUS_TIMER_PREFIX = "event-bonus:";

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getTimerElapsedMs(
  timer: LiveKeyTimer,
  referenceNowMs: number,
): number {
  if (!timer.isRunning || !timer.startedAt) {
    return timer.elapsedMs;
  }

  const startedAtMs = new Date(timer.startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return timer.elapsedMs;
  }

  return Math.max(0, timer.elapsedMs + (referenceNowMs - startedAtMs));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function nowMs(): number {
  return Date.now();
}

export function toMatchTimerId(matchId: string): string {
  return `${MATCH_TIMER_PREFIX}${matchId}`;
}

export function toMatchBonusTimerId(
  matchId: string,
  questionId: string,
): string {
  return `${MATCH_BONUS_TIMER_PREFIX}${matchId}:${questionId}`;
}

export function toEventBonusTimerId(questionId: string): string {
  return `${EVENT_BONUS_TIMER_PREFIX}${questionId}`;
}

export function isMatchTimerId(timerId: string): boolean {
  return timerId.startsWith(MATCH_TIMER_PREFIX);
}

export function isMatchBonusTimerId(timerId: string): boolean {
  return timerId.startsWith(MATCH_BONUS_TIMER_PREFIX);
}

export function isEventBonusTimerId(timerId: string): boolean {
  return timerId.startsWith(EVENT_BONUS_TIMER_PREFIX);
}

export function isSystemTimerId(timerId: string): boolean {
  return (
    isMatchTimerId(timerId) ||
    isMatchBonusTimerId(timerId) ||
    isEventBonusTimerId(timerId)
  );
}
