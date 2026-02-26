export const TEST_AUTH_USER_ID_HEADER = 'x-test-user-id'
export const TEST_AUTH_USER_EMAIL_HEADER = 'x-test-user-email'
export const TEST_AUTH_SECRET_HEADER = 'x-test-auth-secret'

export const TEST_AUTH_USER_ID_COOKIE = 'test_user_id'
export const TEST_AUTH_USER_EMAIL_COOKIE = 'test_user_email'
export const TEST_AUTH_SECRET_COOKIE = 'test_auth_secret'

const VERCEL_PREVIEW_OR_PRODUCTION = new Set(['preview', 'production'])

export interface TestAuthGuardEnv {
  TEST_AUTH_MODE?: string
  TEST_AUTH_SECRET?: string
  NEXT_PUBLIC_TEST_AUTH_MODE?: string
  VERCEL?: string
  VERCEL_ENV?: string
}

export interface TestAuthOverride {
  userId: string | null
  userEmail: string | null
}

interface TestAuthReaders {
  getHeader(name: string): string | null
  getCookie(name: string): string | null | undefined
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)
  return normalized ? normalized.toLowerCase() : null
}

function parseCookieHeader(headerValue: string | null): Record<string, string> {
  if (!headerValue) return {}

  const parsed: Record<string, string> = {}
  for (const part of headerValue.split(';')) {
    const [rawKey, ...rawValueParts] = part.split('=')
    const key = normalizeText(rawKey)
    if (!key) continue

    const rawValue = normalizeText(rawValueParts.join('='))
    if (!rawValue) continue

    try {
      parsed[key] = decodeURIComponent(rawValue)
    } catch {
      parsed[key] = rawValue
    }
  }

  return parsed
}

function readHeaderOrCookie(
  readers: TestAuthReaders,
  headerName: string,
  cookieName: string,
): string | null {
  return normalizeText(readers.getHeader(headerName)) ?? normalizeText(readers.getCookie(cookieName))
}

export function isPreviewOrProductionVercelEnv(env: TestAuthGuardEnv): boolean {
  const vercelEnv = normalizeText(env.VERCEL_ENV)?.toLowerCase() ?? ''
  return VERCEL_PREVIEW_OR_PRODUCTION.has(vercelEnv)
}

export function isVercelRuntime(env: TestAuthGuardEnv): boolean {
  const vercelFlag = normalizeText(env.VERCEL)?.toLowerCase()
  if (vercelFlag === '1' || vercelFlag === 'true') {
    return true
  }

  return isPreviewOrProductionVercelEnv(env)
}

export function hasConfiguredTestAuthEnvironment(env: TestAuthGuardEnv): boolean {
  return (
    normalizeText(env.TEST_AUTH_MODE) !== null ||
    normalizeText(env.TEST_AUTH_SECRET) !== null ||
    normalizeText(env.NEXT_PUBLIC_TEST_AUTH_MODE) !== null
  )
}

export function isTestAuthRuntimeEnabled(env: TestAuthGuardEnv): boolean {
  if (isVercelRuntime(env)) {
    return false
  }

  return normalizeText(env.TEST_AUTH_MODE) === '1'
}

export function assertTestAuthEnvironmentSafety(env: TestAuthGuardEnv): void {
  if (!isPreviewOrProductionVercelEnv(env)) {
    return
  }

  if (!hasConfiguredTestAuthEnvironment(env)) {
    return
  }

  throw new Error(
    'Test auth overrides are forbidden in Vercel preview/production. ' +
    'Remove TEST_AUTH_MODE, TEST_AUTH_SECRET, and NEXT_PUBLIC_TEST_AUTH_MODE from deployment config.',
  )
}

export function readTestAuthOverrideFromReaders(
  readers: TestAuthReaders,
  env: TestAuthGuardEnv,
): TestAuthOverride | null {
  if (!isTestAuthRuntimeEnabled(env)) {
    return null
  }

  const expectedSecret = normalizeText(env.TEST_AUTH_SECRET)
  if (!expectedSecret) {
    return null
  }

  const providedSecret = readHeaderOrCookie(
    readers,
    TEST_AUTH_SECRET_HEADER,
    TEST_AUTH_SECRET_COOKIE,
  )
  if (!providedSecret || providedSecret !== expectedSecret) {
    return null
  }

  const userId = readHeaderOrCookie(
    readers,
    TEST_AUTH_USER_ID_HEADER,
    TEST_AUTH_USER_ID_COOKIE,
  )
  const userEmail = normalizeEmail(
    readHeaderOrCookie(
      readers,
      TEST_AUTH_USER_EMAIL_HEADER,
      TEST_AUTH_USER_EMAIL_COOKIE,
    ),
  )

  if (!userId && !userEmail) {
    return null
  }

  return {
    userId,
    userEmail,
  }
}

export function readTestAuthOverrideFromRequest(
  request: Request,
  env: TestAuthGuardEnv,
): TestAuthOverride | null {
  const parsedCookies = parseCookieHeader(request.headers.get('cookie'))

  return readTestAuthOverrideFromReaders(
    {
      getHeader(name) {
        return request.headers.get(name)
      },
      getCookie(name) {
        return parsedCookies[name] ?? null
      },
    },
    env,
  )
}
