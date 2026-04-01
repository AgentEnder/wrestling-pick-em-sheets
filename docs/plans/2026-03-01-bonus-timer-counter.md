# Bonus Question Timer & Counter Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add timer support for time-based bonus questions and increment/decrement counters for numerical threshold questions in the host keying app. The old live-key app (`live-key-match-section.tsx`) already has both features; the new host app (`host-match-section.tsx`, `host-event-bonus-section.tsx`) is missing them.

**Architecture:** The timer infrastructure already exists (timer utils, store actions, payload format). We need to: (1) seed bonus question timers in the host app's initialization, (2) port the timer capture UI from the old live-key app to the new host app, and (3) port the counter UI for numerical questions. Each bonus question's UI now branches on `valueType` first, then `answerType`.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind CSS

---

### Task 1: Seed bonus question timers in host app initialization

The host app's `ensureAllMatchTimers` only creates match-level timers. It needs to also create `match-bonus:` and `event-bonus:` timers for questions with `valueType === "time"`.

**Files:**
- Modify: `components/pick-em/live-game-key-host-app.tsx:48-93`

**Step 1: Update `ensureAllMatchTimers` to also create bonus question timers**

Replace the existing `ensureMatchTimer` and `ensureAllMatchTimers` helpers with a more comprehensive version that mirrors the old `ensureSystemTimers` from `live-key-app.tsx`.

Import `toMatchBonusTimerId`, `toEventBonusTimerId` from `@/lib/pick-em/timer-utils`.

```typescript
import {
  toMatchTimerId,
  toMatchBonusTimerId,
  toEventBonusTimerId,
} from "@/lib/pick-em/timer-utils";

function ensureTimer(
  payload: LiveGameKeyPayload,
  timerId: string,
  label: string,
): LiveGameKeyPayload {
  const found = payload.timers.find((timer) => timer.id === timerId);
  if (found) {
    return {
      ...payload,
      timers: payload.timers.map((timer) =>
        timer.id === timerId ? { ...timer, label } : timer,
      ),
    };
  }
  return {
    ...payload,
    timers: [
      ...payload.timers,
      { id: timerId, label, elapsedMs: 0, isRunning: false, startedAt: null },
    ],
  };
}

function ensureAllTimers(
  payload: LiveGameKeyPayload,
  matches: Array<{
    id: string;
    title: string;
    bonusQuestions: Array<{ id: string; question: string; valueType: string }>;
  }>,
  eventBonusQuestions: Array<{ id: string; question: string; valueType: string }>,
): LiveGameKeyPayload {
  let result = payload;

  matches.forEach((match, matchIndex) => {
    const matchLabel = `Match ${matchIndex + 1}: ${match.title || "Untitled"}`;
    result = ensureTimer(result, toMatchTimerId(match.id), matchLabel);

    match.bonusQuestions.forEach((question) => {
      if (question.valueType !== "time") return;
      const bonusTimerId = toMatchBonusTimerId(match.id, question.id);
      const bonusLabel = `${matchLabel} — ${question.question || "Bonus"}`;
      result = ensureTimer(result, bonusTimerId, bonusLabel);
    });
  });

  eventBonusQuestions.forEach((question, index) => {
    if (question.valueType !== "time") return;
    const timerId = toEventBonusTimerId(question.id);
    const label = `Event Bonus ${index + 1}: ${question.question || "Bonus"}`;
    result = ensureTimer(result, timerId, label);
  });

  return result;
}
```

**Step 2: Update call sites to pass bonus question data**

In the `load` callback (around line 137), change:
```typescript
const nextPayload = ensureAllTimers(
  keyResponse.key,
  keyResponse.card.matches,
  keyResponse.card.eventBonusQuestions ?? [],
);
```

Find ALL other calls to `ensureAllMatchTimers` in this file and update them to `ensureAllTimers` with the additional `eventBonusQuestions` parameter. The card object from `useLiveCard()` should have both `matches` and `eventBonusQuestions`.

**Step 3: Run type-check**

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: No errors

