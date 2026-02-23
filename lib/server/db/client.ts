import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { createClient } from '@libsql/client'
import { LibsqlDialect } from '@libsql/kysely-libsql'
import { Kysely } from 'kysely'

import { serverEnv } from '@/lib/server/env'
import type { DB } from '@/lib/server/db/generated'

function resolveGitDir(): string {
  const defaultGitDir = path.join(process.cwd(), '.git')
  if (!existsSync(defaultGitDir)) return defaultGitDir
  if (statSync(defaultGitDir).isDirectory()) return defaultGitDir

  const gitMeta = readFileSync(defaultGitDir, 'utf8').trim()
  if (!gitMeta.startsWith('gitdir:')) return defaultGitDir

  const gitDirPath = gitMeta.replace('gitdir:', '').trim()
  return path.resolve(process.cwd(), gitDirPath)
}

function getCurrentGitBranch(): string {
  const envBranch = process.env.GIT_BRANCH ?? process.env.VERCEL_GIT_COMMIT_REF
  if (envBranch?.trim()) return envBranch.trim()

  try {
    const headPath = path.join(resolveGitDir(), 'HEAD')
    const headContents = readFileSync(headPath, 'utf8').trim()

    if (headContents.startsWith('ref:')) {
      return headContents.replace('ref:', '').trim().replace('refs/heads/', '')
    }
  } catch {
    // Ignore and fall back to "local".
  }

  return 'local'
}

function sanitizeBranchName(branch: string): string {
  const sanitized = branch.toLowerCase().replace(/[^a-z0-9-_]/g, '-')
  return sanitized.length > 0 ? sanitized : 'local'
}

function resolveDatabaseConfig(): { url: string; authToken?: string } {
  const isDevLike = serverEnv.NODE_ENV !== 'production'
  const useTursoInDev = serverEnv.USE_TURSO_IN_DEV === '1'

  if (isDevLike && !useTursoInDev) {
    const dbDir = path.resolve(process.cwd(), serverEnv.LOCAL_DATABASE_DIR ?? '.local-db')
    mkdirSync(dbDir, { recursive: true })

    const branch = sanitizeBranchName(getCurrentGitBranch())
    const localDbPath = path.join(dbDir, `${branch}.sqlite`)

    return { url: `file:${localDbPath}` }
  }

  if (!serverEnv.TURSO_DATABASE_URL || !serverEnv.TURSO_AUTH_TOKEN) {
    throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required when using Turso')
  }

  return {
    url: serverEnv.TURSO_DATABASE_URL,
    authToken: serverEnv.TURSO_AUTH_TOKEN,
  }
}

const databaseConfig = resolveDatabaseConfig()

const dialect = new LibsqlDialect({
  client: createClient({
    url: databaseConfig.url,
    authToken: databaseConfig.authToken,
  }),
})

export const db = new Kysely<DB>({ dialect })
