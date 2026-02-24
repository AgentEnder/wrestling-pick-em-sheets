import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('bonus_question_pools')
    .addColumn('match_type_ids_json', 'text', (col) => col.notNull().defaultTo('[]'))
    .execute()

  await db.schema
    .alterTable('card_matches')
    .addColumn('match_type_id', 'text', (col) => col.notNull().defaultTo('singles'))
    .execute()

  await db.executeQuery(
    sql`
      UPDATE card_matches
      SET match_type_id = CASE
        WHEN match_type = 'battleRoyal' THEN 'battle-royal'
        ELSE 'singles'
      END
    `.compile(db),
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('card_matches')
    .dropColumn('match_type_id')
    .execute()

  await db.schema
    .alterTable('bonus_question_pools')
    .dropColumn('match_type_ids_json')
    .execute()
}
