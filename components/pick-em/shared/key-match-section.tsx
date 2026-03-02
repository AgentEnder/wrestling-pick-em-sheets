"use client";

import React, { useCallback, useMemo } from "react";
import {
  Check,
  ChevronsUpDown,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Timer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useLiveCard,
  useLivePayload,
  useLivePayloadActions,
  useLiveTimerActions,
  useLiveSetterActions,
  useBattleRoyalEntryInputByMatchId,
  useEliminationEntryInputByMatchId,
} from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import { useTimerClock } from "@/hooks/use-timer-clock";
import type { UseRosterSuggestionsReturn } from "@/hooks/use-roster-suggestions";
import {
  formatDuration,
  getTimerElapsedMs,
  getQuestionValueType,
  toMatchTimerId,
  toMatchBonusTimerId,
} from "@/lib/pick-em/timer-utils";
import {
  findMatchResult,
  findAnswer,
  toLockKey,
} from "@/lib/pick-em/payload-utils";
import { filterRosterMemberSuggestions } from "@/lib/pick-em/text-utils";
import { ThresholdButtons } from "@/components/pick-em/shared/threshold-buttons";
import { CounterInput } from "@/components/pick-em/shared/counter-input";
import { BonusTimerCapture } from "@/components/pick-em/shared/bonus-timer-capture";
import { MultipleChoiceSelect } from "@/components/pick-em/shared/multiple-choice-select";
import type { LiveGameLockState } from "@/lib/types";
import type { LiveGameStateResponse } from "@/lib/client/live-games-api";
import {
  FuzzyReviewPanel,
  computeFuzzyCandidatesForAnswer,
} from "@/components/pick-em/live-host/fuzzy-match-review-panel";

/* ---- Helpers ---- */

