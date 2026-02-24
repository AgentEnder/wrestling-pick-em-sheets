import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('cards')
    .addColumn('event_bonus_questions_json', 'text', (col) => col.notNull().defaultTo('[]'))
    .execute()

  await db.schema
    .alterTable('cards')
    .addColumn('tiebreaker_is_time_based', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  await db.schema
    .alterTable('card_overrides')
    .addColumn('event_bonus_questions_json', 'text')
    .execute()

  await db.schema
    .alterTable('card_overrides')
    .addColumn('tiebreaker_is_time_based', 'integer')
    .execute()

  await db.schema
    .alterTable('bonus_question_templates')
    .addColumn('is_time_based', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  await db.schema
    .alterTable('bonus_question_templates')
    .addColumn('default_section', 'text', (col) =>
      col.notNull().defaultTo('match').check(sql`default_section IN ('match', 'event')`),
    )
    .execute()

  await db.schema
    .createTable('card_live_keys')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('card_id', 'text', (col) => col.notNull().references('cards.id').onDelete('cascade'))
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('payload_json', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('is_official', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addUniqueConstraint('uq_card_live_keys_card_user', ['card_id', 'user_id'])
    .execute()

  await db.schema
    .createIndex('idx_card_live_keys_card')
    .ifNotExists()
    .on('card_live_keys')
    .column('card_id')
    .execute()

  await db.schema
    .createIndex('idx_card_live_keys_official')
    .ifNotExists()
    .on('card_live_keys')
    .columns(['card_id', 'is_official'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('card_live_keys').ifExists().execute()
}
