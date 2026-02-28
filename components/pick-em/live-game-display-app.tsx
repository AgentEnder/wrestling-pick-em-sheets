"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import QRCode from "qrcode";

import {
  getLiveGameState,
  type LiveGameStateResponse,
} from "@/lib/client/live-games-api";
import {
  createScreenWakeLockManager,
  hasAnyPushSubscription,
  registerLiveGameServiceWorker,
  subscribeToLiveGameSwMessages,
  vibrateForeground,
  type WakeLockManager,
} from "@/lib/client/live-game-pwa";
import {
  hasLeaderboardChanged,
  buildBubbleSortSteps,
} from "@/lib/pick-em/leaderboard-utils";
import {
  useFullscreenEffects,
  type FullscreenEffect,
} from "@/hooks/use-fullscreen-effects";

import { FullscreenEffectOverlay } from "./shared/fullscreen-effect-overlay";
import { DisplayHeader } from "./live-display/display-header";
import { LobbyView } from "./live-display/lobby-view";
import { ActiveGameView } from "./live-display/active-game-view";
import {
  JoinOverlay,
  type JoinOverlayEntry,
} from "./live-display/join-overlay";

interface LiveGameDisplayAppProps {
  gameId: string;
  joinCodeFromUrl?: string | null;
}

const POLL_INTERVAL_MS = 10_000;
const REFRESH_STALE_THRESHOLD_MS = POLL_INTERVAL_MS * 5;
const FULLSCREEN_LEADERBOARD_LIMIT = 8;
const UPDATE_VIBRATE_PATTERN = [150, 80, 150];
const JOIN_OVERLAY_ENTRY_DURATION_MS = 5_000;

const FULLSCREEN_HIDDEN_EVENT_TYPES = new Set([
  "player.submitted",
  "player.pending",
  "player.denied",
  "lock.global",
  "lock.match",
  "lock.matchBonus",
  "lock.eventBonus",
]);

const JOIN_OVERLAY_EVENT_TYPES = new Set([
  "player.joined",
  "player.approved",
]);

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
  /* ---- Local state ---- */
  const [state, setState] = useState<LiveGameStateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hasPushTransport, setHasPushTransport] = useState(false);
  const [joinQrCodeDataUrl, setJoinQrCodeDataUrl] = useState<string | null>(
    null,
  );
  const [joinBaseOrigin, setJoinBaseOrigin] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAtMs, setLastRefreshAtMs] = useState<number | null>(null);
  const [nowTickMs, setNowTickMs] = useState(Date.now());
  const [joinOverlayEntries, setJoinOverlayEntries] = useState<
    JoinOverlayEntry[]
  >([]);

  /* Fullscreen effects hook */
  const { activeEffect, animatedLeaderboardOrder, queueEffects, dismiss } =
    useFullscreenEffects();

  /* Refs */
  const previousStateRef = useRef<LiveGameStateResponse | null>(null);
  const wakeLockManagerRef = useRef<WakeLockManager | null>(null);

  /* ---- Derived values ---- */
  const isRefreshStale =
    lastRefreshAtMs !== null &&
    nowTickMs - lastRefreshAtMs > REFRESH_STALE_THRESHOLD_MS;

  /* ---- Join overlay expiry ---- */
  useEffect(() => {
    if (joinOverlayEntries.length === 0) return;
    const nextExpiry = Math.min(
      ...joinOverlayEntries.map(
        (e) => e.addedAt + JOIN_OVERLAY_ENTRY_DURATION_MS,
      ),
    );
    const delay = Math.max(0, nextExpiry - Date.now()) + 100;
    const id = window.setTimeout(() => {
      setJoinOverlayEntries((prev) =>
        prev.filter(
          (e) => e.addedAt + JOIN_OVERLAY_ENTRY_DURATION_MS > Date.now(),
        ),
      );
    }, delay);
    return () => window.clearTimeout(id);
  }, [joinOverlayEntries]);

  /* ---- Tick clock ---- */
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  /* ---- Service worker + wake lock ---- */
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

  /* ---- Polling loop ---- */
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
          const allAddedEvents = loaded.events.filter(
            (event) => !previousEventIds.has(event.id),
          );
          const joinAddedEvents = allAddedEvents.filter((event) =>
            JOIN_OVERLAY_EVENT_TYPES.has(event.type),
          );
          const fullscreenAddedEvents = allAddedEvents.filter(
            (event) =>
              !JOIN_OVERLAY_EVENT_TYPES.has(event.type) &&
              !FULLSCREEN_HIDDEN_EVENT_TYPES.has(event.type),
          );

          if (joinAddedEvents.length > 0) {
            const now = Date.now();
            setJoinOverlayEntries((prev) => [
              ...prev.filter(
                (e) =>
                  e.addedAt + JOIN_OVERLAY_ENTRY_DURATION_MS > now,
              ),
              ...joinAddedEvents.map((event) => ({
                id: event.id,
                message: event.message,
                addedAt: now,
              })),
            ]);
          }

          const queuedFullscreenEffects: FullscreenEffect[] = [];
          const hasNewEvents = fullscreenAddedEvents.length > 0;
          const leaderboardChanged = hasLeaderboardChanged(previous, loaded);

          if (hasNewEvents && leaderboardChanged) {
            const bubbleSteps = buildBubbleSortSteps(
              previous.leaderboard
                .slice(0, FULLSCREEN_LEADERBOARD_LIMIT)
                .map((entry) => entry.nickname),
              loaded.leaderboard
                .slice(0, FULLSCREEN_LEADERBOARD_LIMIT)
                .map((entry) => entry.nickname),
            );
            queuedFullscreenEffects.push({
              kind: "combined",
              events: fullscreenAddedEvents.slice(0, 4),
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
            vibrateForeground(UPDATE_VIBRATE_PATTERN);
          } else if (hasNewEvents) {
            queuedFullscreenEffects.push({
              kind: "events",
              events: fullscreenAddedEvents.slice(0, 4),
            });
            vibrateForeground(UPDATE_VIBRATE_PATTERN);
          } else if (leaderboardChanged) {
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

          queueEffects(queuedFullscreenEffects);
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
    };
  }, [gameId, hasPushTransport, joinCodeFromUrl, refreshNonce, queueEffects]);

  /* ---- QR code generation ---- */
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

  /* ---- Action handlers ---- */
  function handleRefresh() {
    setIsRefreshing(true);
    setRefreshNonce((current) => current + 1);
  }

  /* ---- Loading gate ---- */
  if (!state) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6 text-lg text-muted-foreground">
        {error ?? "Loading live leaderboard..."}
      </div>
    );
  }

  /* ---- Derived display values ---- */
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

  /* ---- Render ---- */
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

      <FullscreenEffectOverlay
        activeEffect={activeEffect}
        animatedLeaderboardOrder={animatedLeaderboardOrder}
        onDismiss={dismiss}
      />

      {joinOverlayEntries.length > 0 && !activeEffect ? (
        <JoinOverlay
          entries={joinOverlayEntries}
          onDismiss={() => setJoinOverlayEntries([])}
        />
      ) : null}

      <DisplayHeader
        state={state}
        lobbyCountdownMs={lobbyCountdownMs}
        lobbyStartAtLabel={lobbyStartAtLabel}
      />

      {state.game.status === "lobby" ? (
        <LobbyView
          state={state}
          joinQrCodeDataUrl={joinQrCodeDataUrl}
          joinBaseOrigin={joinBaseOrigin}
        />
      ) : (
        <ActiveGameView state={state} />
      )}
    </div>
  );
}
