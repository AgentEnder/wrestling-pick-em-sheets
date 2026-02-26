"use client";

import { useEffect, useRef, useState } from "react";
import {
  Globe,
  Laptop,
  Monitor,
  RefreshCcw,
  Smartphone,
  Sparkles,
  Trophy,
  UserRound,
} from "lucide-react";
import { Reorder } from "motion/react";
import QRCode from "qrcode";

import {
  getLiveGameState,
  type LiveGameStateResponse,
} from "@/lib/client/live-games-api";
import { getConnectionStatus } from "@/lib/client/connection-status";
import {
  createScreenWakeLockManager,
  hasAnyPushSubscription,
  registerLiveGameServiceWorker,
  subscribeToLiveGameSwMessages,
  vibrateForeground,
  type WakeLockManager,
} from "@/lib/client/live-game-pwa";
import { cn } from "@/lib/utils";

interface LiveGameDisplayAppProps {
  gameId: string;
  joinCodeFromUrl?: string | null;
}

const POLL_INTERVAL_MS = 10_000;
const REFRESH_STALE_THRESHOLD_MS = POLL_INTERVAL_MS * 5;
const FULLSCREEN_EFFECT_DURATION_MS = 15_000;
const FULLSCREEN_LEADERBOARD_LIMIT = 8;
const LEADERBOARD_SWAP_DURATION_MS = 1_000;
const LEADERBOARD_FINAL_PAUSE_MS = 5_000;
const UPDATE_VIBRATE_PATTERN = [150, 80, 150];

type FullscreenEffect =
  | {
      kind: "events";
      events: LiveGameStateResponse["events"];
    }
  | {
      kind: "leaderboard";
      previous: LiveGameStateResponse["leaderboard"];
      current: LiveGameStateResponse["leaderboard"];
      swapCount: number;
    };

function formatEventTypeLabel(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes("bonus")) return "Bonus Question";
  if (normalized.includes("result")) return "Match Result";
  if (normalized.includes("tiebreaker")) return "Tiebreaker";
  return type.replace(/[_-]/g, " ");
}

function hasLeaderboardChanged(
  previous: LiveGameStateResponse,
  next: LiveGameStateResponse,
): boolean {
  if (previous.leaderboard.length !== next.leaderboard.length) return true;
  for (let index = 0; index < next.leaderboard.length; index += 1) {
    const prior = previous.leaderboard[index];
    const current = next.leaderboard[index];
    if (!prior || !current) return true;
    if (prior.nickname !== current.nickname) return true;
    if (prior.rank !== current.rank) return true;
    if (prior.score !== current.score) return true;
  }
  return false;
}

function hasDisplayStateChanged(
  previous: LiveGameStateResponse,
  next: LiveGameStateResponse,
): boolean {
  if (previous.game.status !== next.game.status) return true;
  if (previous.game.joinCode !== next.game.joinCode) return true;
  if (previous.playerCount !== next.playerCount) return true;
  if (previous.submittedCount !== next.submittedCount) return true;

  if (hasLeaderboardChanged(previous, next)) return true;

  if (previous.events.length !== next.events.length) return true;
  for (let index = 0; index < next.events.length; index += 1) {
    const prior = previous.events[index];
    const current = next.events[index];
    if (!prior || !current) return true;
    if (prior.id !== current.id) return true;
    if (prior.type !== current.type) return true;
    if (prior.message !== current.message) return true;
    if (prior.createdAt !== current.createdAt) return true;
  }

  return false;
}

function buildBubbleSortSteps(
  previous: string[],
  current: string[],
): string[][] {
  const currentSet = new Set(current);
  const start = [
    ...previous.filter((name) => currentSet.has(name)),
    ...current.filter((name) => !previous.includes(name)),
  ];
  const steps: string[][] = [start];
  const working = [...start];
  const targetIndex = new Map(current.map((name, index) => [name, index]));

  for (let outer = 0; outer < working.length; outer += 1) {
    let swapped = false;
    for (let inner = 0; inner < working.length - 1; inner += 1) {
      const left = working[inner];
      const right = working[inner + 1];
      if (
        (targetIndex.get(left) ?? Infinity) <=
        (targetIndex.get(right) ?? Infinity)
      )
        continue;
      working[inner] = right;
      working[inner + 1] = left;
      steps.push([...working]);
      swapped = true;
    }
    if (!swapped) break;
  }

  const finalOrder = steps[steps.length - 1];
  if (
    finalOrder.length !== current.length ||
    finalOrder.some((name, index) => name !== current[index])
  ) {
    steps.push([...current]);
  }

  return steps;
}

