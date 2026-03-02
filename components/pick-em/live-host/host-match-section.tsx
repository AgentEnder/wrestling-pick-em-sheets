"use client";

import React, { useCallback, useMemo } from "react";
import { Check, ChevronsUpDown, Pause, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useLiveCard,
  useLivePayload,
  useLivePayloadActions,
  useLiveTimerActions,
  useLiveSetterActions,
  useLiveLockState,
  useLiveGameState,
  useBattleRoyalEntryInputByMatchId,
  useEliminationEntryInputByMatchId,
} from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import { useTimerClock } from "@/hooks/use-timer-clock";
import type { UseRosterSuggestionsReturn } from "@/hooks/use-roster-suggestions";
import {
  formatDuration,
  getTimerElapsedMs,
  toMatchTimerId,
} from "@/lib/pick-em/timer-utils";
import {
  findMatchResult,
  findAnswer,
  toLockKey,
} from "@/lib/pick-em/payload-utils";
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

interface HostMatchSectionProps {
  matchIndex: number;
  roster: UseRosterSuggestionsReturn;
  gameId: string;
}

/* ---- Component ---- */

function HostMatchSectionInner({
  matchIndex,
  roster,
  gameId,
}: HostMatchSectionProps) {
  const card = useLiveCard();
  const payload = useLivePayload();
  const lockState = useLiveLockState();
  const gameState = useLiveGameState();
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
  if (!match || !lockState) return null;

  const matchResult = findMatchResult(payload, match.id);
  const participants = match.participants;
  const winnerName = matchResult?.winnerName ?? "";
  const [winnerComboboxOpen, setWinnerComboboxOpen] = React.useState(false);

  /* Build deduped winner candidates: participants + keyed entrants + player guesses */
  const winnerCandidates = useMemo(() => {
    const entryOrder = matchResult?.battleRoyalEntryOrder ?? [];
    const playerGuesses = (gameState?.playerAnswerSummaries ?? [])
      .map((p) => p.matchPicks.find((mp) => mp.matchId === match.id)?.winnerName)
      .filter((name): name is string => !!name && name.trim().length > 0);
    return Array.from(new Set([...participants, ...entryOrder, ...playerGuesses]));
  }, [participants, matchResult?.battleRoyalEntryOrder, gameState?.playerAnswerSummaries, match.id]);

  /* Timer state */
  const matchTimerId = toMatchTimerId(match.id);
  const hasRunningTimers = useMemo(
    () => payload.timers.some((timer) => timer.isRunning),
    [payload.timers],
  );
  const currentTimeMs = useTimerClock(300, hasRunningTimers);

  const timerById = useMemo(
    () => new Map(payload.timers.map((timer) => [timer.id, timer])),
    [payload.timers],
  );

  const matchTimer = timerById.get(matchTimerId);
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
  const eliminationOrder =
    matchResult?.battleRoyalEliminationOrder ?? [];
  const eliminationEntryInput =
    eliminationEntryInputByMatchId[match.id] ?? "";
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

  /* Lock helpers */
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

  const toggleMatchLock = useCallback(() => {
    if (!lockState) return;
    const existing = lockState.matchLocks[match.id];
    void saveLocks({
      ...lockState,
      matchLocks: {
        ...lockState.matchLocks,
        [match.id]: {
          locked: !(existing?.locked === true),
          source: "host" as const,
        },
      },
    });
  }, [lockState, match.id, saveLocks]);

  const toggleMatchBonusLock = useCallback(
    (questionId: string) => {
      if (!lockState) return;
      const key = toLockKey(match.id, questionId);
      const existing = lockState.matchBonusLocks[key];
      void saveLocks({
        ...lockState,
        matchBonusLocks: {
          ...lockState.matchBonusLocks,
          [key]: {
            locked: !(existing?.locked === true),
            source: "host" as const,
          },
        },
      });
    },
    [lockState, match.id, saveLocks],
  );

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

  /* Fuzzy override handlers */
  const handleAcceptOverride = useCallback(
    (
      type: "score" | "winner",
      questionOrMatchId: string,
      normalizedNickname: string,
      confidence: number,
    ) => {
      const store = useAppStore.getState();
      const currentPayload = store.livePayload;
      if (type === "winner") {
        store.setLivePayload({
          ...currentPayload,
          winnerOverrides: [
            ...currentPayload.winnerOverrides.filter(
              (o) =>
                !(
                  o.matchId === questionOrMatchId &&
                  o.playerNickname.toLowerCase() ===
                    normalizedNickname.toLowerCase()
                ),
            ),
            {
              matchId: questionOrMatchId,
              playerNickname: normalizedNickname,
              accepted: true,
              source: "host" as const,
              confidence,
            },
          ],
        });
      } else {
        store.setLivePayload({
          ...currentPayload,
          scoreOverrides: [
            ...currentPayload.scoreOverrides.filter(
              (o) =>
                !(
                  o.questionId === questionOrMatchId &&
                  o.playerNickname.toLowerCase() ===
                    normalizedNickname.toLowerCase()
                ),
            ),
            {
              questionId: questionOrMatchId,
              playerNickname: normalizedNickname,
              accepted: true,
              source: "host" as const,
              confidence,
            },
          ],
        });
      }
    },
    [],
  );

  const handleRejectOverride = useCallback(
    (
      type: "score" | "winner",
      questionOrMatchId: string,
      normalizedNickname: string,
    ) => {
      const store = useAppStore.getState();
      const currentPayload = store.livePayload;
      if (type === "winner") {
        store.setLivePayload({
          ...currentPayload,
          winnerOverrides: [
            ...currentPayload.winnerOverrides.filter(
              (o) =>
                !(
                  o.matchId === questionOrMatchId &&
                  o.playerNickname.toLowerCase() ===
                    normalizedNickname.toLowerCase()
                ),
            ),
            {
              matchId: questionOrMatchId,
              playerNickname: normalizedNickname,
              accepted: false,
              source: "host" as const,
              confidence: 0,
            },
          ],
        });
      } else {
        store.setLivePayload({
          ...currentPayload,
          scoreOverrides: [
            ...currentPayload.scoreOverrides.filter(
              (o) =>
                !(
                  o.questionId === questionOrMatchId &&
                  o.playerNickname.toLowerCase() ===
                    normalizedNickname.toLowerCase()
                ),
            ),
            {
              questionId: questionOrMatchId,
              playerNickname: normalizedNickname,
              accepted: false,
              source: "host" as const,
              confidence: 0,
            },
          ],
        });
      }
    },
    [],
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          Match {matchIndex + 1}: {match.title || "Untitled Match"}
        </h2>
        <Button
          size="sm"
          variant={
            lockState.matchLocks[match.id]?.locked ? "default" : "outline"
          }
          onClick={toggleMatchLock}
        >
          {lockState.matchLocks[match.id]?.locked
            ? "Unlock Match"
            : "Lock Match"}
        </Button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label>Winner</Label>
          <Popover open={winnerComboboxOpen} onOpenChange={setWinnerComboboxOpen}>
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
            <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
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
                            winnerName === candidate ? "opacity-100" : "opacity-0",
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
          {gameState?.playerAnswerSummaries && winnerName.trim() ? (
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
                payload.winnerOverrides.filter(
                  (o) => o.matchId === match.id,
                ),
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
                  payload.winnerOverrides.filter(
                    (o) => o.matchId === match.id,
                  ),
                );
                const candidate = candidates.find(
                  (c) => c.normalizedNickname === nn,
                );
                if (candidate)
                  handleAcceptOverride(
                    "winner",
                    match.id,
                    nn,
                    candidate.confidence,
                  );
              }}
              onReject={(nn) =>
                handleRejectOverride("winner", match.id, nn)
              }
            />
          ) : null}

          {match.isBattleRoyal ? (
            <div className="space-y-2">
              <Label>Entry Order</Label>
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <Input
                  ref={battleRoyalInputRef}
                  value={battleRoyalEntryInput}
                  onChange={(event) => {
                    setBattleRoyalEntryInput(match.id, event.target.value);
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
                    addBattleRoyalEntrant(battleRoyalEntryInput);
                  }}
                  placeholder="Add entrant"
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

          {match.isEliminationStyle ? (
            <div className="space-y-2">
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
        </div>

        <div className="rounded-md border border-border/70 p-3">
          <p className="text-xs text-muted-foreground">Match Timer</p>
          <p className="font-mono text-lg">{matchTimerElapsed}</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                matchTimer &&
                (matchTimer.isRunning
                  ? liveStopTimer(matchTimerId)
                  : liveStartTimer(matchTimerId))
              }
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
              onClick={() => liveResetTimer(matchTimerId)}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Bonus Questions */}
      {match.bonusQuestions.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium">Bonus Results</p>
          {match.bonusQuestions.map((question) => {
            const answer = findAnswer(
              matchResult?.bonusAnswers ?? [],
              question.id,
            );
            const lockKey = toLockKey(match.id, question.id);
            const isLocked =
              lockState.matchBonusLocks[lockKey]?.locked === true ||
              lockState.matchLocks[match.id]?.locked === true ||
              lockState.globalLocked;
            const isRosterMemberType = question.valueType === "rosterMember";
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
                className="rounded-md border border-border/70 p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Label>{question.question || "Bonus question"}</Label>
                  <Button
                    size="sm"
                    variant={isLocked ? "default" : "outline"}
                    onClick={() => toggleMatchBonusLock(question.id)}
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
                              liveSetMatchBonusAnswer(
                                match.id,
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
                      liveSetMatchBonusAnswer(
                        match.id,
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
                      liveSetMatchBonusAnswer(
                        match.id,
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
                        handleAcceptOverride(
                          "score",
                          question.id,
                          nn,
                          candidate.confidence,
                        );
                    }}
                    onReject={(nn) =>
                      handleRejectOverride("score", question.id, nn)
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

export const HostMatchSection = React.memo(HostMatchSectionInner);