function formatThresholdValue(seconds: number, valueType: string): string {
  if (valueType === "time") {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  return String(seconds);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return parsed.toLocaleString();
}

/* ---- Props ---- */

interface KeyMatchSectionProps {
  matchIndex: number;
  roster: UseRosterSuggestionsReturn;
  // Host-only (all optional)
  lockState?: LiveGameLockState | null;
  gameState?: LiveGameStateResponse | null;
  onToggleMatchLock?: (matchId: string, locked: boolean) => void;
  onToggleMatchBonusLock?: (
    matchId: string,
    questionId: string,
    locked: boolean,
  ) => void;
  onAcceptWinnerOverride?: (
    matchId: string,
    playerNickname: string,
    confidence: number,
  ) => void;
  onRejectWinnerOverride?: (
    matchId: string,
    playerNickname: string,
  ) => void;
  onAcceptBonusOverride?: (
    questionId: string,
    playerNickname: string,
    confidence: number,
  ) => void;
  onRejectBonusOverride?: (
    questionId: string,
    playerNickname: string,
  ) => void;
}

/* ---- Component ---- */

function KeyMatchSectionInner({
  matchIndex,
  roster,
  lockState,
  gameState,
  onToggleMatchLock,
  onToggleMatchBonusLock,
  onAcceptWinnerOverride,
  onRejectWinnerOverride,
  onAcceptBonusOverride,
  onRejectBonusOverride,
}: KeyMatchSectionProps) {
  const card = useLiveCard();
  const payload = useLivePayload();
  const {
    liveSetMatchWinner,
    liveSetBattleRoyalEntryOrder,
    liveAddEliminationEntry: liveAddEliminationEntryAction,
    liveRemoveEliminationEntry: liveRemoveEliminationEntryAction,
    liveSetMatchBonusAnswer,
  } = useLivePayloadActions();
  const { liveStartTimer, liveStopTimer, liveResetTimer } =
    useLiveTimerActions();
  const { setBattleRoyalEntryInput, setEliminationEntryInput } =
    useLiveSetterActions();
  const battleRoyalEntryInputByMatchId = useBattleRoyalEntryInputByMatchId();
  const eliminationEntryInputByMatchId = useEliminationEntryInputByMatchId();

  const match = card?.matches?.[matchIndex];
  if (!match) return null;

  const matchResult = findMatchResult(payload, match.id);
  const participants = match.participants;
  const winnerName = matchResult?.winnerName ?? "";
  const [winnerComboboxOpen, setWinnerComboboxOpen] = React.useState(false);

  /* Build deduped winner candidates: participants + keyed entrants + player guesses */
  const winnerCandidates = useMemo(() => {
    const entryOrder = matchResult?.battleRoyalEntryOrder ?? [];
    const playerGuesses = (gameState?.playerAnswerSummaries ?? [])
      .map(
        (p) => p.matchPicks.find((mp) => mp.matchId === match.id)?.winnerName,
      )
      .filter((name): name is string => !!name && name.trim().length > 0);
    return Array.from(
      new Set([...participants, ...entryOrder, ...playerGuesses]),
    );
  }, [
    participants,
    matchResult?.battleRoyalEntryOrder,
    gameState?.playerAnswerSummaries,
    match.id,
  ]);

  /* Timer state */
  const matchTimerId = toMatchTimerId(match.id);
  const hasRunningTimers = useMemo(
    () => payload.timers.some((timer) => timer.isRunning),
    [payload.timers],
  );
  const currentTimeMs = useTimerClock(300, hasRunningTimers);

  const timersById = useMemo(
    () => new Map(payload.timers.map((timer) => [timer.id, timer])),
    [payload.timers],
  );

  const timerOptions = useMemo(
    () => payload.timers.map((timer) => ({ id: timer.id, label: timer.label })),
    [payload.timers],
  );

  const matchTimer = timersById.get(matchTimerId);
  const matchTimerElapsed = matchTimer
    ? formatDuration(getTimerElapsedMs(matchTimer, currentTimeMs))
    : "--:--";

  /* Battle Royal state */
  const battleRoyalInputRef = React.useRef<HTMLInputElement>(null);
  const battleRoyalEntryOrder = matchResult?.battleRoyalEntryOrder ?? [];
  const battleRoyalEntryInput = battleRoyalEntryInputByMatchId[match.id] ?? "";
  const battleRoyalFieldKey = `battleRoyal:${match.id}`;
  const normalizedBattleRoyalEntryInput = battleRoyalEntryInput
    .trim()
    .toLowerCase();
  const battleRoyalSuggestions =
    roster.activeFieldKey === battleRoyalFieldKey ? roster.suggestions : [];
  const battleRoyalCandidates = match.isBattleRoyal
    ? Array.from(new Set([...match.participants, ...battleRoyalSuggestions]))
    : [];
  const filteredBattleRoyalSuggestions = normalizedBattleRoyalEntryInput
    ? battleRoyalCandidates
        .filter((candidate) =>
          candidate.toLowerCase().includes(normalizedBattleRoyalEntryInput),
        )
        .filter(
          (candidate) =>
            !battleRoyalEntryOrder.some(
              (entry) => entry.toLowerCase() === candidate.toLowerCase(),
            ),
        )
        .slice(0, 8)
    : [];

  /* Elimination Order state */
  const eliminationInputRef = React.useRef<HTMLInputElement>(null);
  const eliminationOrder = matchResult?.battleRoyalEliminationOrder ?? [];
  const eliminationEntryInput = eliminationEntryInputByMatchId[match.id] ?? "";
  const eliminationFieldKey = `elimination:${match.id}`;
  const normalizedEliminationEntryInput = eliminationEntryInput
    .trim()
    .toLowerCase();
  const eliminationSuggestions =
    roster.activeFieldKey === eliminationFieldKey ? roster.suggestions : [];
  const eliminationCandidates = match.isEliminationStyle
    ? Array.from(
        new Set([
          ...match.participants,
          ...battleRoyalEntryOrder,
          ...eliminationSuggestions,
        ]),
      )
    : [];
  const filteredEliminationSuggestions = normalizedEliminationEntryInput
    ? eliminationCandidates
        .filter((candidate) =>
          candidate.toLowerCase().includes(normalizedEliminationEntryInput),
        )
        .filter(
          (candidate) =>
            !eliminationOrder.some(
              (entry) => entry.toLowerCase() === candidate.toLowerCase(),
            ),
        )
        .slice(0, 8)
    : [];

  /* Battle royal handlers */
  const addBattleRoyalEntrant = useCallback(
    (entrantName: string) => {
      const entrant = entrantName.trim();
      if (!entrant) return;
      const existingEntries =
        findMatchResult(payload, match.id)?.battleRoyalEntryOrder ?? [];
      const duplicate = existingEntries.some(
        (entry) => entry.toLowerCase() === entrant.toLowerCase(),
      );
      if (duplicate) {
        setBattleRoyalEntryInput(match.id, "");
        return;
      }
      liveSetBattleRoyalEntryOrder(match.id, [...existingEntries, entrant]);
      setBattleRoyalEntryInput(match.id, "");
      roster.clearSuggestions();
    },
    [
      payload,
      match.id,
      liveSetBattleRoyalEntryOrder,
      setBattleRoyalEntryInput,
      roster,
    ],
  );

  const removeBattleRoyalEntrant = useCallback(
    (entryIndex: number) => {
      const existingEntries =
        findMatchResult(payload, match.id)?.battleRoyalEntryOrder ?? [];
      liveSetBattleRoyalEntryOrder(
        match.id,
        existingEntries.filter((_, index) => index !== entryIndex),
      );
    },
    [payload, match.id, liveSetBattleRoyalEntryOrder],
  );

  /* Elimination order handlers */
  const addEliminationEntry = useCallback(
    (entrantName: string) => {
      const entrant = entrantName.trim();
      if (!entrant) return;
      const existingEntries =
        findMatchResult(payload, match.id)?.battleRoyalEliminationOrder ?? [];
      const duplicate = existingEntries.some(
        (entry) => entry.toLowerCase() === entrant.toLowerCase(),
      );
      if (duplicate) {
        setEliminationEntryInput(match.id, "");
        return;
      }
      liveAddEliminationEntryAction(match.id, entrant);
      setEliminationEntryInput(match.id, "");
      roster.clearSuggestions();
    },
    [
      payload,
      match.id,
      liveAddEliminationEntryAction,
      setEliminationEntryInput,
      roster,
    ],
  );

  const removeEliminationEntry = useCallback(
    (entryIndex: number) => {
      liveRemoveEliminationEntryAction(match.id, entryIndex);
    },
    [match.id, liveRemoveEliminationEntryAction],
  );

  /* Match bonus timer helpers (from solo-key for alternate timer selection) */
  const setMatchBonusTimer = useCallback(
    (questionId: string, timerId: string | null) => {
      const state = useAppStore.getState();
      const currentPayload = state.livePayload;
      const nextResults = [...currentPayload.matchResults];
      let resultIndex = nextResults.findIndex(
        (result) => result.matchId === match.id,
      );

      if (resultIndex === -1) {
        nextResults.push({
          matchId: match.id,
          winnerName: "",
          winnerRecordedAt: null,
          battleRoyalEntryOrder: [],
          battleRoyalEliminationOrder: [],
          bonusAnswers: [],
        });
        resultIndex = nextResults.length - 1;
      }

      const nextAnswers = [...nextResults[resultIndex].bonusAnswers];
      const answerIndex = nextAnswers.findIndex(
        (answer) => answer.questionId === questionId,
      );

      if (answerIndex === -1) {
        nextAnswers.push({
          questionId,
          answer: "",
          recordedAt: null,
          timerId,
        });
      } else {
        nextAnswers[answerIndex] = {
          ...nextAnswers[answerIndex],
          timerId,
        };
      }

      nextResults[resultIndex] = {
        ...nextResults[resultIndex],
        bonusAnswers: nextAnswers,
      };

      state.setLivePayload({
        ...currentPayload,
        matchResults: nextResults,
      });
    },
    [match.id],
  );

  const findAlternateTimerId = useCallback(
    (excludedTimerId: string) => {
      const alternate = payload.timers.find(
        (timer) => timer.id !== excludedTimerId,
      );
      return alternate?.id ?? null;
    },
    [payload.timers],
  );

  const applyTimerValueToMatchBonus = useCallback(
    (questionId: string) => {
      const bonusResult = findMatchResult(payload, match.id);
      const answer = findAnswer(bonusResult?.bonusAnswers ?? [], questionId);
      const timerId =
        answer?.timerId ?? toMatchBonusTimerId(match.id, questionId);
      const timer = timerId ? timersById.get(timerId) : undefined;

      if (!timer || !timerId) {
        toast.error("Select a timer first");
        return;
      }

      const timerValue = formatDuration(
        getTimerElapsedMs(timer, currentTimeMs),
      );
      setMatchBonusTimer(questionId, timerId);
      liveSetMatchBonusAnswer(match.id, questionId, timerValue, true);
    },
    [
      payload,
      match.id,
      timersById,
      currentTimeMs,
      setMatchBonusTimer,
      liveSetMatchBonusAnswer,
    ],
  );

  const applySpecificTimerValueToMatchBonus = useCallback(
    (questionId: string, timerId: string) => {
      const timer = timersById.get(timerId);
      if (!timer) {
        toast.error("Timer not available");
        return;
      }

      const timerValue = formatDuration(
        getTimerElapsedMs(timer, currentTimeMs),
      );
      setMatchBonusTimer(questionId, timerId);
      liveSetMatchBonusAnswer(match.id, questionId, timerValue, true);
    },
    [
      timersById,
      currentTimeMs,
      match.id,
      setMatchBonusTimer,
      liveSetMatchBonusAnswer,
    ],
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-foreground">
          Match {matchIndex + 1}: {match.title || "Untitled Match"}
        </h2>
        {onToggleMatchLock && lockState ? (
          <Button
            size="sm"
            variant={
              lockState.matchLocks[match.id]?.locked ? "default" : "outline"
            }
            onClick={() =>
              onToggleMatchLock(
                match.id,
                !(lockState.matchLocks[match.id]?.locked === true),
              )
            }
          >
            {lockState.matchLocks[match.id]?.locked
              ? "Unlock Match"
              : "Lock Match"}
          </Button>
        ) : null}
      </div>

      {/* Winner + Match Timer */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <div className="space-y-2">
            <Label>Winner</Label>
            <Popover
              open={winnerComboboxOpen}
              onOpenChange={setWinnerComboboxOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={winnerComboboxOpen}
                  className="w-full justify-between font-normal"
                >
                  {winnerName || "Select winner..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-(--radix-popover-trigger-width) p-0"
                align="start"
              >
                <Command>
                  <CommandInput placeholder="Search or type winner..." />
                  <CommandList>
                    <CommandEmpty>
                      No match found. Press enter to use typed value.
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="__clear__"
                        onSelect={() => {
                          liveSetMatchWinner(match.id, "");
                          setWinnerComboboxOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            !winnerName ? "opacity-100" : "opacity-0",
                          )}
                        />
                        Unanswered
                      </CommandItem>
                      {winnerCandidates.map((candidate) => (
                        <CommandItem
                          key={candidate}
                          value={candidate}
                          onSelect={() => {
                            liveSetMatchWinner(match.id, candidate);
                            setWinnerComboboxOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              winnerName === candidate
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {candidate}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          {onAcceptWinnerOverride &&
          onRejectWinnerOverride &&
          gameState?.playerAnswerSummaries &&
          winnerName.trim() ? (
            <FuzzyReviewPanel
              candidates={computeFuzzyCandidatesForAnswer(
                winnerName,
                (gameState.playerAnswerSummaries ?? []).map((p) => {
                  const pick = p.matchPicks.find(
                    (mp) => mp.matchId === match.id,
                  );
                  return {
                    nickname: p.nickname,
                    normalizedNickname: p.normalizedNickname,
                    answer: pick?.winnerName ?? "",
                  };
                }),
                payload.winnerOverrides.filter((o) => o.matchId === match.id),
              )}
              onAccept={(nn) => {
                const candidates = computeFuzzyCandidatesForAnswer(
                  winnerName,
                  (gameState.playerAnswerSummaries ?? []).map((p) => {
                    const pick = p.matchPicks.find(
                      (mp) => mp.matchId === match.id,
                    );
                    return {
                      nickname: p.nickname,
                      normalizedNickname: p.normalizedNickname,
                      answer: pick?.winnerName ?? "",
                    };
                  }),
                  payload.winnerOverrides.filter((o) => o.matchId === match.id),
                );
                const candidate = candidates.find(
                  (c) => c.normalizedNickname === nn,
                );
                if (candidate)
                  onAcceptWinnerOverride(
                    match.id,
                    nn,
                    candidate.confidence,
                  );
              }}
              onReject={(nn) => onRejectWinnerOverride(match.id, nn)}
            />
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Winner recorded:{" "}
            {formatTimestamp(matchResult?.winnerRecordedAt ?? null)}
          </p>
        </div>

        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <p className="text-xs text-muted-foreground">Match Timer</p>
          <p className="font-mono text-2xl text-foreground">
            {matchTimerElapsed}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => {
                if (!matchTimer) return;
                if (matchTimer.isRunning) {
                  liveStopTimer(matchTimer.id);
                } else {
                  liveStartTimer(matchTimer.id);
                }
              }}
              disabled={!matchTimer}
            >
              {matchTimer?.isRunning ? (
                <Pause className="mr-1 h-4 w-4" />
              ) : (
                <Play className="mr-1 h-4 w-4" />
              )}
              {matchTimer?.isRunning ? "Stop" : "Start"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => matchTimer && liveResetTimer(matchTimer.id)}
              disabled={!matchTimer}
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* Battle Royal Entry Order */}
      {match.isBattleRoyal ? (
        <div className="mt-3 space-y-2">
          <Label>Entry Order</Label>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <Input
              ref={battleRoyalInputRef}
              placeholder="Add entrant"
              value={battleRoyalEntryInput}
              onChange={(event) => {
                setBattleRoyalEntryInput(match.id, event.target.value);
                roster.setActiveInput(battleRoyalFieldKey, event.target.value);
              }}
              onFocus={() =>
                roster.setActiveInput(
                  battleRoyalFieldKey,
                  battleRoyalEntryInput,
                )
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addBattleRoyalEntrant(battleRoyalEntryInput);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => addBattleRoyalEntrant(battleRoyalEntryInput)}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add Entrant
            </Button>
          </div>
          {(roster.activeFieldKey === battleRoyalFieldKey &&
            roster.isLoading) ||
          filteredBattleRoyalSuggestions.length > 0 ? (
            <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                {roster.activeFieldKey === battleRoyalFieldKey &&
                roster.isLoading
                  ? "Loading roster suggestions..."
                  : "Autocomplete from promotion roster"}
              </p>
              {filteredBattleRoyalSuggestions.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {filteredBattleRoyalSuggestions.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      onClick={() => {
                        addBattleRoyalEntrant(candidate);
                        requestAnimationFrame(() => {
                          battleRoyalInputRef.current?.focus();
                        });
                      }}
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
                <div
                  key={`${match.id}:${entrant}:${entrantIndex}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-sm text-foreground">
                    {entrantIndex + 1}. {entrant}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeBattleRoyalEntrant(entrantIndex)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove entrant</span>
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Entrants are recorded in the order you add them.
          </p>
        </div>
      ) : null}

      {/* Elimination Order */}
      {match.isEliminationStyle ? (
        <div className="mt-3 space-y-2">
          <Label>Elimination Order</Label>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <Input
              ref={eliminationInputRef}
              value={eliminationEntryInput}
              onChange={(event) => {
                setEliminationEntryInput(match.id, event.target.value);
                roster.setActiveInput(
                  eliminationFieldKey,
                  event.target.value,
                );
              }}
              onFocus={() =>
                roster.setActiveInput(
                  eliminationFieldKey,
                  eliminationEntryInput,
                )
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addEliminationEntry(eliminationEntryInput);
              }}
              placeholder="Add eliminated wrestler"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => addEliminationEntry(eliminationEntryInput)}
            >
              <Plus className="mr-1 h-4 w-4" />
              Eliminated
            </Button>
          </div>
          {(roster.activeFieldKey === eliminationFieldKey &&
            roster.isLoading) ||
          filteredEliminationSuggestions.length > 0 ? (
            <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                {roster.activeFieldKey === eliminationFieldKey &&
                roster.isLoading
                  ? "Loading roster suggestions..."
                  : "Autocomplete from promotion roster"}
              </p>
              {filteredEliminationSuggestions.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {filteredEliminationSuggestions.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      onClick={() => {
                        addEliminationEntry(candidate);
                        requestAnimationFrame(() => {
                          eliminationInputRef.current?.focus();
                        });
                      }}
                      className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {eliminationOrder.length > 0 ? (
            <div className="space-y-1.5 rounded-md border border-border/70 bg-background/35 p-2.5">
              {eliminationOrder.map((entrant, entrantIndex) => (
                <div
                  key={`elim:${entrant}:${entrantIndex}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-sm text-foreground">
                    {entrantIndex + 1}. {entrant}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeEliminationEntry(entrantIndex)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove</span>
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Record each elimination as it happens.
          </p>
        </div>
      ) : null}

      {/* Bonus Questions */}
      {match.bonusQuestions.length > 0 ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium text-foreground">Bonus Answers</p>
          {match.bonusQuestions.map((question) => {
            const questionValueType = getQuestionValueType(question);
            const isTimeValueType = questionValueType === "time";
            const isNumericalValueType = questionValueType === "numerical";
            const isRosterMemberType = questionValueType === "rosterMember";
            const rosterFieldKey = `matchBonus:${match.id}:${question.id}`;
            const rosterQuerySuggestions =
              roster.activeFieldKey === rosterFieldKey
                ? roster.suggestions
                : [];
            const answer = findAnswer(
              matchResult?.bonusAnswers ?? [],
              question.id,
            );
            const bonusTimerId = toMatchBonusTimerId(match.id, question.id);
            const bonusTimer = timersById.get(bonusTimerId) ?? null;
            const selectedTimerId =
              answer?.timerId ?? (isTimeValueType ? bonusTimerId : null);
            const isUsingAlternateTimer =
              isTimeValueType && selectedTimerId !== bonusTimerId;
            const filteredRosterSuggestions = isRosterMemberType
              ? filterRosterMemberSuggestions(
                  answer?.answer ?? "",
                  Array.from(
                    new Set([...match.participants, ...rosterQuerySuggestions]),
                  ),
                )
              : [];

            const lockKey = toLockKey(match.id, question.id);
            const isLocked = lockState
              ? lockState.matchBonusLocks[lockKey]?.locked === true ||
                lockState.matchLocks[match.id]?.locked === true ||
                lockState.globalLocked
              : false;

            return (
              <div
                key={question.id}
                className="rounded-md border border-border/70 bg-background/35 p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Label>{question.question || "Bonus question"}</Label>
                  {onToggleMatchBonusLock && lockState ? (
                    <Button
                      size="sm"
                      variant={isLocked ? "default" : "outline"}
                      onClick={() =>
                        onToggleMatchBonusLock(
                          match.id,
                          question.id,
                          !isLocked,
                        )
                      }
                    >
                      {isLocked ? "Unlock" : "Lock"}
                    </Button>
                  ) : null}
                </div>
                {question.answerType === "threshold" ? (
                  <div className="space-y-1.5">
                    {question.valueType === "numerical" ? (
                      <CounterInput
                        value={answer?.answer}
                        onChange={(v) =>
                          liveSetMatchBonusAnswer(
                            match.id,
                            question.id,
                            v,
                            false,
                          )
                        }
                        thresholdValue={question.thresholdValue ?? undefined}
                        thresholdLabels={question.thresholdLabels ?? undefined}
                      />
                    ) : (
                      <ThresholdButtons
                        labels={question.thresholdLabels ?? ["Over", "Under"]}
                        selectedValue={answer?.answer ?? ""}
                        onSelect={(label) =>
                          liveSetMatchBonusAnswer(
                            match.id,
                            question.id,
                            label,
                            false,
                          )
                        }
                      />
                    )}
                    {question.thresholdValue != null &&
                    question.valueType !== "numerical" ? (
                      <p className="text-xs text-muted-foreground">
                        Threshold:{" "}
                        {formatThresholdValue(
                          question.thresholdValue,
                          question.valueType,
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : question.answerType === "multiple-choice" &&
                  question.options.length > 0 ? (
                  <MultipleChoiceSelect
                    options={question.options}
                    value={answer?.answer ?? ""}
                    onChange={(v) =>
                      liveSetMatchBonusAnswer(match.id, question.id, v, false)
                    }
                  />
                ) : isNumericalValueType ? (
                  <CounterInput
                    value={answer?.answer}
                    onChange={(v) =>
                      liveSetMatchBonusAnswer(
                        match.id,
                        question.id,
                        v,
                        isTimeValueType,
                      )
                    }
                  />
                ) : (
                  <>
                    <Input
                      className="mt-2"
                      placeholder={
                        isRosterMemberType
                          ? "Start typing a roster member..."
                          : "Key answer"
                      }
                      value={answer?.answer ?? ""}
                      onChange={(event) => {
                        liveSetMatchBonusAnswer(
                          match.id,
                          question.id,
                          event.target.value,
                          isTimeValueType,
                        );
                        roster.setActiveInput(
                          rosterFieldKey,
                          event.target.value,
                        );
                      }}
                      onFocus={() =>
                        roster.setActiveInput(
                          rosterFieldKey,
                          answer?.answer ?? "",
                        )
                      }
                    />
                    {isRosterMemberType &&
                    ((roster.activeFieldKey === rosterFieldKey &&
                      roster.isLoading) ||
                      filteredRosterSuggestions.length > 0) ? (
                      <div className="mt-2 rounded-md border border-border/70 bg-background/35 px-3 py-2">
                        <p className="text-[11px] text-muted-foreground">
                          {roster.activeFieldKey === rosterFieldKey &&
                          roster.isLoading
                            ? "Loading roster suggestions..."
                            : "Autocomplete from promotion roster"}
                        </p>
                        {filteredRosterSuggestions.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {filteredRosterSuggestions.map((candidate) => (
                              <button
                                key={`${question.id}:${candidate}`}
                                type="button"
                                onClick={() =>
                                  liveSetMatchBonusAnswer(
                                    match.id,
                                    question.id,
                                    candidate,
                                    isTimeValueType,
                                  )
                                }
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
                              setMatchBonusTimer(
                                question.id,
                                value === "none" ? null : value,
                              )
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select timer" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No timer</SelectItem>
                              {timerOptions.map((timerOption) => (
                                <SelectItem
                                  key={timerOption.id}
                                  value={timerOption.id}
                                >
                                  {timerOption.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              applyTimerValueToMatchBonus(question.id)
                            }
                          >
                            <Timer className="mr-1 h-4 w-4" />
                            Use Selected Timer
                          </Button>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setMatchBonusTimer(question.id, bonusTimerId)
                          }
                        >
                          Use Question Timer Instead
                        </Button>
                      </>
                    ) : (
                      <>
                        <BonusTimerCapture
                          timer={bonusTimer}
                          currentTimeMs={currentTimeMs}
                          onStart={liveStartTimer}
                          onStop={liveStopTimer}
                          onReset={liveResetTimer}
                          onCapture={(_timerValue) =>
                            applySpecificTimerValueToMatchBonus(
                              question.id,
                              bonusTimerId,
                            )
                          }
                          captureLabel="Use Question Timer"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const alternateTimerId =
                              findAlternateTimerId(bonusTimerId);
                            if (!alternateTimerId) {
                              toast.error("No alternate timers available");
                              return;
                            }
                            setMatchBonusTimer(question.id, alternateTimerId);
                          }}
                        >
                          Use Different Timer
                        </Button>
                      </>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Recorded: {formatTimestamp(answer?.recordedAt ?? null)}
                    </p>
                  </div>
                ) : null}
                {onAcceptBonusOverride &&
                onRejectBonusOverride &&
                gameState?.playerAnswerSummaries ? (
                  <FuzzyReviewPanel
                    candidates={computeFuzzyCandidatesForAnswer(
                      answer?.answer ?? "",
                      (gameState.playerAnswerSummaries ?? []).map((p) => ({
                        nickname: p.nickname,
                        normalizedNickname: p.normalizedNickname,
                        answer:
                          p.matchPicks
                            .find((mp) => mp.matchId === match.id)
                            ?.bonusAnswers.find(
                              (ba) => ba.questionId === question.id,
                            )?.answer ?? "",
                      })),
                      payload.scoreOverrides.filter(
                        (o) => o.questionId === question.id,
                      ),
                    )}
                    onAccept={(nn) => {
                      const candidates = computeFuzzyCandidatesForAnswer(
                        answer?.answer ?? "",
                        (gameState.playerAnswerSummaries ?? []).map((p) => ({
                          nickname: p.nickname,
                          normalizedNickname: p.normalizedNickname,
                          answer:
                            p.matchPicks
                              .find((mp) => mp.matchId === match.id)
                              ?.bonusAnswers.find(
                                (ba) => ba.questionId === question.id,
                              )?.answer ?? "",
                        })),
                        payload.scoreOverrides.filter(
                          (o) => o.questionId === question.id,
                        ),
                      );
                      const candidate = candidates.find(
                        (c) => c.normalizedNickname === nn,
                      );
                      if (candidate)
                        onAcceptBonusOverride(
                          question.id,
                          nn,
                          candidate.confidence,
                        );
                    }}
                    onReject={(nn) =>
                      onRejectBonusOverride(question.id, nn)
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export const KeyMatchSection = React.memo(KeyMatchSectionInner);
