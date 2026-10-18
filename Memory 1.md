# Memory 1 — Hospital Hub (beta) project notes

Written 2026-10-15 so a new conversation can pick up without re-explaining. Read this first.
(Markdown files are not published by `tools/build-site.mjs`, so this file stays private.)

---

## 1. What the project is

- **Hospital Hub ("بوابة المستشفيات")**: Arabic (RTL) web app for residents of Basra teaching hospitals:
  duty rosters, duty exchange, ICU bed status, residents/specialists directories, hospital admin pages,
  and an ER (emergency) duty scheduler. Installable PWA; used mostly on iPhones.
- **Three copies on the Desktop:**
  - `Desktop\HOSP HUB - Live` / `HOSP HUB - Copy`: the **live** site (repo `mHub96/IQ`, served at mhub96.github.io/IQ, API Worker `hosp-hub-api`). Do not touch without explicit permission.
  - `Desktop\HOSP HUB - Beta`: **the project we work on** (private repo `mHub96/IQ-beta`). When the user says "the beta", "IQ-Beta" or "mhub96.github.io/IQ-Beta" they mean this folder.
- **Beta URLs:** site https://hosp-hub-beta.mrjuniversity.workers.dev (Worker `hosp-hub-beta`, static assets from `dist/`), API https://hosp-hub-api-beta.mrjuniversity.workers.dev (Worker `hosp-hub-api-beta`).
- **The beta API shares the LIVE D1 database `hosp-hub`.** Anything written from the beta is seen by the live site. Only ever add tables/columns (additive migrations).

## 2. Architecture cheat sheet

- Pages: `index.html` (portal/login), `Home.html` (roster), `schedule.html`, `signup.html` (duty exchange), `icu.html`, `residents.html`, `specialists.html`, `admin.html` (hospital admin), `scheduler.html`, `s.html`, `account.html` (sign-in/sign-up/manage accounts), `emergency.html` + `emergency.js` (ER scheduler, ~620 KB).
- Shared scripts: `hub-core.js` (data, auth, `Hub.*`), `hub-sync.js`, `hub-accounts.js` (+css: sheets, notifications, nav buttons), `hub-panel.js` (account panel, lazy), `hub-avatar.js` (generated, see §6), `nav-component.js/.css`, `hub-ios.css` (iOS layer, loaded last on every page), `storage-scope.js`, `pwa.js`, `service-worker.js` (bump `CACHE_VERSION` on every deploy; currently `v3.11.0`).
- **App shell:** `app.html` + `app-shell.js/.css` keep each page as a live iframe "view" with a floating tab bar; `app-view.js` (2nd script on each page) routes links and reports pop-ups. Test a page directly with `?noshell`.
- Tailwind is prebuilt: after adding classes run `cd tools && npm run css` (content = `../*.html, ../*.js`).
- **API** (`worker/src`): `index.js` (router, `/api/db`, `/api/sync`, `/api/er`, auth tokens), `accounts.js` (personal accounts, notifications/push, likes/comments, approvals), `profile.js`, `names.js` (Arabic name normalisation `nameKey`), `push.js`, `duties.js` (My Schedule + ER portal, added this session).
- **Data:** everything shared is rows in `records(coll, id, hosp, data JSON, v)`; collections `hospital`, `resident`, `sched` (one roster slot: `{date "DD/MM/YYYY", specCode, name, dutyTime, dutySlot}`), `icu`, `meta`, `er`.
  - ER data: one big record `er / hosp_hub_emergency_state_v3` (~680 KB: `hospitalResidents[hosp]` with preferences, `monthlySchedules`, `monthlyAllocations`…) plus per-month records `hosp_hub_emergency_sched_<hosp>_<year>_<month>` (`{er:[{date, morning, afternoon, preNight, lateNight}], con:[{doctor}], dc:[{doctor}], rs:[…]}`) and `hosp_hub_emergency_alloc_*`.
  - The ER page saves its state as a whole: **the server must never rewrite the ER state record** (would clash). Do heavy JSON work in SQLite (`json_each`, `json_extract`) — Workers free plan = 10 ms CPU.
- Account roles: `user` (regular resident), `anaesthesia` (edits ICU of its hospitals), `admin` (hospital admin), `owner`, **`rotator`** (new). Shared-password logins also exist (owner/admin/anaesthesia/user).

## 3. Rules learned (follow them)

