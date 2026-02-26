"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getLiveGameJoinPreview,
  joinLiveGame,
  type LiveGameJoinPreviewResponse,
} from "@/lib/client/live-games-api";
import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
} from "@/lib/client/clerk-test-mode";

const LAST_NICKNAME_STORAGE_KEY = "live-game:last-nickname";

type UserAgentDataValues = {
  architecture?: string;
  model?: string;
  platform?: string;
  platformVersion?: string;
  fullVersionList?: Array<{ brand: string; version: string }>;
};

type UserAgentDataLike = {
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<UserAgentDataValues>;
};

async function getJoinDeviceInfo(): Promise<{
  userAgent: string | null;
  userAgentData?: Record<string, unknown>;
}> {
  if (typeof navigator === "undefined") {
    return { userAgent: null };
  }

  const userAgent = navigator.userAgent || null;
  const uaData = (
    navigator as Navigator & { userAgentData?: UserAgentDataLike }
  ).userAgentData;

  if (!uaData) {
    return { userAgent };
  }

  const lowEntropy = {
    brands: uaData.brands ?? [],
    mobile: uaData.mobile ?? false,
    platform: uaData.platform ?? "",
  };

  try {
    const highEntropy = uaData.getHighEntropyValues
      ? await uaData.getHighEntropyValues([
          "architecture",
          "model",
          "platform",
          "platformVersion",
          "fullVersionList",
        ])
      : {};

    return {
      userAgent,
      userAgentData: {
        ...lowEntropy,
        ...highEntropy,
      },
    };
  } catch {
    return {
      userAgent,
      userAgentData: lowEntropy,
    };
  }
}

function buildClerkNicknameCandidate(rawUser: unknown): string {
  if (!rawUser || typeof rawUser !== "object") return "";
  const user = rawUser as Record<string, unknown>;

  const fullName =
    typeof user.fullName === "string" ? user.fullName.trim() : "";
  if (fullName) return fullName;

  const firstName =
    typeof user.firstName === "string" ? user.firstName.trim() : "";
  const lastName =
    typeof user.lastName === "string" ? user.lastName.trim() : "";
  const combined = `${firstName} ${lastName}`.trim();
  if (combined) return combined;

  const username =
    typeof user.username === "string" ? user.username.trim() : "";
  if (username) return username;

  const primaryEmail = user.primaryEmailAddress as
    | { emailAddress?: string }
    | null
    | undefined;
  const email =
    typeof primaryEmail?.emailAddress === "string"
      ? primaryEmail.emailAddress.trim()
      : "";
  if (email.includes("@")) {
    const [prefix] = email.split("@");
    return prefix?.trim() ?? "";
  }

  return "";
}

