import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('live_games')
    .addColumn('deleted_at', 'text')
    .execute()

  await sql`CREATE INDEX IF NOT EXISTS idx_live_games_active_host_created ON live_games (host_user_id, created_at) WHERE deleted_at IS NULL`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_live_games_active_host_created`.execute(db)
  await db.schema.alterTable('live_games').dropColumn('deleted_at').execute()
}
