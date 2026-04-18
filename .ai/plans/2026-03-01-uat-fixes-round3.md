# UAT Fixes Round 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address 7 UAT feedback items from live testing: fix mobile scroll locking on dropdowns, hide surprise entrants when 0 slots, add elimination order tracking, improve leaderboard visibility in combined viewer, filter lock events from updates feed, fix threshold/multiple-choice keying UX in host app, and add Select dropdowns for multiple-choice in both player and host apps.

**Architecture:** Changes span UI components (player, host, display), the Zustand store, the payload utilities, server-side types, API schemas, and scoring logic. Tasks 6 and 7 are coupled (both fix host keying UX). All other tasks are independent.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Radix UI, Zustand, Next.js API routes, Zod

---

### Task 1: Fix mobile scroll locking when Select dropdowns are open

Radix UI's `Select` component uses `react-remove-scroll` internally, which locks body scroll when the dropdown is open. On mobile this blocks all page scrolling. The fix is to add `modal={false}` to `SelectContent`, which tells Radix not to trap scroll.

**Files:**
- Modify: `components/ui/select.tsx:53-86`

**Step 1: Add `modal={false}` to the SelectContent primitive**

In `components/ui/select.tsx`, the `SelectContent` function wraps `SelectPrimitive.Content`. Add `modal={false}` so Radix doesn't lock body scroll:

```tsx
function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        modal={false}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-32 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width) scroll-my-1",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}
```

The only change is adding `modal={false}` on line with `SelectPrimitive.Content`.

**Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
fix: disable scroll locking on Select dropdowns for mobile usability
```

---

### Task 2: Hide surprise entrants section when 0 slots selected

The player app shows the surprise entrants input section whenever `match.isBattleRoyal` is true, even when `match.surpriseSlots === 0`. It should only show when there are actual surprise slots configured.

**Files:**
- Modify: `components/pick-em/live-player/player-match-picks.tsx:158`

**Step 1: Add surpriseSlots guard to the conditional**

In `player-match-picks.tsx`, find the battle royal section at line 158:

```tsx
{match.isBattleRoyal ? (
```

Change to:

```tsx
{match.isBattleRoyal && match.surpriseSlots > 0 ? (
```

This hides the entire surprise entrants input area (label, input, add button, autocomplete suggestions, entrant list) when there are no surprise slots configured.

**Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
fix: hide surprise entrants section when no surprise slots configured
```

---

### Task 3: Record elimination order in host keying app

Add a new "Elimination Order" section to the host keying UI for battle royal matches with `isEliminationStyle === true`. The host records each elimination as it happens, building an ordered list. This is stored as a new `battleRoyalEliminationOrder` field on the key payload's match result.

**Files:**
- Modify: `lib/types.ts:127-133` — add `battleRoyalEliminationOrder` to `LiveKeyMatchResult`
- Modify: `lib/pick-em/payload-utils.ts` — add `addEliminationEntry` and `removeEliminationEntry` helpers
- Modify: `stores/live-game-slice.ts` — add store actions for elimination tracking
- Modify: `stores/selectors.ts` — add selector for elimination input state if needed
- Modify: `components/pick-em/live-host/host-match-section.tsx` — add elimination order UI section
- Modify: `lib/server/repositories/live-keys.ts` — normalize new field in payload
- Modify: `app/api/live-games/[gameId]/key/route.ts:19-29` — add field to zod schema
- Modify: `app/api/cards/[cardId]/live-key/route.ts:19-29` — add field to zod schema

**Step 1: Add `battleRoyalEliminationOrder` to `LiveKeyMatchResult`**

In `lib/types.ts`, update the interface:

```typescript
export interface LiveKeyMatchResult {
  matchId: string;
  winnerName: string;
  winnerRecordedAt: string | null;
  battleRoyalEntryOrder: string[];
  battleRoyalEliminationOrder: string[];
  bonusAnswers: LiveKeyAnswer[];
}
```

**Step 2: Update `ensureMatchResult` in payload-utils.ts**

In `lib/pick-em/payload-utils.ts`, update the `ensureMatchResult` function to initialize the new field:

```typescript
function ensureMatchResult(
  payload: CardLiveKeyPayload,
  matchId: string,
): { results: LiveKeyMatchResult[]; index: number } {
  const results = [...payload.matchResults];
  let index = results.findIndex((result) => result.matchId === matchId);

  if (index === -1) {
    results.push({
      matchId,
      winnerName: "",
      winnerRecordedAt: null,
      battleRoyalEntryOrder: [],
      battleRoyalEliminationOrder: [],
      bonusAnswers: [],
    });
    index = results.length - 1;
  }

  return { results, index };
}
```

**Step 3: Add elimination order helpers in payload-utils.ts**

Add after `setBattleRoyalEntryOrder`:

```typescript
export function addEliminationEntry(
  payload: CardLiveKeyPayload,
  matchId: string,
  entrantName: string,
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  results[index] = {
    ...results[index],
    battleRoyalEliminationOrder: [
      ...results[index].battleRoyalEliminationOrder,
      entrantName,
    ],
  };
  return { ...payload, matchResults: results };
}

export function removeEliminationEntry(
  payload: CardLiveKeyPayload,
  matchId: string,
  entryIndex: number,
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  results[index] = {
    ...results[index],
    battleRoyalEliminationOrder:
      results[index].battleRoyalEliminationOrder.filter(
        (_, i) => i !== entryIndex,
      ),
  };
  return { ...payload, matchResults: results };
}
```

**Step 4: Add store actions in live-game-slice.ts**

Find the existing `liveAddBattleRoyalEntrant` and `liveRemoveBattleRoyalEntrant` actions. Add parallel actions for elimination order. The exact implementation follows the same pattern — import the new helpers from `payload-utils` and call them to update `state.livePayload`.

Add two new actions to the slice:
- `liveAddEliminationEntry(matchId: string, entrantName: string)` — calls `addEliminationEntry`
- `liveRemoveEliminationEntry(matchId: string, entryIndex: number)` — calls `removeEliminationEntry`

Also add `eliminationEntryInputByMatchId: Record<string, string>` to the state (same pattern as `battleRoyalEntryInputByMatchId`) and a setter action `setEliminationEntryInput(matchId: string, value: string)`.

**Step 5: Update the key payload Zod schemas**

In `app/api/live-games/[gameId]/key/route.ts`, update `matchResultSchema`:

```typescript
const matchResultSchema = z.object({
  matchId: z.string().uuid(),
  winnerName: z.string().trim().max(160),
  winnerRecordedAt: z.string().datetime().nullable(),
  battleRoyalEntryOrder: z
    .array(z.string().trim().min(1).max(160))
    .max(120)
    .optional()
    .default([]),
  battleRoyalEliminationOrder: z
    .array(z.string().trim().min(1).max(160))
    .max(120)
    .optional()
    .default([]),
  bonusAnswers: z.array(answerSchema).max(100),
});
```

Apply the same change to `app/api/cards/[cardId]/live-key/route.ts`.

**Step 6: Update server-side normalization**

In `lib/server/repositories/live-keys.ts`, find `normalizeLiveKeyPayload` and update the match result normalization to include the new field:

```typescript
battleRoyalEliminationOrder: Array.isArray(raw.battleRoyalEliminationOrder)
  ? raw.battleRoyalEliminationOrder
      .filter((e: unknown) => typeof e === "string" && e.trim())
      .map((e: string) => e.trim())
  : [],
```

**Step 7: Add elimination order UI to host-match-section.tsx**

In `components/pick-em/live-host/host-match-section.tsx`, after the existing battle royal entry order section (ends around line 601), add a new elimination order section. Only show when `match.isEliminationStyle`:

```tsx
{match.isEliminationStyle ? (
  <div className="space-y-2">
    <Label>Elimination Order</Label>
    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
      <Input
        ref={eliminationInputRef}
        value={eliminationEntryInput}
        onChange={(event) => {
          setEliminationEntryInput(match.id, event.target.value);
          roster.setActiveInput(
            eliminationFieldKey,
            event.target.value,
          );
        }}
        onFocus={() =>
          roster.setActiveInput(
            eliminationFieldKey,
            eliminationEntryInput,
          )
        }
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          addEliminationEntry(eliminationEntryInput);
        }}
        placeholder="Add eliminated wrestler"
      />
      <Button
        type="button"
        variant="secondary"
        onClick={() => addEliminationEntry(eliminationEntryInput)}
      >
        <Plus className="mr-1 h-4 w-4" />
        Eliminated
      </Button>
    </div>
    {/* Roster autocomplete suggestions — same pattern as entry order */}
    {eliminationOrder.length > 0 ? (
      <div className="space-y-1.5 rounded-md border border-border/70 bg-background/35 p-2.5">
        {eliminationOrder.map((entrant, entrantIndex) => (
          <div
            key={`elim:${entrant}:${entrantIndex}`}
            className="flex items-center justify-between gap-2"
          >
            <span className="text-sm text-foreground">
              {entrantIndex + 1}. {entrant}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => removeEliminationEntry(entrantIndex)}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Remove</span>
            </Button>
          </div>
        ))}
      </div>
    ) : null}
    <p className="text-xs text-muted-foreground">
      Record each elimination as it happens.
    </p>
  </div>
) : null}
```

Wire up `eliminationEntryInput`, `eliminationInputRef`, `eliminationFieldKey`, `eliminationOrder`, `addEliminationEntry`, `removeEliminationEntry`, and `setEliminationEntryInput` using the same patterns already used for `battleRoyalEntryOrder` in this component.

**Step 8: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 9: Commit**

```
feat: add elimination order tracking to host keying app
```

---

### Task 4: Improve leaderboard visibility in combined event viewer

The leaderboard shift section in the combined fullscreen popup is hard to see. Increase emphasis with larger fonts, score change indicators, and more contrast.

**Files:**
- Modify: `components/pick-em/shared/fullscreen-effect-overlay.tsx:80-151` (LeaderboardRows)
- Modify: `components/pick-em/shared/fullscreen-effect-overlay.tsx:186-227` (CombinedPanel)

**Step 1: Increase font sizes and add score delta in LeaderboardRows**

In `fullscreen-effect-overlay.tsx`, update `LeaderboardRows` (line 103-148). Change:

- Player name: `text-lg` → `text-xl`
- Score: `text-xl` → `text-2xl`
- Rank delta text: `text-xs` → `text-sm`
- Add a score delta display next to the rank delta

Replace lines 121-145:

```tsx
<Reorder.Item
  key={`fullscreen-lb-${nickname}`}
  value={nickname}
  className="lg-fullscreen-leaderboard-row"
  transition={{
    duration: 0.9,
    ease: [0.2, 0.8, 0.2, 1],
  }}
>
  <div className="min-w-0">
    <p className="truncate text-xl font-semibold">
      #{entry.rank} {entry.nickname}
    </p>
    <p className="text-sm text-muted-foreground">
      {previousRank == null
        ? "New to board"
        : `Was #${previousRank}`}
    </p>
  </div>
  <div className="text-right">
    <p className="font-mono text-2xl font-semibold">
      {entry.score}
    </p>
    {rankDelta > 0 ? (
      <p className="text-sm font-medium text-emerald-300">
        ▲ {rankDelta} rank
      </p>
    ) : null}
    {rankDelta < 0 ? (
      <p className="text-sm font-medium text-amber-300">
        ▼ {Math.abs(rankDelta)} rank
      </p>
    ) : null}
  </div>
</Reorder.Item>
```

**Step 2: Increase the "Leaderboard Shift" heading in CombinedPanel**

In `CombinedPanel` (line 212-216), change the heading:

```tsx
<div className="mt-4 border-t border-border/30 pt-4">
  <div className="mb-3 flex items-center gap-3">
    <Trophy className="h-6 w-6 text-primary" />
    <span className="font-heading text-2xl uppercase tracking-wide">
      Leaderboard Shift
    </span>
  </div>
```

Changes: `h-5 w-5` → `h-6 w-6`, `text-xl` → `text-2xl`.

**Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```
style: increase leaderboard visibility in combined event viewer
```

---

### Task 5: Filter lock events from recent updates feed

Lock events (`lock.global`, `lock.match`, `lock.matchBonus`, `lock.eventBonus`) are already hidden from fullscreen overlays but still appear in the "Recent Updates" feed. Users say these take up valuable space. Filter them from the updates feed.

**Files:**
- Modify: `components/pick-em/shared/updates-feed.tsx`

**Step 1: Add lock event filter**

In `updates-feed.tsx`, add a constant set at the top of the file (after imports) and filter events before rendering:

```tsx
const HIDDEN_FEED_EVENT_TYPES = new Set([
  "lock.global",
  "lock.match",
  "lock.matchBonus",
  "lock.eventBonus",
]);

function UpdatesFeedInner({
  events,
  maxItems = 15,
  variant = "compact",
}: UpdatesFeedProps) {
  const filteredEvents = events.filter(
    (event) => !HIDDEN_FEED_EVENT_TYPES.has(event.type),
  );
  const visibleEvents = filteredEvents.slice(0, maxItems);
```

Then update the empty-state check at the end of the compact variant:

```tsx
{filteredEvents.length === 0 ? (
  <p className="text-xs text-muted-foreground">No events yet.</p>
) : null}
```

**Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
fix: filter lock events from recent updates feed
```

---

### Task 6: Use Over/Under buttons for threshold questions in host keying

The host keying UI shows a plain text input for threshold questions with placeholder "Key answer". Hosts don't know what to enter. Replace with Over/Under buttons matching the player UI, so the host clicks the correct label directly.

This changes how threshold answers are keyed: instead of the host entering a raw numeric value, they click the threshold label. The scoring logic needs a small update to handle direct label matching.

**Files:**
- Modify: `components/pick-em/live-host/host-match-section.tsx:684-731`
- Modify: `components/pick-em/live-host/host-event-bonus-section.tsx:216-254`
- Modify: `lib/server/scoring.ts:96-107`

**Step 1: Update host match bonus keying for threshold questions**

In `host-match-section.tsx`, find the bonus question keying section (around line 684). Currently ALL question types use a single `<Input>`. Add threshold-specific rendering before the Input:

Replace the section from the `<Input>` (line 684) through the threshold display helper (line 731) with:

```tsx
{question.answerType === "threshold" ? (
  <div className="space-y-1.5">
    <div className="flex gap-2">
      {(question.thresholdLabels ?? ["Over", "Under"]).map(
        (label) => (
          <button
            key={label}
            type="button"
            onClick={() =>
              liveSetMatchBonusAnswer(
                match.id,
                question.id,
                label,
                false,
              )
            }
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
              normalizeText(answer?.answer ?? "") ===
              normalizeText(label)
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-card-foreground hover:border-primary/50"
            }`}
          >
            {label}
          </button>
        ),
      )}
    </div>
    {question.thresholdValue != null ? (
      <p className="text-xs text-muted-foreground">
        Threshold: {formatThresholdValue(
          question.thresholdValue,
          question.valueType,
        )}
      </p>
    ) : null}
  </div>
) : (
  <Input
    value={answer?.answer ?? ""}
    onChange={(event) => {
      liveSetMatchBonusAnswer(
        match.id,
        question.id,
        event.target.value,
        false,
      );
      roster.setActiveInput(rosterFieldKey, event.target.value);
    }}
    onFocus={() =>
      roster.setActiveInput(rosterFieldKey, answer?.answer ?? "")
    }
    placeholder={
      isRosterMemberType
        ? "Start typing a roster member..."
        : "Key answer"
    }
  />
)}
```

Note: import `normalizeText` from `@/lib/pick-em/text-utils` if not already imported.

**Step 2: Apply the same pattern to host event bonus keying**

In `host-event-bonus-section.tsx`, find the equivalent section (around line 216-254). Apply the same threshold button pattern, replacing the single `<Input>` for threshold questions with Over/Under buttons.

**Step 3: Update scoring to handle direct label matching**

In `lib/server/scoring.ts`, update the threshold scoring block (lines 96-107). Currently it parses the host's answer as a numeric value. Now the host may enter a label directly (e.g., "Over"). Add a fallback:

```typescript
// Threshold answer type: host enters actual value or label directly
if (question.answerType === "threshold" && question.thresholdValue != null) {
  const labels = question.thresholdLabels ?? ["Over", "Under"];

  // If host entered a label directly, compare labels
  if (
    answerEquals(keyAnswer, labels[0]) ||
    answerEquals(keyAnswer, labels[1])
  ) {
    return {
      score: answerEquals(playerAnswer, keyAnswer) ? points : 0,
      isClosestCandidate: false,
    };
  }

  // Otherwise, host entered a numeric value — derive the correct label
  const actualValue = parseValueByType(keyAnswer, question.valueType);
  if (actualValue === null) return { score: 0, isClosestCandidate: false };

  const correctLabel =
    actualValue > question.thresholdValue ? labels[0] : labels[1];
  return {
    score: answerEquals(playerAnswer, correctLabel) ? points : 0,
    isClosestCandidate: false,
  };
}
```

This is backward-compatible: if any existing games have raw numeric host answers, they still score correctly via the fallback path.

**Step 4: Run type-check and tests**

Run: `npx tsc --noEmit && node --test tests/unit/lib/scoring.test.ts`
Expected: PASS (existing threshold tests still pass because the test uses raw numeric values which hit the fallback path)

**Step 5: Commit**

```
fix: use Over/Under buttons for threshold questions in host keying app
```

---

### Task 7: Use Select dropdowns for multiple-choice questions in host and player keying

Both the host keying app and the player app use plain text inputs for multiple-choice questions. They should use `<Select>` dropdowns showing the defined options.

**Files:**
- Modify: `components/pick-em/live-host/host-match-section.tsx:684` (match bonus)
- Modify: `components/pick-em/live-host/host-event-bonus-section.tsx:216` (event bonus)
- Modify: `components/pick-em/live-player/player-match-picks.tsx:327-354` (match bonus)
- Modify: `components/pick-em/live-player/player-event-bonus-picks.tsx:109-132` (event bonus)

**Step 1: Update host match bonus keying for multiple-choice**

In `host-match-section.tsx`, the code from Task 6 adds threshold handling. Now add multiple-choice handling too. The full branching for the input area becomes:

```tsx
{question.answerType === "threshold" ? (
  /* ... threshold buttons from Task 6 ... */
) : question.answerType === "multiple-choice" &&
  question.options.length > 0 ? (
  <Select
    value={answer?.answer || "__none__"}
    onValueChange={(value) =>
      liveSetMatchBonusAnswer(
        match.id,
        question.id,
        value === "__none__" ? "" : value,
        false,
      )
    }
  >
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Select answer" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__none__">Unanswered</SelectItem>
      {question.options.map((option) => (
        <SelectItem key={option} value={option}>
          {option}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
) : (
  <Input
    value={answer?.answer ?? ""}
    onChange={(event) => {
      liveSetMatchBonusAnswer(
        match.id,
        question.id,
        event.target.value,
        false,
      );
      roster.setActiveInput(rosterFieldKey, event.target.value);
    }}
    onFocus={() =>
      roster.setActiveInput(rosterFieldKey, answer?.answer ?? "")
    }
    placeholder={
      isRosterMemberType
        ? "Start typing a roster member..."
        : "Key answer"
    }
  />
)}
```

Import `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` from `@/components/ui/select`.

**Step 2: Apply the same pattern to host event bonus keying**

In `host-event-bonus-section.tsx`, apply the same three-way branch: threshold → buttons, multiple-choice → Select, write-in → Input.

**Step 3: Update player match bonus picks for multiple-choice**

In `player-match-picks.tsx`, the bonus question section (around line 300) currently has threshold vs write-in branching. Add multiple-choice Select handling:

```tsx
{question.answerType === "threshold" ? (
  /* ... existing threshold buttons ... */
) : question.answerType === "multiple-choice" &&
  question.options.length > 0 ? (
  <Select
    value={answer?.answer || "__none__"}
    onValueChange={(value) =>
      onSetMatchBonusAnswer(
        match.id,
        question.id,
        value === "__none__" ? "" : value,
      )
    }
    disabled={isLocked}
  >
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Select answer" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__none__">Unanswered</SelectItem>
      {question.options.map((option) => (
        <SelectItem key={option} value={option}>
          {option}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
) : (
  /* ... existing Input for write-in ... */
)}
```

Import `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` from `@/components/ui/select` at the top of the file (it's already imported for the winner select).

**Step 4: Update player event bonus picks for multiple-choice**

In `player-event-bonus-picks.tsx`, the bonus question section (around line 86-164) currently has threshold vs write-in branching. Add the same multiple-choice Select:

```tsx
{question.answerType === "threshold" ? (
  /* ... existing threshold buttons ... */
) : question.answerType === "multiple-choice" &&
  question.options.length > 0 ? (
  <Select
    value={answer?.answer || "__none__"}
    onValueChange={(value) =>
      onSetEventBonusAnswer(
        question.id,
        value === "__none__" ? "" : value,
      )
    }
    disabled={isLocked}
  >
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Select answer" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__none__">Unanswered</SelectItem>
      {question.options.map((option) => (
        <SelectItem key={option} value={option}>
          {option}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
) : (
  /* ... existing Input for write-in ... */
)}
```

Import `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` from `@/components/ui/select`.

**Step 5: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```
fix: use Select dropdowns for multiple-choice questions in host and player apps
```
