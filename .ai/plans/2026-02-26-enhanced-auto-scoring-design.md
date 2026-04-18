# Enhanced Auto-Scoring Design

## Problem

Free-text answers that are close to correct (partial names, minor typos) are scored as wrong. There is no way for the host to review and accept near-matches. Numerical/time questions lack an over/under question format.

## Requirements

1. Fuzzy matching on all text-based write-in questions (valueType `string` and `rosterMember`)
2. Answers with >= 90% fuzzy confidence are auto-marked correct
3. Answers with 60-89% confidence are surfaced to the host for manual review
4. Host reviews fuzzy matches via an inline panel in the key host app
5. Over/under scoring via a new "threshold" question type with configurable threshold value and labels
6. Print sheet updated to render threshold questions

## Fuzzy Matching Algorithm

Location: `lib/fuzzy-match.ts` (shared client/server utility)

Function: `computeFuzzyConfidence(playerAnswer: string, keyAnswer: string): number`

Returns 0.0 to 1.0 confidence score.

### Steps

1. Normalize both strings (trim, collapse whitespace, lowercase) — if equal, return 1.0
2. Substring containment: if normalized player answer is a complete word within the key answer (or vice versa), confidence = `0.80 + (0.20 * minLen/maxLen)`. "rhodes" as a word in "cody rhodes" scores ~0.91.
3. Levenshtein distance: confidence = `1.0 - (editDistance / maxLength)`. "rhods" vs "rhodes" = distance 1, confidence ~0.83.
4. Return the maximum confidence from steps 2 and 3.

### Thresholds

- `>= 0.90`: auto-mark correct, create override with `source: "auto"`
- `0.60 - 0.89`: show to host for review in inline panel
- `< 0.60`: considered wrong, not surfaced

## Score Overrides

### Types

```typescript
interface ScoreOverride {
  questionId: string
  playerNickname: string   // normalized
  accepted: boolean
  source: "auto" | "host"
  confidence: number
}

interface WinnerOverride {
  matchId: string
  playerNickname: string   // normalized
  accepted: boolean
  source: "auto" | "host"
  confidence: number
}
```

### Storage

Added to `CardLiveKeyPayload`:

```typescript
interface CardLiveKeyPayload {
  // existing fields unchanged
  scoreOverrides: ScoreOverride[]
  winnerOverrides: WinnerOverride[]
}
```

No database migration required. Data lives in existing `key_payload_json` column.

### Scoring Integration

In `scoreForQuestion()`, before the normal comparison:
1. Look up override by `questionId + normalizedNickname`
2. If `accepted: true`, award full points
3. If `accepted: false`, score 0 (skip fuzzy)
4. If no override, use normal comparison

Same pattern for winner picks in `computeLeaderboard()`.

## Client-Side Fuzzy Computation

Fuzzy matching runs in the browser inside the host key app.

### Data Flow

1. `LiveGameStateResponse` extended with `playerAnswerSummaries` (host only):
   ```typescript
   playerAnswerSummaries: Array<{
     nickname: string
     normalizedNickname: string
     matchPicks: LivePlayerMatchPick[]
     eventBonusAnswers: LivePlayerAnswer[]
   }>
   ```
2. Host key app computes fuzzy matches locally when key answers change or player data refreshes
3. Auto-accepted overrides (>= 0.90) added to key payload and saved with next key save
4. Server's `computeLeaderboard()` only checks overrides, no fuzzy logic on server

### Host Review Panel UX

Inline panel below each keyed answer:
- Shows candidates with confidence >= 0.60 that scored 0 on exact match
- Each row: `"[Nickname] answered '[answer]' - 87% match"` with accept/reject buttons
- Auto-accepted items shown as checked with "(auto-accepted)" label
- Host can override auto-accepts
- Accepting/rejecting updates `scoreOverrides` or `winnerOverrides` in key payload

## Threshold Question Type (Over/Under)

### Type Changes

```typescript
type BonusQuestionAnswerType = "write-in" | "multiple-choice" | "threshold"

interface BonusQuestion {
  // existing fields unchanged
  thresholdValue?: number
  thresholdLabels?: [string, string]  // defaults to ["Over", "Under"]
}
```

### Flow

1. Card editor creates threshold question: sets threshold value, value type (time/numerical), and optional labels
2. Player UI shows two buttons with the labels (e.g., "Over 15:00" / "Under 15:00")
3. Player's answer stored as the label string (e.g., "Over")
4. Host enters the actual result value in the key (e.g., "17:32")
5. Scoring: parse actual value, compare to threshold, determine correct label, compare to player's pick

### Scoring Path

New branch in `scoreForQuestion()` for `answerType === "threshold"`:
1. Parse host's key answer using `parseValueByType()` with the question's `valueType`
2. Compare parsed value to `question.thresholdValue`
3. If actual > threshold, correct label = `thresholdLabels[0]` ("Over")
4. If actual <= threshold, correct label = `thresholdLabels[1]` ("Under")
5. Compare player answer to correct label using `answerEquals()`

## Files Changed

| File | Change |
|------|--------|
| `lib/types.ts` | Add override types, threshold fields, new answer type |
| `lib/fuzzy-match.ts` (new) | Fuzzy matching utility |
| `lib/server/repositories/live-games.ts` | Override checks in scoring, threshold scoring path, player answer summaries in state |
| `components/pick-em/live-game-key-host-app.tsx` | Inline fuzzy review panel, client-side matching |
| `components/event-settings.tsx` | Threshold question type in card editor |
| `components/pick-em/live-game-player-app.tsx` | Threshold question rendering |
| `components/print-sheet.tsx` | Threshold question rendering |

No database migrations needed.