**Step 4: Commit**

```
feat: seed bonus question timers in host app initialization
```

---

### Task 2: Add timer UI for time-based match bonus questions in host app

Port the timer capture UI from the old `live-key-match-section.tsx` (lines 692-818) to the new `host-match-section.tsx`. This applies to ALL bonus question types when `question.valueType === "time"`.

**Files:**
- Modify: `components/pick-em/live-host/host-match-section.tsx`

**Step 1: Add timer-related imports and hooks**

Add imports needed for the timer UI:

```typescript
import { Pause, Play, RotateCcw, Timer } from "lucide-react"; // add Timer, Pause, Play if not already imported
import {
  toMatchBonusTimerId,
} from "@/lib/pick-em/timer-utils";
import { useTimerClock } from "@/hooks/use-timer-clock";
```

The component already imports `formatDuration`, `getTimerElapsedMs`, `toMatchTimerId` and uses `useTimerClock`. It also already has `useLiveTimerActions` for `liveStartTimer`, `liveStopTimer`, `liveResetTimer`.

**Step 2: Add timer display below the threshold/multiple-choice/write-in section for time-based questions**

Inside the bonus question `.map()` callback (around line 641+), after the existing three-way branch for the answer input, add a timer section that appears when `question.valueType === "time"`:

First, compute timer-related derived values inside the `.map()` callback:

```typescript
const bonusTimerId = toMatchBonusTimerId(match.id, question.id);
const bonusTimer = payload.timers.find((t) => t.id === bonusTimerId) ?? null;
const bonusTimerElapsed = bonusTimer
  ? formatDuration(getTimerElapsedMs(bonusTimer, currentTimeMs))
  : "--:--";
```

Note: `currentTimeMs` comes from `useTimerClock` which is already used for the match timer. If it's scoped to the match timer, you may need to ensure it covers bonus timers too.

Then, after the answer input (threshold buttons / Select / Input), add:

```tsx
{question.valueType === "time" ? (
  <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-2.5">
    <p className="text-xs text-muted-foreground">Question Timer</p>
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <span className="rounded-md border border-border px-2 py-1 font-mono text-sm">
        {bonusTimerElapsed}
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          if (!bonusTimer) return;
          if (bonusTimer.isRunning) {
            liveStopTimer(bonusTimer.id);
          } else {
            liveStartTimer(bonusTimer.id);
          }
        }}
        disabled={!bonusTimer}
      >
        {bonusTimer?.isRunning ? (
          <Pause className="mr-1 h-4 w-4" />
        ) : (
          <Play className="mr-1 h-4 w-4" />
        )}
        {bonusTimer?.isRunning ? "Stop" : "Start"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => bonusTimer && liveResetTimer(bonusTimer.id)}
        disabled={!bonusTimer}
      >
        <RotateCcw className="h-4 w-4" />
        <span className="sr-only">Reset bonus timer</span>
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          if (!bonusTimer) return;
          const elapsedMs = getTimerElapsedMs(bonusTimer, Date.now());
          const timerValue = formatDuration(elapsedMs);
          liveSetMatchBonusAnswer(
            match.id,
            question.id,
            timerValue,
            true,
          );
        }}
        disabled={!bonusTimer}
      >
        <Timer className="mr-1 h-4 w-4" />
        Capture Time
      </Button>
    </div>
  </div>
) : null}
```

The "Capture Time" button reads the current timer elapsed value, formats it as a time string (e.g., `"05:23"`), and calls `liveSetMatchBonusAnswer` with `isTimeBased = true`. This stores the actual time value as the answer, which the scoring engine can parse via Path B for threshold questions.

**Step 3: Run type-check**

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: No errors

**Step 4: Commit**

```
feat: add timer UI for time-based match bonus questions in host app
```

---

### Task 3: Add timer UI for time-based event bonus questions in host app

Same pattern as Task 2, but for `host-event-bonus-section.tsx`.

**Files:**
- Modify: `components/pick-em/live-host/host-event-bonus-section.tsx`

