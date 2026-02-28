# Zustand Performance Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace prop-drilling of a large PickEmSheet object with a Zustand store, decompose monolithic components into focused store-connected pieces, and eliminate unnecessary rerenders across the entire app.

**Architecture:** Single Zustand store with two slices (editor + live-game), organized via the slice pattern across separate files. Components connect directly to the store via selector hooks, eliminating prop drilling. React.memo wraps leaf components to prevent cascade rerenders.

**Tech Stack:** Zustand 5.x, React 19, Next.js 16, TypeScript

---

## Phase 1: Zustand Store Foundation

### Task 1: Install Zustand

**Files:**
- Modify: `package.json`

**Step 1: Install zustand**

Run: `pnpm add zustand`

**Step 2: Verify installation**

Run: `pnpm exec next build --no-lint 2>&1 | head -5`
Expected: Build starts without module resolution errors

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add zustand dependency"
```

---

### Task 2: Create the editor store slice

**Files:**
- Create: `stores/editor-slice.ts`

**Step 1: Create the editor slice**

This slice owns all state that currently lives in `PickEmEditorApp` and `EditorView`. It replaces the `sheet` useState plus all the field-level onChange handlers.

```typescript
import type { StateCreator } from "zustand";
import {
  getCard,
  saveCardSheet,
  updateCardOverrides,
} from "@/lib/client/cards-api";
import type { ResolvedCard } from "@/lib/client/cards-api";
import {
  DEFAULT_BATTLE_ROYAL_MATCH_TYPE_ID,
  DEFAULT_MATCH_TYPE_ID,
  getDefaultMatchType,
  normalizeMatchTypeId,
} from "@/lib/match-types";
import { listBonusQuestionPools } from "@/lib/client/bonus-question-pools-api";
import { listMatchTypes } from "@/lib/client/match-types-api";
import { getRosterSuggestions } from "@/lib/client/roster-api";
import type {
  BonusGradingRule,
  BonusQuestion,
  BonusQuestionAnswerType,
  BonusQuestionPool,
  BonusQuestionValueType,
  Match,
  MatchType,
  PickEmSheet,
} from "@/lib/types";

/* ── Constants ─────────────────────────────────────────────── */

const LOCAL_DRAFT_STORAGE_KEY = "pick-em-editor-draft-v2";
const AUTOSAVE_DEBOUNCE_MS = 900;

const INITIAL_SHEET: PickEmSheet = {
  eventName: "",
  promotionName: "",
  eventDate: "",
  eventTagline: "",
  defaultPoints: 1,
  tiebreakerLabel: "Main event total match time (mins)",
  tiebreakerIsTimeBased: true,
  matches: [],
  eventBonusQuestions: [],
};

/* ── Helper functions (moved from pick-em-editor-app.tsx) ── */

function normalizeBonusQuestion(
  question: Partial<BonusQuestion> & {
    isTimeBased?: boolean;
    isCountBased?: boolean;
  },
): BonusQuestion {
  const answerType: BonusQuestionAnswerType =
    question.answerType === "multiple-choice" ? "multiple-choice" : "write-in";
  const valueType: BonusQuestionValueType =
    question.valueType === "numerical" ||
    question.valueType === "time" ||
    question.valueType === "rosterMember"
      ? question.valueType
      : question.isTimeBased === true
        ? "time"
        : question.isCountBased === true
          ? "numerical"
          : "string";
  const gradingRule: BonusGradingRule =
    question.gradingRule === "closest" ||
    question.gradingRule === "atOrAbove" ||
    question.gradingRule === "atOrBelow"
      ? question.gradingRule
      : "exact";

  return {
    id: typeof question.id === "string" ? question.id : crypto.randomUUID(),
    question: typeof question.question === "string" ? question.question : "",
    points: typeof question.points === "number" ? question.points : null,
    answerType,
    options:
      answerType === "multiple-choice" && Array.isArray(question.options)
        ? question.options.filter(
            (option): option is string => typeof option === "string",
          )
        : [],
    valueType,
    gradingRule,
  };
}

function normalizeMatch(match: Match): Match {
  const raw = match as Match & {
    announcedParticipants?: string[];
    isBattleRoyal?: boolean;
    isEliminationStyle?: boolean;
    typeLabelOverride?: string;
  };
  const inferredBattleRoyal =
    raw.isBattleRoyal === true || raw.type === "battleRoyal";
  const normalizedType = normalizeMatchTypeId(raw.type, inferredBattleRoyal);
  const typeDefinition = getDefaultMatchType(normalizedType);
  const isBattleRoyal =
    typeof raw.isBattleRoyal === "boolean"
      ? raw.isBattleRoyal
      : (typeDefinition?.defaultRuleSetIds.includes("timed-entry") ??
        raw.type === "battleRoyal");
  const bonusQuestions = Array.isArray(raw.bonusQuestions)
    ? raw.bonusQuestions.map((question) => normalizeBonusQuestion(question))
    : [];
  const participants = Array.isArray(raw.participants)
    ? raw.participants
    : Array.isArray(raw.announcedParticipants)
      ? raw.announcedParticipants
      : [];

  return {
    ...raw,
    type: normalizedType,
    typeLabelOverride:
      typeof raw.typeLabelOverride === "string" ? raw.typeLabelOverride : "",
    isBattleRoyal,
    isEliminationStyle: raw.isEliminationStyle === true,
    participants,
    surpriseSlots:
      isBattleRoyal && typeof raw.surpriseSlots === "number"
        ? raw.surpriseSlots
        : 0,
    surpriseEntrantPoints:
      isBattleRoyal && typeof raw.surpriseEntrantPoints === "number"
        ? raw.surpriseEntrantPoints
        : null,
    bonusQuestions,
  };
}

