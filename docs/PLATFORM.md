# openvwx platform

The editor (`web/`) runs entirely in the browser and works with no server. The
server (`server/`) adds what needs one: optional accounts, cloud drawings with
version history, invites and live collaboration, crit-mode comments, public
share links and embeds, Rodeo Plus (the paid plan, `supporter` in the code), and the funding and sponsor
settings. The editor asks `GET /api/config` at start-up and shows only what
the server offers; on a static host (no server) the cloud features stay hidden.

Types for every payload below are in
[web/src/platform/protocol.ts](../web/src/platform/protocol.ts); the editor's
client for them is [web/src/platform/api.ts](../web/src/platform/api.ts).

## Running it

```bash
cd web && npm install && npm run build      # the editor, served by the server from web/dist
cd ../server && npm install
DATA_DIR=./data PUBLIC_URL=http://localhost:8080 npm start
```

During development run the editor with `npm run dev` in `web/` (port 5173): Vite
proxies `/api` to the server on 8080.

## Deploying on Coolify

One service serves the editor, the API and the collaboration socket from one
origin (so cookies and the socket need no CORS).

- New resource from this repository, build pack **Dockerfile**, base directory
  `/`, Dockerfile location `/server/Dockerfile`, port **8080**.
- Persistent storage mounted at **`/data`** (the database and every drawing).
- Environment variables as below (at least `PUBLIC_URL`).

`web/Dockerfile` still builds the editor alone as a static site (nginx), for a
host with no server.

## Environment

