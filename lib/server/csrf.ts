import { NextResponse } from 'next/server'

const ALLOWED_FETCH_SITES = new Set(['same-origin', 'same-site', 'none'])

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null
  const [first] = value.split(',')
  const trimmed = first?.trim()
  return trimmed ? trimmed : null
}

function expectedOriginFromRequest(request: Request): string {
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'))

  if (forwardedHost && forwardedProto) {
    return `${forwardedProto}://${forwardedHost}`
  }

  return new URL(request.url).origin
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function enforceSameOrigin(request: Request): NextResponse | null {
  const expectedOrigin = expectedOriginFromRequest(request)
  const requestOrigin = normalizeOrigin(firstHeaderValue(request.headers.get('origin')))

  if (!requestOrigin || requestOrigin !== expectedOrigin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const fetchSite = firstHeaderValue(request.headers.get('sec-fetch-site'))
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}
