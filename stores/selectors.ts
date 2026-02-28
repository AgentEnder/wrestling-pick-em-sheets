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
  return useAppStore(useShallow((s) => s.matches.map((m) => m.id)));
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
      setHasPendingAutoSave: s.setHasPendingAutoSave,
      clearAutoSaveError: s.clearAutoSaveError,
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
  return useAppStore(useShallow((s) => s.getSheetSnapshot()));
}

/* ── Live game ───────────────────────────────────────── */

export function useLiveCard() {
  return useAppStore((s) => s.liveCard);
}

export function useLivePayload() {
  return useAppStore((s) => s.livePayload);
}

export function useLiveGameState() {
  return useAppStore((s) => s.liveGameState);
}

export function useLiveLockState() {
  return useAppStore((s) => s.lockState);
}

export function useLiveGames() {
  return useAppStore((s) => s.games);
}

export function useBattleRoyalEntryInputByMatchId() {
  return useAppStore((s) => s.battleRoyalEntryInputByMatchId);
}

export function useLiveUi() {
  return useAppStore(
    useShallow((s) => ({ ...s.liveUi })),
  );
}

export function useLivePayloadActions() {
  return useAppStore(
    useShallow((s) => ({
      liveSetMatchWinner: s.liveSetMatchWinner,
      liveAddBattleRoyalEntrant: s.liveAddBattleRoyalEntrant,
      liveRemoveBattleRoyalEntrant: s.liveRemoveBattleRoyalEntrant,
      liveSetBattleRoyalEntryOrder: s.liveSetBattleRoyalEntryOrder,
      liveSetMatchBonusAnswer: s.liveSetMatchBonusAnswer,
      liveSetEventBonusAnswer: s.liveSetEventBonusAnswer,
      setLiveTiebreakerAnswer: s.setLiveTiebreakerAnswer,
      setLiveTiebreakerTimerId: s.setLiveTiebreakerTimerId,
    })),
  );
}

export function useLiveTimerActions() {
  return useAppStore(
    useShallow((s) => ({
      liveUpdateTimer: s.liveUpdateTimer,
      liveStartTimer: s.liveStartTimer,
      liveStopTimer: s.liveStopTimer,
      liveResetTimer: s.liveResetTimer,
      liveAddCustomTimer: s.liveAddCustomTimer,
      liveRemoveCustomTimer: s.liveRemoveCustomTimer,
      liveSetTimerLabel: s.liveSetTimerLabel,
    })),
  );
}

export function useLiveSetterActions() {
  return useAppStore(
    useShallow((s) => ({
      setLiveCard: s.setLiveCard,
      setLivePayload: s.setLivePayload,
      setLiveGameState: s.setLiveGameState,
      setLockState: s.setLockState,
      setGames: s.setGames,
      setBattleRoyalEntryInput: s.setBattleRoyalEntryInput,
      setLiveUi: s.setLiveUi,
    })),
  );
}

export function useLiveApiActions() {
  return useAppStore(
    useShallow((s) => ({
      loadLiveKey: s.loadLiveKey,
      syncLiveKey: s.syncLiveKey,
      loadLiveGameKey: s.loadLiveGameKey,
      syncLiveGameKey: s.syncLiveGameKey,
      loadLiveGameState: s.loadLiveGameState,
      _markLivePayloadSynced: s._markLivePayloadSynced,
      _checkLiveDirty: s._checkLiveDirty,
    })),
  );
}
