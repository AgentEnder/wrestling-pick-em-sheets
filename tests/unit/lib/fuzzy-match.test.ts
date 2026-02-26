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
