"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CardSummary } from "@/lib/client/cards-api";
import {
  createBonusQuestionPool,
  createBonusQuestionTemplate,
  deleteBonusQuestionPool,
  deleteBonusQuestionTemplate,
  listAdminBonusQuestionPools,
  updateBonusQuestionPool,
  updateBonusQuestionTemplate,
} from "@/lib/client/bonus-question-pools-api";
import {
  createTemplateCardForAdmin,
  deleteTemplateCardForAdmin,
  listTemplateCardsForAdmin,
  updateTemplateCardForAdmin,
} from "@/lib/client/template-cards-api";
import {
  createMatchType,
  deleteMatchType,
  listAdminMatchTypes,
  updateMatchType,
} from "@/lib/client/match-types-api";
import { DEFAULT_MATCH_TYPES } from "@/lib/match-types";
import type {
  BonusPoolRuleSet,
  BonusQuestionPool,
  BonusQuestionTemplate,
  BonusQuestionValueType,
  MatchType,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { ChevronLeft, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface NewPoolState {
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
  matchTypeIds: string[];
  ruleSetIds: BonusPoolRuleSet[];
}

interface NewTemplateState {
  label: string;
  questionTemplate: string;
  defaultPoints: string;
  answerType: "write-in" | "multiple-choice";
  valueType: BonusQuestionValueType;
  defaultSection: "match" | "event";
  optionsText: string;
  sortOrder: string;
  isActive: boolean;
}

interface NewMatchTypeState {
  name: string;
  sortOrder: string;
  isActive: boolean;
  defaultRuleSetIds: BonusPoolRuleSet[];
}

const EMPTY_NEW_POOL: NewPoolState = {
  name: "",
  description: "",
  sortOrder: "0",
  isActive: true,
  matchTypeIds: [],
  ruleSetIds: [],
};

const RULE_SET_OPTIONS: Array<{ id: BonusPoolRuleSet; label: string }> = [
  { id: "timed-entry", label: "Timed Entry" },
  { id: "elimination", label: "Elimination" },
];

const EMPTY_NEW_TEMPLATE: NewTemplateState = {
  label: "",
  questionTemplate: "",
  defaultPoints: "",
  answerType: "write-in",
  valueType: "string",
  defaultSection: "match",
  optionsText: "",
  sortOrder: "0",
  isActive: true,
};

const EMPTY_NEW_MATCH_TYPE: NewMatchTypeState = {
  name: "",
  sortOrder: "0",
  isActive: true,
  defaultRuleSetIds: [],
};

function parseIntegerInput(value: string, fallback = 0): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function parseDefaultPoints(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) return null;
  return Math.max(1, parsed);
}

function parseOptionsText(value: string): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    deduped.push(trimmed);
  }

  return deduped;
}

function formatDate(value: string): string {
  if (!value) return "Unknown update time";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown update time";
  return parsed.toLocaleString();
}

