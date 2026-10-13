# Hospital Hub API (Cloudflare Worker + D1)

> **Beta repository.** This copy deploys as Worker `hosp-hub-api-beta` and site `https://hosp-hub-beta.mrjuniversity.workers.dev`,
> both on the **same D1 database as the live site** (data is shared; duty edits made in the beta are real).
> The beta adds personal accounts, notifications and likes / comments in new tables only
> (`migrations/0002_accounts.sql`), which the live Worker never touches.

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
| `VAPID_PRIVATE` | private half of the Web Push key pair (the public half is `VAPID_PUBLIC` in `wrangler.jsonc`) |
| `PW_KEY` | base64 AES-256 key that encrypts passwords in D1 — **losing it means resetting all passwords** |

## Personal accounts

- **Sign-up** (`account.html#signup`): hospital, real name, phone, sex (male / female), username, password.
  Hospital + real name + phone are checked live against the roster
  (`POST /api/accounts/check`). The phone must belong to a resident of that hospital and the first two names must
  match, ignoring titles, hamza / ta marbuta / alef maqsura variants and diacritics. The answer never says which
  part failed, and the endpoint is rate-limited. A resident can have only one live account.
- **Approval**: new accounts stay `pending` until the owner or an admin of that hospital approves them
  (`account.html#manage`, or from the bell). The owner sees and manages every account; an admin only the plain
  user accounts of their own hospitals. Only the owner changes roles (user / anaesthesia / admin / owner) and their
  hospitals. Changes apply on the account's next request (the token only identifies the account and device).
