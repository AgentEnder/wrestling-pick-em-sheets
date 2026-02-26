import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  resolveUserEmailWithTestOverride,
  resolveUserIdWithTestOverride,
} from '@/lib/server/auth'
import type { TestAuthGuardEnv } from '@/lib/server/test-auth-guard'

function makeEnv(overrides: Partial<TestAuthGuardEnv> = {}): TestAuthGuardEnv {
  return {
    TEST_AUTH_MODE: '1',
    TEST_AUTH_SECRET: 'top-secret',
    NEXT_PUBLIC_TEST_AUTH_MODE: '1',
    VERCEL: undefined,
    VERCEL_ENV: undefined,
    ...overrides,
  }
}

function makeRequest(input: {
  userId?: string
  userEmail?: string
  secret?: string
  asCookies?: boolean
}): Request {
  if (input.asCookies) {
    const cookieParts: string[] = []
    if (input.secret !== undefined) {
      cookieParts.push(`test_auth_secret=${encodeURIComponent(input.secret)}`)
    }
    if (input.userId !== undefined) {
      cookieParts.push(`test_user_id=${encodeURIComponent(input.userId)}`)
    }
    if (input.userEmail !== undefined) {
      cookieParts.push(`test_user_email=${encodeURIComponent(input.userEmail)}`)
    }

    return new Request('https://example.test', {
      headers: {
        cookie: cookieParts.join('; '),
      },
    })
  }

  const headers: Record<string, string> = {}
  if (input.secret !== undefined) {
    headers['x-test-auth-secret'] = input.secret
  }
  if (input.userId !== undefined) {
    headers['x-test-user-id'] = input.userId
  }
  if (input.userEmail !== undefined) {
    headers['x-test-user-email'] = input.userEmail
  }

  return new Request('https://example.test', { headers })
}

describe('auth override resolution', () => {
  test('uses override user id when env + secret are valid', async () => {
    const request = makeRequest({
      userId: 'user_test_host',
      secret: 'top-secret',
    })

    const resolved = await resolveUserIdWithTestOverride(
      request,
      'clerk_user_fallback',
      makeEnv(),
    )

    assert.equal(resolved, 'user_test_host')
  })

  test('uses override email when env + secret are valid', async () => {
    const request = makeRequest({
      userEmail: 'Admin@Example.com',
      secret: 'top-secret',
    })

    const resolved = await resolveUserEmailWithTestOverride(
      request,
      'fallback@example.com',
      makeEnv(),
    )

    assert.equal(resolved, 'admin@example.com')
  })

  test('falls back when override secret is missing', async () => {
    const request = makeRequest({
      userId: 'user_test_host',
    })

    const resolved = await resolveUserIdWithTestOverride(
      request,
      'clerk_user_fallback',
      makeEnv(),
    )

    assert.equal(resolved, 'clerk_user_fallback')
  })

  test('falls back when override secret mismatches', async () => {
    const request = makeRequest({
      userId: 'user_test_host',
      secret: 'wrong-secret',
    })

    const resolved = await resolveUserIdWithTestOverride(
      request,
      'clerk_user_fallback',
      makeEnv(),
    )

    assert.equal(resolved, 'clerk_user_fallback')
  })

  test('ignores overrides in preview/prod-like env and uses normal auth fallback', async () => {
    const request = makeRequest({
      userId: 'user_test_host',
      secret: 'top-secret',
    })

    const resolved = await resolveUserIdWithTestOverride(
      request,
      'clerk_user_fallback',
      makeEnv({ VERCEL_ENV: 'preview' }),
    )

    assert.equal(resolved, 'clerk_user_fallback')
  })

  test('supports cookie-based overrides for browser/e2e contexts', async () => {
    const request = makeRequest({
      userId: 'user_cookie_player',
      userEmail: 'player@example.com',
      secret: 'top-secret',
      asCookies: true,
    })

    const userId = await resolveUserIdWithTestOverride(
      request,
      null,
      makeEnv(),
    )
    const userEmail = await resolveUserEmailWithTestOverride(
      request,
      null,
      makeEnv(),
    )

    assert.equal(userId, 'user_cookie_player')
    assert.equal(userEmail, 'player@example.com')
  })
})
