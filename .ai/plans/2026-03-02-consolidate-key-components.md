# Consolidate Key Components Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge duplicated keying UI into shared components, rename LiveKeyApp → SoloKeyApp, and reduce maintenance surface area.

**Architecture:** The two shell apps (`SoloKeyApp` for solo offline-first keying, `LiveGameKeyHostApp` for multiplayer server-first hosting) remain separate. The child keying UI components (match section, event bonus section) are consolidated into shared components with optional props for host-only features (locks, fuzzy review). Utility functions for timer seeding and question-type normalization are extracted to shared modules.

**Tech Stack:** React 18, TypeScript, Zustand (store), Next.js App Router, Tailwind CSS, lucide-react icons.

**Design doc:** `docs/plans/2026-03-02-consolidate-key-components-design.md`

---

## Task 1: Extract `getQuestionValueType` to `lib/pick-em/timer-utils.ts`

This helper derives `"time" | "numerical" | "string" | "rosterMember"` from a question object. It currently lives as a local function in both `live-key-app.tsx:330-345` and `live-key/live-key-match-section.tsx:41-56` and `live-key/event-bonus-section.tsx:38-53`. We consolidate it into the timer-utils module.

**Files:**
- Modify: `lib/pick-em/timer-utils.ts` (add export)
- Modify: `tests/unit/lib/pick-em/timer-utils.test.ts` (add tests)

**Step 1: Write the failing test**

Add to `tests/unit/lib/pick-em/timer-utils.test.ts`:

```typescript
import {
  // ... existing imports ...
  getQuestionValueType,
} from "@/lib/pick-em/timer-utils";

describe("getQuestionValueType", () => {
  test("returns valueType directly when it is numerical, time, or rosterMember", () => {
    assert.equal(getQuestionValueType({ valueType: "numerical" }), "numerical");
    assert.equal(getQuestionValueType({ valueType: "time" }), "time");
    assert.equal(getQuestionValueType({ valueType: "rosterMember" }), "rosterMember");
  });

  test("falls back to time when isTimeBased is true", () => {
    assert.equal(getQuestionValueType({ isTimeBased: true }), "time");
  });

  test("falls back to numerical when isCountBased is true", () => {
    assert.equal(getQuestionValueType({ isCountBased: true }), "numerical");
  });

  test("defaults to string for unrecognized shapes", () => {
    assert.equal(getQuestionValueType({}), "string");
    assert.equal(getQuestionValueType({ valueType: "string" }), "string");
  });

  test("prioritizes explicit valueType over boolean flags", () => {
    assert.equal(
      getQuestionValueType({ valueType: "numerical", isTimeBased: true }),
      "numerical",
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/pick-em/timer-utils.test.ts`
Expected: FAIL — `getQuestionValueType` is not exported from `timer-utils`.

**Step 3: Write minimal implementation**

Add to the end of `lib/pick-em/timer-utils.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/pick-em/timer-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: extract getQuestionValueType to timer-utils
```

---

## Task 2: Extract `ensureSystemTimers` to `lib/pick-em/timer-utils.ts`

This function walks matches and event bonus questions to create/update system timer entries. Currently duplicated as `ensureSystemTimers` in `live-key-app.tsx:374-425` and `ensureAllTimers` in `live-game-key-host-app.tsx:76-107`. The live-key version is the base (handles custom timer separation).

**Files:**
- Modify: `lib/pick-em/timer-utils.ts` (add export)
- Modify: `tests/unit/lib/pick-em/timer-utils.test.ts` (add tests)

**Step 1: Write the failing test**

Add to `tests/unit/lib/pick-em/timer-utils.test.ts`:

