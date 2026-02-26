import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('live_game_push_subscriptions')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('game_id', 'text', (col) => col.notNull().references('live_games.id').onDelete('cascade'))
    .addColumn('player_id', 'text', (col) => col.references('live_game_players.id').onDelete('cascade'))
    .addColumn('endpoint', 'text', (col) => col.notNull())
    .addColumn('p256dh', 'text', (col) => col.notNull())
    .addColumn('auth', 'text', (col) => col.notNull())
    .addColumn('expiration_time', 'integer')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addUniqueConstraint('uq_live_game_push_subscriptions_game_endpoint', ['game_id', 'endpoint'])
    .execute()

  await db.schema
    .createIndex('idx_live_game_push_subscriptions_game')
    .on('live_game_push_subscriptions')
    .columns(['game_id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_live_game_push_subscriptions_game').ifExists().execute()
  await db.schema.dropTable('live_game_push_subscriptions').ifExists().execute()
}
