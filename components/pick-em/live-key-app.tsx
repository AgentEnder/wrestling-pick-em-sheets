"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "@/lib/client/clerk-test-mode"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCard, type ResolvedCard } from "@/lib/client/cards-api"
import { getLiveKeyState, saveLiveKey } from "@/lib/client/live-keys-api"
import { getDefaultMatchType, normalizeMatchTypeId } from "@/lib/match-types"
import { getRosterSuggestions } from "@/lib/client/roster-api"
import type { CardLiveKeyPayload, LiveKeyAnswer, LiveKeyMatchResult, LiveKeyTimer, Match, PickEmSheet } from "@/lib/types"
import { ArrowLeft, Pause, Play, Plus, RefreshCcw, RotateCcw, Save, Timer, Trash2 } from "lucide-react"
import { toast } from "sonner"

const MATCH_TIMER_PREFIX = "match:"
const MATCH_BONUS_TIMER_PREFIX = "match-bonus:"
const EVENT_BONUS_TIMER_PREFIX = "event-bonus:"
const CUSTOM_TIMER_PREFIX = "custom:"
const LOCAL_STORAGE_PREFIX = "pick-em-live-key-v2"
const LOCAL_EDITOR_DRAFT_STORAGE_KEY = "pick-em-editor-draft-v2"

const EMPTY_PAYLOAD: CardLiveKeyPayload = {
  timers: [],
  matchResults: [],
  eventBonusAnswers: [],
  tiebreakerAnswer: "",
  tiebreakerRecordedAt: null,
  tiebreakerTimerId: null,
}

interface LocalLiveKeyRecord {
  payload: CardLiveKeyPayload
  cardSnapshot: ResolvedCard | null
  dirty: boolean
  lastSyncedAt: string | null
  updatedAt: string
}

interface LiveKeyAppProps {
  cardId: string
}

interface LocalDraftState {
  draftsByCardId: Record<string, PickEmSheet>
  dirtyByCardId: Record<string, boolean>
}

interface EditorDraftRecord {
  sheet: PickEmSheet
  isDirty: boolean
}

function getStorageKey(cardId: string, userId: string | null | undefined): string {
  return `${LOCAL_STORAGE_PREFIX}:${cardId}:${userId ?? "anon"}`
}

function normalizeAnswer(value: unknown): LiveKeyAnswer | null {
  if (!value || typeof value !== "object") return null

  const raw = value as Partial<LiveKeyAnswer>
  if (typeof raw.questionId !== "string") return null

  return {
    questionId: raw.questionId,
    answer: typeof raw.answer === "string" ? raw.answer : "",
    recordedAt: typeof raw.recordedAt === "string" ? raw.recordedAt : null,
    timerId: typeof raw.timerId === "string" ? raw.timerId : null,
  }
}

function normalizeMatchResult(value: unknown): LiveKeyMatchResult | null {
  if (!value || typeof value !== "object") return null

  const raw = value as Partial<LiveKeyMatchResult>
  if (typeof raw.matchId !== "string") return null

  return {
    matchId: raw.matchId,
    winnerName: typeof raw.winnerName === "string" ? raw.winnerName : "",
    winnerRecordedAt: typeof raw.winnerRecordedAt === "string" ? raw.winnerRecordedAt : null,
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
  }
}

function normalizeTimer(value: unknown): LiveKeyTimer | null {
  if (!value || typeof value !== "object") return null

  const raw = value as Partial<LiveKeyTimer>
  if (typeof raw.id !== "string") return null

  return {
    id: raw.id,
    label: typeof raw.label === "string" ? raw.label : "",
    elapsedMs: typeof raw.elapsedMs === "number" && Number.isFinite(raw.elapsedMs)
      ? Math.max(0, raw.elapsedMs)
      : 0,
    isRunning: raw.isRunning === true,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
  }
}

function normalizePayload(value: Partial<CardLiveKeyPayload> | CardLiveKeyPayload | null | undefined): CardLiveKeyPayload {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_PAYLOAD }
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
    tiebreakerAnswer: typeof value.tiebreakerAnswer === "string" ? value.tiebreakerAnswer : "",
    tiebreakerRecordedAt: typeof value.tiebreakerRecordedAt === "string" ? value.tiebreakerRecordedAt : null,
    tiebreakerTimerId: typeof value.tiebreakerTimerId === "string" ? value.tiebreakerTimerId : null,
  }
}

function readLocalRecord(storageKey: string): LocalLiveKeyRecord | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<LocalLiveKeyRecord>
    return {
      payload: normalizePayload(parsed.payload),
      cardSnapshot: (parsed.cardSnapshot as ResolvedCard | null | undefined) ?? null,
      dirty: parsed.dirty === true,
      lastSyncedAt: typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function writeLocalRecord(storageKey: string, record: LocalLiveKeyRecord): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(record))
  } catch {
    // Ignore storage write failures.
  }
}

function normalizeDraftMatch(value: unknown): Match | null {
  if (!value || typeof value !== "object") return null

  const raw = value as Partial<Match> & {
    announcedParticipants?: string[]
    typeLabelOverride?: string
    isEliminationStyle?: boolean
  }
  if (typeof raw.id !== "string") return null

  const inferredBattleRoyal = raw.isBattleRoyal === true || raw.type === "battleRoyal"
  const normalizedType = normalizeMatchTypeId(raw.type, inferredBattleRoyal)
  const defaultMatchType = getDefaultMatchType(normalizedType)
  const isBattleRoyal =
    typeof raw.isBattleRoyal === "boolean"
      ? raw.isBattleRoyal
      : (defaultMatchType?.defaultRuleSetIds.includes("timed-entry") ?? raw.type === "battleRoyal")
  const participants = Array.isArray(raw.participants)
    ? raw.participants
    : Array.isArray(raw.announcedParticipants) ? raw.announcedParticipants : []

  return {
    id: raw.id,
    type: normalizedType,
    typeLabelOverride: typeof raw.typeLabelOverride === "string" ? raw.typeLabelOverride : "",
    isBattleRoyal,
    isEliminationStyle: raw.isEliminationStyle === true,
    title: typeof raw.title === "string" ? raw.title : "",
    description: typeof raw.description === "string" ? raw.description : "",
    participants,
    surpriseSlots: isBattleRoyal && typeof raw.surpriseSlots === "number" ? raw.surpriseSlots : 0,
    surpriseEntrantPoints:
      isBattleRoyal && typeof raw.surpriseEntrantPoints === "number" ? raw.surpriseEntrantPoints : null,
    bonusQuestions: Array.isArray(raw.bonusQuestions) ? raw.bonusQuestions : [],
    points: typeof raw.points === "number" ? raw.points : null,
  }
}

function normalizeDraftSheet(value: unknown): PickEmSheet | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const raw = value as Partial<PickEmSheet>

  return {
    eventName: typeof raw.eventName === "string" ? raw.eventName : "",
    promotionName: typeof raw.promotionName === "string" ? raw.promotionName : "",
    eventDate: typeof raw.eventDate === "string" ? raw.eventDate : "",
    eventTagline: typeof raw.eventTagline === "string" ? raw.eventTagline : "",
    defaultPoints: typeof raw.defaultPoints === "number" && Number.isFinite(raw.defaultPoints) ? raw.defaultPoints : 1,
    tiebreakerLabel: typeof raw.tiebreakerLabel === "string" ? raw.tiebreakerLabel : "",
    tiebreakerIsTimeBased: raw.tiebreakerIsTimeBased === true,
    matches: Array.isArray(raw.matches)
      ? raw.matches
        .map((match) => normalizeDraftMatch(match))
        .filter((match): match is Match => match !== null)
      : [],
    eventBonusQuestions: Array.isArray(raw.eventBonusQuestions) ? raw.eventBonusQuestions : [],
  }
}

