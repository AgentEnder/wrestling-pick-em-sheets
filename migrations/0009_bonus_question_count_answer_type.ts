import { Kysely, sql } from 'kysely'

const POOL_INDEX = ['pool_id', 'is_active', 'sort_order']

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.executeQuery(
    sql`
      CREATE TABLE bonus_question_templates__next (
        id text PRIMARY KEY,
        pool_id text NOT NULL REFERENCES bonus_question_pools(id) ON DELETE cascade,
        label text NOT NULL,
        question_template text NOT NULL,
        default_points integer,
        answer_type text NOT NULL,
        options_json text NOT NULL DEFAULT '[]',
        sort_order integer NOT NULL DEFAULT 0,
        is_active integer NOT NULL DEFAULT 1,
        created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_time_based integer NOT NULL DEFAULT 0,
        default_section text NOT NULL DEFAULT 'match' CHECK (default_section IN ('match', 'event')),
        CONSTRAINT chk_bonus_question_templates_answer_type
          CHECK (answer_type IN ('write-in', 'multiple-choice', 'count'))
      )
    `.compile(db),
  )

  await db.executeQuery(
    sql`
      INSERT INTO bonus_question_templates__next (
        id,
        pool_id,
        label,
        question_template,
        default_points,
        answer_type,
        options_json,
        sort_order,
        is_active,
        created_at,
        updated_at,
        is_time_based,
        default_section
      )
      SELECT
        id,
        pool_id,
        label,
        question_template,
        default_points,
        answer_type,
        options_json,
        sort_order,
        is_active,
        created_at,
        updated_at,
        COALESCE(is_time_based, 0),
        COALESCE(default_section, 'match')
      FROM bonus_question_templates
    `.compile(db),
  )

  await db.executeQuery(sql`DROP TABLE bonus_question_templates`.compile(db))
  await db.executeQuery(sql`ALTER TABLE bonus_question_templates__next RENAME TO bonus_question_templates`.compile(db))

  await db.schema
    .createIndex('idx_bonus_question_templates_pool')
    .ifNotExists()
    .on('bonus_question_templates')
    .columns(POOL_INDEX)
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.executeQuery(
    sql`
      CREATE TABLE bonus_question_templates__prev (
        id text PRIMARY KEY,
        pool_id text NOT NULL REFERENCES bonus_question_pools(id) ON DELETE cascade,
        label text NOT NULL,
        question_template text NOT NULL,
        default_points integer,
        answer_type text NOT NULL,
        options_json text NOT NULL DEFAULT '[]',
        sort_order integer NOT NULL DEFAULT 0,
        is_active integer NOT NULL DEFAULT 1,
        created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_time_based integer NOT NULL DEFAULT 0,
        default_section text NOT NULL DEFAULT 'match' CHECK (default_section IN ('match', 'event')),
        CONSTRAINT chk_bonus_question_templates_answer_type
          CHECK (answer_type IN ('write-in', 'multiple-choice'))
      )
    `.compile(db),
  )

  await db.executeQuery(
    sql`
      INSERT INTO bonus_question_templates__prev (
        id,
        pool_id,
        label,
        question_template,
        default_points,
        answer_type,
        options_json,
        sort_order,
        is_active,
        created_at,
        updated_at,
        is_time_based,
        default_section
      )
      SELECT
        id,
        pool_id,
        label,
        question_template,
        default_points,
        CASE
          WHEN answer_type = 'count' THEN 'write-in'
          ELSE answer_type
        END,
        CASE
          WHEN answer_type = 'multiple-choice' THEN options_json
          ELSE '[]'
        END,
        sort_order,
        is_active,
        created_at,
        updated_at,
        COALESCE(is_time_based, 0),
        COALESCE(default_section, 'match')
      FROM bonus_question_templates
    `.compile(db),
  )

  await db.executeQuery(sql`DROP TABLE bonus_question_templates`.compile(db))
  await db.executeQuery(sql`ALTER TABLE bonus_question_templates__prev RENAME TO bonus_question_templates`.compile(db))

  await db.schema
    .createIndex('idx_bonus_question_templates_pool')
    .ifNotExists()
    .on('bonus_question_templates')
    .columns(POOL_INDEX)
    .execute()
}
