# Component Refactoring Design

## Problem

The app has ~13,600 lines across 14 feature components with near-zero code reuse. The top 4 files (7,663 lines) contain 15 distinct duplicated patterns — identical functions copy-pasted across files, repeated UI structures, and duplicated state management logic.

**Goals:** Reduce bugs from copy-paste drift, make features faster to build, and shrink mega-components to manageable sizes.

## Approach: Bottom-Up Extraction

Extract shared code in layers: utilities -> custom hooks -> UI components -> then slim down the mega-components by composing from the new pieces.

## Layer 1: Shared Utilities (`lib/pick-em/`)

Pure functions, zero React dependencies.

### `lib/pick-em/timer-utils.ts`
Extracted from 4 files (live-key-app, live-game-key-host-app, live-game-player-app, live-game-display-app):
- `formatDuration(ms)` — format milliseconds as MM:SS or H:MM:SS
- `getTimerElapsedMs(timer, referenceNowMs)` — compute elapsed time accounting for running state
- Timer ID helpers: `toMatchTimerId`, `toMatchBonusTimerId`, `toEventBonusTimerId`
- Timer ID predicates: `isMatchTimerId`, `isMatchBonusTimerId`, `isEventBonusTimerId`, `isSystemTimerId`
- `nowIso()`, `nowMs()` — time wrappers

### `lib/pick-em/payload-utils.ts`
Extracted from 3 files (live-key-app, live-game-key-host-app, live-game-player-app):
- `findMatchResult(payload, matchId)` — find match result by ID
- `findAnswer(answers, questionId)` — find answer by question ID
- `toLockKey(matchId, questionId)` — build lock key string
- `snapshotPayload(payload)` — deep clone for comparison
- Immutable payload updaters:
  - `setMatchWinner(payload, matchId, winnerName, recordedAt)`
  - `addBattleRoyalEntrant(payload, matchId, name)`
  - `removeBattleRoyalEntrant(payload, matchId, name)`
  - `setBattleRoyalEntryOrder(payload, matchId, order)`
  - `setMatchBonusAnswer(payload, matchId, questionId, answer, ...)`
  - `setEventBonusAnswer(payload, questionId, answer, ...)`

### `lib/pick-em/text-utils.ts`
Extracted from 3 files:
- `filterRosterMemberSuggestions(input, candidates)` — fuzzy roster filter (byte-for-byte identical in 3 files)
- `normalizeText(value)` — trim + collapse whitespace + lowercase
- `formatEventTypeLabel(type)` — display labels for event types

### `lib/pick-em/leaderboard-utils.ts`
Extracted from 2 files (live-game-player-app, live-game-display-app):
- `hasLeaderboardChanged(previous, next)` — change detection
- `buildBubbleSortSteps(previous, current)` — animation step generator

## Layer 2: Custom Hooks (`hooks/`)

Encapsulate repeated stateful patterns, built on top of the utilities.

### `hooks/use-polling-state.ts`
Extracted from 3 files (player, display, host):
```
usePollingState<T>({ fetcher, intervalMs, enabled })
-> { data, isLoading, isRefreshing, isStale, lastRefreshAtMs, refresh }
```
Manages polling interval, stale detection, loading/refreshing states, and nowTickMs clock.

### `hooks/use-roster-suggestions.ts`
Extracted from 3 files (live-key, host, player):
```
useRosterSuggestions({ promotionName })
-> { query, setQuery, suggestions, isLoading, activeFieldKey, setActiveFieldKey, clearSuggestions }
```
Encapsulates debounced API call to getRosterSuggestions, activeRosterFieldKey tracking, and cancellation logic.

### `hooks/use-timer-clock.ts`
Extracted from 4 files:
```
useTimerClock({ timers, enabled })
-> { currentTimeMs }
```
Manages the requestAnimationFrame/setInterval tick that drives timer display.

### `hooks/use-fullscreen-effects.ts`
Extracted from 2 files (player, display):
```
useFullscreenEffects()
-> { activeEffect, queue, queueEffects, dismiss, animatedLeaderboardOrder }
```
Manages fullscreen effect queue, timeouts, and leaderboard bubble-sort animation stepping.

### `hooks/use-async-action.ts`
Extracted from 5+ files:
```
useAsyncAction(actionFn)
-> { execute, isRunning }
```
Wraps any async function with try/catch/finally + loading state + toast.error.

## Layer 3: Shared UI Components (`components/pick-em/shared/`)

Reusable React components composing utilities and hooks.