- Ask before anything that touches the **live** site or repo. Beta deploys were explicitly requested by the user.
- Remote D1 migrations: run each statement with `npx wrangler d1 execute hosp-hub --remote --command "…"` (the `--file` form fails with auth error 10000), **verify** the tables/columns exist, and only then deploy the API.
- Deploy order: migration → API (`cd worker && npx wrangler deploy`) → site (`node tools/build-site.mjs` then `npx --prefix worker wrangler deploy --config site.wrangler.jsonc`) → `git push origin main`.
- Never change values that get saved into shared data when restyling (specialty/hospital colours, colour-input defaults, ER settings).
- **Never open the beta ER page headlessly against production** — it can save the shared ER record. Never open an ER preferences portal on production in tests (it notifies real residents).
- Real accounts never to delete: `ghost` (owner, probably the user), `hamada`, `aliadnan`. Test accounts must be deleted afterwards.
- Local servers: don't leave them running; use the one-shot runner (§7).
- Inline bash heredocs containing `'` or backticks sometimes break in this environment — write scripts to files with the Write tool instead.
- The permission classifier sometimes blocks deploys or even local reads; if so, explain and let the user decide.
- Design preferences: iPhone-first, Arabic RTL, formal/elegant colours for professional features; pop-ups are bottom sheets on phones.

## 4. Work done in this conversation (all deployed to the beta)

Commits on `mHub96/IQ-beta` main: `6272901`, `9c3f30d`, `b7998a4`, `fae5460`.

1. **Pop-ups on phones (`6272901`)** — root cause of "elements disappear / transparent panels" on iPhone: closed `.modal-overlay` pop-ups (admin page had 11) stayed drawn at opacity 0 with full-screen `backdrop-filter` blur → iOS ran out of GPU memory. Fix in `hub-ios.css`: closed overlays `display:none`; one scroll area per sheet; no blur inside sheets; no sideways wobble; selects/inputs stay in the card; Emergency page modals (Tailwind `fixed inset-0 … hidden` + `.glass-panel`) are solid bottom sheets on phones and hide the app tab bar (`app-view.js`). Known leftover: emergency.html top bar ~27 px too wide on 320 px screens.
2. **ICU cards** (`icu.html`): update time in English (`Oct 12, 2026, 10:46 PM`), green if < 12 h old else grey; redraw every 5 min / on return.
3. **"جدولي" My Schedule (`9c3f30d`)** — account panel tab (not for rotators), `hub-myschedule.js/.css` lazy-loaded:
   - `GET /api/accounts/my-duties?ym=YYYY-MM`: duties from the account's hospital roster (name match by `nameKey`) + the ER month record (resident found in ER DB by phone, then name; types er/con/dc/rs).
   - Calendar (Saturday-first, today in gold), stats, duty list; per-duty private marks in table `duty_marks`: bought (+$, green), sold (−$, red, struck through), flag (swap, cover, leave, sick, exam, course, important, other) + reason, note. `POST /api/accounts/duty-mark`.
   - PDF export: html2canvas 1.4.1 + jsPDF 2.5.1 from cdnjs. Gotchas: the capture page must be **inside the viewport** (absolute, z-index −1) or html2canvas misplaces text; use system Arabic fonts (not IBM Plex) in the PDF; wrap `+$`/numbers in LTR override (U+202D…U+202C); a slightly long month is shrunk onto one A4 page.
