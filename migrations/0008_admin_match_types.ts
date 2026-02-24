import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('match_types')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('default_is_battle_royal', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()

  await db.schema
    .createIndex('idx_match_types_sort_order')
    .ifNotExists()
    .on('match_types')
    .columns(['is_active', 'sort_order'])
    .execute()

  await db.executeQuery(
    sql`
      INSERT OR IGNORE INTO match_types (
        id,
        name,
        sort_order,
        is_active,
        default_is_battle_royal
      )
      VALUES
        ('singles', 'Singles Match', 10, 1, 0),
        ('tag-team', 'Tag Team Match', 20, 1, 0),
        ('triple-threat', 'Triple Threat', 30, 1, 0),
        ('fatal-four-way', 'Fatal Four Way', 40, 1, 0),
        ('ladder', 'Ladder Match', 50, 1, 0),
        ('cage', 'Cage Match', 60, 1, 0),
        ('gauntlet', 'Gauntlet Match', 70, 1, 0),
        ('battle-royal', 'Battle Royal', 80, 1, 1)
    `.compile(db),
  )

  await db.schema
    .alterTable('card_matches')
    .addColumn('match_type_name_override', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('card_matches')
    .dropColumn('match_type_name_override')
    .execute()

  await db.schema
    .dropTable('match_types')
    .ifExists()
    .execute()
}
