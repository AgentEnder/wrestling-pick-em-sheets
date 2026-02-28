import type { StateCreator } from "zustand";
import type {
  CardLiveKeyPayload,
  LiveGame,
  LiveGameLockState,
  LiveKeyTimer,
} from "@/lib/types";
import type { ResolvedCard } from "@/lib/client/cards-api";
import type { LiveGameStateResponse } from "@/lib/client/live-games-api";
import {
  updateMatchWinner,
  addBattleRoyalEntrant as addBattleRoyalEntrantUtil,
  removeBattleRoyalEntrant as removeBattleRoyalEntrantUtil,
  setBattleRoyalEntryOrder as setBattleRoyalEntryOrderUtil,
  updateMatchBonusAnswer,
  updateEventBonusAnswer,
  snapshotPayload,
} from "@/lib/pick-em/payload-utils";
import { nowIso } from "@/lib/pick-em/timer-utils";
import {
  getLiveKeyState,
  saveLiveKey as saveLiveKeyApi,
} from "@/lib/client/live-keys-api";
import {
  getLiveGameKey,
  saveLiveGameKey as saveLiveGameKeyApi,
  getLiveGameState,
} from "@/lib/client/live-games-api";
import { getCard } from "@/lib/client/cards-api";

/* ── Constants ─────────────────────────────────────────────── */

const EMPTY_PAYLOAD: CardLiveKeyPayload = {
  timers: [],
  matchResults: [],
  eventBonusAnswers: [],
  tiebreakerAnswer: "",
  tiebreakerRecordedAt: null,
  tiebreakerTimerId: null,
  scoreOverrides: [],
  winnerOverrides: [],
};

const INITIAL_LIVE_UI = {
  isLoading: false,
  isSaving: false,
  isDirty: false,
  isRefreshing: false,
  lastSyncedAt: null as string | null,
  syncError: null as string | null,
};

/* ── Slice types ──────────────────────────────────────────── */

export interface LiveGameSlice {
  // State
  liveCard: ResolvedCard | null;
  livePayload: CardLiveKeyPayload;
  liveGameState: LiveGameStateResponse | null;
  lockState: LiveGameLockState | null;
  games: LiveGame[];
  battleRoyalEntryInputByMatchId: Record<string, string>;
  liveUi: typeof INITIAL_LIVE_UI;
  _lastSyncedPayloadSnapshot: string | null;

  // Payload mutation actions
  liveSetMatchWinner: (matchId: string, winnerName: string) => void;
  liveAddBattleRoyalEntrant: (matchId: string, entrantName: string) => void;
  liveRemoveBattleRoyalEntrant: (matchId: string, entryIndex: number) => void;
  liveSetBattleRoyalEntryOrder: (
    matchId: string,
    entryOrder: string[],
  ) => void;
  liveSetMatchBonusAnswer: (
    matchId: string,
    questionId: string,
    answer: string,
    isTimeBased: boolean,
  ) => void;
  liveSetEventBonusAnswer: (
    questionId: string,
    answer: string,
    isTimeBased: boolean,
  ) => void;

  // Tiebreaker actions
  setLiveTiebreakerAnswer: (answer: string) => void;
  setLiveTiebreakerTimerId: (timerId: string | null) => void;

  // Timer actions
  liveUpdateTimer: (
    timerId: string,
    updater: (t: LiveKeyTimer) => LiveKeyTimer,
  ) => void;
  liveStartTimer: (timerId: string) => void;
  liveStopTimer: (timerId: string) => void;
  liveResetTimer: (timerId: string) => void;
  liveAddCustomTimer: () => string;
  liveRemoveCustomTimer: (timerId: string) => void;
  liveSetTimerLabel: (timerId: string, label: string) => void;

  // Setter actions
  setLiveCard: (card: ResolvedCard | null) => void;
  setLivePayload: (payload: CardLiveKeyPayload) => void;
  setLiveGameState: (state: LiveGameStateResponse | null) => void;
  setLockState: (lockState: LiveGameLockState | null) => void;
  setGames: (games: LiveGame[]) => void;
  setBattleRoyalEntryInput: (matchId: string, value: string) => void;
  setLiveUi: (partial: Partial<LiveGameSlice["liveUi"]>) => void;

