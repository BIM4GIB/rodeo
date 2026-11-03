# openvwx server

Accounts, cloud drawings with version history, sharing, crit comments, Rodeo Plus
(the paid plan), funding settings, and hosting of the editor. The editor in `../web` works without
it. Every endpoint and environment variable is listed in `../docs/PLATFORM.md`; the
types the two sides share are in `../web/src/platform/protocol.ts`.

## Run locally

```bash
cd web && npm install && npm run build      # the editor, served from web/dist
cd ../server && npm install
DATA_DIR=./data PUBLIC_URL=http://localhost:8080 npm start
```

Node 22.18 or later runs the TypeScript directly. Without `SMTP_URL`, sign-in and
invite links are printed to the log.

## Layout

- `src/index.ts`: start-up; the database, the routes, and the live-collaboration socket
- `src/collab.ts`: the collaboration hub (`attachCollab`)
- `src/auth.ts`, `src/account.ts`: sessions, email and OAuth sign-in, the account
- `src/files.ts`, `src/sharing.ts`, `src/comments.ts`: drawings, invites and links, crit mode
- `src/billing.ts`, `src/settings.ts`: Stripe, `/api/config`, funding and sponsor
- `src/db.ts`: SQLite schema (node:sqlite), versioned with `PRAGMA user_version`
- `src/static.ts`: the built editor, with its caching rules

## Docker

From the repository root: `docker build -f server/Dockerfile .`. The image serves on
port 8080 with its data in the `/data` volume.
