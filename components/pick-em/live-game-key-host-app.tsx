"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCcw, Save } from "lucide-react";
import { toast } from "sonner";

import {
  useLiveCard,
  useLivePayload,
  useLiveUi,
  useLiveGames,
  useLiveGameState,
  useLivePayloadActions,
} from "@/stores/selectors";
import { useAppStore } from "@/stores/app-store";
import { useRosterSuggestions } from "@/hooks/use-roster-suggestions";
import {
  getLiveGameKey,
  getLiveGameState,
  saveLiveGameKey,
} from "@/lib/client/live-games-api";
import type { LiveGameKeyPayload } from "@/lib/types";
import { snapshotPayload } from "@/lib/pick-em/payload-utils";
import { nowMs } from "@/lib/pick-em/timer-utils";
import { normalizeText } from "@/lib/pick-em/text-utils";
import { computeFuzzyConfidence } from "@/lib/fuzzy-match";

import { HostHeader } from "./live-host/host-header";
import { JoinRequestsPanel } from "./live-host/join-requests-panel";
import { GameLifecycleControls } from "./live-host/game-lifecycle-controls";
import { LockControls } from "./live-host/lock-controls";
import { HostMatchSection } from "./live-host/host-match-section";
import { HostEventBonusSection } from "./live-host/host-event-bonus-section";
import { HostDashboardPanels } from "./live-host/host-dashboard-panels";
import { FUZZY_AUTO_THRESHOLD } from "./live-host/fuzzy-match-review-panel";

/* ---- Constants ---- */

const POLL_INTERVAL_MS = 10_000;
const REFRESH_STALE_THRESHOLD_MS = POLL_INTERVAL_MS * 5;

/* ---- Helpers ---- */

function ensureMatchTimer(
  payload: LiveGameKeyPayload,
  matchId: string,
  label: string,
): LiveGameKeyPayload {
  const timerId = `match:${matchId}`;
  const found = payload.timers.find((timer) => timer.id === timerId);

  if (found) {
    return {
      ...payload,
      timers: payload.timers.map((timer) =>
        timer.id === timerId ? { ...timer, label } : timer,
      ),
    };
  }

  return {
    ...payload,
    timers: [
      ...payload.timers,
      {
        id: timerId,
        label,
        elapsedMs: 0,
        isRunning: false,
        startedAt: null,
      },
    ],
  };
}

function ensureAllMatchTimers(
  payload: LiveGameKeyPayload,
  matches: Array<{ id: string; title: string }>,
): LiveGameKeyPayload {
  return matches.reduce(
    (acc, match, index) =>
      ensureMatchTimer(
        acc,
        match.id,
        `Match ${index + 1}: ${match.title || "Untitled"}`,
      ),
    payload,
  );
}

/* ---- Props ---- */

interface LiveGameKeyHostAppProps {
  gameId: string;
  joinCodeFromUrl?: string | null;
}

/* ---- Component ---- */

