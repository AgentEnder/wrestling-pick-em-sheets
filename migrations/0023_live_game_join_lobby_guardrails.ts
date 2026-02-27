import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  const liveGameColumns = [
    { name: 'host_join_ip', type: 'text' as const },
    { name: 'host_geo_city', type: 'text' as const },
    { name: 'host_geo_country', type: 'text' as const },
    { name: 'host_geo_latitude', type: 'real' as const },
    { name: 'host_geo_longitude', type: 'real' as const },
    { name: 'qr_join_secret', type: 'text' as const },
  ] as const

  for (const column of liveGameColumns) {
    await db.schema
      .alterTable('live_games')
      .addColumn(column.name, column.type)
      .execute()
  }

  await db.schema
    .alterTable('live_games')
    .addColumn('geo_radius_km', 'integer', (col) => col.notNull().defaultTo(50))
    .execute()

  await db.schema
    .alterTable('live_game_players')
    .addColumn('join_status', 'text', (col) =>
      col.notNull().defaultTo('approved').check(sql`join_status IN ('pending', 'approved', 'rejected')`),
    )
    .execute()

  const playerColumns = [
    { name: 'approved_at', type: 'text' as const },
    { name: 'join_request_ip', type: 'text' as const },
    { name: 'join_request_city', type: 'text' as const },
    { name: 'join_request_country', type: 'text' as const },
    { name: 'join_request_latitude', type: 'real' as const },
    { name: 'join_request_longitude', type: 'real' as const },
    { name: 'join_request_distance_km', type: 'real' as const },
  ] as const

  for (const column of playerColumns) {
    await db.schema
      .alterTable('live_game_players')
      .addColumn(column.name, column.type)
      .execute()
  }

  await db.schema
    .createIndex('idx_live_game_players_game_join_status')
    .ifNotExists()
    .on('live_game_players')
    .columns(['game_id', 'join_status'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_live_game_players_game_join_status').ifExists().execute()

  const playerColumns = [
    'join_request_distance_km',
    'join_request_longitude',
    'join_request_latitude',
    'join_request_country',
    'join_request_city',
    'join_request_ip',
    'approved_at',
    'join_status',
  ] as const

  for (const column of playerColumns) {
    await db.schema
      .alterTable('live_game_players')
      .dropColumn(column)
      .execute()
  }

  const gameColumns = [
    'qr_join_secret',
    'geo_radius_km',
    'host_geo_longitude',
    'host_geo_latitude',
    'host_geo_country',
    'host_geo_city',
    'host_join_ip',
  ] as const

  for (const column of gameColumns) {
    await db.schema
      .alterTable('live_games')
      .dropColumn(column)
      .execute()
  }
}
