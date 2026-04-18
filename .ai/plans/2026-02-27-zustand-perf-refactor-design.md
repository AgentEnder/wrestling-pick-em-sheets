# Zustand Store + Component Decomposition Design

## Problem

The app passes a large `PickEmSheet` object as props through multiple component layers. Any change to any field causes the entire component tree to rerender. The live components (7,166 lines across 4 files) are monolithic and share concepts without shared components.

## Solution

1. **Single Zustand store** with slice-based organization replaces prop drilling
2. **Full component decomposition** breaks monoliths into focused, store-connected components
3. **Shared components** extracted for concepts used across live components

## Store Architecture

Single store (`stores/app-store.ts`) with two slices:

### Editor Slice

```typescript
// State
eventSettings: EventSettings        // { eventName, promotionName, eventDate, ... }
matches: Match[]                    // Array of match objects
eventBonusQuestions: BonusQuestion[] // Event-level bonus questions
editorUi: {
  activeTab: string
  isDraftDirty: boolean
  isSaving: boolean
  isSyncingOverrides: boolean
}
suggestions: {
  participants: string[]
  bonusQuestionPools: BonusQuestionPool[]
  matchTypes: MatchType[]
  isLoadingParticipants: boolean
  isLoadingBonusQuestionPools: boolean
}

// Actions
setEventSetting: (field: keyof EventSettings, value: any) => void
addMatch: () => void
updateMatch: (id: string, patch: Partial<Match>) => void
removeMatch: (id: string) => void
duplicateMatch: (id: string) => void
moveMatch: (fromIndex: number, toIndex: number) => void
addEventBonusQuestion: () => void
updateEventBonusQuestion: (id: string, patch: Partial<BonusQuestion>) => void
removeEventBonusQuestion: (id: string) => void
loadFromCard: (card: ResolvedCard) => void
getSheetSnapshot: () => PickEmSheet
persistDraft: (cardId: string) => void
loadDraft: (cardId: string) => PickEmSheet | null
clearDraft: (cardId: string) => void
save: (cardId: string) => Promise<void>
loadSuggestions: (promotionName: string) => Promise<void>
```

### Live Game Slice

```typescript
// State
liveCard: ResolvedCard | null
livePayload: CardLiveKeyPayload | LiveGameKeyPayload
liveState: LiveGameStateResponse | null
lockState: LiveGameLockState | null
games: Game[]
timers: Timer[]
liveUi: {
  isLoading: boolean
  isSaving: boolean
  isDirty: boolean
  isRefreshing: boolean
  lastRefreshAtMs: number
  isOnline: boolean
  lastSyncedAt: string | null
  syncError: string | null
}

// Effects & animations
fullscreenEffectQueue: FullscreenEffect[]
activeFullscreenEffect: FullscreenEffect | null
animatedLeaderboardOrder: string[]

// Actions - Match results
setMatchWinner: (matchId: string, winner: string) => void
setBattleRoyalEntryOrder: (matchId: string, order: string[]) => void
setMatchBonusAnswer: (matchId: string, bonusId: string, answer: string) => void
setEventBonusAnswer: (bonusId: string, answer: string) => void
setTiebreakerAnswer: (answer: string) => void

// Actions - Timers
updateTimer: (id: string, patch: Partial<Timer>) => void
startTimer: (id: string) => void
stopTimer: (id: string) => void
resetTimer: (id: string) => void

// Actions - Game management
loadCard: (cardId: string) => Promise<void>
loadGameState: (gameId: string) => Promise<void>
createGame: (cardId: string) => Promise<void>
endGame: (gameId: string) => Promise<void>
syncToServer: () => Promise<void>

// Actions - Lock management
toggleMatchWinnerLock: (matchId: string) => void
toggleMatchBonusLock: (matchId: string, bonusId: string) => void
toggleEventBonusLock: (bonusId: string) => void

// Actions - Join requests
approveJoin: (playerId: string) => Promise<void>
denyJoin: (playerId: string) => Promise<void>

// Actions - Override review
acceptOverride: (overrideId: string) => void
rejectOverride: (overrideId: string) => void

// Actions - Effects
queueFullscreenEffect: (effect: FullscreenEffect) => void
dismissActiveEffect: () => void
```

### Selector Hooks (`stores/selectors.ts`)

```typescript
// Editor selectors
export const useEventSettings = () => useAppStore(s => s.eventSettings)
export const useMatch = (index: number) => useAppStore(s => s.matches[index])
export const useMatchIds = () => useAppStore(s => s.matches.map(m => m.id))
export const useMatchCount = () => useAppStore(s => s.matches.length)
export const useEventBonusQuestions = () => useAppStore(s => s.eventBonusQuestions)
export const useEditorUi = () => useAppStore(s => s.editorUi)
export const useSuggestions = () => useAppStore(s => s.suggestions)
export const useSheetSnapshot = () => useAppStore(s => s.getSheetSnapshot())
export const useHasMatches = () => useAppStore(s => s.matches.length > 0)

// Live selectors
export const useLiveCard = () => useAppStore(s => s.liveCard)
export const useLivePayload = () => useAppStore(s => s.livePayload)
export const useLiveTimers = () => useAppStore(s => s.timers)
export const useLeaderboard = () => useAppStore(s => s.animatedLeaderboardOrder)
export const useActiveEffect = () => useAppStore(s => s.activeFullscreenEffect)
export const useLockState = () => useAppStore(s => s.lockState)
```

## Component Decomposition

### Editor Path

