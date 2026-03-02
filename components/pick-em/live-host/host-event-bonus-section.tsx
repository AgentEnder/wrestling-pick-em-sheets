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
  formatDuration,
  getTimerElapsedMs,
  toEventBonusTimerId,
} from "@/lib/pick-em/timer-utils";
import { useTimerClock } from "@/hooks/use-timer-clock";
import {
  useLiveCard,
  useLivePayload,
  useLivePayloadActions,
  useLiveTimerActions,
  useLiveLockState,
  useLiveGameState,
} from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import type { UseRosterSuggestionsReturn } from "@/hooks/use-roster-suggestions";
import { findAnswer } from "@/lib/pick-em/payload-utils";
import { filterRosterMemberSuggestions, normalizeText } from "@/lib/pick-em/text-utils";
import { updateLiveGameLocks } from "@/lib/client/live-games-api";
import type { LiveGameLockState } from "@/lib/types";
import {
  FuzzyReviewPanel,
  computeFuzzyCandidatesForAnswer,
} from "./fuzzy-match-review-panel";

/* ---- Helpers ---- */

function formatThresholdValue(seconds: number, valueType: string): string {
  if (valueType === "time") {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  return String(seconds);
}

/* ---- Props ---- */

interface HostEventBonusSectionProps {
  roster: UseRosterSuggestionsReturn;
  gameId: string;
}

/* ---- Component ---- */

function HostEventBonusSectionInner({
  roster,
  gameId,
}: HostEventBonusSectionProps) {
  const card = useLiveCard();
  const payload = useLivePayload();
  const lockState = useLiveLockState();
  const gameState = useLiveGameState();
  const { liveSetEventBonusAnswer } = useLivePayloadActions();
  const { liveStartTimer, liveStopTimer, liveResetTimer } =
    useLiveTimerActions();

  const hasRunningTimers = useMemo(
    () => payload.timers.some((timer) => timer.isRunning),
    [payload.timers],
  );
  const currentTimeMs = useTimerClock(300, hasRunningTimers);

  const timerById = useMemo(
    () => new Map(payload.timers.map((t) => [t.id, t])),
    [payload.timers],
  );

  const eventBonusQuestions = card?.eventBonusQuestions ?? [];
  const eventParticipantCandidates = useMemo(
    () =>
      Array.from(
        new Set(
          (card?.matches ?? []).flatMap((match) => match.participants),
        ),
      ),
    [card?.matches],
  );

  /* Lock helper */
  const saveLocks = useCallback(
    async (next: LiveGameLockState) => {
      try {
        const updated = await updateLiveGameLocks(gameId, next);
        const store = useAppStore.getState();
        store.setLockState(updated.lockState);
        store.setGames([updated]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update locks";
        toast.error(message);
      }
    },
    [gameId],
  );

  const toggleEventBonusLock = useCallback(
    (questionId: string) => {
      if (!lockState) return;
      const existing = lockState.eventBonusLocks[questionId];
      void saveLocks({
        ...lockState,
        eventBonusLocks: {
          ...lockState.eventBonusLocks,
          [questionId]: {
            locked: !(existing?.locked === true),
            source: "host" as const,
          },
        },
      });
    },
    [lockState, saveLocks],
  );

  /* Fuzzy override handlers */
  const handleAcceptOverride = useCallback(
    (
      questionId: string,
      normalizedNickname: string,
      confidence: number,
    ) => {
      const store = useAppStore.getState();
      const currentPayload = store.livePayload;
      store.setLivePayload({
        ...currentPayload,
        scoreOverrides: [
          ...currentPayload.scoreOverrides.filter(
            (o) =>
              !(
                o.questionId === questionId &&
                o.playerNickname.toLowerCase() ===
                  normalizedNickname.toLowerCase()
              ),
          ),
          {
            questionId,
            playerNickname: normalizedNickname,
            accepted: true,
            source: "host" as const,
            confidence,
          },
        ],
      });
    },
    [],
  );

  const handleRejectOverride = useCallback(
    (questionId: string, normalizedNickname: string) => {
      const store = useAppStore.getState();
      const currentPayload = store.livePayload;
      store.setLivePayload({
        ...currentPayload,
        scoreOverrides: [
          ...currentPayload.scoreOverrides.filter(
            (o) =>
              !(
                o.questionId === questionId &&
                o.playerNickname.toLowerCase() ===
                  normalizedNickname.toLowerCase()
              ),
          ),
          {
            questionId,
            playerNickname: normalizedNickname,
            accepted: false,
            source: "host" as const,
            confidence: 0,
          },
        ],
      });
    },
    [],
  );

  if (eventBonusQuestions.length === 0 || !lockState) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">Event Bonus Results</h2>
      <div className="mt-3 space-y-2">
        {eventBonusQuestions.map((question) => {
          const answer = findAnswer(payload.eventBonusAnswers, question.id);
          const isLocked =
            lockState.eventBonusLocks[question.id]?.locked === true ||
            lockState.globalLocked;
          const isRosterMemberType = question.valueType === "rosterMember";
          const rosterFieldKey = `eventBonus:${question.id}`;
          const rosterQuerySuggestions =
            roster.activeFieldKey === rosterFieldKey
              ? roster.suggestions
              : [];
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

          const bonusTimerId = toEventBonusTimerId(question.id);
          const bonusTimer = timerById.get(bonusTimerId) ?? null;
          const bonusTimerElapsed = bonusTimer
            ? formatDuration(getTimerElapsedMs(bonusTimer, currentTimeMs))
            : "--:--";

          return (
            <div
              key={question.id}
              className="rounded-md border border-border/70 p-3"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <Label>{question.question || "Event bonus"}</Label>
                <Button
                  size="sm"
                  variant={isLocked ? "default" : "outline"}
                  onClick={() => toggleEventBonusLock(question.id)}
                >
                  {isLocked ? "Unlock" : "Lock"}
                </Button>
              </div>
              {question.answerType === "threshold" ? (
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    {(question.thresholdLabels ?? ["Over", "Under"]).map(
                      (label) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() =>
                            liveSetEventBonusAnswer(
                              question.id,
                              label,
                              false,
                            )
                          }
                          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                            normalizeText(answer?.answer ?? "") ===
                            normalizeText(label)
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-card-foreground hover:border-primary/50"
                          }`}
                        >
                          {label}
                        </button>
                      ),
                    )}
                  </div>
                  {question.thresholdValue != null ? (
                    <p className="text-xs text-muted-foreground">
                      Threshold: {formatThresholdValue(
                        question.thresholdValue,
                        question.valueType,
                      )}
                    </p>
                  ) : null}
                </div>
              ) : question.answerType === "multiple-choice" &&
                question.options.length > 0 ? (
                <Select
                  value={answer?.answer || "__none__"}
                  onValueChange={(value) =>
                    liveSetEventBonusAnswer(
                      question.id,
                      value === "__none__" ? "" : value,
                      false,
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select answer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unanswered</SelectItem>
                    {question.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={answer?.answer ?? ""}
                  onChange={(event) => {
                    liveSetEventBonusAnswer(
                      question.id,
                      event.target.value,
                      false,
                    );
                    roster.setActiveInput(rosterFieldKey, event.target.value);
                  }}
                  onFocus={() =>
                    roster.setActiveInput(rosterFieldKey, answer?.answer ?? "")
                  }
                  placeholder={
                    isRosterMemberType
                      ? "Start typing a roster member..."
                      : "Key answer"
                  }
                />
              )}
              {question.valueType === "time" ? (
                <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-2.5">
                  <p className="text-xs text-muted-foreground">Question Timer</p>
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
                      onClick={() => bonusTimer && liveResetTimer(bonusTimer.id)}
                      disabled={!bonusTimer}
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span className="sr-only">Reset bonus timer</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (!bonusTimer) return;
                        const elapsedMs = getTimerElapsedMs(bonusTimer, Date.now());
                        const timerValue = formatDuration(elapsedMs);
                        liveSetEventBonusAnswer(question.id, timerValue, true);
                      }}
                      disabled={!bonusTimer}
                    >
                      <Timer className="mr-1 h-4 w-4" />
                      Capture Time
                    </Button>
                  </div>
                </div>
              ) : null}
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
                              false,
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
              {gameState?.playerAnswerSummaries ? (
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
                      handleAcceptOverride(
                        question.id,
                        nn,
                        candidate.confidence,
                      );
                  }}
                  onReject={(nn) => handleRejectOverride(question.id, nn)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export const HostEventBonusSection = React.memo(HostEventBonusSectionInner);
