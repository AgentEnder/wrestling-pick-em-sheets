# My Games Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add score snapshots, a "My Games" page with historical stats, and active game links on the home hub.

**Architecture:** Score snapshots are written to a new `live_game_score_snapshots` table whenever the host updates the key. The existing `computeLeaderboard()` is reused for the computation but results are persisted. A new `/api/my-games` route joins players, games, and snapshots for the authenticated user. The `/my-games` page displays stats, a trend chart, active games, and history. The home hub gets a small active games card.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Kysely + LibSQL, Recharts (via shadcn chart), Tailwind v4, Clerk auth

---

### Task 1: Database Migration — Create `live_game_score_snapshots` Table

**Files:**
- Create: `migrations/0024_score_snapshots.ts`

**Step 1: Write the migration file**

```typescript
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('live_game_score_snapshots')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('game_id', 'text', (col) => col.notNull().references('live_games.id').onDelete('cascade'))
    .addColumn('player_id', 'text', (col) => col.notNull().references('live_game_players.id').onDelete('cascade'))
    .addColumn('total_score', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_possible_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('winner_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('bonus_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('surprise_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('rank', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('player_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('score_percentage', 'real', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createIndex('idx_score_snapshots_game_player')
    .ifNotExists()
    .on('live_game_score_snapshots')
    .columns(['game_id', 'player_id'])
    .unique()
    .execute()

  await db.schema
    .createIndex('idx_score_snapshots_player')
    .ifNotExists()
    .on('live_game_score_snapshots')
    .columns(['player_id'])
    .execute()

  await db.schema
    .createIndex('idx_live_game_players_clerk_user')
    .ifNotExists()
    .on('live_game_players')
    .columns(['clerk_user_id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_live_game_players_clerk_user').ifExists().execute()
  await db.schema.dropIndex('idx_score_snapshots_player').ifExists().execute()
  await db.schema.dropIndex('idx_score_snapshots_game_player').ifExists().execute()
  await db.schema.dropTable('live_game_score_snapshots').ifExists().execute()
}
```

**Step 2: Run migration and regenerate types**

Run: `pnpm db:codegen`
Expected: Migration applies, `lib/server/db/generated.ts` regenerated with new `LiveGameScoreSnapshots` interface and `live_game_score_snapshots` entry in the `DB` interface.

**Step 3: Verify generated types**

Open `lib/server/db/generated.ts` and confirm:
- A `LiveGameScoreSnapshots` interface exists with all columns
- The `DB` interface includes `live_game_score_snapshots: LiveGameScoreSnapshots`

**Step 4: Commit**

```bash
git add migrations/0024_score_snapshots.ts lib/server/db/generated.ts
git commit -m "feat: add live_game_score_snapshots table and player indexes"
```

---

### Task 2: Implement `computeMaxPossiblePoints()` Utility

**Files:**
- Create: `lib/server/scoring-utils.ts`

**Step 1: Write the utility**

This function calculates the maximum possible points for a card. It needs access to the `ResolvedCard` type from `@/lib/server/repositories/cards` and the `BonusQuestion` type from `@/lib/types`.

```typescript
import type { ResolvedCard } from "@/lib/server/repositories/cards";
import type { BonusQuestion } from "@/lib/types";

function bonusQuestionPoints(
  questions: BonusQuestion[],
  defaultPoints: number,
): number {
  return questions.reduce((sum, q) => {
    const pts = q.points ?? defaultPoints;
    return pts > 0 ? sum + pts : sum;
  }, 0);
}

export function computeMaxPossiblePoints(card: ResolvedCard): number {
  let total = 0;

  for (const match of card.matches) {
    // Winner pick points
    const matchPoints = match.points ?? card.defaultPoints;
    if (matchPoints > 0) total += matchPoints;

    // Surprise entrant points (battle royal)
    if (match.matchType === "battleRoyal" && match.surpriseSlots > 0) {
      const surprisePointsEach =
        match.surpriseEntrantPoints ?? card.defaultPoints;
      if (surprisePointsEach > 0) {
        total += match.surpriseSlots * surprisePointsEach;
      }
    }

    // Match-level bonus questions
    total += bonusQuestionPoints(match.bonusQuestions, card.defaultPoints);
  }

  // Event-level bonus questions
  total += bonusQuestionPoints(card.eventBonusQuestions, card.defaultPoints);

  return total;
}
```

