import { createHash } from "node:crypto";

const WINDOW_MS = 60_000;
export const GUEST_REQUESTS_PER_MINUTE = 60;

/**
 * Guest requests per link token: 60 a minute, keyed by the token's SHA-256 and counted before the
 * link lookup, so probing unknown tokens costs the same as using a real one.
 */
export function guestRate(limit = GUEST_REQUESTS_PER_MINUTE) {
  const hits = new Map<string, number[]>();
  let swept = 0;
  const sweep = (now: number) => {
    if (now - swept < WINDOW_MS) return;
    swept = now;
    for (const [key, times] of hits) if (times.at(-1)! <= now - WINDOW_MS) hits.delete(key);
  };
  /** Counts one request; answers the seconds to wait when it is over the limit. */
  return (token: string, now = Date.now()): number | undefined => {
    sweep(now);
    const key = createHash("sha256").update(token).digest("base64url");
    const times = (hits.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
    hits.set(key, times);
    if (times.length >= limit) return Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / 1000));
    times.push(now);
    return undefined;
  };
}
export type GuestRate = ReturnType<typeof guestRate>;
