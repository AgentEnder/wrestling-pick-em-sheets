"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Swords, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  SignInButton,
  SignedIn,
  SignedOut,
  useAuth,
} from "@/lib/client/clerk-test-mode";
import {
  acceptCardInvite,
  getCardInvitePreview,
  type CardInvitePreview,
} from "@/lib/client/card-collaborators-api";

interface CardInviteAcceptProps {
  token: string;
}

export function CardInviteAccept({ token }: CardInviteAcceptProps) {
  const router = useRouter();
  const { userId, isLoaded: isAuthLoaded } = useAuth();

  const [preview, setPreview] = useState<CardInvitePreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setIsLoadingPreview(true);
    setPreviewError(null);

    getCardInvitePreview(token)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreviewError(
            error instanceof Error
              ? error.message
              : "This invite link is no longer valid",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
    // Re-check once auth resolves so viewerIsOwner/viewerIsCollaborator are
    // computed against the signed-in user.
  }, [token, userId]);

  const handleAccept = useCallback(async () => {
    setIsAccepting(true);
    try {
      const result = await acceptCardInvite(token);
      if (result.status === "joined") {
        toast.success("You can now edit this card");
      }
      router.push(`/cards/${result.cardId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to accept invite",
      );
      setIsAccepting(false);
    }
  }, [router, token]);

  const cardLabel = preview
    ? preview.eventName.trim() || preview.cardName
    : "";

  return (
    <div className="relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(230,170,60,0.20),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(130,160,255,0.12),transparent_35%)]" />
      <main className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 py-10">
        <div className="w-full rounded-2xl border border-border/70 bg-card/65 p-6 text-center shadow-[0_24px_50px_rgba(0,0,0,0.28)] backdrop-blur">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Users className="h-5 w-5 text-primary-foreground" />
          </div>

          {isLoadingPreview || !isAuthLoaded ? (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking invite...
            </div>
          ) : previewError || !preview ? (
            <>
              <h1 className="font-heading text-2xl font-bold uppercase tracking-wide text-foreground">
                Invite not available
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {previewError ??
                  "This invite link is no longer valid. Ask the card owner for a new one."}
              </p>
              <Button asChild variant="outline" className="mt-6">
                <Link href="/">
                  <Swords className="h-4 w-4 mr-1" />
                  Back to Pick Em Generator
                </Link>
              </Button>
            </>
          ) : (
            <>
              <h1 className="font-heading text-2xl font-bold uppercase tracking-wide text-foreground">
                Build this card together
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                You&apos;ve been invited to collaborate on
                {" "}
                <span className="font-semibold text-foreground">
                  {cardLabel}
                </span>
                . Collaborators can edit matches, bonus questions, and event
                settings.
              </p>

              <SignedOut>
                <p className="mt-6 text-sm text-muted-foreground">
                  Sign in to accept the invite.
                </p>
                <SignInButton mode="modal">
                  <Button className="mt-3">Sign in to accept</Button>
                </SignInButton>
              </SignedOut>

              <SignedIn>
                {preview.viewerIsOwner ? (
                  <>
                    <p className="mt-6 text-sm text-muted-foreground">
                      This is your card — no need to accept your own invite.
                    </p>
                    <Button asChild className="mt-3">
                      <Link href={`/cards/${preview.cardId}`}>
                        Open the editor
                      </Link>
                    </Button>
                  </>
                ) : preview.viewerIsCollaborator ? (
                  <>
                    <p className="mt-6 text-sm text-muted-foreground">
                      You&apos;re already a collaborator on this card.
                    </p>
                    <Button asChild className="mt-3">
                      <Link href={`/cards/${preview.cardId}`}>
                        Open the editor
                      </Link>
                    </Button>
                  </>
                ) : (
                  <Button
                    className="mt-6"
                    onClick={handleAccept}
                    disabled={isAccepting}
                  >
                    {isAccepting ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : null}
                    Accept invite
                  </Button>
                )}
              </SignedIn>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
