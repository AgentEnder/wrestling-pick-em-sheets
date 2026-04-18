# Enhanced Auto-Scoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add fuzzy text matching with host review, score overrides, and threshold (over/under) question type to the live game scoring system.

**Architecture:** Client-side fuzzy matching in the host key app compares player answers to key answers using substring + Levenshtein distance. Score overrides stored in the key payload JSON. New "threshold" answer type for over/under questions where card editor sets a threshold value and players pick a side.

**Tech Stack:** TypeScript, React, Next.js, node:test for unit tests, Kysely (no migration needed — JSON columns)

---

### Task 1: Fuzzy Matching Utility — Tests

**Files:**
- Create: `lib/fuzzy-match.ts`
- Create: `tests/unit/lib/fuzzy-match.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/lib/fuzzy-match.test.ts`:

```typescript
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { computeFuzzyConfidence } from '@/lib/fuzzy-match'

describe('computeFuzzyConfidence', () => {
  test('exact match after normalization returns 1.0', () => {
    assert.equal(computeFuzzyConfidence('Cody Rhodes', 'cody rhodes'), 1.0)
  })

  test('exact match with extra whitespace returns 1.0', () => {
    assert.equal(computeFuzzyConfidence('  Cody  Rhodes  ', 'Cody Rhodes'), 1.0)
  })

  test('empty strings return 0', () => {
    assert.equal(computeFuzzyConfidence('', 'Cody Rhodes'), 0)
    assert.equal(computeFuzzyConfidence('Cody Rhodes', ''), 0)
    assert.equal(computeFuzzyConfidence('', ''), 0)
  })

  test('complete word substring match scores high', () => {
    const confidence = computeFuzzyConfidence('Rhodes', 'Cody Rhodes')
    assert.ok(confidence >= 0.85, `Expected >= 0.85, got ${confidence}`)
    assert.ok(confidence < 1.0, `Expected < 1.0, got ${confidence}`)
  })

  test('complete word substring match (reversed) scores high', () => {
    const confidence = computeFuzzyConfidence('Cody Rhodes', 'Rhodes')
    assert.ok(confidence >= 0.85, `Expected >= 0.85, got ${confidence}`)
    assert.ok(confidence < 1.0, `Expected < 1.0, got ${confidence}`)
  })

  test('minor typo scores moderately high via Levenshtein', () => {
    const confidence = computeFuzzyConfidence('Rhods', 'Rhodes')
    assert.ok(confidence >= 0.75, `Expected >= 0.75, got ${confidence}`)
    assert.ok(confidence < 0.95, `Expected < 0.95, got ${confidence}`)
  })

  test('completely different strings score low', () => {
    const confidence = computeFuzzyConfidence('John Cena', 'Cody Rhodes')
    assert.ok(confidence < 0.5, `Expected < 0.5, got ${confidence}`)
  })

  test('partial non-word substring does not get word-match boost', () => {
    // "ode" appears in "Cody" but is not a complete word
    const confidence = computeFuzzyConfidence('ode', 'Cody Rhodes')
    assert.ok(confidence < 0.85, `Expected < 0.85, got ${confidence}`)
  })

  test('single word from multi-word key scores high', () => {
    const confidence = computeFuzzyConfidence('Undertaker', 'The Undertaker')
    assert.ok(confidence >= 0.85, `Expected >= 0.85, got ${confidence}`)
  })

  test('case insensitive matching', () => {
    const confidence = computeFuzzyConfidence('RHODES', 'cody rhodes')
    assert.ok(confidence >= 0.85, `Expected >= 0.85, got ${confidence}`)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/lib/fuzzy-match.test.ts`
Expected: FAIL — module `@/lib/fuzzy-match` does not exist

**Step 3: Write minimal implementation**

Create `lib/fuzzy-match.ts`:

```typescript
function normalizeForFuzzy(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length

  if (m === 0) return n
  if (n === 0) return m

  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)

  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[n]
}

function wordSubstringConfidence(shorter: string, longer: string): number {
  const longerWords = longer.split(' ')
  const shorterWords = shorter.split(' ')

  // Check if all words in shorter appear as complete words in longer
  const allWordsMatch = shorterWords.every((word) =>
    longerWords.some((lw) => lw === word)
  )

  if (allWordsMatch) {
    const ratio = shorter.length / longer.length
    return 0.80 + 0.20 * ratio
  }

  return 0
}

export function computeFuzzyConfidence(playerAnswer: string, keyAnswer: string): number {
  const normPlayer = normalizeForFuzzy(playerAnswer)
  const normKey = normalizeForFuzzy(keyAnswer)

  if (!normPlayer || !normKey) return 0

  // Exact match after normalization
  if (normPlayer === normKey) return 1.0

  // Word-level substring matching
  const [shorter, longer] = normPlayer.length <= normKey.length
    ? [normPlayer, normKey]
    : [normKey, normPlayer]

  const substringScore = wordSubstringConfidence(shorter, longer)

  // Levenshtein distance
  const distance = levenshteinDistance(normPlayer, normKey)
  const maxLen = Math.max(normPlayer.length, normKey.length)
  const levenshteinScore = 1.0 - distance / maxLen

  return Math.max(substringScore, levenshteinScore)
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/lib/fuzzy-match.test.ts`
Expected: All 9 tests PASS

