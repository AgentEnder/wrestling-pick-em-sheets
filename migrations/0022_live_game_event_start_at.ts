import { Kysely } from 'kysely'

// Historical placeholder migration.
// The original 0022 attempted a SQLite-incompatible ALTER TABLE sequence
// and was replaced by card-level eventDate scheduling.
// Keep this no-op so databases that already recorded 0022 remain valid.
export async function up(_db: Kysely<unknown>): Promise<void> {}

export async function down(_db: Kysely<unknown>): Promise<void> {}
