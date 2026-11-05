// Tests for branches, merge requests and their merges (src/lineage.ts, src/merges.ts): node scripts/branches-test.ts
// A real server on a loopback port with its own data folder, three people signed in through email
// links, and the branch and merge calls made as each of them. Drawings are any bytes: the server
// never reads them. Takes a few seconds.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "rodeo-branches-"));
let log = "";

const server: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: { ...process.env, NODE_ENV: "development", PORT: String(PORT), DATA_DIR: data, PUBLIC_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout?.on("data", (d: Buffer) => (log += d.toString()));
server.stderr?.on("data", (d: Buffer) => (log += d.toString()));

/** A signed-in person: the session cookie that makes their calls. */
interface Who {
  readonly cookie: string;
  readonly email: string;
}

interface Info {
  readonly fileId: string;
  readonly name: string;
  readonly main: boolean;
  readonly headVersionId: string;
  readonly createdBy: { readonly id: string; readonly name: string } | null;
}

interface Req {
  readonly id: string;
  readonly state: string;
  readonly author: { readonly name: string } | null;
  readonly mergedBy: { readonly name: string } | null;
  readonly approvals: readonly { readonly user: { readonly name: string }; readonly current: boolean }[];
  readonly sourceHeadVersionId: string;
  readonly targetHeadVersionId: string;
  readonly mergedVersionId: string | null;
}

interface Ver {
  readonly id: string;
  readonly label: string | null;
}

interface FileOut {
  readonly id: string;
  readonly name: string;
}

const JSON_TYPE = { "Content-Type": "application/json" };
const STREAM_TYPE = { "Content-Type": "application/octet-stream" };

function call(as: Pick<Who, "cookie"> | null, method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    body,
    headers: { "X-Requested-With": "openvwx", ...(as ? { Cookie: as.cookie } : {}), ...headers },
    redirect: "manual",
  });
}

