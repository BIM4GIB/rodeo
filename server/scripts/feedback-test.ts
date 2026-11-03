// Tests for feedback with attachments (src/feedback.ts): node scripts/feedback-test.ts
// A real server on a loopback port with its own data folder. Reports are sent signed out, as most
// people send them; an admin signs in through an email link to read them, and a script reads
// them with REPORTS_TOKEN.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const MB = 1024 * 1024;
const data = mkdtempSync(join(tmpdir(), "rodeo-feedback-"));
let log = "";

const server: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(PORT),
    DATA_DIR: data,
    PUBLIC_URL: BASE,
    REPORTS_TOKEN: "test-token",
    ADMIN_EMAILS: "admin@example.com",
    MAX_UPLOAD_BYTES: String(100 * MB),
    FEEDBACK_FILES_MAX: String(150 * MB),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout?.on("data", (d: Buffer) => (log += d.toString()));
server.stderr?.on("data", (d: Buffer) => (log += d.toString()));

let cookie = "";

async function call(method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    body,
    headers: { "X-Requested-With": "openvwx", ...(cookie ? { Cookie: cookie } : {}), ...headers },
    redirect: "manual",
  });
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}\n${log}`);
}

function bytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) & 255;
  return out;
}

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** A tiny JPEG's first bytes, then filler: the server checks only the start. */
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...bytes(2000, 3)]);

interface Sent {
  id: string;
  token: string | null;
  fileRefused: string | null;
}

async function sendReport(body: Record<string, unknown>, ip: string): Promise<Sent> {
  const res = await call("POST", "/api/feedback", JSON.stringify({ kind: "bug", message: "The walls are missing", email: null, context: null, website: "", ...body }), {
    "Content-Type": "application/json",
    "X-Forwarded-For": ip,
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as Sent;
}

try {
  await until(() => log.includes("listening"), "the server");

  // ---- a report with diagnostics, a screenshot and a file in parts, signed out ------------
  const file = bytes(20 * MB + 12345, 7);
  const sent = await sendReport(
    {
      context: { browser: "Chrome 140", file: "DWG, 20 MB, came in", nonsense: "dropped" },
      diagnostics: { env: { gpu: "Apple M3", "bad key!": 1, heapMb: 120 }, workspace: { objects: 4 }, trail: ["+1.0s toast (info): Imported 4 objects", 5] },
      attach: { screenshot: true, file: { name: "../site/plan.dwg", size: file.length } },
    },
    "10.0.0.1",
  );
  assert.ok(sent.id && sent.token, "the answer carries the report's id and a token for its attachments");
  assert.equal(sent.fileRefused, null);
  const auth = { "X-Feedback-Token": sent.token! };

  assert.equal((await call("PUT", `/api/feedback/${sent.id}/screenshot`, jpeg, { "X-Feedback-Token": "wrong" })).status, 404, "a wrong token is refused");
  assert.equal((await call("PUT", `/api/feedback/${sent.id}/screenshot`, bytes(100, 1), auth)).status, 400, "only a JPEG or PNG is taken");
  assert.equal((await call("PUT", `/api/feedback/${sent.id}/screenshot`, jpeg, auth)).status, 200);
  assert.equal((await call("PUT", `/api/feedback/${sent.id}/screenshot`, jpeg, auth)).status, 409, "one screenshot");

  const PART = 8 * MB;
  assert.equal((await call("PUT", `/api/feedback/${sent.id}/file?offset=${PART}`, file.subarray(0, PART), auth)).status, 409, "parts come in order");
  for (let at = 0; at < file.length; at += PART) {
    const res = await call("PUT", `/api/feedback/${sent.id}/file?offset=${at}`, file.subarray(at, at + PART), auth);
    assert.equal(res.status, 200, await res.clone().text());
    const { size } = (await res.json()) as { size: number };
    assert.equal(size, Math.min(at + PART, file.length));
  }
  assert.equal((await call("GET", `/api/feedback/${sent.id}/file`, undefined, auth)).status, 404, "a whole file takes no more parts");

  // ---- read as a script (REPORTS_TOKEN) ----------------------------------------------------
  const script = { Authorization: "Bearer test-token" };
  assert.equal((await call("GET", "/api/admin/feedback")).status, 401, "signed out, no token: refused");
  const list = (await (await call("GET", "/api/admin/feedback", undefined, script)).json()) as { feedback: Record<string, unknown>[] };
  const got = list.feedback.find((f) => f.id === sent.id)!;
  assert.equal(got.screenshot, true);
  assert.deepEqual(got.file, { name: "..-site-plan.dwg", size: file.length, received: file.length }, "the name loses its folders");
  assert.deepEqual(got.context, { browser: "Chrome 140", file: "DWG, 20 MB, came in" });
  assert.deepEqual(got.diagnostics, { env: { gpu: "Apple M3", heapMb: 120 }, workspace: { objects: 4 }, trail: ["+1.0s toast (info): Imported 4 objects"] });

  const shot = await call("GET", `/api/admin/feedback/${sent.id}/screenshot`, undefined, script);
  assert.equal(shot.headers.get("content-type"), "image/jpeg");
  assert.equal(sha(new Uint8Array(await shot.arrayBuffer())), sha(jpeg));
  const down = await call("GET", `/api/admin/feedback/${sent.id}/file`, undefined, script);
  assert.equal(down.status, 200);
  assert.match(down.headers.get("content-disposition") ?? "", /attachment; filename="\.\.-site-plan\.dwg"/);
  assert.equal(sha(new Uint8Array(await down.arrayBuffer())), sha(file), "the file comes back as it was sent");

  // ---- a file larger than a report can bring, and one past the room left ----------------
  const big = await sendReport({ attach: { screenshot: false, file: { name: "huge.vwx", size: 101 * MB } } }, "10.0.0.2");
  assert.match(big.fileRefused ?? "", /larger than/);
  assert.equal(big.token, null, "nothing to attach, no token");
  const roomy = await sendReport({ attach: { screenshot: false, file: { name: "a.vwx", size: 90 * MB } } }, "10.0.0.3");
  assert.equal(roomy.fileRefused, null);
  const full = await sendReport({ attach: { screenshot: false, file: { name: "b.vwx", size: 50 * MB } } }, "10.0.0.4");
  assert.match(full.fileRefused ?? "", /more files/, "files kept and on their way count against FEEDBACK_FILES_MAX");

  // ---- a file that stops part way shows how much arrived; deleting drops it ----------------
  const part = bytes(MB, 9);
  assert.equal((await call("PUT", `/api/feedback/${roomy.id}/file?offset=0`, part, { "X-Feedback-Token": roomy.token! })).status, 200);
  const later = (await (await call("GET", "/api/admin/feedback", undefined, script)).json()) as { feedback: { id: string; file: unknown }[] };
  assert.deepEqual(later.feedback.find((f) => f.id === roomy.id)!.file, { name: "a.vwx", size: 90 * MB, received: MB });
  assert.equal((await call("GET", `/api/admin/feedback/${roomy.id}/file`, undefined, script)).status, 404, "half a file isn't offered");
  assert.ok(readdirSync(join(data, "tmp")).includes(`feedback-${roomy.id}`));
  assert.equal((await call("DELETE", `/api/admin/feedback/${roomy.id}`, undefined, script)).status, 200);
  assert.ok(!readdirSync(join(data, "tmp")).includes(`feedback-${roomy.id}`), "its part is gone");
  assert.equal((await call("PUT", `/api/feedback/${roomy.id}/file?offset=${MB}`, part, { "X-Feedback-Token": roomy.token! })).status, 404);

  // deleting a whole report removes its blobs
  const blobsBefore = readdirSync(join(data, "blobs"), { recursive: true }).length;
  assert.equal((await call("DELETE", `/api/admin/feedback/${sent.id}`, undefined, script)).status, 200);
  assert.ok(readdirSync(join(data, "blobs"), { recursive: true }).length < blobsBefore, "the screenshot and file are deleted with it");

  // ---- an admin signed in reads them too ---------------------------------------------------
  assert.equal((await call("POST", "/api/auth/email", JSON.stringify({ email: "admin@example.com" }), { "Content-Type": "application/json" })).status, 200);
  await until(() => /callback\?token=\w+/.test(log), "the sign-in link");
  const link = /(\/api\/auth\/email\/callback\?token=[\w-]+)/.exec(log)![1];
  cookie = ((await call("GET", link)).headers.get("set-cookie") ?? "").split(";")[0];
  assert.equal((await call("GET", "/api/admin/feedback")).status, 200);

  // ---- a report with no attachments is as before ---------------------------------------------
  const plain = await sendReport({}, "10.0.0.5");
  assert.equal(plain.token, null);

  console.log("feedback tests passed");
} finally {
  server.kill();
  rmSync(data, { recursive: true, force: true });
}
