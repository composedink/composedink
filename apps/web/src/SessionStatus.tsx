import { useEffect, useState } from "react";
import { ago } from "./time";

/** `session.status` and the studio's `{session}` frames (core `SessionStatus`). */
export interface Session {
  signedIn: boolean;
  server?: string;
  accountId?: string;
  deviceName?: string;
  lastSyncAt?: number;
}

/**
 * The sync state in the status bar, only when signed in ("Synced just now"); the signed-out state
 * lives once, in the header (`SignInState`). It stays visible in zen, like the save state.
 */
export function SessionStatus({ session }: { session?: Session }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!session?.signedIn) return null;
  return (
    <span
      className="session"
      data-testid="session"
      title={`Signed in as ${session.deviceName ?? "this device"} on ${session.server ?? "the server"}`}
    >
      {session.lastSyncAt === undefined
        ? "Not synced yet"
        : `Synced ${ago(session.lastSyncAt, Math.max(now, session.lastSyncAt))}`}
    </span>
  );
}
