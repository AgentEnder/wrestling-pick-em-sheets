"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  cardInviteUrl,
  createCardInvite,
  listCardCollaborators,
  listCardInvites,
  removeCardCollaborator,
  revokeCardInvite,
  type CardCollaboratorSummary,
  type CardInviteSummary,
} from "@/lib/client/card-collaborators-api";

interface ShareCardDialogProps {
  cardId: string;
  trigger: React.ReactNode;
}

export function ShareCardDialog({ cardId, trigger }: ShareCardDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [invites, setInvites] = useState<CardInviteSummary[]>([]);
  const [collaborators, setCollaborators] = useState<
    CardCollaboratorSummary[]
  >([]);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [inviteList, collaboratorList] = await Promise.all([
        listCardInvites(cardId),
        listCardCollaborators(cardId),
      ]);
      setInvites(inviteList);
      setCollaborators(collaboratorList);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load sharing info",
      );
    } finally {
      setIsLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    if (isOpen) {
      void refresh();
    }
  }, [isOpen, refresh]);

  const copyInviteLink = useCallback(async (invite: CardInviteSummary) => {
    try {
      await navigator.clipboard.writeText(cardInviteUrl(invite.token));
      setCopiedInviteId(invite.id);
      setTimeout(() => {
        setCopiedInviteId((current) =>
          current === invite.id ? null : current,
        );
      }, 2000);
      toast.success("Invite link copied");
    } catch {
      toast.error("Failed to copy the invite link");
    }
  }, []);

  const handleCreateInvite = useCallback(async () => {
    setIsCreatingInvite(true);
    try {
      const invite = await createCardInvite(cardId);
      setInvites((current) => [invite, ...current]);
      await copyInviteLink(invite);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create invite",
      );
    } finally {
      setIsCreatingInvite(false);
    }
  }, [cardId, copyInviteLink]);

  const handleRevokeInvite = useCallback(
    async (inviteId: string) => {
      try {
        await revokeCardInvite(cardId, inviteId);
        setInvites((current) =>
          current.filter((invite) => invite.id !== inviteId),
        );
        toast.success("Invite link revoked");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to revoke invite",
        );
      }
    },
    [cardId],
  );

  const handleRemoveCollaborator = useCallback(
    async (collaborator: CardCollaboratorSummary) => {
      try {
        await removeCardCollaborator(cardId, collaborator.userId);
        setCollaborators((current) =>
          current.filter((item) => item.id !== collaborator.id),
        );
        toast.success("Collaborator removed");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to remove collaborator",
        );
      }
    },
    [cardId],
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share this card</DialogTitle>
          <DialogDescription>
            Anyone with an invite link can sign in and edit this card with
            you. Revoking a link stops new people from joining; existing
            collaborators stay until you remove them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Invite links
              </h3>
              <Button
                size="sm"
                onClick={handleCreateInvite}
                disabled={isCreatingInvite}
              >
                {isCreatingInvite ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4 mr-1" />
                )}
                Create invite link
              </Button>
            </div>

            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active invite links. Create one and send it to a
                co-builder.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2"
                  >
                    <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {cardInviteUrl(invite.token)}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void copyInviteLink(invite)}
                      aria-label="Copy invite link"
                    >
                      {copiedInviteId === invite.id ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleRevokeInvite(invite.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Revoke invite link"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Collaborators
            </h3>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : collaborators.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody has joined yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {collaborators.map((collaborator) => (
                  <li
                    key={collaborator.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2"
                  >
                    <UserRound className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {collaborator.userEmail ?? collaborator.userId}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        void handleRemoveCollaborator(collaborator)
                      }
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove collaborator"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