```typescript
import type { CardLiveKeyPayload, LiveKeyTimer, Match, BonusQuestion } from "@/lib/types";
import {
  // ... existing imports ...
  ensureSystemTimers,
} from "@/lib/pick-em/timer-utils";

describe("ensureSystemTimers", () => {
  const emptyPayload: CardLiveKeyPayload = {
    timers: [],
    matchResults: [],
    eventBonusAnswers: [],
    tiebreakerAnswer: "",
    tiebreakerRecordedAt: null,
    tiebreakerTimerId: null,
    scoreOverrides: [],
    winnerOverrides: [],
  };

  function makeMatch(id: string, title: string, bonusQuestions: BonusQuestion[] = []): Match {
    return {
      id,
      type: "singles",
      typeLabelOverride: "",
      isBattleRoyal: false,
      isEliminationStyle: false,
      title,
      description: "",
      participants: [],
      surpriseSlots: 0,
      surpriseEntrantPoints: null,
      bonusQuestions,
      points: null,
    };
  }

  test("creates match timers for each match", () => {
    const matches = [makeMatch("m1", "Title Match"), makeMatch("m2", "Tag Match")];
    const result = ensureSystemTimers(emptyPayload, matches, []);
    assert.equal(result.timers.length, 2);
    assert.equal(result.timers[0].id, "match:m1");
    assert.ok(result.timers[0].label.includes("Title Match"));
    assert.equal(result.timers[1].id, "match:m2");
  });

  test("creates bonus timers for time-based bonus questions", () => {
    const bonus: BonusQuestion = {
      id: "q1",
      question: "How long?",
      points: null,
      answerType: "write-in",
      options: [],
      valueType: "time",
    };
    const matches = [makeMatch("m1", "Main Event", [bonus])];
    const result = ensureSystemTimers(emptyPayload, matches, []);
    assert.equal(result.timers.length, 2); // match timer + bonus timer
    assert.equal(result.timers[1].id, "match-bonus:m1:q1");
  });

  test("skips bonus timers for non-time bonus questions", () => {
    const bonus: BonusQuestion = {
      id: "q1",
      question: "Who wins?",
      points: null,
      answerType: "write-in",
      options: [],
      valueType: "string",
    };
    const matches = [makeMatch("m1", "Main Event", [bonus])];
    const result = ensureSystemTimers(emptyPayload, matches, []);
    assert.equal(result.timers.length, 1); // match timer only
  });

  test("creates event bonus timers for time-based event questions", () => {
    const eventQ: BonusQuestion = {
      id: "eq1",
      question: "Total show time?",
      points: null,
      answerType: "write-in",
      options: [],
      valueType: "time",
    };
    const result = ensureSystemTimers(emptyPayload, [], [eventQ]);
    assert.equal(result.timers.length, 1);
    assert.equal(result.timers[0].id, "event-bonus:eq1");
  });

  test("preserves existing timer state (elapsedMs, isRunning)", () => {
    const existingTimer: LiveKeyTimer = {
      id: "match:m1",
      label: "Old Label",
      elapsedMs: 5000,
      isRunning: true,
      startedAt: "2025-01-01T00:00:00Z",
    };
    const payloadWithTimer = { ...emptyPayload, timers: [existingTimer] };
    const matches = [makeMatch("m1", "New Title")];
    const result = ensureSystemTimers(payloadWithTimer, matches, []);
    assert.equal(result.timers[0].elapsedMs, 5000);
    assert.equal(result.timers[0].isRunning, true);
    assert.ok(result.timers[0].label.includes("New Title")); // label updated
  });

  test("preserves custom (non-system) timers at the end", () => {
    const customTimer: LiveKeyTimer = {
      id: "custom:my-timer",
      label: "My Timer",
      elapsedMs: 0,
      isRunning: false,
      startedAt: null,
    };
    const payloadWithCustom = { ...emptyPayload, timers: [customTimer] };
    const matches = [makeMatch("m1", "Match 1")];
    const result = ensureSystemTimers(payloadWithCustom, matches, []);
    assert.equal(result.timers.length, 2);
    assert.equal(result.timers[0].id, "match:m1"); // system first
    assert.equal(result.timers[1].id, "custom:my-timer"); // custom at end
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/pick-em/timer-utils.test.ts`
Expected: FAIL — `ensureSystemTimers` is not exported from `timer-utils`.

**Step 3: Write minimal implementation**

Add to `lib/pick-em/timer-utils.ts`. Import the needed types at the top of the file:

```typescript
import type { LiveKeyTimer, CardLiveKeyPayload, Match, BonusQuestion } from "@/lib/types";
```

Then add to the end of the file:

```typescript
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
      const bonusLabel = buildMatchBonusTimerLabel(match, index, question.question);
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/pick-em/timer-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: extract ensureSystemTimers to timer-utils
```

---

## Task 3: Update shell apps to use extracted utilities

Replace the local `ensureSystemTimers`/`ensureAllTimers` and `getQuestionValueType` in both shell apps with imports from `timer-utils`.

**Files:**
- Modify: `components/pick-em/live-key-app.tsx`
- Modify: `components/pick-em/live-game-key-host-app.tsx`

**Step 1: Update `live-key-app.tsx`**

1. Add `ensureSystemTimers` and `getQuestionValueType` to the existing import from `@/lib/pick-em/timer-utils`
2. Delete the local `getQuestionValueType` function (lines 330-345)
3. Delete the local helper functions: `buildMatchTimerLabel`, `buildMatchBonusTimerLabel`, `buildEventBonusTimerLabel`, `createTimer`, `ensureSystemTimers` (lines 347-425)
4. The rest of the file should work unchanged — these were only called from `ensureSystemTimers` and the match section