**Important:** Check the `Match` type in `lib/types.ts` for the exact field names. The match type field should be `matchType` and surprise slots should be `surpriseSlots`. Surprise points per entrant may be `surpriseEntrantPoints` or `surprisePoints` — verify the `Match` interface in `lib/types.ts` and adjust accordingly.

**Step 2: Commit**

```bash
git add lib/server/scoring-utils.ts
git commit -m "feat: add computeMaxPossiblePoints utility"
```

---

### Task 3: Implement `snapshotScores()` Repository Function

**Files:**
- Modify: `lib/server/repositories/live-games.ts`

**Step 1: Add the snapshotScores function**

Add this exported function to `live-games.ts`. It reuses the existing `computeLeaderboard()` function (already in the same file) and the new `computeMaxPossiblePoints()`.

Add the import at the top of the file:

```typescript
import { computeMaxPossiblePoints } from "@/lib/server/scoring-utils";
```

Add the function (place it after the `updateLiveGameKeyForHost` function around line 2198):

```typescript
export async function snapshotScores(
  gameId: string,
  card: ResolvedCard,
  keyPayload: LiveGameKeyPayload,
): Promise<void> {
  const playerRows = await db
    .selectFrom("live_game_players")
    .selectAll()
    .where("game_id", "=", gameId)
    .where("join_status", "=", "approved")
    .execute();

  const players = playerRows.map((row) => mapLiveGamePlayer(row));
  const leaderboard = computeLeaderboard(card, keyPayload, players);
  const maxPossiblePoints = computeMaxPossiblePoints(card);
  const now = nowIso();
  const submittedCount = leaderboard.filter((e) => e.isSubmitted).length;

  // Find player IDs by nickname for the join
  const nicknameToPlayerId = new Map<string, string>();
  for (const player of players) {
    nicknameToPlayerId.set(normalizeText(player.nickname), player.id);
  }

  for (const entry of leaderboard) {
    if (!entry.isSubmitted) continue;

    const playerId = nicknameToPlayerId.get(normalizeText(entry.nickname));
    if (!playerId) continue;

    const percentage =
      maxPossiblePoints > 0
        ? (entry.score / maxPossiblePoints) * 100
        : 0;

    // Upsert: insert or update on conflict of (game_id, player_id)
    await db
      .insertInto("live_game_score_snapshots")
      .values({
        game_id: gameId,
        player_id: playerId,
        total_score: entry.score,
        max_possible_points: maxPossiblePoints,
        winner_points: entry.breakdown.winnerPoints,
        bonus_points: entry.breakdown.bonusPoints,
        surprise_points: entry.breakdown.surprisePoints,
        rank: entry.rank,
        player_count: submittedCount,
        score_percentage: Math.round(percentage * 100) / 100,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.columns(["game_id", "player_id"]).doUpdateSet({
          total_score: entry.score,
          max_possible_points: maxPossiblePoints,
          winner_points: entry.breakdown.winnerPoints,
          bonus_points: entry.breakdown.bonusPoints,
          surprise_points: entry.breakdown.surprisePoints,
          rank: entry.rank,
          player_count: submittedCount,
          score_percentage: Math.round(percentage * 100) / 100,
          updated_at: now,
        }),
      )
      .execute();
  }
}
```

**Step 2: Verify it compiles**

Run: `pnpm build`
Expected: No type errors.

**Step 3: Commit**

```bash
git add lib/server/repositories/live-games.ts lib/server/scoring-utils.ts
git commit -m "feat: add snapshotScores repository function"
```

---

### Task 4: Wire Snapshot Into Key Update

**Files:**
- Modify: `lib/server/repositories/live-games.ts` (the `updateLiveGameKeyForHost` function, around line 2129)

