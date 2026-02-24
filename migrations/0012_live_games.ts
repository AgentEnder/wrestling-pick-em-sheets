import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('live_games')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('card_id', 'text', (col) => col.notNull().references('cards.id').onDelete('cascade'))
    .addColumn('host_user_id', 'text', (col) => col.notNull())
    .addColumn('join_code', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('lobby').check(sql`status IN ('lobby', 'live', 'ended')`),
    )
    .addColumn('key_payload_json', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('lock_state_json', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('expires_at', 'text', (col) => col.notNull())
    .addColumn('ended_at', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addUniqueConstraint('uq_live_games_join_code', ['join_code'])
    .execute()

  await db.schema
    .createIndex('idx_live_games_card_status')
    .ifNotExists()
    .on('live_games')
    .columns(['card_id', 'status'])
    .execute()

  await db.schema
    .createTable('live_game_players')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('game_id', 'text', (col) => col.notNull().references('live_games.id').onDelete('cascade'))
    .addColumn('nickname', 'text', (col) => col.notNull())
    .addColumn('normalized_nickname', 'text', (col) => col.notNull())
    .addColumn('session_token_hash', 'text', (col) => col.notNull())
    .addColumn('picks_json', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('is_submitted', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('submitted_at', 'text')
    .addColumn('joined_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('last_seen_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addUniqueConstraint('uq_live_game_players_game_nickname', ['game_id', 'normalized_nickname'])
    .addUniqueConstraint('uq_live_game_players_game_session', ['game_id', 'session_token_hash'])
    .execute()

  await db.schema
    .createIndex('idx_live_game_players_game_submitted')
    .ifNotExists()
    .on('live_game_players')
    .columns(['game_id', 'is_submitted'])
    .execute()

  await db.schema
    .createTable('live_game_events')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('game_id', 'text', (col) => col.notNull().references('live_games.id').onDelete('cascade'))
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('event_payload_json', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createIndex('idx_live_game_events_game_created')
    .ifNotExists()
    .on('live_game_events')
    .columns(['game_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('live_game_events').ifExists().execute()
  await db.schema.dropTable('live_game_players').ifExists().execute()
  await db.schema.dropTable('live_games').ifExists().execute()
}
