# Running your own server

How to get from this repository to a running Rodeo with accounts, cloud
drawings and live collaboration. Each step is optional after the first: the
editor shows only what the server is configured for. Every variable is listed
in [PLATFORM.md](PLATFORM.md#environment).

`web/Dockerfile` builds the editor alone, as a static site. Without a server
behind it, `/api/config` answers 404 and the account features stay hidden.

## 1. The server

1. Build `server/Dockerfile` with the repository root as its context
   (`docker build -f server/Dockerfile .`). On Coolify: new resource → this
   repository → build pack **Dockerfile**, base directory `/`, Dockerfile
   location `/server/Dockerfile`. It serves on port **8080**.
2. Persistent storage: a volume mounted at **`/data`**. It holds the database
   and every uploaded drawing, so back it up.
3. Environment:
   - `PUBLIC_URL=https://your-domain` (no trailing slash)
   - `ADMIN_EMAILS=you@…`: these accounts get the admin panel at `/admin`
     (Help > Admin Panel… in the editor): analytics, accounts, bug reports,
     error reports, the gallery's moderation queue, announcements, the
     funding bar and the sponsor. With email set up (step 2), each report is
     also emailed to these addresses.
4. Point the domain at it. On Cloudflare, proxying (orange cloud) is fine:
   WebSockets pass through by default. Add a cache rule that **bypasses cache
   for `/api/*`**.
5. Check that it serves the editor and that `/api/health` returns
   `{"ok":true}`.

**Sign-in needs step 2 or 3.** In production, email
sign-in is offered only once SMTP is set, and OAuth only for providers with
keys. Until then the editor works fully without an account, and the Sign in
dialog says no sign-in methods are set up. (On a development server, without
`NODE_ENV=production`, sign-in links go to the log instead.)

## 2. Email sign-in (SMTP)

Any SMTP provider works. Resend, Postmark, Brevo and Amazon SES all have free
or cheap tiers.

- `SMTP_URL=smtp://USER:PASSWORD@smtp.provider.com:587`
- `MAIL_FROM="openvwx <hello@your-domain>"`
- Verify the sending domain with the provider (SPF and DKIM DNS records in
  Cloudflare). Otherwise sign-in links land in spam.

**Cloudflare Email Sending** (beta) works with no code changes:

1. Requirements: the Workers Paid plan. It includes 3,000 emails a month, then
   $0.35 per 1,000.
2. Onboard the sending domain (Email Service → Email Sending). Cloudflare adds
   the DNS records itself.
3. Create an API token with **Email Sending: Edit**.
4. Set `SMTP_URL=smtps://api_token:TOKEN@smtp.mx.cloudflare.net:465`. The
   username is the literal word `api_token`. Only port 465 with implicit TLS is
   supported.
5. Set `MAIL_FROM` to an address on the onboarded domain.

Behind Cloudflare, also set `CLIENT_IP_HEADER=cf-connecting-ip`, so the
sign-in rate limits (5 links an hour per address, 20 per visitor) count real
visitors, not Cloudflare's edge servers.

Also on Cloudflare, turn on Rules › Settings › Managed Transforms › Add visitor
location headers, so the admin panel's globes show each visitor's city (rounded
to about 10 km) rather than their country's middle.

## 3. Sign in with Google, Microsoft, GitHub (optional)

Each provider needs a redirect URI of the form
`PUBLIC_URL/api/auth/oauth/<provider>/callback`.

- **Google:** Google Cloud Console → APIs & Services → Credentials → OAuth
  client ID (Web application). The consent screen needs only email and
  profile. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- **Microsoft:** Microsoft Entra admin center → App registrations → New.
  - Supported account types: any organizational directory and personal
    Microsoft accounts. This lets students sign in with university accounts.
  - Add a Web redirect URI, then create a client secret under Certificates &
    secrets.
  - Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.
- **GitHub:** Settings → Developer settings → OAuth Apps. Set
  `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

## 4. Rodeo Plus (Stripe)

1. Stripe dashboard → Product catalogue → add "Rodeo Plus" with two
   recurring prices, for example £2/month and £15/year. Copy the price ids
   (`price_…`) into `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`.
2. Developers → API keys → set `STRIPE_SECRET_KEY`. Use a restricted key with
   Checkout, Customer portal and Subscriptions write access if you prefer.
3. Developers → Webhooks → add endpoint `PUBLIC_URL/api/billing/webhook` with
   these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded` (AI credit paid by a slower method)
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Settings → Billing → Customer portal: turn on cancel and switch plans.
5. If the prices aren't £2/£15, set `SUPPORTER_MONTHLY_LABEL` and
   `SUPPORTER_YEARLY_LABEL` so the editor shows the right amounts.

Test the flow first with test-mode keys and card `4242 4242 4242 4242`.

### AI credit (the Agents panel)

With `OPENROUTER_API_KEY` set, the agents are paid for with credit each user tops up (`AI_TOPUPS`,
default £5, £10 and £20). Top-ups need no product in Stripe: each is a one-off Checkout payment
the server prices itself, and the same webhook credits it once it's paid. Every agent step then
takes what OpenRouter says it cost, turned into pounds (`AI_USD_RATE`) with the markup
(`AI_MARKUP`, `AI_MARKUP_PLUS`), and the panel shows the charge and the balance as it runs.

- Buy OpenRouter credit ahead of what users have bought, and turn on its auto top-up: users'
  credit is a promise to pay OpenRouter.
- To try it before Stripe is set up, set `ADMIN_EMAILS` and grant yourself credit on the admin
  page, /admin > People (or `POST /api/admin/ai-credit {"email": "…", "amount": 5}`,
  signed in as that admin, with the `X-Requested-With: openvwx` header).
- Refunds are by hand: refund in Stripe, then take the credit back with a negative grant.

### Cloud renders (Render Image on a GPU)

Render Image can make Photoreal pictures on a GPU at [Modal](https://modal.com), paid from the
same credit as the agents (about 3.7p a minute on an L40S at the default markup; a 4K picture
at 1024 samples takes about a minute, against three on an M3 Max).

1. A Modal account with a card on file (it won't run GPUs without one), and the CLI:
   `uv tool install modal`, then `modal token new`.
2. The secret the worker checks: `modal secret create rodeo-render RENDER_SECRET=<a long random string>`.
3. Deploy the worker: `cd web && npm run build && cd .. && modal deploy cloudrender/worker.py`.
   It prints the endpoint, `https://<workspace>--rodeo-render-api.<region>.modal.run`.
4. In the server's environment: `RENDER_URL` (that endpoint) and `RENDER_SECRET` (the same
   string), then redeploy. Render Image then offers "Render on: Cloud GPU".

Deploy the worker again whenever the render code changes: it runs the `web/dist` it was
deployed with. Users need credit to render, so Stripe (above) or an admin grant comes first.

## 5. Donations and the ad slot

Donations are kept quiet: a Donate link in the start hub's footer opens a small
Support dialog with the month's goal bar and the links. Nothing else asks for money.

- Donation link: in Stripe, make a Payment Link for a "Donation to Rodeo" product
  with a customer-chosen price (Products > Add product > "Customer chooses price"),
  call it a donation (`submit_type=donate`) and give it the metadata `kind=donation`.
  Then `FUNDING_LINKS="Donate|https://buy.stripe.com/…"`. Other links (Ko-fi,
  GitHub Sponsors) can follow, comma-separated; the first one is the main button.
- Donations through that link count themselves: the Stripe webhook (step 3) adds each
  paid one to the month's total, which starts again each calendar month (UTC).
- The monthly goal: `FUNDING_GOAL=200` and `FUNDING_CURRENCY=GBP`. Money given
  elsewhere goes in `FUNDING_RAISED` by hand. You can also edit these in the editor
  under Help > Funding and Sponsor Settings, which also covers the sponsor: name,
  logo, link and one line.
- The start hub has one ad, under Recent. A sponsor set as above takes it. With no
  sponsor, a Carbon Ads placement fills it: apply at carbonads.net/join, and once
  accepted set `CARBON_SERVE` and `CARBON_PLACEMENT` to the codes in Carbon's embed
  snippet (`carbon.js?serve=…&placement=…`). Carbon allows only its own ads on a site,
  so leave the sponsor empty while Carbon runs. Rodeo Plus members see no ad.

## 6. Google Drive and OneDrive (optional)

These open and save straight from the person's own drive. Drawings never pass
through your server.

- **Google:** in the same Cloud project as step 3:
  - Enable the Google Drive API and Google Picker API.
  - Create an API key restricted to your domain and to those two APIs.
  - Create a Web OAuth client with your domain as an authorised JavaScript
    origin.
  - The App ID is the project number.
  - Set `DRIVE_GOOGLE_CLIENT_ID`, `DRIVE_GOOGLE_API_KEY` and
    `DRIVE_GOOGLE_APP_ID`.
  - Scope `drive.file` only: openvwx sees just the files the person picks.
- **OneDrive:** a second Entra app registration:
  - Platform **Single-page application**, redirect URI `PUBLIC_URL/`.
  - API permission `Files.ReadWrite`, delegated.
  - Set `DRIVE_MICROSOFT_CLIENT_ID`.

## 7. Check it

- [ ] `/api/health` is ok, and `/api/config` lists what you configured
- [ ] Sign in by email; the link arrives
- [ ] File > Save to Cloud, reload, File > Open from Cloud
- [ ] Share… → invite link → open it in a private window as a second account,
      and edit together (cursors, edits both ways)
- [ ] A public share link and an embed open view only
- [ ] Rodeo Plus checkout in Stripe test mode turns the account into a Plus account
- [ ] An AI credit top-up in test mode adds to the balance (Account…), and an agent
      message takes from it
- [ ] Help > Report a Bug… sends a report that shows on the admin panel's Feedback tab
      (and arrives by email at `ADMIN_EMAILS`)
- [ ] Back up `/data` (Coolify's scheduled backups for the volume, or a cron
      with `sqlite3 .backup` + the `blobs/` folder)