**Step 1: Call snapshotScores after key update**

In `updateLiveGameKeyForHost`, after the push notification block (around line 2195), add the snapshot call. The `card` and `mergedPayload` variables are already in scope:

```typescript
  // After the events/push block and before `return mapLiveGame(updated);`
  await snapshotScores(gameId, card, mergedPayload);

  return mapLiveGame(updated);
```

This means every key update triggers a snapshot. The snapshot uses the freshly merged payload, not the previous one.

**Step 2: Verify it compiles**

Run: `pnpm build`
Expected: No type errors.

**Step 3: Commit**

```bash
git add lib/server/repositories/live-games.ts
git commit -m "feat: trigger score snapshot on every key update"
```

---

### Task 5: Modify State Reads to Use Snapshots

**Files:**
- Modify: `lib/server/repositories/live-games.ts` (the `getLiveGameState` function, around line 3032)

**Step 1: Add snapshot-based leaderboard read**

In `getLiveGameState`, replace the direct `computeLeaderboard` call (line 3066) with a snapshot read that falls back to computation:

```typescript
  // Replace the existing:
  //   const leaderboard = computeLeaderboard(access.card, access.game.keyPayload, approvedPlayers);
  // With:
  const snapshotRows = await db
    .selectFrom("live_game_score_snapshots")
    .selectAll()
    .where("game_id", "=", gameId)
    .execute();

  let leaderboard: LiveGameLeaderboardEntry[];

  if (snapshotRows.length > 0) {
    // Build leaderboard from snapshots
    const playerIdToPlayer = new Map(
      approvedPlayers.map((p) => [p.id, p]),
    );

    leaderboard = snapshotRows
      .map((snap) => {
        const player = playerIdToPlayer.get(snap.player_id);
        if (!player) return null;
        return {
          rank: snap.rank,
          nickname: player.nickname,
          score: snap.total_score,
          breakdown: {
            winnerPoints: snap.winner_points,
            bonusPoints: snap.bonus_points,
            surprisePoints: snap.surprise_points,
          },
          isSubmitted: player.isSubmitted,
          lastUpdatedAt: player.updatedAt,
          lastSeenAt: player.lastSeenAt,
        } satisfies LiveGameLeaderboardEntry;
      })
      .filter((entry): entry is LiveGameLeaderboardEntry => entry !== null)
      .sort((a, b) => a.rank - b.rank);
  } else {
    // Fallback: compute on the fly (no key updates yet)
    leaderboard = computeLeaderboard(
      access.card,
      access.game.keyPayload,
      approvedPlayers,
    );
  }
```

**Step 2: Verify it compiles**

Run: `pnpm build`
Expected: No type errors.

**Step 3: Commit**

```bash
git add lib/server/repositories/live-games.ts
git commit -m "feat: read leaderboard from snapshots with computation fallback"
```

---

### Task 6: Extend Game Lifetime

**Files:**
- Modify: `lib/server/repositories/live-games.ts`

**Step 1: Change expiration to far-future**

Change the `LIVE_GAME_DURATION_MS` constant (line 47) from 12 hours to 1 year:

```typescript
// Before:
const LIVE_GAME_DURATION_MS = 1000 * 60 * 60 * 12;
// After:
const LIVE_GAME_DURATION_MS = 1000 * 60 * 60 * 24 * 365;
```

**Step 2: Commit**

```bash
git add lib/server/repositories/live-games.ts
git commit -m "feat: extend game lifetime to 1 year for historical viewing"
```

---

### Task 7: Create `GET /api/my-games` Route

**Files:**
- Create: `app/api/my-games/route.ts`

**Step 1: Write the API route**

This route is authenticated via Clerk. It queries `live_game_players` joined with `live_games` and `live_game_score_snapshots` for the current user's `clerk_user_id`.