4. **ER preferences portal (`9c3f30d`)** — `emergency-portal.js` on the ER page + `duties.js`:
   - Residents DB toolbar buttons "بوابة رغبات المقيمين" (open for a month until a deadline, extend/re-notify, close) and "ملخص الرغبات" (live summary, 30 s refresh, who hasn't sent).
   - Opening notifies every active account of the hospital (`er_portal` notification, push link `#panel=schedule` opens the form).
   - Residents fill a replica of the ER preferences panel in "جدولي" (`GET/POST /api/er-portal/mine`) and can edit until it closes. Tables `er_portals`, `er_pref_requests` (migration `0007`, applied remotely).
   - The ER page copies unapplied requests into `state.residents` when it shows the portal's month and before auto-generate (wrapped `triggerScheduleAutoGenerate`), then stamps `applied_at` (`POST /api/er-portal/applied`). Hooks in emergency.js: `window.EmergencyCore`, `er:period` event.
   - Not yet tried on production (no portal opened).
5. **Approval roles (`b7998a4`)** — admins approve as regular or anaesthesia resident only (own hospital) and can switch between those later; requests of anaesthesia residents (roster spec codes `A, ICU, OP, GA` or specialty name with تخدير/anaes) get `suggested_role: 'anaesthesia'`, pre-selected in `account.html`.
6. **Rotators (`b7998a4`)** — `POST /api/accounts/signup-rotator` (name, sex, hospital of rotation, username, password); approved by the owner + that hospital's admins; role `rotator`, `name_key = 'rotator:<id>'` (never linked to duty cards). Can view and comment (and like); cannot exchange duties (server `allowed()` + `Hub.exchangeDuty` guard + `html.role-rotator` CSS hides `signup.html` links; app tab bar hides the تبديل tab; `signup.html` redirects). They see phone numbers like residents (user may want to restrict).
7. **Avatars rebuilt in the Avataaars style (`fae5460`)** — see §6.

Earlier sessions (before this one) built: Cloudflare Worker + D1 backend, personal accounts, notifications/push, likes/comments/replies, profiles with yearly stage level-up, device limits, iOS design layer, app shell, owner administrative sector.

## 5. Decisions the user made

- Rotator sign-up asks sex and hospital; hospital admins + owner approve.
- Sign-up asks sex (male/female only). Owner manages all accounts; admins only their hospital's.
- Profile-photo uploads: idea paused (if revived: resize on phone to ~256 px WebP, store in R2, long-cache URLs; Workers free = 100k requests/day is the real limit, D1 storage is not).

## 6. Avatars (hub-avatar.js is generated)

- `tools/avatar/`: `avataaars.json` (Pablo Stanley's Avataaars artwork, MIT, converted from `avataaars@2.0.0` TSX by `convert.py`), `custom.js` (parts drawn for the site: scrubs, scrubs+stethoscope, white coat (+stethoscope), surgical cap, kufi, buzz, slick back, surgical mask, aviators, reading glasses, stubble, goatee, tired eyes, ECG/heart/medical-cross graphics, extra colours), `runtime.js` (renderer/API), `build.js`, `README.md`, licence.
- Rebuild: `node tools/avatar/build.js tools/avatar/avataaars.json "$PWD/tools/avatar/custom.js" hub-avatar.js`; then update `AVATAR_LIMITS` in `worker/src/accounts.js` to the printed counts.
- Config v3: `{ v:3, t, hc, tc, a, f, fc, c, cc, g, e, b, m, s, k }` (top, hair colour, headwear colour, accessories, facial hair + colour, clothes + colour, graphic, eyes, eyebrows, mouth, skin, background). Women: `f = 0`. Old v2 designs show the default figure. Upstream bug fixed: ShortHairShaggy colour mask.
- Coordinates for new parts: canvas 264×280, head centre x 132, skull top y 36, eyes (106,112)/(158,112), face group translate(76,82), clothes translate(0,170). Display crop viewBox `0 0 264 264` in a circular `.hav-wrap`.

## 7. Testing setup

- Local data: `worker/.local/` (test-hub-data.json, import.sql, er-state.json; secrets.json is git-ignored — never print secrets). Local D1 lives in `worker/.wrangler/state/v3/d1/…sqlite`; large inserts (ER state) must be written straight into that SQLite file (wrangler `--file` hits SQLITE_TOOBIG).
- Local test accounts (password `Pass-1234`): `adm_mv7kjvs4` (owner), `usr_mv7kjvs4` (user, renamed locally to ER resident "د. زهراء سهيل نجم" for My Schedule tests). Local only.
- One-shot runner (starts site :8095 + API :8790, runs a command, stops both): a `run-local.sh` script in the session scratchpad (copy from a previous scratchpad if missing: python http.server for the site, `npx wrangler dev --port 8790 --local` in `worker/`). Pages read `localStorage.hub_api_base` to use the local API.
- Browsers: Playwright WebKit (iPhone 13 device) from a previous scratchpad `wk/node_modules/playwright`; Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`.
- Suites: `node --test worker/test/duties.test.mjs worker/test/profile.test.mjs worker/test/push.test.mjs` (pure); `API_BASE=http://127.0.0.1:8790 node --test --test-concurrency=1 worker/test/accounts.test.mjs` with the local API running (clear `rate_limit` and `login_fail` first). All passing as of 2026-10-15.

## 8. Still open

1. Promote the beta to live (needs the user's go-ahead).
2. github.io link for the beta (public site-only repo `mHub96/IQ-new` idea; repo creation was refused by the permission classifier — user to approve or create it).
3. GitHub Actions secrets for auto-deploy (CLOUDFLARE_API_TOKEN / ACCOUNT_ID) not added; rotate leaked shared passwords.
4. Live site has an endless reload loop for guests on signup.html (fixed only in the beta).
5. First real use of the ER portal, My Schedule on real accounts, and the rotator flow; small fix pending for the emergency.html top bar on 320 px phones.
