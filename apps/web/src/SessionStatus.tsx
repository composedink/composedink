import { useEffect, useState } from "react";

/** `session.status` and the studio's `{session}` frames (core `SessionStatus`). */
export interface Session {
  signedIn: boolean;
  server?: string;
  accountId?: string;
  deviceName?: string;
  lastSyncAt?: number;
}

function ago(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * The server session in the status bar. Signed out is a normal state with one visible fix; it stays
 * visible in zen mode, like the save state.
 */
export function SessionStatus({ session }: { session?: Session }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!session) return null;
  if (!session.signedIn)
    return (
      <span className="session signed-out" data-testid="session">
        Signed out <code>composed login {session.server ?? "<server>"}</code>
      </span>
    );
  return (
    <span className="session" data-testid="session" title={session.server}>
      Signed in as {session.deviceName}
      <span className="synced">
        {session.lastSyncAt === undefined
          ? "not yet synced"
          : `synced ${ago(session.lastSyncAt, Math.max(now, session.lastSyncAt))}`}
      </span>
    </span>
  );
}
