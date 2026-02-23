import { z } from 'zod'

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TURSO_DATABASE_URL: z.string().min(1).optional(),
  TURSO_AUTH_TOKEN: z.string().min(1).optional(),
  USE_TURSO_IN_DEV: z.enum(['0', '1']).optional(),
  LOCAL_DATABASE_DIR: z.string().min(1).optional(),
})

export const serverEnv = serverEnvSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  USE_TURSO_IN_DEV: process.env.USE_TURSO_IN_DEV,
  LOCAL_DATABASE_DIR: process.env.LOCAL_DATABASE_DIR,
})
