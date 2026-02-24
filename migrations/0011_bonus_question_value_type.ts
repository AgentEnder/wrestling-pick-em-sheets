import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('bonus_question_templates')
    .addColumn('value_type', 'text', (col) =>
      col.notNull().defaultTo('string').check(sql`value_type IN ('string', 'numerical', 'time')`),
    )
    .execute()

  await db.executeQuery(
    sql`
      UPDATE bonus_question_templates
      SET value_type = CASE
        WHEN is_time_based = 1 THEN 'time'
        WHEN is_count_based = 1 THEN 'numerical'
        ELSE 'string'
      END
    `.compile(db),
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('bonus_question_templates')
    .dropColumn('value_type')
    .execute()
}