function normalizeSheet(
  input: Partial<PickEmSheet> | null | undefined,
): PickEmSheet {
  const matches = Array.isArray(input?.matches)
    ? (input.matches as Match[]).map((match) => normalizeMatch(match))
    : [];
  const eventBonusQuestions = Array.isArray(input?.eventBonusQuestions)
    ? (input.eventBonusQuestions as BonusQuestion[]).map((question) =>
        normalizeBonusQuestion(question),
      )
    : [];

  return {
    ...INITIAL_SHEET,
    ...input,
    promotionName:
      typeof input?.promotionName === "string" ? input.promotionName : "",
    matches,
    eventBonusQuestions,
    tiebreakerIsTimeBased:
      typeof input?.tiebreakerIsTimeBased === "boolean"
        ? input.tiebreakerIsTimeBased
        : INITIAL_SHEET.tiebreakerIsTimeBased,
  };
}

export function createMatch(input?: {
  type?: string;
  isBattleRoyal?: boolean;
  isEliminationStyle?: boolean;
}): Match {
  const fallbackIsBattleRoyal = input?.isBattleRoyal === true;
  const normalizedType = normalizeMatchTypeId(
    input?.type ??
      (fallbackIsBattleRoyal
        ? DEFAULT_BATTLE_ROYAL_MATCH_TYPE_ID
        : DEFAULT_MATCH_TYPE_ID),
    fallbackIsBattleRoyal,
  );
  const typeDefinition = getDefaultMatchType(normalizedType);
  const isBattleRoyal =
    typeof input?.isBattleRoyal === "boolean"
      ? input.isBattleRoyal
      : (typeDefinition?.defaultRuleSetIds.includes("timed-entry") ?? false);

  return {
    id: crypto.randomUUID(),
    type: normalizedType,
    typeLabelOverride: "",
    isBattleRoyal,
    isEliminationStyle: input?.isEliminationStyle === true,
    title: "",
    description: "",
    participants: [],
    surpriseSlots: 5,
    surpriseEntrantPoints: null,
    bonusQuestions: [],
    points: null,
  };
}

function toSheet(card: {
  eventName: string;
  promotionName: string;
  eventDate: string;
  eventTagline: string;
  defaultPoints: number;
  tiebreakerLabel: string;
  tiebreakerIsTimeBased: boolean;
  matches: Match[];
  eventBonusQuestions: BonusQuestion[];
}): PickEmSheet {
  return {
    eventName: card.eventName,
    promotionName: card.promotionName,
    eventDate: card.eventDate,
    eventTagline: card.eventTagline,
    defaultPoints: card.defaultPoints,
    tiebreakerLabel: card.tiebreakerLabel,
    tiebreakerIsTimeBased: card.tiebreakerIsTimeBased,
    matches: card.matches,
    eventBonusQuestions: card.eventBonusQuestions,
  };
}

/* ── Local draft persistence ────────────────────────────── */

interface LocalDraftState {
  draftsByCardId: Record<string, PickEmSheet>;
  dirtyByCardId: Record<string, boolean>;
}

function readLocalDraftState(): LocalDraftState {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY);
    if (!raw) {
      return { draftsByCardId: {}, dirtyByCardId: {} };
    }

    const parsed = JSON.parse(raw) as Partial<LocalDraftState>;
    const draftsByCardId =
      parsed.draftsByCardId && typeof parsed.draftsByCardId === "object"
        ? (parsed.draftsByCardId as Record<string, PickEmSheet>)
        : {};
    const dirtyByCardId =
      parsed.dirtyByCardId && typeof parsed.dirtyByCardId === "object"
        ? (parsed.dirtyByCardId as Record<string, boolean>)
        : {};

    const normalizedDraftsByCardId: Record<string, PickEmSheet> = {};
    const normalizedDirtyByCardId: Record<string, boolean> = {};
    for (const [draftCardId, draftSheet] of Object.entries(draftsByCardId)) {
      normalizedDraftsByCardId[draftCardId] = normalizeSheet(draftSheet);
      normalizedDirtyByCardId[draftCardId] =
        dirtyByCardId[draftCardId] === true;
    }

    return {
      draftsByCardId: normalizedDraftsByCardId,
      dirtyByCardId: normalizedDirtyByCardId,
    };
  } catch {
    return { draftsByCardId: {}, dirtyByCardId: {} };
  }
}

function writeLocalDraftState(state: LocalDraftState) {
  localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, JSON.stringify(state));
}

/* ── Slice types ──────────────────────────────────────────── */

export interface EditorSlice {
  // Sheet data
  eventName: string;
  promotionName: string;
  eventDate: string;
  eventTagline: string;
  defaultPoints: number;
  tiebreakerLabel: string;
  tiebreakerIsTimeBased: boolean;
  matches: Match[];
  eventBonusQuestions: BonusQuestion[];

  // Suggestions (loaded by EditorView)
  participantSuggestions: string[];
  isLoadingParticipantSuggestions: boolean;
  bonusQuestionPools: BonusQuestionPool[];
  isLoadingBonusQuestionPools: boolean;
  matchTypes: MatchType[];

  // UI state
  activeTab: string;
  isLoadingCard: boolean;
  isSyncingOverrides: boolean;
  isSavingSheet: boolean;
  isAutoSavingSheet: boolean;
  hasPendingAutoSave: boolean;
  autoSaveError: string | null;
  isDraftDirty: boolean;

  // Actions — event settings
  setEventName: (value: string) => void;
  setPromotionName: (value: string) => void;
  setEventDate: (value: string) => void;
  setEventTagline: (value: string) => void;
  setDefaultPoints: (value: number) => void;
  setTiebreakerLabel: (value: string) => void;
  setTiebreakerIsTimeBased: (value: boolean) => void;

