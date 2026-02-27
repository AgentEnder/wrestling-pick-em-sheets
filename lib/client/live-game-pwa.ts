export type LiveGameSwMessage = {
  type: "GAME_UPDATE";
  data: Record<string, unknown>;
};

type WakeLockSentinelLike = EventTarget & {
  released: boolean;
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

export async function registerLiveGameServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/live-game-sw.js", {
    scope: "/games/",
  });
}

export function subscribeToLiveGameSwMessages(
  handler: (message: LiveGameSwMessage) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  if (!("serviceWorker" in navigator)) return () => {};

  const onMessage = (event: MessageEvent<unknown>) => {
    const payload = event.data;
    if (!payload || typeof payload !== "object") return;
    const message = payload as Partial<LiveGameSwMessage>;
    if (message.type !== "GAME_UPDATE") return;
    handler({
      type: "GAME_UPDATE",
      data:
        typeof message.data === "object" && message.data != null
          ? (message.data as Record<string, unknown>)
          : {},
    });
  };

  navigator.serviceWorker.addEventListener("message", onMessage);
  return () =>
    navigator.serviceWorker.removeEventListener("message", onMessage);
}

export function getNotificationPermission():
  | NotificationPermission
  | "unsupported" {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.requestPermission();
}

export function getWebPushVapidPublicKey(): string | null {
  const key = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isWebPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function decodeVapidPublicKey(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const base64 = normalized + padding;
  const binary = window.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export async function subscribeToLiveGamePush(
  gameId: string,
): Promise<boolean> {
  if (!isWebPushSupported()) return false;
  const vapidPublicKey = getWebPushVapidPublicKey();
  if (!vapidPublicKey) return false;

  const registration = await registerLiveGameServiceWorker();
  if (!registration) return false;

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidPublicKey(vapidPublicKey),
    }));

  const response = await fetch(`/api/live-games/${gameId}/push-subscriptions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to register push subscription (${response.status})`,
    );
  }

  return true;
}

export async function unsubscribeFromLiveGamePush(
  gameId: string,
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await fetch(`/api/live-games/${gameId}/push-subscriptions`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});

  await subscription.unsubscribe().catch(() => {});
}

export async function hasAnyPushSubscription(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription != null;
}

export function vibrateForeground(pattern: number | number[]): boolean {
  if (typeof window === "undefined") return false;
  if (document.visibilityState !== "visible") return false;
  if (!("vibrate" in navigator)) return false;
  return navigator.vibrate(pattern);
}

export type WakeLockManager = {
  request: () => Promise<boolean>;
  release: () => Promise<void>;
  destroy: () => Promise<void>;
};

export function createScreenWakeLockManager(
  onStateChange?: (isActive: boolean) => void,
): WakeLockManager {
  let sentinel: WakeLockSentinelLike | null = null;
  let isDestroyed = false;
  let autoAcquire = false;

  const notify = (isActive: boolean) => {
    onStateChange?.(isActive);
  };

  const request = async (): Promise<boolean> => {
    if (isDestroyed) return false;
    if (typeof window === "undefined") return false;
    if (document.visibilityState !== "visible") return false;

    const wakeLockNavigator = navigator as WakeLockNavigator;
    if (!wakeLockNavigator.wakeLock?.request) return false;

    if (sentinel && !sentinel.released) {
      autoAcquire = true;
      notify(true);
      return true;
    }

    try {
      autoAcquire = true;
      sentinel = await wakeLockNavigator.wakeLock.request("screen");
      notify(true);
      sentinel.addEventListener("release", () => {
        sentinel = null;
        notify(false);
        if (
          document.visibilityState === "visible" &&
          !isDestroyed &&
          autoAcquire
        ) {
          void request();
        }
      });
      return true;
    } catch {
      notify(false);
      return false;
    }
  };

  const releaseInternal = async (
    preserveAutoAcquire: boolean,
  ): Promise<void> => {
    if (!preserveAutoAcquire) {
      autoAcquire = false;
    }
    const current = sentinel;
    sentinel = null;
    if (current && !current.released) {
      await current.release();
    }
    notify(false);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible" && autoAcquire) {
      void request();
      return;
    }
    if (document.visibilityState !== "visible") {
      void releaseInternal(true);
    }
  };

  if (typeof window !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  const destroy = async (): Promise<void> => {
    isDestroyed = true;
    if (typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    await releaseInternal(false);
  };

  return {
    request,
    release: () => releaseInternal(false),
    destroy,
  };
}
