// Playwright config for auth-override end-to-end checks.
// Uses a dedicated local SQLite branch and test-only auth secret.
const { defineConfig } = require('@playwright/test')

const PORT = 3101
const BASE_URL = `http://127.0.0.1:${PORT}`
const HEALTHCHECK_URL = `${BASE_URL}/api/cards`
const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET ?? 'playwright-secret'

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      origin: BASE_URL,
    },
  },
  webServer: {
    command: `pnpm db:migrate:latest && pnpm exec next dev -p ${PORT}`,
    url: HEALTHCHECK_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'test',
      USE_TURSO_IN_DEV: '0',
      LOCAL_DATABASE_DIR: '.local-db',
      GIT_BRANCH: 'playwright-e2e',
      TEST_AUTH_MODE: '1',
      TEST_AUTH_SECRET,
      NEXT_PUBLIC_TEST_AUTH_MODE: '1',
    },
  },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
})