function getFullscreenEffectDurationMs(effect: FullscreenEffect): number {
  if (effect.kind === "events") return FULLSCREEN_EFFECT_DURATION_MS;
  return (
    effect.swapCount * LEADERBOARD_SWAP_DURATION_MS + LEADERBOARD_FINAL_PAUSE_MS
  );
}

function formatDeviceType(type: string | null): string {
  if (!type) return "Desktop";
  const normalized = type.toLowerCase();
  if (normalized.includes("mobile")) return "Mobile";
  if (normalized.includes("tablet")) return "Tablet";
  if (normalized.includes("smarttv")) return "TV";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatCountdown(msRemaining: number): string {
  const totalMinutes = Math.max(0, Math.floor(msRemaining / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return `${days} days, ${hours} hours, ${minutes} minutes`;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0.0.0.0"
  );
}

function isUsableQrOrigin(origin: string | null): boolean {
  if (!origin) return false;

  try {
    const parsed = new URL(origin);
    return !isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function LiveGameDisplayApp({
  gameId,
  joinCodeFromUrl,
}: LiveGameDisplayAppProps) {
  const [state, setState] = useState<LiveGameStateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreenEffectQueue, setFullscreenEffectQueue] = useState<
    FullscreenEffect[]
  >([]);
  const [activeFullscreenEffect, setActiveFullscreenEffect] =
    useState<FullscreenEffect | null>(null);
  const [animatedLeaderboardOrder, setAnimatedLeaderboardOrder] = useState<
    string[]
  >([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hasPushTransport, setHasPushTransport] = useState(false);
  const [joinQrCodeDataUrl, setJoinQrCodeDataUrl] = useState<string | null>(
    null,
  );
  const [joinBaseOrigin, setJoinBaseOrigin] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAtMs, setLastRefreshAtMs] = useState<number | null>(null);
  const [nowTickMs, setNowTickMs] = useState(Date.now());
  const previousStateRef = useRef<LiveGameStateResponse | null>(null);
  const fullscreenEffectTimeoutRef = useRef<number | null>(null);
  const leaderboardStepIntervalRef = useRef<number | null>(null);
  const wakeLockManagerRef = useRef<WakeLockManager | null>(null);

  function queueFullscreenEffects(effects: FullscreenEffect[]) {
    if (effects.length === 0) return;
    setFullscreenEffectQueue((previous) => [...previous, ...effects]);
  }

  function dismissActiveFullscreenEffect() {
    if (fullscreenEffectTimeoutRef.current) {
      window.clearTimeout(fullscreenEffectTimeoutRef.current);
      fullscreenEffectTimeoutRef.current = null;
    }
    if (leaderboardStepIntervalRef.current) {
      window.clearInterval(leaderboardStepIntervalRef.current);
      leaderboardStepIntervalRef.current = null;
    }
    setAnimatedLeaderboardOrder([]);
    setActiveFullscreenEffect(null);
  }

  useEffect(() => {
    if (activeFullscreenEffect || fullscreenEffectQueue.length === 0) return;

    const [nextEffect, ...remaining] = fullscreenEffectQueue;
    setFullscreenEffectQueue(remaining);
    setActiveFullscreenEffect(nextEffect);

    if (fullscreenEffectTimeoutRef.current) {
      window.clearTimeout(fullscreenEffectTimeoutRef.current);
    }
    fullscreenEffectTimeoutRef.current = window.setTimeout(() => {
      setActiveFullscreenEffect(null);
    }, getFullscreenEffectDurationMs(nextEffect));
  }, [activeFullscreenEffect, fullscreenEffectQueue]);

  useEffect(() => {
    if (leaderboardStepIntervalRef.current) {
      window.clearInterval(leaderboardStepIntervalRef.current);
      leaderboardStepIntervalRef.current = null;
    }

    if (
      !activeFullscreenEffect ||
      activeFullscreenEffect.kind !== "leaderboard"
    ) {
      setAnimatedLeaderboardOrder([]);
      return;
    }

    const steps = buildBubbleSortSteps(
      activeFullscreenEffect.previous.map((entry) => entry.nickname),
      activeFullscreenEffect.current.map((entry) => entry.nickname),
    );
    setAnimatedLeaderboardOrder(steps[0] ?? []);

    if (steps.length > 1) {
      let stepIndex = 0;
      leaderboardStepIntervalRef.current = window.setInterval(() => {
        stepIndex += 1;
        if (stepIndex >= steps.length) {
          if (leaderboardStepIntervalRef.current) {
            window.clearInterval(leaderboardStepIntervalRef.current);
            leaderboardStepIntervalRef.current = null;
          }
          return;
        }
        setAnimatedLeaderboardOrder(steps[stepIndex]);
      }, LEADERBOARD_SWAP_DURATION_MS);
    }

    return () => {
      if (leaderboardStepIntervalRef.current) {
        window.clearInterval(leaderboardStepIntervalRef.current);
        leaderboardStepIntervalRef.current = null;
      }
    };
  }, [activeFullscreenEffect]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    void registerLiveGameServiceWorker().catch(() => {});
    void hasAnyPushSubscription()
      .then((active) => {
        setHasPushTransport(active);
      })
      .catch(() => {
        setHasPushTransport(false);
      });

    const unsubscribeMessages = subscribeToLiveGameSwMessages(() => {
      vibrateForeground(UPDATE_VIBRATE_PATTERN);
      setHasPushTransport(true);
      setRefreshNonce((current) => current + 1);
    });

    const manager = createScreenWakeLockManager();
    wakeLockManagerRef.current = manager;
    void manager.request();

    return () => {
      unsubscribeMessages();
      wakeLockManagerRef.current = null;
      void manager.destroy();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      try {
        const loaded = await getLiveGameState(
          gameId,
          joinCodeFromUrl ?? undefined,
        );
        if (cancelled) return;
        setLastRefreshAtMs(Date.now());

        const previous = previousStateRef.current;
        if (previous && !hasDisplayStateChanged(previous, loaded)) {
          setError(null);
          setIsRefreshing(false);
          return;
        }

        if (previous) {
          const previousEventIds = new Set(
            previous.events.map((event) => event.id),
          );
          const addedEvents = loaded.events.filter(
            (event) => !previousEventIds.has(event.id),
          );

          const queuedFullscreenEffects: FullscreenEffect[] = [];
          if (addedEvents.length > 0) {
            queuedFullscreenEffects.push({
              kind: "events",
              events: addedEvents.slice(0, 4),
            });
            vibrateForeground(UPDATE_VIBRATE_PATTERN);
          }

          if (hasLeaderboardChanged(previous, loaded)) {
            const bubbleSteps = buildBubbleSortSteps(
              previous.leaderboard
                .slice(0, FULLSCREEN_LEADERBOARD_LIMIT)
                .map((entry) => entry.nickname),
              loaded.leaderboard
                .slice(0, FULLSCREEN_LEADERBOARD_LIMIT)
                .map((entry) => entry.nickname),
            );
            queuedFullscreenEffects.push({
              kind: "leaderboard",
              previous: previous.leaderboard.slice(
                0,
                FULLSCREEN_LEADERBOARD_LIMIT,
              ),
              current: loaded.leaderboard.slice(
                0,
                FULLSCREEN_LEADERBOARD_LIMIT,
              ),
              swapCount: Math.max(1, bubbleSteps.length - 1),
            });
          }

          queueFullscreenEffects(queuedFullscreenEffects);
        }

        previousStateRef.current = loaded;
        setState(loaded);
        setError(null);
        setIsRefreshing(false);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load display state";
        setError(message);
        setIsRefreshing(false);
      }
    }

    void loadState();
    const intervalId = window.setInterval(() => {
      void loadState();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (fullscreenEffectTimeoutRef.current) {
        window.clearTimeout(fullscreenEffectTimeoutRef.current);
      }
      if (leaderboardStepIntervalRef.current) {
        window.clearInterval(leaderboardStepIntervalRef.current);
      }
    };
  }, [gameId, hasPushTransport, joinCodeFromUrl, refreshNonce]);

  useEffect(() => {
    if (!state || state.game.status !== "lobby") {
      setJoinQrCodeDataUrl(null);
      setJoinBaseOrigin(null);
      return;
    }
    const currentState = state;

    let cancelled = false;

    async function generateJoinCodeQr() {
      const browserOrigin = window.location.origin;
      let joinBaseOrigin: string | null = browserOrigin;

      if (isLoopbackHost(window.location.hostname)) {
        try {
          const response = await fetch("/api/runtime/lan-origin", {
            cache: "no-store",
          });
          if (response.ok) {
            const body = (await response.json()) as {
              data?: { origin?: string };
            };
            joinBaseOrigin = body.data?.origin?.trim() ?? null;
          } else {
            joinBaseOrigin = null;
          }
        } catch {
          joinBaseOrigin = null;
        }
      }

      if (!isUsableQrOrigin(joinBaseOrigin)) {
        if (!cancelled) {
          setJoinQrCodeDataUrl(null);
          setJoinBaseOrigin(null);
        }
        return;
      }

      const secretSuffix = currentState.game.qrJoinSecret
        ? `&s=${encodeURIComponent(currentState.game.qrJoinSecret)}`
        : "";
      const joinUrl = `${joinBaseOrigin}/join?code=${encodeURIComponent(currentState.game.joinCode)}${secretSuffix}`;
      if (!cancelled) {
        setJoinBaseOrigin(joinBaseOrigin);
      }
      try {
        const qrUrl = await QRCode.toDataURL(joinUrl, {
          width: 420,
          margin: 1,
        });
        if (!cancelled) {
          setJoinQrCodeDataUrl(qrUrl);
        }
      } catch {
        if (!cancelled) {
          setJoinQrCodeDataUrl(null);
        }
      }
    }

    void generateJoinCodeQr();

    return () => {
      cancelled = true;
    };
  }, [state]);

  function handleRefresh() {
    setIsRefreshing(true);
    setRefreshNonce((current) => current + 1);
  }

  const isRefreshStale =
    lastRefreshAtMs !== null &&
    nowTickMs - lastRefreshAtMs > REFRESH_STALE_THRESHOLD_MS;

  if (!state) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6 text-lg text-muted-foreground">
        {error ?? "Loading live leaderboard..."}
      </div>
    );
  }

  const lobbyCountdownMs = (() => {
    if (state.game.status !== "lobby") return null;
    if (!state.card.eventDate) return null;
    const targetMs = new Date(state.card.eventDate).getTime();
    if (!Number.isFinite(targetMs)) return null;
    return Math.max(0, targetMs - nowTickMs);
  })();
  const lobbyStartAtLabel = (() => {
    if (state.game.status !== "lobby") return null;
    if (!state.card.eventDate) return null;
    const parsed = new Date(state.card.eventDate);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString();
  })();

  return (
    <div className="min-h-screen px-6 py-6">
      {isRefreshStale ? (
        <div className="fixed bottom-4 right-4 z-40">
          <button
            type="button"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-accent disabled:opacity-60"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title={isRefreshing ? "Refreshing..." : "Refresh now"}
          >
            <RefreshCcw
              className={isRefreshing ? "h-5 w-5 animate-spin" : "h-5 w-5"}
            />
          </button>
        </div>
      ) : null}
      {activeFullscreenEffect ? (
        <div
          className={cn(
            "lg-fullscreen-effect",
            activeFullscreenEffect.kind === "events"
              ? "lg-fullscreen-effect-events"
              : "lg-fullscreen-effect-leaderboard",
          )}
          onClick={dismissActiveFullscreenEffect}
        >
          {activeFullscreenEffect.kind === "events" ? (
            <div className="lg-fullscreen-effect-panel">
              <div className="lg-fullscreen-effect-title">
                <Sparkles className="h-6 w-6" />
                <span className="font-heading text-2xl uppercase tracking-wide">
                  Live Results
                </span>
              </div>
              <div className="lg-fullscreen-effect-body">
                {activeFullscreenEffect.events.map((event, index) => (
                  <div
                    key={event.id}
                    className="lg-fullscreen-event-item"
                    style={{ animationDelay: `${index * 110}ms` }}
                  >
                    <p className="text-xs uppercase tracking-wide text-primary/90">
                      {formatEventTypeLabel(event.type)}
                    </p>
                    <p className="text-base text-foreground">{event.message}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="lg-fullscreen-effect-panel">
              <div className="lg-fullscreen-effect-title">
                <Trophy className="h-6 w-6" />
                <span className="font-heading text-2xl uppercase tracking-wide">
                  Leaderboard Shift
                </span>
              </div>
              <div className="lg-fullscreen-effect-body">
                {(() => {
                  const currentByNickname = new Map(
                    activeFullscreenEffect.current.map((entry) => [
                      entry.nickname,
                      entry,
                    ]),
                  );
                  const previousByNickname = new Map(
                    activeFullscreenEffect.previous.map((entry) => [
                      entry.nickname,
                      entry,
                    ]),
                  );
                  const order =
                    animatedLeaderboardOrder.length > 0
                      ? animatedLeaderboardOrder
                      : activeFullscreenEffect.previous.map(
                          (entry) => entry.nickname,
                        );

                  return (
                    <Reorder.Group
                      axis="y"
                      values={order}
                      onReorder={() => {}}
                      className="lg-fullscreen-reorder-list"
                    >
                      {order.map((nickname) => {
                        const entry = currentByNickname.get(nickname);
                        if (!entry) return null;
                        const previousRank =
                          previousByNickname.get(nickname)?.rank ?? null;
                        const rankDelta =
                          previousRank == null ? 0 : previousRank - entry.rank;

                        return (
                          <Reorder.Item
                            key={`fullscreen-lb-${nickname}`}
                            value={nickname}
                            className="lg-fullscreen-leaderboard-row"
                            transition={{
                              duration: 0.9,
                              ease: [0.2, 0.8, 0.2, 1],
                            }}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold">
                                #{entry.rank} {entry.nickname}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {previousRank == null
                                  ? "New to board"
                                  : `Was #${previousRank}`}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-mono text-lg font-semibold">
                                {entry.score}
                              </p>
                              {rankDelta > 0 ? (
                                <p className="text-xs text-emerald-300">
                                  +{rankDelta} rank
                                </p>
                              ) : null}
                              {rankDelta < 0 ? (
                                <p className="text-xs text-amber-300">
                                  {rankDelta} rank
                                </p>
                              ) : null}
                            </div>
                          </Reorder.Item>
                        );
                      })}
                    </Reorder.Group>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      ) : null}
      <header className="mb-6 rounded-2xl border border-border/70 bg-card/90 p-5 shadow-xl shadow-black/25 backdrop-blur">
        <div className="lg:flex lg:items-end lg:justify-between lg:gap-6">
          <div>
            <p className="text-sm uppercase tracking-widest text-primary">
              {state.game.status === "lobby"
                ? "Live Lobby"
                : "Live Leaderboard"}
            </p>
            <h1 className="text-4xl font-heading font-semibold leading-tight">
              {state.card.eventName || "Untitled Event"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Join code{" "}
              <span className="font-mono text-lg text-foreground">
                {state.game.joinCode}
              </span>
            </p>
            {state.game.status === "lobby" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {lobbyCountdownMs != null
                  ? `Event starts in ${formatCountdown(lobbyCountdownMs)}${lobbyStartAtLabel ? ` (${lobbyStartAtLabel})` : ""}`
                  : "Event start time not set"}
              </p>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm text-muted-foreground sm:mt-4 sm:max-w-xl lg:mt-0 lg:min-w-[460px]">
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-center">
              <p className="text-xs uppercase tracking-wide">Players</p>
              <p className="text-xl font-semibold text-foreground">
                {state.playerCount}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-center">
              <p className="text-xs uppercase tracking-wide">Submitted</p>
              <p className="text-xl font-semibold text-foreground">
                {state.submittedCount}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-center">
              <p className="text-xs uppercase tracking-wide">Status</p>
              <p className="text-xl font-semibold capitalize text-foreground">
                {state.game.status}
              </p>
            </div>
          </div>
        </div>
      </header>

      {state.game.status === "lobby" ? (
        <div className="grid gap-5 lg:grid-cols-[1.1fr_1.4fr] lg:items-start">
          <section className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl shadow-black/25 backdrop-blur">
            <h2 className="text-sm uppercase tracking-wide text-muted-foreground">
              Scan To Join
            </h2>
            <div className="mt-3 flex justify-center rounded-xl border border-border/70 bg-background/45 p-5">
              {joinQrCodeDataUrl ? (
                <img
                  src={joinQrCodeDataUrl}
                  alt={`QR code to join room ${state.game.joinCode}`}
                  className="h-72 w-72 rounded-md bg-white p-2 lg:h-80 lg:w-80"
                />
              ) : (
                <p className="py-24 text-sm text-muted-foreground">
                  Waiting for LAN/public URL...
                </p>
              )}
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Open{" "}
              <span className="font-mono text-foreground">
                {joinBaseOrigin ? `${joinBaseOrigin}/join` : ".../join"}
              </span>{" "}
              and enter{" "}
              <span className="font-mono text-foreground">
                {state.game.joinCode}
              </span>
            </p>
          </section>

          <section className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl shadow-black/25 backdrop-blur">
            <h2 className="mb-2 text-sm uppercase tracking-wide text-muted-foreground">
              Joined Players
            </h2>
            <div className="space-y-2">
              {state.joinedPlayers.length > 0 ? (
                state.joinedPlayers.map((player) => {
                  const presence = getConnectionStatus(player.lastSeenAt);
                  const dotClass =
                    presence.state === "online"
                      ? "bg-emerald-500"
                      : presence.state === "idle"
                        ? "bg-amber-500"
                        : "bg-slate-400";

                  const DeviceIcon =
                    player.deviceType &&
                    player.deviceType.toLowerCase().includes("mobile")
                      ? Smartphone
                      : player.deviceType &&
                          player.deviceType.toLowerCase().includes("tablet")
                        ? Smartphone
                        : player.deviceType &&
                            player.deviceType.toLowerCase().includes("desktop")
                          ? Monitor
                          : Laptop;

                  return (
                    <div
                      key={player.id}
                      className="rounded-md border border-border/70 bg-background/45 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold">
                            <UserRound className="mr-1 inline h-4 w-4" />
                            {player.nickname}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Joined{" "}
                            {new Date(player.joinedAt).toLocaleTimeString()}
                            {player.authMethod === "clerk"
                              ? " • Account"
                              : " • Guest"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${dotClass}`}
                          />
                          <span className="capitalize">{presence.state}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/60 px-2 py-1">
                          <Globe className="h-3.5 w-3.5" />
                          {player.browserName ?? "Unknown browser"}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/60 px-2 py-1">
                          <DeviceIcon className="h-3.5 w-3.5" />
                          {player.osName ?? player.platform ?? "Unknown OS"}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/60 px-2 py-1">
                          <Monitor className="h-3.5 w-3.5" />
                          {formatDeviceType(player.deviceType)}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Waiting for players to join...
                </p>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
          <section className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl shadow-black/25 backdrop-blur">
            <div className="grid grid-cols-[72px_1fr_170px_90px] gap-2 border-b border-border/70 pb-2 text-xs uppercase tracking-wide text-muted-foreground">
              <span>Rank</span>
              <span>Player</span>
              <span>Status</span>
              <span className="text-right">Score</span>
            </div>
            <div className="mt-2 space-y-1">
              {state.leaderboard.length > 0 ? (
                state.leaderboard.map((entry, index) => {
                  const presence = getConnectionStatus(entry.lastSeenAt);
                  const dotClass =
                    presence.state === "online"
                      ? "bg-emerald-500"
                      : presence.state === "idle"
                        ? "bg-amber-500"
                        : "bg-slate-400";

                  return (
                    <div
                      key={`${entry.rank}:${entry.nickname}`}
                      className="relative grid grid-cols-[72px_1fr_170px_90px] items-center gap-2 rounded-md border border-border/70 bg-background/45 px-3 py-2"
                    >
                      {index === 0 ? (
                        <div className="absolute -left-2 -top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                          <Trophy className="mr-1 inline h-3 w-3" />
                          Leader
                        </div>
                      ) : null}
                      <span className="font-mono text-xl font-semibold">
                        #{entry.rank}
                      </span>
                      <span className="truncate text-lg">{entry.nickname}</span>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${dotClass}`}
                        />
                        <span className="capitalize">{presence.state}</span>
                        <span>{presence.ageLabel}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-2xl font-semibold">
                          {entry.score}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Waiting for submitted picks...
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl shadow-black/25 backdrop-blur">
            <h2 className="mb-2 text-sm uppercase tracking-wide text-muted-foreground">
              Recent Updates
            </h2>
            <div className="space-y-2">
              {state.events.length > 0 ? (
                state.events.slice(0, 15).map((event) => (
                  <div
                    key={event.id}
                    className="rounded-md border border-border/70 bg-background/45 p-2"
                  >
                    <p className="text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </p>
                    <p className="text-sm">{event.message}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No events yet.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
