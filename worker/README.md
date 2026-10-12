# Hospital Hub API (Cloudflare Worker + D1)

The website (GitHub Pages) stores all shared data here instead of in `hub-data.json`.

- **Worker:** `https://hosp-hub-api.mrjuniversity.workers.dev` (`src/index.js`)
- **Database:** D1 `hosp-hub` (schema in `schema.sql`)
- **Browser side:** `hub-sync.js` (record split / diff / merge) and the API client in `hub-core.js`

## How it works

- The database is split into small records (`records` table): one per hospital, ICU, duty slot,
  resident, top-level setting, and ER-scheduler key. Each record has a version `v`.
- Pages keep using `Hub.*` exactly as before. `Hub.saveDatabase()` uploads only the records that
  changed since the last load; a record changed by someone else in the meantime comes back as a
  conflict, is merged field by field in the browser, and retried. Deletions are explicit, so deleted
  items no longer come back.
- After the first visit a device keeps the server rows in `localStorage` and each page view only asks
  for rows changed since then (`/api/db?since=`). Signing out removes that copy.
- Every change keeps the previous version in `history` (120 days) and a line in `audit`.
- Passwords are stored AES-GCM encrypted (`secrets` table) and only the owner can read them.
  Logins return a signed token; the server checks the role on every write:

| Role | Can write |
|---|---|
| user | duty slots (sign-up / exchange), contact taps |
| anaesthesia | + ICU of their hospital(s) |
| admin | + hospital settings of their hospital(s), residents, specialties, ER scheduler |
| owner | everything, passwords, add/delete hospitals |

- Stored text is neutralised on write (`< > \`` removed, `" ' \` replaced by look-alikes) so names can
  never inject HTML or script into a page.

## Secrets

Set with `npx wrangler secret put <NAME>` (never committed; local copies live in `worker/.local/`,
which is git-ignored):

| Name | Purpose |
|---|---|
| `SESSION_KEY` | signs login tokens |
| `PW_KEY` | base64 AES-256 key that encrypts passwords in D1 — **losing it means resetting all passwords** |
| `BRIDGE_KEY` | used only by the former GitHub bridge; safe to delete (`npx wrangler secret delete BRIDGE_KEY`) |

## Everyday operations

```sh
cd worker
npx wrangler deploy                                          # deploy Worker changes
npx wrangler tail                                            # live logs
npx wrangler d1 export hosp-hub --remote --output backup.sql # full backup
npx wrangler d1 time-travel info hosp-hub                    # point-in-time restore info
```

- **Sign everybody out** (e.g. after changing leaked passwords): as owner, `POST /api/revoke-sessions`
  (in the browser console on the site: `fetch(Hub.CONFIG.apiBase + '/api/revoke-sessions', {method:'POST', headers:{Authorization:'Bearer ' + JSON.parse(localStorage.hospital_hub_api_token).token}})`).
- **Undo a change:** `GET /api/history?coll=<coll>&id=<id>` (owner) lists previous versions of a record.
- **ER conflict copies:** when two devices had different ER schedules, the other version is kept as
  an `er_conflict` record (`wrangler d1 execute hosp-hub --remote --command "SELECT id, updated_at FROM records WHERE coll='er_conflict'"`).

## Tests

```sh
npx wrangler dev --port 8787                                   # in worker/, uses .dev.vars
npx wrangler d1 execute hosp-hub --local --file .local/import.sql
# tests read a private snapshot from worker/.local/test-hub-data.json (or HUB_DATA=<path>)
node --test worker/test/sync.test.mjs                           # from the repo root
node --test --test-concurrency=1 worker/test/api.test.mjs       # needs a fresh import
node --test --test-concurrency=1 worker/test/client.test.mjs    # needs a fresh import
```

`node worker/scripts/build-import.mjs <snapshot.json>` turns a database snapshot (same format as the
old `hub-data.json`) into `worker/.local/import.sql` (it also creates `worker/.local/secrets.json` on first run).

## History

Until October 2026 the site stored everything in `hub-data.json` through the GitHub API. That
repository was renamed to `IQ-archive` and made private (its history contains the old data), and this
repository was started fresh with only the website code. Phones still running the old app version
reload into the current one within seconds of being opened (see `service-worker.js`).

**Still to do after the move:** change every password from the owner panel (the old ones are in the
archived history), then sign everybody out with `/api/revoke-sessions`.