```
PickEmEditorApp (~80 lines, shell + store init)
  ├─ PageHeader (store selectors: hasMatches, isSaving)
  ├─ EditorView (~60 lines, layout only)
  │   ├─ EventSettingsPanel (reads store directly)
  │   ├─ MatchList (~40 lines, maps match IDs)
  │   │   └─ MatchEditor × N (reads store by ID, React.memo)
  │   └─ EventBonusQuestionsPanel (reads store directly)
  └─ PreviewView (reads store snapshot)
      └─ PrintSheet (receives PickEmSheet prop, pure render)
```

### LiveKeyApp (2,524 → ~100 shell + sub-components)

```
LiveKeyApp (~100 lines, shell + store init)
  ├─ LiveKeyHeader
  ├─ LiveKeyMatchSection × N (React.memo)
  │   ├─ MatchWinnerInput [SHARED]
  │   ├─ BattleRoyalEntryManager [SHARED]
  │   └─ MatchBonusAnswerList [SHARED]
  ├─ EventBonusSection
  ├─ TiebreakerSection [SHARED]
  └─ TimerManagementPanel
```

### LiveGameKeyHostApp (2,115 → ~100 shell + sub-components)

```
LiveGameKeyHostApp (~100 lines, shell + store init)
  ├─ HostHeader
  ├─ JoinRequestsPanel
  ├─ HostMatchSection × N (React.memo)
  │   ├─ MatchWinnerInput [SHARED]
  │   ├─ BattleRoyalEntryManager [SHARED]
  │   ├─ MatchBonusAnswerList [SHARED]
  │   ├─ FuzzyMatchReviewPanel
  │   └─ LockControls
  ├─ HostEventBonusSection
  ├─ TiebreakerSection [SHARED]
  └─ Sidebar: { LeaderboardPanel [SHARED], UpdatesFeed [SHARED] }
```

### LiveGamePlayerApp (1,605 → ~100 shell + sub-components)

```
LiveGamePlayerApp (~100 lines, shell + store init)
  ├─ PlayerHeader
  ├─ PlayerMatchPicks × N (React.memo)
  ├─ PlayerEventBonusPicks
  ├─ PlayerTiebreakerInput
  ├─ FullscreenEffectOverlay [SHARED]
  └─ Sidebar: { LeaderboardPanel [SHARED], UpdatesFeed [SHARED] }
```

### LiveGameDisplayApp (922 → ~80 shell + sub-components)

```
LiveGameDisplayApp (~80 lines, shell + store init)
  ├─ DisplayHeader
  ├─ LobbyView (QR code + joined players)
  ├─ ActiveGameView
  │   ├─ LeaderboardPanel [SHARED]
  │   └─ UpdatesFeed [SHARED]
  ├─ FullscreenEffectOverlay [SHARED]
  └─ JoinOverlay
```

### Shared Components (new: `components/pick-em/shared/`)

| Component | Used By | Reads From Store |
|-----------|---------|-----------------|
| MatchWinnerInput | LiveKey, KeyHost | match winner, roster suggestions |
| BattleRoyalEntryManager | LiveKey, KeyHost | match BR entry order |
| MatchBonusAnswerList | LiveKey, KeyHost | match bonus answers |
| TiebreakerSection | LiveKey, KeyHost | tiebreaker answer, timer |
| LeaderboardPanel | Player, Display, KeyHost | animatedLeaderboardOrder, liveState |
| UpdatesFeed | Player, Display, KeyHost | liveState events |
| FullscreenEffectOverlay | Player, Display | effectQueue, activeEffect |

## Implementation Phases

### Phase 1: Foundation — Zustand Store
- Install zustand
- Create `stores/app-store.ts` with slice pattern (editor + live slices in separate files)
- Create `stores/selectors.ts` with typed selector hooks
- No component changes yet — store is additive

### Phase 2: Editor Path Refactor
- Wire PickEmEditorApp to init store from card data
- Connect EventSettings directly to store
- Create MatchList, connect each MatchEditor by index
- Create EventBonusQuestionsPanel connected to store
- Wire PreviewView to getSheetSnapshot()
- Wire PageHeader to store selectors
- EditorView becomes layout-only
- Add React.memo to MatchEditor, EventSettings

### Phase 3: Live Key + Key Host Refactor
- Wire LiveKeyApp to init live store slice
- Extract MatchWinnerInput, BattleRoyalEntryManager, MatchBonusAnswerList
- Extract TiebreakerSection
- Decompose LiveKeyApp into sub-components
- Wire LiveGameKeyHostApp to live store slice
- Extract JoinRequestsPanel, FuzzyMatchReviewPanel, LockControls
- Decompose LiveGameKeyHostApp, reuse shared components

### Phase 4: Player + Display Refactor
- Extract LeaderboardPanel, UpdatesFeed, FullscreenEffectOverlay
- Decompose LiveGamePlayerApp into sub-components
- Decompose LiveGameDisplayApp into sub-components

### Phase 5: Cleanup
- Remove dead prop types and interfaces
- Verify all components use granular selectors
- Add React.memo to all leaf components
- Performance audit with React DevTools

## Performance Expectations

| Scenario | Before | After |
|----------|--------|-------|
| Edit match #3 title | All MatchEditors rerender | Only MatchEditor[3] rerenders |
| Change event name | Entire EditorView tree rerenders | Only EventSettingsPanel rerenders |
| Timer tick (live) | Full LiveKeyApp rerenders | Only TimerManagementPanel rerenders |
| Leaderboard update | Full player/display app rerenders | Only LeaderboardPanel rerenders |

## Migration Safety

- Each phase produces a working app
- Store is additive — components gradually migrate from props to store
- Existing functionality preserved throughout
- No big-bang migration required