**Step 5: Commit**

```bash
git add lib/fuzzy-match.ts tests/unit/lib/fuzzy-match.test.ts
git commit -m "feat: add fuzzy matching utility with Levenshtein + word substring"
```

---

### Task 2: Type Definitions — Override Types and Threshold Fields

**Files:**
- Modify: `lib/types.ts:1-14` (BonusQuestionAnswerType, BonusQuestion)
- Modify: `lib/types.ts:117-124` (CardLiveKeyPayload)

**Step 1: Add ScoreOverride and WinnerOverride types**

Add after line 3 (after `BonusGradingRule`) in `lib/types.ts`:

```typescript
export interface ScoreOverride {
  questionId: string
  playerNickname: string
  accepted: boolean
  source: "auto" | "host"
  confidence: number
}

export interface WinnerOverride {
  matchId: string
  playerNickname: string
  accepted: boolean
  source: "auto" | "host"
  confidence: number
}
```

**Step 2: Update BonusQuestionAnswerType**

Change line 1 from:
```typescript
export type BonusQuestionAnswerType = "write-in" | "multiple-choice"
```
To:
```typescript
export type BonusQuestionAnswerType = "write-in" | "multiple-choice" | "threshold"
```

**Step 3: Add threshold fields to BonusQuestion**

Add two optional fields to the `BonusQuestion` interface (after `gradingRule?`):
```typescript
  thresholdValue?: number
  thresholdLabels?: [string, string]
```

**Step 4: Add override arrays to CardLiveKeyPayload**

Add to the `CardLiveKeyPayload` interface (after `tiebreakerTimerId`):
```typescript
  scoreOverrides: ScoreOverride[]
  winnerOverrides: WinnerOverride[]
```

**Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: Type errors in places that construct `CardLiveKeyPayload` without the new fields. Note which files need updating — they'll be fixed in subsequent tasks.

**Step 6: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add override types and threshold fields to type definitions"
```

---

### Task 3: Fix Key Payload Initialization Sites

After adding `scoreOverrides` and `winnerOverrides` to `CardLiveKeyPayload`, every place that creates or spreads this payload needs to include the new fields with defaults.

**Files:**
- Modify: `lib/server/repositories/live-games.ts` — search for all `CardLiveKeyPayload` or `LiveGameKeyPayload` object literals
- Modify: `components/pick-em/live-game-key-host-app.tsx` — where payload is initialized

**Step 1: Find all construction sites**

Search for places that build a `CardLiveKeyPayload` literal. Key locations:
- `lib/server/repositories/live-games.ts` — look for `key_payload_json` inserts and any default payload construction
- `components/pick-em/live-game-key-host-app.tsx` — where `setPayload` initializes

**Step 2: Add defaults at each site**

At every payload construction, ensure:
```typescript
scoreOverrides: [],
winnerOverrides: [],
```

For existing payloads read from the database, add fallback defaults when deserializing. Find the `mapLiveGame()` or payload parsing function and add:
```typescript
scoreOverrides: parsed.scoreOverrides ?? [],
winnerOverrides: parsed.winnerOverrides ?? [],
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors

**Step 4: Commit**

```bash
git add lib/server/repositories/live-games.ts components/pick-em/live-game-key-host-app.tsx
git commit -m "fix: add default scoreOverrides and winnerOverrides to payload construction sites"
```

---

### Task 4: Scoring Integration — Override Checks and Threshold Scoring

**Files:**
- Modify: `lib/server/repositories/live-games.ts:1255-1307` (scoreForQuestion)
- Modify: `lib/server/repositories/live-games.ts:1309-1473` (computeLeaderboard)
- Create: `tests/unit/lib/scoring.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/lib/scoring.test.ts`. Since `scoreForQuestion` and `computeLeaderboard` are not exported, test via the public interface. However, for unit-testability, consider extracting `scoreForQuestion` to a separate exported function, or test through `computeLeaderboard` indirectly.

Alternative: Export `scoreForQuestion` for testing. Add `export` to the function signature at line 1255.

Create the test file:

```typescript
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

// These functions will need to be exported from live-games.ts for testing
// or extracted to a separate scoring module
import { scoreForQuestion } from '@/lib/server/scoring'

describe('scoreForQuestion with overrides', () => {
  const stringQuestion = {
    id: 'q1',
    question: 'Who wins?',
    points: 10,
    answerType: 'write-in' as const,
    options: [],
    valueType: 'string' as const,
    gradingRule: 'exact' as const,
  }

  test('override accepted=true awards full points regardless of answer', () => {
    const result = scoreForQuestion(
      stringQuestion,
      5,
      'Cody Rhodes',
      'Rhodes',
      { accepted: true, source: 'host', confidence: 0.87 },
    )
    assert.equal(result.score, 10)
  })

  test('override accepted=false scores 0 even if answer matches', () => {
    const result = scoreForQuestion(
      stringQuestion,
      5,
      'Cody Rhodes',
      'Cody Rhodes',
      { accepted: false, source: 'host', confidence: 0.5 },
    )
    assert.equal(result.score, 0)
  })

  test('no override uses normal comparison', () => {
    const result = scoreForQuestion(stringQuestion, 5, 'Cody Rhodes', 'Cody Rhodes')
    assert.equal(result.score, 10)
  })
})

describe('scoreForQuestion with threshold answer type', () => {
  const thresholdTimeQuestion = {
    id: 'q2',
    question: 'Match length over/under 15:00?',
    points: 5,
    answerType: 'threshold' as const,
    options: [],
    valueType: 'time' as const,
    thresholdValue: 900, // 15 minutes in seconds
    thresholdLabels: ['Over', 'Under'] as [string, string],
  }

  test('actual > threshold, player picked Over = correct', () => {
    const result = scoreForQuestion(thresholdTimeQuestion, 5, '17:32', 'Over')
    assert.equal(result.score, 5)
  })

  test('actual > threshold, player picked Under = wrong', () => {
    const result = scoreForQuestion(thresholdTimeQuestion, 5, '17:32', 'Under')
    assert.equal(result.score, 0)
  })

  test('actual <= threshold, player picked Under = correct', () => {
    const result = scoreForQuestion(thresholdTimeQuestion, 5, '14:30', 'Under')
    assert.equal(result.score, 5)
  })

  test('actual <= threshold, player picked Over = wrong', () => {
    const result = scoreForQuestion(thresholdTimeQuestion, 5, '14:30', 'Over')
    assert.equal(result.score, 0)
  })

  test('exact threshold value, player picked Under = correct', () => {
    const result = scoreForQuestion(thresholdTimeQuestion, 5, '15:00', 'Under')
    assert.equal(result.score, 5)
  })

  const thresholdNumQuestion = {
    id: 'q3',
    question: 'Over/Under 3.5 title changes?',
    points: 5,
    answerType: 'threshold' as const,
    options: [],
    valueType: 'numerical' as const,
    thresholdValue: 3.5,
    thresholdLabels: ['Over', 'Under'] as [string, string],
  }

  test('numerical threshold works', () => {
    const result = scoreForQuestion(thresholdNumQuestion, 5, '4', 'Over')
    assert.equal(result.score, 5)
  })

  test('threshold with default labels', () => {
    const noLabels = { ...thresholdTimeQuestion, thresholdLabels: undefined }
    const result = scoreForQuestion(noLabels, 5, '17:32', 'Over')
    assert.equal(result.score, 5)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/lib/scoring.test.ts`
Expected: FAIL — module not found or function not exported

**Step 3: Extract scoring to shared module and implement**

Create `lib/server/scoring.ts` by extracting `scoreForQuestion`, `answerEquals`, `normalizeText`, `getQuestionRule`, `parseValueByType`, `parseNumericLike`, `parseTimeLike` from `lib/server/repositories/live-games.ts` (lines 561-562, 595-609, 630-672, 1222-1225, 1255-1307).

In `lib/server/scoring.ts`, modify `scoreForQuestion` to accept an optional override parameter and handle threshold:

