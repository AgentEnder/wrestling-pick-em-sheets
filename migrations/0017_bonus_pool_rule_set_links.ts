import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('bonus_question_pools')
    .addColumn('rule_set_ids_json', 'text', (col) => col.notNull().defaultTo('[]'))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('bonus_question_pools')
    .dropColumn('rule_set_ids_json')
    .execute()
}
