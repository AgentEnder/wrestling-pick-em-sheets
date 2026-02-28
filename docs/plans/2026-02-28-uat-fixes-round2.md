# UAT Fixes Round 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix print sheet battle royal display, make surprise entrants selectable as winners in player/host apps, further increase display app font sizes, add autocomplete refocus behavior, and fix threshold bonus question zod validation.

**Architecture:** Changes span print-sheet rendering, player/host winner selection dropdowns, display component styling, autocomplete input focus management, match editor autocomplete, and API zod schema. Each task is independent.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

### Task 1: Fix print sheet compact battle royal layout

In compact mode (<=10 total competitors), the print sheet shows surprise slots as checkbox options in the winner grid AND as separate write-in blanks below, doubling up. The fix: remove surprises from the winner checkbox grid (only announced participants there), and add checkboxes next to each surprise guess write-in line so a surprise entrant can still be marked as winner.

**Files:**
- Modify: `components/print-sheet.tsx`

**Step 1: Remove surprise slot checkboxes from compact winner grid**

In `components/print-sheet.tsx`, find the compact battle royal section (around lines 241-254). Remove the `Array.from({ length: match.surpriseSlots })` block that generates checkbox entries for surprise slots. The winner grid should only contain announced `match.participants`.

Replace lines 228-256:

```tsx
{useCompactBattleRoyal ? (
  <div className="print-br-compact">
    <span className="print-label-inline">Winner:</span>
    <div className="print-participants-grid">
      {match.participants.map((participant, participantIndex) => (
        <label
          key={`announced:${participantIndex}`}
          className="print-participant"
        >
          <span className="print-checkbox" />
          <span>{participant}</span>
        </label>
      ))}
    </div>
  </div>
```

**Step 2: Add winner checkboxes to surprise guess lines**

In the "Surprise guess lines" section (around lines 276-291), add a `print-checkbox` span next to each surprise guess write-in line so users can mark a surprise entrant as winner:

```tsx
{match.surpriseSlots > 0 && (
  <div className="print-br-surprises">
    <span className="print-label-inline">
      Surprise guesses ({formatPointsLabel(surpriseEntrantPoints)}{" "}
      each, check winner):
    </span>
    <div className="print-surprise-grid">
      {Array.from({ length: match.surpriseSlots }).map((_, i) => (
        <div key={i} className="print-surprise-line">
          <span className="print-checkbox" />
          <span className="print-surprise-num">{i + 1}.</span>
          <span className="print-write-line-inline" />
        </div>
      ))}
    </div>
  </div>
)}
```

Key changes from current: added `<span className="print-checkbox" />` before each number, and updated the label text to say "check winner" to clarify the checkbox purpose.

**Step 3: Update compact layout space estimation**

In `estimateUnitsCompactBattleRoyal` (around line 406), remove surprise slots from the winner grid estimate:

Change:
```typescript
Math.ceil((match.participants.length + match.surpriseSlots) / 4.5),
```
to:
```typescript
Math.ceil(match.participants.length / 4.5),
```

**Step 4: Update the threshold check**

In `shouldRenderCompactBattleRoyal` (around line 46), update to only consider participant count:

Change:
```typescript
const totalCompetitors = match.participants.length + match.surpriseSlots;
```
to:
```typescript
const totalCompetitors = match.participants.length;
```

**Step 5: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```
fix: separate winner checkboxes from surprise guesses in compact battle royal print layout
```

---

### Task 2: Allow surprise entrants as winner options in player app

The player app winner dropdown only shows `match.participants`. For battle royal matches, the winner could be any surprise entrant too. Change the winner dropdown to include a free-text "Custom winner" option for battle royal matches, letting players type any name.

**Files:**
- Modify: `components/pick-em/live-player/player-match-picks.tsx`

**Step 1: Add custom winner support for battle royal matches**

In `player-match-picks.tsx`, add state tracking and update the winner `<Select>` for battle royal matches. After the `isMatchLocked` derivation (around line 81), add logic:

```tsx
const winnerInParticipants = match.participants.some(
  (p) => p === matchPick?.winnerName,
);
const winnerSelectValue = matchPick?.winnerName
  ? winnerInParticipants
    ? matchPick.winnerName
    : "__custom__"
  : "__none__";
```

Update the `<Select>` to use `winnerSelectValue` and add a "__custom__" option when `match.isBattleRoyal`:

```tsx
<Select
  value={winnerSelectValue}
  onValueChange={(value) => {
    if (value === "__none__") {
      onSetMatchWinner(match.id, "");
      return;
    }
    if (value === "__custom__") {
      const current = matchPick?.winnerName && !winnerInParticipants
        ? matchPick.winnerName
        : "";
      onSetMatchWinner(match.id, current);
      return;
    }
    onSetMatchWinner(match.id, value);
  }}
  disabled={isMatchLocked}
>
  <SelectTrigger className="w-full">
    <SelectValue placeholder="Select winner" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="__none__">Unanswered</SelectItem>
    {match.participants.map((participant) => (
      <SelectItem key={participant} value={participant}>
        {participant}
      </SelectItem>
    ))}
    {match.isBattleRoyal ? (
      <SelectItem value="__custom__">Other (type name)...</SelectItem>
    ) : null}
  </SelectContent>
</Select>
```

Then add the custom input field below the Select, visible when `__custom__` is selected:

```tsx
{winnerSelectValue === "__custom__" ? (
  <div className="space-y-1">
    <Label>Custom winner</Label>
    <Input
      value={matchPick?.winnerName ?? ""}
      onChange={(event) =>
        onSetMatchWinner(match.id, event.target.value)
      }
      disabled={isMatchLocked}
      placeholder="Type winner name"
    />
  </div>
) : null}
```

Place this after the `</Select>` closing tag, before the battle royal entrants section.

**Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
feat: allow custom winner entry for battle royal matches in player app
```

---

### Task 3: Allow any entrant as winner in host keying app

The host match section (`host-match-section.tsx`) only allows selecting from pre-defined participants. It should allow entering any name, including surprise entrants not in the initial dataset.

**Files:**
- Modify: `components/pick-em/live-host/host-match-section.tsx`

**Step 1: Add custom winner support**

In `host-match-section.tsx`, find the winner `<Select>` (around line 378). Add the same pattern as the old key editor (`live-key-match-section.tsx` already has this):

First add derived values near the top of the component where `winnerName` is used:

```tsx
const winnerInList = participants.some((name) => name === winnerName);
const winnerSelectValue = winnerName
  ? winnerInList
    ? winnerName
    : "__custom__"
  : "__none__";
```

Update the `<Select>`:

```tsx
<Select
  value={winnerSelectValue}
  onValueChange={(value) => {
    if (value === "__none__") {
      liveSetMatchWinner(match.id, "");
      return;
    }
    if (value === "__custom__") {
      const current = winnerName && !winnerInList ? winnerName : "";
      liveSetMatchWinner(match.id, current);
      return;
    }
    liveSetMatchWinner(match.id, value);
  }}
>
  <SelectTrigger className="w-full">
    <SelectValue placeholder="Select winner" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="__none__">Unanswered</SelectItem>
    {participants.map((participant) => (
      <SelectItem key={participant} value={participant}>
        {participant}
      </SelectItem>
    ))}
    <SelectItem value="__custom__">Custom winner...</SelectItem>
  </SelectContent>
</Select>
```

Add the custom input below:

```tsx
{winnerSelectValue === "__custom__" ? (
  <div className="space-y-1.5">
    <Label>Custom winner</Label>
    <Input
      placeholder="Type winner name"
      value={winnerName}
      onChange={(event) =>
        liveSetMatchWinner(match.id, event.target.value)
      }
    />
  </div>
) : null}
```

**Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
feat: allow custom winner entry in host keying app
```

---

### Task 4: Further increase display app font sizes

The display app still needs bigger fonts for TV viewing distance. Bump all display components another tier. The event log especially needs to be readable at a distance, even if fewer items show.

**Files:**
- Modify: `components/pick-em/live-display/display-header.tsx`
- Modify: `components/pick-em/shared/leaderboard-panel.tsx` (display variant)
- Modify: `components/pick-em/live-display/active-game-view.tsx`
- Modify: `components/pick-em/shared/updates-feed.tsx` (display variant)
- Modify: `components/pick-em/live-display/lobby-view.tsx`

**Step 1: Increase display header**

In `display-header.tsx`:
- Event name `h1`: `text-5xl` → `text-6xl`
- Status label: `text-base` → `text-lg`
- Join code span: `text-xl` → `text-2xl`
- Stat labels: `text-sm` → `text-base`
- Stat numbers: `text-2xl` → `text-3xl`

**Step 2: Increase leaderboard panel display variant**

In `leaderboard-panel.tsx` display variant:
- Column headers: `text-sm` → `text-base`
- Rank: `text-2xl` → `text-3xl`
- Player name: `text-xl` → `text-2xl`
- Score: `text-3xl` → `text-4xl`
- Status text: `text-base` → `text-lg`

