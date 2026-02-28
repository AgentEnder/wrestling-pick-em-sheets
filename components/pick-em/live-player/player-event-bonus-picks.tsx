"use client";

import React, { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  LivePlayerAnswer,
  LivePlayerPicksPayload,
} from "@/lib/types";
import type { LiveGameMeResponse, LiveGameStateResponse } from "@/lib/client/live-games-api";
import type { UseRosterSuggestionsReturn } from "@/hooks/use-roster-suggestions";
import { filterRosterMemberSuggestions, normalizeText } from "@/lib/pick-em/text-utils";

/* ---- Local helpers ---- */

function findAnswer(
  answers: LivePlayerAnswer[],
  questionId: string,
): LivePlayerAnswer | null {
  return answers.find((answer) => answer.questionId === questionId) ?? null;
}

/* ---- Props ---- */

interface PlayerEventBonusPicksProps {
  card: LiveGameStateResponse["card"];
  picks: LivePlayerPicksPayload;
  locks: LiveGameMeResponse["locks"];
  roster: UseRosterSuggestionsReturn;
  onSetEventBonusAnswer: (questionId: string, answer: string) => void;
}

/* ---- Component ---- */

function PlayerEventBonusPicksInner({
  card,
  picks,
  locks,
  roster,
  onSetEventBonusAnswer,
}: PlayerEventBonusPicksProps) {
  const eventParticipantCandidates = useMemo(
    () =>
      Array.from(
        new Set(card.matches.flatMap((match) => match.participants)),
      ),
    [card.matches],
  );

  if (card.eventBonusQuestions.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">Event Bonus Picks</h2>
      <div className="mt-3 space-y-2">
        {card.eventBonusQuestions.map((question) => {
          const answer = findAnswer(picks.eventBonusAnswers, question.id);
          const isLocked =
            locks.eventBonusLocks[question.id] === true ||
            locks.globalLocked;
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
              className="space-y-1.5 rounded-md border border-border/70 p-2.5"
            >
              <Label>{question.question || "Event bonus"}</Label>
              {question.answerType === "threshold" ? (
                <div className="flex gap-2">
                  {(question.thresholdLabels ?? ["Over", "Under"]).map(
                    (label) => (
                      <button
                        key={label}
                        type="button"
                        disabled={isLocked}
                        onClick={() =>
                          onSetEventBonusAnswer(question.id, label)
                        }
                        className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                          normalizeText(answer?.answer ?? "") ===
                          normalizeText(label)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-card-foreground hover:border-primary/50"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>
              ) : (
                <>
                  <Input
                    value={answer?.answer ?? ""}
                    onChange={(event) => {
                      onSetEventBonusAnswer(question.id, event.target.value);
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
                    disabled={isLocked}
                    placeholder={
                      isRosterMemberType
                        ? "Start typing a roster member..."
                        : "Your answer"
                    }
                  />
                  {isRosterMemberType &&
                  ((roster.activeFieldKey === rosterFieldKey &&
                    roster.isLoading) ||
                    filteredRosterSuggestions.length > 0) ? (
                    <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2">
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
                                onSetEventBonusAnswer(question.id, candidate)
                              }
                              disabled={isLocked}
                              className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
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
              {isLocked ? (
                <p className="text-xs text-amber-500">Locked</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export const PlayerEventBonusPicks = React.memo(PlayerEventBonusPicksInner);
