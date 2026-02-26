import { NextResponse } from 'next/server'

import { getRequestUserId, isRequestAdminUser } from '@/lib/server/auth'

export async function ensureAdminRequest(request?: Request): Promise<NextResponse | null> {
  const userId = await getRequestUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isAdmin = await isRequestAdminUser(request)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}
