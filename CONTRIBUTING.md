# Contributing to Rodeo

Thanks for helping. Bug reports, format findings, sample-free test cases and
pull requests are all welcome. For anything large, open an issue first so we
can agree on the approach before you spend time on it.

## Getting started

You need Node 22.18 or later. Python 3 is needed only for the Python tool in
`openvwx/`.

```bash
cd web
npm install
npm run dev        # the editor at http://localhost:5173
npm run build      # typecheck and bundle into web/dist
```

The editor runs without the server. To work on accounts, cloud drawings or
collaboration, run the server too (Vite proxies `/api` to it):

```bash
cd server
npm install
DATA_DIR=./data PUBLIC_URL=http://localhost:8080 npm start
```

Without `SMTP_URL`, sign-in links are printed to the server's log.
[docs/PLATFORM.md](docs/PLATFORM.md) lists every endpoint and variable.

## Checks

There is no single test runner. Checks sit next to the code they cover, and
each one says at its top how to run it.

- `cd web && npm run build` must pass: it typechecks the whole editor.
- Editor checks are `*.check.ts` files, run from `web/` with
  `npx tsx src/<path>.check.ts`. Some need a drawing: pass the path to a
  `.vwx` file, or put one at `samples/sample.vwx`.
- Server tests are `server/scripts/*-test.ts`, run from `server/` with
  `node scripts/<name>-test.ts`. Each starts a real server on a loopback port
  with its own data folder.
- Python: `python3 -m unittest discover -s tests` from the repository root.

Run the checks for the code you change, and add one when you fix a bug or
learn something new about a format.

## Drawings you don't own

Real drawings hold other people's work: client names, addresses, phone
numbers. **Never commit a drawing, or any name, text or bytes taken from one,
unless you made it yourself and are happy for it to be public.** `samples/`
and `*.vwx` are git-ignored for this reason. When a fix needs a file to show
the problem, describe the bytes in the issue, or build a small file yourself
(File > New makes one) and attach that.

## Where things are written down

- Format findings go in [FORMAT.md](FORMAT.md), with how sure we are
  (confirmed, likely, guess) and what confirmed it.
- Feature progress against Vectorworks goes in [PARITY.md](PARITY.md).
- The README's "Web editor" section describes what the editor does, for
  people using it. Update it when behaviour changes.
- A change people will notice also gets an entry in
  `web/src/features/news/releases.ts`, which feeds What's New.

## Style

- Match the code around you: its naming, its comment density, its idioms.
  TypeScript is strict, and the editor's format code (`web/src/core/`) runs
  under Node as well as in the browser, so keep the DOM out of it.
- Keep changes focused: one fix or feature per pull request.
- New runtime dependencies need a reason, and a licence compatible with the
  AGPL (MIT, BSD, ISC, Apache-2.0, MPL-2.0 and the like). Ship any licence
  text the dependency asks for in `web/public/licences/`.

## Licence

Rodeo is licensed under the [GNU Affero General Public License v3.0](LICENSE).
By opening a pull request you agree that your contribution is licensed under
the same terms.