  // Actions — matches
  addMatch: (input?: {
    type?: string;
    isBattleRoyal?: boolean;
    isEliminationStyle?: boolean;
  }) => void;
  updateMatch: (id: string, patch: Partial<Match>) => void;
  replaceMatch: (index: number, match: Match) => void;
  removeMatch: (id: string) => void;
  duplicateMatch: (id: string) => void;
  moveMatch: (id: string, direction: "up" | "down") => void;

  // Actions — event bonus questions
  setEventBonusQuestions: (questions: BonusQuestion[]) => void;

  // Actions — sheet lifecycle
  setSheet: (sheet: PickEmSheet) => void;
  getSheetSnapshot: () => PickEmSheet;
  setActiveTab: (tab: string) => void;

  // Actions — persistence
  loadCard: (cardId: string, userId: string | null) => Promise<void>;
  saveSheet: (cardId: string, mode: "manual" | "auto") => Promise<void>;
  syncOverrides: (cardId: string) => Promise<void>;
  hydrateFromDraft: (cardId: string) => void;
  persistDraft: (cardId: string) => void;
  resetToServer: () => void;
  importSheet: (sheet: PickEmSheet) => void;

  // Actions — suggestions
  loadSuggestions: (promotionName: string) => Promise<void>;
  loadBonusQuestionPools: () => Promise<void>;
  loadMatchTypes: () => Promise<void>;

  // Internal bookkeeping (not for direct component use)
  _resetSheet: PickEmSheet;
  _localDraft: LocalDraftState;
  _hasHydratedDraft: boolean;
  _lastFailedAutoSaveSnapshot: string | null;
}

/* ── Slice creator ────────────────────────────────────────── */

