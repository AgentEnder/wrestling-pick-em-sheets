import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('card_matches')
    .addColumn('is_elimination_style', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  await db.schema
    .alterTable('card_match_overrides')
    .addColumn('is_elimination_style', 'integer')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('card_match_overrides')
    .dropColumn('is_elimination_style')
    .execute()

  await db.schema
    .alterTable('card_matches')
    .dropColumn('is_elimination_style')
    .execute()
}