```typescript
import type { BonusGradingRule, BonusQuestion, ScoreOverride } from '@/lib/types'

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function answerEquals(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false
  return normalizeText(a) === normalizeText(b)
}

function getQuestionRule(question: BonusQuestion): BonusGradingRule {
  if (question.valueType !== 'numerical' && question.valueType !== 'time') {
    return 'exact'
  }
  if (
    question.gradingRule === 'closest' ||
    question.gradingRule === 'atOrAbove' ||
    question.gradingRule === 'atOrBelow'
  ) {
    return question.gradingRule
  }
  return 'exact'
}

export function parseNumericLike(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const numberLike = Number.parseFloat(trimmed)
  if (Number.isFinite(numberLike)) return numberLike
  return null
}

export function parseTimeLike(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((part) => Number.parseFloat(part))
    if (parts.some((part) => !Number.isFinite(part))) return null
    let total = 0
    for (let i = 0; i < parts.length; i += 1) {
      total = total * 60 + (parts[i] ?? 0)
    }
    return total
  }
  return parseNumericLike(trimmed)
}

export function parseValueByType(value: string, valueType: BonusQuestion['valueType']): number | null {
  if (valueType === 'time') return parseTimeLike(value)
  if (valueType === 'numerical') return parseNumericLike(value)
  return null
}

export function scoreForQuestion(
  question: BonusQuestion,
  defaultPoints: number,
  keyAnswer: string,
  playerAnswer: string,
  override?: { accepted: boolean; source: string; confidence: number } | undefined,
): { score: number; isClosestCandidate: boolean; distance?: number } {
  const points = question.points ?? defaultPoints
  if (points <= 0) return { score: 0, isClosestCandidate: false }

  // Check override first
  if (override) {
    if (override.accepted) return { score: points, isClosestCandidate: false }
    return { score: 0, isClosestCandidate: false }
  }

  if (!keyAnswer.trim() || !playerAnswer.trim()) {
    return { score: 0, isClosestCandidate: false }
  }

  // Threshold answer type: host enters actual value, compare to threshold
  if (question.answerType === 'threshold' && question.thresholdValue != null) {
    const actualValue = parseValueByType(keyAnswer, question.valueType)
    if (actualValue === null) return { score: 0, isClosestCandidate: false }

    const labels = question.thresholdLabels ?? ['Over', 'Under']
    const correctLabel = actualValue > question.thresholdValue ? labels[0] : labels[1]
    return {
      score: answerEquals(playerAnswer, correctLabel) ? points : 0,
      isClosestCandidate: false,
    }
  }

  const rule = getQuestionRule(question)

  if (rule === 'exact') {
    if (question.valueType === 'numerical' || question.valueType === 'time') {
      const keyValue = parseValueByType(keyAnswer, question.valueType)
      const playerValue = parseValueByType(playerAnswer, question.valueType)
      if (keyValue !== null && playerValue !== null) {
        return {
          score: Math.abs(keyValue - playerValue) < 0.0001 ? points : 0,
          isClosestCandidate: false,
        }
      }
    }
    return {
      score: answerEquals(keyAnswer, playerAnswer) ? points : 0,
      isClosestCandidate: false,
    }
  }

  const keyValue = parseValueByType(keyAnswer, question.valueType)
  const playerValue = parseValueByType(playerAnswer, question.valueType)

  if (keyValue === null || playerValue === null) {
    return { score: 0, isClosestCandidate: false }
  }

  if (rule === 'atOrAbove') {
    return { score: playerValue >= keyValue ? points : 0, isClosestCandidate: false }
  }
  if (rule === 'atOrBelow') {
    return { score: playerValue <= keyValue ? points : 0, isClosestCandidate: false }
  }

  return {
    score: 0,
    isClosestCandidate: true,
    distance: Math.abs(playerValue - keyValue),
  }
}
```

Update `lib/server/repositories/live-games.ts` to import from the new module instead of defining locally:
```typescript
import { normalizeText, answerEquals, scoreForQuestion, parseValueByType } from '@/lib/server/scoring'
```
Delete the local copies of these functions (lines 561-562, 595-609, 630-672, 1222-1225, 1255-1307).

**Step 4: Run tests**

Run: `npx tsx --test tests/unit/lib/scoring.test.ts`
Expected: All tests PASS

Run: `npx tsx --test tests/unit/lib/fuzzy-match.test.ts`
Expected: Still passing

**Step 5: Commit**

```bash
git add lib/server/scoring.ts tests/unit/lib/scoring.test.ts lib/server/repositories/live-games.ts
git commit -m "feat: extract scoring module with override support and threshold scoring"
```

---

### Task 5: Leaderboard Override Integration

**Files:**
- Modify: `lib/server/repositories/live-games.ts:1309-1473` (computeLeaderboard)

**Step 1: Update computeLeaderboard to pass overrides through**

The `computeLeaderboard` function needs to:
1. Accept overrides from the key payload
2. Look up overrides for each player+question combo when calling `scoreForQuestion`
3. Look up winner overrides for each player+match combo

Modify the function signature and body. The key payload already contains `scoreOverrides` and `winnerOverrides`. The function receives `keyPayload` which has these arrays.

Inside the scoring loops, before calling `scoreForQuestion`, look up a matching override:

```typescript
// For bonus questions:
const override = keyPayload.scoreOverrides.find(
  (o) => o.questionId === question.id && normalizeText(o.playerNickname) === normalizeText(player.nickname)
)
const result = scoreForQuestion(question, card.defaultPoints, keyAnswer, playerAnswer, override)
```

For winner picks, similarly look up `winnerOverrides`:

