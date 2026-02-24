import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getRosterSuggestionsByPromotionName } from '@/lib/server/repositories/rosters'

const querySchema = z.object({
  promotionName: z.string().trim().min(1).max(120),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(250),
})

function normalizeForSearch(value: string): string {
  return value.toLowerCase().trim()
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    promotionName: searchParams.get('promotionName'),
    q: searchParams.get('q') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid query parameters',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const query = normalizeForSearch(parsed.data.q ?? '')
  const suggestions = await getRosterSuggestionsByPromotionName({
    promotionName: parsed.data.promotionName,
    query,
    limit: parsed.data.limit,
  })

  return NextResponse.json({
    data: {
      promotionName: suggestions.promotionName,
      leagueId: suggestions.promotionId,
      leagueName: suggestions.promotionName,
      names: suggestions.names.slice(0, parsed.data.limit),
    },
  })
}
