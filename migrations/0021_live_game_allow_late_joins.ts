import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('live_games')
    .addColumn('allow_late_joins', 'integer', (col) => col.notNull().defaultTo(1))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('live_games')
    .dropColumn('allow_late_joins')
    .execute()
}
