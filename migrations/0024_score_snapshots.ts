import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('live_game_score_snapshots')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('game_id', 'text', (col) => col.notNull().references('live_games.id').onDelete('cascade'))
    .addColumn('player_id', 'text', (col) => col.notNull().references('live_game_players.id').onDelete('cascade'))
    .addColumn('total_score', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_possible_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('winner_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('bonus_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('surprise_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('rank', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('player_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('score_percentage', 'real', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createIndex('idx_score_snapshots_game_player')
    .ifNotExists()
    .on('live_game_score_snapshots')
    .columns(['game_id', 'player_id'])
    .unique()
    .execute()

  await db.schema
    .createIndex('idx_score_snapshots_player')
    .ifNotExists()
    .on('live_game_score_snapshots')
    .columns(['player_id'])
    .execute()

  await db.schema
    .createIndex('idx_live_game_players_clerk_user')
    .ifNotExists()
    .on('live_game_players')
    .columns(['clerk_user_id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_live_game_players_clerk_user').ifExists().execute()
  await db.schema.dropIndex('idx_score_snapshots_player').ifExists().execute()
  await db.schema.dropIndex('idx_score_snapshots_game_player').ifExists().execute()
  await db.schema.dropTable('live_game_score_snapshots').ifExists().execute()
}