function readEditorDraft(cardId: string): EditorDraftRecord | null {
  try {
    const raw = localStorage.getItem(LOCAL_EDITOR_DRAFT_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<LocalDraftState>
    const draft = parsed.draftsByCardId?.[cardId]
    const normalized = normalizeDraftSheet(draft)
    if (!normalized) return null

    const isDirty = parsed.dirtyByCardId?.[cardId] === true
    return {
      sheet: normalized,
      isDirty,
    }
  } catch {
    return null
  }
}

function applyEditorDraftToCard(card: ResolvedCard | null, draft: PickEmSheet | null): ResolvedCard | null {
  if (!card || !draft) return card

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
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not recorded"

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Not recorded"
  return parsed.toLocaleString()
}

function nowIso(): string {
  return new Date().toISOString()
}

function nowMs(): number {
  return Date.now()
}

function snapshotPayload(payload: CardLiveKeyPayload): string {
  return JSON.stringify(payload)
}

function parseCountAnswer(answer: string | null | undefined): number {
  if (!answer) return 0

  const parsed = Number.parseInt(answer, 10)
  if (Number.isNaN(parsed)) return 0
  return Math.max(0, parsed)
}

function filterRosterMemberSuggestions(input: string, candidates: string[]): string[] {
  const normalizedInput = input.trim().toLowerCase()
  if (!normalizedInput) return []

  const deduped: string[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue

    const normalizedCandidate = trimmed.toLowerCase()
    if (!normalizedCandidate.includes(normalizedInput)) continue
    if (seen.has(normalizedCandidate)) continue

    seen.add(normalizedCandidate)
    deduped.push(trimmed)

    if (deduped.length >= 8) {
      break
    }
  }

  return deduped
}

function getQuestionValueType(question: { valueType?: "string" | "numerical" | "time" | "rosterMember"; isTimeBased?: boolean; isCountBased?: boolean }): "string" | "numerical" | "time" | "rosterMember" {
  if (question.valueType === "numerical" || question.valueType === "time" || question.valueType === "rosterMember") {
    return question.valueType
  }
  if (question.isTimeBased) return "time"
  if (question.isCountBased) return "numerical"
  return "string"
}

function getMatchParticipants(match: Match): string[] {
  return match.participants
}

function findMatchResult(payload: CardLiveKeyPayload, matchId: string): LiveKeyMatchResult | undefined {
  return payload.matchResults.find((result) => result.matchId === matchId)
}

function findAnswer(answers: LiveKeyAnswer[], questionId: string): LiveKeyAnswer | undefined {
  return answers.find((answer) => answer.questionId === questionId)
}

function toMatchTimerId(matchId: string): string {
  return `${MATCH_TIMER_PREFIX}${matchId}`
}

function toMatchBonusTimerId(matchId: string, questionId: string): string {
  return `${MATCH_BONUS_TIMER_PREFIX}${matchId}:${questionId}`
}

function toEventBonusTimerId(questionId: string): string {
  return `${EVENT_BONUS_TIMER_PREFIX}${questionId}`
}

function isMatchTimerId(timerId: string): boolean {
  return timerId.startsWith(MATCH_TIMER_PREFIX)
}

function isMatchBonusTimerId(timerId: string): boolean {
  return timerId.startsWith(MATCH_BONUS_TIMER_PREFIX)
}

function isEventBonusTimerId(timerId: string): boolean {
  return timerId.startsWith(EVENT_BONUS_TIMER_PREFIX)
}

function isSystemTimerId(timerId: string): boolean {
  return isMatchTimerId(timerId) || isMatchBonusTimerId(timerId) || isEventBonusTimerId(timerId)
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function getTimerElapsedMs(timer: LiveKeyTimer, currentMs: number): number {
  if (!timer.isRunning || !timer.startedAt) {
    return timer.elapsedMs
  }

  const startedAtMs = new Date(timer.startedAt).getTime()
  if (!Number.isFinite(startedAtMs)) {
    return timer.elapsedMs
  }

  return timer.elapsedMs + Math.max(0, currentMs - startedAtMs)
}

function buildMatchTimerLabel(match: Match, index: number): string {
  const title = match.title.trim() || `Match ${index + 1}`
  return `Match ${index + 1}: ${title}`
}

function buildMatchBonusTimerLabel(match: Match, matchIndex: number, questionText: string): string {
  const title = match.title.trim() || `Match ${matchIndex + 1}`
  const suffix = questionText.trim() || "Bonus"
  return `Match ${matchIndex + 1} Bonus: ${title} - ${suffix}`
}

function buildEventBonusTimerLabel(questionText: string, questionIndex: number): string {
  const suffix = questionText.trim() || `Question ${questionIndex + 1}`
  return `Event Bonus Timer: ${suffix}`
}

function createTimer(id: string, label: string): LiveKeyTimer {
  return {
    id,
    label,
    elapsedMs: 0,
    isRunning: false,
    startedAt: null,
  }
}

function createCustomTimer(label: string): LiveKeyTimer {
  return createTimer(`${CUSTOM_TIMER_PREFIX}${crypto.randomUUID()}`, label)
}

function ensureSystemTimers(
  payload: CardLiveKeyPayload,
  matches: Match[],
  eventBonusQuestions: PickEmSheet["eventBonusQuestions"],
): CardLiveKeyPayload {
  const timersById = new Map(payload.timers.map((timer) => [timer.id, timer]))
  const systemTimers: LiveKeyTimer[] = []

  matches.forEach((match, index) => {
    const timerId = toMatchTimerId(match.id)
    const existing = timersById.get(timerId)
    const label = buildMatchTimerLabel(match, index)

    systemTimers.push(existing ? { ...existing, label } : createTimer(timerId, label))

    match.bonusQuestions.forEach((question) => {
      if (getQuestionValueType(question) !== "time") return

      const bonusTimerId = toMatchBonusTimerId(match.id, question.id)
      const bonusLabel = buildMatchBonusTimerLabel(match, index, question.question)
      const existingBonus = timersById.get(bonusTimerId)
      systemTimers.push(existingBonus ? { ...existingBonus, label: bonusLabel } : createTimer(bonusTimerId, bonusLabel))
    })
  })

  eventBonusQuestions.forEach((question, index) => {
    if (getQuestionValueType(question) !== "time") return

    const timerId = toEventBonusTimerId(question.id)
    const label = buildEventBonusTimerLabel(question.question, index)
    const existing = timersById.get(timerId)
    systemTimers.push(existing ? { ...existing, label } : createTimer(timerId, label))
  })

  const customTimers = payload.timers.filter((timer) => !isSystemTimerId(timer.id))

  return {
    ...payload,
    timers: [...systemTimers, ...customTimers],
  }
}

function clearTimerReferences(payload: CardLiveKeyPayload, timerId: string): CardLiveKeyPayload {
  return {
    ...payload,
    matchResults: payload.matchResults.map((result) => ({
      ...result,
      bonusAnswers: result.bonusAnswers.map((answer) =>
        answer.timerId === timerId
          ? { ...answer, timerId: null }
          : answer,
      ),
    })),
    eventBonusAnswers: payload.eventBonusAnswers.map((answer) =>
      answer.timerId === timerId
        ? { ...answer, timerId: null }
        : answer,
    ),
    tiebreakerTimerId: payload.tiebreakerTimerId === timerId ? null : payload.tiebreakerTimerId,
  }
}

export function LiveKeyApp({ cardId }: LiveKeyAppProps) {
  const { userId, isLoaded: isAuthLoaded } = useAuth()
  const storageKey = useMemo(() => getStorageKey(cardId, userId), [cardId, userId])

  const [card, setCard] = useState<ResolvedCard | null>(null)
  const [payload, setPayload] = useState<CardLiveKeyPayload>(EMPTY_PAYLOAD)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(() => nowMs())
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine))
  const [isDirty, setIsDirty] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [hasInitialized, setHasInitialized] = useState(false)
  const [usingEditorDraft, setUsingEditorDraft] = useState(false)
  const [querySuggestions, setQuerySuggestions] = useState<string[]>([])
  const [isLoadingQuerySuggestions, setIsLoadingQuerySuggestions] = useState(false)
  const [activeRosterFieldKey, setActiveRosterFieldKey] = useState<string | null>(null)
  const [activeRosterQuery, setActiveRosterQuery] = useState("")
  const [battleRoyalEntryInputByMatchId, setBattleRoyalEntryInputByMatchId] = useState<Record<string, string>>({})

  const suppressDirtyRef = useRef(false)
  const lastSyncedSnapshotRef = useRef<string>(snapshotPayload(EMPTY_PAYLOAD))
  const payloadRef = useRef<CardLiveKeyPayload>(EMPTY_PAYLOAD)
  const isSyncingRef = useRef(false)
  const pendingAutoSyncRef = useRef(false)

  const applySystemPayload = useCallback((nextPayload: CardLiveKeyPayload, options?: { dirty?: boolean; lastSyncedAt?: string | null }) => {
    suppressDirtyRef.current = true
    setPayload(nextPayload)
    if (options?.dirty !== undefined) {
      setIsDirty(options.dirty)
      if (options.dirty === false) {
        lastSyncedSnapshotRef.current = snapshotPayload(nextPayload)
      }
    }
    if (options?.lastSyncedAt !== undefined) {
      setLastSyncedAt(options.lastSyncedAt)
    }
  }, [])

  useEffect(() => {
    function onOnline() {
      setIsOnline(true)
    }

    function onOffline() {
      setIsOnline(false)
    }

    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)

    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [])

  const loadData = useCallback(async () => {
    setIsLoading(true)

    const localRecord = readLocalRecord(storageKey)
    const editorDraftRecord = readEditorDraft(cardId)
    const activeEditorDraft = editorDraftRecord?.isDirty ? editorDraftRecord.sheet : null
    setUsingEditorDraft(Boolean(activeEditorDraft))

    const localCard = applyEditorDraftToCard(localRecord?.cardSnapshot ?? null, activeEditorDraft)

    if (localRecord) {
      applySystemPayload(localRecord.payload, {
        dirty: localRecord.dirty,
        lastSyncedAt: localRecord.lastSyncedAt,
      })
      setCard(localCard)
    } else {
      applySystemPayload({ ...EMPTY_PAYLOAD }, { dirty: false, lastSyncedAt: null })
      setCard(null)
    }

    let loadedCard: ResolvedCard | null = null

    try {
      loadedCard = applyEditorDraftToCard(await getCard(cardId), activeEditorDraft)
      setCard(loadedCard)
    } catch (error) {
      if (!localCard) {
        const message = error instanceof Error ? error.message : "Failed to load card"
        toast.error(message)
      }
    }

    let liveState:
      | Awaited<ReturnType<typeof getLiveKeyState>>
      | null = null

    if (userId) {
      try {
        liveState = await getLiveKeyState(cardId)
      } catch {
        liveState = null
      }
    }

    const cardForTimers = loadedCard ?? localCard ?? null

    if (liveState) {
      if (!localRecord?.dirty) {
        const nextPayload = ensureSystemTimers(
          normalizePayload(liveState.key.payload),
          cardForTimers?.matches ?? [],
          cardForTimers?.eventBonusQuestions ?? [],
        )
        applySystemPayload(nextPayload, {
          dirty: false,
          lastSyncedAt: liveState.key.updatedAt,
        })
      } else {
        applySystemPayload(
          ensureSystemTimers(
            normalizePayload(localRecord.payload),
            cardForTimers?.matches ?? [],
            cardForTimers?.eventBonusQuestions ?? [],
          ),
          {
            dirty: true,
            lastSyncedAt: localRecord.lastSyncedAt,
          },
        )
      }
    } else {
      const sourcePayload = localRecord?.payload ?? EMPTY_PAYLOAD
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
      )
    }

    setSyncError(null)
    setIsLoading(false)
    setHasInitialized(true)
  }, [applySystemPayload, cardId, storageKey, userId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!card) return

    applySystemPayload(ensureSystemTimers(payload, card.matches, card.eventBonusQuestions))
  }, [card, applySystemPayload])

  useEffect(() => {
    const promotionName = card?.promotionName?.trim() ?? ""
    const query = activeRosterQuery.trim()
    if (!promotionName || query.length < 2) {
      setQuerySuggestions([])
      setIsLoadingQuerySuggestions(false)
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      setIsLoadingQuerySuggestions(true)
      void getRosterSuggestions(promotionName, query)
        .then((response) => {
          if (cancelled) return
          setQuerySuggestions(response.names)
        })
        .catch(() => {
          if (cancelled) return
          setQuerySuggestions([])
        })
        .finally(() => {
          if (cancelled) return
          setIsLoadingQuerySuggestions(false)
        })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [activeRosterQuery, card?.promotionName])

  function setActiveRosterInput(fieldKey: string, value: string) {
    setActiveRosterFieldKey(fieldKey)
    setActiveRosterQuery(value)
  }

  const hasRunningTimers = useMemo(
    () => payload.timers.some((timer) => timer.isRunning),
    [payload.timers],
  )

  useEffect(() => {
    if (!hasRunningTimers) return

    const intervalId = window.setInterval(() => {
      setCurrentTimeMs(nowMs())
    }, 300)

    return () => window.clearInterval(intervalId)
  }, [hasRunningTimers])

  useEffect(() => {
    if (!hasInitialized) return

    if (suppressDirtyRef.current) {
      suppressDirtyRef.current = false
      return
    }

    if (snapshotPayload(payload) === lastSyncedSnapshotRef.current) {
      setIsDirty(false)
      return
    }

    setIsDirty(true)
    setSyncError(null)
  }, [hasInitialized, payload])

  useEffect(() => {
    payloadRef.current = payload
  }, [payload])

  useEffect(() => {
    if (!hasInitialized) return

    writeLocalRecord(storageKey, {
      payload,
      cardSnapshot: card,
      dirty: isDirty,
      lastSyncedAt,
      updatedAt: nowIso(),
    })
  }, [hasInitialized, storageKey, payload, card, isDirty, lastSyncedAt])

  const canSyncToServer = Boolean(userId && isOnline && card)

  const syncPayloadToServer = useCallback(async (mode: "manual" | "auto") => {
    if (!card || !userId || !isOnline) {
      return false
    }

    if (mode === "auto" && isSyncingRef.current) {
      pendingAutoSyncRef.current = true
      return false
    }

    if (mode === "manual") {
      setIsSaving(true)
    }

    const payloadToSync = ensureSystemTimers(payloadRef.current, card.matches, card.eventBonusQuestions)
    const payloadSnapshot = snapshotPayload(payloadToSync)
    isSyncingRef.current = true

    try {
      const saved = await saveLiveKey(cardId, payloadToSync)
      lastSyncedSnapshotRef.current = payloadSnapshot
      setLastSyncedAt(saved.updatedAt)
      setSyncError(null)
      if (snapshotPayload(payloadRef.current) === payloadSnapshot) {
        setIsDirty(false)
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync live key"
      setSyncError(message)
      return false
    } finally {
      isSyncingRef.current = false
      if (mode === "manual") {
        setIsSaving(false)
      }
      if (pendingAutoSyncRef.current) {
        pendingAutoSyncRef.current = false
        void syncPayloadToServer("auto")
      }
    }
  }, [card, cardId, isOnline, userId])

  useEffect(() => {
    if (!hasInitialized || !isDirty || !canSyncToServer) return

    const timeoutId = window.setTimeout(() => {
      void syncPayloadToServer("auto")
    }, 900)

    return () => window.clearTimeout(timeoutId)
  }, [canSyncToServer, hasInitialized, isDirty, payload, syncPayloadToServer])

  const timersById = useMemo(
    () => new Map(payload.timers.map((timer) => [timer.id, timer])),
    [payload.timers],
  )

  const customTimers = useMemo(
    () => payload.timers.filter((timer) => timer.id.startsWith(CUSTOM_TIMER_PREFIX)),
    [payload.timers],
  )

  const timerOptions = useMemo(
    () => payload.timers.map((timer) => ({ id: timer.id, label: timer.label })),
    [payload.timers],
  )
  const eventParticipantCandidates = useMemo(
    () => Array.from(new Set((card?.matches ?? []).flatMap((match) => match.participants))),
    [card?.matches],
  )

  const findAlternateTimerId = useCallback((excludedTimerId: string) => {
    const alternate = payload.timers.find((timer) => timer.id !== excludedTimerId)
    return alternate?.id ?? null
  }, [payload.timers])

  const updateTimer = useCallback((timerId: string, updater: (timer: LiveKeyTimer) => LiveKeyTimer) => {
    setPayload((prev) => {
      const timerIndex = prev.timers.findIndex((timer) => timer.id === timerId)
      if (timerIndex === -1) return prev

      const nextTimers = [...prev.timers]
      nextTimers[timerIndex] = updater(nextTimers[timerIndex])

      return {
        ...prev,
        timers: nextTimers,
      }
    })
  }, [])

  const startTimer = useCallback((timerId: string) => {
    updateTimer(timerId, (timer) => {
      if (timer.isRunning) return timer

      return {
        ...timer,
        isRunning: true,
        startedAt: nowIso(),
      }
    })
  }, [updateTimer])

  const stopTimer = useCallback((timerId: string) => {
    updateTimer(timerId, (timer) => {
      if (!timer.isRunning) return timer

      const elapsedMs = getTimerElapsedMs(timer, nowMs())

      return {
        ...timer,
        elapsedMs,
        isRunning: false,
        startedAt: null,
      }
    })
    setCurrentTimeMs(nowMs())
  }, [updateTimer])

  const resetTimer = useCallback((timerId: string) => {
    updateTimer(timerId, (timer) => ({
      ...timer,
      elapsedMs: 0,
      isRunning: false,
      startedAt: null,
    }))
    setCurrentTimeMs(nowMs())
  }, [updateTimer])

  function addCustomTimer() {
    setPayload((prev) => ({
      ...prev,
      timers: [...prev.timers, createCustomTimer(`Custom Timer ${customTimers.length + 1}`)],
    }))
  }

  function removeCustomTimer(timerId: string) {
    setPayload((prev) => {
      const next = {
        ...prev,
        timers: prev.timers.filter((timer) => timer.id !== timerId),
      }

      return clearTimerReferences(next, timerId)
    })
  }

  function setTimerLabel(timerId: string, label: string) {
    updateTimer(timerId, (timer) => ({
      ...timer,
      label,
    }))
  }

  const setMatchWinner = useCallback((matchId: string, winnerName: string) => {
    setPayload((prev) => {
      const nextResults = [...prev.matchResults]
      const existingIndex = nextResults.findIndex((result) => result.matchId === matchId)

      if (existingIndex === -1) {
        nextResults.push({
          matchId,
          winnerName,
          winnerRecordedAt: winnerName.trim() ? nowIso() : null,
          battleRoyalEntryOrder: [],
          bonusAnswers: [],
        })
      } else {
        const existing = nextResults[existingIndex]
        nextResults[existingIndex] = {
          ...existing,
          winnerName,
          winnerRecordedAt: winnerName.trim() ? nowIso() : null,
        }
      }

      return {
        ...prev,
        matchResults: nextResults,
      }
    })
  }, [])

  const setBattleRoyalEntryOrder = useCallback((matchId: string, entryOrder: string[]) => {
    setPayload((prev) => {
      const nextResults = [...prev.matchResults]
      const existingIndex = nextResults.findIndex((result) => result.matchId === matchId)

      if (existingIndex === -1) {
        nextResults.push({
          matchId,
          winnerName: "",
          winnerRecordedAt: null,
          battleRoyalEntryOrder: entryOrder,
          bonusAnswers: [],
        })
      } else {
        const existing = nextResults[existingIndex]
        nextResults[existingIndex] = {
          ...existing,
          battleRoyalEntryOrder: entryOrder,
        }
      }

      return {
        ...prev,
        matchResults: nextResults,
      }
    })
  }, [])

  const addBattleRoyalEntrant = useCallback((matchId: string, entrantName: string) => {
    const entrant = entrantName.trim()
    if (!entrant) return

    const existingEntries = findMatchResult(payload, matchId)?.battleRoyalEntryOrder ?? []
    const duplicate = existingEntries.some((entry) => entry.toLowerCase() === entrant.toLowerCase())
    if (duplicate) {
      setBattleRoyalEntryInputByMatchId((prev) => ({ ...prev, [matchId]: "" }))
      return
    }

    setBattleRoyalEntryOrder(matchId, [...existingEntries, entrant])
    setBattleRoyalEntryInputByMatchId((prev) => ({ ...prev, [matchId]: "" }))
    setActiveRosterFieldKey(`battleRoyal:${matchId}`)
    setActiveRosterQuery("")
  }, [payload, setBattleRoyalEntryOrder])

  const removeBattleRoyalEntrant = useCallback((matchId: string, entryIndex: number) => {
    const existingEntries = findMatchResult(payload, matchId)?.battleRoyalEntryOrder ?? []
    setBattleRoyalEntryOrder(matchId, existingEntries.filter((_, index) => index !== entryIndex))
  }, [payload, setBattleRoyalEntryOrder])

  const setMatchBonusAnswer = useCallback((matchId: string, questionId: string, answer: string, isTimeBased: boolean) => {
    setPayload((prev) => {
      const nextResults = [...prev.matchResults]
      let existingIndex = nextResults.findIndex((result) => result.matchId === matchId)

      if (existingIndex === -1) {
        nextResults.push({
          matchId,
          winnerName: "",
          winnerRecordedAt: null,
          battleRoyalEntryOrder: [],
          bonusAnswers: [],
        })
        existingIndex = nextResults.length - 1
      }

      const existingResult = nextResults[existingIndex]
      const nextAnswers = [...existingResult.bonusAnswers]
      const existingAnswerIndex = nextAnswers.findIndex((item) => item.questionId === questionId)
      const existingAnswer = existingAnswerIndex === -1 ? undefined : nextAnswers[existingAnswerIndex]
      const recordedAt = isTimeBased && answer.trim() ? nowIso() : null
      const timerId = isTimeBased
        ? (existingAnswer?.timerId ?? toMatchBonusTimerId(matchId, questionId))
        : null

      if (existingAnswerIndex === -1) {
        nextAnswers.push({
          questionId,
          answer,
          recordedAt,
          timerId,
        })
      } else {
        nextAnswers[existingAnswerIndex] = {
          questionId,
          answer,
          recordedAt,
          timerId,
        }
      }

      nextResults[existingIndex] = {
        ...existingResult,
        bonusAnswers: nextAnswers,
      }

      return {
        ...prev,
        matchResults: nextResults,
      }
    })
  }, [])

  const setMatchBonusTimer = useCallback((matchId: string, questionId: string, timerId: string | null) => {
    setPayload((prev) => {
      const nextResults = [...prev.matchResults]
      let resultIndex = nextResults.findIndex((result) => result.matchId === matchId)

      if (resultIndex === -1) {
        nextResults.push({
          matchId,
          winnerName: "",
          winnerRecordedAt: null,
          battleRoyalEntryOrder: [],
          bonusAnswers: [],
        })
        resultIndex = nextResults.length - 1
      }

      const nextAnswers = [...nextResults[resultIndex].bonusAnswers]
      const answerIndex = nextAnswers.findIndex((answer) => answer.questionId === questionId)

      if (answerIndex === -1) {
        nextAnswers.push({
          questionId,
          answer: "",
          recordedAt: null,
          timerId,
        })
      } else {
        nextAnswers[answerIndex] = {
          ...nextAnswers[answerIndex],
          timerId,
        }
      }

      nextResults[resultIndex] = {
        ...nextResults[resultIndex],
        bonusAnswers: nextAnswers,
      }

      return {
        ...prev,
        matchResults: nextResults,
      }
    })
  }, [])

  const setEventBonusAnswer = useCallback((questionId: string, answer: string, isTimeBased: boolean) => {
    setPayload((prev) => {
      const nextAnswers = [...prev.eventBonusAnswers]
      const existingIndex = nextAnswers.findIndex((item) => item.questionId === questionId)
      const existingAnswer = existingIndex === -1 ? undefined : nextAnswers[existingIndex]
      const recordedAt = isTimeBased && answer.trim() ? nowIso() : null
      const timerId = isTimeBased ? (existingAnswer?.timerId ?? toEventBonusTimerId(questionId)) : null

      if (existingIndex === -1) {
        nextAnswers.push({
          questionId,
          answer,
          recordedAt,
          timerId,
        })
      } else {
        nextAnswers[existingIndex] = {
          questionId,
          answer,
          recordedAt,
          timerId,
        }
      }

      return {
        ...prev,
        eventBonusAnswers: nextAnswers,
      }
    })
  }, [])

  const incrementMatchBonusCount = useCallback((matchId: string, questionId: string, isTimeBased: boolean) => {
    const matchResult = findMatchResult(payload, matchId)
    const existingAnswer = findAnswer(matchResult?.bonusAnswers ?? [], questionId)
    const nextValue = String(parseCountAnswer(existingAnswer?.answer) + 1)
    setMatchBonusAnswer(matchId, questionId, nextValue, isTimeBased)
  }, [payload, setMatchBonusAnswer])

  const decrementMatchBonusCount = useCallback((matchId: string, questionId: string, isTimeBased: boolean) => {
    const matchResult = findMatchResult(payload, matchId)
    const existingAnswer = findAnswer(matchResult?.bonusAnswers ?? [], questionId)
    const nextValue = String(Math.max(0, parseCountAnswer(existingAnswer?.answer) - 1))
    setMatchBonusAnswer(matchId, questionId, nextValue, isTimeBased)
  }, [payload, setMatchBonusAnswer])

  const incrementEventBonusCount = useCallback((questionId: string, isTimeBased: boolean) => {
    const existingAnswer = findAnswer(payload.eventBonusAnswers, questionId)
    const nextValue = String(parseCountAnswer(existingAnswer?.answer) + 1)
    setEventBonusAnswer(questionId, nextValue, isTimeBased)
  }, [payload.eventBonusAnswers, setEventBonusAnswer])

  const decrementEventBonusCount = useCallback((questionId: string, isTimeBased: boolean) => {
    const existingAnswer = findAnswer(payload.eventBonusAnswers, questionId)
    const nextValue = String(Math.max(0, parseCountAnswer(existingAnswer?.answer) - 1))
    setEventBonusAnswer(questionId, nextValue, isTimeBased)
  }, [payload.eventBonusAnswers, setEventBonusAnswer])

  const setEventBonusTimer = useCallback((questionId: string, timerId: string | null) => {
    setPayload((prev) => {
      const nextAnswers = [...prev.eventBonusAnswers]
      const existingIndex = nextAnswers.findIndex((item) => item.questionId === questionId)

      if (existingIndex === -1) {
        nextAnswers.push({
          questionId,
          answer: "",
          recordedAt: null,
          timerId,
        })
      } else {
        nextAnswers[existingIndex] = {
          ...nextAnswers[existingIndex],
          timerId,
        }
      }

      return {
        ...prev,
        eventBonusAnswers: nextAnswers,
      }
    })
  }, [])

  function setTiebreakerAnswer(answer: string) {
    setPayload((prev) => ({
      ...prev,
      tiebreakerAnswer: answer,
      tiebreakerRecordedAt: card?.tiebreakerIsTimeBased && answer.trim() ? nowIso() : null,
    }))
  }

  function setTiebreakerTimerId(timerId: string | null) {
    setPayload((prev) => ({
      ...prev,
      tiebreakerTimerId: timerId,
    }))
  }

  function applyTimerValueToMatchBonus(matchId: string, questionId: string) {
    const matchResult = findMatchResult(payload, matchId)
    const answer = findAnswer(matchResult?.bonusAnswers ?? [], questionId)
    const timerId = answer?.timerId ?? toMatchBonusTimerId(matchId, questionId)
    const timer = timerId ? timersById.get(timerId) : undefined

    if (!timer || !timerId) {
      toast.error("Select a timer first")
      return
    }

    const timerValue = formatDuration(getTimerElapsedMs(timer, currentTimeMs))
    setMatchBonusTimer(matchId, questionId, timerId)
    setMatchBonusAnswer(matchId, questionId, timerValue, true)
  }

  function applySpecificTimerValueToMatchBonus(matchId: string, questionId: string, timerId: string) {
    const timer = timersById.get(timerId)
    if (!timer) {
      toast.error("Timer not available")
      return
    }

    const timerValue = formatDuration(getTimerElapsedMs(timer, currentTimeMs))
    setMatchBonusTimer(matchId, questionId, timerId)
    setMatchBonusAnswer(matchId, questionId, timerValue, true)
  }

  function applyTimerValueToEventBonus(questionId: string) {
    const answer = findAnswer(payload.eventBonusAnswers, questionId)
    const timerId = answer?.timerId ?? toEventBonusTimerId(questionId)
    const timer = timerId ? timersById.get(timerId) : undefined

    if (!timer || !timerId) {
      toast.error("Select a timer first")
      return
    }

    const timerValue = formatDuration(getTimerElapsedMs(timer, currentTimeMs))
    setEventBonusTimer(questionId, timerId)
    setEventBonusAnswer(questionId, timerValue, true)
  }

  function applySpecificTimerValueToEventBonus(questionId: string, timerId: string) {
    const timer = timersById.get(timerId)
    if (!timer) {
      toast.error("Timer not available")
      return
    }

    const timerValue = formatDuration(getTimerElapsedMs(timer, currentTimeMs))
    setEventBonusTimer(questionId, timerId)
    setEventBonusAnswer(questionId, timerValue, true)
  }

  function applyTimerValueToTiebreaker() {
    const timerId = payload.tiebreakerTimerId
    const timer = timerId ? timersById.get(timerId) : undefined

    if (!timer || !timerId) {
      toast.error("Select a timer first")
      return
    }

    const timerValue = formatDuration(getTimerElapsedMs(timer, currentTimeMs))
    setTiebreakerAnswer(timerValue)
  }

  async function handleSave() {
    if (canSyncToServer) {
      while (isSyncingRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 50))
      }
      const ok = await syncPayloadToServer("manual")
      if (ok) {
        toast.success("Live key saved")
      } else {
        toast.error("Could not sync. Changes are still stored locally.")
      }
      return
    }

    toast.success(userId ? "Saved locally (offline)." : "Saved locally (not signed in).")
  }

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      await loadData()
    } finally {
      setIsRefreshing(false)
    }
  }

  const hasEventBonusQuestions = useMemo(() => (card?.eventBonusQuestions?.length ?? 0) > 0, [card])

  const syncStatus = useMemo(() => {
    if (!userId) {
      return "Local-only mode (not signed in)."
    }

    if (!isOnline) {
      return "Offline: changes are saved locally and will sync when online."
    }

    if (syncError) {
      return `Sync failed: ${syncError}`
    }

    if (isDirty) {
      return "Unsynced cloud changes (saved locally)."
    }

    if (lastSyncedAt) {
      return `Synced ${formatTimestamp(lastSyncedAt)}`
    }

    return "Cloud sync ready."
  }, [isDirty, isOnline, lastSyncedAt, syncError, userId])

  if (!isAuthLoaded) {
    return (
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 text-sm text-muted-foreground">
        Loading authentication...
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 text-sm text-muted-foreground">
        Loading live key...
      </div>
    )
  }

  if (!card) {
    return (
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-semibold">Live Key Tracking</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No card data is available. Open this card once online to cache it for offline use.
        </p>
        <Button asChild className="mt-4">
          <Link href="/">Back to Home</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(230,170,60,0.20),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(130,160,255,0.12),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_35%)]" />

      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button asChild size="sm" variant="outline">
              <Link href={`/cards/${cardId}`}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Editor
              </Link>
            </Button>
            <div>
              <h1 className="font-[family-name:var(--font-heading)] text-xl font-bold uppercase tracking-wider text-foreground">
                Live Key Tracking
              </h1>
              <p className="text-xs text-muted-foreground">{card.eventName || "Untitled Event"}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void handleRefresh()} disabled={isRefreshing}>
              <RefreshCcw className="mr-1 h-4 w-4" />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={isSaving}>
              <Save className="mr-1 h-4 w-4" />
              {isSaving ? "Saving..." : "Save Key"}
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <section className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{syncStatus}</p>
        {usingEditorDraft ? (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Showing unsaved sheet editor draft changes from this browser.
          </p>
        ) : null}
      </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-foreground">Custom Timers</h2>
            <Button variant="secondary" size="sm" onClick={addCustomTimer}>
              <Plus className="mr-1 h-4 w-4" />
              Add Timer
            </Button>
          </div>

          {customTimers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No custom timers yet.</p>
          ) : (
            <div className="space-y-2">
              {customTimers.map((timer) => {
                const elapsedMs = getTimerElapsedMs(timer, currentTimeMs)

                return (
                  <div key={timer.id} className="rounded-md border border-border/70 bg-background/35 p-3">
                    <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
                      <div className="space-y-1.5">
                        <Label>Timer Label</Label>
                        <Input value={timer.label} onChange={(event) => setTimerLabel(timer.id, event.target.value)} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <span className="rounded-md border border-border px-2 py-1 font-mono text-sm">{formatDuration(elapsedMs)}</span>
                        <Button size="sm" variant="secondary" onClick={() => (timer.isRunning ? stopTimer(timer.id) : startTimer(timer.id))}>
                          {timer.isRunning ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
                          {timer.isRunning ? "Stop" : "Start"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => resetTimer(timer.id)}>
                          <RotateCcw className="h-4 w-4" />
                          <span className="sr-only">Reset timer</span>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => removeCustomTimer(timer.id)}>
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Remove timer</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {card.matches.map((match, index) => {
          const participants = getMatchParticipants(match)
          const matchResult = findMatchResult(payload, match.id)
          const winnerName = matchResult?.winnerName ?? ""
          const winnerInList = participants.some((name) => name === winnerName)
          const winnerSelectValue = winnerName
            ? winnerInList
              ? winnerName
              : "__custom__"
            : "__none__"

          const matchTimerId = toMatchTimerId(match.id)
          const matchTimer = timersById.get(matchTimerId)
          const matchTimerElapsed = matchTimer ? formatDuration(getTimerElapsedMs(matchTimer, currentTimeMs)) : "--:--"
          const battleRoyalEntryOrder = matchResult?.battleRoyalEntryOrder ?? []
          const battleRoyalEntryInput = battleRoyalEntryInputByMatchId[match.id] ?? ""
          const battleRoyalFieldKey = `battleRoyal:${match.id}`
          const normalizedBattleRoyalEntryInput = battleRoyalEntryInput.trim().toLowerCase()
          const battleRoyalSuggestions = activeRosterFieldKey === battleRoyalFieldKey ? querySuggestions : []
          const battleRoyalCandidates = match.isBattleRoyal
            ? Array.from(new Set([...match.participants, ...battleRoyalSuggestions]))
            : []
          const filteredBattleRoyalSuggestions = normalizedBattleRoyalEntryInput
            ? battleRoyalCandidates
              .filter((candidate) => candidate.toLowerCase().includes(normalizedBattleRoyalEntryInput))
              .filter(
                (candidate) =>
                  !battleRoyalEntryOrder.some((entry) => entry.toLowerCase() === candidate.toLowerCase()),
              )
              .slice(0, 8)
            : []

          return (
            <section key={match.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-foreground">
                  Match {index + 1}: {match.title || "Untitled Match"}
                </h2>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="rounded-md border border-border/70 bg-background/35 p-3">
                  <div className={winnerSelectValue === "__custom__" ? "grid gap-2 sm:grid-cols-[1fr_1fr]" : "grid gap-2"}>
                    <div className="space-y-1.5">
                      <Label>Winner</Label>
                      <Select
                        value={winnerSelectValue}
                        onValueChange={(value) => {
                          if (value === "__none__") {
                            setMatchWinner(match.id, "")
                            return
                          }

                          if (value === "__custom__") {
                            const current = winnerName && !winnerInList ? winnerName : ""
                            setMatchWinner(match.id, current)
                            return
                          }

                          setMatchWinner(match.id, value)
                        }}
                      >
                        <SelectTrigger className="h-11 w-full">
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
                    </div>

                    {winnerSelectValue === "__custom__" ? (
                      <div className="space-y-1.5">
                        <Label>Custom winner</Label>
                        <Input
                          placeholder="Type winner name"
                          value={winnerName}
                          onChange={(event) => setMatchWinner(match.id, event.target.value)}
                        />
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Winner recorded: {formatTimestamp(matchResult?.winnerRecordedAt ?? null)}
                  </p>
                </div>

                <div className="rounded-md border border-border/70 bg-background/35 p-3">
                  <p className="text-xs text-muted-foreground">Match Timer</p>
                  <p className="font-mono text-2xl text-foreground">{matchTimerElapsed}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      onClick={() => {
                        if (!matchTimer) return
                        if (matchTimer.isRunning) {
                          stopTimer(matchTimer.id)
                        } else {
                          startTimer(matchTimer.id)
                        }
                      }}
                      disabled={!matchTimer}
                    >
                      {matchTimer?.isRunning ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
                      {matchTimer?.isRunning ? "Stop" : "Start"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => matchTimer && resetTimer(matchTimer.id)}
                      disabled={!matchTimer}
                    >
                      <RotateCcw className="mr-1 h-4 w-4" />
                      Reset
                    </Button>
                  </div>
                </div>
              </div>

              {match.isBattleRoyal ? (
                <div className="mt-3 space-y-2">
                  <Label>Entry Order</Label>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <Input
                      placeholder="Add entrant"
                      value={battleRoyalEntryInput}
                      onChange={(event) => {
                        setBattleRoyalEntryInputByMatchId((prev) => ({ ...prev, [match.id]: event.target.value }))
                        setActiveRosterInput(battleRoyalFieldKey, event.target.value)
                      }}
                      onFocus={() => setActiveRosterInput(battleRoyalFieldKey, battleRoyalEntryInput)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return
                        event.preventDefault()
                        addBattleRoyalEntrant(match.id, battleRoyalEntryInput)
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => addBattleRoyalEntrant(match.id, battleRoyalEntryInput)}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Add Entrant
                    </Button>
                  </div>
                  {((activeRosterFieldKey === battleRoyalFieldKey && isLoadingQuerySuggestions) || filteredBattleRoyalSuggestions.length > 0) ? (
                    <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">
                        {activeRosterFieldKey === battleRoyalFieldKey && isLoadingQuerySuggestions ? "Loading roster suggestions..." : "Autocomplete from promotion roster"}
                      </p>
                      {filteredBattleRoyalSuggestions.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {filteredBattleRoyalSuggestions.map((candidate) => (
                            <button
                              key={candidate}
                              type="button"
                              onClick={() => addBattleRoyalEntrant(match.id, candidate)}
                              className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary"
                            >
                              {candidate}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {battleRoyalEntryOrder.length > 0 ? (
                    <div className="space-y-1.5 rounded-md border border-border/70 bg-background/35 p-2.5">
                      {battleRoyalEntryOrder.map((entrant, entrantIndex) => (
                        <div key={`${match.id}:${entrant}:${entrantIndex}`} className="flex items-center justify-between gap-2">
                          <span className="text-sm text-foreground">
                            {entrantIndex + 1}. {entrant}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removeBattleRoyalEntrant(match.id, entrantIndex)}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Remove entrant</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-xs text-muted-foreground">Entrants are recorded in the order you add them.</p>
                </div>
              ) : null}

              {match.bonusQuestions.length > 0 ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm font-medium text-foreground">Bonus Answers</p>
                  {match.bonusQuestions.map((question) => {
                    const questionValueType = getQuestionValueType(question)
                    const isTimeValueType = questionValueType === "time"
                    const isNumericalValueType = questionValueType === "numerical"
                    const isRosterMemberType = questionValueType === "rosterMember"
                    const rosterFieldKey = `matchBonus:${match.id}:${question.id}`
                    const rosterQuerySuggestions = activeRosterFieldKey === rosterFieldKey ? querySuggestions : []
                    const answer = findAnswer(matchResult?.bonusAnswers ?? [], question.id)
                    const bonusTimerId = toMatchBonusTimerId(match.id, question.id)
                    const bonusTimer = timersById.get(bonusTimerId)
                    const selectedTimerId = answer?.timerId ?? (isTimeValueType ? bonusTimerId : null)
                    const bonusTimerElapsed = bonusTimer ? formatDuration(getTimerElapsedMs(bonusTimer, currentTimeMs)) : "--:--"
                    const isUsingAlternateTimer = isTimeValueType && selectedTimerId !== bonusTimerId
                    const filteredRosterSuggestions = isRosterMemberType
                      ? filterRosterMemberSuggestions(
                        answer?.answer ?? "",
                        Array.from(new Set([...match.participants, ...rosterQuerySuggestions])),
                      )
                      : []

                    return (
                      <div key={question.id} className="rounded-md border border-border/70 bg-background/35 p-3">
                        <Label>{question.question || "Bonus question"}</Label>
                        {isNumericalValueType ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="rounded-md border border-border px-3 py-1.5 font-mono text-lg text-foreground">
                              {parseCountAnswer(answer?.answer)}
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => decrementMatchBonusCount(match.id, question.id, isTimeValueType)}
                            >
                              -
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => incrementMatchBonusCount(match.id, question.id, isTimeValueType)}
                            >
                              +
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setMatchBonusAnswer(match.id, question.id, "", isTimeValueType)}
                              disabled={(answer?.answer ?? "").trim().length === 0}
                            >
                              Clear
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Input
                              className="mt-2"
                              placeholder={
                                isRosterMemberType
                                  ? "Start typing a roster member..."
                                  : question.answerType === "multiple-choice"
                                    ? "Record the winning option"
                                    : "Record result"
                              }
                              value={answer?.answer ?? ""}
                              onChange={(event) => {
                                setMatchBonusAnswer(match.id, question.id, event.target.value, isTimeValueType)
                                setActiveRosterInput(rosterFieldKey, event.target.value)
                              }}
                              onFocus={() => setActiveRosterInput(rosterFieldKey, answer?.answer ?? "")}
                            />
                            {isRosterMemberType && ((activeRosterFieldKey === rosterFieldKey && isLoadingQuerySuggestions) || filteredRosterSuggestions.length > 0) ? (
                              <div className="mt-2 rounded-md border border-border/70 bg-background/35 px-3 py-2">
                                <p className="text-[11px] text-muted-foreground">
                                  {activeRosterFieldKey === rosterFieldKey && isLoadingQuerySuggestions ? "Loading roster suggestions..." : "Autocomplete from promotion roster"}
                                </p>
                                {filteredRosterSuggestions.length > 0 ? (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {filteredRosterSuggestions.map((candidate) => (
                                      <button
                                        key={`${question.id}:${candidate}`}
                                        type="button"
                                        onClick={() => setMatchBonusAnswer(match.id, question.id, candidate, isTimeValueType)}
                                        className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary"
                                      >
                                        {candidate}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        )}
                        {isTimeValueType ? (
                          <div className="mt-2 space-y-2">
                            {isUsingAlternateTimer ? (
                              <>
                                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                                  <Select
                                    value={selectedTimerId ?? "none"}
                                    onValueChange={(value) =>
                                      setMatchBonusTimer(match.id, question.id, value === "none" ? null : value)
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select timer" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">No timer</SelectItem>
                                      {timerOptions.map((timerOption) => (
                                        <SelectItem key={timerOption.id} value={timerOption.id}>
                                          {timerOption.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Button variant="secondary" onClick={() => applyTimerValueToMatchBonus(match.id, question.id)}>
                                    <Timer className="mr-1 h-4 w-4" />
                                    Use Selected Timer
                                  </Button>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => setMatchBonusTimer(match.id, question.id, bonusTimerId)}>
                                  Use Question Timer Instead
                                </Button>
                              </>
                            ) : (
                              <>
                                <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
                                  <p className="text-xs text-muted-foreground">Question Timer</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <span className="rounded-md border border-border px-2 py-1 font-mono text-sm">{bonusTimerElapsed}</span>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => {
                                        if (!bonusTimer) return
                                        if (bonusTimer.isRunning) {
                                          stopTimer(bonusTimer.id)
                                        } else {
                                          startTimer(bonusTimer.id)
                                        }
                                      }}
                                      disabled={!bonusTimer}
                                    >
                                      {bonusTimer?.isRunning ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
                                      {bonusTimer?.isRunning ? "Stop" : "Start"}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => bonusTimer && resetTimer(bonusTimer.id)} disabled={!bonusTimer}>
                                      <RotateCcw className="h-4 w-4" />
                                      <span className="sr-only">Reset bonus timer</span>
                                    </Button>
                                    <Button size="sm" variant="secondary" onClick={() => applySpecificTimerValueToMatchBonus(match.id, question.id, bonusTimerId)}>
                                      <Timer className="mr-1 h-4 w-4" />
                                      Use Question Timer
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        const alternateTimerId = findAlternateTimerId(bonusTimerId)
                                        if (!alternateTimerId) {
                                          toast.error("No alternate timers available")
                                          return
                                        }
                                        setMatchBonusTimer(match.id, question.id, alternateTimerId)
                                      }}
                                    >
                                      Use Different Timer
                                    </Button>
                                  </div>
                                </div>
                              </>
                            )}
                            <p className="text-xs text-muted-foreground">Recorded: {formatTimestamp(answer?.recordedAt ?? null)}</p>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </section>
          )
        })}

        {hasEventBonusQuestions ? (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-foreground">Event Bonus Answers</h2>
            <div className="mt-3 space-y-3">
              {card.eventBonusQuestions.map((question) => {
                const questionValueType = getQuestionValueType(question)
                const isTimeValueType = questionValueType === "time"
                const isNumericalValueType = questionValueType === "numerical"
                const isRosterMemberType = questionValueType === "rosterMember"
                const rosterFieldKey = `eventBonus:${question.id}`
                const rosterQuerySuggestions = activeRosterFieldKey === rosterFieldKey ? querySuggestions : []
                const answer = findAnswer(payload.eventBonusAnswers, question.id)
                const bonusTimerId = toEventBonusTimerId(question.id)
                const bonusTimer = timersById.get(bonusTimerId)
                const selectedTimerId = answer?.timerId ?? (isTimeValueType ? bonusTimerId : null)
                const bonusTimerElapsed = bonusTimer ? formatDuration(getTimerElapsedMs(bonusTimer, currentTimeMs)) : "--:--"
                const isUsingAlternateTimer = isTimeValueType && selectedTimerId !== bonusTimerId
                const filteredRosterSuggestions = isRosterMemberType
                  ? filterRosterMemberSuggestions(
                    answer?.answer ?? "",
                    Array.from(new Set([...eventParticipantCandidates, ...rosterQuerySuggestions])),
                  )
                  : []

                return (
                  <div key={question.id} className="rounded-md border border-border/70 bg-background/35 p-3">
                    <Label>{question.question || "Event bonus question"}</Label>
                    {isNumericalValueType ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-border px-3 py-1.5 font-mono text-lg text-foreground">
                          {parseCountAnswer(answer?.answer)}
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => decrementEventBonusCount(question.id, isTimeValueType)}
                        >
                          -
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => incrementEventBonusCount(question.id, isTimeValueType)}
                        >
                          +
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEventBonusAnswer(question.id, "", isTimeValueType)}
                          disabled={(answer?.answer ?? "").trim().length === 0}
                        >
                          Clear
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Input
                          className="mt-2"
                          placeholder={
                            isRosterMemberType
                              ? "Start typing a roster member..."
                              : question.answerType === "multiple-choice"
                                ? "Record the winning option"
                                : "Record result"
                          }
                          value={answer?.answer ?? ""}
                          onChange={(event) => {
                            setEventBonusAnswer(question.id, event.target.value, isTimeValueType)
                            setActiveRosterInput(rosterFieldKey, event.target.value)
                          }}
                          onFocus={() => setActiveRosterInput(rosterFieldKey, answer?.answer ?? "")}
                        />
                        {isRosterMemberType && ((activeRosterFieldKey === rosterFieldKey && isLoadingQuerySuggestions) || filteredRosterSuggestions.length > 0) ? (
                          <div className="mt-2 rounded-md border border-border/70 bg-background/35 px-3 py-2">
                            <p className="text-[11px] text-muted-foreground">
                              {activeRosterFieldKey === rosterFieldKey && isLoadingQuerySuggestions ? "Loading roster suggestions..." : "Autocomplete from promotion roster"}
                            </p>
                            {filteredRosterSuggestions.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {filteredRosterSuggestions.map((candidate) => (
                                  <button
                                    key={`${question.id}:${candidate}`}
                                    type="button"
                                    onClick={() => setEventBonusAnswer(question.id, candidate, isTimeValueType)}
                                    className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary"
                                  >
                                    {candidate}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    )}
                    {isTimeValueType ? (
                      <div className="mt-2 space-y-2">
                        {isUsingAlternateTimer ? (
                          <>
                            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                              <Select
                                value={selectedTimerId ?? "none"}
                                onValueChange={(value) => setEventBonusTimer(question.id, value === "none" ? null : value)}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select timer" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No timer</SelectItem>
                                  {timerOptions.map((timerOption) => (
                                    <SelectItem key={timerOption.id} value={timerOption.id}>
                                      {timerOption.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button variant="secondary" onClick={() => applyTimerValueToEventBonus(question.id)}>
                                <Timer className="mr-1 h-4 w-4" />
                                Use Selected Timer
                              </Button>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => setEventBonusTimer(question.id, bonusTimerId)}>
                              Use Question Timer Instead
                            </Button>
                          </>
                        ) : (
                          <>
                            <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
                              <p className="text-xs text-muted-foreground">Question Timer</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <span className="rounded-md border border-border px-2 py-1 font-mono text-sm">{bonusTimerElapsed}</span>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => {
                                    if (!bonusTimer) return
                                    if (bonusTimer.isRunning) {
                                      stopTimer(bonusTimer.id)
                                    } else {
                                      startTimer(bonusTimer.id)
                                    }
                                  }}
                                  disabled={!bonusTimer}
                                >
                                  {bonusTimer?.isRunning ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
                                  {bonusTimer?.isRunning ? "Stop" : "Start"}
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => bonusTimer && resetTimer(bonusTimer.id)} disabled={!bonusTimer}>
                                  <RotateCcw className="h-4 w-4" />
                                  <span className="sr-only">Reset event bonus timer</span>
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => applySpecificTimerValueToEventBonus(question.id, bonusTimerId)}>
                                  <Timer className="mr-1 h-4 w-4" />
                                  Use Question Timer
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const alternateTimerId = findAlternateTimerId(bonusTimerId)
                                    if (!alternateTimerId) {
                                      toast.error("No alternate timers available")
                                      return
                                    }
                                    setEventBonusTimer(question.id, alternateTimerId)
                                  }}
                                >
                                  Use Different Timer
                                </Button>
                              </div>
                            </div>
                          </>
                        )}
                        <p className="text-xs text-muted-foreground">Recorded: {formatTimestamp(answer?.recordedAt ?? null)}</p>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        {card.tiebreakerLabel.trim() ? (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-foreground">Tiebreaker</h2>
            <div className="mt-2 space-y-1.5">
              <Label>{card.tiebreakerLabel}</Label>
              <Input
                value={payload.tiebreakerAnswer}
                onChange={(event) => setTiebreakerAnswer(event.target.value)}
                placeholder="Record tiebreaker result"
              />
              {card.tiebreakerIsTimeBased ? (
                <div className="space-y-2">
                  <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <Select
                      value={payload.tiebreakerTimerId ?? "none"}
                      onValueChange={(value) => setTiebreakerTimerId(value === "none" ? null : value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select timer" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No timer</SelectItem>
                        {timerOptions.map((timerOption) => (
                          <SelectItem key={timerOption.id} value={timerOption.id}>
                            {timerOption.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="secondary" onClick={applyTimerValueToTiebreaker}>
                      <Timer className="mr-1 h-4 w-4" />
                      Use Timer
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Recorded: {formatTimestamp(payload.tiebreakerRecordedAt)}</p>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  )
}