```typescript
// For match winner:
const winnerOverride = keyPayload.winnerOverrides.find(
  (o) => o.matchId === match.id && normalizeText(o.playerNickname) === normalizeText(player.nickname)
)

if (winnerOverride) {
  if (winnerOverride.accepted) {
    score.score += winnerPoints
    score.winnerPoints += winnerPoints
  }
} else if (keyMatchResult.winnerName.trim() && playerMatchPick?.winnerName && answerEquals(keyMatchResult.winnerName, playerMatchPick.winnerName)) {
  score.score += winnerPoints
  score.winnerPoints += winnerPoints
}
```

**Step 2: Run full test suite**

Run: `make test`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/server/repositories/live-games.ts
git commit -m "feat: integrate score and winner overrides into leaderboard computation"
```

---

### Task 6: Player Answer Summaries in State Response

**Files:**
- Modify: `lib/server/repositories/live-games.ts:65-100` (LiveGameComputedState)
- Modify: `lib/server/repositories/live-games.ts:2732-2802` (getLiveGameState)
- Modify: `lib/client/live-games-api.ts:24-76` (LiveGameStateResponse)

**Step 1: Add playerAnswerSummaries to LiveGameComputedState**

Add to the interface at line 65:

```typescript
playerAnswerSummaries: Array<{
  nickname: string
  normalizedNickname: string
  matchPicks: LivePlayerMatchPick[]
  eventBonusAnswers: LivePlayerAnswer[]
}>
```

Import `LivePlayerMatchPick` and `LivePlayerAnswer` from `@/lib/types` if not already imported.

**Step 2: Populate in getLiveGameState**

In `getLiveGameState()` (line 2766), only include summaries for host:

```typescript
playerAnswerSummaries: access.isHost
  ? approvedPlayers
      .filter((p) => p.isSubmitted)
      .map((player) => ({
        nickname: player.nickname,
        normalizedNickname: normalizeText(player.nickname),
        matchPicks: player.picks.matchPicks,
        eventBonusAnswers: player.picks.eventBonusAnswers,
      }))
  : [],
```

**Step 3: Add to client-side type**

In `lib/client/live-games-api.ts`, add to `LiveGameStateResponse` (after line 66):

```typescript
playerAnswerSummaries: Array<{
  nickname: string
  normalizedNickname: string
  matchPicks: Array<{
    matchId: string
    winnerName: string
    battleRoyalEntrants: string[]
    bonusAnswers: Array<{ questionId: string; answer: string }>
  }>
  eventBonusAnswers: Array<{ questionId: string; answer: string }>
}>
```

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/server/repositories/live-games.ts lib/client/live-games-api.ts
git commit -m "feat: expose player answer summaries in state response for host"
```

---

### Task 7: Card Editor — Threshold Question Type

**Files:**
- Modify: `components/match-editor.tsx:831-1009` (answer type buttons and options)

**Step 1: Add Threshold button to answer type row**

In `components/match-editor.tsx`, after the "Multiple Choice" button (line 865), add a "Threshold" button:

```tsx
<button
  type="button"
  onClick={() =>
    updateBonusQuestion(qi, {
      answerType: "threshold",
      options: [],
      valueType: q.valueType === "string" || q.valueType === "rosterMember" ? "numerical" : q.valueType,
    })
  }
  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
    q.answerType === "threshold"
      ? "bg-primary text-primary-foreground"
      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
  }`}
>
  <ArrowUpDown className="h-3 w-3" />
  Threshold
</button>
```

Import `ArrowUpDown` from `lucide-react`.

**Step 2: Add threshold configuration fields**

After the grading rule row (line 957), add threshold fields when `answerType === "threshold"`:

```tsx
{q.answerType === "threshold" && (
  <div className="grid grid-cols-1 sm:grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 sm:items-center">
    <span className="text-xs text-muted-foreground">Threshold:</span>
    <Input
      type="number"
      step="any"
      placeholder={q.valueType === 'time' ? 'Seconds (e.g. 900 for 15:00)' : 'Threshold value'}
      value={q.thresholdValue ?? ''}
      onChange={(e) =>
        updateBonusQuestion(qi, {
          thresholdValue: e.target.value ? Number(e.target.value) : undefined,
        })
      }
      className="text-sm max-w-[200px]"
    />
    <span className="text-xs text-muted-foreground">Labels:</span>
    <div className="flex items-center gap-2">
      <Input
        placeholder="Over"
        value={q.thresholdLabels?.[0] ?? ''}
        onChange={(e) =>
          updateBonusQuestion(qi, {
            thresholdLabels: [e.target.value || 'Over', q.thresholdLabels?.[1] ?? 'Under'],
          })
        }
        className="text-sm max-w-[120px]"
      />
      <span className="text-xs text-muted-foreground">/</span>
      <Input
        placeholder="Under"
        value={q.thresholdLabels?.[1] ?? ''}
        onChange={(e) =>
          updateBonusQuestion(qi, {
            thresholdLabels: [q.thresholdLabels?.[0] ?? 'Over', e.target.value || 'Under'],
          })
        }
        className="text-sm max-w-[120px]"
      />
    </div>
  </div>
)}
```

**Step 3: Force value type for threshold**

When threshold is selected, restrict value type to `time` or `numerical` (since threshold comparison requires numeric parsing). The onClick handler above already does this.

Hide the "Standard" and "Roster" value type buttons when `answerType === "threshold"`. Wrap the value type row to conditionally filter:

```tsx
{q.answerType !== "threshold" ? (
  // existing value type buttons (all 4)
) : (
  // only Time and Count buttons
)}
```

**Step 4: Run type check and visual verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add components/match-editor.tsx
git commit -m "feat: add threshold question type to card editor"
```

