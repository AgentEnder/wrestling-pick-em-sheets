const { existsSync, mkdirSync, readFileSync, statSync } = require('node:fs')
const path = require('node:path')

function resolveGitDir() {
  const defaultGitDir = path.join(process.cwd(), '.git')
  if (!existsSync(defaultGitDir)) return defaultGitDir
  if (statSync(defaultGitDir).isDirectory()) return defaultGitDir

  const gitMeta = readFileSync(defaultGitDir, 'utf8').trim()
  if (!gitMeta.startsWith('gitdir:')) return defaultGitDir

  const gitDirPath = gitMeta.replace('gitdir:', '').trim()
  return path.resolve(process.cwd(), gitDirPath)
}

function getCurrentGitBranch() {
  const envBranch = process.env.GIT_BRANCH || process.env.VERCEL_GIT_COMMIT_REF
  if (envBranch && envBranch.trim()) return envBranch.trim()

  try {
    const headPath = path.join(resolveGitDir(), 'HEAD')
    const headContents = readFileSync(headPath, 'utf8').trim()

    if (headContents.startsWith('ref:')) {
      return headContents.replace('ref:', '').trim().replace('refs/heads/', '')
    }
  } catch {
    // Ignore and fall back to local.
  }

  return 'local'
}

function sanitizeBranchName(branch) {
  const sanitized = branch.toLowerCase().replace(/[^a-z0-9-_]/g, '-')
  return sanitized.length > 0 ? sanitized : 'local'
}

function toCodegenUrl() {
  const nodeEnv = process.env.NODE_ENV || 'development'
  const isDevLike = nodeEnv !== 'production'
  const useTursoInDev = process.env.USE_TURSO_IN_DEV === '1'

  if (isDevLike && !useTursoInDev) {
    const dbDir = path.resolve(process.cwd(), process.env.LOCAL_DATABASE_DIR || '.local-db')
    mkdirSync(dbDir, { recursive: true })

    const branch = sanitizeBranchName(getCurrentGitBranch())
    return path.join(dbDir, `${branch}.sqlite`)
  }

  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN

  if (!tursoUrl || !tursoToken) {
    throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for Turso-backed codegen')
  }

  const parsed = new URL(tursoUrl)
  if (!parsed.username) {
    parsed.username = tursoToken
  }

  return parsed.toString()
}

module.exports = {
  dialect: 'sqlite',
  url: toCodegenUrl(),
  outFile: './lib/server/db/generated.ts',
  camelCase: false,
  runtimeEnums: false,
  verify: false,
  singularize: false,
}
