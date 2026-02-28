"use client";

import React, { useCallback, useMemo } from "react";
import { Pause, Play, Plus, RotateCcw, Timer, Trash2 } from "lucide-react";
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
  useLiveCard,
  useLivePayload,
  useLivePayloadActions,
  useLiveTimerActions,
  useLiveSetterActions,
  useBattleRoyalEntryInputByMatchId,
} from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import { useTimerClock } from "@/hooks/use-timer-clock";
import type { UseRosterSuggestionsReturn } from "@/hooks/use-roster-suggestions";
import {
  formatDuration,
  getTimerElapsedMs,
  toMatchTimerId,
  toMatchBonusTimerId,
} from "@/lib/pick-em/timer-utils";
import { findMatchResult, findAnswer } from "@/lib/pick-em/payload-utils";
import { filterRosterMemberSuggestions } from "@/lib/pick-em/text-utils";

/* ---- Utility helpers (local to this component) ---- */

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

function parseCountAnswer(answer: string | null | undefined): number {
  if (!answer) return 0;
  const parsed = Number.parseInt(answer, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, parsed);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return parsed.toLocaleString();
}

/* ---- Props ---- */

interface LiveKeyMatchSectionProps {
  matchIndex: number;
  roster: UseRosterSuggestionsReturn;
}

/* ---- Component ---- */

function LiveKeyMatchSectionInner({
  matchIndex,
  roster,
}: LiveKeyMatchSectionProps) {
  const card = useLiveCard();
  const payload = useLivePayload();
  const {
    liveSetMatchWinner,
    liveSetBattleRoyalEntryOrder,
    liveSetMatchBonusAnswer,
  } = useLivePayloadActions();
  const { liveStartTimer, liveStopTimer, liveResetTimer } =
    useLiveTimerActions();
  const { setBattleRoyalEntryInput } = useLiveSetterActions();
  const battleRoyalEntryInputByMatchId = useBattleRoyalEntryInputByMatchId();

  const match = card?.matches?.[matchIndex];
  if (!match) return null;

  const matchResult = findMatchResult(payload, match.id);
  const participants = match.participants;
  const winnerName = matchResult?.winnerName ?? "";
  const winnerInList = participants.some((name) => name === winnerName);
  const winnerSelectValue = winnerName
    ? winnerInList
      ? winnerName
      : "__custom__"
    : "__none__";

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

  /* Match bonus timer helpers */
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

  const incrementMatchBonusCount = useCallback(
    (questionId: string, isTimeBased: boolean) => {
      const result = findMatchResult(payload, match.id);
      const existingAnswer = findAnswer(
        result?.bonusAnswers ?? [],
        questionId,
      );
      const nextValue = String(parseCountAnswer(existingAnswer?.answer) + 1);
      liveSetMatchBonusAnswer(match.id, questionId, nextValue, isTimeBased);
    },
    [payload, match.id, liveSetMatchBonusAnswer],
  );

  const decrementMatchBonusCount = useCallback(
    (questionId: string, isTimeBased: boolean) => {
      const result = findMatchResult(payload, match.id);
      const existingAnswer = findAnswer(
        result?.bonusAnswers ?? [],
        questionId,
      );
      const nextValue = String(
        Math.max(0, parseCountAnswer(existingAnswer?.answer) - 1),
      );
      liveSetMatchBonusAnswer(match.id, questionId, nextValue, isTimeBased);
    },
    [payload, match.id, liveSetMatchBonusAnswer],
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-foreground">
          Match {matchIndex + 1}: {match.title || "Untitled Match"}
        </h2>
      </div>

      {/* Winner + Match Timer */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <div
            className={
              winnerSelectValue === "__custom__"
                ? "grid gap-2 sm:grid-cols-[1fr_1fr]"
                : "grid gap-2"
            }
          >
            <div className="space-y-1.5">
              <Label>Winner</Label>
              <Select
                value={winnerSelectValue}
                onValueChange={(value) => {
                  if (value === "__none__") {
                    liveSetMatchWinner(match.id, "");
                    return;
                  }
                  if (value === "__custom__") {
                    const current =
                      winnerName && !winnerInList ? winnerName : "";
                    liveSetMatchWinner(match.id, current);
                    return;
                  }
                  liveSetMatchWinner(match.id, value);
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
                  onChange={(event) =>
                    liveSetMatchWinner(match.id, event.target.value)
                  }
                />
              </div>
            ) : null}
          </div>
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
                      onClick={() => addBattleRoyalEntrant(candidate)}
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
            const bonusTimer = timersById.get(bonusTimerId);
            const selectedTimerId =
              answer?.timerId ?? (isTimeValueType ? bonusTimerId : null);
            const bonusTimerElapsed = bonusTimer
              ? formatDuration(getTimerElapsedMs(bonusTimer, currentTimeMs))
              : "--:--";
            const isUsingAlternateTimer =
              isTimeValueType && selectedTimerId !== bonusTimerId;
            const filteredRosterSuggestions = isRosterMemberType
              ? filterRosterMemberSuggestions(
                  answer?.answer ?? "",
                  Array.from(
                    new Set([
                      ...match.participants,
                      ...rosterQuerySuggestions,
                    ]),
                  ),
                )
              : [];

            return (
              <div
                key={question.id}
                className="rounded-md border border-border/70 bg-background/35 p-3"
              >
                <Label>{question.question || "Bonus question"}</Label>
                {isNumericalValueType ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-border px-3 py-1.5 font-mono text-lg text-foreground">
                      {parseCountAnswer(answer?.answer)}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        decrementMatchBonusCount(question.id, isTimeValueType)
                      }
                    >
                      -
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        incrementMatchBonusCount(question.id, isTimeValueType)
                      }
                    >
                      +
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        liveSetMatchBonusAnswer(
                          match.id,
                          question.id,
                          "",
                          isTimeValueType,
                        )
                      }
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
                        <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
                          <p className="text-xs text-muted-foreground">
                            Question Timer
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="rounded-md border border-border px-2 py-1 font-mono text-sm">
                              {bonusTimerElapsed}
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                if (!bonusTimer) return;
                                if (bonusTimer.isRunning) {
                                  liveStopTimer(bonusTimer.id);
                                } else {
                                  liveStartTimer(bonusTimer.id);
                                }
                              }}
                              disabled={!bonusTimer}
                            >
                              {bonusTimer?.isRunning ? (
                                <Pause className="mr-1 h-4 w-4" />
                              ) : (
                                <Play className="mr-1 h-4 w-4" />
                              )}
                              {bonusTimer?.isRunning ? "Stop" : "Start"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                bonusTimer && liveResetTimer(bonusTimer.id)
                              }
                              disabled={!bonusTimer}
                            >
                              <RotateCcw className="h-4 w-4" />
                              <span className="sr-only">
                                Reset bonus timer
                              </span>
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                applySpecificTimerValueToMatchBonus(
                                  question.id,
                                  bonusTimerId,
                                )
                              }
                            >
                              <Timer className="mr-1 h-4 w-4" />
                              Use Question Timer
                            </Button>
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
                                setMatchBonusTimer(
                                  question.id,
                                  alternateTimerId,
                                );
                              }}
                            >
                              Use Different Timer
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Recorded:{" "}
                      {formatTimestamp(answer?.recordedAt ?? null)}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export const LiveKeyMatchSection = React.memo(LiveKeyMatchSectionInner);