| Variable | Meaning |
| --- | --- |
| `PORT` | default 8080 |
| `PUBLIC_URL` | the site's address, e.g. `https://openvwx.app` (links in emails, OAuth callbacks, share links) |
| `DATA_DIR` | default `/data`: `openvwx.db`, `blobs/`, and `assets/` (each build's assets, kept a week after a build last had them, so a page opened before a deploy can still load the parts it fetches later) |
| `WEB_DIST` | the built editor to serve; default `../web/dist` |
| `CORS_ORIGINS` | extra origins allowed to call the API with credentials (comma-separated), for development |
| `REDIRECT_HOSTS` | old or alternative hostnames (comma-separated, such as an earlier domain or `www.`) whose requests are sent on to the same path on `PUBLIC_URL` with a 301 |
| `CLIENT_IP_HEADER` | the header holding the visitor's address, for sign-in rate limits: `cf-connecting-ip` behind Cloudflare. Without it, the last `X-Forwarded-For` hop is used |
| `ADMIN_EMAILS` | comma-separated: these accounts may use the admin page (`/admin`), set funding and the sponsor, and read feedback and error reports |
| `REPORTS_TOKEN` | a secret that reads and clears error reports as a bearer token, without an admin's sign-in (`server/scripts/reports.ts`) |
| `SMTP_URL`, `MAIL_FROM` | email sign-in links and invites (`smtp://user:pass@host:587`, or `smtps://…:465`). Without them, email sign-in is off in production, and in development the links are printed to the log |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Sign in with Google" (redirect URI `PUBLIC_URL/api/auth/oauth/google/callback`) |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | "Sign in with Microsoft" (common tenant; `…/oauth/microsoft/callback`) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | "Sign in with GitHub" (`…/oauth/github/callback`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Rodeo Plus; webhook at `PUBLIC_URL/api/billing/webhook` (events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`) |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` | the plan's Stripe price ids |
| `SUPPORTER_MONTHLY_LABEL`, `SUPPORTER_YEARLY_LABEL` | prices as shown, default `£2/month`, `£15/year` |
| `DRIVE_GOOGLE_CLIENT_ID`, `DRIVE_GOOGLE_API_KEY`, `DRIVE_GOOGLE_APP_ID` | opening and saving in Google Drive from the browser (Picker; scope `drive.file`) |
| `DRIVE_MICROSOFT_CLIENT_ID` | opening and saving in OneDrive from the browser (SPA app registration, redirect `PUBLIC_URL/`, scope `Files.ReadWrite`) |
| `FREE_FILES`, `FREE_BYTES`, `FREE_VERSIONS`, `FREE_SHARE_LINKS` | free plan limits (defaults 5, 250 MB, 10, true) |
| `SUPPORTER_FILES`, `SUPPORTER_BYTES`, `SUPPORTER_VERSIONS` | Rodeo Plus limits (defaults 0 = no limit, 20 GB, 0 = all) |
| `MAX_UPLOAD_BYTES` | largest drawing or cloud render job accepted (default 1 GB). The editor sends anything over 8 MB in parts, since Cloudflare takes at most 100 MB a request |
| `FUNDING_GOAL`, `FUNDING_RAISED`, `FUNDING_CURRENCY` | the starting funding bar (monthly goal and amount raised, currency default `GBP`); an admin can change it in the editor |
| `FUNDING_LINKS` | donation links, comma-separated `Label\|https://…` pairs, e.g. `Ko-fi\|https://ko-fi.com/you,GitHub Sponsors\|https://github.com/sponsors/you` |
| `CARBON_SERVE`, `CARBON_PLACEMENT` | the start hub's ad from Carbon Ads (carbonads.net): the two codes Carbon gives the site once it is accepted. A sponsor an admin sets takes the slot first; Rodeo Plus members see no ad |
| `AI_API_KEY` (or `OPENROUTER_API_KEY`) | the server's key for the Agents panel's models; without it the panel says the agents aren't set up. It never leaves the server. Set a credit limit on the key at the provider |
| `AI_BASE_URL` | an OpenAI-compatible endpoint, default `https://openrouter.ai/api/v1`. AI credit needs OpenRouter: it reports what each request cost |
| `AI_PLANNER_MODEL`, `AI_WORKER_MODEL` | the model that plans and talks, and the one its subagents run on (defaults `anthropic/claude-opus-5.5`, `anthropic/claude-haiku-5.5`) |
| `AI_MODELS` | further models a user may pick, comma-separated (default `anthropic/claude-sonnet-5.5`, a cheaper planner) |
| `AI_EFFORT` | how hard Anthropic's models think on each step when the server calls Anthropic itself: `low`, `medium` (default), `high`, `xhigh` or `max`. Thinking is most of what a run costs |
| `AI_KEEP_THINKING` | `on`: each step's thinking goes back to the model on the next, so it goes on from its own reasoning; `off` (default). On a measured run it doubled the cost (kept thinking is read again as input on every step) without shortening the steps |
| `AI_ACCESS` | who may use the agents: `all` signed-in users (default), `supporters` (Rodeo Plus) or `admins` |
| `AI_REQUESTS_PER_HOUR`, `AI_REQUESTS_PER_DAY` | model requests per user (defaults 300 and 2000; one agent step is one request) |
| `AI_CREDIT` | `on` (default): the agents are paid for with AI credit users top up through Stripe (section 5 of SETUP.md); `off`: free to every allowed user within the request limits, paid from the key |
| `AI_CURRENCY` | what credit is sold in, default `gbp` (a currency with pence or cents) |
| `AI_USD_RATE` | one US dollar in that currency, default `0.8`; providers charge in dollars. Keep it at or above the real rate |
| `AI_MARKUP`, `AI_MARKUP_PLUS` | what a request costs a user against what the provider charged: defaults `1.3` (30% more) and `1.15` for Rodeo Plus. It covers Stripe's fee, OpenRouter's fee on buying its credit, and exchange |
| `AI_TOPUPS` | the top-up amounts offered, comma-separated, default `5,10,20` |
| `AI_HOLD` | the credit a request needs to start, held while it runs, default `0.25` |
| `VOICE_TRANSCRIBE` | `on` (default): voice commands in browsers with no speech recognition of their own (Firefox, and Brave when its service fails) send the recording to `POST /api/voice/transcribe`, which has an audio model at `AI_BASE_URL` write it down, charged to AI credit; `off`: those browsers can't use voice. Needs `AI_API_KEY` (Anthropic's models don't take audio) |
| `VOICE_MODEL` | the speech-to-text model, default `google/gemini-3.1-flash-lite` (`openai/whisper-large-v3-turbo` with `VOICE_API=transcriptions`) |
| `VOICE_API` | `chat` (default): an audio-capable chat model, given a prompt and the drawing's class and layer names; `transcriptions`: OpenRouter's speech-to-text endpoint, cheaper and quicker, without the names |
| `VOICE_EFFORT` | the chat model's reasoning effort, default `none`; `off` sends none (for a model that rejects it) |
| `VOICE_REQUESTS_PER_HOUR`, `VOICE_REQUESTS_PER_DAY` | recordings per user (defaults 120 and 600), and at most 20 a minute |
| `RENDER_URL`, `RENDER_SECRET` | cloud renders: the GPU worker's endpoint (`modal deploy cloudrender/worker.py` prints it) and the secret it checks (the Modal secret `rodeo-render`). Without both, Render Image offers only this computer. Credit (`AI_*` above) is on with them even without an AI key |
| `RENDER_GPU` | the GPU a job runs on, as Modal names it, default `L40S` |
| `RENDER_USD_PER_HOUR` | what an hour of it costs at Modal with the worker's CPU and memory, default from the GPU (L40S about $2.11) |
| `RENDER_STARTUP_SECONDS` | seconds of a container's start charged on top of what the worker counts, default `15` |
| `RENDER_MAX_MINUTES` | the longest a job may run, default `60` |
| `RENDER_JOBS_PER_USER` | jobs one user may have running at once, default `2` |
| `RENDER_KEEP_DAYS` | days the pictures are kept on the server, default `7` |

Funding (goal, raised, donation links) and the sponsor (the start hub's ad) are set by an admin
(`PUT /api/admin/funding`, `PUT /api/admin/sponsor`, or Help > Funding and Sponsor Settings
in the editor) and kept in the database. Paid Stripe checkouts with the metadata
`kind=donation` (a donation Payment Link) are added to the month's total by the webhook,
on top of the admin's raised figure, and the total starts again each calendar month (UTC).
Admins also post, edit and delete the start hub's
announcements on the admin page's Announcements tab (`PUT /api/admin/announcements`); one can
also show once as a bar across the top of the editor until a date (`bannerUntil`).

Anyone can send a bug report or feature request from Help > Report a Bug… / Request a
Feature… or the start screen. Reports are kept in the database and listed for admins on
the admin page's Feedback tab; with SMTP set up, each one is also emailed to `ADMIN_EMAILS`, with
Reply-To set to the sender's address when they gave one.

The editor also reports errors on its own (`web/src/app/reports.ts`): errors nothing caught,
failures the user was shown (a render, a cloud save, opening a drawing), and saves that took
over 30 s. Each carries the build, browser, GPU, memory and view, and a trail of what happened
just before (toasts, console warnings, freezes, lost WebGL contexts, parts that wouldn't load);
never the drawing, and names in quotes are blanked out. The server files its own 500s the same
way. Reports of one error are grouped; admins read them on the admin page's Errors tab, each new
error is one line in the server log and (with SMTP) an email to `ADMIN_EMAILS`, and
`node server/scripts/reports.ts` lists them from a terminal with `REPORTS_TOKEN`. API requests
over 8 s or failing with a 5xx are logged with their size and time.

## REST API

Everything is under `/api`, JSON unless it says bytes. Errors answer
`{ error, code? }` with a 4xx/5xx status (`code`: `auth` sign in, `forbidden`,
`limit` plan limit, `plan` needs Rodeo Plus, `conflict` newer version,
`not_found`). Signing in sets an HttpOnly session cookie. Requests that change
anything must send the header `X-Requested-With: openvwx` (a CSRF guard).

### Account

| | |
| --- | --- |
| `GET /health` | `{ ok, version }` |
| `GET /config` | `ServerConfig` (its `announcements`: the start screen's news, newest first) |
| `GET /me` | `{ user: User \| null }` |
| `PATCH /me` `{ name }` | `{ user }` |
| `DELETE /me` | deletes the account and everything it owns |
| `POST /auth/email` `{ email, redirect? }` | emails a sign-in link (valid 15 minutes) |
| `GET /auth/email/callback?token&redirect` | signs in, redirects (redirect must be a path on this site) |
| `GET /auth/oauth/:provider?redirect` | starts OAuth (`google`, `microsoft`, `github`) |
| `GET /auth/oauth/:provider/callback` | finishes it, redirects |
| `POST /auth/logout` | |

### Drawings

| | |
| --- | --- |
| `GET /files` | `{ files: CloudFile[] }`, own and shared with the caller, newest first |
| `POST /files` bytes, header `X-File-Name` (URI-encoded) | `{ file }` (a first version) |
| `GET /files/:id` | `{ file, members }` |
| `PATCH /files/:id` `{ name }` | `{ file }` |
| `DELETE /files/:id` | owner only |
| `GET /files/:id/content?version=` | bytes; headers `X-Version-Id`, `X-Collab-Seq` |
| `PUT /files/:id/content` bytes | `{ file, version }`; headers `X-Base-Version` (409 `conflict` if the head moved on), `X-Version-Label`, `X-Collab-Seq` (a save from a live session: holds every change up to that seq), `X-Autosave` (`keep`: an autosave; `replace`: an autosave that also deletes the version before it when that was an unnamed autosave, if the save is checked against the head by `X-Base-Version` or `X-Collab-Seq`. The editor sends `replace` for drawings over 100 MB, which are autosaved every 15 minutes rather than every 2) |
| `GET /files/:id/versions` | `{ versions }`, newest first |
| `POST /files/:id/versions/:vid/restore` | a new head version with that content |
| `PATCH /files/:id/versions/:vid` `{ label }` | `{ version }` |
| `PUT /files/:id/thumbnail` PNG (≤ 512 KB) / `GET` | the drawing's preview |

`POST /files`, `PUT /files/:id/content` and `POST /render/jobs` take their bytes as the body,
or with no body and `X-Upload-Id` naming an upload sent in parts:

| | |
| --- | --- |
| `POST /uploads`, header `X-Upload-Size` | `{ id }`; 413 `too_large` past `MAX_UPLOAD_BYTES` |
| `PUT /uploads/:id?offset=n` bytes (≤ 64 MB) | `{ size, total }`; 409 `offset` unless `n` is where the last part ended. A part cut off on the way is dropped, so it can be sent again |
| `GET /uploads/:id` | `{ size, total }`: how much has arrived |

An upload is used once, and dropped when unused for an hour.

### Sharing

| | |
| --- | --- |
| `GET /files/:id/members` | `{ members }` |
| `PATCH /files/:id/members/:userId` `{ role }` | owner only |
| `DELETE /files/:id/members/:userId` | owner, or the member leaving |
| `POST /files/:id/invites` `{ role, email? }` | `{ invite }` (owner or editor; emailed when `email` is given) |
| `GET /invites/:token` | `{ fileName, role, inviterName }` |
| `POST /invites/:token/accept` | `{ file }` (signed in) |
| `GET /files/:id/shares` | `{ shares }` |
| `POST /files/:id/shares` `{ allowDownload }` | `{ share }` (403 `plan` without share links) |
| `DELETE /shares/:token` | revokes it |
| `GET /s/:token` | `SharedFile` (public) |
| `GET /s/:token/content` | bytes of the head version (public) |
| `GET /s/:token/poster` | the link's still preview, else the drawing's thumbnail, else a redirect to the icon (public) |
| `GET /s/:token/turntable` | the link's turning GIF, else a redirect to the poster (public) |
| `GET /shares/:token/preview` | `SharePreview` (owner or editor) |
| `PUT /shares/:token/poster?width&height` PNG or JPEG ≤ 1 MB | 204 (owner or editor) |
| `PUT /shares/:token/turntable?width&height` GIF ≤ 4 MB | 204 (owner or editor) |
| `GET /oembed?url=&maxwidth=&maxheight=` | oEmbed JSON for a share or embed address (public) |

### Embeds

Options, all optional, in this canonical order (`OPTION_KEYS`). Unknown or invalid values are ignored (the default applies).

| key | values | default | meaning |
| --- | --- | --- | --- |
| `view` | `2d`, `3d` | as the drawing opens | start in the 2D drawing or the 3D view. `3d` falls back to 2D when WebGL is missing or the drawing has no 3D model |
| `layer` | a layer id, a design layer's name, a sheet's number or a sheet's title | as saved | the active layer or sheet. `sheet=` is accepted as an alias when `layer` is absent |
| `at` | `x,y,span` (document units; span = width shown, > 0) | fitted | the 2D view's centre and width |
| `cam` | `px,py,pz,tx,ty,tz` (document units) | fitted | the 3D camera's position and the point it looks at |
| `preset` | `top bottom front back left right iso leftIso rightRearIso leftRearIso lowerRightIso lowerLeftIso lowerRightRearIso lowerLeftRearIso` | `iso` | the 3D standard view when there is no `cam` |
| `render` | `shaded textured hidden dashed wireframe sketch` | the visitor's 3D render mode | the 3D render mode |
| `rotate` | `1` (also `true` or present with no value) | off | turn slowly in 3D until touched |
| `theme` | `auto`, `light`, `dark` | `auto` | the controls' look (`auto` follows the visitor's system) |
| `ui` | `full`, `min`, `none` | `full` | `full`: name, layer picker, 2D/3D, Fit, Turn, Full Screen, Open in Rodeo. `min`: Open in Rodeo and Full Screen. `none`: a small Rodeo mark only |

Every message is a plain object with `rodeo: 1` and a `type`.

Viewer → host (`window.parent.postMessage(msg, "*")`, only when framed; the data is the share's public data):

- `{ rodeo: 1, type: "ready", name, owner /* string or null */, view: "2d" | "3d", layers: [{ id, name, kind }] }`
- `{ rodeo: 1, type: "view", view: "2d" | "3d" }` whenever 2D/3D changes
- `{ rodeo: 1, type: "selection", objects: [{ id, name, type, layer, className }] }` (at most 50; clicks select in 3D)
- `{ rodeo: 1, type: "error", message }`

Host → viewer (accepted only when `event.source === window.parent`):

- `{ rodeo: 1, type: "setView", view: "2d" | "3d", preset?: <preset> }`
- `{ rodeo: 1, type: "fit" }`
- `{ rodeo: 1, type: "rotate", on: boolean }`
- `{ rodeo: 1, type: "layer", layer: "<id, name, sheet number or title>" }`

Nothing a host sends can change the drawing, sign in, or navigate.

### Crit mode

| | |
| --- | --- |
| `GET /files/:id/comments` | `{ comments }` (members) |
| `POST /files/:id/comments` `NewComment` | `{ comment }` (owner, editor, reviewer); sent to the live session too |
| `PATCH /comments/:cid` `{ body?, resolved? }` | `{ comment }` |
| `DELETE /comments/:cid` | author or owner |
| `POST /files/:id/audio` audio bytes (≤ 5 MB) | `{ id }`, a voice note for a comment |
| `GET /audio/:id` | the audio (members) |

### Rodeo Plus and funding

| | |
| --- | --- |
| `POST /billing/checkout` `{ interval: "month" \| "year" }` | `{ url }` of Stripe Checkout |
| `POST /billing/portal` | `{ url }` of the Stripe customer portal |
| `POST /billing/webhook` | Stripe events (signature checked) |
| `PUT /admin/funding` `Funding` | admins |
| `PUT /admin/sponsor` `Sponsor \| null` | admins |
| `PUT /admin/announcements` `Announcement[]` | admins; the whole list (at most 20), newest first; answers `{ announcements }` |

### Cloud renders

Render Image's Photoreal jobs can run on a GPU at Modal instead of the user's computer. The
editor packs what the 3D view shows (web/src/features/render/pack.ts: the visible triangles,
textures, light objects, Site Context, the Render palette's settings, the sun and the shots)
and uploads it. The server holds from the user's credit what the job's time limit could cost,
cutting the limit to what they can pay, and starts it on the worker (cloudrender/worker.py:
headless Chrome on the GPU running web/render-worker.html, the same engines as the editor). It
polls the job every 2 s, keeps the pictures under `DATA_DIR/renders/` for `RENDER_KEEP_DAYS`,
and charges the seconds it ran plus `RENDER_STARTUP_SECONDS`, never more than it held. A job
that fails is not charged; a cancelled one is charged for the time it ran.

| | |
| --- | --- |
| `POST /render/jobs` | the gzipped pack, with `X-Render-Job: NewRenderJob` (URL-encoded JSON); `{ job: RenderJob }`. 402 `credit` when the credit can't pay for 90 s, 429 `busy` past `RENDER_JOBS_PER_USER` |
| `GET /render/jobs` | `{ jobs: RenderJob[] }`, the user's latest 50 |
| `GET /render/jobs/:id` | `{ job }`, with its progress and a small picture so far while it runs |
| `POST /render/jobs/:id/stop` `{ mode: "finish" \| "cancel" }` | Finish now keeps the picture in hand; Cancel discards it |
| `GET /render/jobs/:id/pictures/:n` | a picture it made (PNG or JPEG) |
| `DELETE /render/jobs/:id` | a finished job and its pictures |

To change the worker, build the editor and deploy it: `cd web && npm run build && cd .. &&
modal deploy cloudrender/worker.py`. The worker bakes in `web/dist`, so render changes reach
cloud renders only when it is deployed again. To try a job without the server:
`modal run cloudrender/worker.py --pack job.pack.gz`.

### Voice commands

The editor turns speech into text in the browser where it can (Chrome, Edge, Safari) and sends
only the words to the agent (`/ai/chat`). Where it can't, it records while the voice key is held
and sends the recording here, which passes it once to the speech model and keeps nothing.
`GET /config` says whether it can: `voice: { transcribe, by }`.

| | |
| --- | --- |
| `POST /voice/transcribe` `VoiceTranscribeRequest` | signed in; 16 kHz mono 16-bit WAV in base64, up to 30 s; `VoiceTranscript` `{ text, charged, balance }`, charged in the credit's currency with the model `voice <model>` in the ledger. 400 `bad_audio`, 402 `credit`, 403 `forbidden`/`plan` (`AI_ACCESS`), 413 `too_long`, 429 `rate_limited`, 503 `not_configured` or `provider_down` |

### Feedback

| | |
| --- | --- |
| `POST /feedback` `NewFeedback` | anyone, signed in or not; 10 an hour per address (and per account); the optional `context` keeps only the keys in `FEEDBACK_CONTEXT_KEYS` |
| `GET /admin/feedback` | admins; `{ feedback: Feedback[] }`, the newest 500 |
| `PATCH /admin/feedback/:id` `{ status: "new" \| "done" }` | admins; `{ feedback }` |
| `DELETE /admin/feedback/:id` | admins |

### Error reports

| | |
| --- | --- |
| `POST /reports` `NewErrorReport` | anyone; 60 an hour per address (and per account) |
| `GET /admin/reports` | admins or `Authorization: Bearer REPORTS_TOKEN`; `{ groups: ErrorReportGroup[] }`, the latest error first, each with its latest report in full |
| `GET /admin/reports?group=<fingerprint>` | `{ reports }`: the latest 20 of one error |
| `DELETE /admin/reports/:fingerprint` | clears an error once it is fixed |

### Admin page and visits

The admin page is `/admin` (web/admin.html, web/src/admin), a page of its own for the accounts
in `ADMIN_EMAILS`, also reached from the editor's Help > Admin Panel… (the only admin item left
in the editor). Its side bar has three groups of tabs:

- Analytics. Live: who is in the editor now on a globe, with each visitor's place, device, way
  in and time in, the last hour, today so far and live editing sessions. Overview: visitors a
  day, sign-ups, the AI credit bought, given, used and still owed, and where visitors came from.
  Audience: visitors by country and city on a globe, accounts in Rodeo each day, week and month,
  the hours people come, visit lengths, a funnel from visiting to paying, weekly sign-up cohorts
  and new against returning members. Revenue: Rodeo Plus, credit bought and taken against what
  the providers charged, use by model, cloud renders and the top spenders. Usage: cloud drawings,
  versions and storage, the gallery, comments, merge requests and agents.
- Manage. People lists the accounts, and an account's panel gives or takes back credit (with a
  note the user sees, and an email if wanted), gives Rodeo Plus for a while, signs it out
  everywhere, suspends it or deletes it. Feedback and Errors are the bug reports and the error
  reports; Gallery the moderation queue; Announcements and Funding and sponsor what the editor
  shows.
- Server. Settings sets the credit new accounts start with and makes tagged links; System shows
  the server's health, what it is set up with, and the admin log: every step an admin took.

Visits come from the editor (web/src/app/visits.ts): a word when it opens, each minute while it
is in front, and when a drawing opens (its kind only). No cookie, nothing kept on the device:
the server knows a visitor by a hash of their address and browser with a salt that changes each
day, so a person counts once a day and can't be followed across days. Where a visit came from
is the country Cloudflare names (`CF-IPCountry`) and, when its "Add visitor location headers"
managed transform is on, the city, region and a position rounded to 0.1° (about 10 km); without
them the globes place visitors at their country's middle. Admins' own visits, crawlers and test
browsers (`navigator.webdriver`) aren't counted. Rows are kept 400 days.

| | |
| --- | --- |
| `POST /visits` `{ event: "visit" \| "ping" \| "open", device, entry?, referrer?, campaign?, format? }` | anyone; 204, whatever happens |
| `GET /admin/overview?days=N` | admins; `AdminOverview` for the last N days (1 to 365) and the N before |
| `GET /admin/users?q=&filter=&sort=&offset=` | admins; `{ users: AdminUser[], total, page }`, 50 a page |
| `GET /admin/users.csv` | admins; every account as CSV |
| `GET /admin/users/:id` | admins; `AdminUserDetail`: the account, its credit history, days active |
| `POST /admin/ai-credit` `{ userId \| email, amount, note?, notify? }` | admins; gives (negative: takes back, not below nothing) credit; `{ balance }` |
| `POST /admin/users/:id/plus` `{ months }` | admins; Rodeo Plus for that many months more, or 0 to end it; refused for a plan paid through Stripe |
| `POST /admin/users/:id/sign-out` | admins; ends every session |
| `POST /admin/users/:id/suspend` `{ suspended }` | admins; a suspended account is signed out, can't sign in, and is treated as signed out |
| `DELETE /admin/users/:id` `{ email }` | admins; deletes the account as `DELETE /me` would, the email typed to confirm |
| `GET`, `PUT /admin/settings` `{ welcomeCredit }` | admins; the credit each new account starts with (0 to 50) |
| `GET /admin/live` | admins; `AdminLive`: visitors heard from in the last 3 minutes, the last hour, today, live sessions |
| `GET /admin/geo?days=N` | admins; `AdminGeo`: visitors by country and by city |
| `GET /admin/engagement?days=N` | admins; `AdminEngagement`: daily, weekly and monthly accounts, hours, visit lengths, the funnel, cohorts |
| `GET /admin/revenue?days=N` | admins; `AdminRevenue`: Rodeo Plus, credit by day and by model, renders, top spenders |
| `GET /admin/usage?days=N` | admins; `AdminUsage`: cloud drawings, the gallery, comments, merge requests, agents |
| `GET /admin/system` | admins; `AdminSystem`: version, memory, storage, what is set up, admins |
| `GET /admin/log?offset=N` | admins; `{ entries, total }`: the steps admins took, newest first, 50 a page |

## Live collaboration

`GET /api/collab/:fileId` upgrades to a WebSocket (members only; viewers and
reviewers receive changes and presence but cannot send changes). Messages are
JSON, typed `ClientMessage` / `ServerMessage` in protocol.ts.

- The client loads the head version (`GET content`, noting `X-Version-Id`), then
  sends `hello` with it and the protocol it speaks (`proto`, `COLLAB_PROTOCOL`).
  The server answers `welcome` with the changes made since that version (to apply
  in order) and who is there, or `reload` if the client should fetch the content
  again. A client older than the server's protocol is closed with 4003
  "outdated" (it stops retrying; its page must be reloaded), as it would apply a
  change of several runs wrongly.
- A change is the runs of the record list it replaced (`core/splice.ts`): its
  first run, then `more`, each at the positions the runs before it left. An edit
  that adds a class at the top of the file and draws at its end goes as two
  small runs, not one span over the whole drawing. The client sends one change at
  a time (`op` with `base`, the last seq it applied) and waits for `ack`. The
  server rewrites a change made against an older seq past the ones since, run by
  run, or answers `reject` when a run of it touches the records of a run of one
  of them; the client then turns its change back. Every client applies the same
  changes in the same order, so all hold the same bytes.
- A change of the name table (type 55: the names of classes, symbols, textures
  and named objects) goes as a run of its own. When the only records a client's
  change shares with one ordered before it are the name table, the client makes
  its change again on top of the other and sends it anew (the server refuses the
  first as usual): the table is merged entry by entry, a name index both took
  moves to a fresh one for the later change (its records renumbered), a class
  both added under one name becomes the earlier one, and another name both used
  gets " (2)" (`features/collab/rebase.ts`). The server needs nothing for it.
- Changes are kept in the database until a version holds them: the server sends
  `save-request` to one editor every 60 changes or 2 minutes (a drawing over
  100 MB: 15 minutes, however many changes); the editor saves (`PUT content`
  with `X-Collab-Seq` and `X-Autosave`) and sends `saved`. It asks again after
  30 s (a big drawing: 10 minutes) if no version has come; an editor still saving
  takes no notice. While the owner's plan has no room for a version (a save was
  refused, or adding one of that size and taking it back says so), the server
  sends editors `save-blocked` with why, once, and asks for no save until there
  is room.
- Presence (cursor, selection, 2D view, 3D camera and pointer) is relayed as is.
- Crit comments created over REST are pushed to the room as `comment`.
- Project Sharing: an owner or editor sends `checkout` with layer ids to take
  layers for their editing alone (those someone else holds stay theirs), and
  `release` to give them back (their own, or anyone's for the owner). The
  server keeps them in `collab_checkouts`, past the holder's connection, and
  sends everyone the whole list as `checkouts` after each change (and in
  `welcome`). Taking a member off the drawing releases theirs; deleting the
  drawing releases all. The editors keep to the list: while someone else holds
  a layer, a change touching it (its objects or its own settings) is refused
  before it is made or sent, naming the holder. The server can't tell which
  layer a change touches, so a change made in the moment before a checkout
  reaches an editor still goes through. In the editor: File > Project
  Sharing… lists every layer with its holder (Check Out, Release, Check Out
  All Free, Release All Mine), and the Layers list marks held layers with a
  lock and offers Check Out and Release on a layer's right-click menu.

## Google Drive and OneDrive

Opening and saving drawings in the user's own Google Drive and OneDrive, from
File > Open from… and Save to…, and from the welcome screen. No openvwx account
is needed and the drawing never passes through the server: the browser talks to
the drive directly. A provider's buttons and menu rows appear only when the
server offers it (`drives` in `GET /api/config`), so leave a provider's
variables unset to hide it. The editor asks for `drive.file` (Google) and
`Files.ReadWrite` (OneDrive) only, which reach the files the person picks and
the ones the app creates (Google) or any file they can see (OneDrive).

### Google Drive

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project (or pick one). Its **project number** is the App ID.
2. APIs & Services > Library: enable the **Google Drive API** and the
   **Google Picker API**.
3. APIs & Services > OAuth consent screen: fill it in for the app.
4. APIs & Services > Credentials > Create credentials > **OAuth client ID**,
   application type **Web application**. Under **Authorised JavaScript
   origins** add `PUBLIC_URL` (for example `https://openvwx.app`), and
   `http://localhost:5173` while developing. No redirect URI is needed: the
   token comes from a Google sign-in window.
5. Create credentials > **API key**, restricted to the **Google Picker API**.
6. Set the variables (see Environment):
   - `DRIVE_GOOGLE_CLIENT_ID`: the OAuth client ID
   - `DRIVE_GOOGLE_API_KEY`: the API key
   - `DRIVE_GOOGLE_APP_ID`: the project number

Google's Save to… creates the new drawing in the person's My Drive.

### OneDrive (Microsoft Entra)

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), go to
   App registrations > New registration.
   - **Supported account types**: *Accounts in any organizational directory
     and personal Microsoft accounts*.
   - **Redirect URI**: platform **Single-page application (SPA)**, URI
     `PUBLIC_URL/` with the trailing slash. Add `http://localhost:5173/` too
     while developing.
2. API permissions > Add a permission > Microsoft Graph > **Delegated** >
   `Files.ReadWrite`. Grant admin consent only if an organisation's policy
   asks for it.
3. Overview: copy the **Application (client) ID**.
4. Set `DRIVE_MICROSOFT_CLIENT_ID` to it.

Sign-in opens a Microsoft window the first time (and when the token cannot be
renewed silently). Pop-ups must be allowed for the site.

### Environment

| Variable | Meaning |
| --- | --- |
| `DRIVE_GOOGLE_CLIENT_ID` | Google OAuth client ID (Web application) for Google Drive |
| `DRIVE_GOOGLE_API_KEY` | Google API key, restricted to the Picker API |
| `DRIVE_GOOGLE_APP_ID` | Google Cloud project number |
| `DRIVE_MICROSOFT_CLIENT_ID` | Entra application (client) ID for OneDrive |

The editor gets these from `GET /api/config` (`drives.google`,
`drives.microsoft`); the code is in `web/src/features/drives/`.