### `section-card.tsx`
Styled section wrapper used 15+ times across files:
- Props: title, subtitle, children, optional action buttons area
- Replaces the repeated `<section className="rounded-lg border border-border bg-card p-4">` pattern

### `roster-autocomplete-input.tsx`
Input field with roster suggestion dropdown, used 6+ times:
- Props: value, onChange, fieldKey, suggestions, placeholder, readOnly
- Wraps input + onFocus/onKeyDown + suggestion dropdown + loading indicator

### `timer-controls.tsx`
Timer display with play/stop/reset buttons:
- Props: timer, currentTimeMs, onStart, onStop, onReset
- Displays formatted duration and control buttons

### `match-result-section.tsx`
Match result editing UI (biggest shared component):
- Props: match, result, timer, rosterSuggestions, onWinnerChange, onBonusAnswerChange, readOnly
- Contains: winner select, battle royal entry order, bonus questions list
- Accounts for ~400-500 duplicated lines per file

### `bonus-question-input.tsx`
Single bonus question answer field:
- Props: question, answer, onChange, rosterSuggestions, readOnly
- Supports: write-in, multiple-choice, threshold answer types

### `fullscreen-effect-overlay.tsx`
Fullscreen effect rendering shared between player and display:
- Props: effect, onDismiss, leaderboardOrder
- Handles: result reveals, leaderboard animations

## Layer 4: Mega-Component Decomposition

### `live-key-app.tsx` (2,669 -> ~1,200 lines)
- **Removes:** timer utils, payload utils, roster filtering, match result UI, bonus question UI, timer controls
- **Keeps unique:** localStorage persistence, draft management, sync state, custom timer CRUD, offline support
- **Uses:** useTimerClock, useRosterSuggestions
- **Renders:** SectionCard, MatchResultSection, TimerControls, BonusQuestionInput

### `live-game-key-host-app.tsx` (2,247 -> ~1,000 lines)
- **Removes:** timer utils, payload utils, roster filtering, match result UI, bonus question UI, timer controls
- **Keeps unique:** fuzzy match review, lock state management, game status controls, join request approval, server polling
- **Uses:** useTimerClock, useRosterSuggestions, usePollingState
- **Renders:** SectionCard, MatchResultSection, TimerControls, BonusQuestionInput

### `live-game-player-app.tsx` (1,753 -> ~800 lines)
- **Removes:** leaderboard utils, fullscreen effects, roster filtering, event type formatting, polling logic
- **Keeps unique:** pick submission UI, drag-reorder, PWA integration, service worker messaging
- **Uses:** usePollingState, useRosterSuggestions, useFullscreenEffects
- **Renders:** FullscreenEffectOverlay, RosterAutocompleteInput

### `live-game-display-app.tsx` (994 -> ~500 lines)
- **Removes:** leaderboard utils, fullscreen effects, event type formatting, polling logic
- **Keeps unique:** QR code generation, display layout, join overlay
- **Uses:** usePollingState, useFullscreenEffects
- **Renders:** FullscreenEffectOverlay

### `match-editor.tsx` (1,226 lines)
- Decompose into focused sub-components for each section of the match form
- Extract participant management, bonus question editing, match type configuration

### `editor-view.tsx` (699 lines)
- Extract match list rendering, match operations toolbar, event settings integration

### `bonus-question-admin-screen.tsx` (1,821 lines)
- Extract pool management, template editing, rule set configuration into separate components
- Reuse SectionCard and form patterns

### `roster-admin-screen.tsx` (725 lines)
- Extract promotion list, roster member management, WWE sync controls

### `print-sheet.tsx` (571 lines)
- Extract match row rendering, header section, scoring legend

## File Structure After Refactoring

```
lib/pick-em/
  timer-utils.ts
  payload-utils.ts
  text-utils.ts
  leaderboard-utils.ts

hooks/
  use-mobile.ts (existing)
  use-toast.ts (existing)
  use-polling-state.ts
  use-roster-suggestions.ts
  use-timer-clock.ts
  use-fullscreen-effects.ts
  use-async-action.ts

components/pick-em/shared/
  section-card.tsx
  roster-autocomplete-input.tsx
  timer-controls.tsx
  match-result-section.tsx
  bonus-question-input.tsx
  fullscreen-effect-overlay.tsx

components/pick-em/
  (existing files, now much smaller)
```

## Estimated Impact

- **Total lines affected:** ~13,600
- **Expected reduction:** ~4,000-5,000 lines of duplication eliminated
- **New shared files:** 15 (4 utils + 5 hooks + 6 components)
- **Zero behavioral changes** — pure refactoring, no feature additions or removals
