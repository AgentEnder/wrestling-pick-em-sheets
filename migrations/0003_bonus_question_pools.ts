import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('bonus_question_pools')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createIndex('idx_bonus_question_pools_sort_order')
    .ifNotExists()
    .on('bonus_question_pools')
    .columns(['is_active', 'sort_order'])
    .execute()

  await db.schema
    .createTable('bonus_question_templates')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('pool_id', 'text', (col) => col.notNull().references('bonus_question_pools.id').onDelete('cascade'))
    .addColumn('label', 'text', (col) => col.notNull())
    .addColumn('question_template', 'text', (col) => col.notNull())
    .addColumn('default_points', 'integer')
    .addColumn('answer_type', 'text', (col) => col.notNull())
    .addColumn('options_json', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addCheckConstraint('chk_bonus_question_templates_answer_type', sql`answer_type IN ('write-in', 'multiple-choice')`)
    .execute()

  await db.schema
    .createIndex('idx_bonus_question_templates_pool')
    .ifNotExists()
    .on('bonus_question_templates')
    .columns(['pool_id', 'is_active', 'sort_order'])
    .execute()

  await sql`
    INSERT INTO bonus_question_pools (id, name, description, sort_order, is_active)
    VALUES
      ('pool-duration', 'Match Duration', 'Timing-focused questions for any match.', 10, 1),
      ('pool-finish', 'Finish Type', 'Questions around clean finishes and end conditions.', 20, 1),
      ('pool-interference', 'Interference', 'Questions about outside involvement and run-ins.', 30, 1)
  `.execute(db)

  await sql`
    INSERT INTO bonus_question_templates (
      id,
      pool_id,
      label,
      question_template,
      default_points,
      answer_type,
      options_json,
      sort_order,
      is_active
    )
    VALUES
      (
        'tmpl-duration-exact-minutes',
        'pool-duration',
        'Exact duration (minutes)',
        'How long will {{matchTitle}} last (minutes)?',
        NULL,
        'write-in',
        '[]',
        10,
        1
      ),
      (
        'tmpl-finish-clean',
        'pool-finish',
        'Clean or not',
        'Will {{matchTitle}} end with a clean finish?',
        NULL,
        'multiple-choice',
        '["Clean finish","Not clean / disputed"]',
        10,
        1
      ),
      (
        'tmpl-finish-method',
        'pool-finish',
        'Finish method',
        'How will {{matchTitle}} end?',
        NULL,
        'multiple-choice',
        '["Pinfall","Submission","DQ","Count-out","No contest"]',
        20,
        1
      ),
      (
        'tmpl-interference-present',
        'pool-interference',
        'Interference present',
        'Will there be outside interference during {{matchTitle}}?',
        NULL,
        'multiple-choice',
        '["Yes","No"]',
        10,
        1
      )
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('bonus_question_templates').ifExists().execute()
  await db.schema.dropTable('bonus_question_pools').ifExists().execute()
}
