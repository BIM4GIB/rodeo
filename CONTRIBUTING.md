# Contributing to Rodeo

Thanks for helping. Rodeo is a free CAD editor built in the open, and
contributions of any size are welcome: a bug report, a clearer paragraph in
the guide, a fix, a new import format. You don't need to ask before starting
on something small.

## The short version

1. **Pick something.** A bug you've hit, an issue labelled
   [good first issue](https://github.com/rodeobuild/rodeo/labels/good%20first%20issue)
   or [help wanted](https://github.com/rodeobuild/rodeo/labels/help%20wanted),
   or a feature still open in [PARITY.md](PARITY.md). For anything large,
   open an issue first so we can agree on the approach before you spend time
   on it.
2. **Fork and branch.** Fork the repository, make a branch, and run the
   editor locally ([Getting started](#getting-started) below).
3. **Make one change.** One fix or feature per pull request, small enough to
   read in one sitting.
4. **Check it.** `cd web && npm run build` passes, and so do the checks for
   the code you touched ([Checks](#checks)).
5. **Open a pull request.** Say what it changes and how you tested it. The
   template asks for both.

Be kind and assume good faith, in issues, reviews and pull requests alike.

## How pull requests are reviewed

Every pull request gets a review from Claude, an AI model, soon after it's
opened. It reads the whole change and looks for:

- bugs, and things that worked before and now don't
- changes the description doesn't mention
- a build that fails, or code with no check where one is needed
- drawings or text from drawings you don't own
  ([see below](#drawings-you-dont-own)), secrets, or tracking
- new dependencies without a reason, or with a licence the AGPL can't take
- code that doesn't read like the code around it

Fix what it finds and push again, or reply to the comment if you think it's
wrong. It can be. A maintainer then reads the pull request and merges it,
asks for changes, or closes it with a reason. The AI review never merges
anything on its own.

You're welcome to use AI tools to write your change. You're responsible for
it all the same: read it, run it, and be ready to explain any line of it.

## Good first contributions

- **Bug reports.** A file that opens wrong, a tool that misbehaves. Say what
  you did, what you expected and what happened instead.
- **The user guide.** Pages in [docs/guide/](docs/guide/README.md) that are
  unclear, missing a command, or out of date.
- **Missing features.** [PARITY.md](PARITY.md) lists every Vectorworks
  feature and whether Rodeo has it yet.
- **Format findings.** Something you've learned about the `.vwx` format goes
  in [FORMAT.md](FORMAT.md), with how sure you are.

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
- The [user guide](docs/guide/README.md) describes what the editor does, for
  people using it, one page per area. When behaviour changes, update the
  section for that command or tool, or add one where it belongs, following
  the page's format: a `###` per command, menu paths in bold as
  **File › Import › Import DXF…**, shortcuts as `<kbd>⇧⌘J</kbd>`, short
  paragraphs, and what it can't do yet under **Limits:**. Don't add user
  documentation to the README.
- A change people will notice also gets an entry in
  `web/src/features/news/releases.ts`, which feeds What's New.

## Style

- Match the code around you: its naming, its comment density, its idioms.
  TypeScript is strict, and the editor's format code (`web/src/core/`) runs
  under Node as well as in the browser, so keep the DOM out of it.
- New runtime dependencies need a reason, and a licence compatible with the
  AGPL (MIT, BSD, ISC, Apache-2.0, MPL-2.0 and the like). Ship any licence
  text the dependency asks for in `web/public/licences/`.

## Licence

Rodeo is licensed under the [GNU Affero General Public License v3.0](LICENSE).
By opening a pull request you agree that your contribution is licensed under
the same terms.
