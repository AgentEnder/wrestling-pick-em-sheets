import { NextResponse } from 'next/server'

import { getRequestUserId, isRequestAdminUser } from '@/lib/server/auth'

export async function ensureAdminRequest(): Promise<NextResponse | null> {
  const userId = await getRequestUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isAdmin = await isRequestAdminUser()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}
