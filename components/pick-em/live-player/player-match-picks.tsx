"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";

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
import type {
  LivePlayerAnswer,
  LivePlayerMatchPick,
  LivePlayerPicksPayload,
} from "@/lib/types";
import type { LiveGameMeResponse, LiveGameStateResponse } from "@/lib/client/live-games-api";
import type { UseRosterSuggestionsReturn } from "@/hooks/use-roster-suggestions";
import { filterRosterMemberSuggestions, normalizeText } from "@/lib/pick-em/text-utils";

/* ---- Local helpers ---- */

function findMatchPick(
  picks: LivePlayerPicksPayload,
  matchId: string,
): LivePlayerMatchPick | null {
  return picks.matchPicks.find((pick) => pick.matchId === matchId) ?? null;
}

function findAnswer(
  answers: LivePlayerAnswer[],
  questionId: string,
): LivePlayerAnswer | null {
  return answers.find((answer) => answer.questionId === questionId) ?? null;
}

function toLockKey(matchId: string, questionId: string): string {
  return `${matchId}:${questionId}`;
}

/* ---- Props ---- */

interface PlayerMatchPicksProps {
  matchIndex: number;
  match: LiveGameStateResponse["card"]["matches"][number];
  picks: LivePlayerPicksPayload;
  locks: LiveGameMeResponse["locks"];
  roster: UseRosterSuggestionsReturn;
  battleRoyalEntryInput: string;
  onSetMatchWinner: (matchId: string, winnerName: string) => void;
  onAddBattleRoyalEntrant: (matchId: string, entrantName: string) => void;
  onRemoveBattleRoyalEntrant: (matchId: string, entrantIndex: number) => void;
  onSetBattleRoyalEntryInput: (matchId: string, value: string) => void;
  onSetMatchBonusAnswer: (
    matchId: string,
    questionId: string,
    answer: string,
  ) => void;
}

/* ---- Component ---- */

