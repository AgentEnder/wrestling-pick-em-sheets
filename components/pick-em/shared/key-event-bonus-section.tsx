"use client";

import React, { useCallback, useMemo } from "react";
import { Timer } from "lucide-react";
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
import { ThresholdButtons } from "@/components/pick-em/shared/threshold-buttons";
import { CounterInput } from "@/components/pick-em/shared/counter-input";
import { BonusTimerCapture } from "@/components/pick-em/shared/bonus-timer-capture";
import { MultipleChoiceSelect } from "@/components/pick-em/shared/multiple-choice-select";
import {
  formatDuration,
  getTimerElapsedMs,
  getQuestionValueType,
  toEventBonusTimerId,
} from "@/lib/pick-em/timer-utils";
import {
  useLiveCard,
  useLivePayload,
  useLivePayloadActions,
  useLiveTimerActions,
} from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import { useTimerClock } from "@/hooks/use-timer-clock";
import type { UseRosterSuggestionsReturn } from "@/hooks/use-roster-suggestions";
import { findAnswer } from "@/lib/pick-em/payload-utils";
import { filterRosterMemberSuggestions } from "@/lib/pick-em/text-utils";
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

interface KeyEventBonusSectionProps {
  roster: UseRosterSuggestionsReturn;
  // Host-only (all optional)
  lockState?: LiveGameLockState | null;
  gameState?: LiveGameStateResponse | null;
  onToggleEventBonusLock?: (questionId: string, locked: boolean) => void;
  onAcceptOverride?: (
    questionId: string,
    playerNickname: string,
    confidence: number,
  ) => void;
  onRejectOverride?: (questionId: string, playerNickname: string) => void;
}

/* ---- Component ---- */

function KeyEventBonusSectionInner({
  roster,
  lockState,
  gameState,
  onToggleEventBonusLock,
  onAcceptOverride,
  onRejectOverride,
}: KeyEventBonusSectionProps) {
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
        new Set((card?.matches ?? []).flatMap((match) => match.participants)),
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

  if (eventBonusQuestions.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold text-foreground">
        Event Bonus Questions
      </h2>
      <div className="mt-3 space-y-3">
        {eventBonusQuestions.map((question) => {
          const questionValueType = getQuestionValueType(question);
          const isTimeValueType = questionValueType === "time";
          const isNumericalValueType = questionValueType === "numerical";
          const isRosterMemberType = questionValueType === "rosterMember";
          const rosterFieldKey = `eventBonus:${question.id}`;
          const rosterQuerySuggestions =
            roster.activeFieldKey === rosterFieldKey ? roster.suggestions : [];
          const answer = findAnswer(payload.eventBonusAnswers, question.id);
          const bonusTimerId = toEventBonusTimerId(question.id);
          const bonusTimer = timersById.get(bonusTimerId) ?? null;
          const selectedTimerId =
            answer?.timerId ?? (isTimeValueType ? bonusTimerId : null);
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

          const isLocked =
            lockState?.eventBonusLocks[question.id]?.locked === true ||
            lockState?.globalLocked === true;

          return (
            <div
              key={question.id}
              className="rounded-md border border-border/70 bg-background/35 p-3"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <Label>{question.question || "Event bonus question"}</Label>
                {onToggleEventBonusLock && lockState && (
                  <Button
                    size="sm"
                    variant={isLocked ? "default" : "outline"}
                    onClick={() =>
                      onToggleEventBonusLock(question.id, !isLocked)
                    }
                  >
                    {isLocked ? "Unlock" : "Lock"}
                  </Button>
                )}
              </div>

              {/* -- Answer input area -- */}
              {question.answerType === "threshold" ? (
                <div className="space-y-1.5">
                  {question.valueType === "numerical" ? (
                    <CounterInput
                      value={answer?.answer}
                      onChange={(v) =>
                        liveSetEventBonusAnswer(question.id, v, false)
                      }
                      thresholdValue={question.thresholdValue ?? undefined}
                      thresholdLabels={question.thresholdLabels ?? undefined}
                    />
                  ) : (
                    <ThresholdButtons
                      labels={question.thresholdLabels ?? ["Over", "Under"]}
                      selectedValue={answer?.answer ?? ""}
                      onSelect={(label) =>
                        liveSetEventBonusAnswer(question.id, label, false)
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
                    liveSetEventBonusAnswer(question.id, v, false)
                  }
                />
              ) : isNumericalValueType ? (
                <div className="mt-2">
                  <CounterInput
                    value={answer?.answer}
                    onChange={(v) =>
                      liveSetEventBonusAnswer(
                        question.id,
                        v,
                        isTimeValueType,
                      )
                    }
                  />
                </div>
              ) : (
                <Input
                  className="mt-2"
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
                  placeholder={
                    isRosterMemberType
                      ? "Start typing a roster member..."
                      : question.answerType === "multiple-choice"
                        ? "Record the winning option"
                        : "Record result"
                  }
                />
              )}

              {/* -- Roster member suggestions -- */}
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

              {/* -- Timer controls (time-based questions) -- */}
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
                      <BonusTimerCapture
                        timer={bonusTimer}
                        currentTimeMs={currentTimeMs}
                        onStart={liveStartTimer}
                        onStop={liveStopTimer}
                        onReset={liveResetTimer}
                        onCapture={() =>
                          applySpecificTimerValueToEventBonus(
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
                          setEventBonusTimer(question.id, alternateTimerId);
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

              {/* -- Fuzzy review panel (host-only) -- */}
              {onAcceptOverride && gameState?.playerAnswerSummaries ? (
                <FuzzyReviewPanel
                  candidates={computeFuzzyCandidatesForAnswer(
                    answer?.answer ?? "",
                    (gameState.playerAnswerSummaries ?? []).map((p) => ({
                      nickname: p.nickname,
                      normalizedNickname: p.normalizedNickname,
                      answer:
                        p.eventBonusAnswers.find(
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
                          p.eventBonusAnswers.find(
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
                      onAcceptOverride(
                        question.id,
                        nn,
                        candidate.confidence,
                      );
                  }}
                  onReject={(nn) => {
                    if (onRejectOverride)
                      onRejectOverride(question.id, nn);
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export const KeyEventBonusSection = React.memo(KeyEventBonusSectionInner);