  // API actions
  loadLiveKey: (cardId: string) => Promise<void>;
  syncLiveKey: (cardId: string) => Promise<void>;
  loadLiveGameKey: (gameId: string) => Promise<void>;
  syncLiveGameKey: (
    gameId: string,
    expectedUpdatedAt?: string,
  ) => Promise<void>;
  loadLiveGameState: (gameId: string, joinCode?: string) => Promise<void>;

  // Internal helpers
  _markLivePayloadSynced: () => void;
  _checkLiveDirty: () => void;
}

/* ── Slice creator ────────────────────────────────────────── */

export const createLiveGameSlice: StateCreator<
  LiveGameSlice,
  [],
  [],
  LiveGameSlice
> = (set, get) => ({
  // ── Initial state ──────────────────────────────────────────
  liveCard: null,
  livePayload: EMPTY_PAYLOAD,
  liveGameState: null,
  lockState: null,
  games: [],
  battleRoyalEntryInputByMatchId: {},
  liveUi: { ...INITIAL_LIVE_UI },
  _lastSyncedPayloadSnapshot: null,

  // ── Payload mutation actions ───────────────────────────────
  liveSetMatchWinner: (matchId, winnerName) => {
    set((state) => {
      const next = updateMatchWinner(state.livePayload, matchId, winnerName);
      return { livePayload: next };
    });
    get()._checkLiveDirty();
  },

  liveAddBattleRoyalEntrant: (matchId, entrantName) => {
    set((state) => {
      const next = addBattleRoyalEntrantUtil(
        state.livePayload,
        matchId,
        entrantName,
      );
      return { livePayload: next };
    });
    get()._checkLiveDirty();
  },

  liveRemoveBattleRoyalEntrant: (matchId, entryIndex) => {
    set((state) => {
      const next = removeBattleRoyalEntrantUtil(
        state.livePayload,
        matchId,
        entryIndex,
      );
      return { livePayload: next };
    });
    get()._checkLiveDirty();
  },

  liveSetBattleRoyalEntryOrder: (matchId, entryOrder) => {
    set((state) => {
      const next = setBattleRoyalEntryOrderUtil(
        state.livePayload,
        matchId,
        entryOrder,
      );
      return { livePayload: next };
    });
    get()._checkLiveDirty();
  },

  liveSetMatchBonusAnswer: (matchId, questionId, answer, isTimeBased) => {
    set((state) => {
      const next = updateMatchBonusAnswer(
        state.livePayload,
        matchId,
        questionId,
        answer,
        isTimeBased,
      );
      return { livePayload: next };
    });
    get()._checkLiveDirty();
  },

  liveSetEventBonusAnswer: (questionId, answer, isTimeBased) => {
    set((state) => {
      const next = updateEventBonusAnswer(
        state.livePayload,
        questionId,
        answer,
        isTimeBased,
      );
      return { livePayload: next };
    });
    get()._checkLiveDirty();
  },

  // ── Tiebreaker actions ─────────────────────────────────────
  setLiveTiebreakerAnswer: (answer) => {
    set((state) => ({
      livePayload: {
        ...state.livePayload,
        tiebreakerAnswer: answer,
        tiebreakerRecordedAt: answer.trim() ? nowIso() : null,
      },
    }));
    get()._checkLiveDirty();
  },

  setLiveTiebreakerTimerId: (timerId) => {
    set((state) => ({
      livePayload: {
        ...state.livePayload,
        tiebreakerTimerId: timerId,
      },
    }));
    get()._checkLiveDirty();
  },

  // ── Timer actions ──────────────────────────────────────────
  liveUpdateTimer: (timerId, updater) => {
    set((state) => ({
      livePayload: {
        ...state.livePayload,
        timers: state.livePayload.timers.map((t) =>
          t.id === timerId ? updater(t) : t,
        ),
      },
    }));
    get()._checkLiveDirty();
  },

  liveStartTimer: (timerId) => {
    set((state) => ({
      livePayload: {
        ...state.livePayload,
        timers: state.livePayload.timers.map((t) =>
          t.id === timerId
            ? { ...t, isRunning: true, startedAt: nowIso() }
            : t,
        ),
      },
    }));
    get()._checkLiveDirty();
  },

  liveStopTimer: (timerId) => {
    set((state) => ({
      livePayload: {
        ...state.livePayload,
        timers: state.livePayload.timers.map((t) => {
          if (t.id !== timerId) return t;
          const elapsed =
            t.isRunning && t.startedAt
              ? t.elapsedMs + (Date.now() - new Date(t.startedAt).getTime())
              : t.elapsedMs;
          return {
            ...t,
            isRunning: false,
            startedAt: null,
            elapsedMs: Math.max(0, elapsed),
          };
        }),
      },
    }));
    get()._checkLiveDirty();
  },

  liveResetTimer: (timerId) => {
    set((state) => ({
      livePayload: {
        ...state.livePayload,
        timers: state.livePayload.timers.map((t) =>
          t.id === timerId
            ? { ...t, elapsedMs: 0, isRunning: false, startedAt: null }
            : t,
        ),
      },
    }));
    get()._checkLiveDirty();
  },

  liveAddCustomTimer: () => {
    const newId = `custom:${crypto.randomUUID()}`;
    const newTimer: LiveKeyTimer = {
      id: newId,
      label: "Custom Timer",
      elapsedMs: 0,
      isRunning: false,
      startedAt: null,
    };
    set((state) => ({
      livePayload: {
        ...state.livePayload,
        timers: [...state.livePayload.timers, newTimer],
      },
    }));
    get()._checkLiveDirty();
    return newId;
  },

  liveRemoveCustomTimer: (timerId) => {
    set((state) => {
      const nextTimers = state.livePayload.timers.filter(
        (t) => t.id !== timerId,
      );

      // Clear references to this timer in match bonus answers
      const nextMatchResults = state.livePayload.matchResults.map((result) => ({
        ...result,
        bonusAnswers: result.bonusAnswers.map((a) =>
          a.timerId === timerId ? { ...a, timerId: null } : a,
        ),
      }));

      // Clear references to this timer in event bonus answers
      const nextEventBonusAnswers = state.livePayload.eventBonusAnswers.map(
        (a) => (a.timerId === timerId ? { ...a, timerId: null } : a),
      );

      // Clear tiebreaker timer reference if it matches
      const nextTiebreakerTimerId =
        state.livePayload.tiebreakerTimerId === timerId
          ? null
          : state.livePayload.tiebreakerTimerId;

      return {
        livePayload: {
          ...state.livePayload,
          timers: nextTimers,
          matchResults: nextMatchResults,
          eventBonusAnswers: nextEventBonusAnswers,
          tiebreakerTimerId: nextTiebreakerTimerId,
        },
      };
    });
    get()._checkLiveDirty();
  },

  liveSetTimerLabel: (timerId, label) => {
    set((state) => ({
      livePayload: {
        ...state.livePayload,
        timers: state.livePayload.timers.map((t) =>
          t.id === timerId ? { ...t, label } : t,
        ),
      },
    }));
    get()._checkLiveDirty();
  },

  // ── Setter actions ─────────────────────────────────────────
  setLiveCard: (card) => set({ liveCard: card }),

  setLivePayload: (payload) => {
    set({ livePayload: payload });
    get()._checkLiveDirty();
  },

  setLiveGameState: (state) => set({ liveGameState: state }),

  setLockState: (lockState) => set({ lockState }),

  setGames: (games) => set({ games }),

  setBattleRoyalEntryInput: (matchId, value) => {
    set((state) => ({
      battleRoyalEntryInputByMatchId: {
        ...state.battleRoyalEntryInputByMatchId,
        [matchId]: value,
      },
    }));
  },

  setLiveUi: (partial) => {
    set((state) => ({
      liveUi: { ...state.liveUi, ...partial },
    }));
  },

  // ── API actions ────────────────────────────────────────────
  loadLiveKey: async (cardId) => {
    set((state) => ({
      liveUi: { ...state.liveUi, isLoading: true, syncError: null },
    }));
    try {
      const [keyResponse, card] = await Promise.all([
        getLiveKeyState(cardId),
        getCard(cardId),
      ]);
      const payload = keyResponse.key.payload;
      set((state) => ({
        liveCard: card,
        livePayload: payload,
        liveUi: {
          ...state.liveUi,
          isLoading: false,
          lastSyncedAt: new Date().toISOString(),
        },
        _lastSyncedPayloadSnapshot: snapshotPayload(payload),
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load live key";
      set((state) => ({
        liveUi: { ...state.liveUi, isLoading: false, syncError: message },
      }));
    }
  },

  syncLiveKey: async (cardId) => {
    set((state) => ({
      liveUi: { ...state.liveUi, isSaving: true, syncError: null },
    }));
    try {
      const payload = get().livePayload;
      await saveLiveKeyApi(cardId, payload);
      const snapshot = snapshotPayload(payload);
      set((state) => ({
        liveUi: {
          ...state.liveUi,
          isSaving: false,
          isDirty: false,
          lastSyncedAt: new Date().toISOString(),
        },
        _lastSyncedPayloadSnapshot: snapshot,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save live key";
      set((state) => ({
        liveUi: { ...state.liveUi, isSaving: false, syncError: message },
      }));
    }
  },

  loadLiveGameKey: async (gameId) => {
    set((state) => ({
      liveUi: { ...state.liveUi, isLoading: true, syncError: null },
    }));
    try {
      const response = await getLiveGameKey(gameId);
      const payload = response.key;
      set((state) => ({
        liveCard: response.card,
        livePayload: payload,
        lockState: response.locks,
        games: [response.game],
        liveUi: {
          ...state.liveUi,
          isLoading: false,
          lastSyncedAt: new Date().toISOString(),
        },
        _lastSyncedPayloadSnapshot: snapshotPayload(payload),
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load live game key";
      set((state) => ({
        liveUi: { ...state.liveUi, isLoading: false, syncError: message },
      }));
    }
  },

  syncLiveGameKey: async (gameId, expectedUpdatedAt) => {
    set((state) => ({
      liveUi: { ...state.liveUi, isSaving: true, syncError: null },
    }));
    try {
      const payload = get().livePayload;
      await saveLiveGameKeyApi(gameId, payload, { expectedUpdatedAt });
      const snapshot = snapshotPayload(payload);
      set((state) => ({
        liveUi: {
          ...state.liveUi,
          isSaving: false,
          isDirty: false,
          lastSyncedAt: new Date().toISOString(),
        },
        _lastSyncedPayloadSnapshot: snapshot,
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save live game key";
      set((state) => ({
        liveUi: { ...state.liveUi, isSaving: false, syncError: message },
      }));
    }
  },

  loadLiveGameState: async (gameId, joinCode) => {
    set((state) => ({
      liveUi: { ...state.liveUi, isRefreshing: true, syncError: null },
    }));
    try {
      const response = await getLiveGameState(gameId, joinCode);
      set((state) => ({
        liveGameState: response,
        liveCard: response.card,
        games: [response.game],
        liveUi: {
          ...state.liveUi,
          isRefreshing: false,
          lastSyncedAt: new Date().toISOString(),
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load live game state";
      set((state) => ({
        liveUi: { ...state.liveUi, isRefreshing: false, syncError: message },
      }));
    }
  },

  // ── Internal helpers ───────────────────────────────────────
  _markLivePayloadSynced: () => {
    const snapshot = snapshotPayload(get().livePayload);
    set((state) => ({
      _lastSyncedPayloadSnapshot: snapshot,
      liveUi: { ...state.liveUi, isDirty: false },
    }));
  },

  _checkLiveDirty: () => {
    const { livePayload, _lastSyncedPayloadSnapshot } = get();
    if (_lastSyncedPayloadSnapshot === null) return;
    const currentSnapshot = snapshotPayload(livePayload);
    const isDirty = currentSnapshot !== _lastSyncedPayloadSnapshot;
    set((state) => ({
      liveUi: { ...state.liveUi, isDirty },
    }));
  },
});
