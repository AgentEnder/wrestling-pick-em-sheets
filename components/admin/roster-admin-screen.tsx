"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAdminPromotion,
  createAdminPromotionRosterMember,
  deleteAdminPromotion,
  deleteAdminPromotionRosterMember,
  listAdminPromotionRosterMembers,
  listAdminPromotions,
  syncAdminWweRoster,
  updateAdminPromotion,
  updateAdminPromotionRosterMember,
} from "@/lib/client/roster-admin-api";
import type { Promotion, PromotionRosterMember } from "@/lib/types";
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
import { ChevronLeft, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

function parseAliasesInput(value: string): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];

  for (const raw of value.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    aliases.push(trimmed);
  }

  return aliases;
}

function aliasesToText(aliases: string[]): string {
  return aliases.join(", ");
}

function isWwePromotion(promotion: Promotion | null): boolean {
  if (!promotion) return false;
  const allNames = [promotion.name, ...promotion.aliases];
  return allNames.some((name) => name.trim().toLowerCase() === "wwe");
}

export function RosterAdminScreen() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [selectedPromotionId, setSelectedPromotionId] = useState<string>("");
  const [members, setMembers] = useState<PromotionRosterMember[]>([]);
  const [isLoadingPromotions, setIsLoadingPromotions] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [busyByKey, setBusyByKey] = useState<Record<string, boolean>>({});
  const [newPromotionName, setNewPromotionName] = useState("");
  const [newPromotionAliases, setNewPromotionAliases] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberAliases, setNewMemberAliases] = useState("");

  const [promotionNameDrafts, setPromotionNameDrafts] = useState<
    Record<string, string>
  >({});
  const [promotionAliasesDrafts, setPromotionAliasesDrafts] = useState<
    Record<string, string>
  >({});
  const [memberNameDrafts, setMemberNameDrafts] = useState<
    Record<string, string>
  >({});
  const [memberAliasesDrafts, setMemberAliasesDrafts] = useState<
    Record<string, string>
  >({});

  const selectedPromotion = useMemo(
    () =>
      promotions.find((promotion) => promotion.id === selectedPromotionId) ??
      null,
    [promotions, selectedPromotionId],
  );

  function setBusy(key: string, value: boolean) {
    setBusyByKey((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  const loadPromotions = useCallback(async () => {
    setIsLoadingPromotions(true);
    try {
      const data = await listAdminPromotions();
      setPromotions(data);
      setPromotionNameDrafts((prev) => {
        const next = { ...prev };
        for (const promotion of data) {
          if (next[promotion.id] === undefined) {
            next[promotion.id] = promotion.name;
          }
        }
        return next;
      });
      setPromotionAliasesDrafts((prev) => {
        const next = { ...prev };
        for (const promotion of data) {
          if (next[promotion.id] === undefined) {
            next[promotion.id] = aliasesToText(promotion.aliases);
          }
        }
        return next;
      });

      if (
        data.length > 0 &&
        !data.some((promotion) => promotion.id === selectedPromotionId)
      ) {
        setSelectedPromotionId(data[0].id);
      }
      if (data.length === 0) {
        setSelectedPromotionId("");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load promotions";
      toast.error(message);
    } finally {
      setIsLoadingPromotions(false);
    }
  }, [selectedPromotionId]);

  const loadMembers = useCallback(async (promotionId: string) => {
    if (!promotionId) {
      setMembers([]);
      return;
    }

    setIsLoadingMembers(true);
    try {
      const data = await listAdminPromotionRosterMembers(promotionId);
      setMembers(data);
      setMemberNameDrafts((prev) => {
        const next = { ...prev };
        for (const member of data) {
          if (next[member.id] === undefined) {
            next[member.id] = member.displayName;
          }
        }
        return next;
      });
      setMemberAliasesDrafts((prev) => {
        const next = { ...prev };
        for (const member of data) {
          if (next[member.id] === undefined) {
            next[member.id] = aliasesToText(member.aliases);
          }
        }
        return next;
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load roster members";
      toast.error(message);
    } finally {
      setIsLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    void loadPromotions();
  }, [loadPromotions]);

  useEffect(() => {
    if (!selectedPromotionId) {
      setMembers([]);
      return;
    }
    void loadMembers(selectedPromotionId);
  }, [loadMembers, selectedPromotionId]);

  async function handleCreatePromotion() {
    const name = newPromotionName.trim();
    if (!name) {
      toast.error("Promotion name is required");
      return;
    }

    const key = "create-promotion";
    setBusy(key, true);
    try {
      const created = await createAdminPromotion({
        name,
        aliases: parseAliasesInput(newPromotionAliases),
      });
      setPromotions((prev) =>
        [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder),
      );
      setPromotionNameDrafts((prev) => ({
        ...prev,
        [created.id]: created.name,
      }));
      setPromotionAliasesDrafts((prev) => ({
        ...prev,
        [created.id]: aliasesToText(created.aliases),
      }));
      setNewPromotionName("");
      setNewPromotionAliases("");
      setSelectedPromotionId(created.id);
      toast.success("Promotion created");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create promotion";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleSavePromotion(promotion: Promotion) {
    const key = `save-promotion-${promotion.id}`;
    setBusy(key, true);
    try {
      const name = (promotionNameDrafts[promotion.id] ?? promotion.name).trim();
      await updateAdminPromotion(promotion.id, {
        name,
        aliases: parseAliasesInput(promotionAliasesDrafts[promotion.id] ?? ""),
        isActive: promotion.isActive,
        sortOrder: promotion.sortOrder,
      });

      setPromotions((prev) =>
        prev.map((item) =>
          item.id === promotion.id
            ? {
                ...item,
                name,
                aliases: parseAliasesInput(
                  promotionAliasesDrafts[promotion.id] ?? "",
                ),
              }
            : item,
        ),
      );
      toast.success("Promotion saved");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save promotion";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleDeletePromotion(promotionId: string) {
    const key = `delete-promotion-${promotionId}`;
    setBusy(key, true);
    try {
      await deleteAdminPromotion(promotionId);
      setPromotions((prev) =>
        prev.filter((promotion) => promotion.id !== promotionId),
      );
      if (selectedPromotionId === promotionId) {
        setSelectedPromotionId("");
      }
      toast.success("Promotion deleted");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete promotion";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleCreateMember() {
    if (!selectedPromotionId) {
      toast.error("Select a promotion first");
      return;
    }

    const displayName = newMemberName.trim();
    if (!displayName) {
      toast.error("Roster name is required");
      return;
    }

    const key = `create-member-${selectedPromotionId}`;
    setBusy(key, true);
    try {
      const created = await createAdminPromotionRosterMember(
        selectedPromotionId,
        {
          displayName,
          aliases: parseAliasesInput(newMemberAliases),
        },
      );
      setMembers((prev) =>
        [...prev, created].sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        ),
      );
      setMemberNameDrafts((prev) => ({
        ...prev,
        [created.id]: created.displayName,
      }));
      setMemberAliasesDrafts((prev) => ({
        ...prev,
        [created.id]: aliasesToText(created.aliases),
      }));
      setNewMemberName("");
      setNewMemberAliases("");
      toast.success("Roster member created");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create roster member";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleSaveMember(member: PromotionRosterMember) {
    const key = `save-member-${member.id}`;
    setBusy(key, true);
    try {
      const displayName = (
        memberNameDrafts[member.id] ?? member.displayName
      ).trim();
      await updateAdminPromotionRosterMember(member.promotionId, member.id, {
        displayName,
        aliases: parseAliasesInput(memberAliasesDrafts[member.id] ?? ""),
        isActive: member.isActive,
      });

      setMembers((prev) =>
        prev.map((item) =>
          item.id === member.id
            ? {
                ...item,
                displayName,
                aliases: parseAliasesInput(
                  memberAliasesDrafts[member.id] ?? "",
                ),
              }
            : item,
        ),
      );
      toast.success("Roster member saved");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save roster member";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleDeleteMember(member: PromotionRosterMember) {
    const key = `delete-member-${member.id}`;
    setBusy(key, true);
    try {
      await deleteAdminPromotionRosterMember(member.promotionId, member.id);
      setMembers((prev) => prev.filter((item) => item.id !== member.id));
      toast.success("Roster member deleted");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to delete roster member";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleSyncWweRoster() {
    if (!selectedPromotion) return;

    const key = `sync-wwe-${selectedPromotion.id}`;
    setBusy(key, true);
    try {
      const result = await syncAdminWweRoster(selectedPromotion.id);
      await loadMembers(selectedPromotion.id);
      toast.success(
        `Synced WWE roster: ${result.insertedCount} added, ${result.updatedCount} updated (${result.fetchedCount} fetched).`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sync WWE roster";
      toast.error(message);
    } finally {
      setBusy(key, false);
    }
  }

  return (
    <div className="relative min-h-screen bg-background px-4 py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-3xl font-bold uppercase tracking-wide text-foreground">
              Roster Admin
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Maintain promotions and autocomplete roster members.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to Home
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void loadPromotions();
                if (selectedPromotionId) {
                  void loadMembers(selectedPromotionId);
                }
              }}
            >
              <RefreshCcw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>Promotions</CardTitle>
              <CardDescription>
                Create and edit promotion aliases.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-border/70 bg-background/40 p-3 space-y-3">
                <div className="space-y-1.5">
                  <Label>New Promotion</Label>
                  <Input
                    value={newPromotionName}
                    onChange={(event) =>
                      setNewPromotionName(event.target.value)
                    }
                    placeholder="e.g. WWE"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Aliases (comma separated)</Label>
                  <Input
                    value={newPromotionAliases}
                    onChange={(event) =>
                      setNewPromotionAliases(event.target.value)
                    }
                    placeholder="e.g. World Wrestling Entertainment"
                  />
                </div>
                <Button
                  onClick={() => {
                    void handleCreatePromotion();
                  }}
                  disabled={busyByKey["create-promotion"]}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Promotion
                </Button>
              </div>

              {isLoadingPromotions ? (
                <p className="text-sm text-muted-foreground">
                  Loading promotions...
                </p>
              ) : promotions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No promotions yet.
                </p>
              ) : (
                promotions.map((promotion) => {
                  const saveKey = `save-promotion-${promotion.id}`;
                  const deleteKey = `delete-promotion-${promotion.id}`;
                  return (
                    <div
                      key={promotion.id}
                      className={`rounded-md border p-3 space-y-3 ${
                        promotion.id === selectedPromotionId
                          ? "border-primary bg-primary/5"
                          : "border-border/70 bg-background/30"
                      }`}
                    >
                      <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input
                          value={
                            promotionNameDrafts[promotion.id] ?? promotion.name
                          }
                          onChange={(event) =>
                            setPromotionNameDrafts((prev) => ({
                              ...prev,
                              [promotion.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Aliases</Label>
                        <Input
                          value={
                            promotionAliasesDrafts[promotion.id] ??
                            aliasesToText(promotion.aliases)
                          }
                          onChange={(event) =>
                            setPromotionAliasesDrafts((prev) => ({
                              ...prev,
                              [promotion.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setSelectedPromotionId(promotion.id)}
                        >
                          {promotion.id === selectedPromotionId
                            ? "Selected"
                            : "Select"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void handleSavePromotion(promotion);
                          }}
                          disabled={busyByKey[saveKey]}
                        >
                          <Save className="h-4 w-4 mr-1" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            void handleDeletePromotion(promotion.id);
                          }}
                          disabled={busyByKey[deleteKey]}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>Roster Members</CardTitle>
              <CardDescription>
                {selectedPromotion
                  ? `Editing ${selectedPromotion.name}`
                  : "Select a promotion to edit roster members."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedPromotion ? (
                <p className="text-sm text-muted-foreground">
                  Pick a promotion on the left to manage roster associations.
                </p>
              ) : (
                <>
                  {isWwePromotion(selectedPromotion) ? (
                    <div className="rounded-md border border-border/70 bg-background/40 p-3">
                      <p className="text-sm text-muted-foreground">
                        Pull names from the WWE talent feed to bootstrap this
                        roster.
                      </p>
                      <Button
                        className="mt-3"
                        variant="secondary"
                        onClick={() => {
                          void handleSyncWweRoster();
                        }}
                        disabled={busyByKey[`sync-wwe-${selectedPromotion.id}`]}
                      >
                        <RefreshCcw className="h-4 w-4 mr-1" />
                        Sync WWE Talent Feed
                      </Button>
                    </div>
                  ) : null}
                  <div className="rounded-md border border-border/70 bg-background/40 p-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label>New Roster Member</Label>
                      <Input
                        value={newMemberName}
                        onChange={(event) =>
                          setNewMemberName(event.target.value)
                        }
                        placeholder="e.g. Randy Orton"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Aliases (comma separated)</Label>
                      <Input
                        value={newMemberAliases}
                        onChange={(event) =>
                          setNewMemberAliases(event.target.value)
                        }
                        placeholder="e.g. The Viper"
                      />
                    </div>
                    <Button
                      onClick={() => {
                        void handleCreateMember();
                      }}
                      disabled={
                        busyByKey[`create-member-${selectedPromotion.id}`]
                      }
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Member
                    </Button>
                  </div>

                  {isLoadingMembers ? (
                    <p className="text-sm text-muted-foreground">
                      Loading roster...
                    </p>
                  ) : members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No roster members for this promotion yet.
                    </p>
                  ) : (
                    members.map((member) => {
                      const saveKey = `save-member-${member.id}`;
                      const deleteKey = `delete-member-${member.id}`;
                      return (
                        <div
                          key={member.id}
                          className="rounded-md border border-border/70 bg-background/30 p-3 space-y-3"
                        >
                          <div className="space-y-1.5">
                            <Label>Name</Label>
                            <Input
                              value={
                                memberNameDrafts[member.id] ??
                                member.displayName
                              }
                              onChange={(event) =>
                                setMemberNameDrafts((prev) => ({
                                  ...prev,
                                  [member.id]: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Aliases</Label>
                            <Input
                              value={
                                memberAliasesDrafts[member.id] ??
                                aliasesToText(member.aliases)
                              }
                              onChange={(event) =>
                                setMemberAliasesDrafts((prev) => ({
                                  ...prev,
                                  [member.id]: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                void handleSaveMember(member);
                              }}
                              disabled={busyByKey[saveKey]}
                            >
                              <Save className="h-4 w-4 mr-1" />
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                void handleDeleteMember(member);
                              }}
                              disabled={busyByKey[deleteKey]}
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
