import type { StateCreator } from "zustand";
import {
  getCard,
  saveCardSheet,
  updateCardOverrides,
} from "@/lib/client/cards-api";
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
    question.answerType === "multiple-choice"
      ? "multiple-choice"
      : question.answerType === "threshold"
        ? "threshold"
        : "write-in";
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
    ...(answerType === "threshold" && typeof question.thresholdValue === "number"
      ? { thresholdValue: question.thresholdValue }
      : {}),
    ...(answerType === "threshold" && Array.isArray(question.thresholdLabels)
      ? { thresholdLabels: question.thresholdLabels as [string, string] }
      : {}),
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
  loadCard: (cardId: string) => Promise<void>;
  saveSheet: (cardId: string, mode: "manual" | "auto") => Promise<void>;
  syncOverrides: (cardId: string) => Promise<void>;
  hydrateFromDraft: (cardId: string) => void;
  persistDraft: (cardId: string) => void;
  resetToServer: () => void;
  importSheet: (sheet: PickEmSheet) => void;

  // Actions — autosave orchestration (used by component-level timer)
  setHasPendingAutoSave: (value: boolean) => void;
  clearAutoSaveError: () => void;

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

    loadCard: async (cardId) => {
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

    // ── Autosave orchestration ────────────────────────────────
    setHasPendingAutoSave: (value) => set({ hasPendingAutoSave: value }),
    clearAutoSaveError: () =>
      set({ autoSaveError: null, _lastFailedAutoSaveSnapshot: null }),

    // ── Suggestions ─────────────────────────────────────────
    loadSuggestions: async (promotionName) => {
      if (!promotionName.trim()) {
        set({ participantSuggestions: [], isLoadingParticipantSuggestions: false });
        return;
      }
      set({ isLoadingParticipantSuggestions: true });
      try {
        const response = await getRosterSuggestions(promotionName);
        set({ participantSuggestions: response.names, isLoadingParticipantSuggestions: false });
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