**Step 1: Add timer-related imports**

```typescript
import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import {
  formatDuration,
  getTimerElapsedMs,
  toEventBonusTimerId,
} from "@/lib/pick-em/timer-utils";
import { useTimerClock } from "@/hooks/use-timer-clock";
```

Also get `liveStartTimer`, `liveStopTimer`, `liveResetTimer` from `useLiveTimerActions` (add the import and hook call if not present).

**Step 2: Add timer display for event bonus questions with `valueType === "time"`**

Inside the event bonus question rendering, after the answer input section, add the same timer widget pattern as Task 2 but using `toEventBonusTimerId(question.id)`:

```tsx
{question.valueType === "time" ? (
  <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-2.5">
    <p className="text-xs text-muted-foreground">Question Timer</p>
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <span className="rounded-md border border-border px-2 py-1 font-mono text-sm">
        {bonusTimerElapsed}
      </span>
      {/* Start/Stop, Reset, Capture buttons — same as Task 2 */}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          if (!bonusTimer) return;
          bonusTimer.isRunning
            ? liveStopTimer(bonusTimer.id)
            : liveStartTimer(bonusTimer.id);
        }}
        disabled={!bonusTimer}
      >
        {bonusTimer?.isRunning ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
        {bonusTimer?.isRunning ? "Stop" : "Start"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => bonusTimer && liveResetTimer(bonusTimer.id)} disabled={!bonusTimer}>
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          if (!bonusTimer) return;
          const elapsedMs = getTimerElapsedMs(bonusTimer, Date.now());
          const timerValue = formatDuration(elapsedMs);
          liveSetEventBonusAnswer(question.id, timerValue, true);
        }}
        disabled={!bonusTimer}
      >
        <Timer className="mr-1 h-4 w-4" />
        Capture Time
      </Button>
    </div>
  </div>
) : null}
```

Compute `bonusTimerId`, `bonusTimer`, `bonusTimerElapsed` inside the question `.map()` callback using `toEventBonusTimerId(question.id)`.

**Step 3: Run type-check**

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: No errors

**Step 4: Commit**

```
feat: add timer UI for time-based event bonus questions in host app
```

---

### Task 4: Add counter UI for numerical threshold questions in host app

For threshold questions with `valueType === "numerical"`, add +/- increment/decrement buttons so the host can easily track counts (e.g., "How many finishers?"). The numeric value is stored as the answer, and the scoring engine's Path B automatically derives the correct Over/Under label.

**Files:**
- Modify: `components/pick-em/live-host/host-match-section.tsx`
- Modify: `components/pick-em/live-host/host-event-bonus-section.tsx`

**Step 1: Add `parseCountAnswer` helper to both files**

Add this helper (same as in `live-key-match-section.tsx`):

```typescript
function parseCountAnswer(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
```

**Step 2: Update threshold branch in host-match-section.tsx**

Currently the threshold branch (around line 845) shows Over/Under buttons for ALL threshold questions. Change it to branch on `question.valueType`:

