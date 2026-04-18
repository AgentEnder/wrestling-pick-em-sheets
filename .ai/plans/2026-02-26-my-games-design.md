# My Games — Design Document

## Overview

A "My Games" page for signed-in users that tracks games they've entered, shows in-progress and historical games, and displays historical performance stats as percentages (points received / max points). Active games also surface on the home hub for quick access.

## Data Model

### New table: `live_game_score_snapshots`

| Column | Type | Description |
|---|---|---|
| `id` | integer PK | Auto-increment |
| `game_id` | integer FK | References `live_games.id` |
| `player_id` | integer FK | References `live_game_players.id` |
| `total_score` | integer | Sum of all point categories |
| `max_possible_points` | integer | Total points available on the card |
| `winner_points` | integer | Points from correct winner picks |
| `bonus_points` | integer | Points from bonus questions |
| `surprise_points` | integer | Points from surprise entrant picks |
| `rank` | integer | Player's rank in this game |
| `player_count` | integer | Total submitted players |
| `score_percentage` | real | `total_score / max_possible_points * 100` |
| `updated_at` | text | Timestamp of last snapshot |

Indexes:
- `(game_id, player_id)` unique composite for upserts
- `(player_id)` for my-games aggregate queries

### Changes to existing tables

- `live_games`: Remove 12-hour expiration default (set far-future or remove concept). `status` + `ended_at` handle lifecycle.
- `live_game_players`: Add index on `(clerk_user_id)` for my-games lookups.

### Max possible points calculation

Computed from card structure at snapshot time:
- Each match: `match.points ?? card.defaultPoints`
- Each bonus question: `question.points ?? card.defaultPoints`
- Battle royal surprise slots: `surpriseSlots * (surprisePoints ?? card.defaultPoints)`

### Snapshot trigger

Scores are snapshotted every time the host updates the key (PUT `/api/live-games/[gameId]/key`). This shifts computation cost from the read path (every player polling) to the write path (host entering results).

## API

### New: `GET /api/my-games`

Authenticated (Clerk user required). Returns:

```typescript
{
  activeGames: Array<{
    gameId: number
    cardName: string
    eventName: string
    promotionName: string
    eventDate: string
    status: 'lobby' | 'live'
    joinCode: string
    score?: { totalScore: number, maxPossible: number, rank: number, playerCount: number }
  }>
  completedGames: Array<{
    gameId: number
    cardName: string
    eventName: string
    promotionName: string
    eventDate: string
    endedAt: string
    score: { totalScore: number, maxPossible: number, scorePercentage: number, rank: number, playerCount: number }
  }>
  stats: {
    gamesPlayed: number
    avgScorePercentage: number
    bestScorePercentage: number
    bestRank: string // e.g. "1st of 8"
    trendData: Array<{ eventName: string, scorePercentage: number, date: string }>
  }
}
```

### Modified: `PUT /api/live-games/[gameId]/key`

After saving key payload, calls `snapshotScores(gameId)` which:
1. Loads card structure to compute max possible points
2. Runs scoring logic against all submitted players
3. Upserts rows into `live_game_score_snapshots`

### Modified: `GET /api/live-games/[gameId]/state`

Reads leaderboard from `live_game_score_snapshots` instead of computing on every request. Falls back to computing if no snapshot exists yet.

## UI

### `/my-games` page

**Stats bar** — Horizontal row of stat cards:
- Games Played, Avg Score %, Best Score %, Best Finish (e.g. "1st of 8")

**Trend chart** — Small Recharts area/line chart (~200px) showing score % over last ~20 games. Uses existing shadcn chart components.

**Active Games section** — Only shown if active games exist. Cards with event name, status badge, current score/rank if available, "Rejoin" button linking to `/games/[gameId]/play`.

**History section** — Completed games list. Each card shows event name, date, score percentage, points breakdown, rank. Clicking opens the game in read-only view.

No polling — single fetch on page load.

### Home hub changes

Add "Active Games" card showing up to 3 active games with event name, status badge, rejoin link. "View all games" link to `/my-games`. Only visible to signed-in users with active games.

## Implementation Order

1. Migration + generated types
2. `snapshotScores()` repository function
3. Wire into key update route
4. Modify state reads to use snapshots
5. `GET /api/my-games` API route
6. `/my-games` page (stats, chart, active, history)
7. Home hub active games card
8. Backfill script for existing ended games

## Out of Scope

- Match-level score breakdown table (reconstruct from game state on demand)
- Polling on `/my-games`
- New auth — purely Clerk userId lookups
- Cleanup/expiration jobs
