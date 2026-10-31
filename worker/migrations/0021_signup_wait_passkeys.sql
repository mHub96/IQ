-- A sign-up waiting for its approval on the device that sent it (accounts.js signupWait), and the
-- passkeys for signing in with the phone's fingerprint / face (passkeys.js). Additive only.

CREATE TABLE IF NOT EXISTS signup_waits (
  account_id  TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  device_id   TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passkeys (
  id          TEXT PRIMARY KEY,       -- credential id (base64url)
  account_id  TEXT NOT NULL,
  public_key  TEXT NOT NULL,          -- JWK
  alg         INTEGER NOT NULL,       -- -7 ES256, -257 RS256
  rp_id       TEXT NOT NULL,          -- the site the key belongs to (mhub96.github.io, …)
  sign_count  INTEGER NOT NULL DEFAULT 0,
  label       TEXT,
  created_at  INTEGER NOT NULL,
  last_used   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_passkeys_account ON passkeys (account_id);
