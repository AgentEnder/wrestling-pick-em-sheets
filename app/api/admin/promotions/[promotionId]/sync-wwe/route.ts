import { NextResponse } from 'next/server'

import { ensureAdminRequest } from '@/lib/server/admin-auth'
import { enforceSameOrigin } from '@/lib/server/csrf'
import { syncWweRosterForPromotion } from '@/lib/server/repositories/rosters'

export async function POST(
  request: Request,
  context: { params: Promise<{ promotionId: string }> },
) {
  const csrfError = enforceSameOrigin(request)
  if (csrfError) return csrfError

  const adminError = await ensureAdminRequest()
  if (adminError) return adminError

  const { promotionId } = await context.params
  const result = await syncWweRosterForPromotion(promotionId)
  if (!result) {
    return NextResponse.json({ error: 'Promotion not found' }, { status: 404 })
  }

  return NextResponse.json({ data: result })
}