```typescript
import { NextResponse } from "next/server";

import { getRequestUserId } from "@/lib/server/auth";
import { db } from "@/lib/server/db/client";

export async function GET(request: Request) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all games this user has played in
  const rows = await db
    .selectFrom("live_game_players as p")
    .innerJoin("live_games as g", "g.id", "p.game_id")
    .innerJoin("cards as c", "c.id", "g.card_id")
    .leftJoin("live_game_score_snapshots as s", (join) =>
      join
        .onRef("s.game_id", "=", "p.game_id")
        .onRef("s.player_id", "=", "p.id"),
    )
    .select([
      "g.id as gameId",
      "g.status",
      "g.join_code as joinCode",
      "g.ended_at as endedAt",
      "g.created_at as createdAt",
      "c.name as cardName",
      "c.event_name as eventName",
      "c.promotion_name as promotionName",
      "c.event_date as eventDate",
      "s.total_score as totalScore",
      "s.max_possible_points as maxPossible",
      "s.score_percentage as scorePercentage",
      "s.rank",
      "s.player_count as playerCount",
      "s.winner_points as winnerPoints",
      "s.bonus_points as bonusPoints",
      "s.surprise_points as surprisePoints",
    ])
    .where("p.clerk_user_id", "=", userId)
    .where("p.join_status", "=", "approved")
    .orderBy("g.created_at", "desc")
    .execute();

  const activeGames = rows
    .filter((r) => r.status === "lobby" || r.status === "live")
    .map((r) => ({
      gameId: r.gameId,
      cardName: r.cardName,
      eventName: r.eventName,
      promotionName: r.promotionName,
      eventDate: r.eventDate,
      status: r.status as "lobby" | "live",
      joinCode: r.joinCode,
      score:
        r.totalScore != null
          ? {
              totalScore: r.totalScore,
              maxPossible: r.maxPossible!,
              rank: r.rank!,
              playerCount: r.playerCount!,
            }
          : undefined,
    }));

  const completedGames = rows
    .filter((r) => r.status === "ended" && r.totalScore != null)
    .map((r) => ({
      gameId: r.gameId,
      cardName: r.cardName,
      eventName: r.eventName,
      promotionName: r.promotionName,
      eventDate: r.eventDate,
      endedAt: r.endedAt!,
      score: {
        totalScore: r.totalScore!,
        maxPossible: r.maxPossible!,
        scorePercentage: r.scorePercentage!,
        rank: r.rank!,
        playerCount: r.playerCount!,
        winnerPoints: r.winnerPoints!,
        bonusPoints: r.bonusPoints!,
        surprisePoints: r.surprisePoints!,
      },
    }));

  // Compute stats from completed games
  const gamesPlayed = completedGames.length;
  const avgScorePercentage =
    gamesPlayed > 0
      ? Math.round(
          (completedGames.reduce((sum, g) => sum + g.score.scorePercentage, 0) /
            gamesPlayed) *
            100,
        ) / 100
      : 0;
  const bestScorePercentage =
    gamesPlayed > 0
      ? Math.max(...completedGames.map((g) => g.score.scorePercentage))
      : 0;

  // Best rank: lowest rank number with its player count
  let bestRank = "";
  if (gamesPlayed > 0) {
    const best = completedGames.reduce((best, g) =>
      g.score.rank < best.score.rank ? g : best,
    );
    bestRank = `${ordinal(best.score.rank)} of ${best.score.playerCount}`;
  }

  // Trend data: last 20 completed games in chronological order
  const trendData = completedGames
    .slice(0, 20)
    .reverse()
    .map((g) => ({
      eventName: g.eventName || g.cardName,
      scorePercentage: g.score.scorePercentage,
      date: g.endedAt,
    }));

  return NextResponse.json({
    data: {
      activeGames,
      completedGames,
      stats: {
        gamesPlayed,
        avgScorePercentage,
        bestScorePercentage,
        bestRank,
        trendData,
      },
    },
  });
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
```

**Step 2: Verify it compiles**

Run: `pnpm build`
Expected: No type errors.

**Step 3: Commit**

```bash
git add app/api/my-games/route.ts
git commit -m "feat: add GET /api/my-games endpoint"
```

