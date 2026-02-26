import type { BonusGradingRule, BonusQuestion } from '@/lib/types'

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function answerEquals(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false
  return normalizeText(a) === normalizeText(b)
}

export function getQuestionRule(question: BonusQuestion): BonusGradingRule {
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
  if (Number.isFinite(numberLike)) {
    return numberLike
  }

  return null
}

export function parseTimeLike(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((part) => Number.parseFloat(part))
    if (parts.some((part) => !Number.isFinite(part))) {
      return null
    }

    let total = 0
    for (let i = 0; i < parts.length; i += 1) {
      total = (total * 60) + (parts[i] ?? 0)
    }
    return total
  }

  return parseNumericLike(trimmed)
}

export function parseValueByType(value: string, valueType: BonusQuestion['valueType']): number | null {
  if (valueType === 'time') {
    return parseTimeLike(value)
  }

  if (valueType === 'numerical') {
    return parseNumericLike(value)
  }

  return null
}

export function scoreForQuestion(
  question: BonusQuestion,
  defaultPoints: number,
  keyAnswer: string,
  playerAnswer: string,
  override?: { accepted: boolean; source: string; confidence: number },
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

  // Existing grading rule logic
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
