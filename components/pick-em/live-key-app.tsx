"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/client/clerk-test-mode";
import { Button } from "@/components/ui/button";
import { getCard, type ResolvedCard } from "@/lib/client/cards-api";
import { getLiveKeyState, saveLiveKey } from "@/lib/client/live-keys-api";
import { getDefaultMatchType, normalizeMatchTypeId } from "@/lib/match-types";
import type {
  CardLiveKeyPayload,
  LiveKeyAnswer,
  LiveKeyMatchResult,
  LiveKeyTimer,
  Match,
  PickEmSheet,
} from "@/lib/types";
import {
  nowIso,
  toMatchTimerId,
  toMatchBonusTimerId,
  toEventBonusTimerId,
  isSystemTimerId,
} from "@/lib/pick-em/timer-utils";
import { snapshotPayload } from "@/lib/pick-em/payload-utils";
import { useRosterSuggestions } from "@/hooks/use-roster-suggestions";
import { toast } from "sonner";

import { useAppStore } from "@/stores/app-store";
import { useLiveCard, useLivePayload, useLiveUi } from "@/stores/selectors";

import { LiveKeyHeader } from "@/components/pick-em/live-key/live-key-header";
import { TimerManagementPanel } from "@/components/pick-em/live-key/timer-management-panel";
import { LiveKeyMatchSection } from "@/components/pick-em/live-key/live-key-match-section";
import { EventBonusSection } from "@/components/pick-em/live-key/event-bonus-section";
import { TiebreakerSection } from "@/components/pick-em/live-key/tiebreaker-section";

/* ── Constants ─────────────────────────────────────────────── */

const LOCAL_STORAGE_PREFIX = "pick-em-live-key-v2";
const LOCAL_EDITOR_DRAFT_STORAGE_KEY = "pick-em-editor-draft-v2";

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

/* ── Local types ───────────────────────────────────────────── */

interface LocalLiveKeyRecord {
  payload: CardLiveKeyPayload;
  cardSnapshot: ResolvedCard | null;
  dirty: boolean;
  lastSyncedAt: string | null;
  updatedAt: string;
}

interface LiveKeyAppProps {
  cardId: string;
}

interface LocalDraftState {
  draftsByCardId: Record<string, PickEmSheet>;
  dirtyByCardId: Record<string, boolean>;
}

interface EditorDraftRecord {
  sheet: PickEmSheet;
  isDirty: boolean;
}

/* ── Normalization helpers (unchanged from original) ───────── */

function getStorageKey(
  cardId: string,
  userId: string | null | undefined,
): string {
  return `${LOCAL_STORAGE_PREFIX}:${cardId}:${userId ?? "anon"}`;
}

function normalizeAnswer(value: unknown): LiveKeyAnswer | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<LiveKeyAnswer>;
  if (typeof raw.questionId !== "string") return null;
  return {
    questionId: raw.questionId,
    answer: typeof raw.answer === "string" ? raw.answer : "",
    recordedAt: typeof raw.recordedAt === "string" ? raw.recordedAt : null,
    timerId: typeof raw.timerId === "string" ? raw.timerId : null,
  };
}

function normalizeMatchResult(value: unknown): LiveKeyMatchResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<LiveKeyMatchResult>;
  if (typeof raw.matchId !== "string") return null;
  return {
    matchId: raw.matchId,
    winnerName: typeof raw.winnerName === "string" ? raw.winnerName : "",
    winnerRecordedAt:
      typeof raw.winnerRecordedAt === "string" ? raw.winnerRecordedAt : null,
    battleRoyalEntryOrder: Array.isArray(raw.battleRoyalEntryOrder)
      ? raw.battleRoyalEntryOrder
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [],
    bonusAnswers: Array.isArray(raw.bonusAnswers)
      ? raw.bonusAnswers
          .map((answer) => normalizeAnswer(answer))
          .filter((answer): answer is LiveKeyAnswer => answer !== null)
      : [],
  };
}