**Step 2: Update `live-game-key-host-app.tsx`**

1. Add `ensureSystemTimers` to the import from `@/lib/pick-em/timer-utils`
2. Delete the local `ensureTimer` function (lines 53-74)
3. Delete the local `ensureAllTimers` function (lines 76-107)
4. Replace calls to `ensureAllTimers(...)` with `ensureSystemTimers(...)` (lines 151-154, 663-667)
5. Import `CardLiveKeyPayload` type if needed (since `ensureSystemTimers` uses it). Note: `LiveGameKeyPayload` is already a type alias for `CardLiveKeyPayload`, so either works.

**Step 3: Verify**

Run: `npx vitest run` and `npx next build` (or `make test && make lint`)
Expected: All tests pass, no type errors.

**Step 4: Commit**

```
refactor: use shared ensureSystemTimers in both shell apps
```

---

## Task 4: Create shared `KeyMatchSection` component

This is the largest task. Merge `live-key/live-key-match-section.tsx` (725 lines) and `live-host/host-match-section.tsx` (1053 lines) into a single shared component. The host version is the superset — use it as the base and add the solo-key features it's missing.

**Files:**
- Create: `components/pick-em/shared/key-match-section.tsx`

**Merge strategy:**

Start from the host version (`host-match-section.tsx`) as the base since it has all features. Then:

1. **Props interface** — Remove `gameId` prop. Add all host-only features as optional props:
   ```typescript
   interface KeyMatchSectionProps {
     matchIndex: number;
     roster: UseRosterSuggestionsReturn;
     // Host-only (all optional)
     lockState?: LiveGameLockState | null;
     gameState?: LiveGameStateResponse | null;
     onToggleMatchLock?: (matchId: string, locked: boolean) => void;
     onToggleMatchBonusLock?: (matchId: string, questionId: string, locked: boolean) => void;
     onAcceptWinnerOverride?: (matchId: string, playerNickname: string, confidence: number) => void;
     onRejectWinnerOverride?: (matchId: string, playerNickname: string) => void;
     onAcceptBonusOverride?: (questionId: string, playerNickname: string, confidence: number) => void;
     onRejectBonusOverride?: (questionId: string, playerNickname: string) => void;
   }
   ```

2. **Store selectors** — Keep all selectors from both versions. The host-only selectors (`useLiveLockState`, `useLiveGameState`) are NO LONGER read from the store — they come from props. This means the shared component has fewer store dependencies.

3. **Lock controls** — Wrap all lock buttons and lock-related UI in `{onToggleMatchLock && (...)}` or `{lockState && (...)}` conditionals.

4. **Fuzzy review panels** — Wrap in `{onAcceptWinnerOverride && gameState && (...)}` conditionals. Import `FuzzyReviewPanel` from `@/components/pick-em/live-host/fuzzy-match-review-panel` (it stays in live-host/).

5. **Winner input** — Use the host's Popover/Command/Combobox pattern (more capable than the solo key's Select dropdown). Both consumers get the better UX.

