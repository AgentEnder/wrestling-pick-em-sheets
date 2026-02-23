import type { ExpressionBuilder } from 'kysely'

import type { DB } from '@/lib/server/db/generated'

export function canReadCard(
  eb: ExpressionBuilder<DB, 'cards'>,
  userId: string | null,
) {
  if (!userId) {
    return eb('public', '=', 1)
  }

  return eb.or([
    eb('owner_id', '=', userId),
    eb('public', '=', 1),
  ])
}

export function isCardOwner(
  eb: ExpressionBuilder<DB, 'cards'>,
  userId: string,
) {
  return eb('owner_id', '=', userId)
}
