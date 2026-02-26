import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { scoreForQuestion } from '@/lib/server/scoring'
import type { BonusQuestion } from '@/lib/types'

function makeQuestion(overrides: Partial<BonusQuestion> = {}): BonusQuestion {
  return {
    id: 'q1',
    question: 'Test question',
    points: 10,
    answerType: 'write-in',
    options: [],
    valueType: 'string',
    gradingRule: 'exact',
    ...overrides,
  }
}

describe('scoreForQuestion with overrides', () => {
  test('override accepted=true awards full points regardless of answer', () => {
    const q = makeQuestion()
    const result = scoreForQuestion(q, 5, 'Cody Rhodes', 'Rhodes', {
      accepted: true,
      source: 'host',
      confidence: 0.87,
    })
    assert.equal(result.score, 10)
  })

  test('override accepted=false scores 0 even if answer matches', () => {
    const q = makeQuestion()
    const result = scoreForQuestion(q, 5, 'Cody Rhodes', 'Cody Rhodes', {
      accepted: false,
      source: 'host',
      confidence: 0.5,
    })
    assert.equal(result.score, 0)
  })

  test('no override uses normal comparison', () => {
    const q = makeQuestion()
    const result = scoreForQuestion(q, 5, 'Cody Rhodes', 'Cody Rhodes')
    assert.equal(result.score, 10)
  })

  test('no override wrong answer scores 0', () => {
    const q = makeQuestion()
    const result = scoreForQuestion(q, 5, 'Cody Rhodes', 'Seth Rollins')
    assert.equal(result.score, 0)
  })
})

describe('scoreForQuestion with threshold answer type', () => {
  const thresholdTimeQ = makeQuestion({
    id: 'q2',
    question: 'Over/under 15:00?',
    points: 5,
    answerType: 'threshold',
    valueType: 'time',
    thresholdValue: 900,
    thresholdLabels: ['Over', 'Under'],
  })

  test('actual > threshold, player picked Over = correct', () => {
    const result = scoreForQuestion(thresholdTimeQ, 5, '17:32', 'Over')
    assert.equal(result.score, 5)
  })

  test('actual > threshold, player picked Under = wrong', () => {
    const result = scoreForQuestion(thresholdTimeQ, 5, '17:32', 'Under')
    assert.equal(result.score, 0)
  })

  test('actual <= threshold, player picked Under = correct', () => {
    const result = scoreForQuestion(thresholdTimeQ, 5, '14:30', 'Under')
    assert.equal(result.score, 5)
  })

  test('actual <= threshold, player picked Over = wrong', () => {
    const result = scoreForQuestion(thresholdTimeQ, 5, '14:30', 'Over')
    assert.equal(result.score, 0)
  })

  test('exact threshold value, player picked Under = correct (<=)', () => {
    const result = scoreForQuestion(thresholdTimeQ, 5, '15:00', 'Under')
    assert.equal(result.score, 5)
  })

  test('numerical threshold', () => {
    const q = makeQuestion({
      answerType: 'threshold',
      valueType: 'numerical',
      thresholdValue: 3.5,
      thresholdLabels: ['Over', 'Under'],
      points: 5,
    })
    const result = scoreForQuestion(q, 5, '4', 'Over')
    assert.equal(result.score, 5)
  })

  test('threshold with default labels', () => {
    const q = makeQuestion({
      answerType: 'threshold',
      valueType: 'time',
      thresholdValue: 900,
      points: 5,
    })
    const result = scoreForQuestion(q, 5, '17:32', 'Over')
    assert.equal(result.score, 5)
  })
})

describe('scoreForQuestion existing behavior preserved', () => {
  test('exact string match case insensitive', () => {
    const q = makeQuestion()
    const result = scoreForQuestion(q, 5, 'Cody Rhodes', 'cody rhodes')
    assert.equal(result.score, 10)
  })

  test('numerical exact match', () => {
    const q = makeQuestion({ valueType: 'numerical' })
    const result = scoreForQuestion(q, 5, '42', '42')
    assert.equal(result.score, 10)
  })

  test('time exact match', () => {
    const q = makeQuestion({ valueType: 'time' })
    const result = scoreForQuestion(q, 5, '15:30', '15:30')
    assert.equal(result.score, 10)
  })

  test('closest rule returns isClosestCandidate', () => {
    const q = makeQuestion({ valueType: 'numerical', gradingRule: 'closest' })
    const result = scoreForQuestion(q, 5, '100', '95')
    assert.equal(result.score, 0)
    assert.equal(result.isClosestCandidate, true)
    assert.equal(result.distance, 5)
  })

  test('atOrAbove rule', () => {
    const q = makeQuestion({ valueType: 'numerical', gradingRule: 'atOrAbove' })
    assert.equal(scoreForQuestion(q, 5, '100', '105').score, 10)
    assert.equal(scoreForQuestion(q, 5, '100', '95').score, 0)
  })

  test('atOrBelow rule', () => {
    const q = makeQuestion({ valueType: 'numerical', gradingRule: 'atOrBelow' })
    assert.equal(scoreForQuestion(q, 5, '100', '95').score, 10)
    assert.equal(scoreForQuestion(q, 5, '100', '105').score, 0)
  })

  test('empty answers score 0', () => {
    const q = makeQuestion()
    assert.equal(scoreForQuestion(q, 5, '', 'answer').score, 0)
    assert.equal(scoreForQuestion(q, 5, 'answer', '').score, 0)
  })

  test('uses question points over default', () => {
    const q = makeQuestion({ points: 20 })
    const result = scoreForQuestion(q, 5, 'A', 'A')
    assert.equal(result.score, 20)
  })

  test('uses default when question points is null', () => {
    const q = makeQuestion({ points: null })
    const result = scoreForQuestion(q, 5, 'A', 'A')
    assert.equal(result.score, 5)
  })
})