export const createEditorSlice: StateCreator<EditorSlice, [], [], EditorSlice> =
  (set, get) => ({
    // Sheet data — initial values
    eventName: INITIAL_SHEET.eventName,
    promotionName: INITIAL_SHEET.promotionName,
    eventDate: INITIAL_SHEET.eventDate,
    eventTagline: INITIAL_SHEET.eventTagline,
    defaultPoints: INITIAL_SHEET.defaultPoints,
    tiebreakerLabel: INITIAL_SHEET.tiebreakerLabel,
    tiebreakerIsTimeBased: INITIAL_SHEET.tiebreakerIsTimeBased,
    matches: [],
    eventBonusQuestions: [],

    // Suggestions
    participantSuggestions: [],
    isLoadingParticipantSuggestions: false,
    bonusQuestionPools: [],
    isLoadingBonusQuestionPools: false,
    matchTypes: [],

    // UI state
    activeTab: "editor",
    isLoadingCard: false,
    isSyncingOverrides: false,
    isSavingSheet: false,
    isAutoSavingSheet: false,
    hasPendingAutoSave: false,
    autoSaveError: null,
    isDraftDirty: false,

    // Internal bookkeeping
    _resetSheet: INITIAL_SHEET,
    _localDraft: { draftsByCardId: {}, dirtyByCardId: {} },
    _hasHydratedDraft: false,
    _lastFailedAutoSaveSnapshot: null,

    // ── Event settings actions ──────────────────────────────
    setEventName: (value) => set({ eventName: value, isDraftDirty: true }),
    setPromotionName: (value) =>
      set({ promotionName: value, isDraftDirty: true }),
    setEventDate: (value) => set({ eventDate: value, isDraftDirty: true }),
    setEventTagline: (value) =>
      set({ eventTagline: value, isDraftDirty: true }),
    setDefaultPoints: (value) =>
      set({ defaultPoints: value, isDraftDirty: true }),
    setTiebreakerLabel: (value) =>
      set({ tiebreakerLabel: value, isDraftDirty: true }),
    setTiebreakerIsTimeBased: (value) =>
      set({ tiebreakerIsTimeBased: value, isDraftDirty: true }),

    // ── Match actions ───────────────────────────────────────
    addMatch: (input) => {
      const newMatch = createMatch(input);
      set((state) => ({
        matches: [...state.matches, newMatch],
        isDraftDirty: true,
      }));
    },

    updateMatch: (id, patch) => {
      set((state) => ({
        matches: state.matches.map((m) =>
          m.id === id ? { ...m, ...patch } : m,
        ),
        isDraftDirty: true,
      }));
    },

    replaceMatch: (index, match) => {
      set((state) => ({
        matches: state.matches.map((m, i) => (i === index ? match : m)),
        isDraftDirty: true,
      }));
    },

    removeMatch: (id) => {
      set((state) => ({
        matches: state.matches.filter((m) => m.id !== id),
        isDraftDirty: true,
      }));
    },

    duplicateMatch: (id) => {
      set((state) => {
        const index = state.matches.findIndex((m) => m.id === id);
        if (index === -1) return state;

        const source = state.matches[index];
        const clone: Match = {
          ...JSON.parse(JSON.stringify(source)),
          id: crypto.randomUUID(),
          bonusQuestions: source.bonusQuestions.map((q) => ({
            ...JSON.parse(JSON.stringify(q)),
            id: crypto.randomUUID(),
          })),
        };

        const newMatches = [...state.matches];
        newMatches.splice(index + 1, 0, clone);
        return { matches: newMatches, isDraftDirty: true };
      });
    },

    moveMatch: (id, direction) => {
      set((state) => {
        const index = state.matches.findIndex((m) => m.id === id);
        if (index === -1) return state;

        const swapIndex = direction === "up" ? index - 1 : index + 1;
        if (swapIndex < 0 || swapIndex >= state.matches.length) return state;

        const newMatches = [...state.matches];
        [newMatches[index], newMatches[swapIndex]] = [
          newMatches[swapIndex],
          newMatches[index],
        ];
        return { matches: newMatches, isDraftDirty: true };
      });
    },

    // ── Event bonus questions ───────────────────────────────
    setEventBonusQuestions: (questions) =>
      set({ eventBonusQuestions: questions, isDraftDirty: true }),

    // ── Sheet lifecycle ─────────────────────────────────────
    setSheet: (sheet) =>
      set({
        eventName: sheet.eventName,
        promotionName: sheet.promotionName,
        eventDate: sheet.eventDate,
        eventTagline: sheet.eventTagline,
        defaultPoints: sheet.defaultPoints,
        tiebreakerLabel: sheet.tiebreakerLabel,
        tiebreakerIsTimeBased: sheet.tiebreakerIsTimeBased,
        matches: sheet.matches,
        eventBonusQuestions: sheet.eventBonusQuestions,
        isDraftDirty: true,
      }),

    getSheetSnapshot: () => {
      const s = get();
      return {
        eventName: s.eventName,
        promotionName: s.promotionName,
        eventDate: s.eventDate,
        eventTagline: s.eventTagline,
        defaultPoints: s.defaultPoints,
        tiebreakerLabel: s.tiebreakerLabel,
        tiebreakerIsTimeBased: s.tiebreakerIsTimeBased,
        matches: s.matches,
        eventBonusQuestions: s.eventBonusQuestions,
      };
    },

    setActiveTab: (tab) => set({ activeTab: tab }),

    // ── Persistence ─────────────────────────────────────────
    hydrateFromDraft: (cardId) => {
      const localDraft = readLocalDraftState();
      set({ _localDraft: localDraft });

      const draftForCard = localDraft.draftsByCardId[cardId];
      if (draftForCard) {
        set({
          ...draftForCard,
          isDraftDirty: localDraft.dirtyByCardId[cardId] === true,
          _resetSheet: draftForCard,
          _hasHydratedDraft: true,
        });
      } else {
        set({
          ...INITIAL_SHEET,
          isDraftDirty: false,
          _resetSheet: INITIAL_SHEET,
          _hasHydratedDraft: true,
        });
      }
    },

    loadCard: async (cardId, userId) => {
      const state = get();
      const draftForCard = state._localDraft.draftsByCardId[cardId];
      if (draftForCard) return;

      set({ isLoadingCard: true });
      try {
        const card = await getCard(cardId);
        const cardSheet = normalizeSheet(toSheet(card));
        const localDraft = {
          ...state._localDraft,
          draftsByCardId: {
            ...state._localDraft.draftsByCardId,
            [cardId]: cardSheet,
          },
          dirtyByCardId: { ...state._localDraft.dirtyByCardId, [cardId]: false },
        };
        writeLocalDraftState(localDraft);

        set({
          ...cardSheet,
          isDraftDirty: false,
          _resetSheet: cardSheet,
          _localDraft: localDraft,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load card";
        const { toast } = await import("sonner");
        toast.error(message);
      } finally {
        set({ isLoadingCard: false });
      }
    },

    saveSheet: async (cardId, mode) => {
      const state = get();
      const snapshot = state.getSheetSnapshot();
      const snapshotSerialized = JSON.stringify(snapshot);

      if (mode === "manual") {
        set({ isSavingSheet: true });
      } else {
        set({ isAutoSavingSheet: true });
      }

      try {
        const saved = await saveCardSheet(cardId, snapshot);
        const savedSheet = normalizeSheet(toSheet(saved));
        const currentState = get();
        const hasChangedSinceRequest =
          JSON.stringify(currentState.getSheetSnapshot()) !==
          snapshotSerialized;

        const localDraft = {
          ...currentState._localDraft,
          draftsByCardId: {
            ...currentState._localDraft.draftsByCardId,
            [cardId]: hasChangedSinceRequest
              ? currentState.getSheetSnapshot()
              : savedSheet,
          },
          dirtyByCardId: {
            ...currentState._localDraft.dirtyByCardId,
            [cardId]: hasChangedSinceRequest,
          },
        };
        writeLocalDraftState(localDraft);

        const updates: Partial<EditorSlice> = {
          autoSaveError: null,
          _resetSheet: savedSheet,
          _localDraft: localDraft,
          _lastFailedAutoSaveSnapshot: null,
        };

        if (!hasChangedSinceRequest) {
          Object.assign(updates, {
            ...savedSheet,
            isDraftDirty: false,
          });
        }

        set(updates as EditorSlice);

        if (mode === "manual") {
          const { toast } = await import("sonner");
          toast.success("Card saved");
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save card";
        if (mode === "manual") {
          const { toast } = await import("sonner");
          toast.error(message);
        } else {
          set({
            autoSaveError: message,
            _lastFailedAutoSaveSnapshot: snapshotSerialized,
          });
        }
      } finally {
        if (mode === "manual") {
          set({ isSavingSheet: false });
        } else {
          set({ isAutoSavingSheet: false });
        }
      }
    },

    syncOverrides: async (cardId) => {
      set({ isSyncingOverrides: true });
      try {
        const s = get();
        const normalizeNullable = (v: string) => {
          const t = v.trim();
          return t || null;
        };
        await updateCardOverrides(cardId, {
          eventName: normalizeNullable(s.eventName),
          promotionName: normalizeNullable(s.promotionName),
          eventDate: normalizeNullable(s.eventDate),
          eventTagline: normalizeNullable(s.eventTagline),
          defaultPoints: s.defaultPoints,
          tiebreakerLabel: normalizeNullable(s.tiebreakerLabel),
          tiebreakerIsTimeBased: s.tiebreakerIsTimeBased,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to sync card overrides";
        const { toast } = await import("sonner");
        toast.error(message);
      } finally {
        set({ isSyncingOverrides: false });
      }
    },

    persistDraft: (cardId) => {
      const s = get();
      const sheet = s.getSheetSnapshot();
      const localDraft = {
        ...s._localDraft,
        draftsByCardId: { ...s._localDraft.draftsByCardId, [cardId]: sheet },
        dirtyByCardId: {
          ...s._localDraft.dirtyByCardId,
          [cardId]: s.isDraftDirty,
        },
      };
      writeLocalDraftState(localDraft);
      set({ _localDraft: localDraft });
    },

    resetToServer: () => {
      const resetSheet = get()._resetSheet;
      set({
        ...resetSheet,
        isDraftDirty: false,
        activeTab: "editor",
      });
    },

    importSheet: (sheet) => {
      const normalized = normalizeSheet(sheet);
      set({
        ...normalized,
        isDraftDirty: true,
        activeTab: "editor",
      });
    },

    // ── Suggestions ─────────────────────────────────────────
    loadSuggestions: async (promotionName) => {
      if (!promotionName.trim()) {
        set({ participantSuggestions: [], isLoadingParticipantSuggestions: false });
        return;
      }
      set({ isLoadingParticipantSuggestions: true });
      try {
        const suggestions = await getRosterSuggestions(promotionName);
        set({ participantSuggestions: suggestions, isLoadingParticipantSuggestions: false });
      } catch {
        set({ participantSuggestions: [], isLoadingParticipantSuggestions: false });
      }
    },

    loadBonusQuestionPools: async () => {
      set({ isLoadingBonusQuestionPools: true });
      try {
        const pools = await listBonusQuestionPools();
        set({ bonusQuestionPools: pools, isLoadingBonusQuestionPools: false });
      } catch {
        set({ isLoadingBonusQuestionPools: false });
      }
    },

    loadMatchTypes: async () => {
      try {
        const types = await listMatchTypes();
        set({ matchTypes: types });
      } catch {
        // Silently fail — match types are optional enhancement
      }
    },
  });
```

**Step 2: Verify the file compiles**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors from `stores/editor-slice.ts`

**Step 3: Commit**

```bash
git add stores/editor-slice.ts
git commit -m "feat: create editor zustand slice with all state and actions"
```

---

### Task 3: Create the app store that composes slices

**Files:**
- Create: `stores/app-store.ts`

**Step 1: Create the store**

```typescript
import { create } from "zustand";
import { createEditorSlice, type EditorSlice } from "@/stores/editor-slice";

export type AppStore = EditorSlice;

export const useAppStore = create<AppStore>()((...args) => ({
  ...createEditorSlice(...args),
}));
```

**Step 2: Verify compilation**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add stores/app-store.ts
git commit -m "feat: create unified app store composing editor slice"
```

---

### Task 4: Create selector hooks

**Files:**
- Create: `stores/selectors.ts`

**Step 1: Create typed selector hooks**

These provide stable, memoized access patterns for components. Using shallow comparison where returning objects.

```typescript
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/stores/app-store";
import type { Match, BonusQuestion } from "@/lib/types";

/* ── Event settings ──────────────────────────────────────── */

export function useEventSettings() {
  return useAppStore(
    useShallow((s) => ({
      eventName: s.eventName,
      promotionName: s.promotionName,
      eventDate: s.eventDate,
      eventTagline: s.eventTagline,
      defaultPoints: s.defaultPoints,
      tiebreakerLabel: s.tiebreakerLabel,
      tiebreakerIsTimeBased: s.tiebreakerIsTimeBased,
    })),
  );
}

export function useEventSettingsActions() {
  return useAppStore(
    useShallow((s) => ({
      setEventName: s.setEventName,
      setPromotionName: s.setPromotionName,
      setEventDate: s.setEventDate,
      setEventTagline: s.setEventTagline,
      setDefaultPoints: s.setDefaultPoints,
      setTiebreakerLabel: s.setTiebreakerLabel,
      setTiebreakerIsTimeBased: s.setTiebreakerIsTimeBased,
    })),
  );
}

/* ── Matches ─────────────────────────────────────────────── */

export function useMatchIds(): string[] {
  return useAppStore((s) => s.matches.map((m) => m.id));
}

export function useMatchCount(): number {
  return useAppStore((s) => s.matches.length);
}

export function useMatchByIndex(index: number): Match | undefined {
  return useAppStore((s) => s.matches[index]);
}

export function useMatchById(id: string): Match | undefined {
  return useAppStore((s) => s.matches.find((m) => m.id === id));
}

export function useMatchActions() {
  return useAppStore(
    useShallow((s) => ({
      addMatch: s.addMatch,
      updateMatch: s.updateMatch,
      replaceMatch: s.replaceMatch,
      removeMatch: s.removeMatch,
      duplicateMatch: s.duplicateMatch,
      moveMatch: s.moveMatch,
    })),
  );
}

/* ── Event bonus questions ───────────────────────────────── */

export function useEventBonusQuestions(): BonusQuestion[] {
  return useAppStore((s) => s.eventBonusQuestions);
}

export function useEventBonusQuestionsAction() {
  return useAppStore((s) => s.setEventBonusQuestions);
}

/* ── Suggestions ─────────────────────────────────────────── */

export function useSuggestions() {
  return useAppStore(
    useShallow((s) => ({
      participantSuggestions: s.participantSuggestions,
      isLoadingParticipantSuggestions: s.isLoadingParticipantSuggestions,
      bonusQuestionPools: s.bonusQuestionPools,
      isLoadingBonusQuestionPools: s.isLoadingBonusQuestionPools,
      matchTypes: s.matchTypes,
    })),
  );
}

/* ── Editor UI ───────────────────────────────────────────── */

export function useEditorUi() {
  return useAppStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      isLoadingCard: s.isLoadingCard,
      isSyncingOverrides: s.isSyncingOverrides,
      isSavingSheet: s.isSavingSheet,
      isAutoSavingSheet: s.isAutoSavingSheet,
      hasPendingAutoSave: s.hasPendingAutoSave,
      autoSaveError: s.autoSaveError,
      isDraftDirty: s.isDraftDirty,
    })),
  );
}

export function useEditorActions() {
  return useAppStore(
    useShallow((s) => ({
      setActiveTab: s.setActiveTab,
      setSheet: s.setSheet,
      getSheetSnapshot: s.getSheetSnapshot,
      loadCard: s.loadCard,
      saveSheet: s.saveSheet,
      syncOverrides: s.syncOverrides,
      hydrateFromDraft: s.hydrateFromDraft,
      persistDraft: s.persistDraft,
      resetToServer: s.resetToServer,
      importSheet: s.importSheet,
      loadSuggestions: s.loadSuggestions,
      loadBonusQuestionPools: s.loadBonusQuestionPools,
      loadMatchTypes: s.loadMatchTypes,
    })),
  );
}

/* ── Derived selectors ───────────────────────────────────── */

export function useHasMatches(): boolean {
  return useAppStore((s) => s.matches.length > 0);
}

export function useHasEventName(): boolean {
  return useAppStore((s) => s.eventName.trim().length > 0);
}

export function useSheetSnapshot() {
  return useAppStore((s) => s.getSheetSnapshot());
}
```

**Step 2: Verify compilation**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add stores/selectors.ts
git commit -m "feat: add selector hooks for granular store subscriptions"
```

---

## Phase 2: Editor Path Refactor

### Task 5: Wire PickEmEditorApp to store

**Files:**
- Modify: `components/pick-em/pick-em-editor-app.tsx`

**Step 1: Rewrite PickEmEditorApp to use the store**

Replace the component's internal state management with store initialization and selector hooks. The component becomes a thin shell that:
1. Calls `hydrateFromDraft(cardId)` on mount
2. Calls `loadCard(cardId, userId)` after hydration
3. Manages only the UI-layer concerns (print ref, import input ref, beforeunload, focus tracking, autosave timer orchestration)
4. Reads UI state from `useEditorUi()`
5. Passes no sheet data as props — children read from store directly

Key changes:
- Remove `useState<PickEmSheet>(INITIAL_SHEET)` and all sheet-derived state
- Remove all `onXxxChange` handlers that were passed to `EditorView`
- Remove match action callbacks (addMatch, updateMatch, etc.)
- Keep: `printRef`, `importInputRef`, autosave timer effect, beforeunload effect, focus tracking effect
- `EditorView` receives zero props
- `PreviewView` reads from store directly (via `useSheetSnapshot`)
- `PageHeader` reads from store directly

The full rewrite of this component will reduce it from ~920 lines to ~250 lines. The helper functions (createMatch, normalizeSheet, etc.) already moved to `stores/editor-slice.ts`.

**Step 2: Verify the app builds and runs**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: No type errors

**Step 3: Commit**

```bash
git add components/pick-em/pick-em-editor-app.tsx
git commit -m "refactor: wire PickEmEditorApp to zustand store"
```

---

### Task 6: Wire EventSettings to store

**Files:**
- Modify: `components/event-settings.tsx`

**Step 1: Replace props with store selectors**

Change the component to read from `useEventSettings()` and call `useEventSettingsActions()` directly instead of receiving 14 props.

Key changes:
- Remove the `EventSettingsProps` interface
- Replace 7 value props with `const settings = useEventSettings()`
- Replace 7 onChange props with `const actions = useEventSettingsActions()`
- Component becomes a zero-prop component: `export function EventSettings() { ... }`
- All internal logic (timezone handling, etc.) stays the same

**Step 2: Verify compilation**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add components/event-settings.tsx
git commit -m "refactor: wire EventSettings directly to zustand store"
```

---

### Task 7: Wire EditorView to store

**Files:**
- Modify: `components/pick-em/editor-view.tsx`

**Step 1: Replace props with store selectors**

Key changes:
- Remove the `EditorViewProps` interface entirely
- Remove all props — component takes zero props
- Replace `sheet.matches` mapping with `useMatchIds()` selector
- Replace suggestion useState with `useSuggestions()` selector
- Replace suggestion loading effects with store action calls (`loadSuggestions`, `loadBonusQuestionPools`, `loadMatchTypes`)
- Keep: local UI state for pool/template selection, event option inputs
- Event bonus question operations call `useEventBonusQuestionsAction()` / `useEventBonusQuestions()`

**Step 2: Verify compilation**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add components/pick-em/editor-view.tsx
git commit -m "refactor: wire EditorView to zustand store, remove all props"
```

---

### Task 8: Wire MatchEditor to store

**Files:**
- Modify: `components/match-editor.tsx`

**Step 1: Replace props with store selectors**

Key changes:
- Change props from `MatchEditorProps` (14 props) to just `{ matchId: string; index: number }`
- Read match data: `const match = useMatchById(matchId)`
- Read suggestions: `const { participantSuggestions, bonusQuestionPools, matchTypes } = useSuggestions()`
- Read default points: `const defaultPoints = useAppStore(s => s.defaultPoints)`
- Read promotion name: `const promotionName = useAppStore(s => s.promotionName)`
- Read match count: `const totalMatches = useMatchCount()`
- Replace `onChange(updatedMatch)` calls with `replaceMatch(index, updatedMatch)` from store
- Replace `onRemove()` with `removeMatch(matchId)`
- Replace `onDuplicate()` with `duplicateMatch(matchId)`
- Replace `onMove(direction)` with `moveMatch(matchId, direction)`
- Keep: `React.memo` wrapper (already exists as `memo`)
- Keep: all internal state (isOpen, newParticipant, etc.)

**Step 2: Verify compilation**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add components/match-editor.tsx
git commit -m "refactor: wire MatchEditor to zustand store by matchId"
```

---

### Task 9: Wire PreviewView and PageHeader to store

**Files:**
- Modify: `components/pick-em/preview-view.tsx`
- Modify: `components/pick-em/page-header.tsx`

**Step 1: Wire PreviewView**

Key changes:
- Remove `PreviewViewProps` — component takes zero props (except `printRef` which stays as a prop from the parent that owns the DOM ref)
- Read sheet: `const sheet = useSheetSnapshot()`
- Read hasMatches: `const hasMatches = useHasMatches()`
- `onPrint` handled by parent shell via store or kept as prop

Actually, `printRef` and `onPrint` are DOM-level concerns that the parent shell needs to own. Keep these as props:
```typescript
interface PreviewViewProps {
  printRef: RefObject<HTMLDivElement | null>;
  onPrint: () => void;
}
```

**Step 2: Wire PageHeader**

Key changes:
- Reduce `PageHeaderProps` to only action callbacks that are DOM-level: `onImportClick`, `onExport`, `onPrint`
- Read hasMatches/hasEventName/isSaving/canSave from store selectors
- `onReset` calls `resetToServer()` from store
- `onSave` calls `saveSheet(cardId, "manual")` from store

```typescript
interface PageHeaderProps {
  cardId: string;
  canSave: boolean;
  onImportClick: () => void;
  onPrint: () => void;
}
```

**Step 3: Verify compilation**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add components/pick-em/preview-view.tsx components/pick-em/page-header.tsx
git commit -m "refactor: wire PreviewView and PageHeader to zustand store"
```

---

### Task 10: Verify Phase 2 end-to-end

**Step 1: Type check**

Run: `pnpm exec tsc --noEmit --pretty`
Expected: Zero errors

**Step 2: Build**

Run: `pnpm build`
Expected: Successful build

**Step 3: Manual smoke test**

- Verify the editor loads card data
- Verify editing a match doesn't rerender sibling matches (React DevTools)
- Verify save/autosave works
- Verify print preview works
- Verify import/export works

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: phase 2 complete — editor path fully on zustand store"
```

---

## Phase 3: Live Key + Key Host Refactor

### Task 11: Create the live game store slice

**Files:**
- Create: `stores/live-game-slice.ts`
- Modify: `stores/app-store.ts`

**Step 1: Create the live game slice**

This slice consolidates state from `LiveKeyApp` and `LiveGameKeyHostApp`. It manages:
- Card data (`ResolvedCard`)
- Key payload (`CardLiveKeyPayload`) with match results, bonus answers, timers
- Game state (`LiveGameStateResponse`) for host management
- Lock state (`LiveGameLockState`) for host controls
- Games list for host management

Actions mirror the existing callbacks in those components, using the same immutable update functions from `lib/pick-em/payload-utils.ts`.

Key state fields:
```typescript
interface LiveGameSlice {
  liveCard: ResolvedCard | null;
  livePayload: CardLiveKeyPayload;
  liveState: LiveGameStateResponse | null;
  lockState: LiveGameLockState | null;
  games: LiveGame[];
  timers: LiveKeyTimer[];
  liveUi: {
    isLoading: boolean;
    isSaving: boolean;
    isDirty: boolean;
    isRefreshing: boolean;
    isOnline: boolean;
    lastSyncedAt: string | null;
    syncError: string | null;
  };
  // ... actions for match winners, bonus answers, timers, locks, game management
}
```

**Step 2: Compose into app store**

Add to `stores/app-store.ts`:
```typescript
import { createLiveGameSlice, type LiveGameSlice } from "@/stores/live-game-slice";

export type AppStore = EditorSlice & LiveGameSlice;

export const useAppStore = create<AppStore>()((...args) => ({
  ...createEditorSlice(...args),
  ...createLiveGameSlice(...args),
}));
```

**Step 3: Commit**

```bash
git add stores/live-game-slice.ts stores/app-store.ts
git commit -m "feat: create live game zustand slice with payload and timer management"
```

---

### Task 12: Extract shared live components

**Files:**
- Create: `components/pick-em/shared/match-winner-input.tsx`
- Create: `components/pick-em/shared/battle-royal-entry-manager.tsx`
- Create: `components/pick-em/shared/match-bonus-answer-list.tsx`
- Create: `components/pick-em/shared/tiebreaker-section.tsx`

Extract the repeated UI blocks found in both `LiveKeyApp` and `LiveGameKeyHostApp` into shared components that read from the live game store slice.

Each shared component:
- Takes a `matchId` (or no props for tiebreaker)
- Reads its data from the store via selectors
- Calls store actions for mutations
- Is wrapped in `React.memo`

**Step 1: Create each component from the existing inline JSX**

**Step 2: Verify compilation**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`

**Step 3: Commit**

```bash
git add components/pick-em/shared/
git commit -m "feat: extract shared live game components (winner input, BR manager, bonus answers, tiebreaker)"
```

---

### Task 13: Decompose LiveKeyApp

**Files:**
- Modify: `components/pick-em/live-key-app.tsx`
- Create: `components/pick-em/live-key/live-key-header.tsx`
- Create: `components/pick-em/live-key/live-key-match-section.tsx`
- Create: `components/pick-em/live-key/event-bonus-section.tsx`
- Create: `components/pick-em/live-key/timer-management-panel.tsx`

Reduce `LiveKeyApp` from 2,524 lines to ~100 lines. The shell initializes the store and renders sub-components. Each sub-component reads from the store and is wrapped in `React.memo`.

**Step 1: Create sub-components**
**Step 2: Rewrite LiveKeyApp as thin shell**
**Step 3: Verify compilation and commit**

```bash
git add components/pick-em/live-key/ components/pick-em/live-key-app.tsx
git commit -m "refactor: decompose LiveKeyApp into store-connected sub-components"
```

---

### Task 14: Decompose LiveGameKeyHostApp

**Files:**
- Modify: `components/pick-em/live-game-key-host-app.tsx`
- Create: `components/pick-em/live-host/host-header.tsx`
- Create: `components/pick-em/live-host/join-requests-panel.tsx`
- Create: `components/pick-em/live-host/host-match-section.tsx`
- Create: `components/pick-em/live-host/host-event-bonus-section.tsx`
- Create: `components/pick-em/live-host/fuzzy-match-review-panel.tsx`
- Create: `components/pick-em/live-host/lock-controls.tsx`

Reduce `LiveGameKeyHostApp` from 2,115 lines to ~100 lines. Reuses shared components from Task 12.

**Step 1: Create sub-components**
**Step 2: Rewrite LiveGameKeyHostApp as thin shell**
**Step 3: Verify compilation and commit**

```bash
git add components/pick-em/live-host/ components/pick-em/live-game-key-host-app.tsx
git commit -m "refactor: decompose LiveGameKeyHostApp into store-connected sub-components"
```

---

## Phase 4: Player + Display Refactor

### Task 15: Extract shared display components

**Files:**
- Create: `components/pick-em/shared/leaderboard-panel.tsx`
- Create: `components/pick-em/shared/updates-feed.tsx`
- Create: `components/pick-em/shared/fullscreen-effect-overlay.tsx`

These components are used by both `LiveGamePlayerApp` and `LiveGameDisplayApp`.

**Step 1: Create shared components**
**Step 2: Verify compilation and commit**

```bash
git add components/pick-em/shared/
git commit -m "feat: extract shared display components (leaderboard, updates feed, fullscreen effects)"
```

---

### Task 16: Decompose LiveGamePlayerApp

**Files:**
- Modify: `components/pick-em/live-game-player-app.tsx`
- Create: `components/pick-em/live-player/player-header.tsx`
- Create: `components/pick-em/live-player/player-match-picks.tsx`
- Create: `components/pick-em/live-player/player-event-bonus-picks.tsx`
- Create: `components/pick-em/live-player/player-tiebreaker-input.tsx`

Reduce from 1,605 lines to ~100 lines.

**Step 1: Create sub-components**
**Step 2: Rewrite as thin shell**
**Step 3: Verify and commit**

```bash
git add components/pick-em/live-player/ components/pick-em/live-game-player-app.tsx
git commit -m "refactor: decompose LiveGamePlayerApp into store-connected sub-components"
```

---

### Task 17: Decompose LiveGameDisplayApp

**Files:**
- Modify: `components/pick-em/live-game-display-app.tsx`
- Create: `components/pick-em/live-display/display-header.tsx`
- Create: `components/pick-em/live-display/lobby-view.tsx`
- Create: `components/pick-em/live-display/active-game-view.tsx`
- Create: `components/pick-em/live-display/join-overlay.tsx`

Reduce from 922 lines to ~80 lines.

**Step 1: Create sub-components**
**Step 2: Rewrite as thin shell**
**Step 3: Verify and commit**

```bash
git add components/pick-em/live-display/ components/pick-em/live-game-display-app.tsx
git commit -m "refactor: decompose LiveGameDisplayApp into store-connected sub-components"
```

---

## Phase 5: Cleanup

### Task 18: Remove dead code and verify

**Files:**
- Scan all modified files for unused imports, dead prop types, orphaned interfaces

**Step 1: Type check entire project**

Run: `pnpm exec tsc --noEmit --pretty`
Expected: Zero errors

**Step 2: Build**

Run: `pnpm build`
Expected: Successful production build

**Step 3: Lint**

Run: `pnpm lint` (or equivalent)
Expected: No new warnings

**Step 4: Remove any dead exports found by tsc/lint**

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: remove dead code and unused prop types after zustand refactor"
```

---

### Task 19: Add React.memo to all leaf components

**Files:**
- Modify: `components/event-settings.tsx` (wrap export in memo)
- Modify: `components/pick-em/preview-view.tsx` (wrap export in memo)
- Modify: `components/pick-em/page-header.tsx` (wrap export in memo)
- Verify: `components/match-editor.tsx` already uses memo

**Step 1: Add memo wrappers**

For each component, change:
```typescript
export function ComponentName(...) { ... }
```
to:
```typescript
import { memo } from "react";
export const ComponentName = memo(function ComponentName(...) { ... });
```

**Step 2: Verify and commit**

```bash
git add components/
git commit -m "perf: wrap leaf components in React.memo"
```

---

### Task 20: Performance verification

**Step 1: Build and verify no regressions**

Run: `pnpm build`
Expected: Clean build

**Step 2: Manual performance test**

Using React DevTools Profiler:
- Edit match #3 title → only MatchEditor[3] should rerender
- Change event name → only EventSettings should rerender
- Timer tick → only timer-related components should rerender
- Tab switch → only tab content should rerender

**Step 3: Final commit**

```bash
git add -A
git commit -m "refactor: zustand performance refactor complete"
```
