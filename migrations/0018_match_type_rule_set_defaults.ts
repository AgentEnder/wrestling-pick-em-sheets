import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('match_types')
    .addColumn('default_rule_set_ids_json', 'text', (col) => col.notNull().defaultTo('[]'))
    .execute()

  await db.executeQuery(
    sql`
      UPDATE match_types
      SET default_rule_set_ids_json = CASE
        WHEN default_is_battle_royal = 1 THEN '["timed-entry"]'
        ELSE '[]'
      END
      WHERE default_rule_set_ids_json = '[]'
    `.compile(db),
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('match_types')
    .dropColumn('default_rule_set_ids_json')
    .execute()
}