function normalizeTimer(value: unknown): LiveKeyTimer | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<LiveKeyTimer>;
  if (typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    label: typeof raw.label === "string" ? raw.label : "",
    elapsedMs:
      typeof raw.elapsedMs === "number" && Number.isFinite(raw.elapsedMs)
        ? Math.max(0, raw.elapsedMs)
        : 0,
    isRunning: raw.isRunning === true,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
  };
}

function normalizePayload(
  value: Partial<CardLiveKeyPayload> | CardLiveKeyPayload | null | undefined,
): CardLiveKeyPayload {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_PAYLOAD };
  }
  return {
    timers: Array.isArray(value.timers)
      ? value.timers
          .map((timer) => normalizeTimer(timer))
          .filter((timer): timer is LiveKeyTimer => timer !== null)
      : [],
    matchResults: Array.isArray(value.matchResults)
      ? value.matchResults
          .map((result) => normalizeMatchResult(result))
          .filter((result): result is LiveKeyMatchResult => result !== null)
      : [],
    eventBonusAnswers: Array.isArray(value.eventBonusAnswers)
      ? value.eventBonusAnswers
          .map((answer) => normalizeAnswer(answer))
          .filter((answer): answer is LiveKeyAnswer => answer !== null)
      : [],
    tiebreakerAnswer:
      typeof value.tiebreakerAnswer === "string" ? value.tiebreakerAnswer : "",
    tiebreakerRecordedAt:
      typeof value.tiebreakerRecordedAt === "string"
        ? value.tiebreakerRecordedAt
        : null,
    tiebreakerTimerId:
      typeof value.tiebreakerTimerId === "string"
        ? value.tiebreakerTimerId
        : null,
    scoreOverrides: Array.isArray(value.scoreOverrides)
      ? value.scoreOverrides
      : [],
    winnerOverrides: Array.isArray(value.winnerOverrides)
      ? value.winnerOverrides
      : [],
  };
}

function readLocalRecord(storageKey: string): LocalLiveKeyRecord | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalLiveKeyRecord>;
    return {
      payload: normalizePayload(parsed.payload),
      cardSnapshot:
        (parsed.cardSnapshot as ResolvedCard | null | undefined) ?? null,
      dirty: parsed.dirty === true,
      lastSyncedAt:
        typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeLocalRecord(
  storageKey: string,
  record: LocalLiveKeyRecord,
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(record));
  } catch {
    // Ignore storage write failures.
  }
}

function normalizeDraftMatch(value: unknown): Match | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Match> & {
    announcedParticipants?: string[];
    typeLabelOverride?: string;
    isEliminationStyle?: boolean;
  };
  if (typeof raw.id !== "string") return null;

  const inferredBattleRoyal =
    raw.isBattleRoyal === true || raw.type === "battleRoyal";
  const normalizedType = normalizeMatchTypeId(raw.type, inferredBattleRoyal);
  const defaultMatchType = getDefaultMatchType(normalizedType);
  const isBattleRoyal =
    typeof raw.isBattleRoyal === "boolean"
      ? raw.isBattleRoyal
      : (defaultMatchType?.defaultRuleSetIds.includes("timed-entry") ??
        raw.type === "battleRoyal");
  const participants = Array.isArray(raw.participants)
    ? raw.participants
    : Array.isArray(raw.announcedParticipants)
      ? raw.announcedParticipants
      : [];

  return {
    id: raw.id,
    type: normalizedType,
    typeLabelOverride:
      typeof raw.typeLabelOverride === "string" ? raw.typeLabelOverride : "",
    isBattleRoyal,
    isEliminationStyle: raw.isEliminationStyle === true,
    title: typeof raw.title === "string" ? raw.title : "",
    description: typeof raw.description === "string" ? raw.description : "",
    participants,
    surpriseSlots:
      isBattleRoyal && typeof raw.surpriseSlots === "number"
        ? raw.surpriseSlots
        : 0,
    surpriseEntrantPoints:
      isBattleRoyal && typeof raw.surpriseEntrantPoints === "number"
        ? raw.surpriseEntrantPoints
        : null,
    bonusQuestions: Array.isArray(raw.bonusQuestions) ? raw.bonusQuestions : [],
    points: typeof raw.points === "number" ? raw.points : null,
  };
}