- **Device limit** (owner, or the hospital's admin): unlimited (default), one device, or a set number (2-20).
  Every sign-in registers the browser's device id (random, kept in localStorage); a new device beyond the limit is
  refused, and unlinking a device signs it out at once. This is a per-browser lock, not hardware binding:
  clearing the browser's data makes it a new device that then needs a free slot.
- **Passwords** never reach the server: the browser sends PBKDF2-SHA256(password, `hosp-hub/v1/<username>`,
  310 000 rounds) and the server stores SHA-256(random salt || that key). Changing the password or disabling the
  account signs it out everywhere (`sess` counter).
- **Forgot password**: the user asks (username + phone), an approver allows it, and within 3 days the user sets a
  new password on the same page.
- The shared role passwords keep working during the move; `/api/revoke-sessions` signs out shared-password
  sessions only.
- **First run**: sign in with the shared owner password, create your own account, approve it in
  `account.html#manage` and give it the owner role. From then on the bell shows new requests.

## Account panel (`hub-panel.js`, opens over the current page from the avatar button)

- **Profile**: board type (Arab / Iraqi / other / none), specialty, current stage, board length in years.
  Filled in automatically at sign-up as far as the system knows: specialty from the hospital roster
  (specialty code -> Arabic name), board / stage / sex from the ER scheduler's residents list
  (`er` record `hosp_hub_emergency_state_v3`, matched by phone, then name). The board length is not
  recorded anywhere, so it is asked for. Incomplete profiles get a dot on the avatar and a reminder once a day.
- **Stage level-up**: the stage is stored with the time it was set; the stage shown is that plus one for
  every 1st of the level-up month (Iraq time) since, capped at the board length. The owner chooses the month
  (`account.html#manage` -> إعدادات عامة, default October, all hospitals); changing it keeps everyone's
  current stage. The owner can still edit any resident's profile (and sex / hospital) from the account card.
- **Avatar** (version 2): a cartoon figure drawn in SVG by `hub-avatar.js` (no image files), every part built on one
  head template so hair, headwear, beards and glasses fit. 20+ options in every category: skin (20), hair (26 styles,
  professional to wild / anime) and colour (20), eyes (21) and colour (20), eyebrows (21) and colour, moustache (21) and
  beard (21) with colour (male accounts), nose (20), mouth (20), glasses (21) and colour, headwear (21, incl. hijab,
  turban, shemagh) and colour, clothes (20) and colour, background (20). Stored as option indexes with `v: 2`;
  version-1 designs show the default figure until redesigned.
- **Username**: users can change it in Settings (unique, checked live). The password key is salted with the
  username, so the browser re-derives it and the current password confirms the change; sessions stay valid.
- **Administrative Sector** (owner): the account panel tab that holds every owner tool (accounts, password
  requests, comments, stage month, ER, scheduler, admin page, add hospital, global specialties, full backup,
  shared passwords, role switcher, statistics reset). These buttons no longer appear in the bars for the owner;
  tools that live on another page open there via `#admin=<tool>`.
- **My comments**: every comment ever written on the resident's duty cards, with totals.
- **Settings**: light / dark (the toggle moved here from the top bars), anonymous nickname, push
  notifications for this device, devices (unlink any), password.

- **Anonymous nickname**: Reddit style (`Adjective-Noun-1234` / `اسم-صفة-1234`), drawn by sex in the account's
  nickname language (Arabic or English). It stays until the user draws a new random one or sets a custom one;
  custom nicknames are 3-24 letters / digits / `- _ .`, checked live for duplicates (case, separators and Arabic
  letter variants count as the same) and may not start with reserved words (admin, owner, مدير, د ...).
- **Push notifications** (Web Push, VAPID): the browser subscribes in settings or from the bell; one subscription
  per device. Every stored notification is also pushed (encrypted per RFC 8291, sent after the response). On
  iPhone, push works only from the app added to the home screen (iOS 16.4+).

## Notifications, likes and comments

- A duty card is `duty:<hospital>:<YYYY-MM-DD>:<normalised name>`: one card per resident per duty day, so the
  next day starts with a fresh card. The server normalises names, so spelling variants of one resident share
  one card, and the resident's account (matched by name) is notified.
- The duty day runs 08:00 -> 08:00 Iraq time. Likes, new comments, and authors' edits / deletions are
  accepted only while the card's duty day is running; afterwards the card is read-only (the owner and the
  hospital's admins can still delete comments).
- On the roster, each card has one action row: like and comment (square icon buttons, on the right) then
  WhatsApp and Call, all the same height.
- Notifications are grouped per card ("X and 3 others liked ..."), polled every minute while a page is open,
  and shown as a number on the installed app icon where the phone supports it.
- Anonymous comments show the author's current nickname to everyone. Only the owner also sees the real name
  (for moderation). Authors delete their own comments; the owner any comment; an admin any comment in their
  hospitals. The moderation feed is `account.html#manage` → التعليقات (`GET /api/social/recent`).

| Endpoint | Who |
|---|---|
| `POST /api/accounts/check`, `GET /api/accounts/username`, `POST /api/accounts/signup`, `POST /api/accounts/login`, `POST /api/accounts/forgot`, `POST /api/accounts/reset`, `GET /api/social` | anyone (rate-limited) |
| `GET /api/accounts/me`, `GET /api/notifications`, `POST /api/notifications/seen`, `GET /api/social/thread`, `GET /api/push/key` | signed in |
| `GET /api/accounts/anon-check`, `POST /api/accounts/anon`, `POST /api/accounts/devices/remove`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `POST /api/push/test` | personal accounts |
| `POST /api/accounts/password`, `POST /api/social/like`, `POST /api/social/comment`, `POST /api/social/comment/delete` | personal accounts (delete: also owner / hospital admins) |
| `GET /api/accounts?filter=pending\|resets\|active\|all`, `POST /api/accounts/decide`, `GET /api/social/recent` | owner (all), hospital admins (own hospitals) |

## Deploying the beta

```sh
node tools/build-site.mjs                                              # website -> dist/
npx wrangler deploy --config site.wrangler.jsonc                       # website (static assets)
cd worker && npx wrangler deploy                                       # API
npx wrangler d1 execute hosp-hub --remote --file migrations/0002_accounts.sql   # once (additive)
npx wrangler d1 execute hosp-hub --remote --file migrations/0003_profiles.sql   # once (additive)
npx wrangler d1 execute hosp-hub --remote --file migrations/0004_avatars.sql    # once (additive)
npx wrangler d1 execute hosp-hub --remote --file migrations/0005_visit_cooldown.sql  # once (additive)
```

Apply a new migration **before** deploying Worker code that uses it, and check it succeeded. If `--file`
fails with an authentication error (code 10000), run the statements with `--command "..."` instead.

`.github/workflows/deploy.yml` does the first two (and the Worker when `worker/` changed) on every push to
`main` once the repository has the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
After editing pages: `cd tools && npm install && npm run css` rebuilds `tailwind.css`.

## Mobile design and contact visits

- `hub-ios.css` (loaded last on every page) gives phones an iOS look: system font, translucent navigation bar
  with the page title, full-width blurred tab bar, pop-ups as bottom sheets (swipe down to close, in
  `hub-accounts.js`), tactile buttons, 16px inputs (no zoom on focus) and cross-page View Transitions.
- Contact visits (Call / WhatsApp / eye badge) count once per person per resident per minute, enforced by the
  API (`visit_cooldown`, migration 0005): the person is the account, else the device, else the connection.
- The portal opens on the user's own hospital(s) (account hospital + administered ones); "all" is one tap away
  and remembered.

## Everyday operations

```sh
cd worker
npx wrangler deploy                                          # deploy Worker changes
npx wrangler tail                                            # live logs
npx wrangler d1 export hosp-hub --remote --output backup.sql # full backup
npx wrangler d1 time-travel info hosp-hub                    # point-in-time restore info
```

- **Sign everybody out** of shared-password sessions (e.g. after changing leaked passwords): as owner, `POST /api/revoke-sessions`
  (in the browser console on the site: `fetch(Hub.CONFIG.apiBase + '/api/revoke-sessions', {method:'POST', headers:{Authorization:'Bearer ' + JSON.parse(localStorage.hospital_hub_api_token).token}})`).
- **Undo a change:** `GET /api/history?coll=<coll>&id=<id>` (owner) lists previous versions of a record.
- **ER conflict copies:** when two devices had different ER schedules, the other version is kept as
  an `er_conflict` record (`wrangler d1 execute hosp-hub --remote --command "SELECT id, updated_at FROM records WHERE coll='er_conflict'"`).

## Tests

```sh
npx wrangler dev --port 8787                                   # in worker/, uses .dev.vars
npx wrangler d1 execute hosp-hub --local --file schema.sql
npx wrangler d1 execute hosp-hub --local --file migrations/0002_accounts.sql
npx wrangler d1 execute hosp-hub --local --file .local/import.sql
# tests read a private snapshot from worker/.local/test-hub-data.json (or HUB_DATA=<path>)
node --test worker/test/sync.test.mjs                           # from the repo root
node --test --test-concurrency=1 worker/test/api.test.mjs       # needs a fresh import
node --test --test-concurrency=1 worker/test/client.test.mjs    # needs a fresh import
node --test --test-concurrency=1 worker/test/accounts.test.mjs  # accounts, approvals, likes, comments
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