export function BonusQuestionAdminScreen() {
  const [pools, setPools] = useState<BonusQuestionPool[]>([]);
  const [matchTypes, setMatchTypes] = useState<MatchType[]>([]);
  const [templateCards, setTemplateCards] = useState<CardSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMatchTypes, setIsLoadingMatchTypes] = useState(true);
  const [isLoadingTemplateCards, setIsLoadingTemplateCards] = useState(true);
  const [newPool, setNewPool] = useState<NewPoolState>(EMPTY_NEW_POOL);
  const [newMatchType, setNewMatchType] =
    useState<NewMatchTypeState>(EMPTY_NEW_MATCH_TYPE);
  const [newTemplateCardName, setNewTemplateCardName] = useState("");
  const [newTemplateCardPublic, setNewTemplateCardPublic] = useState(true);
  const [newTemplatesByPoolId, setNewTemplatesByPoolId] = useState<
    Record<string, NewTemplateState>
  >({});
  const [busyByKey, setBusyByKey] = useState<Record<string, boolean>>({});

  const loadPools = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listAdminBonusQuestionPools();
      setPools(data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load bonus question pools";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMatchTypes = useCallback(async () => {
    setIsLoadingMatchTypes(true);
    try {
      const data = await listAdminMatchTypes();
      if (data.length > 0) {
        setMatchTypes(data);
      } else {
        setMatchTypes(
          DEFAULT_MATCH_TYPES.map((matchType, index) => ({
            id: matchType.id,
            name: matchType.name,
            sortOrder: (index + 1) * 10,
            isActive: true,
            defaultRuleSetIds: matchType.defaultRuleSetIds,
          })),
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load match types";
      toast.error(message);
      setMatchTypes(
        DEFAULT_MATCH_TYPES.map((matchType, index) => ({
          id: matchType.id,
          name: matchType.name,
          sortOrder: (index + 1) * 10,
          isActive: true,
          defaultRuleSetIds: matchType.defaultRuleSetIds,
        })),
      );
    } finally {
      setIsLoadingMatchTypes(false);
    }
  }, []);

  const loadTemplateCards = useCallback(async () => {
    setIsLoadingTemplateCards(true);
    try {
      const data = await listTemplateCardsForAdmin();
      setTemplateCards(data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load template cards";
      toast.error(message);
    } finally {
      setIsLoadingTemplateCards(false);
    }
  }, []);

  useEffect(() => {
    void loadPools();
    void loadMatchTypes();
    void loadTemplateCards();
  }, [loadPools, loadMatchTypes, loadTemplateCards]);

  function setBusy(key: string, isBusy: boolean) {
    setBusyByKey((prev) => ({
      ...prev,
      [key]: isBusy,
    }));
  }

  function updateTemplateCardInState(
    cardId: string,
    updates: Partial<CardSummary>,
  ) {
    setTemplateCards((prev) =>
      prev.map((card) =>
        card.id === cardId
          ? {
              ...card,
              ...updates,
            }
          : card,
      ),
    );
  }

  async function handleCreateTemplateCard() {
    const key = "create-template-card";
    setBusy(key, true);

    try {
      const created = await createTemplateCardForAdmin({
        name: newTemplateCardName.trim() || undefined,
        isPublic: newTemplateCardPublic,
      });

      setNewTemplateCardName("");
      setNewTemplateCardPublic(true);
      setTemplateCards((prev) => [created, ...prev]);
      toast.success("Template sheet created");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create template sheet";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleSaveTemplateCard(card: CardSummary) {
    const key = `save-template-card-${card.id}`;
    setBusy(key, true);

    try {
      await updateTemplateCardForAdmin(card.id, {
        name: card.name,
        isPublic: card.isPublic,
      });
      await loadTemplateCards();
      toast.success("Template sheet saved");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save template sheet";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleDeleteTemplateCard(cardId: string) {
    const key = `delete-template-card-${cardId}`;
    setBusy(key, true);

    try {
      await deleteTemplateCardForAdmin(cardId);
      setTemplateCards((prev) => prev.filter((card) => card.id !== cardId));
      toast.success("Template sheet deleted");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to delete template sheet";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  function updateMatchTypeInState(
    matchTypeId: string,
    updates: Partial<MatchType>,
  ) {
    setMatchTypes((prev) =>
      prev.map((matchType) =>
        matchType.id === matchTypeId
          ? {
              ...matchType,
              ...updates,
            }
          : matchType,
      ),
    );
  }

  function toggleNewMatchTypeRuleSet(ruleSetId: BonusPoolRuleSet) {
    setNewMatchType((prev) => {
      const includes = prev.defaultRuleSetIds.includes(ruleSetId);
      return {
        ...prev,
        defaultRuleSetIds: includes
          ? prev.defaultRuleSetIds.filter((id) => id !== ruleSetId)
          : [...prev.defaultRuleSetIds, ruleSetId],
      };
    });
  }

  function toggleMatchTypeRuleSet(
    matchTypeId: string,
    ruleSetId: BonusPoolRuleSet,
  ) {
    setMatchTypes((prev) =>
      prev.map((matchType) => {
        if (matchType.id !== matchTypeId) return matchType;

        const includes = matchType.defaultRuleSetIds.includes(ruleSetId);
        return {
          ...matchType,
          defaultRuleSetIds: includes
            ? matchType.defaultRuleSetIds.filter((id) => id !== ruleSetId)
            : [...matchType.defaultRuleSetIds, ruleSetId],
        };
      }),
    );
  }

  async function handleCreateMatchType() {
    const name = newMatchType.name.trim();
    if (!name) {
      toast.error("Match type name is required");
      return;
    }

    const key = "create-match-type";
    setBusy(key, true);

    try {
      await createMatchType({
        name,
        sortOrder: parseIntegerInput(newMatchType.sortOrder, 0),
        isActive: newMatchType.isActive,
        defaultRuleSetIds: newMatchType.defaultRuleSetIds,
      });
      setNewMatchType(EMPTY_NEW_MATCH_TYPE);
      await loadMatchTypes();
      toast.success("Match type created");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create match type";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleSaveMatchType(matchType: MatchType) {
    const key = `save-match-type-${matchType.id}`;
    setBusy(key, true);

    try {
      await updateMatchType(matchType.id, {
        name: matchType.name,
        sortOrder: matchType.sortOrder,
        isActive: matchType.isActive,
        defaultRuleSetIds: matchType.defaultRuleSetIds,
      });
      await loadMatchTypes();
      toast.success("Match type saved");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save match type";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleDeleteMatchType(matchTypeId: string) {
    const key = `delete-match-type-${matchTypeId}`;
    setBusy(key, true);

    try {
      await deleteMatchType(matchTypeId);
      await loadMatchTypes();
      toast.success("Match type deleted");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete match type";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  function updatePoolInState(
    poolId: string,
    updates: Partial<BonusQuestionPool>,
  ) {
    setPools((prev) =>
      prev.map((pool) =>
        pool.id === poolId
          ? {
              ...pool,
              ...updates,
            }
          : pool,
      ),
    );
  }

  function toggleNewPoolMatchType(matchTypeId: string) {
    setNewPool((prev) => {
      const includes = prev.matchTypeIds.includes(matchTypeId);
      return {
        ...prev,
        matchTypeIds: includes
          ? prev.matchTypeIds.filter((id) => id !== matchTypeId)
          : [...prev.matchTypeIds, matchTypeId],
      };
    });
  }

  function toggleNewPoolRuleSet(ruleSetId: BonusPoolRuleSet) {
    setNewPool((prev) => {
      const includes = prev.ruleSetIds.includes(ruleSetId);
      return {
        ...prev,
        ruleSetIds: includes
          ? prev.ruleSetIds.filter((id) => id !== ruleSetId)
          : [...prev.ruleSetIds, ruleSetId],
      };
    });
  }

  function togglePoolMatchType(poolId: string, matchTypeId: string) {
    setPools((prev) =>
      prev.map((pool) => {
        if (pool.id !== poolId) return pool;

        const includes = pool.matchTypeIds.includes(matchTypeId);
        return {
          ...pool,
          matchTypeIds: includes
            ? pool.matchTypeIds.filter((id) => id !== matchTypeId)
            : [...pool.matchTypeIds, matchTypeId],
        };
      }),
    );
  }

  function togglePoolRuleSet(poolId: string, ruleSetId: BonusPoolRuleSet) {
    setPools((prev) =>
      prev.map((pool) => {
        if (pool.id !== poolId) return pool;

        const includes = pool.ruleSetIds.includes(ruleSetId);
        return {
          ...pool,
          ruleSetIds: includes
            ? pool.ruleSetIds.filter((id) => id !== ruleSetId)
            : [...pool.ruleSetIds, ruleSetId],
        };
      }),
    );
  }

  function updateTemplateInState(
    poolId: string,
    templateId: string,
    updates: Partial<BonusQuestionTemplate>,
  ) {
    setPools((prev) =>
      prev.map((pool) => {
        if (pool.id !== poolId) return pool;

        return {
          ...pool,
          templates: pool.templates.map((template) =>
            template.id === templateId
              ? {
                  ...template,
                  ...updates,
                }
              : template,
          ),
        };
      }),
    );
  }

  async function handleCreatePool() {
    const name = newPool.name.trim();
    if (!name) {
      toast.error("Pool name is required");
      return;
    }

    const key = "create-pool";
    setBusy(key, true);

    try {
      await createBonusQuestionPool({
        name,
        description: newPool.description.trim(),
        sortOrder: parseIntegerInput(newPool.sortOrder, 0),
        isActive: newPool.isActive,
        matchTypeIds: newPool.matchTypeIds,
        ruleSetIds: newPool.ruleSetIds,
      });

      setNewPool(EMPTY_NEW_POOL);
      await loadPools();
      toast.success("Pool created");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create pool";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleSavePool(pool: BonusQuestionPool) {
    const key = `save-pool-${pool.id}`;
    setBusy(key, true);

    try {
      await updateBonusQuestionPool(pool.id, {
        name: pool.name,
        description: pool.description,
        sortOrder: pool.sortOrder,
        isActive: pool.isActive,
        matchTypeIds: pool.matchTypeIds,
        ruleSetIds: pool.ruleSetIds,
      });
      await loadPools();
      toast.success("Pool saved");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save pool";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleDeletePool(poolId: string) {
    const key = `delete-pool-${poolId}`;
    setBusy(key, true);

    try {
      await deleteBonusQuestionPool(poolId);
      await loadPools();
      toast.success("Pool deleted");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete pool";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  function getNewTemplateState(poolId: string): NewTemplateState {
    return newTemplatesByPoolId[poolId] ?? EMPTY_NEW_TEMPLATE;
  }

  function updateNewTemplateState(
    poolId: string,
    updates: Partial<NewTemplateState>,
  ) {
    setNewTemplatesByPoolId((prev) => ({
      ...prev,
      [poolId]: {
        ...(prev[poolId] ?? EMPTY_NEW_TEMPLATE),
        ...updates,
      },
    }));
  }

  async function handleCreateTemplate(poolId: string) {
    const draft = getNewTemplateState(poolId);
    const label = draft.label.trim();
    const questionTemplate = draft.questionTemplate.trim();

    if (!label || !questionTemplate) {
      toast.error("Template label and question text are required");
      return;
    }

    const options = parseOptionsText(draft.optionsText);
    if (draft.answerType === "multiple-choice" && options.length < 2) {
      toast.error("Multiple-choice templates require at least two options");
      return;
    }

    const key = `create-template-${poolId}`;
    setBusy(key, true);

    try {
      await createBonusQuestionTemplate({
        poolId,
        label,
        questionTemplate,
        defaultPoints: parseDefaultPoints(draft.defaultPoints),
        answerType: draft.answerType,
        options,
        valueType: draft.valueType,
        defaultSection: draft.defaultSection,
        sortOrder: parseIntegerInput(draft.sortOrder, 0),
        isActive: draft.isActive,
      });

      setNewTemplatesByPoolId((prev) => ({
        ...prev,
        [poolId]: EMPTY_NEW_TEMPLATE,
      }));

      await loadPools();
      toast.success("Template created");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create template";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleSaveTemplate(
    poolId: string,
    template: BonusQuestionTemplate,
  ) {
    const options =
      template.answerType === "multiple-choice" ? template.options : [];
    if (template.answerType === "multiple-choice" && options.length < 2) {
      toast.error("Multiple-choice templates require at least two options");
      return;
    }

    const key = `save-template-${template.id}`;
    setBusy(key, true);

    try {
      await updateBonusQuestionTemplate(template.id, {
        poolId,
        label: template.label,
        questionTemplate: template.questionTemplate,
        defaultPoints: template.defaultPoints,
        answerType: template.answerType,
        options,
        valueType: template.valueType,
        defaultSection: template.defaultSection,
        sortOrder: template.sortOrder,
        isActive: template.isActive,
      });
      await loadPools();
      toast.success("Template saved");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save template";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    const key = `delete-template-${templateId}`;
    setBusy(key, true);

    try {
      await deleteBonusQuestionTemplate(templateId);
      await loadPools();
      toast.success("Template deleted");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete template";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(230,170,60,0.20),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(130,160,255,0.12),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_35%)]" />

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:py-8">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold uppercase tracking-wide text-foreground">
              Admin Configuration
            </h1>
            <p className="text-sm text-muted-foreground">
              Configure template pick-em sheets and reusable bonus question
              pools.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/">
                <ChevronLeft className="mr-1 h-4 w-4" />
                Home
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void loadPools();
                void loadMatchTypes();
                void loadTemplateCards();
              }}
              disabled={
                isLoading || isLoadingMatchTypes || isLoadingTemplateCards
              }
            >
              <RefreshCcw className="mr-1 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </section>

        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Template Pick Em Sheets</CardTitle>
            <CardDescription>
              Create and manage the sheets shown to users in the public template
              list.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[2fr_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>Template Name</Label>
              <Input
                placeholder="e.g. WrestleMania Master Template"
                value={newTemplateCardName}
                onChange={(event) => setNewTemplateCardName(event.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={newTemplateCardPublic}
                onChange={(event) =>
                  setNewTemplateCardPublic(event.target.checked)
                }
              />
              Public
            </label>
            <Button
              onClick={() => void handleCreateTemplateCard()}
              disabled={busyByKey["create-template-card"]}
            >
              <Plus className="mr-1 h-4 w-4" />
              Create Template Sheet
            </Button>
          </CardContent>
        </Card>

        {isLoadingTemplateCards ? (
          <Card className="border-border/70 bg-card/70">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Loading template sheets...
            </CardContent>
          </Card>
        ) : templateCards.length === 0 ? (
          <Card className="border-border/70 bg-card/70">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No template sheets yet. Create one above, then click Edit to
              configure matches.
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle className="text-base">
                Existing Template Sheets
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {templateCards.map((card) => {
                const saveKey = `save-template-card-${card.id}`;
                const deleteKey = `delete-template-card-${card.id}`;

                return (
                  <div
                    key={card.id}
                    className="rounded-md border border-border/70 bg-background/40 p-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-[2fr_auto_auto_auto] sm:items-center">
                      <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input
                          value={card.name}
                          onChange={(event) =>
                            updateTemplateCardInState(card.id, {
                              name: event.target.value,
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Updated {formatDate(card.updatedAt)}
                        </p>
                      </div>
                      <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={card.isPublic}
                          onChange={(event) =>
                            updateTemplateCardInState(card.id, {
                              isPublic: event.target.checked,
                            })
                          }
                        />
                        Public
                      </label>
                      <div className="flex gap-2">
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/cards/${card.id}`}>Edit</Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleSaveTemplateCard(card)}
                          disabled={busyByKey[saveKey]}
                        >
                          <Save className="mr-1 h-4 w-4" />
                          Save
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void handleDeleteTemplateCard(card.id)}
                        disabled={busyByKey[deleteKey]}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Match Types</CardTitle>
            <CardDescription>
              Manage match types used by sheet editors. Users can choose one and
              optionally override the label per match.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[2fr_auto_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                placeholder="e.g. Submission Match"
                value={newMatchType.name}
                onChange={(event) =>
                  setNewMatchType((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sort</Label>
              <Input
                type="number"
                min={0}
                value={newMatchType.sortOrder}
                onChange={(event) =>
                  setNewMatchType((prev) => ({
                    ...prev,
                    sortOrder: event.target.value,
                  }))
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="rounded-md border border-border px-3 py-2 text-sm text-foreground">
                <p className="mb-2 text-xs text-muted-foreground">
                  Default Rulesets
                </p>
                <div className="flex flex-wrap gap-2">
                  {RULE_SET_OPTIONS.map((ruleSet) => {
                    const isSelected = newMatchType.defaultRuleSetIds.includes(
                      ruleSet.id,
                    );
                    return (
                      <button
                        key={`new-match-type:${ruleSet.id}`}
                        type="button"
                        onClick={() => toggleNewMatchTypeRuleSet(ruleSet.id)}
                        className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {ruleSet.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={newMatchType.isActive}
                  onChange={(event) =>
                    setNewMatchType((prev) => ({
                      ...prev,
                      isActive: event.target.checked,
                    }))
                  }
                />
                Active
              </label>
            </div>
            <Button
              onClick={() => void handleCreateMatchType()}
              disabled={busyByKey["create-match-type"]}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add Match Type
            </Button>
          </CardContent>
        </Card>

        {isLoadingMatchTypes ? (
          <Card className="border-border/70 bg-card/70">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Loading match types...
            </CardContent>
          </Card>
        ) : matchTypes.length === 0 ? (
          <Card className="border-border/70 bg-card/70">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No match types yet. Create one above.
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle className="text-base">Existing Match Types</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {matchTypes.map((matchType) => {
                const saveKey = `save-match-type-${matchType.id}`;
                const deleteKey = `delete-match-type-${matchType.id}`;

                return (
                  <div
                    key={matchType.id}
                    className="rounded-md border border-border/70 bg-background/40 p-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-[2fr_auto_auto_auto_auto] sm:items-center">
                      <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input
                          value={matchType.name}
                          onChange={(event) =>
                            updateMatchTypeInState(matchType.id, {
                              name: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Sort</Label>
                        <Input
                          type="number"
                          min={0}
                          value={matchType.sortOrder}
                          onChange={(event) =>
                            updateMatchTypeInState(matchType.id, {
                              sortOrder: parseIntegerInput(
                                event.target.value,
                                0,
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="rounded-md border border-border px-3 py-2 text-sm text-foreground">
                        <p className="mb-2 text-xs text-muted-foreground">
                          Default Rulesets
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {RULE_SET_OPTIONS.map((ruleSet) => {
                            const isSelected =
                              matchType.defaultRuleSetIds.includes(ruleSet.id);
                            return (
                              <button
                                key={`${matchType.id}:${ruleSet.id}`}
                                type="button"
                                onClick={() =>
                                  toggleMatchTypeRuleSet(
                                    matchType.id,
                                    ruleSet.id,
                                  )
                                }
                                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                                  isSelected
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {ruleSet.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={matchType.isActive}
                          onChange={(event) =>
                            updateMatchTypeInState(matchType.id, {
                              isActive: event.target.checked,
                            })
                          }
                        />
                        Active
                      </label>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleSaveMatchType(matchType)}
                          disabled={busyByKey[saveKey]}
                        >
                          <Save className="mr-1 h-4 w-4" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            void handleDeleteMatchType(matchType.id)
                          }
                          disabled={busyByKey[deleteKey]}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Create Pool</CardTitle>
            <CardDescription>
              Add a new group of templates (examples: Duration, Finish Type,
              Interference).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_auto_auto_auto] lg:items-end">
              <div className="space-y-1.5">
                <Label>Pool Name</Label>
                <Input
                  placeholder="e.g. Match Duration"
                  value={newPool.name}
                  onChange={(event) =>
                    setNewPool((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input
                  placeholder="Short admin-facing description"
                  value={newPool.description}
                  onChange={(event) =>
                    setNewPool((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Sort</Label>
                <Input
                  type="number"
                  min={0}
                  value={newPool.sortOrder}
                  onChange={(event) =>
                    setNewPool((prev) => ({
                      ...prev,
                      sortOrder: event.target.value,
                    }))
                  }
                />
              </div>
              <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={newPool.isActive}
                  onChange={(event) =>
                    setNewPool((prev) => ({
                      ...prev,
                      isActive: event.target.checked,
                    }))
                  }
                />
                Active
              </label>
              <Button
                onClick={() => void handleCreatePool()}
                disabled={busyByKey["create-pool"]}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add Pool
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label>Suggested Match Types</Label>
              {isLoadingMatchTypes ? (
                <p className="text-xs text-muted-foreground">
                  Loading match types...
                </p>
              ) : matchTypes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No match types available yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {matchTypes.map((matchType) => {
                    const isSelected = newPool.matchTypeIds.includes(
                      matchType.id,
                    );
                    return (
                      <button
                        key={matchType.id}
                        type="button"
                        onClick={() => toggleNewPoolMatchType(matchType.id)}
                        className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {matchType.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Leave empty to show this pool for every match type.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Suggested Rulesets</Label>
              <div className="flex flex-wrap gap-2">
                {RULE_SET_OPTIONS.map((ruleSet) => {
                  const isSelected = newPool.ruleSetIds.includes(ruleSet.id);
                  return (
                    <button
                      key={ruleSet.id}
                      type="button"
                      onClick={() => toggleNewPoolRuleSet(ruleSet.id)}
                      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {ruleSet.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Leave empty to show this pool for every ruleset.
              </p>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card className="border-border/70 bg-card/70">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Loading pools...
            </CardContent>
          </Card>
        ) : pools.length === 0 ? (
          <Card className="border-border/70 bg-card/70">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No pools yet. Create one to start building reusable bonus question
              templates.
            </CardContent>
          </Card>
        ) : (
          pools.map((pool) => {
            const newTemplate = getNewTemplateState(pool.id);
            const savePoolKey = `save-pool-${pool.id}`;
            const deletePoolKey = `delete-pool-${pool.id}`;

            return (
              <Card key={pool.id} className="border-border/70 bg-card/70">
                <CardHeader>
                  <CardTitle className="text-base">Pool Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_auto_auto_auto] lg:items-end">
                    <div className="space-y-1.5">
                      <Label>Name</Label>
                      <Input
                        value={pool.name}
                        onChange={(event) =>
                          updatePoolInState(pool.id, {
                            name: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Description</Label>
                      <Input
                        value={pool.description}
                        onChange={(event) =>
                          updatePoolInState(pool.id, {
                            description: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Sort</Label>
                      <Input
                        type="number"
                        min={0}
                        value={pool.sortOrder}
                        onChange={(event) =>
                          updatePoolInState(pool.id, {
                            sortOrder: parseIntegerInput(event.target.value, 0),
                          })
                        }
                      />
                    </div>
                    <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={pool.isActive}
                        onChange={(event) =>
                          updatePoolInState(pool.id, {
                            isActive: event.target.checked,
                          })
                        }
                      />
                      Active
                    </label>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => void handleSavePool(pool)}
                        disabled={busyByKey[savePoolKey]}
                      >
                        <Save className="mr-1 h-4 w-4" />
                        Save
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => void handleDeletePool(pool.id)}
                        disabled={busyByKey[deletePoolKey]}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Suggested Match Types</Label>
                    {isLoadingMatchTypes ? (
                      <p className="text-xs text-muted-foreground">
                        Loading match types...
                      </p>
                    ) : matchTypes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No match types available yet.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {matchTypes.map((matchType) => {
                          const isSelected = pool.matchTypeIds.includes(
                            matchType.id,
                          );
                          return (
                            <button
                              key={`${pool.id}:${matchType.id}`}
                              type="button"
                              onClick={() =>
                                togglePoolMatchType(pool.id, matchType.id)
                              }
                              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                                isSelected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {matchType.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Leave empty to show this pool for every match type.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Suggested Rulesets</Label>
                    <div className="flex flex-wrap gap-2">
                      {RULE_SET_OPTIONS.map((ruleSet) => {
                        const isSelected = pool.ruleSetIds.includes(ruleSet.id);
                        return (
                          <button
                            key={`${pool.id}:${ruleSet.id}`}
                            type="button"
                            onClick={() =>
                              togglePoolRuleSet(pool.id, ruleSet.id)
                            }
                            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                              isSelected
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {ruleSet.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Leave empty to show this pool for every ruleset.
                    </p>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-background/40 p-3">
                    <p className="text-sm font-medium text-foreground">
                      Templates in {pool.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Supported placeholders in template text:{" "}
                      {`{{matchTitle}}`}, {`{{participant1}}`},{" "}
                      {`{{participant2}}`}, {`{{participant3}}`},{" "}
                      {`{{promotionName}}`}, {`{{matchType}}`},{" "}
                      {`{{eventName}}`}.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {pool.templates.map((template) => {
                      const saveTemplateKey = `save-template-${template.id}`;
                      const deleteTemplateKey = `delete-template-${template.id}`;

                      return (
                        <div
                          key={template.id}
                          className="rounded-lg border border-border/70 bg-background/45 p-3"
                        >
                          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
                            <div className="space-y-1.5">
                              <Label>Label</Label>
                              <Input
                                value={template.label}
                                onChange={(event) =>
                                  updateTemplateInState(pool.id, template.id, {
                                    label: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Answer Type</Label>
                              <Select
                                value={template.answerType}
                                onValueChange={(
                                  value: "write-in" | "multiple-choice",
                                ) =>
                                  updateTemplateInState(pool.id, template.id, {
                                    answerType: value,
                                    options:
                                      value === "write-in"
                                        ? []
                                        : template.options,
                                  })
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="write-in">
                                    Write-in
                                  </SelectItem>
                                  <SelectItem value="multiple-choice">
                                    Multiple Choice
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Value Type</Label>
                              <Select
                                value={template.valueType}
                                onValueChange={(
                                  value: BonusQuestionValueType,
                                ) =>
                                  updateTemplateInState(pool.id, template.id, {
                                    valueType: value,
                                  })
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="string">String</SelectItem>
                                  <SelectItem value="rosterMember">
                                    Roster Member
                                  </SelectItem>
                                  <SelectItem value="numerical">
                                    Numerical
                                  </SelectItem>
                                  <SelectItem value="time">Time</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Default Section</Label>
                              <Select
                                value={template.defaultSection}
                                onValueChange={(value: "match" | "event") =>
                                  updateTemplateInState(pool.id, template.id, {
                                    defaultSection: value,
                                  })
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="match">Match</SelectItem>
                                  <SelectItem value="event">
                                    Event-wide
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Default Points</Label>
                              <Input
                                type="number"
                                min={1}
                                placeholder="Use match default"
                                value={template.defaultPoints ?? ""}
                                onChange={(event) =>
                                  updateTemplateInState(pool.id, template.id, {
                                    defaultPoints: parseDefaultPoints(
                                      event.target.value,
                                    ),
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Sort</Label>
                              <Input
                                type="number"
                                min={0}
                                value={template.sortOrder}
                                onChange={(event) =>
                                  updateTemplateInState(pool.id, template.id, {
                                    sortOrder: parseIntegerInput(
                                      event.target.value,
                                      0,
                                    ),
                                  })
                                }
                              />
                            </div>
                          </div>

                          <div className="mt-3 space-y-1.5">
                            <Label>Question Template</Label>
                            <Textarea
                              value={template.questionTemplate}
                              onChange={(event) =>
                                updateTemplateInState(pool.id, template.id, {
                                  questionTemplate: event.target.value,
                                })
                              }
                              rows={2}
                            />
                          </div>

                          {template.answerType === "multiple-choice" ? (
                            <div className="mt-3 space-y-1.5">
                              <Label>Options (one per line)</Label>
                              <Textarea
                                value={template.options.join("\n")}
                                onChange={(event) =>
                                  updateTemplateInState(pool.id, template.id, {
                                    options: parseOptionsText(
                                      event.target.value,
                                    ),
                                  })
                                }
                                rows={3}
                              />
                            </div>
                          ) : null}

                          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground">
                                <input
                                  type="checkbox"
                                  checked={template.isActive}
                                  onChange={(event) =>
                                    updateTemplateInState(
                                      pool.id,
                                      template.id,
                                      {
                                        isActive: event.target.checked,
                                      },
                                    )
                                  }
                                />
                                Active
                              </label>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  void handleSaveTemplate(pool.id, template)
                                }
                                disabled={busyByKey[saveTemplateKey]}
                              >
                                <Save className="mr-1 h-4 w-4" />
                                Save Template
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  void handleDeleteTemplate(template.id)
                                }
                                disabled={busyByKey[deleteTemplateKey]}
                              >
                                <Trash2 className="mr-1 h-4 w-4" />
                                Delete Template
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    <div className="rounded-lg border border-dashed border-border/70 bg-background/35 p-3">
                      <p className="mb-2 text-sm font-medium text-foreground">
                        Create Template
                      </p>
                      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
                        <div className="space-y-1.5">
                          <Label>Label</Label>
                          <Input
                            placeholder="e.g. Interference present"
                            value={newTemplate.label}
                            onChange={(event) =>
                              updateNewTemplateState(pool.id, {
                                label: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Answer Type</Label>
                          <Select
                            value={newTemplate.answerType}
                            onValueChange={(
                              value: "write-in" | "multiple-choice",
                            ) =>
                              updateNewTemplateState(pool.id, {
                                answerType: value,
                                optionsText:
                                  value === "write-in"
                                    ? ""
                                    : newTemplate.optionsText,
                              })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="write-in">Write-in</SelectItem>
                              <SelectItem value="multiple-choice">
                                Multiple Choice
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Value Type</Label>
                          <Select
                            value={newTemplate.valueType}
                            onValueChange={(value: BonusQuestionValueType) =>
                              updateNewTemplateState(pool.id, {
                                valueType: value,
                              })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="string">String</SelectItem>
                              <SelectItem value="rosterMember">
                                Roster Member
                              </SelectItem>
                              <SelectItem value="numerical">
                                Numerical
                              </SelectItem>
                              <SelectItem value="time">Time</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Default Section</Label>
                          <Select
                            value={newTemplate.defaultSection}
                            onValueChange={(value: "match" | "event") =>
                              updateNewTemplateState(pool.id, {
                                defaultSection: value,
                              })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="match">Match</SelectItem>
                              <SelectItem value="event">Event-wide</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Default Points</Label>
                          <Input
                            type="number"
                            min={1}
                            placeholder="Match default"
                            value={newTemplate.defaultPoints}
                            onChange={(event) =>
                              updateNewTemplateState(pool.id, {
                                defaultPoints: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Sort</Label>
                          <Input
                            type="number"
                            min={0}
                            value={newTemplate.sortOrder}
                            onChange={(event) =>
                              updateNewTemplateState(pool.id, {
                                sortOrder: event.target.value,
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        <Label>Question Template</Label>
                        <Textarea
                          placeholder="Will {{matchTitle}} end with a clean finish?"
                          value={newTemplate.questionTemplate}
                          onChange={(event) =>
                            updateNewTemplateState(pool.id, {
                              questionTemplate: event.target.value,
                            })
                          }
                          rows={2}
                        />
                      </div>

                      {newTemplate.answerType === "multiple-choice" ? (
                        <div className="mt-3 space-y-1.5">
                          <Label>Options (one per line)</Label>
                          <Textarea
                            placeholder={"Yes\nNo"}
                            value={newTemplate.optionsText}
                            onChange={(event) =>
                              updateNewTemplateState(pool.id, {
                                optionsText: event.target.value,
                              })
                            }
                            rows={3}
                          />
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground">
                            <input
                              type="checkbox"
                              checked={newTemplate.isActive}
                              onChange={(event) =>
                                updateNewTemplateState(pool.id, {
                                  isActive: event.target.checked,
                                })
                              }
                            />
                            Active
                          </label>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => void handleCreateTemplate(pool.id)}
                          disabled={busyByKey[`create-template-${pool.id}`]}
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Add Template
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </main>
    </div>
  );
}
