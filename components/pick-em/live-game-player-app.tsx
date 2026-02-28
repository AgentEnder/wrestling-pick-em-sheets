"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getLiveGameMe,
  getLiveGameState,
  saveMyLiveGamePicks,
  submitMyLiveGamePicks,
  type LiveGameMeResponse,
  type LiveGameStateResponse,
} from "@/lib/client/live-games-api";
import {
  createScreenWakeLockManager,
  getNotificationPermission,
  isWebPushSupported,
  registerLiveGameServiceWorker,
  requestNotificationPermission,
  subscribeToLiveGamePush,
  subscribeToLiveGameSwMessages,
  unsubscribeFromLiveGamePush,
  vibrateForeground,
  type WakeLockManager,
} from "@/lib/client/live-game-pwa";
import type {
  LivePlayerMatchPick,
  LivePlayerPicksPayload,
} from "@/lib/types";
import {
  hasLeaderboardChanged,
  buildBubbleSortSteps,
} from "@/lib/pick-em/leaderboard-utils";
import { useRosterSuggestions } from "@/hooks/use-roster-suggestions";
import {
  useFullscreenEffects,
  type FullscreenEffect,
} from "@/hooks/use-fullscreen-effects";
import { toast } from "sonner";

import { FullscreenEffectOverlay } from "./shared/fullscreen-effect-overlay";
import { LeaderboardPanel } from "./shared/leaderboard-panel";
import { UpdatesFeed } from "./shared/updates-feed";
import { PlayerHeader } from "./live-player/player-header";
import { PlayerMatchPicks } from "./live-player/player-match-picks";
import { PlayerEventBonusPicks } from "./live-player/player-event-bonus-picks";
import { PlayerTiebreakerInput } from "./live-player/player-tiebreaker-input";

interface LiveGamePlayerAppProps {
  gameId: string;
  joinCodeFromUrl?: string | null;
}

const POLL_INTERVAL_MS = 10_000;
const REFRESH_STALE_THRESHOLD_MS = POLL_INTERVAL_MS * 5;
const FULLSCREEN_LEADERBOARD_LIMIT = 8;
const UPDATE_VIBRATE_PATTERN = [110, 60, 110];

const PLAYER_FULLSCREEN_HIDDEN_EVENT_TYPES = new Set([
  "player.submitted",
  "player.pending",
  "player.denied",
  "player.joined",
  "player.approved",
]);

function getPushPromptStorageKey(gameId: string, playerId: string): string {
  return `live-game-push-prompted:${gameId}:${playerId}`;
}

