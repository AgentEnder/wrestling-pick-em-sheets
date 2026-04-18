import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('live_game_score_snapshots')
    .addColumn('breakdown_json', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('live_game_score_snapshots')
    .dropColumn('breakdown_json')
    .execute()
}