```tsx
{question.answerType === "threshold" ? (
  <div className="space-y-1.5">
    {question.valueType === "numerical" ? (
      /* Counter UI for numerical thresholds */
      <div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const current = parseCountAnswer(answer?.answer);
              liveSetMatchBonusAnswer(
                match.id,
                question.id,
                String(Math.max(0, current - 1)),
                false,
              );
            }}
          >
            −
          </Button>
          <span className="min-w-[3rem] rounded-md border border-border px-3 py-1.5 text-center font-mono text-lg">
            {parseCountAnswer(answer?.answer)}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const current = parseCountAnswer(answer?.answer);
              liveSetMatchBonusAnswer(
                match.id,
                question.id,
                String(current + 1),
                false,
              );
            }}
          >
            +
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              liveSetMatchBonusAnswer(match.id, question.id, "", false)
            }
            disabled={(answer?.answer ?? "").trim().length === 0}
          >
            Clear
          </Button>
        </div>
        {question.thresholdValue != null ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Threshold: {question.thresholdValue}
            {(answer?.answer ?? "").trim() ? (
              <>
                {" · "}
                Result:{" "}
                {parseCountAnswer(answer?.answer) > question.thresholdValue
                  ? (question.thresholdLabels ?? ["Over", "Under"])[0]
                  : (question.thresholdLabels ?? ["Over", "Under"])[1]}
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    ) : (
      /* Over/Under buttons for non-numerical thresholds (time, string) */
      <div className="flex gap-2">
        {(question.thresholdLabels ?? ["Over", "Under"]).map((label) => (
          <button
            key={label}
            type="button"
            onClick={() =>
              liveSetMatchBonusAnswer(match.id, question.id, label, false)
            }
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
              normalizeText(answer?.answer ?? "") === normalizeText(label)
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-card-foreground hover:border-primary/50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    )}
    {question.thresholdValue != null && question.valueType !== "numerical" ? (
      <p className="text-xs text-muted-foreground">
        Threshold: {formatThresholdValue(question.thresholdValue, question.valueType)}
      </p>
    ) : null}
  </div>
)
```

Note: for time-based threshold questions, the Over/Under buttons still appear (the timer Capture button from Task 2 provides the numeric path). For numerical threshold questions, the counter provides the value and the Over/Under result is automatically derived and displayed.

**Step 3: Apply same counter pattern to host-event-bonus-section.tsx**

Same change: in the threshold branch, add numerical counter UI with automatic Over/Under derivation.

**Step 4: Update scoring to handle numeric string answers from counters**

The scoring engine's Path B already handles this correctly — if `keyAnswer` is a numeric string like `"7"`, `parseValueByType(keyAnswer, "numerical")` returns `7`, which is compared to `question.thresholdValue`. No scoring changes needed.

**Step 5: Run type-check**

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: No errors

**Step 6: Commit**

```
feat: add counter UI for numerical threshold questions in host app
```

---

### Task 5: Add counter UI for numerical (non-threshold) bonus questions in host app

The old live-key app also shows a counter for ANY bonus question with `valueType === "numerical"` (not just thresholds). Port this to the new host app. This replaces the text input with +/- buttons for numerical questions.

**Files:**
- Modify: `components/pick-em/live-host/host-match-section.tsx`
- Modify: `components/pick-em/live-host/host-event-bonus-section.tsx`

**Step 1: Update the write-in branch to check for numerical valueType**

In the current three-way branch (threshold → multiple-choice → write-in), update the write-in (else) branch to check `question.valueType === "numerical"`:

```tsx
) : question.valueType === "numerical" ? (
  /* Counter UI for non-threshold numerical questions */
  <div className="flex items-center gap-2">
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        const current = parseCountAnswer(answer?.answer);
        liveSetMatchBonusAnswer(
          match.id,
          question.id,
          String(Math.max(0, current - 1)),
          false,
        );
      }}
    >
      −
    </Button>
    <span className="min-w-[3rem] rounded-md border border-border px-3 py-1.5 text-center font-mono text-lg">
      {parseCountAnswer(answer?.answer)}
    </span>
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        const current = parseCountAnswer(answer?.answer);
        liveSetMatchBonusAnswer(
          match.id,
          question.id,
          String(current + 1),
          false,
        );
      }}
    >
      +
    </Button>
    <Button
      size="sm"
      variant="outline"
      onClick={() => liveSetMatchBonusAnswer(match.id, question.id, "", false)}
      disabled={(answer?.answer ?? "").trim().length === 0}
    >
      Clear
    </Button>
  </div>
) : (
  /* Existing Input for write-in text */
  <Input ... />
)
```

So the full branching becomes: threshold → multiple-choice → numerical counter → write-in Input.

**Step 2: Apply to host-event-bonus-section.tsx**

Same pattern.

**Step 3: Run type-check**

Run: `npx tsc --noEmit 2>&1 | grep -v ".next/"`
Expected: No errors

**Step 4: Commit**

```
feat: add counter UI for numerical bonus questions in host app
```
