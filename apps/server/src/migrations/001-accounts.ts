export default `
CREATE TABLE accounts (account_id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE devices (device_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts,
  name TEXT NOT NULL, token_hash BLOB NOT NULL UNIQUE, created_at INTEGER NOT NULL,
  last_seen_at INTEGER, revoked_at INTEGER);
CREATE TABLE pairing_codes (code_hash BLOB PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts,
  created_by_device TEXT NOT NULL REFERENCES devices, expires_at INTEGER NOT NULL, used_at INTEGER);
`;