---

### Task 8: Create Client API Wrapper

**Files:**
- Create: `lib/client/my-games-api.ts`

**Step 1: Write the client wrapper**

Follow the exact pattern from `lib/client/cards-api.ts`:

```typescript
interface ApiDataEnvelope<T> {
  data: T;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(await parseErrorMessage(response));
  const body = (await response.json()) as ApiDataEnvelope<T>;
  return body.data;
}

export interface MyGameScore {
  totalScore: number;
  maxPossible: number;
  rank: number;
  playerCount: number;
}

export interface MyGameCompletedScore extends MyGameScore {
  scorePercentage: number;
  winnerPoints: number;
  bonusPoints: number;
  surprisePoints: number;
}

export interface MyActiveGame {
  gameId: string;
  cardName: string;
  eventName: string;
  promotionName: string;
  eventDate: string;
  status: "lobby" | "live";
  joinCode: string;
  score?: MyGameScore;
}

export interface MyCompletedGame {
  gameId: string;
  cardName: string;
  eventName: string;
  promotionName: string;
  eventDate: string;
  endedAt: string;
  score: MyGameCompletedScore;
}

export interface MyGamesTrendPoint {
  eventName: string;
  scorePercentage: number;
  date: string;
}

export interface MyGamesStats {
  gamesPlayed: number;
  avgScorePercentage: number;
  bestScorePercentage: number;
  bestRank: string;
  trendData: MyGamesTrendPoint[];
}

export interface MyGamesResponse {
  activeGames: MyActiveGame[];
  completedGames: MyCompletedGame[];
  stats: MyGamesStats;
}

export function fetchMyGames(): Promise<MyGamesResponse> {
  return requestJson<MyGamesResponse>("/api/my-games");
}
```

**Step 2: Commit**

```bash
git add lib/client/my-games-api.ts
git commit -m "feat: add my-games client API wrapper"
```

---

### Task 9: Create `/my-games` Page Shell and Route

**Files:**
- Create: `app/my-games/page.tsx`
- Create: `components/pick-em/my-games-page.tsx`

**Step 1: Create the page route**

Follow the same thin-shell pattern as `app/cards/page.tsx`:

```typescript
// app/my-games/page.tsx
import { MyGamesPage } from "@/components/pick-em/my-games-page";

export default function Page() {
  return <MyGamesPage />;
}
```

**Step 2: Create the main component**

Follow the same layout pattern as `components/pick-em/cards-workspace.tsx` — full page with gradient, sticky header, AppNavbar, auth check, data fetch on mount.

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Gamepad2,
  History,
  Swords,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";

import { AppNavbar } from "@/components/pick-em/app-navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useAuth,
  useUser,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from "@/lib/client/clerk-test-mode";
import {
  fetchMyGames,
  type MyActiveGame,
  type MyCompletedGame,
  type MyGamesStats,
} from "@/lib/client/my-games-api";
import { isAdminEmail } from "@/lib/server/auth";

