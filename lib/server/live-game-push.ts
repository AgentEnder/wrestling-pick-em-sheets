import webpush from "web-push";

import { db } from "@/lib/server/db/client";
import { serverEnv } from "@/lib/server/env";

type LiveGamePushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

let didConfigureWebPush = false;

function isConfigured(): boolean {
  return Boolean(
    serverEnv.WEB_PUSH_VAPID_SUBJECT &&
    serverEnv.WEB_PUSH_VAPID_PUBLIC_KEY &&
    serverEnv.WEB_PUSH_VAPID_PRIVATE_KEY,
  );
}

function configureWebPush(): boolean {
  if (didConfigureWebPush) return true;
  if (!isConfigured()) return false;

  webpush.setVapidDetails(
    serverEnv.WEB_PUSH_VAPID_SUBJECT!,
    serverEnv.WEB_PUSH_VAPID_PUBLIC_KEY!,
    serverEnv.WEB_PUSH_VAPID_PRIVATE_KEY!,
  );

  didConfigureWebPush = true;
  return true;
}

export function getLiveGamePushPublicVapidKey(): string | null {
  return (
    serverEnv.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ??
    serverEnv.WEB_PUSH_VAPID_PUBLIC_KEY ??
    null
  );
}

export async function sendLiveGamePushToSubscribers(
  gameId: string,
  payload: LiveGamePushPayload,
): Promise<void> {
  if (!configureWebPush()) return;

  const subscriptions = await db
    .selectFrom("live_game_push_subscriptions")
    .select(["endpoint", "p256dh", "auth"])
    .where("game_id", "=", gameId)
    .execute();

  if (subscriptions.length === 0) return;

  const staleEndpoints = new Set<string>();
  const notificationPayload = JSON.stringify({
    title: payload.title,
    message: payload.body,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
  });

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          notificationPayload,
          {
            TTL: 90,
          },
        );
      } catch (error) {
        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof (error as { statusCode?: unknown }).statusCode === "number"
            ? Number((error as { statusCode: number }).statusCode)
            : 0;

        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.add(subscription.endpoint);
        }
      }
    }),
  );

  if (staleEndpoints.size === 0) return;

  await db
    .deleteFrom("live_game_push_subscriptions")
    .where("game_id", "=", gameId)
    .where("endpoint", "in", [...staleEndpoints])
    .execute();
}
