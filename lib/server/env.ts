import { z } from 'zod'

import { assertTestAuthEnvironmentSafety } from '@/lib/server/test-auth-guard'

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TURSO_DATABASE_URL: z.string().min(1).optional(),
  TURSO_AUTH_TOKEN: z.string().min(1).optional(),
  USE_TURSO_IN_DEV: z.enum(['0', '1']).optional(),
  LOCAL_DATABASE_DIR: z.string().min(1).optional(),
  TEST_AUTH_MODE: z.enum(['0', '1']).optional(),
  TEST_AUTH_SECRET: z.string().min(1).optional(),
  NEXT_PUBLIC_TEST_AUTH_MODE: z.enum(['0', '1']).optional(),
  WEB_PUSH_VAPID_SUBJECT: z.string().min(1).optional(),
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VERCEL: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
})

const parsedServerEnv = serverEnvSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  USE_TURSO_IN_DEV: process.env.USE_TURSO_IN_DEV,
  LOCAL_DATABASE_DIR: process.env.LOCAL_DATABASE_DIR,
  TEST_AUTH_MODE: process.env.TEST_AUTH_MODE,
  TEST_AUTH_SECRET: process.env.TEST_AUTH_SECRET,
  NEXT_PUBLIC_TEST_AUTH_MODE: process.env.NEXT_PUBLIC_TEST_AUTH_MODE,
  WEB_PUSH_VAPID_SUBJECT: process.env.WEB_PUSH_VAPID_SUBJECT,
  WEB_PUSH_VAPID_PUBLIC_KEY: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
  WEB_PUSH_VAPID_PRIVATE_KEY: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
  NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY,
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
})

assertTestAuthEnvironmentSafety(parsedServerEnv)

export const serverEnv = parsedServerEnv
