import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('cards')
    .addColumn('promotion_name', 'text')
    .execute()

  await db.schema
    .alterTable('card_overrides')
    .addColumn('promotion_name', 'text')
    .execute()

  await db.schema
    .createTable('sportsdb_cache_entries')
    .ifNotExists()
    .addColumn('cache_key', 'text', (col) => col.primaryKey())
    .addColumn('payload_json', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createIndex('idx_sportsdb_cache_entries_expires_at')
    .ifNotExists()
    .on('sportsdb_cache_entries')
    .column('expires_at')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('sportsdb_cache_entries').ifExists().execute()
}
