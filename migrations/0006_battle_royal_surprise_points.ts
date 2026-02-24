import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('card_matches')
    .addColumn('surprise_points', 'integer')
    .execute()

  await db.schema
    .alterTable('card_match_overrides')
    .addColumn('surprise_points', 'integer')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('card_match_overrides')
    .dropColumn('surprise_points')
    .execute()

  await db.schema
    .alterTable('card_matches')
    .dropColumn('surprise_points')
    .execute()
}
