import { NextResponse } from 'next/server'

import { listMatchTypes } from '@/lib/server/repositories/match-types'

export async function GET() {
  const matchTypes = await listMatchTypes()
  return NextResponse.json({ data: matchTypes })
}
