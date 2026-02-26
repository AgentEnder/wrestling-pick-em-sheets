import { NextResponse } from "next/server";
import { networkInterfaces } from "os";

import { getRequestUserId } from "@/lib/server/auth";
import { enforceSameOrigin } from "@/lib/server/csrf";
import {
  createLiveGame,
  listCardLiveGames,
} from "@/lib/server/repositories/live-games";

function buildHostUrls(
  request: Request,
  gameId: string,
  joinCode: string,
  qrJoinSecret?: string | null,
) {
  const origin = new URL(request.url).origin;
  const joinSecretSuffix = qrJoinSecret
    ? `&s=${encodeURIComponent(qrJoinSecret)}`
    : "";
  return {
    hostUrl: `${origin}/games/${gameId}/host`,
    displayUrl: `${origin}/games/${gameId}/display?code=${encodeURIComponent(joinCode)}`,
    joinUrl: `${origin}/join?code=${encodeURIComponent(joinCode)}${joinSecretSuffix}`,
  };
}

function parseHeaderFloat(request: Request, headerName: string): number | null {
  const raw = request.headers.get(headerName)?.trim();
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestIp(request: Request): string | null {
  const forwardedIp = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  if (forwardedIp) return forwardedIp;
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp && realIp.length > 0 ? realIp : null;
}

function normalizeIpForComparison(value: string | null): string | null {
  if (!value) return null;
  let normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.startsWith("::ffff:")) {
    normalized = normalized.slice(7);
  }

  const bracketMatch = normalized.match(/^\[([^[\]]+)\](?::\d+)?$/);
  if (bracketMatch?.[1]) {
    normalized = bracketMatch[1];
  } else {
    const ipv4PortMatch = normalized.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4PortMatch?.[1]) {
      normalized = ipv4PortMatch[1];
    }
  }

  return normalized;
}

function isLoopbackIp(value: string | null): boolean {
  const normalized = normalizeIpForComparison(value);
  return (
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized === "localhost"
  );
}

function isIpv4Address(value: string | null): boolean {
  if (!value) return false;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function parseHostHeader(
  hostHeader: string | null,
): { hostname: string; port: string | null } | null {
  if (!hostHeader) return null;
  const trimmed = hostHeader.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close === -1) return { hostname: trimmed, port: null };
    const hostname = trimmed.slice(1, close);
    const port = trimmed.slice(close + 1).startsWith(":")
      ? trimmed.slice(close + 2)
      : null;
    return { hostname, port: port && port.length > 0 ? port : null };
  }

  const parts = trimmed.split(":");
  if (parts.length === 1) {
    return { hostname: trimmed, port: null };
  }

  const port = parts.pop() ?? null;
  return {
    hostname: parts.join(":"),
    port: port && port.length > 0 ? port : null,
  };
}

function isPrivateIpv4(address: string): boolean {
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;
  if (address.startsWith("172.")) {
    const second = Number.parseInt(address.split(".")[1] ?? "", 10);
    return Number.isInteger(second) && second >= 16 && second <= 31;
  }
  return false;
}

function resolveLanIpv4(): string | null {
  const nets = networkInterfaces();
  const privateCandidates: string[] = [];
  const anyCandidates: string[] = [];

  for (const netList of Object.values(nets)) {
    for (const net of netList ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      anyCandidates.push(net.address);
      if (isPrivateIpv4(net.address)) {
        privateCandidates.push(net.address);
      }
    }
  }

  return privateCandidates[0] ?? anyCandidates[0] ?? null;
}

function resolveHostJoinIp(request: Request): string | null {
  const fromClient = requestIp(request);
  if (fromClient && !isLoopbackIp(fromClient)) {
    return normalizeIpForComparison(fromClient);
  }

  const forwardedHost = parseHostHeader(
    request.headers.get("x-forwarded-host")?.split(",")[0] ?? null,
  );
  if (
    isIpv4Address(forwardedHost?.hostname ?? null) &&
    !isLoopbackIp(forwardedHost?.hostname ?? null)
  ) {
    return normalizeIpForComparison(forwardedHost?.hostname ?? null);
  }

  const host = parseHostHeader(request.headers.get("host"));
  if (
    isIpv4Address(host?.hostname ?? null) &&
    !isLoopbackIp(host?.hostname ?? null)
  ) {
    return normalizeIpForComparison(host?.hostname ?? null);
  }

  if (process.env.NODE_ENV === "development") {
    return resolveLanIpv4();
  }

  return normalizeIpForComparison(fromClient);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cardId } = await context.params;
  const games = await listCardLiveGames(cardId, userId);

  if (!games) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: games });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ cardId: string }> },
) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cardId } = await context.params;
  const hostJoinIp = resolveHostJoinIp(request);
  if (process.env.NODE_ENV !== "test") {
    console.info("[live-games:lobby] host-join-ip-resolved", {
      hostJoinIp,
      requestIp: requestIp(request),
      forwardedHost: request.headers.get("x-forwarded-host"),
      host: request.headers.get("host"),
    });
  }
  const game = await createLiveGame(cardId, userId, {
    hostIp: hostJoinIp,
    hostCity: request.headers.get("x-vercel-ip-city"),
    hostCountry: request.headers.get("x-vercel-ip-country"),
    hostLatitude: parseHeaderFloat(request, "x-vercel-ip-latitude"),
    hostLongitude: parseHeaderFloat(request, "x-vercel-ip-longitude"),
  });

  if (!game) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      data: {
        game,
        ...buildHostUrls(request, game.id, game.joinCode, game.qrJoinSecret),
      },
    },
    { status: 201 },
  );
}
