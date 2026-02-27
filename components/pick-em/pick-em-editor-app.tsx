"use client";

import { EditorView } from "@/components/pick-em/editor-view";
import { PageHeader } from "@/components/pick-em/page-header";
import { PreviewView } from "@/components/pick-em/preview-view";
import { PrintSheet } from "@/components/print-sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type {
  BonusGradingRule,
  BonusQuestion,
  BonusQuestionAnswerType,
  BonusQuestionValueType,
  Match,
  PickEmSheet,
} from "@/lib/types";
import { useAuth } from "@/lib/client/clerk-test-mode";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function createMatch(input?: {
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

const LOCAL_DRAFT_STORAGE_KEY = "pick-em-editor-draft-v2";
const AUTOSAVE_DEBOUNCE_MS = 900;

function isEditableField(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  return (
    element.closest("input, textarea, select, [contenteditable='true']") !==
    null
  );
}

interface LocalDraftState {
  draftsByCardId: Record<string, PickEmSheet>;
  dirtyByCardId: Record<string, boolean>;
}

const EMPTY_LOCAL_DRAFT_STATE: LocalDraftState = {
  draftsByCardId: {},
  dirtyByCardId: {},
};

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

function readLocalDraftState(): LocalDraftState {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY);
    if (!raw) {
      return {
        ...EMPTY_LOCAL_DRAFT_STATE,
        draftsByCardId: {},
        dirtyByCardId: {},
      };
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
    return {
      ...EMPTY_LOCAL_DRAFT_STATE,
      draftsByCardId: {},
      dirtyByCardId: {},
    };
  }
}

function writeLocalDraftState(state: LocalDraftState) {
  localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, JSON.stringify(state));
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

function normalizeNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

interface PickEmEditorAppProps {
  cardId: string;
}

export function PickEmEditorApp({ cardId }: PickEmEditorAppProps) {
  const { userId, isLoaded: isAuthLoaded } = useAuth();
  const [sheet, setSheet] = useState<PickEmSheet>(INITIAL_SHEET);
  const [activeTab, setActiveTab] = useState("editor");
  const [isLoadingCard, setIsLoadingCard] = useState(false);
  const [isSyncingOverrides, setIsSyncingOverrides] = useState(false);
  const [isSavingSheet, setIsSavingSheet] = useState(false);
  const [isAutoSavingSheet, setIsAutoSavingSheet] = useState(false);
  const [hasPendingAutoSave, setHasPendingAutoSave] = useState(false);
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [isEditableFieldFocused, setIsEditableFieldFocused] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const resetSheetRef = useRef<PickEmSheet>(INITIAL_SHEET);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetRef = useRef<PickEmSheet>(INITIAL_SHEET);
  const lastFailedAutoSaveSnapshotRef = useRef<string | null>(null);
  const suppressDraftDirtyRef = useRef(false);
  const localDraftRef = useRef<LocalDraftState>({
    draftsByCardId: {},
    dirtyByCardId: {},
  });

  const hasMatches = sheet.matches.length > 0;
  const hasEventName = sheet.eventName.trim().length > 0;
  const canAutoSave = isAuthLoaded && Boolean(userId);

  useEffect(() => {
    sheetRef.current = sheet;
  }, [sheet]);

  useEffect(() => {
    const localDraft = readLocalDraftState();
    localDraftRef.current = localDraft;

    const draftForCard = localDraft.draftsByCardId[cardId];
    if (draftForCard) {
      setSheet(draftForCard);
      resetSheetRef.current = draftForCard;
      setIsDraftDirty(localDraft.dirtyByCardId[cardId] === true);
    } else {
      setSheet(INITIAL_SHEET);
      resetSheetRef.current = INITIAL_SHEET;
      setIsDraftDirty(false);
    }

    setHasHydratedDraft(true);
  }, [cardId]);

  const loadCard = useCallback(async () => {
    const draftForCard = localDraftRef.current.draftsByCardId[cardId];
    if (draftForCard) {
      return;
    }

    setIsLoadingCard(true);
    try {
      const card = await getCard(cardId);
      const cardSheet = normalizeSheet(toSheet(card));
      suppressDraftDirtyRef.current = true;
      setSheet(cardSheet);
      setIsDraftDirty(false);
      resetSheetRef.current = cardSheet;
      localDraftRef.current.draftsByCardId[cardId] = cardSheet;
      localDraftRef.current.dirtyByCardId[cardId] = false;
      writeLocalDraftState(localDraftRef.current);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load card";
      toast.error(message);
    } finally {
      setIsLoadingCard(false);
    }
  }, [cardId]);

  useEffect(() => {
    if (!hasHydratedDraft) {
      return;
    }

    void loadCard();
  }, [hasHydratedDraft, loadCard]);

  useEffect(() => {
    if (!hasHydratedDraft) {
      return;
    }

    if (suppressDraftDirtyRef.current) {
      suppressDraftDirtyRef.current = false;
      return;
    }

    setIsDraftDirty(true);
  }, [sheet, hasHydratedDraft]);

  useEffect(() => {
    if (!hasHydratedDraft) {
      return;
    }

    localDraftRef.current.draftsByCardId[cardId] = sheet;
    localDraftRef.current.dirtyByCardId[cardId] = isDraftDirty;
    writeLocalDraftState(localDraftRef.current);
  }, [cardId, sheet, isDraftDirty, hasHydratedDraft]);

  useEffect(() => {
    function onError(event: ErrorEvent) {
      toast.error(event.message || "An unexpected error occurred");
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const message =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);
      toast.error(message || "An unexpected error occurred");
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    function syncFocusedFieldState() {
      setIsEditableFieldFocused(isEditableField(document.activeElement));
    }

    function onFocusIn() {
      syncFocusedFieldState();
    }

    function onFocusOut() {
      window.requestAnimationFrame(syncFocusedFieldState);
    }

    syncFocusedFieldState();
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  const persistSheet = useCallback(
    async (mode: "manual" | "auto") => {
      if (!userId) {
        if (mode === "manual") {
          toast.error("Sign in to save your card");
        }
        return;
      }

      const snapshot = sheetRef.current;
      const snapshotSerialized = JSON.stringify(snapshot);

      if (mode === "manual") {
        setIsSavingSheet(true);
      } else {
        setIsAutoSavingSheet(true);
      }

      try {
        const saved = await saveCardSheet(cardId, snapshot);
        const savedSheet = normalizeSheet(toSheet(saved));
        const hasChangedSinceRequest =
          JSON.stringify(sheetRef.current) !== snapshotSerialized;
        const shouldHydrateSavedSheet =
          !hasChangedSinceRequest &&
          (mode !== "auto" || !isEditableField(document.activeElement));

        resetSheetRef.current = savedSheet;
        setAutoSaveError(null);
        lastFailedAutoSaveSnapshotRef.current = null;

        if (shouldHydrateSavedSheet) {
          suppressDraftDirtyRef.current = true;
          setSheet(savedSheet);
          sheetRef.current = savedSheet;
          setIsDraftDirty(false);
          localDraftRef.current.draftsByCardId[cardId] = savedSheet;
          localDraftRef.current.dirtyByCardId[cardId] = false;
        } else if (!hasChangedSinceRequest) {
          setIsDraftDirty(false);
          localDraftRef.current.draftsByCardId[cardId] = sheetRef.current;
          localDraftRef.current.dirtyByCardId[cardId] = false;
        } else {
          localDraftRef.current.draftsByCardId[cardId] = sheetRef.current;
          localDraftRef.current.dirtyByCardId[cardId] = true;
        }

        writeLocalDraftState(localDraftRef.current);

        if (mode === "manual") {
          toast.success("Card saved");
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save card";
        if (mode === "manual") {
          toast.error(message);
        } else {
          setAutoSaveError(message);
          lastFailedAutoSaveSnapshotRef.current = snapshotSerialized;
        }
      } finally {
        if (mode === "manual") {
          setIsSavingSheet(false);
        } else {
          setIsAutoSavingSheet(false);
        }
      }
    },
    [cardId, userId],
  );

  useEffect(() => {
    if (
      !hasHydratedDraft ||
      !canAutoSave ||
      !isDraftDirty ||
      isSavingSheet ||
      isAutoSavingSheet ||
      isEditableFieldFocused
    ) {
      if (!isDraftDirty && autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      if (!isDraftDirty || isEditableFieldFocused) {
        setHasPendingAutoSave(false);
      }
      return;
    }

    const currentSerialized = JSON.stringify(sheet);
    const lastFailedSnapshot = lastFailedAutoSaveSnapshotRef.current;

    if (lastFailedSnapshot === currentSerialized) {
      setHasPendingAutoSave(false);
      return;
    }

    if (autoSaveError) {
      setAutoSaveError(null);
      lastFailedAutoSaveSnapshotRef.current = null;
    }

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    setHasPendingAutoSave(true);
    autoSaveTimeoutRef.current = setTimeout(() => {
      autoSaveTimeoutRef.current = null;
      setHasPendingAutoSave(false);
      void persistSheet("auto");
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [
    autoSaveError,
    canAutoSave,
    hasHydratedDraft,
    isAutoSavingSheet,
    isEditableFieldFocused,
    isDraftDirty,
    isSavingSheet,
    persistSheet,
    sheet,
  ]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasPendingAutoSave && !isAutoSavingSheet && !isSavingSheet) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [hasPendingAutoSave, isAutoSavingSheet, isSavingSheet]);

  function queueOverrideSync(nextSheet: PickEmSheet) {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      setIsSyncingOverrides(true);

      try {
        await updateCardOverrides(cardId, {
          eventName: normalizeNullable(nextSheet.eventName),
          promotionName: normalizeNullable(nextSheet.promotionName),
          eventDate: normalizeNullable(nextSheet.eventDate),
          eventTagline: normalizeNullable(nextSheet.eventTagline),
          defaultPoints: nextSheet.defaultPoints,
          tiebreakerLabel: normalizeNullable(nextSheet.tiebreakerLabel),
          tiebreakerIsTimeBased: nextSheet.tiebreakerIsTimeBased,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to sync card overrides";
        toast.error(message);
      } finally {
        setIsSyncingOverrides(false);
      }
    }, 500);
  }

  function addMatch() {
    const newMatch = createMatch();

    setSheet((prev) => ({
      ...prev,
      matches: [...prev.matches, newMatch],
    }));
  }

  function updateMatch(index: number, updated: Match) {
    setSheet((prev) => ({
      ...prev,
      matches: prev.matches.map((match, i) => (i === index ? updated : match)),
    }));
  }

  function removeMatch(index: number) {
    setSheet((prev) => ({
      ...prev,
      matches: prev.matches.filter((_, i) => i !== index),
    }));
  }

  function moveMatch(index: number, direction: "up" | "down") {
    setSheet((prev) => {
      const newMatches = [...prev.matches];
      const swapIndex = direction === "up" ? index - 1 : index + 1;

      if (swapIndex < 0 || swapIndex >= newMatches.length) {
        return prev;
      }

      [newMatches[index], newMatches[swapIndex]] = [
        newMatches[swapIndex],
        newMatches[index],
      ];
      return { ...prev, matches: newMatches };
    });
  }

  function duplicateMatch(index: number) {
    setSheet((prev) => {
      const source = prev.matches[index];
      const clone = {
        ...JSON.parse(JSON.stringify(source)),
        id: crypto.randomUUID(),
      };

      clone.bonusQuestions = clone.bonusQuestions.map(
        (question: BonusQuestion) => ({
          ...question,
          id: crypto.randomUUID(),
        }),
      );

      const newMatches = [...prev.matches];
      newMatches.splice(index + 1, 0, clone);
      return { ...prev, matches: newMatches };
    });
  }

  function handlePrint() {
    window.print();
  }

  function handleReset() {
    suppressDraftDirtyRef.current = true;
    setSheet(resetSheetRef.current);
    setIsDraftDirty(false);
    setActiveTab("editor");
  }

  function handleExport() {
    const json = JSON.stringify(sheet, null, 2);
    const bytes = new TextEncoder().encode(json);
    let binary = "";

    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    const encoded = btoa(binary);
    const blob = new Blob([encoded], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;

    const safeName = (sheet.eventName.trim() || "pick-em-sheet")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");

    anchor.download = `${safeName}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const raw = loadEvent.target?.result as string;
        const decoded = atob(raw.trim());
        const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        const parsed = normalizeSheet(JSON.parse(json) as PickEmSheet);
        setSheet(parsed);
        setActiveTab("editor");
      } catch {
        toast.error("Failed to import: the file appears to be invalid.");
      }
    };

    reader.readAsText(file);
    event.target.value = "";
  }

  function handleEventSettingsChange(nextSheet: PickEmSheet) {
    setSheet(nextSheet);
    queueOverrideSync(nextSheet);
  }

  async function handleSaveSheet() {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
      setHasPendingAutoSave(false);
    }

    await persistSheet("manual");
  }

  const draftStatusMessage = (() => {
    if (!isAuthLoaded) {
      return "Loading account status...";
    }

    if (!userId) {
      return isDraftDirty
        ? "Unsaved local sheet edits in this browser."
        : "Saved locally in this browser (not signed in).";
    }

    if (isSavingSheet || isAutoSavingSheet) {
      return "Saving sheet...";
    }

    if (isEditableFieldFocused && isDraftDirty) {
      return "Editing a field. Autosave resumes when focus leaves input.";
    }

    if (hasPendingAutoSave) {
      return "Changes queued. Autosaving shortly...";
    }

    if (autoSaveError) {
      return `Autosave paused after an error: ${autoSaveError}`;
    }

    return isDraftDirty ? "Unsaved local edits." : "All sheet edits are saved.";
  })();

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background print:bg-white">
      <div className="no-print pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(230,170,60,0.20),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(130,160,255,0.12),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_35%)]" />
      <PageHeader
        hasMatches={hasMatches}
        hasEventName={hasEventName}
        onImportClick={handleImportClick}
        onExport={handleExport}
        onReset={handleReset}
        onPrint={handlePrint}
        onSave={() => {
          void handleSaveSheet();
        }}
        isSaving={isSavingSheet || isAutoSavingSheet}
        canSave={isAuthLoaded && Boolean(userId)}
        liveHref={`/cards/${cardId}/live`}
      />

      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
      />

      <main className="no-print relative z-10 mx-auto max-w-5xl px-4 py-6 lg:py-8">
        <section className="rounded-2xl border border-border/70 bg-card/65 p-4 shadow-[0_24px_50px_rgba(0,0,0,0.28)] backdrop-blur lg:p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <TabsList className="bg-secondary/80">
                <TabsTrigger
                  value="editor"
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  Editor
                </TabsTrigger>
                <TabsTrigger
                  value="preview"
                  disabled={!hasMatches}
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  Print Preview
                </TabsTrigger>
              </TabsList>
              <div className="w-full rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground sm:w-auto sm:max-w-[28rem]">
                <p>
                  {isSyncingOverrides
                    ? "Syncing event settings to card overrides..."
                    : "Event settings sync directly to this card."}
                </p>
                <p
                  className={
                    autoSaveError
                      ? "mt-1 leading-relaxed text-destructive"
                      : "mt-1 leading-relaxed"
                  }
                >
                  {draftStatusMessage}
                </p>
              </div>
            </div>

            <TabsContent value="editor" className="mt-0">
              {isLoadingCard ? (
                <div className="rounded-lg border border-border bg-background/50 p-8 text-center text-muted-foreground">
                  Loading card...
                </div>
              ) : (
                <EditorView
                  sheet={sheet}
                  hasMatches={hasMatches}
                  onSheetChange={handleEventSettingsChange}
                  onAddMatch={addMatch}
                  onUpdateMatch={updateMatch}
                  onRemoveMatch={removeMatch}
                  onDuplicateMatch={duplicateMatch}
                  onMoveMatch={moveMatch}
                />
              )}
            </TabsContent>

            <TabsContent value="preview" className="mt-0">
              <PreviewView
                sheet={sheet}
                hasMatches={hasMatches}
                printRef={printRef}
                onPrint={handlePrint}
              />
            </TabsContent>
          </Tabs>
        </section>
      </main>

      <div className="print-only-wrapper">
        <PrintSheet sheet={sheet} />
      </div>
    </div>
  );
}
