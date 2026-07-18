import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('cards')
    .addColumn('sections_json', 'text', (col) => col.notNull().defaultTo('[]'))
    .execute()

  await db.schema
    .alterTable('card_overrides')
    .addColumn('sections_json', 'text')
    .execute()

  await db.schema
    .alterTable('card_matches')
    .addColumn('section_id', 'text')
    .execute()

  await db.schema
    .createTable('card_invites')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('card_id', 'text', (col) =>
      col.notNull().references('cards.id').onDelete('cascade'),
    )
    .addColumn('token', 'text', (col) => col.notNull())
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('expires_at', 'text')
    .addColumn('revoked_at', 'text')
    .addUniqueConstraint('uq_card_invites_token', ['token'])
    .execute()

  await db.schema
    .createIndex('idx_card_invites_card')
    .ifNotExists()
    .on('card_invites')
    .columns(['card_id'])
    .execute()

  await db.schema
    .createTable('card_collaborators')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('card_id', 'text', (col) =>
      col.notNull().references('cards.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('user_email', 'text')
    .addColumn('invite_id', 'text')
    .addColumn('added_at', 'text', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint('uq_card_collaborators_card_user', [
      'card_id',
      'user_id',
    ])
    .execute()

  await db.schema
    .createIndex('idx_card_collaborators_user')
    .ifNotExists()
    .on('card_collaborators')
    .columns(['user_id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('card_collaborators').ifExists().execute()
  await db.schema.dropTable('card_invites').ifExists().execute()
  await db.schema.alterTable('card_matches').dropColumn('section_id').execute()
  await db.schema
    .alterTable('card_overrides')
    .dropColumn('sections_json')
    .execute()
  await db.schema.alterTable('cards').dropColumn('sections_json').execute()
}
