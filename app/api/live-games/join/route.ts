import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestUserId } from "@/lib/server/auth";
import { enforceSameOrigin } from "@/lib/server/csrf";
import {
  readLiveGameSessionTokenFromRequest,
  writeLiveGameSessionToken,
} from "@/lib/server/live-game-session";
import { checkRateLimit } from "@/lib/server/rate-limit";
import {
  createLiveGameSessionToken,
  hashLiveGameSessionToken,
  joinLiveGameWithNickname,
} from "@/lib/server/repositories/live-games";

const joinSchema = z.object({
  joinCode: z.string().trim().min(4).max(24),
  nickname: z.string().trim().min(1).max(60),
  bypassSecret: z.string().trim().min(16).max(256).nullish(),
  deviceInfo: z
    .object({
      userAgent: z.string().trim().max(1024).optional(),
      userAgentData: z.record(z.unknown()).optional(),
    })
    .optional(),
});

function requestKey(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip && ip.length > 0 ? ip : "anon";
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

function parseHeaderFloat(request: Request, header: string): number | null {
  const raw = request.headers.get(header)?.trim();
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const rate = checkRateLimit(`join:${requestKey(request)}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: "Too many join attempts. Please wait a moment.",
        retryAfterMs: rate.retryAfterMs,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid request body");
  }

  const existingToken = readLiveGameSessionTokenFromRequest(request);
  let token = existingToken ?? createLiveGameSessionToken();
  const clerkUserId = await getRequestUserId(request);
  const ip = requestIp(request);
  const city = request.headers.get("x-vercel-ip-city");
  const country = request.headers.get("x-vercel-ip-country");
  const latitude = parseHeaderFloat(request, "x-vercel-ip-latitude");
  const longitude = parseHeaderFloat(request, "x-vercel-ip-longitude");
  if (process.env.NODE_ENV !== "test") {
    console.info("[live-games:lobby] join-request", {
      joinCode: parsed.data.joinCode.trim().toUpperCase(),
      nickname: parsed.data.nickname,
      ip,
      city,
      country,
      latitude,
      longitude,
      hasBypassSecret:
        typeof parsed.data.bypassSecret === "string" &&
        parsed.data.bypassSecret.trim().length > 0,
    });
  }
  let joined = await joinLiveGameWithNickname(
    parsed.data.joinCode,
    parsed.data.nickname,
    hashLiveGameSessionToken(token),
    {
      clerkUserId,
      requestIp: ip,
      requestCity: city,
      requestCountry: country,
      requestLatitude: latitude,
      requestLongitude: longitude,
      bypassSecret: parsed.data.bypassSecret,
      deviceInfo: parsed.data.deviceInfo,
    },
  );
  if (!joined.ok && joined.reason === "session-mismatch") {
    token = createLiveGameSessionToken();
    joined = await joinLiveGameWithNickname(
      parsed.data.joinCode,
      parsed.data.nickname,
      hashLiveGameSessionToken(token),
      {
        clerkUserId,
        requestIp: ip,
        requestCity: city,
        requestCountry: country,
        requestLatitude: latitude,
        requestLongitude: longitude,
        bypassSecret: parsed.data.bypassSecret,
        deviceInfo: parsed.data.deviceInfo,
      },
    );
  }

  if (!joined.ok) {
    if (process.env.NODE_ENV !== "test") {
      console.info("[live-games:lobby] join-request-result", {
        joinCode: parsed.data.joinCode.trim().toUpperCase(),
        nickname: parsed.data.nickname,
        result: joined.reason,
      });
    }
    if (joined.reason === "not-found") {
      return badRequest("Join code not found", 404);
    }

    if (joined.reason === "ended") {
      return badRequest("This game has ended", 409);
    }
    if (joined.reason === "entry-closed") {
      return badRequest(
        "This room is not accepting new players right now",
        409,
      );
    }
    if (joined.reason === "pending-approval") {
      const response = NextResponse.json({
        data: {
          status: "pending" as const,
        },
      });
      writeLiveGameSessionToken(response, token, request);
      return response;
    }
    if (joined.reason === "rejected") {
      return badRequest("Your join request was denied by the host", 403);
    }

    if (joined.reason === "expired") {
      return badRequest("This game code has expired", 410);
    }

    return badRequest("Nickname is already taken in this room", 409);
  }

  const response = NextResponse.json({
    data: {
      status: "joined" as const,
      gameId: joined.game.id,
      joinCode: joined.game.joinCode,
      player: joined.player,
      isNew: joined.isNew,
    },
  });

  writeLiveGameSessionToken(response, token, request);
  return response;
}
