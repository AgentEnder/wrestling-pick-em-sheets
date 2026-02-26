"use client";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getRosterSuggestions } from "@/lib/client/roster-api";
import { getMatchTypeName } from "@/lib/match-types";
import type {
  BonusQuestion,
  BonusQuestionPool,
  Match,
  MatchType,
} from "@/lib/types";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Copy,
  Crown,
  HelpCircle,
  ListChecks,
  PenLine,
  Plus,
  Swords,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function secondsToTimeDisplay(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function timeDisplayToSeconds(display: string): number | null {
  const trimmed = display.trim();
  if (!trimmed) return null;

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map(Number);
    if (parts.some((p) => Number.isNaN(p))) return null;
    let total = 0;
    for (const part of parts) total = total * 60 + part;
    return total;
  }

  const num = Number.parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
}

function ThresholdTimeInput({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (seconds: number | undefined) => void;
}) {
  const [display, setDisplay] = useState(
    value != null ? secondsToTimeDisplay(value) : "",
  );

  // Sync from external changes (e.g., undo or pool template application)
  useEffect(() => {
    const currentParsed = timeDisplayToSeconds(display);
    if (value == null && !display) return;
    if (value != null && currentParsed != null && Math.abs(currentParsed - value) < 0.5) return;
    setDisplay(value != null ? secondsToTimeDisplay(value) : "");
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center gap-2 max-w-[200px]">
      <Input
        placeholder="MM:SS"
        value={display}
        onChange={(e) => {
          setDisplay(e.target.value);
          const seconds = timeDisplayToSeconds(e.target.value);
          onChange(seconds ?? undefined);
        }}
        className="text-sm"
      />
      {value != null ? (
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          {value}s
        </span>
      ) : null}
    </div>
  );
}

interface MatchEditorProps {
  match: Match;
  index: number;
  totalMatches: number;
  defaultPoints: number;
  promotionName: string;
  participantSuggestions: string[];
  isLoadingParticipantSuggestions: boolean;
  bonusQuestionPools: BonusQuestionPool[];
  matchTypes: MatchType[];
  isLoadingBonusQuestionPools: boolean;
  onChange: (match: Match) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (direction: "up" | "down") => void;
}

export function MatchEditor({
  match,
  index,
  totalMatches,
  defaultPoints,
  promotionName,
  participantSuggestions,
  isLoadingParticipantSuggestions,
  bonusQuestionPools,
  matchTypes,
  isLoadingBonusQuestionPools,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
}: MatchEditorProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [newParticipant, setNewParticipant] = useState("");
  const [newOptionInputs, setNewOptionInputs] = useState<
    Record<string, string>
  >({});
  const [selectedPoolId, setSelectedPoolId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [querySuggestions, setQuerySuggestions] = useState<string[]>([]);
  const [isLoadingQuerySuggestions, setIsLoadingQuerySuggestions] =
    useState(false);

  const effectivePoints = match.points ?? defaultPoints;
  const matchTypeOptions = useMemo(() => {
    if (matchTypes.some((matchType) => matchType.id === match.type)) {
      return matchTypes;
    }

    return [
      {
        id: match.type,
        name: getMatchTypeName(match.type, matchTypes),
        sortOrder: 0,
        isActive: true,
        defaultRuleSetIds: [],
      },
      ...matchTypes,
    ];
  }, [match.type, matchTypes]);
  const participants = match.participants;
  const participantCount = participants.length;
  const matchTypeLabel =
    match.typeLabelOverride.trim() || getMatchTypeName(match.type, matchTypes);
  const rulesLabel = [
    match.isBattleRoyal ? "Timed Entry Rules" : null,
    match.isEliminationStyle ? "Elimination Rules" : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" • ");
  const matchLabel = `${participantCount > 0 ? `${participantCount}-Way` : matchTypeLabel}${rulesLabel ? ` • ${rulesLabel}` : ""}`;
  const normalizedInput = newParticipant.trim().toLowerCase();
  const hasPromotion = promotionName.trim().length > 0;

  function addParticipant(participantName?: string) {
    const name = (participantName ?? newParticipant).trim();
    if (!name) return;

    const hasDuplicate = participants.some(
      (existingParticipant) =>
        existingParticipant.toLowerCase() === name.toLowerCase(),
    );
    if (hasDuplicate) {
      setNewParticipant("");
      return;
    }

    onChange({ ...match, participants: [...match.participants, name] });
    setNewParticipant("");
  }

  function removeParticipant(idx: number) {
    onChange({
      ...match,
      participants: match.participants.filter((_, i) => i !== idx),
    });
  }

  function addBonusQuestion() {
    const q: BonusQuestion = {
      id: crypto.randomUUID(),
      question: "",
      points: null,
      answerType: "write-in",
      options: [],
      valueType: "string",
      gradingRule: "exact",
    };
    onChange({ ...match, bonusQuestions: [...match.bonusQuestions, q] });
  }

  function interpolateQuestionTemplate(questionTemplate: string): string {
    const title = match.title.trim() || "this match";
    const replacements: Record<string, string> = {
      matchTitle: title,
      promotionName: promotionName.trim(),
      participant1: participants[0] ?? "",
      participant2: participants[1] ?? "",
      participant3: participants[2] ?? "",
      matchType: matchTypeLabel.toLowerCase(),
    };

    return questionTemplate.replace(
      /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      (fullMatch, token) => {
        const replacement = replacements[token];
        if (replacement === undefined) return fullMatch;
        return replacement;
      },
    );
  }

  function addBonusQuestionFromTemplate() {
    const selectedPool = bonusQuestionPoolsWithTemplates.find(
      (pool) => pool.id === selectedPoolId,
    );
    const template = selectedPool?.templates.find(
      (item) => item.id === selectedTemplateId,
    );
    if (!template) return;

    const q: BonusQuestion = {
      id: crypto.randomUUID(),
      question: interpolateQuestionTemplate(template.questionTemplate),
      points: template.defaultPoints,
      answerType: template.answerType,
      options:
        template.answerType === "multiple-choice" ? [...template.options] : [],
      valueType: template.valueType,
      gradingRule: template.gradingRule ?? "exact",
    };

    onChange({ ...match, bonusQuestions: [...match.bonusQuestions, q] });
  }

  function updateBonusQuestion(
    qIndex: number,
    updates: Partial<BonusQuestion>,
  ) {
    const updated = match.bonusQuestions.map((q, i) =>
      i === qIndex ? { ...q, ...updates } : q,
    );
    onChange({ ...match, bonusQuestions: updated });
  }

  function removeBonusQuestion(qIndex: number) {
    onChange({
      ...match,
      bonusQuestions: match.bonusQuestions.filter((_, i) => i !== qIndex),
    });
  }

  function addOption(qIndex: number) {
    const q = match.bonusQuestions[qIndex];
    const val = (newOptionInputs[q.id] || "").trim();
    if (!val) return;
    updateBonusQuestion(qIndex, { options: [...q.options, val] });
    setNewOptionInputs((prev) => ({ ...prev, [q.id]: "" }));
  }

  function removeOption(qIndex: number, optIndex: number) {
    const q = match.bonusQuestions[qIndex];
    updateBonusQuestion(qIndex, {
      options: q.options.filter((_, i) => i !== optIndex),
    });
  }

  const combinedSuggestions = useMemo(() => {
    const merged = new Set<string>();
    for (const suggestion of participantSuggestions) {
      merged.add(suggestion);
    }
    for (const suggestion of querySuggestions) {
      merged.add(suggestion);
    }
    return Array.from(merged);
  }, [participantSuggestions, querySuggestions]);

  const filteredSuggestions = useMemo(() => {
    if (!normalizedInput) return [];

    return combinedSuggestions
      .filter((candidate) => candidate.toLowerCase().includes(normalizedInput))
      .filter(
        (candidate) =>
          !participants.some(
            (existingParticipant) =>
              existingParticipant.toLowerCase() === candidate.toLowerCase(),
          ),
      )
      .slice(0, 8);
  }, [combinedSuggestions, normalizedInput, participants]);

  const bonusQuestionPoolsWithTemplates = useMemo(() => {
    const activeRuleSetIds = [
      match.isBattleRoyal ? "timed-entry" : null,
      match.isEliminationStyle ? "elimination" : null,
    ].filter((value): value is "timed-entry" | "elimination" => value !== null);

    return bonusQuestionPools
      .map((pool) => ({
        ...pool,
        templates: pool.templates.filter(
          (template) => template.defaultSection === "match",
        ),
        isRecommended:
          pool.matchTypeIds.includes(match.type) ||
          pool.ruleSetIds.some((ruleSetId) =>
            activeRuleSetIds.includes(ruleSetId),
          ),
      }))
      .filter((pool) => pool.templates.length > 0)
      .sort((a, b) => {
        if (a.isRecommended !== b.isRecommended) {
          return a.isRecommended ? -1 : 1;
        }

        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }

        return a.name.localeCompare(b.name);
      });
  }, [
    bonusQuestionPools,
    match.isBattleRoyal,
    match.isEliminationStyle,
    match.type,
  ]);

  const selectedPool =
    bonusQuestionPoolsWithTemplates.find(
      (pool) => pool.id === selectedPoolId,
    ) ?? null;
  const selectedPoolTemplates = selectedPool?.templates ?? [];

  useEffect(() => {
    if (!hasPromotion || normalizedInput.length < 2) {
      setQuerySuggestions([]);
      setIsLoadingQuerySuggestions(false);
      return;
    }

    let isCancelled = false;
    const timeoutId = setTimeout(async () => {
      setIsLoadingQuerySuggestions(true);
      try {
        const response = await getRosterSuggestions(
          promotionName,
          newParticipant,
        );
        if (!isCancelled) {
          setQuerySuggestions(response.names);
        }
      } catch {
        if (!isCancelled) {
          setQuerySuggestions([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingQuerySuggestions(false);
        }
      }
    }, 220);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [hasPromotion, normalizedInput, newParticipant, promotionName]);

  useEffect(() => {
    if (bonusQuestionPoolsWithTemplates.length === 0) {
      if (selectedPoolId !== "") setSelectedPoolId("");
      if (selectedTemplateId !== "") setSelectedTemplateId("");
      return;
    }

    const resolvedPool = selectedPool ?? bonusQuestionPoolsWithTemplates[0];
    if (resolvedPool.id !== selectedPoolId) {
      setSelectedPoolId(resolvedPool.id);
    }

    const resolvedTemplate =
      resolvedPool.templates.find(
        (template) => template.id === selectedTemplateId,
      ) ?? resolvedPool.templates[0];

    if (resolvedTemplate?.id && resolvedTemplate.id !== selectedTemplateId) {
      setSelectedTemplateId(resolvedTemplate.id);
    }
  }, [
    bonusQuestionPoolsWithTemplates,
    selectedPool,
    selectedPoolId,
    selectedTemplateId,
  ]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center">
          <div className="flex flex-col border-r border-border">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onMove("up")}
              className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors"
              aria-label="Move match up"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              disabled={index === totalMatches - 1}
              onClick={() => onMove("down")}
              className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors"
              aria-label="Move match down"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/50 transition-colors rounded-tr-lg"
            >
              <div className="flex items-center gap-2 shrink-0">
                {match.isBattleRoyal ? (
                  <Crown className="h-4 w-4 text-primary" />
                ) : (
                  <Swords className="h-4 w-4 text-primary" />
                )}
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Match {index + 1}
                </span>
              </div>
              <span className="font-semibold text-card-foreground truncate">
                {match.title || "Untitled Match"}
              </span>
              <span
                className={`ml-auto text-xs shrink-0 ${
                  match.isBattleRoyal ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {matchLabel} &middot; {effectivePoints}pt
                {effectivePoints !== 1 ? "s" : ""}
              </span>
              {isOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
            <div className="grid grid-cols-1 gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-end">
                <div className="flex flex-col gap-1.5">
                  <Label>Match Title / Stipulation</Label>
                  <Input
                    placeholder="e.g. World Heavyweight Championship"
                    value={match.title}
                    onChange={(e) =>
                      onChange({ ...match, title: e.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:w-36 sm:justify-self-end">
                  <Label className="whitespace-nowrap">
                    Points{" "}
                    <span className="text-xs text-muted-foreground">
                      (blank = {defaultPoints})
                    </span>
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    className="w-full"
                    placeholder={String(defaultPoints)}
                    value={match.points ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      onChange({
                        ...match,
                        points:
                          val === "" ? null : Math.max(1, parseInt(val) || 1),
                      });
                    }}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Match Type</Label>
                <Select
                  value={match.type}
                  onValueChange={(value) => {
                    const selectedMatchType = matchTypeOptions.find(
                      (matchType) => matchType.id === value,
                    );
                    const defaultRuleSetIds =
                      selectedMatchType?.defaultRuleSetIds ?? [];
                    const isBattleRoyal =
                      defaultRuleSetIds.includes("timed-entry");
                    const isEliminationStyle =
                      defaultRuleSetIds.includes("elimination");

                    onChange({
                      ...match,
                      type: value,
                      isBattleRoyal,
                      isEliminationStyle,
                      surpriseSlots: isBattleRoyal
                        ? Math.max(match.surpriseSlots, 5)
                        : 0,
                      surpriseEntrantPoints: isBattleRoyal
                        ? match.surpriseEntrantPoints
                        : null,
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {matchTypeOptions.map((matchType) => (
                      <SelectItem key={matchType.id} value={matchType.id}>
                        {matchType.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>
                  Match Type Label Override
                  <span className="ml-1 text-xs text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  placeholder={getMatchTypeName(match.type, matchTypes)}
                  value={match.typeLabelOverride}
                  onChange={(e) =>
                    onChange({ ...match, typeLabelOverride: e.target.value })
                  }
                />
              </div>
              <div className="rounded-md border border-border bg-background/45 px-3 py-2">
                <Label>Rules Mode</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...match,
                        isBattleRoyal: !match.isBattleRoyal,
                        surpriseSlots: !match.isBattleRoyal
                          ? Math.max(match.surpriseSlots, 5)
                          : 0,
                        surpriseEntrantPoints: !match.isBattleRoyal
                          ? match.surpriseEntrantPoints
                          : null,
                      })
                    }
                    className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-center text-xs font-medium transition-colors ${
                      match.isBattleRoyal
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    Timed Entry Rules
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...match,
                        isEliminationStyle: !match.isEliminationStyle,
                      })
                    }
                    className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-center text-xs font-medium transition-colors ${
                      match.isEliminationStyle
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    Elimination Rules
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Battle royal and elimination can both be enabled for the same
                  match.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>
                  Description{" "}
                  <span className="text-xs text-muted-foreground">
                    (optional, shown on sheet)
                  </span>
                </Label>
                <Textarea
                  placeholder="e.g. Tables, Ladders & Chairs -- first to retrieve the briefcase wins"
                  value={match.description}
                  onChange={(e) =>
                    onChange({ ...match, description: e.target.value })
                  }
                  rows={3}
                  className="min-h-24 resize-y"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>
                {match.isBattleRoyal
                  ? "Announced Participants"
                  : "Participants"}
              </Label>
              <div className="flex flex-wrap gap-2">
                {participants.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-sm text-secondary-foreground"
                  >
                    {p}
                    <button
                      type="button"
                      onClick={() => removeParticipant(i)}
                      className="rounded-sm hover:text-destructive transition-colors"
                      aria-label={`Remove ${p}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Add participant or team name..."
                  value={newParticipant}
                  onChange={(e) => setNewParticipant(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addParticipant();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => addParticipant()}
                  className="shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  <span className="sr-only">Add participant</span>
                </Button>
              </div>
              {hasPromotion ? (
                <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">
                    {isLoadingParticipantSuggestions ||
                    isLoadingQuerySuggestions
                      ? "Loading roster suggestions..."
                      : "Autocomplete from your saved promotion roster"}
                  </p>
                  {filteredSuggestions.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {filteredSuggestions.map((candidate) => (
                        <button
                          key={candidate}
                          type="button"
                          onClick={() => addParticipant(candidate)}
                          className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                          {candidate}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Set a promotion in Event Details to enable roster
                  autocomplete.
                </p>
              )}
            </div>

            {match.isBattleRoyal && (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
                  <div className="flex flex-col gap-1.5">
                    <Label>Surprise Entrant Slots</Label>
                    <Input
                      type="number"
                      min={0}
                      max={30}
                      className="w-full"
                      value={match.surpriseSlots}
                      onChange={(e) =>
                        onChange({
                          ...match,
                          surpriseSlots: Math.max(
                            0,
                            parseInt(e.target.value) || 0,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>
                      Points Per Correct Surprise{" "}
                      <span className="text-xs text-muted-foreground">
                        (blank = {defaultPoints})
                      </span>
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      className="w-full"
                      placeholder={String(defaultPoints)}
                      value={match.surpriseEntrantPoints ?? ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        onChange({
                          ...match,
                          surpriseEntrantPoints:
                            value === ""
                              ? null
                              : Math.max(1, parseInt(value, 10) || 1),
                        });
                      }}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Write-in lines on the sheet for guessing surprise entrants.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-primary" />
                <Label>Bonus Questions</Label>
              </div>
              <div className="rounded-md border border-border/80 bg-background/45 p-3">
                <div className="flex items-center gap-2">
                  <WandSparkles className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium text-foreground">
                    Insert from pool template
                  </p>
                </div>
                {isLoadingBonusQuestionPools ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Loading bonus question pools...
                  </p>
                ) : bonusQuestionPoolsWithTemplates.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No active templates are available yet.
                  </p>
                ) : (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Select
                      value={selectedPoolId}
                      onValueChange={(value) => {
                        setSelectedPoolId(value);
                        const nextPool = bonusQuestionPoolsWithTemplates.find(
                          (pool) => pool.id === value,
                        );
                        setSelectedTemplateId(nextPool?.templates[0]?.id ?? "");
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select pool" />
                      </SelectTrigger>
                      <SelectContent>
                        {bonusQuestionPoolsWithTemplates.map((pool) => (
                          <SelectItem key={pool.id} value={pool.id}>
                            {pool.name}
                            {pool.isRecommended ? " (Suggested)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedTemplateId}
                      onValueChange={setSelectedTemplateId}
                      disabled={selectedPoolTemplates.length === 0}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select template" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedPoolTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addBonusQuestionFromTemplate}
                      disabled={!selectedTemplateId}
                    >
                      Add Template
                    </Button>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Placeholders supported: {`{{matchTitle}}`},{" "}
                  {`{{participant1}}`}, {`{{participant2}}`},{" "}
                  {`{{participant3}}`}, {`{{promotionName}}`}, {`{{matchType}}`}
                  .
                </p>
              </div>
              {match.bonusQuestions.map((q, qi) => (
                <div
                  key={q.id}
                  className="rounded-md border border-border bg-secondary/30 p-3 flex flex-col gap-2"
                >
                  <div className="flex items-start gap-2">
                    <Input
                      placeholder="e.g. How will the match end?"
                      value={q.question}
                      onChange={(e) =>
                        updateBonusQuestion(qi, { question: e.target.value })
                      }
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      min={1}
                      placeholder={String(defaultPoints)}
                      value={q.points ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateBonusQuestion(qi, {
                          points:
                            val === "" ? null : Math.max(1, parseInt(val) || 1),
                        });
                      }}
                      className="w-20"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeBonusQuestion(qi)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                      <span className="sr-only">Remove question</span>
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 sm:items-center">
                    <span className="text-xs text-muted-foreground">
                      Answer type:
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateBonusQuestion(qi, {
                            answerType: "write-in",
                            options: [],
                          })
                        }
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          q.answerType === "write-in"
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        }`}
                      >
                        <PenLine className="h-3 w-3" />
                        Write-in
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateBonusQuestion(qi, {
                            answerType: "multiple-choice",
                          })
                        }
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          q.answerType === "multiple-choice"
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        }`}
                      >
                        <ListChecks className="h-3 w-3" />
                        Multiple Choice
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateBonusQuestion(qi, {
                            answerType: "threshold",
                            options: [],
                            valueType:
                              q.valueType === "string" ||
                              q.valueType === "rosterMember"
                                ? "numerical"
                                : q.valueType,
                          })
                        }
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          q.answerType === "threshold"
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        }`}
                      >
                        <ArrowUpDown className="h-3 w-3" />
                        Threshold
                      </button>
                    </div>

                    <span className="text-xs text-muted-foreground">
                      Value type:
                    </span>
                    <div className="flex items-center gap-1 rounded-md border border-border bg-background/50 p-1 w-fit">
                      {q.answerType !== "threshold" && (
                        <button
                          type="button"
                          onClick={() =>
                            updateBonusQuestion(qi, {
                              valueType: "string",
                              gradingRule: "exact",
                            })
                          }
                          className={`rounded px-2 py-1 text-xs transition-colors ${
                            q.valueType === "string"
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Standard
                        </button>
                      )}
                      {q.answerType !== "threshold" && (
                        <button
                          type="button"
                          onClick={() =>
                            updateBonusQuestion(qi, {
                              valueType: "rosterMember",
                              gradingRule: "exact",
                            })
                          }
                          className={`rounded px-2 py-1 text-xs transition-colors ${
                            q.valueType === "rosterMember"
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Roster
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          updateBonusQuestion(qi, {
                            valueType: "time",
                            gradingRule: q.gradingRule ?? "exact",
                          })
                        }
                        className={`rounded px-2 py-1 text-xs transition-colors ${
                          q.valueType === "time"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Time
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateBonusQuestion(qi, {
                            valueType: "numerical",
                            gradingRule: q.gradingRule ?? "exact",
                          })
                        }
                        className={`rounded px-2 py-1 text-xs transition-colors ${
                          q.valueType === "numerical"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Count
                      </button>
                    </div>

                    {(q.valueType === "time" ||
                      q.valueType === "numerical") && (
                      <>
                        <span className="text-xs text-muted-foreground">
                          Grading:
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {[
                            { value: "exact", label: "Exact" },
                            { value: "closest", label: "Closest" },
                            { value: "atOrAbove", label: "At/Above" },
                            { value: "atOrBelow", label: "At/Below" },
                          ].map((rule) => (
                            <button
                              key={rule.value}
                              type="button"
                              onClick={() =>
                                updateBonusQuestion(qi, {
                                  gradingRule:
                                    rule.value as BonusQuestion["gradingRule"],
                                })
                              }
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                                (q.gradingRule ?? "exact") === rule.value
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                              }`}
                            >
                              {rule.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {q.answerType === "threshold" && (
                      <>
                        <span className="text-xs text-muted-foreground">
                          Threshold:
                        </span>
                        {q.valueType === "time" ? (
                          <ThresholdTimeInput
                            value={q.thresholdValue}
                            onChange={(seconds) =>
                              updateBonusQuestion(qi, {
                                thresholdValue: seconds,
                              })
                            }
                          />
                        ) : (
                          <Input
                            type="number"
                            step="any"
                            placeholder="Threshold value"
                            value={q.thresholdValue ?? ""}
                            onChange={(e) =>
                              updateBonusQuestion(qi, {
                                thresholdValue: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              })
                            }
                            className="text-sm max-w-[200px]"
                          />
                        )}
                        <span className="text-xs text-muted-foreground">
                          Labels:
                        </span>
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="Over"
                            value={q.thresholdLabels?.[0] ?? ""}
                            onChange={(e) =>
                              updateBonusQuestion(qi, {
                                thresholdLabels: [
                                  e.target.value || "Over",
                                  q.thresholdLabels?.[1] ?? "Under",
                                ],
                              })
                            }
                            className="text-sm max-w-[120px]"
                          />
                          <span className="text-xs text-muted-foreground">
                            /
                          </span>
                          <Input
                            placeholder="Under"
                            value={q.thresholdLabels?.[1] ?? ""}
                            onChange={(e) =>
                              updateBonusQuestion(qi, {
                                thresholdLabels: [
                                  q.thresholdLabels?.[0] ?? "Over",
                                  e.target.value || "Under",
                                ],
                              })
                            }
                            className="text-sm max-w-[120px]"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {q.answerType === "multiple-choice" && (
                    <div className="flex flex-col gap-1.5 pl-2">
                      <div className="flex flex-wrap gap-1.5">
                        {q.options.map((opt, oi) => (
                          <span
                            key={oi}
                            className="inline-flex items-center gap-1 rounded bg-card px-2 py-0.5 text-xs text-card-foreground border border-border"
                          >
                            {opt}
                            <button
                              type="button"
                              onClick={() => removeOption(qi, oi)}
                              className="hover:text-destructive transition-colors"
                              aria-label={`Remove option ${opt}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Add answer option..."
                          value={newOptionInputs[q.id] || ""}
                          onChange={(e) =>
                            setNewOptionInputs((prev) => ({
                              ...prev,
                              [q.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addOption(qi);
                            }
                          }}
                          className="text-sm"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => addOption(qi)}
                          className="shrink-0"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addBonusQuestion}
                className="self-start"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Bonus Question
              </Button>
            </div>

            <div className="flex justify-between border-t border-border pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDuplicate}
                className="text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-4 w-4 mr-1" />
                Duplicate
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemove}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Remove Match
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