function normalizeDraftSheet(value: unknown): PickEmSheet | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<PickEmSheet>;
  return {
    eventName: typeof raw.eventName === "string" ? raw.eventName : "",
    promotionName:
      typeof raw.promotionName === "string" ? raw.promotionName : "",
    eventDate: typeof raw.eventDate === "string" ? raw.eventDate : "",
    eventTagline: typeof raw.eventTagline === "string" ? raw.eventTagline : "",
    defaultPoints:
      typeof raw.defaultPoints === "number" &&
      Number.isFinite(raw.defaultPoints)
        ? raw.defaultPoints
        : 1,
    tiebreakerLabel:
      typeof raw.tiebreakerLabel === "string" ? raw.tiebreakerLabel : "",
    tiebreakerIsTimeBased: raw.tiebreakerIsTimeBased === true,
    matches: Array.isArray(raw.matches)
      ? raw.matches
          .map((match) => normalizeDraftMatch(match))
          .filter((match): match is Match => match !== null)
      : [],
    eventBonusQuestions: Array.isArray(raw.eventBonusQuestions)
      ? raw.eventBonusQuestions
      : [],
  };
}

function readEditorDraft(cardId: string): EditorDraftRecord | null {
  try {
    const raw = localStorage.getItem(LOCAL_EDITOR_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraftState>;
    const draft = parsed.draftsByCardId?.[cardId];
    const normalized = normalizeDraftSheet(draft);
    if (!normalized) return null;
    const isDirty = parsed.dirtyByCardId?.[cardId] === true;
    return { sheet: normalized, isDirty };
  } catch {
    return null;
  }
}

function applyEditorDraftToCard(
  card: ResolvedCard | null,
  draft: PickEmSheet | null,
): ResolvedCard | null {
  if (!card || !draft) return card;
  return {
    ...card,
    eventName: draft.eventName,
    promotionName: draft.promotionName,
    eventDate: draft.eventDate,
    eventTagline: draft.eventTagline,
    defaultPoints: draft.defaultPoints,
    tiebreakerLabel: draft.tiebreakerLabel,
    tiebreakerIsTimeBased: draft.tiebreakerIsTimeBased,
    matches: draft.matches,
    eventBonusQuestions: draft.eventBonusQuestions,
  };
}

/* ── Timer ensurer ─────────────────────────────────────────── */

function getQuestionValueType(question: {
  valueType?: "string" | "numerical" | "time" | "rosterMember";
  isTimeBased?: boolean;
  isCountBased?: boolean;
}): "string" | "numerical" | "time" | "rosterMember" {
  if (
    question.valueType === "numerical" ||
    question.valueType === "time" ||
    question.valueType === "rosterMember"
  ) {
    return question.valueType;
  }
  if (question.isTimeBased) return "time";
  if (question.isCountBased) return "numerical";
  return "string";
}

function buildMatchTimerLabel(match: Match, index: number): string {
  const title = match.title.trim() || `Match ${index + 1}`;
  return `Match ${index + 1}: ${title}`;
}

function buildMatchBonusTimerLabel(
  match: Match,
  matchIndex: number,
  questionText: string,
): string {
  const title = match.title.trim() || `Match ${matchIndex + 1}`;
  const suffix = questionText.trim() || "Bonus";
  return `Match ${matchIndex + 1} Bonus: ${title} - ${suffix}`;
}

function buildEventBonusTimerLabel(
  questionText: string,
  questionIndex: number,
): string {
  const suffix = questionText.trim() || `Question ${questionIndex + 1}`;
  return `Event Bonus Timer: ${suffix}`;
}

function createTimer(id: string, label: string): LiveKeyTimer {
  return { id, label, elapsedMs: 0, isRunning: false, startedAt: null };
}

function ensureSystemTimers(
  payload: CardLiveKeyPayload,
  matches: Match[],
  eventBonusQuestions: PickEmSheet["eventBonusQuestions"],
): CardLiveKeyPayload {
  const timersById = new Map(payload.timers.map((timer) => [timer.id, timer]));
  const systemTimers: LiveKeyTimer[] = [];

  matches.forEach((match, index) => {
    const timerId = toMatchTimerId(match.id);
    const existing = timersById.get(timerId);
    const label = buildMatchTimerLabel(match, index);
    systemTimers.push(
      existing ? { ...existing, label } : createTimer(timerId, label),
    );

    match.bonusQuestions.forEach((question) => {
      if (getQuestionValueType(question) !== "time") return;
      const bonusTimerId = toMatchBonusTimerId(match.id, question.id);
      const bonusLabel = buildMatchBonusTimerLabel(
        match,
        index,
        question.question,
      );
      const existingBonus = timersById.get(bonusTimerId);
      systemTimers.push(
        existingBonus
          ? { ...existingBonus, label: bonusLabel }
          : createTimer(bonusTimerId, bonusLabel),
      );
    });
  });

  eventBonusQuestions.forEach((question, index) => {
    if (getQuestionValueType(question) !== "time") return;
    const timerId = toEventBonusTimerId(question.id);
    const label = buildEventBonusTimerLabel(question.question, index);
    const existing = timersById.get(timerId);
    systemTimers.push(
      existing ? { ...existing, label } : createTimer(timerId, label),
    );
  });

  const customTimers = payload.timers.filter(
    (timer) => !isSystemTimerId(timer.id),
  );

  return {
    ...payload,
    timers: [...systemTimers, ...customTimers],
  };
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return parsed.toLocaleString();
}

/* ── Shell component ───────────────────────────────────────── */

export function LiveKeyApp({ cardId }: LiveKeyAppProps) {
  const { userId, isLoaded: isAuthLoaded } = useAuth();
  const storageKey = useMemo(
    () => getStorageKey(cardId, userId),
    [cardId, userId],
  );

  /* ── Store access ──────────────────────────────────────── */
  const card = useLiveCard();
  const payload = useLivePayload();
  const { isLoading, isDirty, lastSyncedAt, syncError } = useLiveUi();

  const setLiveCard = useAppStore((s) => s.setLiveCard);
  const setLivePayload = useAppStore((s) => s.setLivePayload);
  const setLiveUi = useAppStore((s) => s.setLiveUi);

  /* ── Local orchestration state ─────────────────────────── */
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [hasInitialized, setHasInitialized] = useState(false);
  const [usingEditorDraft, setUsingEditorDraft] = useState(false);

  const roster = useRosterSuggestions({ promotionName: card?.promotionName });

  /* ── Refs ──────────────────────────────────────────────── */
  const suppressDirtyRef = useRef(false);
  const lastSyncedSnapshotRef = useRef<string>(snapshotPayload(EMPTY_PAYLOAD));
  const payloadRef = useRef<CardLiveKeyPayload>(EMPTY_PAYLOAD);
  const isSyncingRef = useRef(false);
  const pendingAutoSyncRef = useRef(false);

  /* ── Helper: set payload via store, optionally managing dirty/sync ── */
  const applySystemPayload = useCallback(
    (
      nextPayload: CardLiveKeyPayload,
      options?: { dirty?: boolean; lastSyncedAt?: string | null },
    ) => {
      suppressDirtyRef.current = true;
      setLivePayload(nextPayload);
      if (options?.dirty !== undefined) {
        setLiveUi({ isDirty: options.dirty });
        if (options.dirty === false) {
          lastSyncedSnapshotRef.current = snapshotPayload(nextPayload);
        }
      }
      if (options?.lastSyncedAt !== undefined) {
        setLiveUi({ lastSyncedAt: options.lastSyncedAt });
      }
    },
    [setLivePayload, setLiveUi],
  );

  /* ── Online/Offline tracking ───────────────────────────── */
  useEffect(() => {
    function onOnline() {
      setIsOnline(true);
    }
    function onOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  /* ── Load data on mount ────────────────────────────────── */
  const loadData = useCallback(async () => {
    setLiveUi({ isLoading: true });

    const localRecord = readLocalRecord(storageKey);
    const editorDraftRecord = readEditorDraft(cardId);
    const activeEditorDraft = editorDraftRecord?.isDirty
      ? editorDraftRecord.sheet
      : null;
    setUsingEditorDraft(Boolean(activeEditorDraft));

    const localCard = applyEditorDraftToCard(
      localRecord?.cardSnapshot ?? null,
      activeEditorDraft,
    );

    if (localRecord) {
      applySystemPayload(localRecord.payload, {
        dirty: localRecord.dirty,
        lastSyncedAt: localRecord.lastSyncedAt,
      });
      setLiveCard(localCard);
    } else {
      applySystemPayload(
        { ...EMPTY_PAYLOAD },
        { dirty: false, lastSyncedAt: null },
      );
      setLiveCard(null);
    }

    let loadedCard: ResolvedCard | null = null;

    try {
      loadedCard = applyEditorDraftToCard(
        await getCard(cardId),
        activeEditorDraft,
      );
      setLiveCard(loadedCard);
    } catch (error) {
      if (!localCard) {
        const message =
          error instanceof Error ? error.message : "Failed to load card";
        toast.error(message);
      }
    }

    let liveState: Awaited<ReturnType<typeof getLiveKeyState>> | null = null;

    if (userId) {
      try {
        liveState = await getLiveKeyState(cardId);
      } catch {
        liveState = null;
      }
    }

    const cardForTimers = loadedCard ?? localCard ?? null;

    if (liveState) {
      if (!localRecord?.dirty) {
        const nextPayload = ensureSystemTimers(
          normalizePayload(liveState.key.payload),
          cardForTimers?.matches ?? [],
          cardForTimers?.eventBonusQuestions ?? [],
        );
        applySystemPayload(nextPayload, {
          dirty: false,
          lastSyncedAt: liveState.key.updatedAt,
        });
      } else {
        applySystemPayload(
          ensureSystemTimers(
            normalizePayload(localRecord.payload),
            cardForTimers?.matches ?? [],
            cardForTimers?.eventBonusQuestions ?? [],
          ),
          { dirty: true, lastSyncedAt: localRecord.lastSyncedAt },
        );
      }
    } else {
      const sourcePayload = localRecord?.payload ?? EMPTY_PAYLOAD;
      applySystemPayload(
        ensureSystemTimers(
          normalizePayload(sourcePayload),
          cardForTimers?.matches ?? [],
          cardForTimers?.eventBonusQuestions ?? [],
        ),
        {
          dirty: localRecord?.dirty ?? false,
          lastSyncedAt: localRecord?.lastSyncedAt ?? null,
        },
      );
    }

    setLiveUi({ syncError: null, isLoading: false });
    setHasInitialized(true);
  }, [applySystemPayload, cardId, storageKey, userId, setLiveCard, setLiveUi]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /* ── Ensure system timers when card changes ────────────── */
  useEffect(() => {
    if (!card) return;
    const currentPayload = useAppStore.getState().livePayload;
    applySystemPayload(
      ensureSystemTimers(currentPayload, card.matches, card.eventBonusQuestions),
    );
  }, [card, applySystemPayload]);

  /* ── Dirty tracking ────────────────────────────────────── */
  useEffect(() => {
    if (!hasInitialized) return;
    if (suppressDirtyRef.current) {
      suppressDirtyRef.current = false;
      return;
    }
    if (snapshotPayload(payload) === lastSyncedSnapshotRef.current) {
      setLiveUi({ isDirty: false });
      return;
    }
    setLiveUi({ isDirty: true, syncError: null });
  }, [hasInitialized, payload, setLiveUi]);

  /* ── Keep ref in sync ──────────────────────────────────── */
  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  /* ── localStorage persistence ──────────────────────────── */
  useEffect(() => {
    if (!hasInitialized) return;
    writeLocalRecord(storageKey, {
      payload,
      cardSnapshot: card,
      dirty: isDirty,
      lastSyncedAt,
      updatedAt: nowIso(),
    });
  }, [hasInitialized, storageKey, payload, card, isDirty, lastSyncedAt]);

  /* ── Auto-sync debounce ────────────────────────────────── */
  const canSyncToServer = Boolean(userId && isOnline && card);

  const syncPayloadToServer = useCallback(
    async (mode: "manual" | "auto") => {
      if (!card || !userId || !isOnline) {
        return false;
      }
      if (mode === "auto" && isSyncingRef.current) {
        pendingAutoSyncRef.current = true;
        return false;
      }
      if (mode === "manual") {
        setLiveUi({ isSaving: true });
      }

      const payloadToSync = ensureSystemTimers(
        payloadRef.current,
        card.matches,
        card.eventBonusQuestions,
      );
      const payloadSnapshot = snapshotPayload(payloadToSync);
      isSyncingRef.current = true;

      try {
        const saved = await saveLiveKey(cardId, payloadToSync);
        lastSyncedSnapshotRef.current = payloadSnapshot;
        setLiveUi({
          lastSyncedAt: saved.updatedAt,
          syncError: null,
        });
        if (snapshotPayload(payloadRef.current) === payloadSnapshot) {
          setLiveUi({ isDirty: false });
        }
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to sync live key";
        setLiveUi({ syncError: message });
        return false;
      } finally {
        isSyncingRef.current = false;
        if (mode === "manual") {
          setLiveUi({ isSaving: false });
        }
        if (pendingAutoSyncRef.current) {
          pendingAutoSyncRef.current = false;
          void syncPayloadToServer("auto");
        }
      }
    },
    [card, cardId, isOnline, userId, setLiveUi],
  );

  useEffect(() => {
    if (!hasInitialized || !isDirty || !canSyncToServer) return;
    const timeoutId = window.setTimeout(() => {
      void syncPayloadToServer("auto");
    }, 900);
    return () => window.clearTimeout(timeoutId);
  }, [canSyncToServer, hasInitialized, isDirty, payload, syncPayloadToServer]);

  /* ── Sync status text ──────────────────────────────────── */
  const syncStatus = useMemo(() => {
    if (!userId) {
      return "Local-only mode (not signed in).";
    }
    if (!isOnline) {
      return "Offline: changes are saved locally and will sync when online.";
    }
    if (syncError) {
      return `Sync failed: ${syncError}`;
    }
    if (isDirty) {
      return "Unsynced cloud changes (saved locally).";
    }
    if (lastSyncedAt) {
      return `Synced ${formatTimestamp(lastSyncedAt)}`;
    }
    return "Cloud sync ready.";
  }, [isDirty, isOnline, lastSyncedAt, syncError, userId]);

  /* ── Save / Refresh handlers ───────────────────────────── */
  const handleSave = useCallback(async () => {
    if (canSyncToServer) {
      while (isSyncingRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      const ok = await syncPayloadToServer("manual");
      if (ok) {
        toast.success("Live key saved");
      } else {
        toast.error("Could not sync. Changes are still stored locally.");
      }
      return;
    }
    toast.success(
      userId ? "Saved locally (offline)." : "Saved locally (not signed in).",
    );
  }, [canSyncToServer, syncPayloadToServer, userId]);

  const handleRefresh = useCallback(async () => {
    setLiveUi({ isRefreshing: true });
    try {
      await loadData();
    } finally {
      setLiveUi({ isRefreshing: false });
    }
  }, [loadData, setLiveUi]);

  /* ── Render ────────────────────────────────────────────── */

  if (!isAuthLoaded) {
    return (
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 text-sm text-muted-foreground">
        Loading authentication...
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 text-sm text-muted-foreground">
        Loading live key...
      </div>
    );
  }

  if (!card) {
    return (
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-semibold">Live Key Tracking</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No card data is available. Open this card once online to cache it for
          offline use.
        </p>
        <Button asChild className="mt-4">
          <Link href="/">Back to Home</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(230,170,60,0.20),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(130,160,255,0.12),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_35%)]" />

      <LiveKeyHeader
        cardId={cardId}
        syncStatus={syncStatus}
        usingEditorDraft={usingEditorDraft}
        onSave={() => void handleSave()}
        onRefresh={() => void handleRefresh()}
      />

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <TimerManagementPanel />

        {card.matches.map((match, index) => (
          <LiveKeyMatchSection
            key={match.id}
            matchIndex={index}
            roster={roster}
          />
        ))}

        <EventBonusSection roster={roster} />

        <TiebreakerSection />
      </main>
    </div>
  );
}
