"use client";

import React, { useCallback, useMemo } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useLiveCard,
  useLivePayload,
  useLivePayloadActions,
  useLiveLockState,
  useLiveGameState,
} from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import type { UseRosterSuggestionsReturn } from "@/hooks/use-roster-suggestions";
import { findAnswer } from "@/lib/pick-em/payload-utils";
import { filterRosterMemberSuggestions } from "@/lib/pick-em/text-utils";
import { updateLiveGameLocks } from "@/lib/client/live-games-api";
import type { LiveGameLockState } from "@/lib/types";
import {
  FuzzyReviewPanel,
  computeFuzzyCandidatesForAnswer,
} from "./fuzzy-match-review-panel";

/* ---- Helpers ---- */

function parseValueForDisplay(
  value: string,
  valueType: string,
): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (valueType === "time" && trimmed.includes(":")) {
    const parts = trimmed.split(":").map(Number);
    if (parts.some((p) => Number.isNaN(p))) return null;
    let total = 0;
    for (const part of parts) total = total * 60 + part;
    return total;
  }
  const num = Number.parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
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
              {question.answerType === "threshold" &&
              question.thresholdValue != null &&
              (answer?.answer ?? "").trim() ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {(() => {
                    const labels = question.thresholdLabels ?? [
                      "Over",
                      "Under",
                    ];
                    const parsed = parseValueForDisplay(
                      answer?.answer ?? "",
                      question.valueType,
                    );
                    if (parsed === null) return "Enter a valid value";
                    return parsed > question.thresholdValue
                      ? `Result: ${labels[0]} (${parsed} > ${question.thresholdValue})`
                      : `Result: ${labels[1]} (${parsed} \u2264 ${question.thresholdValue})`;
                  })()}
                </p>
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
