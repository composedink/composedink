export default `
CREATE TABLE links (link_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts,
  doc_id TEXT NOT NULL REFERENCES docs, token_hash BLOB NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('pinned','live')), frontiers TEXT, questions TEXT NOT NULL,
  guests_may_comment INTEGER NOT NULL DEFAULT 1, expires_at INTEGER, revoked_at INTEGER,
  created_at INTEGER NOT NULL, created_by_device TEXT NOT NULL REFERENCES devices,
  CHECK ((mode = 'pinned') = (frontiers IS NOT NULL)));
CREATE TABLE render_snapshots (link_id TEXT PRIMARY KEY REFERENCES links,
  instances TEXT NOT NULL, at INTEGER NOT NULL);
`;