async function until(check: () => boolean, what: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}\n${log}`);
}

/** The sign-in links the server mailed (in dev it writes them to its log). */
function links(): string[] {
  return [...log.matchAll(/callback\?token=([\w-]+)/g)].map((m) => m[1]);
}

/** Signs in by email link and keeps the session cookie. */
async function signIn(email: string): Promise<Who> {
  const seen = links().length;
  await call(null, "POST", "/api/auth/email", JSON.stringify({ email }), JSON_TYPE);
  await until(() => links().length > seen, `the sign-in link for ${email}`);
  const res = await fetch(`${BASE}/api/auth/email/callback?token=${links().at(-1)}`, { redirect: "manual" });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, /^ovx_session=/);
  return { cookie, email };
}

/** The answer of a call that must succeed with `status` (no body for a 204). */
async function expect<T = unknown>(status: number, res: Response): Promise<T> {
  assert.equal(res.status, status, `${res.url}: ${await res.clone().text()}`);
  return (status === 204 ? undefined : await res.json()) as T;
}

/** A call that must be refused with `status` (and `code`, when given): returns its message. */
async function refused(res: Response, status: number, code?: string): Promise<string> {
  assert.equal(res.status, status, `${res.url}: ${await res.clone().text()}`);
  const body = (await res.json()) as { error: string; code?: string };
  if (code) assert.equal(body.code, code, body.error);
  return body.error;
}

const blob = (n: number, fill: number): Blob => new Blob([new Uint8Array(n).fill(fill)]);
const bytes = (n: number, fill: number): Buffer => Buffer.alloc(n, fill);

async function bodyOf(as: Who, path: string): Promise<Buffer> {
  const res = await call(as, "GET", path);
  assert.equal(res.status, 200, await res.clone().text());
  return Buffer.from(await res.arrayBuffer());
}

try {
  await until(() => log.includes("listening"), "the server");
  const ann = await signIn("ann@example.com");
  const ben = await signIn("ben@example.com");
  const cat = await signIn("cat@example.com");

  // Ann's drawing, with Ben and Cat as editors
  const created = await expect<{ file: FileOut }>(201, await call(ann, "POST", "/api/files", blob(3000, 7), { ...STREAM_TYPE, "X-File-Name": "House.vwx" }));
  const main = created.file.id;
  for (const who of [ben, cat]) {
    const invite = await expect<{ invite: { token: string } }>(201, await call(ann, "POST", `/api/files/${main}/invites`, JSON.stringify({ role: "editor" }), JSON_TYPE));
    await expect(200, await call(who, "POST", `/api/invites/${invite.invite.token}/accept`));
  }

  // Ben starts a branch: it is not in the drawing list, but it is in the family
  const started = await expect<{ branch: Info; file: FileOut }>(201, await call(ben, "POST", `/api/files/${main}/branches`, JSON.stringify({ name: "Option A" }), JSON_TYPE));
  const branch = started.branch.fileId;
  assert.equal(started.branch.main, false);
  assert.equal(started.branch.createdBy?.name, "ben");
  assert.equal(started.file.name, "House · Option A.vwx");
  const listed = await expect<{ files: FileOut[] }>(200, await call(ann, "GET", "/api/files"));
  assert.deepEqual(
    listed.files.map((f) => f.id),
    [main],
    "a branch is not listed as a drawing",
  );
  const family = await expect<{ family: { role: string; main: Info; branches: Info[] } }>(200, await call(ben, "GET", `/api/files/${main}/family`));
  assert.equal(family.family.role, "editor");
  assert.equal(family.family.main.main, true);
  assert.equal(family.family.branches.length, 1);
  assert.equal(family.family.branches[0].createdBy?.name, "ben");

  // a rename moves the branch's file name too; names that can't be used are refused
  const renamed = await expect<{ branch: Info }>(200, await call(ben, "PATCH", `/api/branches/${branch}`, JSON.stringify({ name: "Option B" }), JSON_TYPE));
  assert.equal(renamed.branch.name, "Option B");
  assert.equal((await expect<{ file: FileOut }>(200, await call(ben, "GET", `/api/files/${branch}`))).file.name, "House · Option B.vwx");
  await refused(await call(ben, "POST", `/api/files/${main}/branches`, JSON.stringify({ name: "option b" }), JSON_TYPE), 409, "conflict");
  assert.equal(
    await refused(await call(ben, "POST", `/api/files/${main}/branches`, JSON.stringify({ name: "MAIN" }), JSON_TYPE), 400),
    "Main is the name of the drawing itself. Pick another name.",
  );
  assert.equal(await refused(await call(ben, "POST", `/api/files/${main}/branches`, JSON.stringify({ name: "   " }), JSON_TYPE), 400), "Enter a branch name");

  // a branch's bytes and its base are Main's bytes until either side changes
  assert.deepEqual(await bodyOf(ben, `/api/files/${branch}/content`), bytes(3000, 7));
  assert.deepEqual(await bodyOf(ben, `/api/branches/${branch}/base`), bytes(3000, 7));
  await refused(await call(ben, "GET", `/api/branches/${main}/base`), 404);

  // both sides change
  const mainV1 = (await expect<{ version: Ver }>(200, await call(ann, "PUT", `/api/files/${main}/content`, blob(3200, 8)))).version.id;
  const branchV1 = (await expect<{ version: Ver }>(200, await call(ben, "PUT", `/api/files/${branch}/content`, blob(3100, 5)))).version.id;

  // Ben asks to merge; Ben cannot approve his own request, and a closed request can't be approved
  const asked = await expect<{ request: Req }>(201, await call(ben, "POST", `/api/branches/${branch}/merge-requests`, JSON.stringify({ title: "Bigger kitchen", body: "Opens the kitchen to the garden." }), JSON_TYPE));
  const mid = asked.request.id;
  assert.equal(asked.request.state, "open");
  assert.equal(asked.request.author?.name, "ben");
  assert.equal(asked.request.sourceHeadVersionId, branchV1);
  assert.equal(asked.request.targetHeadVersionId, mainV1);
  await refused(await call(ben, "POST", `/api/branches/${branch}/merge-requests`, JSON.stringify({ title: "Again" }), JSON_TYPE), 409, "conflict");
  await refused(await call(ben, "POST", `/api/merge-requests/${mid}/approval`), 403);
  const closed = await expect<{ request: Req }>(200, await call(ben, "PATCH", `/api/merge-requests/${mid}`, JSON.stringify({ state: "closed" }), JSON_TYPE));
  assert.equal(closed.request.state, "closed");
  await refused(await call(ann, "POST", `/api/merge-requests/${mid}/approval`), 409, "conflict");
  await expect(200, await call(ben, "PATCH", `/api/merge-requests/${mid}`, JSON.stringify({ state: "open" }), JSON_TYPE));
  const listing = await expect<{ requests: Req[] }>(200, await call(ann, "GET", `/api/files/${main}/merge-requests`));
  assert.deepEqual(listing.requests.map((r) => r.id), [mid]);

  // Ann approves the branch as it is
  const approved = await expect<{ request: Req }>(200, await call(ann, "POST", `/api/merge-requests/${mid}/approval`));
  assert.equal(approved.request.approvals.length, 1);
  assert.equal(approved.request.approvals[0].user.name, "ann");
  assert.equal(approved.request.approvals[0].current, true);

  // a merge on heads that have moved is refused before any bytes are kept; the right heads merge
  await refused(await call(ann, "POST", `/api/merge-requests/${mid}/merge`, blob(3300, 4), { ...STREAM_TYPE, "X-Into-Version": "nope", "X-From-Version": branchV1 }), 409, "moved");
  const merged = await expect<{ request: Req; version: Ver }>(200, await call(ann, "POST", `/api/merge-requests/${mid}/merge`, blob(3300, 4), { ...STREAM_TYPE, "X-Into-Version": mainV1, "X-From-Version": branchV1 }));
  assert.equal(merged.request.state, "merged");
  assert.equal(merged.request.mergedBy?.name, "ann");
  assert.equal(merged.request.mergedVersionId, merged.version.id);
  assert.equal(merged.version.label, "Merged Option B");
  assert.deepEqual(await bodyOf(ann, `/api/files/${main}/content`), bytes(3300, 4));
  assert.deepEqual(await bodyOf(ben, `/api/branches/${branch}/base`), bytes(3100, 5));
  await refused(await call(ann, "POST", `/api/merge-requests/${mid}/merge`, blob(3300, 4), { ...STREAM_TYPE, "X-Into-Version": merged.version.id, "X-From-Version": branchV1 }), 409, "conflict");
  await refused(await call(ben, "PATCH", `/api/merge-requests/${mid}`, JSON.stringify({ title: "Changed" }), JSON_TYPE), 409, "conflict");

  // Main moved on: Ben brings his branch up to date with it
  const mainHead = merged.version.id;
  assert.equal(await refused(await call(ben, "POST", `/api/branches/${branch}/update`, blob(3400, 6), { ...STREAM_TYPE, "X-Into-Version": branchV1 }), 400), "X-Into-Version and X-From-Version are needed");
  await refused(await call(ben, "POST", `/api/branches/${branch}/update`, blob(3400, 6), { ...STREAM_TYPE, "X-Into-Version": branchV1, "X-From-Version": mainV1 }), 409, "moved");
  const updated = await expect<{ version: Ver }>(200, await call(ben, "POST", `/api/branches/${branch}/update`, blob(3400, 6), { ...STREAM_TYPE, "X-Into-Version": branchV1, "X-From-Version": mainHead }));
  assert.equal(updated.version.label, "Updated from Main");
  assert.deepEqual(await bodyOf(ben, `/api/files/${branch}/content`), bytes(3400, 6));
  assert.deepEqual(await bodyOf(ben, `/api/branches/${branch}/base`), bytes(3300, 4));

  // twenty branches at most; Cat, who did not make a branch, can't delete it; Ben can delete his own
  const tries: string[] = [];
  for (let i = 2; i <= 20; i++) {
    tries.push((await expect<{ branch: Info }>(201, await call(ben, "POST", `/api/files/${main}/branches`, JSON.stringify({ name: `Try ${i}` }), JSON_TYPE))).branch.fileId);
  }
  await refused(await call(ben, "POST", `/api/files/${main}/branches`, JSON.stringify({ name: "Too many" }), JSON_TYPE), 409, "limit");
  await refused(await call(cat, "DELETE", `/api/branches/${tries[0]}`), 403, "forbidden");
  await expect(204, await call(ben, "DELETE", `/api/branches/${tries[0]}`));
  await expect(201, await call(ben, "POST", `/api/files/${main}/branches`, JSON.stringify({ name: "Try 21" }), JSON_TYPE));

  // Ann takes Ben off Main: he loses the branches with it, and the branches keep Main's members
  const mainMembers = await expect<{ members: { email: string; userId: string }[] }>(200, await call(ann, "GET", `/api/files/${main}/members`));
  const benId = mainMembers.members.find((m) => m.email === ben.email)?.userId;
  assert.ok(benId, "Ben is a member of Main");
  await expect(204, await call(ann, "DELETE", `/api/files/${main}/members/${benId}`));
  await refused(await call(ben, "GET", `/api/files/${branch}/content`), 404);
  await refused(await call(ben, "GET", `/api/files/${main}/family`), 404);
  const branchMembers = await expect<{ members: { email: string }[] }>(200, await call(ann, "GET", `/api/files/${branch}/members`));
  const emails = (list: { email: string }[]): string[] => list.map((m) => m.email);
  assert.deepEqual(emails(branchMembers.members), emails(mainMembers.members.filter((m) => m.userId !== benId)));

  // Ann deletes the drawing: its branches go with it, and no stored bytes are left behind
  await expect(204, await call(ann, "DELETE", `/api/files/${main}`));
  await refused(await call(ann, "GET", `/api/files/${main}/family`), 404);
  const left = readdirSync(join(data, "blobs"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  assert.equal(left.length, 0, `${left.length} stored file(s) are left behind`);

  console.log("branches test passed");
} finally {
  server.kill();
  rmSync(data, { recursive: true, force: true });
}
