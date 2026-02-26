const { test, expect } = require('@playwright/test')

const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET ?? 'playwright-secret'

function randomCardName(prefix) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
}

test.describe('test-auth override safety', () => {
  test('accepts override with a valid secret', async ({ request }) => {
    const response = await request.post('/api/cards', {
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user_e2e_host',
        'x-test-user-email': 'host@example.com',
        'x-test-auth-secret': TEST_AUTH_SECRET,
      },
      data: {
        name: randomCardName('auth-override-ok'),
      },
    })

    expect(response.status(), await response.text()).toBe(201)
    const body = await response.json()
    expect(body?.data?.ownerId).toBe('user_e2e_host')
    expect(body?.data?.id).toBeTruthy()
  })

  test('rejects override when secret is missing', async ({ request }) => {
    const response = await request.post('/api/cards', {
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user_e2e_host',
        'x-test-user-email': 'host@example.com',
      },
      data: {
        name: randomCardName('auth-override-missing-secret'),
      },
    })

    // Without a valid override secret, route falls back to normal auth and rejects.
    expect(response.status(), await response.text()).toBe(401)
  })

  test('rejects override when secret mismatches', async ({ request }) => {
    const response = await request.post('/api/cards', {
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'user_e2e_host',
        'x-test-user-email': 'host@example.com',
        'x-test-auth-secret': 'wrong-secret',
      },
      data: {
        name: randomCardName('auth-override-wrong-secret'),
      },
    })

    expect(response.status(), await response.text()).toBe(401)
  })
})
