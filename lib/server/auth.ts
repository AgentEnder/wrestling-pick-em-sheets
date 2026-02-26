import { serverEnv } from '@/lib/server/env'
import type { TestAuthGuardEnv, TestAuthOverride } from '@/lib/server/test-auth-guard'
import {
  isTestAuthRuntimeEnabled,
  readTestAuthOverrideFromReaders,
  readTestAuthOverrideFromRequest,
} from '@/lib/server/test-auth-guard'

const ADMIN_EMAIL = 'craigorycoppola@gmail.com'

interface ClerkEmailAddress {
  id: string
  emailAddress?: string | null
}

interface ClerkUser {
  primaryEmailAddressId?: string | null
  emailAddresses?: ClerkEmailAddress[]
}

interface ClerkServerApi {
  auth: () => Promise<{ userId: string | null }>
  currentUser: () => Promise<ClerkUser | null>
}

interface HeaderStoreLike {
  get(name: string): string | null
}

interface CookieStoreLike {
  get(name: string): { value?: string } | undefined
}

interface NextRequestStoresApi {
  headers: () => Promise<HeaderStoreLike>
  cookies: () => Promise<CookieStoreLike>
}

async function loadClerkServerApi(): Promise<ClerkServerApi> {
  try {
    const module = await import('@clerk/nextjs/server')

    return {
      auth: module.auth as ClerkServerApi['auth'],
      currentUser: module.currentUser as ClerkServerApi['currentUser'],
    }
  } catch (error) {
    throw new Error(
      'Clerk auth module is unavailable. Install @clerk/nextjs to use default auth.',
      { cause: error },
    )
  }
}

async function loadNextRequestStoresApi(): Promise<NextRequestStoresApi | null> {
  try {
    const module = await import('next/headers')

    return {
      headers: module.headers as NextRequestStoresApi['headers'],
      cookies: module.cookies as NextRequestStoresApi['cookies'],
    }
  } catch {
    return null
  }
}

function runtimeGuardEnv(): TestAuthGuardEnv {
  return {
    TEST_AUTH_MODE: serverEnv.TEST_AUTH_MODE,
    TEST_AUTH_SECRET: serverEnv.TEST_AUTH_SECRET,
    NEXT_PUBLIC_TEST_AUTH_MODE: serverEnv.NEXT_PUBLIC_TEST_AUTH_MODE,
    VERCEL: serverEnv.VERCEL,
    VERCEL_ENV: serverEnv.VERCEL_ENV,
  }
}

async function readTestAuthOverride(
  request?: Request | null,
  env: TestAuthGuardEnv = runtimeGuardEnv(),
): Promise<TestAuthOverride | null> {
  if (request) {
    return readTestAuthOverrideFromRequest(request, env)
  }

  const requestStoresApi = await loadNextRequestStoresApi()
  if (!requestStoresApi) {
    return null
  }

  try {
    const [headerStore, cookieStore] = await Promise.all([
      requestStoresApi.headers(),
      requestStoresApi.cookies(),
    ])

    return readTestAuthOverrideFromReaders(
      {
        getHeader(name) {
          return headerStore.get(name)
        },
        getCookie(name) {
          return cookieStore.get(name)?.value ?? null
        },
      },
      env,
    )
  } catch {
    return null
  }
}

export async function resolveUserIdWithTestOverride(
  request: Request | null,
  fallbackUserId: string | null,
  env: TestAuthGuardEnv,
): Promise<string | null> {
  const override = await readTestAuthOverride(request, env)
  if (!override) return fallbackUserId
  return override.userId
}

export async function resolveUserEmailWithTestOverride(
  request: Request | null,
  fallbackEmail: string | null,
  env: TestAuthGuardEnv,
): Promise<string | null> {
  const override = await readTestAuthOverride(request, env)
  if (!override) return fallbackEmail
  return override.userEmail
}

export async function getRequestUserId(request?: Request): Promise<string | null> {
  const env = runtimeGuardEnv()
  const override = await readTestAuthOverride(request ?? null, env)
  if (override) {
    return override.userId
  }

  if (isTestAuthRuntimeEnabled(env)) {
    return null
  }

  const { auth } = await loadClerkServerApi()
  const { userId } = await auth()
  return userId
}

export async function getRequestUserEmail(request?: Request): Promise<string | null> {
  const env = runtimeGuardEnv()
  const override = await readTestAuthOverride(request ?? null, env)
  if (override) {
    return override.userEmail
  }

  if (isTestAuthRuntimeEnabled(env)) {
    return null
  }

  const { currentUser } = await loadClerkServerApi()
  const user = await currentUser()
  if (!user) return null

  const emailAddresses = Array.isArray(user.emailAddresses) ? user.emailAddresses : []
  const primaryEmail =
    emailAddresses.find((email) => email.id === user.primaryEmailAddressId) ??
    emailAddresses[0]

  return primaryEmail?.emailAddress?.trim().toLowerCase() ?? null
}

export async function isRequestAdminUser(request?: Request): Promise<boolean> {
  const email = await getRequestUserEmail(request)
  return email === ADMIN_EMAIL
}