export function LiveGameKeyHostApp({
  gameId,
  joinCodeFromUrl,
}: LiveGameKeyHostAppProps) {
  const card = useLiveCard();
  const payload = useLivePayload();
  const ui = useLiveUi();
  const games = useLiveGames();
  const gameState = useLiveGameState();
  const { setLiveTiebreakerAnswer } = useLivePayloadActions();

  const game = games.find((g) => g.id === gameId) ?? null;

  const roster = useRosterSuggestions({ promotionName: card?.promotionName });

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAtMs, setLastRefreshAtMs] = useState<number | null>(null);
  const [nowTickMs, setNowTickMs] = useState(nowMs());

  const hasInitializedRef = useRef(false);
  const isSyncingRef = useRef(false);
  const pendingAutoSyncRef = useRef(false);

  /* ---- Load ---- */

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [keyResponse, stateResponse] = await Promise.all([
        getLiveGameKey(gameId),
        getLiveGameState(gameId, joinCodeFromUrl ?? undefined),
      ]);
      const nextPayload = ensureAllMatchTimers(
        keyResponse.key,
        keyResponse.card.matches,
      );

      const store = useAppStore.getState();
      store.setLiveCard(keyResponse.card);
      store.setLivePayload(nextPayload);
      store.setLockState(keyResponse.locks);
      store.setGames([keyResponse.game]);
      store.setLiveGameState(stateResponse);
      store._markLivePayloadSynced();
      store.setLiveUi({ isDirty: false });

      setLastRefreshAtMs(nowMs());
      hasInitializedRef.current = true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load game key";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [gameId, joinCodeFromUrl]);

  /* Initial load */
  useEffect(() => {
    void load();
  }, [load]);

  /* 1-second tick for stale refresh indicator */
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTickMs(nowMs());
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  /* 10-second polling for game state */
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void getLiveGameState(gameId, joinCodeFromUrl ?? undefined)
        .then((response) => {
          const store = useAppStore.getState();
          store.setLiveGameState(response);
          setLastRefreshAtMs(nowMs());
          if (store.games.length > 0) {
            const currentGame = store.games[0];
            store.setGames([
              {
                ...currentGame,
                status: response.game.status,
                allowLateJoins: response.game.allowLateJoins,
                updatedAt: response.game.updatedAt,
              },
            ]);
          }
        })
        .catch(() => {
          // keep existing state if poll fails
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [gameId, joinCodeFromUrl]);

  /* ---- Sync payload ---- */

  const syncPayload = useCallback(
    async (mode: "manual" | "auto") => {
      const store = useAppStore.getState();
      const currentPayload = store.livePayload;

      if (mode === "auto" && isSyncingRef.current) {
        pendingAutoSyncRef.current = true;
        return false;
      }

      if (mode === "manual") {
        store.setLiveUi({ isSaving: true });
      }

      const payloadSnapshot = snapshotPayload(currentPayload);
      isSyncingRef.current = true;

      try {
        const saved = await saveLiveGameKey(gameId, currentPayload, {
          expectedUpdatedAt: game?.updatedAt,
        });

        const storeAfter = useAppStore.getState();
        storeAfter.setGames([saved]);
        storeAfter.setLockState(saved.lockState);

        if (
          snapshotPayload(storeAfter.livePayload) === payloadSnapshot
        ) {
          storeAfter._markLivePayloadSynced();
        }

        void getLiveGameState(gameId, joinCodeFromUrl ?? undefined)
          .then((response) => {
            useAppStore.getState().setLiveGameState(response);
          })
          .catch(() => {
            // keep previous state on refresh failure
          });

        if (mode === "manual") {
          toast.success("Room key saved");
        }
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save room key";
        if (message.includes("changed in another session")) {
          await load();
        }
        if (mode === "manual") {
          toast.error(message);
        }
        return false;
      } finally {
        isSyncingRef.current = false;
        if (mode === "manual") {
          useAppStore.getState().setLiveUi({ isSaving: false });
        }
        if (pendingAutoSyncRef.current) {
          pendingAutoSyncRef.current = false;
          void syncPayload("auto");
        }
      }
    },
    [game?.updatedAt, gameId, joinCodeFromUrl, load],
  );

  const handleSaveKey = useCallback(async () => {
    await syncPayload("manual");
  }, [syncPayload]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await load();
    } finally {
      setIsRefreshing(false);
    }
  }, [load]);

  /* Auto-sync debounce (dirty -> sync after 700ms) */
  useEffect(() => {
    if (!hasInitializedRef.current || !ui.isDirty) return;
    const timeoutId = window.setTimeout(() => {
      void syncPayload("auto");
    }, 700);
    return () => window.clearTimeout(timeoutId);
  }, [ui.isDirty, payload, syncPayload]);

  /* Auto-accept high-confidence fuzzy matches */
  useEffect(() => {
    if (!gameState?.playerAnswerSummaries?.length) return;
    const store = useAppStore.getState();
    const currentPayload = store.livePayload;
    const currentCard = store.liveCard;
    if (!currentCard) return;

    for (const match of currentCard.matches ?? []) {
      const matchResult = currentPayload.matchResults.find(
        (r) => r.matchId === match.id,
      );
      if (!matchResult) continue;

      // Winner auto-accept
      if (matchResult.winnerName.trim()) {
        const playerWinners = (gameState.playerAnswerSummaries ?? []).map(
          (p) => ({
            nickname: p.nickname,
            normalizedNickname: p.normalizedNickname,
            answer:
              p.matchPicks.find((mp) => mp.matchId === match.id)?.winnerName ??
              "",
          }),
        );
        for (const pa of playerWinners) {
          if (!pa.answer.trim()) continue;
          if (
            normalizeText(pa.answer) === normalizeText(matchResult.winnerName)
          )
            continue;
          const existingOverride = currentPayload.winnerOverrides.some(
            (o) =>
              o.matchId === match.id &&
              normalizeText(o.playerNickname) === pa.normalizedNickname,
          );
          if (existingOverride) continue;
          const confidence = computeFuzzyConfidence(
            pa.answer,
            matchResult.winnerName,
          );
          if (confidence >= FUZZY_AUTO_THRESHOLD) {
            store.setLivePayload({
              ...store.livePayload,
              winnerOverrides: [
                ...store.livePayload.winnerOverrides.filter(
                  (o) =>
                    !(
                      o.matchId === match.id &&
                      normalizeText(o.playerNickname) ===
                        pa.normalizedNickname
                    ),
                ),
                {
                  matchId: match.id,
                  playerNickname: pa.normalizedNickname,
                  accepted: true,
                  source: "host" as const,
                  confidence,
                },
              ],
            });
          }
        }
      }

      // Bonus question auto-accept
      for (const question of match.bonusQuestions) {
        if (
          question.answerType !== "write-in" ||
          (question.valueType !== "string" &&
            question.valueType !== "rosterMember")
        )
          continue;
        const keyAnswer =
          matchResult.bonusAnswers.find((a) => a.questionId === question.id)
            ?.answer ?? "";
        if (!keyAnswer.trim()) continue;

        const playerAnswers = (gameState.playerAnswerSummaries ?? []).map(
          (p) => ({
            nickname: p.nickname,
            normalizedNickname: p.normalizedNickname,
            answer:
              p.matchPicks
                .find((mp) => mp.matchId === match.id)
                ?.bonusAnswers.find((ba) => ba.questionId === question.id)
                ?.answer ?? "",
          }),
        );
        for (const pa of playerAnswers) {
          if (!pa.answer.trim()) continue;
          if (normalizeText(pa.answer) === normalizeText(keyAnswer)) continue;
          const existingOverride = store.livePayload.scoreOverrides.some(
            (o) =>
              o.questionId === question.id &&
              normalizeText(o.playerNickname) === pa.normalizedNickname,
          );
          if (existingOverride) continue;
          const confidence = computeFuzzyConfidence(pa.answer, keyAnswer);
          if (confidence >= FUZZY_AUTO_THRESHOLD) {
            store.setLivePayload({
              ...store.livePayload,
              scoreOverrides: [
                ...store.livePayload.scoreOverrides.filter(
                  (o) =>
                    !(
                      o.questionId === question.id &&
                      normalizeText(o.playerNickname) ===
                        pa.normalizedNickname
                    ),
                ),
                {
                  questionId: question.id,
                  playerNickname: pa.normalizedNickname,
                  accepted: true,
                  source: "host" as const,
                  confidence,
                },
              ],
            });
          }
        }
      }
    }

    // Event bonus auto-accept
    for (const question of currentCard.eventBonusQuestions ?? []) {
      if (
        question.answerType !== "write-in" ||
        (question.valueType !== "string" &&
          question.valueType !== "rosterMember")
      )
        continue;
      const keyAnswer =
        currentPayload.eventBonusAnswers.find(
          (a) => a.questionId === question.id,
        )?.answer ?? "";
      if (!keyAnswer.trim()) continue;

      const playerAnswers = (gameState.playerAnswerSummaries ?? []).map(
        (p) => ({
          nickname: p.nickname,
          normalizedNickname: p.normalizedNickname,
          answer:
            p.eventBonusAnswers.find((ba) => ba.questionId === question.id)
              ?.answer ?? "",
        }),
      );
      for (const pa of playerAnswers) {
        if (!pa.answer.trim()) continue;
        if (normalizeText(pa.answer) === normalizeText(keyAnswer)) continue;
        const store2 = useAppStore.getState();
        const existingOverride = store2.livePayload.scoreOverrides.some(
          (o) =>
            o.questionId === question.id &&
            normalizeText(o.playerNickname) === pa.normalizedNickname,
        );
        if (existingOverride) continue;
        const confidence = computeFuzzyConfidence(pa.answer, keyAnswer);
        if (confidence >= FUZZY_AUTO_THRESHOLD) {
          store2.setLivePayload({
            ...store2.livePayload,
            scoreOverrides: [
              ...store2.livePayload.scoreOverrides.filter(
                (o) =>
                  !(
                    o.questionId === question.id &&
                    normalizeText(o.playerNickname) ===
                      pa.normalizedNickname
                  ),
              ),
              {
                questionId: question.id,
                playerNickname: pa.normalizedNickname,
                accepted: true,
                source: "host" as const,
                confidence,
              },
            ],
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gameState?.playerAnswerSummaries,
    payload?.matchResults,
    payload?.eventBonusAnswers,
    payload?.scoreOverrides,
    payload?.winnerOverrides,
  ]);

  /* ---- Stale refresh indicator ---- */

  const isRefreshStale =
    lastRefreshAtMs !== null &&
    nowTickMs - lastRefreshAtMs > REFRESH_STALE_THRESHOLD_MS;

  /* ---- Loading state ---- */

  if (isLoading || !card || !game) {
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 text-sm text-muted-foreground">
        Loading game host tools...
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <HostHeader
        gameId={gameId}
        onSave={() => void handleSaveKey()}
        onRefresh={() => void handleRefresh()}
      />

      <GameLifecycleControls gameId={gameId} />

      <JoinRequestsPanel gameId={gameId} joinCode={joinCodeFromUrl} />

      <LockControls gameId={gameId} />

      {card.matches.map((_, index) => (
        <HostMatchSection
          key={card.matches[index].id}
          matchIndex={index}
          roster={roster}
          gameId={gameId}
        />
      ))}

      <HostEventBonusSection roster={roster} gameId={gameId} />

      {card.tiebreakerLabel.trim() ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <Label>{card.tiebreakerLabel}</Label>
          <Input
            className="mt-2"
            value={payload.tiebreakerAnswer}
            onChange={(event) => setLiveTiebreakerAnswer(event.target.value)}
            placeholder="Key tiebreaker result"
          />
        </section>
      ) : null}

      <HostDashboardPanels />

      {isRefreshStale ? (
        <div className="fixed bottom-20 right-4 z-40">
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

      {ui.isDirty ? (
        <div className="fixed inset-x-0 bottom-3 z-40 px-4">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
            <p className="text-sm text-amber-200">
              Unsaved key changes. Auto-save is in progress.
            </p>
            <Button
              size="sm"
              onClick={() => void handleSaveKey()}
              disabled={ui.isSaving}
            >
              <Save className="mr-1 h-4 w-4" />
              {ui.isSaving ? "Saving..." : "Save Now"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
