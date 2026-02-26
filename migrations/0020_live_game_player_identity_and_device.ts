import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('live_game_players')
    .addColumn('auth_method', 'text', (col) =>
      col.notNull().defaultTo('guest').check(sql`auth_method IN ('guest', 'clerk')`),
    )
    .execute()

  const nullableColumns = [
    'clerk_user_id',
    'user_agent',
    'user_agent_data_json',
    'browser_name',
    'browser_version',
    'os_name',
    'os_version',
    'device_type',
    'device_vendor',
    'device_model',
    'platform',
    'platform_version',
    'architecture',
  ] as const

  for (const column of nullableColumns) {
    await db.schema
      .alterTable('live_game_players')
      .addColumn(column, 'text')
      .execute()
  }

  await db.schema
    .createIndex('uq_live_game_players_game_clerk_user')
    .ifNotExists()
    .on('live_game_players')
    .columns(['game_id', 'clerk_user_id'])
    .unique()
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('uq_live_game_players_game_clerk_user').ifExists().execute()

  const columns = [
    'architecture',
    'platform_version',
    'platform',
    'device_model',
    'device_vendor',
    'device_type',
    'os_version',
    'os_name',
    'browser_version',
    'browser_name',
    'user_agent_data_json',
    'user_agent',
    'clerk_user_id',
    'auth_method',
  ] as const

  for (const column of columns) {
    await db.schema
      .alterTable('live_game_players')
      .dropColumn(column)
      .execute()
  }
}
