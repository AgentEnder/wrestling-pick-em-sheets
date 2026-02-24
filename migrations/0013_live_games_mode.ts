import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('live_games')
    .addColumn('mode', 'text', (col) =>
      col.notNull().defaultTo('room').check(sql`mode IN ('room', 'solo')`),
    )
    .execute()

  await db.schema
    .createIndex('idx_live_games_card_mode')
    .ifNotExists()
    .on('live_games')
    .columns(['card_id', 'mode'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_live_games_card_mode').ifExists().execute()
}
