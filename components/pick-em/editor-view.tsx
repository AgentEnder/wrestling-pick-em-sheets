"use client";

import { useEffect, useMemo, useState } from "react";
import { EventSettings } from "@/components/event-settings";
import { MatchEditor } from "@/components/match-editor";
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
import { useAppStore } from "@/stores/app-store";
import {
  useMatchIds,
  useMatchActions,
  useEventBonusQuestions,
  useEventBonusQuestionsAction,
  useSuggestions,
  useEditorActions,
  useHasMatches,
} from "@/stores/selectors";
import type { BonusQuestion } from "@/lib/types";
import {
  HelpCircle,
  ListChecks,
  PenLine,
  Plus,
  Swords,
  WandSparkles,
  X,
} from "lucide-react";

function createEmptyBonusQuestion(): BonusQuestion {
  return {
    id: crypto.randomUUID(),
    question: "",
    points: null,
    answerType: "write-in",
    options: [],
    valueType: "string",
    gradingRule: "exact",
  };
}

export function EditorView() {
  const promotionName = useAppStore((s) => s.promotionName);
  const eventName = useAppStore((s) => s.eventName);
  const defaultPoints = useAppStore((s) => s.defaultPoints);

  const matchIds = useMatchIds();
  const hasMatches = useHasMatches();
  const { addMatch } = useMatchActions();

  const eventBonusQuestions = useEventBonusQuestions();
  const setEventBonusQuestions = useEventBonusQuestionsAction();

  const {
    isLoadingBonusQuestionPools,
    bonusQuestionPools,
  } = useSuggestions();
  const { loadSuggestions, loadBonusQuestionPools, loadMatchTypes } =
    useEditorActions();

  const [selectedEventPoolId, setSelectedEventPoolId] = useState("");
  const [selectedEventTemplateId, setSelectedEventTemplateId] = useState("");
  const [eventOptionInputs, setEventOptionInputs] = useState<
    Record<string, string>
  >({});

  const eventBonusPools = useMemo(
    () =>
      bonusQuestionPools
        .map((pool) => ({
          ...pool,
          templates: pool.templates.filter(
            (template) => template.defaultSection === "event",
          ),
        }))
        .filter((pool) => pool.templates.length > 0),
    [bonusQuestionPools],
  );

  const selectedEventPool =
    eventBonusPools.find((pool) => pool.id === selectedEventPoolId) ?? null;
  const selectedEventTemplates = selectedEventPool?.templates ?? [];

  useEffect(() => {
    void loadBonusQuestionPools();
  }, [loadBonusQuestionPools]);

  useEffect(() => {
    void loadMatchTypes();
  }, [loadMatchTypes]);

  useEffect(() => {
    const trimmed = promotionName.trim();
    if (!trimmed) return;

    const timeoutId = setTimeout(() => {
      void loadSuggestions(trimmed);
    }, 300);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [promotionName, loadSuggestions]);

  useEffect(() => {
    if (eventBonusPools.length === 0) {
      if (selectedEventPoolId !== "") setSelectedEventPoolId("");
      if (selectedEventTemplateId !== "") setSelectedEventTemplateId("");
      return;
    }

    const resolvedPool = selectedEventPool ?? eventBonusPools[0];
    if (resolvedPool.id !== selectedEventPoolId) {
      setSelectedEventPoolId(resolvedPool.id);
    }

    const resolvedTemplate =
      resolvedPool.templates.find(
        (template) => template.id === selectedEventTemplateId,
      ) ?? resolvedPool.templates[0];

    if (
      resolvedTemplate?.id &&
      resolvedTemplate.id !== selectedEventTemplateId
    ) {
      setSelectedEventTemplateId(resolvedTemplate.id);
    }
  }, [
    eventBonusPools,
    selectedEventPool,
    selectedEventPoolId,
    selectedEventTemplateId,
  ]);

  function updateEventBonusQuestion(
    index: number,
    updates: Partial<BonusQuestion>,
  ) {
    const updated = eventBonusQuestions.map((question, questionIndex) =>
      questionIndex === index ? { ...question, ...updates } : question,
    );

    setEventBonusQuestions(updated);
  }

  function removeEventBonusQuestion(index: number) {
    setEventBonusQuestions(
      eventBonusQuestions.filter(
        (_, questionIndex) => questionIndex !== index,
      ),
    );
  }

  function addEventBonusQuestion() {
    setEventBonusQuestions([
      ...eventBonusQuestions,
      createEmptyBonusQuestion(),
    ]);
  }

  function addEventOption(questionIndex: number) {
    const question = eventBonusQuestions[questionIndex];
    const value = (eventOptionInputs[question.id] || "").trim();
    if (!value) return;

    updateEventBonusQuestion(questionIndex, {
      options: [...question.options, value],
    });

    setEventOptionInputs((prev) => ({ ...prev, [question.id]: "" }));
  }

  function removeEventOption(questionIndex: number, optionIndex: number) {
    const question = eventBonusQuestions[questionIndex];
    updateEventBonusQuestion(questionIndex, {
      options: question.options.filter((_, index) => index !== optionIndex),
    });
  }

  function interpolateEventTemplate(templateText: string): string {
    return templateText
      .replace(/\{\{\s*promotionName\s*\}\}/g, promotionName.trim())
      .replace(/\{\{\s*eventName\s*\}\}/g, eventName.trim());
  }

  function addEventBonusFromTemplate() {
    const template = selectedEventTemplates.find(
      (item) => item.id === selectedEventTemplateId,
    );
    if (!template) return;

    const question: BonusQuestion = {
      id: crypto.randomUUID(),
      question: interpolateEventTemplate(template.questionTemplate),
      points: template.defaultPoints,
      answerType: template.answerType,
      options:
        template.answerType === "multiple-choice" ? [...template.options] : [],
      valueType: template.valueType,
      gradingRule: template.gradingRule ?? "exact",
    };

    setEventBonusQuestions([...eventBonusQuestions, question]);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border bg-card p-4">
        <EventSettings />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-primary">
            Match Card
          </h2>
          <span className="text-sm text-muted-foreground">
            {matchIds.length} match{matchIds.length !== 1 ? "es" : ""}
          </span>
        </div>

        {matchIds.map((id, i) => (
          <MatchEditor key={id} matchId={id} index={i} />
        ))}

        <div className="pt-2">
          <Button
            variant="outline"
            onClick={() => addMatch()}
            className="border-dashed border-border hover:border-primary hover:text-primary"
          >
            <Swords className="h-4 w-4 mr-2" />
            Add Match
          </Button>
        </div>

        {!hasMatches && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-secondary/30 py-12 text-center">
            <Swords className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground font-medium">No matches yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add matches above to start building your pick em sheet
            </p>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-primary">
            Event Bonus Questions
          </h2>
          <span className="text-sm text-muted-foreground">
            {eventBonusQuestions.length} question
            {eventBonusQuestions.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-border/80 bg-background/45 p-3">
            <div className="flex items-center gap-2">
              <WandSparkles className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium text-foreground">
                Insert event template
              </p>
            </div>
            {isLoadingBonusQuestionPools ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Loading bonus question pools...
              </p>
            ) : eventBonusPools.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No event-level templates are available yet.
              </p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Select
                  value={selectedEventPoolId}
                  onValueChange={(value) => {
                    setSelectedEventPoolId(value);
                    const nextPool = eventBonusPools.find(
                      (pool) => pool.id === value,
                    );
                    setSelectedEventTemplateId(
                      nextPool?.templates[0]?.id ?? "",
                    );
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select pool" />
                  </SelectTrigger>
                  <SelectContent>
                    {eventBonusPools.map((pool) => (
                      <SelectItem key={pool.id} value={pool.id}>
                        {pool.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedEventTemplateId}
                  onValueChange={setSelectedEventTemplateId}
                  disabled={selectedEventTemplates.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedEventTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addEventBonusFromTemplate}
                  disabled={!selectedEventTemplateId}
                >
                  Add Template
                </Button>
              </div>
            )}
          </div>

          {eventBonusQuestions.map((question, questionIndex) => (
            <div
              key={question.id}
              className="rounded-md border border-border bg-secondary/30 p-3 flex flex-col gap-2"
            >
              <div className="flex items-start gap-2">
                <Input
                  placeholder="e.g. How many title changes will happen tonight?"
                  value={question.question}
                  onChange={(event) =>
                    updateEventBonusQuestion(questionIndex, {
                      question: event.target.value,
                    })
                  }
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={1}
                  placeholder={String(defaultPoints)}
                  value={question.points ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateEventBonusQuestion(questionIndex, {
                      points:
                        value === ""
                          ? null
                          : Math.max(1, parseInt(value, 10) || 1),
                    });
                  }}
                  className="w-20"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeEventBonusQuestion(questionIndex)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Remove question</span>
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <HelpCircle className="h-4 w-4 text-primary" />
                <Label className="text-xs text-muted-foreground">
                  Answer type:
                </Label>
                <button
                  type="button"
                  onClick={() =>
                    updateEventBonusQuestion(questionIndex, {
                      answerType: "write-in",
                      options: [],
                    })
                  }
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    question.answerType === "write-in"
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
                    updateEventBonusQuestion(questionIndex, {
                      answerType: "multiple-choice",
                    })
                  }
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    question.answerType === "multiple-choice"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  <ListChecks className="h-3 w-3" />
                  Multiple Choice
                </button>
                <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background/50 p-1">
                  <button
                    type="button"
                    onClick={() =>
                      updateEventBonusQuestion(questionIndex, {
                        valueType: "string",
                        gradingRule: "exact",
                      })
                    }
                    className={`rounded px-2 py-1 text-xs transition-colors ${
                      question.valueType === "string"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Standard
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateEventBonusQuestion(questionIndex, {
                        valueType: "rosterMember",
                        gradingRule: "exact",
                      })
                    }
                    className={`rounded px-2 py-1 text-xs transition-colors ${
                      question.valueType === "rosterMember"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Roster
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateEventBonusQuestion(questionIndex, {
                        valueType: "time",
                        gradingRule: question.gradingRule ?? "exact",
                      })
                    }
                    className={`rounded px-2 py-1 text-xs transition-colors ${
                      question.valueType === "time"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Time
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateEventBonusQuestion(questionIndex, {
                        valueType: "numerical",
                        gradingRule: question.gradingRule ?? "exact",
                      })
                    }
                    className={`rounded px-2 py-1 text-xs transition-colors ${
                      question.valueType === "numerical"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Count
                  </button>
                </div>
              </div>
              {question.valueType === "time" ||
              question.valueType === "numerical" ? (
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <Label className="text-xs text-muted-foreground">
                    Grading:
                  </Label>
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
                        updateEventBonusQuestion(questionIndex, {
                          gradingRule:
                            rule.value as BonusQuestion["gradingRule"],
                        })
                      }
                      className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                        (question.gradingRule ?? "exact") === rule.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      }`}
                    >
                      {rule.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {question.answerType === "multiple-choice" ? (
                <div className="flex flex-col gap-1.5 pl-2">
                  <div className="flex flex-wrap gap-1.5">
                    {question.options.map((option, optionIndex) => (
                      <span
                        key={`${question.id}-${optionIndex}`}
                        className="inline-flex items-center gap-1 rounded bg-card px-2 py-0.5 text-xs text-card-foreground border border-border"
                      >
                        {option}
                        <button
                          type="button"
                          onClick={() =>
                            removeEventOption(questionIndex, optionIndex)
                          }
                          className="hover:text-destructive transition-colors"
                          aria-label={`Remove option ${option}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add answer option..."
                      value={eventOptionInputs[question.id] || ""}
                      onChange={(event) =>
                        setEventOptionInputs((prev) => ({
                          ...prev,
                          [question.id]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addEventOption(questionIndex);
                        }
                      }}
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => addEventOption(questionIndex)}
                      className="shrink-0"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addEventBonusQuestion}
            className="self-start"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Event Bonus Question
          </Button>
        </div>
      </section>
    </div>
  );
}
