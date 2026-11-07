export default `
CREATE TABLE docs (doc_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts,
  kind TEXT NOT NULL CHECK (kind IN ('post','component')), snapshot_seq INTEGER NOT NULL DEFAULT 0,
  snapshot BLOB, head_seq INTEGER NOT NULL DEFAULT 0);
CREATE TABLE updates (doc_id TEXT NOT NULL REFERENCES docs, seq INTEGER NOT NULL,
  from_device TEXT REFERENCES devices, bytes BLOB NOT NULL, vv BLOB NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, seq));
`;