**Step 3: Increase updates feed display variant + reduce max items**

In `updates-feed.tsx` display variant:
- Timestamp: `text-sm` → `text-base`
- Message: `text-base` → `text-lg`

In `active-game-view.tsx`, reduce the `maxItems` prop for display variant from 15 to 8 so fewer but larger items fit the screen.

**Step 4: Increase lobby view**

In `lobby-view.tsx`:
- "Scan To Join" heading: `text-base` → `text-lg`
- "Joined Players" heading: add same `text-lg` size
- Player nickname: `text-lg` → `text-xl`
- Join URL text: `text-sm` → `text-base`

**Step 5: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```
style: further increase display app font sizes for TV readability
```

---

### Task 5: Refocus input after autocomplete suggestion click

When clicking a roster member suggestion button in a multi-entry context (like adding surprise entrants or match participants), the input should be refocused so the user can immediately start typing the next entry.

**Files:**
- Modify: `components/pick-em/live-player/player-match-picks.tsx`
- Modify: `components/pick-em/live-host/host-match-section.tsx`
- Modify: `components/match-editor.tsx`

**Step 1: Add input ref in player-match-picks.tsx**

Add a ref for the battle royal input. After the derived values, add:

```tsx
const battleRoyalInputRef = React.useRef<HTMLInputElement>(null);
```

Wire it to the `<Input>` element for battle royal entrants:

```tsx
<Input
  ref={battleRoyalInputRef}
  value={battleRoyalEntryInput}
  ...
/>
```

In each autocomplete suggestion button's `onClick`, add a refocus call after adding the entrant:

```tsx
onClick={() => {
  onAddBattleRoyalEntrant(match.id, candidate);
  requestAnimationFrame(() => {
    battleRoyalInputRef.current?.focus();
  });
}}
```

Use `requestAnimationFrame` to ensure the DOM has settled after the state update before refocusing.

**Step 2: Same pattern in host-match-section.tsx**

Apply the same ref + refocus pattern to the battle royal entrant autocomplete in the host match section. Find the equivalent input and suggestion buttons, add a ref and refocus on click.

**Step 3: Same pattern in match-editor.tsx**

In `components/match-editor.tsx`, the participant autocomplete suggestions (around line 716) call `addParticipant(candidate)` on click. Add a ref to the participant input and refocus after clicking a suggestion:

```tsx
onClick={() => {
  addParticipant(candidate);
  requestAnimationFrame(() => {
    participantInputRef.current?.focus();
  });
}}
```

Find the participant `<Input>` element (look for the input that adds participants), add a ref to it, and wire the refocus.

**Step 4: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```
fix: refocus input after autocomplete suggestion selection
```

---

### Task 6: Fix zod schema for threshold bonus questions

Saving a card with a threshold-type bonus question returns 400 because the zod schema in the API route is missing the `"threshold"` answer type and its associated fields.

**Files:**
- Modify: `app/api/cards/[cardId]/route.ts`

**Step 1: Update the bonusQuestionSchema**

In `app/api/cards/[cardId]/route.ts`, find the `bonusQuestionSchema` (lines 24-38). Add:

1. `"threshold"` to the `answerType` enum
2. `thresholdValue` as an optional number field
3. `thresholdLabels` as an optional tuple of 2 strings

```typescript
const bonusQuestionSchema = z.object({
  id: z.string().uuid(),
  question: boundedText(200),
  points: z.number().int().min(1).max(100).nullable(),
  answerType: z.enum(["write-in", "multiple-choice", "threshold"]),
  options: z.array(shortName).max(MAX_OPTIONS),
  valueType: z
    .enum(["string", "numerical", "time", "rosterMember"])
    .optional()
    .default("string"),
  gradingRule: z
    .enum(["exact", "closest", "atOrAbove", "atOrBelow"])
    .optional()
    .default("exact"),
  thresholdValue: z.number().optional(),
  thresholdLabels: z
    .tuple([z.string().trim().max(60), z.string().trim().max(60)])
    .optional(),
});
```

**Step 2: Verify the normalized match schema passes through threshold fields**

Check that the `normalizedMatchSchema`'s `.transform()` for bonus questions preserves `thresholdValue` and `thresholdLabels` when constructing the output. The transform likely spreads or maps question fields — ensure threshold fields are included.

Read the transform around line 60+ and verify the bonus question mapping includes all fields.

**Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```
fix: add threshold answer type to bonus question zod schema
```
