import type { NextResponse } from 'next/server'

export const LIVE_GAME_SESSION_COOKIE = 'live_game_session'

function parseCookieHeader(headerValue: string | null): Record<string, string> {
  if (!headerValue) return {}

  const out: Record<string, string> = {}
  for (const part of headerValue.split(';')) {
    const [rawKey, ...rawValueParts] = part.split('=')
    const key = rawKey?.trim()
    if (!key) continue
    const value = rawValueParts.join('=').trim()
    if (!value) continue

    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }

  return out
}

export function readLiveGameSessionTokenFromRequest(request: Request): string | null {
  const cookies = parseCookieHeader(request.headers.get('cookie'))
  const token = cookies[LIVE_GAME_SESSION_COOKIE]
  if (!token || !token.trim()) return null
  return token.trim()
}

export function writeLiveGameSessionToken(response: NextResponse, token: string, request: Request): void {
  const isSecure = new URL(request.url).protocol === 'https:'

  response.cookies.set({
    name: LIVE_GAME_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  })
}
