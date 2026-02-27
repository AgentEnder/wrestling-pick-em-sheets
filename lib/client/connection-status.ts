export type ConnectionState = "online" | "idle" | "away";

const ONLINE_WINDOW_MS = 30_000;
const IDLE_WINDOW_MS = 2 * 60_000;

function formatAgeFromMs(ageMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(ageMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s ago`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ago`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  return `${totalHours}h ago`;
}

export function getConnectionStatus(
  lastPingAt: string,
  referenceNowMs = Date.now(),
): { state: ConnectionState; ageLabel: string } {
  const lastPingMs = new Date(lastPingAt).getTime();
  if (!Number.isFinite(lastPingMs)) {
    return { state: "away", ageLabel: "unknown" };
  }

  const ageMs = Math.max(0, referenceNowMs - lastPingMs);

  if (ageMs <= ONLINE_WINDOW_MS) {
    return { state: "online", ageLabel: formatAgeFromMs(ageMs) };
  }

  if (ageMs <= IDLE_WINDOW_MS) {
    return { state: "idle", ageLabel: formatAgeFromMs(ageMs) };
  }

  return { state: "away", ageLabel: formatAgeFromMs(ageMs) };
}
