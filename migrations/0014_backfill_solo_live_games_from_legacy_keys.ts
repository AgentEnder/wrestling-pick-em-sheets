import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO live_games (
      id,
      card_id,
      host_user_id,
      mode,
      join_code,
      status,
      key_payload_json,
      lock_state_json,
      expires_at,
      ended_at,
      created_at,
      updated_at
    )
    SELECT
      lower(hex(randomblob(16))) AS id,
      clk.card_id,
      clk.user_id AS host_user_id,
      'solo' AS mode,
      'SOLOMIG' || upper(substr(replace(clk.id, '-', ''), 1, 12)) AS join_code,
      'lobby' AS status,
      clk.payload_json AS key_payload_json,
      '{}' AS lock_state_json,
      '2100-01-01T00:00:00.000Z' AS expires_at,
      NULL AS ended_at,
      clk.created_at,
      clk.updated_at
    FROM card_live_keys clk
    WHERE NOT EXISTS (
      SELECT 1
      FROM live_games lg
      WHERE lg.card_id = clk.card_id
        AND lg.host_user_id = clk.user_id
        AND lg.mode = 'solo'
    )
  `.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // no-op: data backfill only
}
