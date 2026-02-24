import { Kysely, sql } from 'kysely'

interface PromotionSeed {
  id: string
  name: string
  aliases: string[]
  sortOrder: number
}

const PROMOTIONS: PromotionSeed[] = [
  { id: 'promo-wwe', name: 'WWE', aliases: ['World Wrestling Entertainment'], sortOrder: 10 },
  { id: 'promo-aew', name: 'AEW', aliases: ['All Elite Wrestling'], sortOrder: 20 },
  { id: 'promo-njpw', name: 'NJPW', aliases: ['New Japan Pro-Wrestling'], sortOrder: 30 },
  { id: 'promo-tna', name: 'TNA', aliases: ['Total Nonstop Action', 'Impact Wrestling'], sortOrder: 40 },
  { id: 'promo-roh', name: 'ROH', aliases: ['Ring of Honor'], sortOrder: 50 },
]

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('promotions')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('aliases_json', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addUniqueConstraint('uq_promotions_name', ['name'])
    .execute()

  await db.schema
    .createIndex('idx_promotions_sort_order')
    .ifNotExists()
    .on('promotions')
    .columns(['is_active', 'sort_order', 'name'])
    .execute()

  await db.schema
    .createTable('promotion_roster_members')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('promotion_id', 'text', (col) => col.notNull().references('promotions.id').onDelete('cascade'))
    .addColumn('display_name', 'text', (col) => col.notNull())
    .addColumn('normalized_name', 'text', (col) => col.notNull())
    .addColumn('aliases_json', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('is_active', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addUniqueConstraint('uq_promotion_roster_members_promotion_name', ['promotion_id', 'normalized_name'])
    .execute()

  await db.schema
    .createIndex('idx_promotion_roster_members_promotion')
    .ifNotExists()
    .on('promotion_roster_members')
    .columns(['promotion_id', 'is_active', 'display_name'])
    .execute()

  await db.schema
    .createIndex('idx_promotion_roster_members_normalized')
    .ifNotExists()
    .on('promotion_roster_members')
    .column('normalized_name')
    .execute()

  const now = new Date().toISOString()

  for (const promotion of PROMOTIONS) {
    await sql`
      INSERT INTO promotions (
        id,
        name,
        aliases_json,
        sort_order,
        is_active,
        created_at,
        updated_at
      )
      VALUES (
        ${promotion.id},
        ${promotion.name},
        ${JSON.stringify(promotion.aliases)},
        ${promotion.sortOrder},
        1,
        ${now},
        ${now}
      )
    `.execute(db)
  }

  // Intentionally do not seed roster members.
  // WWE roster can be synced from the WWE talent feed in admin.
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('promotion_roster_members').ifExists().execute()
  await db.schema.dropTable('promotions').ifExists().execute()
}
