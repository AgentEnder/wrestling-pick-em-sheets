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
      joinCode: r.joinCode,
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
    const best = completedGames.reduce((prev, g) =>
      g.score.rank < prev.score.rank ? g : prev,
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