---

### Task 8: Player App — Threshold Question Rendering

**Files:**
- Modify: `components/pick-em/live-game-player-app.tsx:1146-1264` (bonus question rendering)

**Step 1: Add threshold rendering**

In the match bonus questions loop (line 1162), before the `<Input>` element, add a conditional for threshold:

```tsx
{question.answerType === 'threshold' ? (
  <div className="flex gap-2">
    {(question.thresholdLabels ?? ['Over', 'Under']).map((label) => (
      <button
        key={label}
        type="button"
        disabled={isLocked}
        onClick={() => setMatchBonusAnswer(match.id, question.id, label)}
        className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
          normalizeText(answer?.answer ?? '') === normalizeText(label)
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-card-foreground hover:border-primary/50'
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {label}
      </button>
    ))}
  </div>
) : (
  // existing Input element and roster suggestions
)}
```

Note: Import `normalizeText` from `@/lib/server/scoring` won't work client-side. Instead, define a local helper or just use `.trim().toLowerCase()` for the comparison. Simplest approach:

```typescript
function normalizeForCompare(v: string): string {
  return v.trim().replace(/\s+/g, ' ').toLowerCase()
}
```

Add same conditional to event bonus questions (line 1224).

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add components/pick-em/live-game-player-app.tsx
git commit -m "feat: render threshold questions as two-button choice in player app"
```

---

### Task 9: Print Sheet — Threshold Question Rendering

**Files:**
- Modify: `components/print-sheet.tsx:63-102` (BonusQuestionsBlock)
- Modify: `tests/unit/components/print-sheet.test.ts`

**Step 1: Write failing test**

Add to `tests/unit/components/print-sheet.test.ts`:

```typescript
test('renders threshold question with two checkbox options', () => {
  const sheet = createSheet({
    matches: [
      createMatch('m1', {
        bonusQuestions: [
          createBonusQuestion('tq1', {
            question: 'Over/Under 15:00?',
            answerType: 'threshold',
            valueType: 'time',
            thresholdValue: 900,
            thresholdLabels: ['Over', 'Under'],
          }),
        ],
      }),
    ],
  })

  const html = renderToStaticMarkup(React.createElement(PrintSheet, { sheet }))
  assert.ok(html.includes('Over'), 'Should render Over label')
  assert.ok(html.includes('Under'), 'Should render Under label')
  assert.ok(html.includes('print-checkbox'), 'Should render checkboxes')
})
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/components/print-sheet.test.ts`
Expected: FAIL — threshold answerType falls into the else branch and renders a write-line instead of checkboxes

**Step 3: Update BonusQuestionsBlock**

In `components/print-sheet.tsx` line 82, change the conditional from:

```tsx
{q.answerType === "multiple-choice" && q.options.length > 0 ? (
```

To handle threshold too:

```tsx
{q.answerType === "multiple-choice" && q.options.length > 0 ? (
  <span className="print-mc-options">
    {q.options.map((opt, oi) => (
      <span key={oi} className="print-mc-option">
        <span className="print-checkbox" />
        <span>{opt}</span>
      </span>
    ))}
  </span>
) : q.answerType === "threshold" ? (
  <span className="print-mc-options">
    {(q.thresholdLabels ?? ["Over", "Under"]).map((label, li) => (
      <span key={li} className="print-mc-option">
        <span className="print-checkbox" />
        <span>{label}</span>
      </span>
    ))}
  </span>
) : (
  <span className="print-write-line-inline" />
)}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/components/print-sheet.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add components/print-sheet.tsx tests/unit/components/print-sheet.test.ts
git commit -m "feat: render threshold questions on print sheet with checkbox options"
```

---

### Task 10: Host Key App — Fuzzy Review Panel

**Files:**
- Modify: `components/pick-em/live-game-key-host-app.tsx`

This is the largest UI task. The host key app needs to:
1. Use player answer summaries from state
2. Compute fuzzy matches client-side
3. Show inline review panels
4. Manage overrides in the key payload

**Step 1: Import fuzzy matching**

At top of `components/pick-em/live-game-key-host-app.tsx`:

```typescript
import { computeFuzzyConfidence } from '@/lib/fuzzy-match'
```

**Step 2: Create a FuzzyReviewPanel component**

Add inside the file (or as a new component in the same file):

```tsx
const FUZZY_AUTO_THRESHOLD = 0.90
const FUZZY_REVIEW_THRESHOLD = 0.60

interface FuzzyCandidate {
  playerNickname: string
  normalizedNickname: string
  playerAnswer: string
  confidence: number
  isAutoAccepted: boolean
}

function FuzzyReviewPanel({
  candidates,
  onAccept,
  onReject,
}: {
  candidates: FuzzyCandidate[]
  onAccept: (normalizedNickname: string) => void
  onReject: (normalizedNickname: string) => void
}) {
  if (candidates.length === 0) return null

  return (
    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 space-y-1.5">
      <p className="text-xs font-medium text-amber-600">Fuzzy Matches</p>
      {candidates.map((c) => (
        <div key={c.normalizedNickname} className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate">
            <span className="font-medium">{c.playerNickname}</span>
            {' answered '}
            <span className="italic">&ldquo;{c.playerAnswer}&rdquo;</span>
            {' — '}
            <span className="font-mono">{Math.round(c.confidence * 100)}%</span>
            {c.isAutoAccepted ? <span className="ml-1 text-emerald-600">(auto)</span> : null}
          </span>
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onAccept(c.normalizedNickname)}
              className="rounded bg-emerald-600 px-2 py-0.5 text-white hover:bg-emerald-700"
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => onReject(c.normalizedNickname)}
              className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700"
            >
              ✗
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

**Step 3: Create helper to compute fuzzy candidates**

```typescript
function computeFuzzyCandidatesForAnswer(
  keyAnswer: string,
  playerAnswers: Array<{ nickname: string; normalizedNickname: string; answer: string }>,
  existingOverrides: Array<{ playerNickname: string; accepted: boolean }>,
): FuzzyCandidate[] {
  if (!keyAnswer.trim()) return []

  const candidates: FuzzyCandidate[] = []

  for (const pa of playerAnswers) {
    if (!pa.answer.trim()) continue

    // Skip if exact match (already scored correctly)
    const normKey = keyAnswer.trim().replace(/\s+/g, ' ').toLowerCase()
    const normPlayer = pa.answer.trim().replace(/\s+/g, ' ').toLowerCase()
    if (normKey === normPlayer) continue

    // Skip if already has an override
    const hasOverride = existingOverrides.some(
      (o) => o.playerNickname.trim().replace(/\s+/g, ' ').toLowerCase() === pa.normalizedNickname
    )
    if (hasOverride) continue

    const confidence = computeFuzzyConfidence(pa.answer, keyAnswer)
    if (confidence >= FUZZY_REVIEW_THRESHOLD) {
      candidates.push({
        playerNickname: pa.nickname,
        normalizedNickname: pa.normalizedNickname,
        playerAnswer: pa.answer,
        confidence,
        isAutoAccepted: confidence >= FUZZY_AUTO_THRESHOLD,
      })
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence)
}
```

**Step 4: Wire into bonus question rendering**

In the match bonus results section (line 1132), after the `<Input>` for each question, add:

```tsx
{(() => {
  const playerAnswersForQ = (state?.playerAnswerSummaries ?? []).map((p) => ({
    nickname: p.nickname,
    normalizedNickname: p.normalizedNickname,
    answer: p.matchPicks.find((mp) => mp.matchId === match.id)
      ?.bonusAnswers.find((ba) => ba.questionId === question.id)?.answer ?? '',
  }))
  const questionOverrides = payload.scoreOverrides.filter((o) => o.questionId === question.id)
  const candidates = computeFuzzyCandidatesForAnswer(answer?.answer ?? '', playerAnswersForQ, questionOverrides)

  return (
    <FuzzyReviewPanel
      candidates={candidates}
      onAccept={(nn) => handleAcceptFuzzyOverride('score', question.id, nn, candidates)}
      onReject={(nn) => handleRejectFuzzyOverride('score', question.id, nn)}
    />
  )
})()}
```

Do the same for event bonus questions and winner picks.

**Step 5: Implement override handlers**

```typescript
function handleAcceptFuzzyOverride(
  type: 'score' | 'winner',
  questionOrMatchId: string,
  normalizedNickname: string,
  candidates: FuzzyCandidate[],
) {
  const candidate = candidates.find((c) => c.normalizedNickname === normalizedNickname)
  if (!candidate) return

  setPayload((prev) => {
    if (!prev) return prev

    if (type === 'score') {
      return {
        ...prev,
        scoreOverrides: [
          ...prev.scoreOverrides.filter(
            (o) => !(o.questionId === questionOrMatchId && normalizeText(o.playerNickname) === normalizedNickname)
          ),
          {
            questionId: questionOrMatchId,
            playerNickname: normalizedNickname,
            accepted: true,
            source: 'host' as const,
            confidence: candidate.confidence,
          },
        ],
      }
    }

    return {
      ...prev,
      winnerOverrides: [
        ...prev.winnerOverrides.filter(
          (o) => !(o.matchId === questionOrMatchId && normalizeText(o.playerNickname) === normalizedNickname)
        ),
        {
          matchId: questionOrMatchId,
          playerNickname: normalizedNickname,
          accepted: true,
          source: 'host' as const,
          confidence: candidate.confidence,
        },
      ],
    }
  })
}

function handleRejectFuzzyOverride(type: 'score' | 'winner', questionOrMatchId: string, normalizedNickname: string) {
  setPayload((prev) => {
    if (!prev) return prev

    if (type === 'score') {
      return {
        ...prev,
        scoreOverrides: [
          ...prev.scoreOverrides.filter(
            (o) => !(o.questionId === questionOrMatchId && normalizeText(o.playerNickname) === normalizedNickname)
          ),
          {
            questionId: questionOrMatchId,
            playerNickname: normalizedNickname,
            accepted: false,
            source: 'host' as const,
            confidence: 0,
          },
        ],
      }
    }

    return {
      ...prev,
      winnerOverrides: [
        ...prev.winnerOverrides.filter(
          (o) => !(o.matchId === questionOrMatchId && normalizeText(o.playerNickname) === normalizedNickname)
        ),
        {
          matchId: questionOrMatchId,
          playerNickname: normalizedNickname,
          accepted: false,
          source: 'host' as const,
          confidence: 0,
        },
      ],
    }
  })
}
```

**Step 6: Auto-accept high-confidence matches**

Add a `useEffect` or `useMemo` that computes auto-accepts when player summaries or key answers change, and merges them into the payload if they don't already have overrides:

```typescript
// In a useEffect after state is loaded:
useEffect(() => {
  if (!state?.playerAnswerSummaries || !payload) return

  // Compute auto-accepts for all questions and merge into payload
  // Only for candidates >= FUZZY_AUTO_THRESHOLD that don't already have overrides
  // This runs on state refresh and auto-saves overrides
}, [state?.playerAnswerSummaries, payload?.matchResults, payload?.eventBonusAnswers])
```

**Step 7: Add normalizeText helper**

Since this is a client component, add a local `normalizeText`:
```typescript
function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}
```

**Step 8: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 9: Commit**

```bash
git add components/pick-em/live-game-key-host-app.tsx
git commit -m "feat: add fuzzy review panel with inline accept/reject in host key app"
```

---

### Task 11: Host Key App — Threshold Question Handling

**Files:**
- Modify: `components/pick-em/live-game-key-host-app.tsx:1129-1262`

**Step 1: Handle threshold display in host key**

For threshold questions, the host enters the **actual result** (not picking a side). The existing `<Input>` is fine for this — no change needed for the host's answer entry since the host types the real value (e.g., "17:32").

But add a helpful indicator showing which side the entered value falls on:

```tsx
{question.answerType === 'threshold' && question.thresholdValue != null && (answer?.answer ?? '').trim() ? (
  <p className="mt-1 text-xs text-muted-foreground">
    {(() => {
      const labels = question.thresholdLabels ?? ['Over', 'Under']
      const parsed = parseValueForDisplay(answer?.answer ?? '', question.valueType)
      if (parsed === null) return 'Enter a valid value'
      return parsed > question.thresholdValue
        ? `Result: ${labels[0]} (${parsed} > ${question.thresholdValue})`
        : `Result: ${labels[1]} (${parsed} ≤ ${question.thresholdValue})`
    })()}
  </p>
) : null}
```

Add a simple parse helper for the client:
```typescript
function parseValueForDisplay(value: string, valueType: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (valueType === 'time' && trimmed.includes(':')) {
    const parts = trimmed.split(':').map(Number)
    if (parts.some((p) => Number.isNaN(p))) return null
    let total = 0
    for (const part of parts) total = total * 60 + part
    return total
  }
  const num = Number.parseFloat(trimmed)
  return Number.isFinite(num) ? num : null
}
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add components/pick-em/live-game-key-host-app.tsx
git commit -m "feat: add threshold result indicator in host key app"
```

---

### Task 12: Full Integration Test

**Files:**
- All modified files

**Step 1: Run all tests**

Run: `make fmt && make test && make lint`
Expected: All PASS

**Step 2: Fix any issues found**

Address type errors, lint errors, and test failures.

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: fix lint and type issues from enhanced auto-scoring"
```
