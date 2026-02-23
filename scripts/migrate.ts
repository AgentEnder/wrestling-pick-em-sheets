import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { FileMigrationProvider, Migrator } from 'kysely'

import { db } from '../lib/server/db/client'

type MigrationCommand = 'up' | 'latest' | 'down'

async function run() {
  const command = (process.argv[2] ?? 'up') as MigrationCommand
  const migrationsPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'migrations',
  )

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: migrationsPath,
    }),
  })

  let result:
    | Awaited<ReturnType<typeof migrator.migrateToLatest>>
    | Awaited<ReturnType<typeof migrator.migrateDown>>

  if (command === 'down') {
    result = await migrator.migrateDown()
  } else {
    result = await migrator.migrateToLatest()
  }

  const { error, results } = result

  if (results?.length) {
    for (const migrationResult of results) {
      const status = migrationResult.status === 'Success' ? 'OK' : 'SKIPPED'
      console.log(`${status} ${migrationResult.migrationName}`)
    }
  } else {
    console.log('No migrations to run')
  }

  await db.destroy()

  if (error) {
    console.error('Migration failed', error)
    process.exit(1)
  }
}

void run()