export function MyGamesPage() {
  const { isLoaded: isAuthLoaded } = useAuth();
  const { user } = useUser();
  const isAdminUser = isAdminEmail(user?.primaryEmailAddress?.emailAddress);

  const [activeGames, setActiveGames] = useState<MyActiveGame[]>([]);
  const [completedGames, setCompletedGames] = useState<MyCompletedGame[]>([]);
  const [stats, setStats] = useState<MyGamesStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadGames = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchMyGames();
      setActiveGames(data.activeGames);
      setCompletedGames(data.completedGames);
      setStats(data.stats);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load games",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthLoaded && user) {
      void loadGames();
    }
  }, [isAuthLoaded, user, loadGames]);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      {/* Gradient overlay — same as home hub */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(circle at 10% 0%, rgba(230,170,60,0.20), transparent 35%), radial-gradient(circle at 90% 100%, rgba(59,130,246,0.10), transparent 35%)",
        }}
      />

      {/* Sticky header — same as cards workspace */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-xl supports-backdrop-filter:bg-background/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-primary" />
              <span className="font-heading text-lg font-bold tracking-wide">
                Pick Em Sheets
              </span>
            </Link>
            <AppNavbar isAdminUser={isAdminUser} />
          </div>
          <div className="flex items-center gap-2">
            <SignedOut>
              <SignInButton mode="modal">
                <Button size="sm" variant="outline">
                  Sign in
                </Button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:py-8">
        <div className="flex items-center gap-3">
          <Trophy className="h-6 w-6 text-primary" />
          <h1 className="font-heading text-2xl font-bold tracking-wide">
            My Games
          </h1>
        </div>

        {!isAuthLoaded || isLoading ? (
          <p className="text-sm text-muted-foreground">Loading games...</p>
        ) : !user ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">
                Sign in to see your game history.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Stats bar */}
            {stats && stats.gamesPlayed > 0 && (
              <StatsBar stats={stats} />
            )}

            {/* Trend chart */}
            {stats && stats.trendData.length > 1 && (
              <TrendChart data={stats.trendData} />
            )}

            {/* Active games */}
            {activeGames.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary">
                  <Gamepad2 className="h-4 w-4" />
                  Active Games
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {activeGames.map((game) => (
                    <ActiveGameCard key={game.gameId} game={game} />
                  ))}
                </div>
              </section>
            )}

            {/* History */}
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary">
                <History className="h-4 w-4" />
                History
              </h2>
              {completedGames.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No completed games yet. Join a live game to get started!
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {completedGames.map((game) => (
                    <CompletedGameCard key={game.gameId} game={game} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
```

Note: `StatsBar`, `TrendChart`, `ActiveGameCard`, and `CompletedGameCard` are sub-components defined in later tasks. For now, create them as placeholder stubs at the bottom of this same file to get it compiling:

```tsx
function StatsBar({ stats }: { stats: MyGamesStats }) {
  return <div>Stats: {stats.gamesPlayed} games</div>;
}

function TrendChart({ data }: { data: MyGamesStats["trendData"] }) {
  return <div>Trend chart ({data.length} points)</div>;
}

function ActiveGameCard({ game }: { game: MyActiveGame }) {
  return <div>{game.eventName}</div>;
}

function CompletedGameCard({ game }: { game: MyCompletedGame }) {
  return <div>{game.eventName}</div>;
}
```

**Important:** The `isAdminEmail` function is a server-side export from `lib/server/auth.ts`. Since this component is `"use client"`, check how the existing home hub and cards workspace handle the admin check. They may use a different approach (e.g., passing `isAdminUser` as a prop, or checking the email client-side). Match their pattern exactly.

**Step 3: Verify it compiles**

Run: `pnpm build`
Expected: No type errors. The `/my-games` route is accessible.

**Step 4: Commit**

```bash
git add app/my-games/page.tsx components/pick-em/my-games-page.tsx
git commit -m "feat: add /my-games page shell with data fetching"
```

---

### Task 10: Build Stats Bar Component

**Files:**
- Modify: `components/pick-em/my-games-page.tsx` (replace `StatsBar` stub)

**Step 1: Implement StatsBar**

Replace the `StatsBar` stub with:

```tsx
function StatsBar({ stats }: { stats: MyGamesStats }) {
  const statItems = [
    { label: "Games Played", value: String(stats.gamesPlayed) },
    { label: "Avg Score", value: `${stats.avgScorePercentage.toFixed(1)}%` },
    { label: "Best Score", value: `${stats.bestScorePercentage.toFixed(1)}%` },
    { label: "Best Finish", value: stats.bestRank },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {statItems.map((item) => (
        <Card key={item.label}>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold tabular-nums">{item.value}</p>
            <p className="text-xs text-muted-foreground">{item.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add components/pick-em/my-games-page.tsx
git commit -m "feat: implement stats bar on my-games page"
```

---

### Task 11: Build Trend Chart Component

**Files:**
- Modify: `components/pick-em/my-games-page.tsx` (replace `TrendChart` stub)

**Step 1: Implement TrendChart**

Uses the shadcn chart components wrapping Recharts. Study `components/ui/chart.tsx` — the key wrapper is `ChartContainer` which takes a `config: ChartConfig` and renders children inside a `ResponsiveContainer`.

Replace the `TrendChart` stub. Add necessary imports at the top of the file:

```tsx
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
```

```tsx
const trendChartConfig = {
  scorePercentage: {
    label: "Score %",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function TrendChart({ data }: { data: MyGamesStats["trendData"] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart3 className="h-4 w-4 text-primary" />
          Performance Trend
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={trendChartConfig} className="h-[200px] w-full">
          <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="fillScore" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-scorePercentage)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--color-scorePercentage)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="eventName"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickFormatter={(value: string) =>
                value.length > 12 ? value.slice(0, 12) + "..." : value
              }
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              fontSize={11}
              domain={[0, 100]}
              tickFormatter={(value: number) => `${value}%`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label: string) => label}
                  formatter={(value) => [`${value}%`, "Score"]}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="scorePercentage"
              stroke="var(--color-scorePercentage)"
              fill="url(#fillScore)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
```

**Step 2: Verify it compiles**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add components/pick-em/my-games-page.tsx
git commit -m "feat: implement performance trend chart on my-games page"
```

---

### Task 12: Build Game Cards (Active + Completed)

**Files:**
- Modify: `components/pick-em/my-games-page.tsx` (replace `ActiveGameCard` and `CompletedGameCard` stubs)

**Step 1: Implement ActiveGameCard**

```tsx
function ActiveGameCard({ game }: { game: MyActiveGame }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold">
            {game.eventName || game.cardName}
          </CardTitle>
          <Badge variant={game.status === "live" ? "default" : "secondary"}>
            {game.status === "live" ? "Live" : "Lobby"}
          </Badge>
        </div>
        {game.promotionName && (
          <CardDescription className="text-xs">
            {game.promotionName}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-3 pt-0">
        {game.score && (
          <p className="text-sm tabular-nums text-muted-foreground">
            {game.score.totalScore} / {game.score.maxPossible} pts
            {" · "}
            {ordinal(game.score.rank)} of {game.score.playerCount}
          </p>
        )}
        <Button asChild size="sm" className="w-full">
          <Link href={`/games/${game.gameId}/play?code=${encodeURIComponent(game.joinCode)}`}>
            Rejoin
            <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
```

**Step 2: Implement CompletedGameCard**

```tsx
function CompletedGameCard({ game }: { game: MyCompletedGame }) {
  const dateLabel = game.eventDate
    ? new Date(game.eventDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : new Date(game.endedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold">
            {game.eventName || game.cardName}
          </CardTitle>
          <span className="shrink-0 text-xs text-muted-foreground">
            {dateLabel}
          </span>
        </div>
        {game.promotionName && (
          <CardDescription className="text-xs">
            {game.promotionName}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-3 pt-0">
        <div>
          <p className="text-lg font-bold tabular-nums">
            {game.score.scorePercentage.toFixed(1)}%
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {game.score.totalScore} / {game.score.maxPossible} pts
            {" · "}
            {ordinal(game.score.rank)} of {game.score.playerCount}
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="w-full">
          <Link href={`/games/${game.gameId}/play?code=${encodeURIComponent(game.joinCode || "")}`}>
            View Results
            <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
```

**Note:** The `CompletedGameCard` references `game.joinCode` but that field is not in the `MyCompletedGame` type. Either add `joinCode` to the completed game API response, or link to `/games/${game.gameId}/play` without the code param (verify the player can access via their session cookie). Check how the play page handles access — if it requires a code query param, add `joinCode` to the completed games response in `app/api/my-games/route.ts`.

**Step 3: Verify it compiles**

Run: `pnpm build`

**Step 4: Commit**

```bash
git add components/pick-em/my-games-page.tsx
git commit -m "feat: implement active and completed game cards"
```

---

### Task 13: Add "My Games" to Navigation

**Files:**
- Modify: `components/pick-em/app-navbar.tsx`

**Step 1: Add My Games to PRIMARY_ITEMS**

In the `PRIMARY_ITEMS` array (line 27), add the new route:

```typescript
const PRIMARY_ITEMS: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/join", label: "Join" },
  { href: "/cards", label: "Cards" },
  { href: "/my-games", label: "My Games" },
];
```

**Step 2: Verify it compiles**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add components/pick-em/app-navbar.tsx
git commit -m "feat: add My Games to navigation"
```

---

### Task 14: Add Active Games Card to Home Hub

**Files:**
- Modify: `components/pick-em/home-hub.tsx`

**Step 1: Add active games fetch**

In the `HomeHub` component, add a new state and fetch for active games. Import the client API:

```typescript
import { fetchMyGames, type MyActiveGame } from "@/lib/client/my-games-api";
```

Add state alongside the existing state:

```typescript
const [activeGames, setActiveGames] = useState<MyActiveGame[]>([]);
```

In the existing `useEffect` or data loading callback, add the my-games fetch (guarded by the user being signed in):

```typescript
// Add to the existing load function or create a new effect
useEffect(() => {
  if (!user) return;
  void fetchMyGames()
    .then((data) => setActiveGames(data.activeGames))
    .catch(() => {
      // Silently fail — the home hub works without this
    });
}, [user]);
```

**Step 2: Render the active games card**

Add a new section card in the home hub layout. Place it in the right column or below the existing content. It should only show when the user is signed in and has active games:

```tsx
{activeGames.length > 0 && (
  <div className="rounded-2xl border border-border/70 bg-card/75 p-5 shadow-[0_20px_40px_rgba(0,0,0,0.25)] backdrop-blur">
    <h3 className="mb-3 text-xs uppercase tracking-[0.18em] text-primary">
      Active Games
    </h3>
    <div className="flex flex-col gap-2">
      {activeGames.slice(0, 3).map((game) => (
        <Link
          key={game.gameId}
          href={`/games/${game.gameId}/play?code=${encodeURIComponent(game.joinCode)}`}
          className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 transition-colors hover:bg-muted/50"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {game.eventName || game.cardName}
            </p>
            {game.promotionName && (
              <p className="truncate text-xs text-muted-foreground">
                {game.promotionName}
              </p>
            )}
          </div>
          <Badge
            variant={game.status === "live" ? "default" : "secondary"}
            className="ml-2 shrink-0"
          >
            {game.status === "live" ? "Live" : "Lobby"}
          </Badge>
        </Link>
      ))}
    </div>
    {activeGames.length > 3 && (
      <Link
        href="/my-games"
        className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
      >
        View all games
        <ArrowRight className="h-3 w-3" />
      </Link>
    )}
    <Link
      href="/my-games"
      className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      View game history
      <ArrowRight className="h-3 w-3" />
    </Link>
  </div>
)}
```

**Important:** Check the existing home hub component's exact layout structure and add this card in the right column alongside the "Account" and "Last Edited Card" panels. Import `Badge` and `ArrowRight` if not already imported.

**Step 3: Verify it compiles**

Run: `pnpm build`

**Step 4: Commit**

```bash
git add components/pick-em/home-hub.tsx
git commit -m "feat: add active games card to home hub"
```

---

### Task 15: Validation and Cleanup

**Step 1: Run full build**

Run: `pnpm build`
Expected: Clean build, no errors.

**Step 2: Run formatting and linting**

Run: `make fmt && make lint` (or the project's equivalent — check `package.json` for `format` and `lint` scripts)
Expected: All passing.

**Step 3: Manual smoke test**

Start the dev server (`pnpm dev`) and verify:
- `/my-games` loads without errors for a signed-in user
- `/my-games` shows sign-in prompt for unauthenticated users
- Home hub shows active games card when games exist
- Navigation includes "My Games" link

**Step 4: Final commit**

If any cleanup was needed:
```bash
git add -A
git commit -m "chore: cleanup and formatting for my-games feature"
```
