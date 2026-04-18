import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('cards')
    .addColumn('archived_at', 'text')
    .execute()

  await sql`CREATE INDEX IF NOT EXISTS idx_cards_active_owner_updated ON cards (owner_id, updated_at) WHERE archived_at IS NULL`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_cards_active_owner_updated`.execute(db)
  await db.schema.alterTable('cards').dropColumn('archived_at').execute()
}