function formatCountdown(msRemaining: number): string {
  const totalMinutes = Math.max(0, Math.floor(msRemaining / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return `${days} days, ${hours} hours, ${minutes} minutes`;
}

export default function JoinPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isSignedIn } = useUser();
  const initialCode = useMemo(
    () => searchParams.get("code") ?? "",
    [searchParams],
  );
  const bypassSecret = useMemo(
    () => searchParams.get("s") ?? null,
    [searchParams],
  );
  const clerkNickname = useMemo(
    () => buildClerkNicknameCandidate(user),
    [user],
  );
  const accountLabel = useMemo(() => {
    const fullName = user?.fullName?.trim();
    if (fullName) return fullName;

    const username = user?.username?.trim();
    if (username) return username;

    const email = user?.primaryEmailAddress?.emailAddress?.trim();
    return email ?? null;
  }, [user]);

  const [joinCode, setJoinCode] = useState(initialCode);
  const [nickname, setNickname] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [joinPreview, setJoinPreview] =
    useState<LiveGameJoinPreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [nowTickMs, setNowTickMs] = useState(Date.now());
  const [isPendingApproval, setIsPendingApproval] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedNickname =
      window.localStorage.getItem(LAST_NICKNAME_STORAGE_KEY)?.trim() ?? "";
    if (storedNickname) {
      setNickname(storedNickname);
      return;
    }

    if (clerkNickname) {
      setNickname(clerkNickname);
    }
  }, [clerkNickname]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const normalizedCode = joinCode.trim().toUpperCase();
    if (normalizedCode.length < 4) {
      setJoinPreview(null);
      setIsLoadingPreview(false);
      return;
    }

    let cancelled = false;
    setIsLoadingPreview(true);
    const timeoutId = window.setTimeout(() => {
      void getLiveGameJoinPreview(normalizedCode)
        .then((preview) => {
          if (cancelled) return;
          setJoinPreview(preview);
        })
        .catch(() => {
          if (cancelled) return;
          setJoinPreview(null);
        })
        .finally(() => {
          if (cancelled) return;
          setIsLoadingPreview(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [joinCode]);

  async function handleJoin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsJoining(true);
    setIsPendingApproval(false);

    try {
      const normalizedNickname = nickname.trim();
      if (!normalizedNickname) {
        toast.error("Please enter a nickname");
        return;
      }

      const deviceInfo = await getJoinDeviceInfo();
      const joined = await joinLiveGame(
        joinCode,
        normalizedNickname,
        deviceInfo,
        bypassSecret,
      );
      if (joined.status === "pending") {
        setIsPendingApproval(true);
        toast.info("Waiting for host approval");
        return;
      }
      window.localStorage.setItem(
        LAST_NICKNAME_STORAGE_KEY,
        normalizedNickname,
      );
      router.push(
        `/games/${joined.gameId}/play?code=${encodeURIComponent(joined.joinCode)}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to join game";
      toast.error(message);
    } finally {
      setIsJoining(false);
    }
  }

  const countdownMs = useMemo(() => {
    if (!joinPreview?.eventStartAt || joinPreview.isStarted) return null;
    const targetMs = new Date(joinPreview.eventStartAt).getTime();
    if (!Number.isFinite(targetMs)) return null;
    return Math.max(0, targetMs - nowTickMs);
  }, [joinPreview?.eventStartAt, joinPreview?.isStarted, nowTickMs]);

  useEffect(() => {
    if (!isPendingApproval) return;

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      const normalizedNickname = nickname.trim();
      const normalizedCode = joinCode.trim();
      if (!normalizedNickname || !normalizedCode) return;

      void getJoinDeviceInfo()
        .then((deviceInfo) =>
          joinLiveGame(
            normalizedCode,
            normalizedNickname,
            deviceInfo,
            bypassSecret,
          ),
        )
        .then((result) => {
          if (cancelled) return;
          if (result.status !== "joined") return;
          window.localStorage.setItem(
            LAST_NICKNAME_STORAGE_KEY,
            normalizedNickname,
          );
          router.push(
            `/games/${result.gameId}/play?code=${encodeURIComponent(result.joinCode)}`,
          );
        })
        .catch(() => {});
    }, 4_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [bypassSecret, isPendingApproval, joinCode, nickname, router]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <form
        onSubmit={handleJoin}
        className="w-full rounded-xl border border-border bg-card p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Join Live Game</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the room code from the TV and choose a nickname.
            </p>
          </div>
          <SignedIn>
            <UserButton afterSignOutUrl="/join" />
          </SignedIn>
        </div>

        <div className="mt-3 rounded-md border border-border/70 bg-background/40 px-3 py-2">
          <SignedIn>
            <p className="text-sm">
              Joining as{" "}
              <span className="font-medium">
                {accountLabel ?? "Signed-in user"}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Your account is linked to this room entry.
            </p>
          </SignedIn>
          <SignedOut>
            <p className="text-xs text-muted-foreground">
              Joining as guest. Sign in to link this entry to your account.
            </p>
            <SignInButton mode="modal">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
              >
                Sign in
              </Button>
            </SignInButton>
          </SignedOut>
        </div>

        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor="join-code"
              className="text-xs text-muted-foreground"
            >
              Join code
            </label>
            <Input
              id="join-code"
              value={joinCode}
              onChange={(event) =>
                setJoinCode(event.target.value.toUpperCase())
              }
              placeholder="ABC123"
              maxLength={24}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="nickname" className="text-xs text-muted-foreground">
              Nickname
            </label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="Your nickname"
              maxLength={60}
              required
            />
          </div>
        </div>

        <div className="mt-4 rounded-md border border-border/70 bg-background/40 px-3 py-2">
          {isLoadingPreview ? (
            <p className="text-xs text-muted-foreground">
              Checking room status...
            </p>
          ) : joinPreview ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">{joinPreview.eventName}</p>
              <p className="text-xs text-muted-foreground">
                Status:{" "}
                <span className="capitalize text-foreground">
                  {joinPreview.status}
                </span>
              </p>
              {joinPreview.isStarted ? (
                <p className="text-xs text-emerald-400">Started</p>
              ) : countdownMs != null ? (
                <p className="text-xs text-amber-300">
                  Starts in {formatCountdown(countdownMs)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Start time not set
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Enter a valid join code to preview start time.
            </p>
          )}
        </div>

        <Button type="submit" className="mt-4 w-full" disabled={isJoining}>
          {isJoining ? "Joining..." : "Join Game"}
        </Button>
        {isPendingApproval ? (
          <p className="mt-2 text-center text-xs text-amber-300">
            Pending host approval. This page will auto-join when approved.
          </p>
        ) : null}
        {!isSignedIn ? (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Guest joins are supported.
          </p>
        ) : null}
      </form>
    </div>
  );
}
