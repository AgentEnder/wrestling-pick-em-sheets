# Consolidate Live Key & Host Key Components

**Date:** 2026-03-02
**Status:** Approved
**Goal:** Reduce maintenance burden and conceptual complexity by merging duplicated keying UI into shared components.

## Context

`LiveKeyApp` (solo key tracking) and `LiveGameKeyHostApp` (multiplayer host) share ~60-70% of their match section and event bonus section code. When a new bonus question type is added or a bug is fixed in keying UI, it must be changed in both places. The two shell apps have genuinely different orchestration (offline-first vs server-polling), but the keying UI should be one set of components.

## Decisions

- **Scope:** Child components only. The two shell apps remain separate — their orchestration architectures are fundamentally different.
- **Host-only features:** Handled via optional props on the shared components. When absent, lock controls and fuzzy review panels don't render.
- **Elimination order:** Included in the shared component for all consumers (it's a keying concern, not a multiplayer concern).
- **Rename:** `LiveKeyApp` → `SoloKeyApp`, `live-key/` directory → `solo-key/`.

## File Structure

### New Files

```
components/pick-em/shared/
├── key-match-section.tsx          ← replaces live-key-match-section + host-match-section
└── key-event-bonus-section.tsx    ← replaces event-bonus-section + host-event-bonus-section
```

### Renamed Files

```
components/pick-em/live-key-app.tsx        → solo-key-app.tsx
components/pick-em/live-key/              → solo-key/
components/pick-em/solo-key/live-key-header.tsx → solo-key-header.tsx
```

### Deleted Files

```
components/pick-em/live-key/live-key-match-section.tsx
components/pick-em/live-key/event-bonus-section.tsx
components/pick-em/live-host/host-match-section.tsx
components/pick-em/live-host/host-event-bonus-section.tsx
```

### Unchanged Files (stay in place)

```
components/pick-em/solo-key/timer-management-panel.tsx
components/pick-em/solo-key/tiebreaker-section.tsx
components/pick-em/live-host/host-header.tsx
components/pick-em/live-host/fuzzy-match-review-panel.tsx
components/pick-em/live-host/host-dashboard-panels.tsx
components/pick-em/live-game-key-host-app.tsx
```

## Shared Component Interfaces

### KeyMatchSection

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

### KeyEventBonusSection

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

Both read core keying state from the Zustand store (`useLiveCard`, `useLivePayload`, `useLivePayloadActions`, `useLiveTimerActions`). Host-only props are purely additive.

## Timer Seeding Consolidation

Move to `lib/pick-em/timer-utils.ts`:

- `ensureSystemTimers()` — consolidated from two implementations (live-key version is the base, as it handles custom timer separation via `isSystemTimerId`)
- `getQuestionValueType()` — derives `"time" | "numerical" | "string" | "rosterMember"` from legacy boolean fields

Both shell apps call:
```typescript
const nextPayload = ensureSystemTimers(payload, card.matches, card.eventBonusQuestions);
```

## Rename Cascade

| What | From | To |
|------|------|----|
| Shell component | `LiveKeyApp` | `SoloKeyApp` |
| Shell file | `live-key-app.tsx` | `solo-key-app.tsx` |
| Directory | `live-key/` | `solo-key/` |
| Header component | `LiveKeyHeader` | `SoloKeyHeader` |
| Page import | `app/cards/[cardId]/live/solo/page.tsx` | Update import |

No API changes — `/api/cards/[cardId]/live-key` stays as-is.
No store changes — selectors use generic names (`useLiveCard`, etc.).

## What Does NOT Change

- The two shell apps remain separate (different sync strategies)
- Host-only components (header, join requests, lifecycle controls, lock controls, dashboard panels)
- Solo-only components (timer management panel, tiebreaker section)
- Shared primitives (counter-input, threshold-buttons, multiple-choice-select, bonus-timer-capture)
- API routes and data model
- Zustand store shape
