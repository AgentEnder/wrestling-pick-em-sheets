# Data model

## Cards

Source: `migrations/0001_initial.ts:20-45`, generated `Cards` interface in `lib/server/db/generated.ts`.

```sql
cards (
  id                text PRIMARY KEY,
  owner_id          text,
  template_card_id  text REFERENCES cards.id ON DELETE SET NULL,
  name              text,
  event_name        text,
  event_date        text,
  event_tagline     text,
  default_points    integer,
  tiebreaker_label  text,
  public            integer DEFAULT 0,
  is_template       integer DEFAULT 0,
  created_at        text DEFAULT CURRENT_TIMESTAMP,
  updated_at        text DEFAULT CURRENT_TIMESTAMP,
  -- later migrations also added:
  promotion_name           text,
  tiebreaker_is_time_based integer,
  event_bonus_questions_json text,  -- json blob
  archived_at              text,   -- NULL = active; ISO timestamp = archived (0025)
  sections_json            text    -- json blob of CardSection[] (0028)
)
```

Related tables (later migrations add overrides, match rows, bonus questions, etc.). The card's full sheet (matches, bonus questions, event bonuses) is reconstituted by `findResolvedReadableCardById` (`lib/server/repositories/cards.ts:534-743`).

**Archive** (migration 0025): `archived_at` is filtered out by `listReadableCards` by default; a partial index `idx_cards_active_owner_updated ON cards (owner_id, updated_at) WHERE archived_at IS NULL` accelerates the common "active cards for this owner" path. `findResolvedReadableCardById` deliberately does not filter on `archived_at`, so deep links still resolve.

### Sections & collaboration (migration 0028)

- `cards.sections_json` / `card_overrides.sections_json` — ordered `CardSection[]` (`{id, name}`) for multi-day/multi-part events.
- `card_matches.section_id` — nullable FK-by-convention into the card's sections; dangling ids are nulled on save.
- `card_invites (id, card_id → cards ON DELETE CASCADE, token UNIQUE, created_by, created_at, expires_at, revoked_at)` — shareable collaboration links, owner-managed, revocable.
- `card_collaborators (id, card_id → cards ON DELETE CASCADE, user_id, user_email, invite_id, added_at, UNIQUE(card_id, user_id))` — users who accepted an invite; they can read + edit the sheet but not archive/share.

### Permissions

`lib/server/db/permissions.ts`:

- `canReadCard(eb, userId)` — owner, collaborator, or `public = 1` (or `public = 1` for guests)
- `isCardOwner(eb, userId)` — `owner_id = userId`
- `isCardCollaborator(eb, userId)` — EXISTS row in `card_collaborators`
- `canEditCard(eb, userId)` — owner OR collaborator (used by `persistOwnedCardSheet`, `updateCardOverrides`)

## Live games

Source: `migrations/0012_live_games.ts` (+ later additions 0013, 0019–0024).

```sql
live_games (
  id                text PRIMARY KEY,
  card_id           text REFERENCES cards.id ON DELETE CASCADE,
  host_user_id      text,
  mode              text,    -- 'room' | 'solo' (0013)
  join_code         text,
  qr_join_secret    text,
  allow_late_joins  integer, -- (0021)
  status            text,    -- 'lobby' | 'live' | 'ended'
  host_join_ip / host_geo_*  -- geo guardrails (0023)
  geo_radius_km     real,
  expires_at        text,
  ended_at          text,
  event_start_at    text,    -- (0022)
  key_payload_json  text,
  lock_state_json   text,
  created_at, updated_at
)

live_game_players (
  id                       text PRIMARY KEY,
  game_id                  text REFERENCES live_games.id ON DELETE CASCADE,
  join_status              text, -- 'pending' | 'approved' | 'rejected'
  approved_at              text,
  join_request_ip / city / country / lat / lng / distance_km, -- guardrails
  auth_method              text, -- 'guest' | 'clerk'
  clerk_user_id            text,
  nickname                 text,
  normalized_nickname      text,
  session_token_hash       text,
  picks_json               text,
  is_submitted             integer,
  submitted_at             text,
  joined_at, last_seen_at, updated_at,
  browser_*, os_*, device_*  -- ua-parser fields (0020)
  UNIQUE(game_id, normalized_nickname),
  UNIQUE(game_id, session_token_hash)
)

live_game_events (
  id, game_id REFERENCES live_games.id ON DELETE CASCADE,
  event_type, event_payload_json, created_at
)

live_game_push_subscriptions (0019)
  game_id REFERENCES live_games.id ON DELETE CASCADE,
  ...

live_game_score_snapshots (0024)
  game_id REFERENCES live_games.id ON DELETE CASCADE,
  player_id, total_score, winner_points, bonus_points,
  surprise_points, max_possible_points, rank, score_percentage,
  created_at
```

**Cascade behavior**: deleting a `live_games` row cascades to players, events, push subs, and score snapshots automatically. This matters for issue #23.

## Important TypeScript types (`lib/types.ts`)

```ts
// Bonus questions
type BonusQuestionAnswerType = "write-in" | "multiple-choice" | "threshold";
type BonusQuestionValueType  = "string" | "numerical" | "time" | "rosterMember";
type BonusGradingRule        = "exact" | "closest" | "atOrAbove" | "atOrBelow";

interface BonusQuestion {
  id: string;
  question: string;
  points: number | null;          // null => use sheet default
  answerType: BonusQuestionAnswerType;
  options: string[];               // multiple-choice only
  valueType: BonusQuestionValueType;
  gradingRule?: BonusGradingRule;  // shouldn't apply to "threshold"
  thresholdValue?: number;
  thresholdLabels?: [string, string];
}

// Live game
type LiveGameStatus = "lobby" | "live" | "ended";
type LiveGameMode   = "room" | "solo";

interface LiveGame {
  id; cardId; hostUserId; mode; joinCode;
  status; expiresAt; endedAt; createdAt; updatedAt;
  keyPayload: LiveGameKeyPayload;   // host's correct answers + timers + overrides
  lockState: LiveGameLockState;     // global / per-match / per-bonus locks
  // host geo + late join + qr secret + ...
}

interface LiveGamePlayer {
  id; gameId; joinStatus; nickname; picks: LivePlayerPicksPayload;
  isSubmitted; submittedAt; ...
}

interface LiveGameLeaderboardEntry {
  rank; nickname; score;
  breakdown: { winnerPoints; bonusPoints; surprisePoints };
  isSubmitted; lastUpdatedAt; lastSeenAt;
}
```

The leaderboard entry only carries **aggregate** breakdown today — issue #22 wants per-question rows.

## Sheet types

```ts
interface PickEmSheet {
  eventName, promotionName, eventDate, eventTagline;
  defaultPoints; tiebreakerLabel; tiebreakerIsTimeBased;
  matches: Match[];
  eventBonusQuestions: BonusQuestion[];
}

interface Match {
  id; type; typeLabelOverride;
  isBattleRoyal; isEliminationStyle;
  title; description; participants;
  surpriseSlots; surpriseEntrantPoints;
  bonusQuestions: BonusQuestion[];
  points: number | null;
}
```
