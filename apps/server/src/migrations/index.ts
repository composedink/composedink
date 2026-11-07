import accounts from "./001-accounts.ts";
import sync from "./002-sync.ts";
import links from "./003-links.ts";
/** Applied in order; migration n sets `PRAGMA user_version = n`. SQL lives in modules so the bundle carries it. */
export const MIGRATIONS: readonly string[] = [accounts, sync, links];