6. **Elimination order** — Include unconditionally (per design decision — it's a keying concern).

7. **Timer selection** — Port the solo key's "Use Different Timer" dropdown feature. The host version currently only uses BonusTimerCapture without alternate timer selection. Add the alternate timer logic from the solo-key version. Gate behind a simple check: if there are multiple timers available, show the selection UI.

8. **`formatThresholdValue` helper** — This is duplicated in both host sections. Define it once at the top of this file (or extract to `text-utils.ts` if it's used elsewhere).

9. **`getQuestionValueType`** — Import from `@/lib/pick-em/timer-utils` (extracted in Task 1).

10. **Export** — `export const KeyMatchSection = React.memo(KeyMatchSectionInner);`

**Step 1: Create the file**

Build `components/pick-em/shared/key-match-section.tsx` following the merge strategy above. Read both source files carefully before starting. The host version is the base — add solo-key features (alternate timer selection, timestamp display) where they're missing.

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```
feat: create shared KeyMatchSection component
```

---

## Task 5: Create shared `KeyEventBonusSection` component

Merge `live-key/event-bonus-section.tsx` (394 lines) and `live-host/host-event-bonus-section.tsx` (387 lines) into a single shared component. Same strategy as Task 4.

**Files:**
- Create: `components/pick-em/shared/key-event-bonus-section.tsx`

**Merge strategy:**

Start from the host version as the base. Then:

1. **Props interface** — Remove `gameId` prop. Add host-only as optional props:
   ```typescript
   interface KeyEventBonusSectionProps {
     roster: UseRosterSuggestionsReturn;
     // Host-only (all optional)
     lockState?: LiveGameLockState | null;
     gameState?: LiveGameStateResponse | null;
     onToggleEventBonusLock?: (questionId: string, locked: boolean) => void;
     onAcceptOverride?: (questionId: string, playerNickname: string, confidence: number) => void;
     onRejectOverride?: (questionId: string, playerNickname: string) => void;
   }
   ```

2. **Lock controls** — Wrap in optional prop conditionals.

3. **Fuzzy review panels** — Wrap in optional prop conditionals.

4. **Timer selection** — Port the solo key's alternate timer selection feature (same approach as Task 4).

5. **Section heading** — Use "Event Bonus Questions" as a neutral heading (currently "Event Bonus Answers" in solo key, "Event Bonus Results" in host).

6. **Export** — `export const KeyEventBonusSection = React.memo(KeyEventBonusSectionInner);`

**Step 1: Create the file**

Build `components/pick-em/shared/key-event-bonus-section.tsx` following the merge strategy above.

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```
feat: create shared KeyEventBonusSection component
```

---

## Task 6: Wire up `LiveGameKeyHostApp` to use shared components

Replace the host-specific match and event bonus sections with the new shared components. The host app passes its lock/fuzzy-review callbacks as props.

**Files:**
- Modify: `components/pick-em/live-game-key-host-app.tsx`

**Step 1: Update imports**

Replace:
```typescript
import { HostMatchSection } from "./live-host/host-match-section";
import { HostEventBonusSection } from "./live-host/host-event-bonus-section";
```
With:
```typescript
import { KeyMatchSection } from "./shared/key-match-section";
import { KeyEventBonusSection } from "./shared/key-event-bonus-section";
```

**Step 2: Extract lock toggle and fuzzy override callbacks**

Move the lock toggle and fuzzy override logic that was previously inside the host match/event bonus sections into callbacks defined in `LiveGameKeyHostApp`. These callbacks call `updateLiveGameLocks(gameId, ...)` and update `scoreOverrides`/`winnerOverrides` on the payload. They need to be in the host app because they require `gameId`.

Define these callbacks:
- `handleToggleMatchLock(matchId, locked)`
- `handleToggleMatchBonusLock(matchId, questionId, locked)`
- `handleToggleEventBonusLock(questionId, locked)`
- `handleAcceptWinnerOverride(matchId, playerNickname, confidence)`
- `handleRejectWinnerOverride(matchId, playerNickname)`
- `handleAcceptBonusOverride(questionId, playerNickname, confidence)`
- `handleRejectBonusOverride(questionId, playerNickname)`

These can be extracted from the existing code in `host-match-section.tsx` (lines 218-451) and `host-event-bonus-section.tsx` (lines 87-176).

**Step 3: Update JSX**

Replace:
```tsx
<HostMatchSection key={match.id} matchIndex={index} roster={roster} gameId={gameId} />
```
With:
```tsx
<KeyMatchSection
  key={match.id}
  matchIndex={index}
  roster={roster}
  lockState={lockState}
  gameState={gameState}
  onToggleMatchLock={handleToggleMatchLock}
  onToggleMatchBonusLock={handleToggleMatchBonusLock}
  onAcceptWinnerOverride={handleAcceptWinnerOverride}
  onRejectWinnerOverride={handleRejectWinnerOverride}
  onAcceptBonusOverride={handleAcceptBonusOverride}
  onRejectBonusOverride={handleRejectBonusOverride}
/>
```

Similarly for `KeyEventBonusSection`.

**Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All passes.

**Step 5: Commit**

```
refactor: wire LiveGameKeyHostApp to shared key components
```

---

## Task 7: Rename `LiveKeyApp` → `SoloKeyApp` and directory `live-key/` → `solo-key/`

**Files:**
- Rename: `components/pick-em/live-key/` → `components/pick-em/solo-key/`
- Rename: `components/pick-em/live-key-app.tsx` → `components/pick-em/solo-key-app.tsx`
- Rename: `components/pick-em/solo-key/live-key-header.tsx` → `components/pick-em/solo-key/solo-key-header.tsx`
- Modify: `app/cards/[cardId]/live/solo/page.tsx`

**Step 1: Rename the directory**

```bash
git mv components/pick-em/live-key components/pick-em/solo-key
```

**Step 2: Rename files**

```bash
git mv components/pick-em/live-key-app.tsx components/pick-em/solo-key-app.tsx
git mv components/pick-em/solo-key/live-key-header.tsx components/pick-em/solo-key/solo-key-header.tsx
```

**Step 3: Update component names and exports**

In `solo-key-app.tsx`:
- Rename `LiveKeyApp` → `SoloKeyApp` (the exported function)
- Update imports from `./live-key/` → `./solo-key/`
- Update import of `LiveKeyHeader` → `SoloKeyHeader`

In `solo-key-header.tsx`:
- Rename `LiveKeyHeader` → `SoloKeyHeader`
- Rename `LiveKeyHeaderProps` → `SoloKeyHeaderProps`

**Step 4: Update page route**

In `app/cards/[cardId]/live/solo/page.tsx`:
```typescript
// Before
import { LiveKeyApp } from "@/components/pick-em/live-key-app";
// After
import { SoloKeyApp } from "@/components/pick-em/solo-key-app";
```

Update JSX: `<LiveKeyApp cardId={cardId} />` → `<SoloKeyApp cardId={cardId} />`

**Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 6: Commit**

```
refactor: rename LiveKeyApp to SoloKeyApp
```

---

## Task 8: Wire up `SoloKeyApp` to use shared components

Replace the solo-key-specific match and event bonus sections with the shared components. The solo app passes no host-only props.

**Files:**
- Modify: `components/pick-em/solo-key-app.tsx`

**Step 1: Update imports**

Replace:
```typescript
import { LiveKeyMatchSection } from "@/components/pick-em/solo-key/live-key-match-section";
import { EventBonusSection } from "@/components/pick-em/solo-key/event-bonus-section";
```
With:
```typescript
import { KeyMatchSection } from "@/components/pick-em/shared/key-match-section";
import { KeyEventBonusSection } from "@/components/pick-em/shared/key-event-bonus-section";
```

**Step 2: Update JSX**

Replace:
```tsx
<LiveKeyMatchSection key={match.id} matchIndex={index} roster={roster} />
```
With:
```tsx
<KeyMatchSection key={match.id} matchIndex={index} roster={roster} />
```

Replace:
```tsx
<EventBonusSection roster={roster} />
```
With:
```tsx
<KeyEventBonusSection roster={roster} />
```

No host-only props are passed — the shared components render in "solo mode" when those props are absent.

**Step 3: Delete the local `getQuestionValueType`**

If still present in the solo key's child components — they are about to be deleted, but ensure `solo-key-app.tsx` itself no longer has a local copy (should have been cleaned up in Task 3).

**Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All passes.

**Step 5: Commit**

```
refactor: wire SoloKeyApp to shared key components
```

---

## Task 9: Delete old component files

Now that both shell apps use the shared components, delete the old per-app versions.

**Files:**
- Delete: `components/pick-em/solo-key/live-key-match-section.tsx`
- Delete: `components/pick-em/solo-key/event-bonus-section.tsx`
- Delete: `components/pick-em/live-host/host-match-section.tsx`
- Delete: `components/pick-em/live-host/host-event-bonus-section.tsx`

**Step 1: Delete the files**

```bash
git rm components/pick-em/solo-key/live-key-match-section.tsx
git rm components/pick-em/solo-key/event-bonus-section.tsx
git rm components/pick-em/live-host/host-match-section.tsx
git rm components/pick-em/live-host/host-event-bonus-section.tsx
```

**Step 2: Verify no remaining imports reference deleted files**

Run: `npx tsc --noEmit`
Expected: No errors. If any imports remain, fix them.

**Step 3: Commit**

```
refactor: delete old per-app match and bonus section components
```

---

## Task 10: Final verification

**Step 1: Run full test suite**

```bash
make test
```

**Step 2: Run linter**

```bash
make lint
```

**Step 3: Run formatter**

```bash
make fmt
```

**Step 4: Build**

```bash
npx next build
```

Expected: All green. Zero errors, zero warnings.

**Step 5: Manual smoke test**

Open both routes in the browser and verify they render correctly:
- `/cards/[cardId]/live/solo` — Solo key app
- `/games/[gameId]/host` — Host app

Verify:
- Match sections render with winner input, battle royal, elimination order, bonus questions
- Timer controls work (start/stop/reset)
- Bonus timer capture works
- Counter inputs, threshold buttons, multiple-choice selects all render
- Host-only: Lock buttons appear
- Host-only: Fuzzy review panels appear when player data exists
- Solo: No lock buttons or fuzzy review panels

**Step 6: Final commit if any fixes were needed**

```
chore: final verification fixes for key component consolidation
```