function PlayerMatchPicksInner({
  matchIndex,
  match,
  picks,
  locks,
  roster,
  battleRoyalEntryInput,
  onSetMatchWinner,
  onAddBattleRoyalEntrant,
  onRemoveBattleRoyalEntrant,
  onSetBattleRoyalEntryInput,
  onSetMatchBonusAnswer,
}: PlayerMatchPicksProps) {
  const matchPick = findMatchPick(picks, match.id);
  const isMatchLocked =
    locks.matchLocks[match.id] === true || locks.globalLocked;
  const winnerInParticipants = match.participants.some(
    (p) => p === matchPick?.winnerName,
  );
  const winnerSelectValue = matchPick?.winnerName
    ? winnerInParticipants
      ? matchPick.winnerName
      : "__custom__"
    : "__none__";
  const battleRoyalInputRef = React.useRef<HTMLInputElement>(null);
  const battleRoyalEntrants = matchPick?.battleRoyalEntrants ?? [];
  const battleRoyalFieldKey = `battleRoyal:${match.id}`;
  const isSurpriseEntrantsFull =
    battleRoyalEntrants.length >= match.surpriseSlots;
  const normalizedBattleRoyalEntryInput = battleRoyalEntryInput
    .trim()
    .toLowerCase();
  const battleRoyalSuggestions =
    roster.activeFieldKey === battleRoyalFieldKey ? roster.suggestions : [];
  const battleRoyalCandidates = match.isBattleRoyal
    ? Array.from(
        new Set([...match.participants, ...battleRoyalSuggestions]),
      )
    : [];
  const filteredBattleRoyalSuggestions = normalizedBattleRoyalEntryInput
    ? battleRoyalCandidates
        .filter((candidate) =>
          candidate.toLowerCase().includes(normalizedBattleRoyalEntryInput),
        )
        .filter(
          (candidate) =>
            !battleRoyalEntrants.some(
              (entrant) =>
                entrant.toLowerCase() === candidate.toLowerCase(),
            ),
        )
        .slice(0, 8)
    : [];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">
          Match {matchIndex + 1}: {match.title || "Untitled Match"}
        </h2>
        {isMatchLocked ? (
          <span className="text-xs text-amber-500">Locked</span>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>Winner</Label>
        <Select
          value={winnerSelectValue}
          onValueChange={(value) => {
            if (value === "__none__") {
              onSetMatchWinner(match.id, "");
              return;
            }
            if (value === "__custom__") {
              const current =
                matchPick?.winnerName && !winnerInParticipants
                  ? matchPick.winnerName
                  : "";
              onSetMatchWinner(match.id, current);
              return;
            }
            onSetMatchWinner(match.id, value);
          }}
          disabled={isMatchLocked}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select winner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Unanswered</SelectItem>
            {match.participants.map((participant) => (
              <SelectItem key={participant} value={participant}>
                {participant}
              </SelectItem>
            ))}
            {match.isBattleRoyal ? (
              <SelectItem value="__custom__">
                Other (type name)...
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        {winnerSelectValue === "__custom__" ? (
          <div className="space-y-1">
            <Label>Custom winner</Label>
            <Input
              value={matchPick?.winnerName ?? ""}
              onChange={(event) =>
                onSetMatchWinner(match.id, event.target.value)
              }
              disabled={isMatchLocked}
              placeholder="Type winner name"
            />
          </div>
        ) : null}

        {match.isBattleRoyal ? (
          <div className="space-y-2">
            <Label>
              Surprise Entrants ({battleRoyalEntrants.length}/
              {match.surpriseSlots})
            </Label>
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <Input
                ref={battleRoyalInputRef}
                value={battleRoyalEntryInput}
                onChange={(event) => {
                  onSetBattleRoyalEntryInput(match.id, event.target.value);
                  roster.setActiveInput(
                    battleRoyalFieldKey,
                    event.target.value,
                  );
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
                  if (isMatchLocked || isSurpriseEntrantsFull) return;
                  onAddBattleRoyalEntrant(match.id, battleRoyalEntryInput);
                }}
                disabled={isMatchLocked || isSurpriseEntrantsFull}
                placeholder="Add entrant"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  onAddBattleRoyalEntrant(match.id, battleRoyalEntryInput)
                }
                disabled={isMatchLocked || isSurpriseEntrantsFull}
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
                          onAddBattleRoyalEntrant(match.id, candidate);
                          requestAnimationFrame(() => {
                            battleRoyalInputRef.current?.focus();
                          });
                        }}
                        disabled={isMatchLocked || isSurpriseEntrantsFull}
                        className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {candidate}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {battleRoyalEntrants.length > 0 ? (
              <div className="space-y-1.5 rounded-md border border-border/70 bg-background/35 p-2.5">
                {battleRoyalEntrants.map((entrant, entrantIndex) => (
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
                      onClick={() =>
                        onRemoveBattleRoyalEntrant(match.id, entrantIndex)
                      }
                      disabled={isMatchLocked}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Remove entrant</span>
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {match.bonusQuestions.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium">Bonus Picks</p>
          {match.bonusQuestions.map((question) => {
            const answer = findAnswer(
              matchPick?.bonusAnswers ?? [],
              question.id,
            );
            const isLocked =
              locks.matchBonusLocks[toLockKey(match.id, question.id)] ===
                true || isMatchLocked;
            const isRosterMemberType =
              question.valueType === "rosterMember";
            const rosterFieldKey = `matchBonus:${match.id}:${question.id}`;
            const rosterQuerySuggestions =
              roster.activeFieldKey === rosterFieldKey
                ? roster.suggestions
                : [];
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
                className="space-y-1.5 rounded-md border border-border/70 p-2.5"
              >
                <Label>{question.question || "Bonus question"}</Label>
                {question.answerType === "threshold" ? (
                  <div className="flex gap-2">
                    {(question.thresholdLabels ?? ["Over", "Under"]).map(
                      (label) => (
                        <button
                          key={label}
                          type="button"
                          disabled={isLocked}
                          onClick={() =>
                            onSetMatchBonusAnswer(
                              match.id,
                              question.id,
                              label,
                            )
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
                        onSetMatchBonusAnswer(
                          match.id,
                          question.id,
                          event.target.value,
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
                                  onSetMatchBonusAnswer(
                                    match.id,
                                    question.id,
                                    candidate,
                                  )
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
      ) : null}
    </section>
  );
}

export const PlayerMatchPicks = React.memo(PlayerMatchPicksInner);
