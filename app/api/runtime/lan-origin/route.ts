import { networkInterfaces } from 'os'

import { NextResponse } from 'next/server'

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized === '0.0.0.0'
}

function isPrivateIpv4(address: string): boolean {
  if (address.startsWith('10.')) return true
  if (address.startsWith('192.168.')) return true

  if (address.startsWith('172.')) {
    const second = Number.parseInt(address.split('.')[1] ?? '', 10)
    return Number.isInteger(second) && second >= 16 && second <= 31
  }

  return false
}

function parseHostHeader(hostHeader: string | null): { hostname: string; port: string | null } | null {
  if (!hostHeader) return null

  const trimmed = hostHeader.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']')
    if (close === -1) return { hostname: trimmed, port: null }
    const hostname = trimmed.slice(1, close)
    const port = trimmed.slice(close + 1).startsWith(':') ? trimmed.slice(close + 2) : null
    return { hostname, port: port && port.length > 0 ? port : null }
  }

  const parts = trimmed.split(':')
  if (parts.length === 1) {
    return { hostname: trimmed, port: null }
  }

  const port = parts.pop() ?? null
  const hostname = parts.join(':')
  return { hostname, port: port && port.length > 0 ? port : null }
}

function resolveLanIpv4(): string | null {
  const nets = networkInterfaces()
  const privateCandidates: string[] = []
  const anyCandidates: string[] = []

  for (const netList of Object.values(nets)) {
    for (const net of netList ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue

      anyCandidates.push(net.address)
      if (isPrivateIpv4(net.address)) {
        privateCandidates.push(net.address)
      }
    }
  }

  return privateCandidates[0] ?? anyCandidates[0] ?? null
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const forwardedHostRaw = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ?? null
  const hostRaw = request.headers.get('host')?.trim() ?? null
  const parsedForwarded = parseHostHeader(forwardedHostRaw)
  const parsedHost = parseHostHeader(hostRaw)

  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    ?? (url.protocol === 'https:' ? 'https' : 'http')

  if (parsedForwarded && !isLoopbackHost(parsedForwarded.hostname)) {
    const portSuffix = parsedForwarded.port ? `:${parsedForwarded.port}` : ''
    return NextResponse.json({
      data: {
        origin: `${protocol}://${parsedForwarded.hostname}${portSuffix}`,
      },
    })
  }

  const lanIp = resolveLanIpv4()
  if (!lanIp) {
    return NextResponse.json({ error: 'Unable to resolve LAN IP address' }, { status: 500 })
  }

  const port = parsedForwarded?.port ?? parsedHost?.port ?? (url.port || null)
  const portSuffix = port ? `:${port}` : ''

  return NextResponse.json({
    data: {
      origin: `${protocol}://${lanIp}${portSuffix}`,
    },
  })
}
