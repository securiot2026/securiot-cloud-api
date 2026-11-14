// D-06: single presence rule shared by DevicesService.getStatus and the
// device_offline cron. A device's last-seen is the most recent of its heartbeat
// (Device.lastSeenAt, driven by /frames requests on the Edge) and its newest
// Reading. Plain functions so services and tests can use them directly.

type DateLike = Date | string | number | null | undefined;

function toMs(value: DateLike): number | null {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Later of the two timestamps, or null when the device has never reported. */
export function resolveLastSeen(lastSeenAt: DateLike, lastReadingAt: DateLike): Date | null {
  const a = toMs(lastSeenAt);
  const b = toMs(lastReadingAt);
  if (a === null && b === null) return null;
  return new Date(Math.max(a ?? -Infinity, b ?? -Infinity));
}

/** True when a non-null last-seen falls inside the online window. */
export function isWithinOnlineWindow(lastSeen: Date | null, windowMs: number, nowMs: number): boolean {
  return lastSeen !== null && nowMs - lastSeen.getTime() <= windowMs;
}
