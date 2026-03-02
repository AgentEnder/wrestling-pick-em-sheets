import type {
  LiveKeyTimer,
  CardLiveKeyPayload,
  Match,
  BonusQuestion,
} from "@/lib/types";

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

export function getQuestionValueType(question: {
  valueType?: "string" | "numerical" | "time" | "rosterMember";
  isTimeBased?: boolean;
  isCountBased?: boolean;
}): "string" | "numerical" | "time" | "rosterMember" {
  if (
    question.valueType === "numerical" ||
    question.valueType === "time" ||
    question.valueType === "rosterMember"
  ) {
    return question.valueType;
  }
  if (question.isTimeBased) return "time";
  if (question.isCountBased) return "numerical";
  return "string";
}

/* ── Internal helpers for ensureSystemTimers ────────────────── */

function buildMatchTimerLabel(match: Match, index: number): string {
  const title = match.title.trim() || `Match ${index + 1}`;
  return `Match ${index + 1}: ${title}`;
}

function buildMatchBonusTimerLabel(
  match: Match,
  matchIndex: number,
  questionText: string,
): string {
  const title = match.title.trim() || `Match ${matchIndex + 1}`;
  const suffix = questionText.trim() || "Bonus";
  return `Match ${matchIndex + 1} Bonus: ${title} - ${suffix}`;
}

function buildEventBonusTimerLabel(
  questionText: string,
  questionIndex: number,
): string {
  const suffix = questionText.trim() || `Question ${questionIndex + 1}`;
  return `Event Bonus Timer: ${suffix}`;
}

function createTimer(id: string, label: string): LiveKeyTimer {
  return { id, label, elapsedMs: 0, isRunning: false, startedAt: null };
}

/* ── ensureSystemTimers ─────────────────────────────────────── */

export function ensureSystemTimers(
  payload: CardLiveKeyPayload,
  matches: Match[],
  eventBonusQuestions: BonusQuestion[],
): CardLiveKeyPayload {
  const timersById = new Map(payload.timers.map((timer) => [timer.id, timer]));
  const systemTimers: LiveKeyTimer[] = [];

  matches.forEach((match, index) => {
    const timerId = toMatchTimerId(match.id);
    const existing = timersById.get(timerId);
    const label = buildMatchTimerLabel(match, index);
    systemTimers.push(
      existing ? { ...existing, label } : createTimer(timerId, label),
    );

    match.bonusQuestions.forEach((question) => {
      if (getQuestionValueType(question) !== "time") return;
      const bonusTimerId = toMatchBonusTimerId(match.id, question.id);
      const bonusLabel = buildMatchBonusTimerLabel(
        match,
        index,
        question.question,
      );
      const existingBonus = timersById.get(bonusTimerId);
      systemTimers.push(
        existingBonus
          ? { ...existingBonus, label: bonusLabel }
          : createTimer(bonusTimerId, bonusLabel),
      );
    });
  });

  eventBonusQuestions.forEach((question, index) => {
    if (getQuestionValueType(question) !== "time") return;
    const timerId = toEventBonusTimerId(question.id);
    const label = buildEventBonusTimerLabel(question.question, index);
    const existing = timersById.get(timerId);
    systemTimers.push(
      existing ? { ...existing, label } : createTimer(timerId, label),
    );
  });

  const customTimers = payload.timers.filter(
    (timer) => !isSystemTimerId(timer.id),
  );

  return {
    ...payload,
    timers: [...systemTimers, ...customTimers],
  };
}
