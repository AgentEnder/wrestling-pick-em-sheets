"use client";

import React, { useCallback, useMemo } from "react";
import { Pause, Play, RotateCcw, Timer } from "lucide-react";
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
} from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import { useTimerClock } from "@/hooks/use-timer-clock";
import type { UseRosterSuggestionsReturn } from "@/hooks/use-roster-suggestions";
import {
  formatDuration,
  getTimerElapsedMs,
  toEventBonusTimerId,
} from "@/lib/pick-em/timer-utils";
import { findAnswer } from "@/lib/pick-em/payload-utils";
import { filterRosterMemberSuggestions } from "@/lib/pick-em/text-utils";

/* ---- Utility helpers ---- */

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

interface EventBonusSectionProps {
  roster: UseRosterSuggestionsReturn;
}

/* ---- Component ---- */

function EventBonusSectionInner({ roster }: EventBonusSectionProps) {
  const card = useLiveCard();
  const payload = useLivePayload();
  const { liveSetEventBonusAnswer } = useLivePayloadActions();
  const { liveStartTimer, liveStopTimer, liveResetTimer } =
    useLiveTimerActions();

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

  const eventParticipantCandidates = useMemo(
    () =>
      Array.from(
        new Set(
          (card?.matches ?? []).flatMap((match) => match.participants),
        ),
      ),
    [card?.matches],
  );

  const eventBonusQuestions = card?.eventBonusQuestions ?? [];

  /* Timer assignment helper */
  const setEventBonusTimer = useCallback(
    (questionId: string, timerId: string | null) => {
      const state = useAppStore.getState();
      const currentPayload = state.livePayload;
      const nextAnswers = [...currentPayload.eventBonusAnswers];
      const existingIndex = nextAnswers.findIndex(
        (item) => item.questionId === questionId,
      );

      if (existingIndex === -1) {
        nextAnswers.push({
          questionId,
          answer: "",
          recordedAt: null,
          timerId,
        });
      } else {
        nextAnswers[existingIndex] = {
          ...nextAnswers[existingIndex],
          timerId,
        };
      }

      state.setLivePayload({
        ...currentPayload,
        eventBonusAnswers: nextAnswers,
      });
    },
    [],
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

  const applyTimerValueToEventBonus = useCallback(
    (questionId: string) => {
      const answer = findAnswer(payload.eventBonusAnswers, questionId);
      const timerId = answer?.timerId ?? toEventBonusTimerId(questionId);
      const timer = timerId ? timersById.get(timerId) : undefined;

      if (!timer || !timerId) {
        toast.error("Select a timer first");
        return;
      }

      const timerValue = formatDuration(
        getTimerElapsedMs(timer, currentTimeMs),
      );
      setEventBonusTimer(questionId, timerId);
      liveSetEventBonusAnswer(questionId, timerValue, true);
    },
    [
      payload.eventBonusAnswers,
      timersById,
      currentTimeMs,
      setEventBonusTimer,
      liveSetEventBonusAnswer,
    ],
  );

  const applySpecificTimerValueToEventBonus = useCallback(
    (questionId: string, timerId: string) => {
      const timer = timersById.get(timerId);
      if (!timer) {
        toast.error("Timer not available");
        return;
      }

      const timerValue = formatDuration(
        getTimerElapsedMs(timer, currentTimeMs),
      );
      setEventBonusTimer(questionId, timerId);
      liveSetEventBonusAnswer(questionId, timerValue, true);
    },
    [timersById, currentTimeMs, setEventBonusTimer, liveSetEventBonusAnswer],
  );

  const incrementEventBonusCount = useCallback(
    (questionId: string, isTimeBased: boolean) => {
      const existingAnswer = findAnswer(payload.eventBonusAnswers, questionId);
      const nextValue = String(parseCountAnswer(existingAnswer?.answer) + 1);
      liveSetEventBonusAnswer(questionId, nextValue, isTimeBased);
    },
    [payload.eventBonusAnswers, liveSetEventBonusAnswer],
  );

  const decrementEventBonusCount = useCallback(
    (questionId: string, isTimeBased: boolean) => {
      const existingAnswer = findAnswer(payload.eventBonusAnswers, questionId);
      const nextValue = String(
        Math.max(0, parseCountAnswer(existingAnswer?.answer) - 1),
      );
      liveSetEventBonusAnswer(questionId, nextValue, isTimeBased);
    },
    [payload.eventBonusAnswers, liveSetEventBonusAnswer],
  );

  if (eventBonusQuestions.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold text-foreground">Event Bonus Answers</h2>
      <div className="mt-3 space-y-3">
        {eventBonusQuestions.map((question) => {
          const questionValueType = getQuestionValueType(question);
          const isTimeValueType = questionValueType === "time";
          const isNumericalValueType = questionValueType === "numerical";
          const isRosterMemberType = questionValueType === "rosterMember";
          const rosterFieldKey = `eventBonus:${question.id}`;
          const rosterQuerySuggestions =
            roster.activeFieldKey === rosterFieldKey
              ? roster.suggestions
              : [];
          const answer = findAnswer(payload.eventBonusAnswers, question.id);
          const bonusTimerId = toEventBonusTimerId(question.id);
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
                    ...eventParticipantCandidates,
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
              <Label>{question.question || "Event bonus question"}</Label>
              {isNumericalValueType ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-border px-3 py-1.5 font-mono text-lg text-foreground">
                    {parseCountAnswer(answer?.answer)}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      decrementEventBonusCount(question.id, isTimeValueType)
                    }
                  >
                    -
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      incrementEventBonusCount(question.id, isTimeValueType)
                    }
                  >
                    +
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      liveSetEventBonusAnswer(
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
                      liveSetEventBonusAnswer(
                        question.id,
                        event.target.value,
                        isTimeValueType,
                      );
                      roster.setActiveInput(rosterFieldKey, event.target.value);
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
                                liveSetEventBonusAnswer(
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
                            setEventBonusTimer(
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
                            applyTimerValueToEventBonus(question.id)
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
                          setEventBonusTimer(question.id, bonusTimerId)
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
                              Reset event bonus timer
                            </span>
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              applySpecificTimerValueToEventBonus(
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
                              setEventBonusTimer(
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
                    Recorded: {formatTimestamp(answer?.recordedAt ?? null)}
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export const EventBonusSection = React.memo(EventBonusSectionInner);