export function LiveGamePlayerApp({
  gameId,
  joinCodeFromUrl,
}: LiveGamePlayerAppProps) {
  /* ---- Local state ---- */
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [me, setMe] = useState<LiveGameMeResponse | null>(null);
  const [state, setState] = useState<LiveGameStateResponse | null>(null);
  const [picks, setPicks] = useState<LivePlayerPicksPayload | null>(null);
  const roster = useRosterSuggestions({
    promotionName: state?.card.promotionName,
  });
  const [battleRoyalEntryInputByMatchId, setBattleRoyalEntryInputByMatchId] =
    useState<Record<string, string>>({});

  /* Fullscreen effects hook */
  const { activeEffect, animatedLeaderboardOrder, queueEffects, dismiss } =
    useFullscreenEffects();

  /* Page fullscreen state */
  const [isPageFullscreen, setIsPageFullscreen] = useState(false);

  /* Wake lock */
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const [wakeLockSupported, setWakeLockSupported] = useState(false);
  const wakeLockManagerRef = useRef<WakeLockManager | null>(null);

  /* Push notifications */
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [isPushSupported, setIsPushSupported] = useState(false);
  const [isPushPromptOpen, setIsPushPromptOpen] = useState(false);
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [isPushSubscribing, setIsPushSubscribing] = useState(false);

  /* Refresh staleness */
  const [lastRefreshAtMs, setLastRefreshAtMs] = useState<number | null>(null);
  const [nowTickMs, setNowTickMs] = useState(Date.now());

  /* Refs */
  const previousStateRef = useRef<LiveGameStateResponse | null>(null);
  const hasHydratedInitialStateRef = useRef(false);

  /* ---- Derived values ---- */
  const isRefreshStale =
    lastRefreshAtMs !== null &&
    nowTickMs - lastRefreshAtMs > REFRESH_STALE_THRESHOLD_MS;

  const lobbyCountdownMs = useMemo(() => {
    if (state?.game.status !== "lobby") return null;
    if (!state.card.eventDate) return null;
    const targetMs = new Date(state.card.eventDate).getTime();
    if (!Number.isFinite(targetMs)) return null;
    return Math.max(0, targetMs - nowTickMs);
  }, [nowTickMs, state?.card.eventDate, state?.game.status]);

  const lobbyStartAtLabel = useMemo(() => {
    if (state?.game.status !== "lobby") return null;
    if (!state.card.eventDate) return null;
    const parsed = new Date(state.card.eventDate);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString();
  }, [state?.card.eventDate, state?.game.status]);

  const myRank = useMemo(
    () =>
      state?.leaderboard.find(
        (entry) => entry.nickname === me?.player.nickname,
      ) ?? null,
    [state?.leaderboard, me?.player.nickname],
  );

  const lockSnapshot = me?.locks;

  /* ---- Core data loading ---- */
  const applyGameUpdate = useCallback(
    (
      nextState: LiveGameStateResponse,
      nextMe: LiveGameMeResponse,
      animate: boolean,
    ) => {
      if (!animate) {
        previousStateRef.current = nextState;
        setState(nextState);
        setMe((current) => {
          if (!current) return nextMe;
          return {
            ...current,
            game: nextMe.game,
            locks: nextMe.locks,
            player: {
              ...current.player,
              isSubmitted: nextMe.player.isSubmitted,
              submittedAt: nextMe.player.submittedAt,
              updatedAt: nextMe.player.updatedAt,
            },
          };
        });
        if (!hasHydratedInitialStateRef.current) {
          setPicks(nextMe.player.picks);
          hasHydratedInitialStateRef.current = true;
        }
        return;
      }

      const previousState = previousStateRef.current;
      previousStateRef.current = nextState;
      if (!previousState) return;

      const previousEventIds = new Set(
        previousState.events.map((event) => event.id),
      );
      const addedEvents = nextState.events.filter(
        (event) =>
          !previousEventIds.has(event.id) &&
          !PLAYER_FULLSCREEN_HIDDEN_EVENT_TYPES.has(event.type),
      );
      const leaderboardChanged = hasLeaderboardChanged(
        previousState,
        nextState,
      );

      const queuedFullscreenEffects: FullscreenEffect[] = [];
      if (addedEvents.length > 0) {
        queuedFullscreenEffects.push({
          kind: "events",
          events: addedEvents.slice(0, 4),
        });
        vibrateForeground(UPDATE_VIBRATE_PATTERN);
      }
      if (leaderboardChanged) {
        const bubbleSteps = buildBubbleSortSteps(
          previousState.leaderboard
            .slice(0, FULLSCREEN_LEADERBOARD_LIMIT)
            .map((entry) => entry.nickname),
          nextState.leaderboard
            .slice(0, FULLSCREEN_LEADERBOARD_LIMIT)
            .map((entry) => entry.nickname),
        );
        queuedFullscreenEffects.push({
          kind: "leaderboard",
          previous: previousState.leaderboard.slice(
            0,
            FULLSCREEN_LEADERBOARD_LIMIT,
          ),
          current: nextState.leaderboard.slice(0, FULLSCREEN_LEADERBOARD_LIMIT),
          swapCount: Math.max(1, bubbleSteps.length - 1),
        });
      }
      queueEffects(queuedFullscreenEffects);

      setState(nextState);
      setMe((current) => {
        if (!current) return nextMe;
        return {
          ...current,
          game: nextMe.game,
          locks: nextMe.locks,
          player: {
            ...current.player,
            isSubmitted: nextMe.player.isSubmitted,
            submittedAt: nextMe.player.submittedAt,
            updatedAt: nextMe.player.updatedAt,
          },
        };
      });
      if (!hasHydratedInitialStateRef.current) {
        setPicks(nextMe.player.picks);
        hasHydratedInitialStateRef.current = true;
      }
    },
    [queueEffects],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [loadedMe, loadedState] = await Promise.all([
        getLiveGameMe(gameId),
        getLiveGameState(gameId, joinCodeFromUrl ?? undefined),
      ]);
      applyGameUpdate(loadedState, loadedMe, false);
      setLastRefreshAtMs(Date.now());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load game";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [applyGameUpdate, gameId, joinCodeFromUrl]);

  /* ---- Effects ---- */
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setWakeLockSupported("wakeLock" in navigator);
    setIsPushSupported(isWebPushSupported());
    setNotificationPermission(getNotificationPermission());

    void registerLiveGameServiceWorker().catch(() => {});
    const unsubscribeMessages = subscribeToLiveGameSwMessages(() => {
      vibrateForeground(UPDATE_VIBRATE_PATTERN);
      void load();
    });

    const manager = createScreenWakeLockManager((isActive) => {
      setIsWakeLockActive(isActive);
    });
    wakeLockManagerRef.current = manager;

    return () => {
      unsubscribeMessages();
      wakeLockManagerRef.current = null;
      void manager.destroy();
    };
  }, [load]);

  useEffect(() => {
    if (!isPushSupported || !me) return;

    const promptStorageKey = getPushPromptStorageKey(gameId, me.player.id);
    const promptedBefore =
      window.localStorage.getItem(promptStorageKey) === "1";

    if (notificationPermission === "granted") {
      if (isPushSubscribed || isPushSubscribing) return;
      setIsPushSubscribing(true);
      void subscribeToLiveGamePush(gameId)
        .then(() => {
          setIsPushSubscribed(true);
        })
        .catch(() => {
          setIsPushSubscribed(false);
        })
        .finally(() => {
          setIsPushSubscribing(false);
        });
      return;
    }

    if (notificationPermission === "default" && !promptedBefore) {
      setIsPushPromptOpen(true);
    }
  }, [
    gameId,
    isPushSubscribed,
    isPushSubscribing,
    isPushSupported,
    me,
    notificationPermission,
  ]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void Promise.all([
        getLiveGameState(gameId, joinCodeFromUrl ?? undefined),
        getLiveGameMe(gameId),
      ])
        .then(([nextState, nextMe]) => {
          applyGameUpdate(nextState, nextMe, true);
          setLastRefreshAtMs(Date.now());
        })
        .catch(() => {
          // Keep current state when polling fails.
        });
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [
    applyGameUpdate,
    gameId,
    isPushSubscribed,
    joinCodeFromUrl,
    notificationPermission,
  ]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsPageFullscreen(document.fullscreenElement != null);
    };
    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  /* ---- Picks mutation handlers ---- */
  function setMatchWinner(matchId: string, winnerName: string) {
    setPicks((prev) => {
      if (!prev) return prev;
      const nextMatchPicks = [...prev.matchPicks];
      const index = nextMatchPicks.findIndex(
        (pick) => pick.matchId === matchId,
      );

      const nextPick: LivePlayerMatchPick = {
        matchId,
        winnerName,
        battleRoyalEntrants:
          index === -1 ? [] : nextMatchPicks[index].battleRoyalEntrants,
        bonusAnswers: index === -1 ? [] : nextMatchPicks[index].bonusAnswers,
      };

      if (index === -1) {
        nextMatchPicks.push(nextPick);
      } else {
        nextMatchPicks[index] = nextPick;
      }

      return { ...prev, matchPicks: nextMatchPicks };
    });
  }

  function addBattleRoyalEntrant(matchId: string, entrantName: string) {
    const entrant = entrantName.trim();
    if (!entrant) return;

    setPicks((prev) => {
      if (!prev) return prev;

      const nextMatchPicks = [...prev.matchPicks];
      let index = nextMatchPicks.findIndex((pick) => pick.matchId === matchId);
      if (index === -1) {
        nextMatchPicks.push({
          matchId,
          winnerName: "",
          battleRoyalEntrants: [],
          bonusAnswers: [],
        });
        index = nextMatchPicks.length - 1;
      }

      const existingEntrants = nextMatchPicks[index].battleRoyalEntrants;
      const hasDuplicate = existingEntrants.some(
        (item) => item.toLowerCase() === entrant.toLowerCase(),
      );
      if (hasDuplicate) return prev;

      nextMatchPicks[index] = {
        ...nextMatchPicks[index],
        battleRoyalEntrants: [...existingEntrants, entrant],
      };

      return { ...prev, matchPicks: nextMatchPicks };
    });

    setBattleRoyalEntryInputByMatchId((prev) => ({ ...prev, [matchId]: "" }));
    roster.clearSuggestions();
  }

  function removeBattleRoyalEntrant(matchId: string, entrantIndex: number) {
    setPicks((prev) => {
      if (!prev) return prev;

      const nextMatchPicks = [...prev.matchPicks];
      const index = nextMatchPicks.findIndex(
        (pick) => pick.matchId === matchId,
      );
      if (index === -1) return prev;

      nextMatchPicks[index] = {
        ...nextMatchPicks[index],
        battleRoyalEntrants: nextMatchPicks[index].battleRoyalEntrants.filter(
          (_, i) => i !== entrantIndex,
        ),
      };

      return { ...prev, matchPicks: nextMatchPicks };
    });
  }

  function setMatchBonusAnswer(
    matchId: string,
    questionId: string,
    answer: string,
  ) {
    setPicks((prev) => {
      if (!prev) return prev;

      const nextMatchPicks = [...prev.matchPicks];
      let index = nextMatchPicks.findIndex((pick) => pick.matchId === matchId);
      if (index === -1) {
        nextMatchPicks.push({
          matchId,
          winnerName: "",
          battleRoyalEntrants: [],
          bonusAnswers: [],
        });
        index = nextMatchPicks.length - 1;
      }

      const current = nextMatchPicks[index];
      const nextAnswers = [...current.bonusAnswers];
      const answerIndex = nextAnswers.findIndex(
        (item) => item.questionId === questionId,
      );

      if (answerIndex === -1) {
        nextAnswers.push({ questionId, answer });
      } else {
        nextAnswers[answerIndex] = { questionId, answer };
      }

      nextMatchPicks[index] = { ...current, bonusAnswers: nextAnswers };
      return { ...prev, matchPicks: nextMatchPicks };
    });
  }

  function setEventBonusAnswer(questionId: string, answer: string) {
    setPicks((prev) => {
      if (!prev) return prev;
      const nextAnswers = [...prev.eventBonusAnswers];
      const index = nextAnswers.findIndex(
        (item) => item.questionId === questionId,
      );
      if (index === -1) {
        nextAnswers.push({ questionId, answer });
      } else {
        nextAnswers[index] = { questionId, answer };
      }
      return { ...prev, eventBonusAnswers: nextAnswers };
    });
  }

  function setTiebreakerAnswer(answer: string) {
    setPicks((prev) => {
      if (!prev) return prev;
      return { ...prev, tiebreakerAnswer: answer };
    });
  }

  /* ---- Action handlers ---- */
  async function handleSave() {
    if (!picks || !me) return;

    setIsSaving(true);
    try {
      const saved = await saveMyLiveGamePicks(gameId, picks, {
        expectedUpdatedAt: me.player.updatedAt,
      });
      setMe((prev) =>
        prev ? { ...prev, player: saved.player } : prev,
      );

      if (!saved.player.isSubmitted) {
        const submitted = await submitMyLiveGamePicks(gameId);
        setMe((prev) =>
          prev ? { ...prev, player: submitted } : prev,
        );
      }

      if (saved.ignoredLocks.length > 0) {
        toast.warning(
          `Saved with ${saved.ignoredLocks.length} locked field(s) ignored.`,
        );
      } else {
        toast.success("Picks saved");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save picks";
      if (message.includes("changed in another session")) {
        await load();
      }
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await load();
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleTogglePageFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to toggle fullscreen mode";
      toast.error(message);
    }
  }

  async function handleToggleWakeLock() {
    const manager = wakeLockManagerRef.current;
    if (!manager) return;
    if (isWakeLockActive) {
      await manager.release();
      return;
    }
    const locked = await manager.request();
    if (!locked) {
      toast.error("Wake lock unavailable. Keep this page visible and retry.");
    }
  }

  async function handleEnableNotifications() {
    if (!isPushSupported) {
      toast.error("Push notifications are not supported in this browser.");
      return;
    }
    if (!me) return;

    const promptStorageKey = getPushPromptStorageKey(gameId, me.player.id);
    window.localStorage.setItem(promptStorageKey, "1");

    const nextPermission = await requestNotificationPermission();
    setNotificationPermission(nextPermission);

    if (nextPermission === "granted") {
      setIsPushSubscribing(true);
      try {
        await subscribeToLiveGamePush(gameId);
        setIsPushSubscribed(true);
        toast.success("Notifications enabled");
      } catch {
        setIsPushSubscribed(false);
        toast.error("Unable to enable push notifications for this game");
      } finally {
        setIsPushSubscribing(false);
      }
    } else if (nextPermission === "denied") {
      toast.error("Notifications blocked in browser settings");
      await unsubscribeFromLiveGamePush(gameId);
      setIsPushSubscribed(false);
    }

    setIsPushPromptOpen(false);
  }

  function handleDismissPushPrompt() {
    if (me) {
      const promptStorageKey = getPushPromptStorageKey(gameId, me.player.id);
      window.localStorage.setItem(promptStorageKey, "1");
    }
    setIsPushPromptOpen(false);
  }

  /* ---- Loading gate ---- */
  if (isLoading || !me || !state || !picks || !lockSnapshot) {
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 text-sm text-muted-foreground">
        Loading game...
      </div>
    );
  }

  /* ---- Render ---- */
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <Dialog
        open={isPushPromptOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsPushPromptOpen(true);
            return;
          }
          handleDismissPushPrompt();
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Enable Live Game Alerts?</DialogTitle>
            <DialogDescription>
              We use push notifications to alert you about scoring updates while
              this live game is in progress, including when the app is
              backgrounded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleDismissPushPrompt}>
              Not Now
            </Button>
            <Button onClick={() => void handleEnableNotifications()}>
              Enable Notifications
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FullscreenEffectOverlay
        activeEffect={activeEffect}
        animatedLeaderboardOrder={animatedLeaderboardOrder}
        onDismiss={dismiss}
      />

      <PlayerHeader
        gameId={gameId}
        joinCodeFromUrl={joinCodeFromUrl}
        state={state}
        me={me}
        myRank={myRank ? { rank: myRank.rank, score: myRank.score } : null}
        lobbyCountdownMs={lobbyCountdownMs}
        lobbyStartAtLabel={lobbyStartAtLabel}
        isSaving={isSaving}
        isPageFullscreen={isPageFullscreen}
        isWakeLockActive={isWakeLockActive}
        wakeLockSupported={wakeLockSupported}
        notificationPermission={notificationPermission}
        isPushSubscribed={isPushSubscribed}
        isPushSubscribing={isPushSubscribing}
        onSave={() => void handleSave()}
        onToggleFullscreen={() => void handleTogglePageFullscreen()}
        onToggleWakeLock={() => void handleToggleWakeLock()}
        onEnableNotifications={() => void handleEnableNotifications()}
        onOpenPushPrompt={() => setIsPushPromptOpen(true)}
      />

      {isRefreshStale ? (
        <div className="fixed bottom-4 right-4 z-40">
          <Button
            type="button"
            size="icon"
            className="h-12 w-12 rounded-full shadow-lg"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            title={isRefreshing ? "Refreshing..." : "Refresh now"}
          >
            <RefreshCcw
              className={isRefreshing ? "h-5 w-5 animate-spin" : "h-5 w-5"}
            />
          </Button>
        </div>
      ) : null}

      {state.card.matches.map((match, index) => (
        <PlayerMatchPicks
          key={match.id}
          matchIndex={index}
          match={match}
          picks={picks}
          locks={lockSnapshot}
          roster={roster}
          battleRoyalEntryInput={battleRoyalEntryInputByMatchId[match.id] ?? ""}
          onSetMatchWinner={setMatchWinner}
          onAddBattleRoyalEntrant={addBattleRoyalEntrant}
          onRemoveBattleRoyalEntrant={removeBattleRoyalEntrant}
          onSetBattleRoyalEntryInput={(matchId, value) =>
            setBattleRoyalEntryInputByMatchId((prev) => ({
              ...prev,
              [matchId]: value,
            }))
          }
          onSetMatchBonusAnswer={setMatchBonusAnswer}
        />
      ))}

      <PlayerEventBonusPicks
        card={state.card}
        picks={picks}
        locks={lockSnapshot}
        roster={roster}
        onSetEventBonusAnswer={setEventBonusAnswer}
      />

      <PlayerTiebreakerInput
        tiebreakerLabel={state.card.tiebreakerLabel}
        picks={picks}
        locks={lockSnapshot}
        onSetTiebreakerAnswer={setTiebreakerAnswer}
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card/90 p-4 shadow-lg shadow-black/20 backdrop-blur">
          <h3 className="font-semibold">Leaderboard</h3>
          <div className="mt-2">
            <LeaderboardPanel
              leaderboard={state.leaderboard}
              maxItems={12}
              myNickname={me.player.nickname}
              variant="compact"
            />
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/90 p-4 shadow-lg shadow-black/20 backdrop-blur">
          <h3 className="font-semibold">Updates</h3>
          <div className="mt-2">
            <UpdatesFeed
              events={state.events}
              maxItems={12}
              variant="compact"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
