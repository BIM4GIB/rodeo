// Tests for error reports (src/reports.ts), uploads in parts (src/uploads.ts), autosaves
// (src/files.ts) and earlier builds' assets (src/static.ts): node scripts/reports-test.ts
// A real server on a loopback port with its own data folder, signed in through an email link.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const MB = 1024 * 1024;
const data = mkdtempSync(join(tmpdir(), "rodeo-reports-"));
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
    MAX_UPLOAD_BYTES: String(30 * MB),
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
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
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

try {
  await until(() => log.includes("listening"), "the server");

  // ---- sign in -------------------------------------------------------------------
  assert.equal((await call("POST", "/api/auth/email", JSON.stringify({ email: "admin@example.com" }), { "Content-Type": "application/json" })).status, 200);
  await until(() => /callback\?token=\w+/.test(log), "the sign-in link");
  const link = /(\/api\/auth\/email\/callback\?token=[\w-]+)/.exec(log)![1];
  const signedIn = await call("GET", link);
  cookie = (signedIn.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie, "a session cookie");

  // ---- error reports ---------------------------------------------------------------
  const report = (message: string): Promise<Response> =>
    fetch(`${BASE}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "openvwx" },
      body: JSON.stringify({
        kind: "failure",
        area: "render",
        message,
        details: { size: "3840×2160", samples: 256, nested: { no: 1 } },
        env: { build: "main-abc.js" },
        trail: ["+1.0s toast: Render failed"],
      }),
    });
  assert.equal((await report("A 3840 × 2160 px picture is larger than this browser can draw (8192 px a side)")).status, 201);
  assert.equal((await report("A 7680 × 4320 px picture is larger than this browser can draw (16384 px a side)")).status, 201);
  assert.equal((await report("Something else broke")).status, 201);
  const bad = await fetch(`${BASE}/api/reports`, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "openvwx" }, body: JSON.stringify({ kind: "server", area: "x", message: "y" }) });
  assert.equal(bad.status, 400, "the editor can't file server errors");

  const bearer = { Authorization: "Bearer test-token" };
  assert.equal((await fetch(`${BASE}/api/admin/reports`)).status, 401, "signed out, no token");
  assert.equal((await fetch(`${BASE}/api/admin/reports`, { headers: { Authorization: "Bearer wrong" } })).status, 401, "a wrong token");
  const { groups } = (await (await fetch(`${BASE}/api/admin/reports`, { headers: bearer })).json()) as { groups: { fingerprint: string; count: number; message: string; latest: { details: Record<string, unknown>; trail: string[] } }[] };
  assert.equal(groups.length, 2, "numbers aside, the two picture-size reports are one error");
  const sized = groups.find((g) => g.message.startsWith("A 3840"))!;
  assert.equal(sized.count, 2);
  assert.deepEqual(sized.latest.details, { size: "3840×2160", samples: 256 }, "only flat values are kept");
  assert.equal(sized.latest.trail[0], "+1.0s toast: Render failed");
  assert.match(log, /\[report \w+\] failure in render: A 7680/, "each report is a log line");

  const { reports } = (await (await fetch(`${BASE}/api/admin/reports?group=${sized.fingerprint}`, { headers: bearer })).json()) as { reports: unknown[] };
  assert.equal(reports.length, 2);
  const signedInList = await call("GET", "/api/admin/reports");
  assert.equal(signedInList.status, 200, "an admin signed in reads them too");
  assert.equal((await fetch(`${BASE}/api/admin/reports/${sized.fingerprint}`, { method: "DELETE", headers: { ...bearer, "X-Requested-With": "openvwx" } })).status, 200);
  const after = (await (await fetch(`${BASE}/api/admin/reports`, { headers: bearer })).json()) as { groups: unknown[] };
  assert.equal(after.groups.length, 1, "cleared");

  // ---- uploads in parts ------------------------------------------------------------
  const small = bytes(1000, 1);
  const created = await call("POST", "/api/files", new Blob([small as Uint8Array<ArrayBuffer>]), { "X-File-Name": "a.vwx", "Content-Type": "application/octet-stream" });
  assert.equal(created.status, 201, await created.clone().text());
  const fileId = ((await created.json()) as { file: { id: string } }).file.id;

  const big = bytes(20 * MB + 12345, 7);
  const started = await call("POST", "/api/uploads", undefined, { "X-Upload-Size": String(big.length) });
  assert.equal(started.status, 201);
  const uploadId = ((await started.json()) as { id: string }).id;
  const part = (from: number, to: number): Blob => new Blob([big.subarray(from, to) as Uint8Array<ArrayBuffer>]);

  assert.equal((await call("PUT", `/api/uploads/${uploadId}?offset=5`, part(5, 10))).status, 409, "a part must start where the last ended");
  assert.equal((await call("PUT", `/api/files/${fileId}/content`, undefined, { "X-Upload-Id": uploadId })).status, 400, "not whole yet");

  // a part cut off part way is dropped, so the upload stays where it was
  await fetch(`${BASE}/api/uploads/${uploadId}?offset=0`, {
    method: "PUT",
    headers: { "X-Requested-With": "openvwx", Cookie: cookie },
    body: new ReadableStream<Uint8Array>({
      start(ctl) {
        ctl.enqueue(big.subarray(0, MB));
        setTimeout(() => ctl.error(new Error("line dropped")), 200);
      },
    }),
    duplex: "half",
  } as RequestInit).catch(() => undefined);
  await until(async () => {
    const r = (await (await call("GET", `/api/uploads/${uploadId}`)).json()) as { size: number };
    return r.size === 0;
  }, "the cut-off part to be dropped");

  // the server lets go of the cut-off part when it sees the connection drop: the client's retry
  // (a 409 while it is still busy) then goes through
  const PART = 8 * MB;
  const waited = performance.now();
  for (let at = 0; at < big.length; at += PART) {
    let res = await call("PUT", `/api/uploads/${uploadId}?offset=${at}`, part(at, Math.min(big.length, at + PART)));
    while (res.status === 409 && performance.now() - waited < 10_000) {
      await new Promise((r) => setTimeout(r, 200));
      res = await call("PUT", `/api/uploads/${uploadId}?offset=${at}`, part(at, Math.min(big.length, at + PART)));
    }
    assert.equal(res.status, 200, await res.clone().text());
  }
  console.log(`the cut-off part was let go of within ${Math.round(performance.now() - waited)} ms`);
  const saved = await call("PUT", `/api/files/${fileId}/content`, undefined, { "X-Upload-Id": uploadId });
  assert.equal(saved.status, 200, await saved.clone().text());
  const content = new Uint8Array(await (await call("GET", `/api/files/${fileId}/content`)).arrayBuffer());
  assert.equal(content.length, big.length);
  assert.equal(sha(content), sha(big), "the parts make the drawing");
  assert.equal((await call("PUT", `/api/files/${fileId}/content`, undefined, { "X-Upload-Id": uploadId })).status, 404, "an upload is used once");

  const tooBig = await call("POST", "/api/uploads", undefined, { "X-Upload-Size": String(31 * MB) });
  assert.equal(tooBig.status, 413, "larger than MAX_UPLOAD_BYTES is refused up front");
  assert.equal(((await tooBig.json()) as { code: string }).code, "too_large");

  const cfg = (await (await fetch(`${BASE}/api/config`)).json()) as { maxUploadBytes: number };
  assert.equal(cfg.maxUploadBytes, 30 * MB);

  // ---- autosaves -------------------------------------------------------------------------
  interface Ver {
    id: string;
    label: string | null;
    autosave: boolean;
  }
  // checked against the head by its base, by a live session's seq ("seq"), or not at all
  const save = async (seed: number, autosave?: string, checked: boolean | "seq" = true): Promise<Ver> => {
    const base = ((await (await call("GET", `/api/files/${fileId}`)).json()) as { file: { headVersionId: string } }).file.headVersionId;
    const check = checked === "seq" ? { "X-Collab-Seq": "0" } : checked ? { "X-Base-Version": base } : {};
    const headers = { ...(autosave ? { "X-Autosave": autosave } : {}), ...check };
    const res = await call("PUT", `/api/files/${fileId}/content`, new Blob([bytes(1000, seed) as Uint8Array<ArrayBuffer>]), headers);
    assert.equal(res.status, 200, await res.clone().text());
    return ((await res.json()) as { version: Ver }).version;
  };
  const kept = async (): Promise<string[]> =>
    ((await (await call("GET", `/api/files/${fileId}/versions`)).json()) as { versions: Ver[] }).versions.map((v) => v.id);
  const blobCount = (): number => readdirSync(join(data, "blobs"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;

  const manual = await save(11);
  assert.equal(manual.autosave, false, "File > Save is not an autosave");
  const a1 = await save(12, "replace");
  assert.equal(a1.autosave, true);
  assert.ok((await kept()).includes(manual.id), "an autosave never replaces a version saved by hand");
  const blobs = blobCount();
  const a2 = await save(13, "replace");
  let ids = await kept();
  assert.ok(!ids.includes(a1.id) && ids.includes(a2.id) && ids.includes(manual.id), "a big drawing's autosave replaces the one before");
  assert.equal(blobCount(), blobs, "and its copy is let go of");
  const k1 = await save(14, "keep");
  assert.ok((await kept()).includes(a2.id), "a small drawing's autosave keeps the one before");
  const a3 = await save(15, "replace");
  assert.ok(!(await kept()).includes(k1.id), "but a big one replaces a small one's");
  assert.equal((await call("PATCH", `/api/files/${fileId}/versions/${a3.id}`, JSON.stringify({ label: "Keep me" }), { "Content-Type": "application/json" })).status, 200);
  const a4 = await save(16, "replace");
  ids = await kept();
  assert.ok(ids.includes(a3.id) && ids.includes(a4.id), "a named autosave is kept");
  const a5 = await save(17, "replace", false);
  assert.ok((await kept()).includes(a4.id), "a save not checked against the head replaces nothing");
  assert.equal(a5.autosave, true);
  const a6 = await save(18, "replace", "seq");
  ids = await kept();
  assert.ok(!ids.includes(a5.id) && ids.includes(a6.id), "a live session's autosave replaces the one before");
  const head = new Uint8Array(await (await call("GET", `/api/files/${fileId}/content`)).arrayBuffer());
  assert.equal(sha(head), sha(bytes(1000, 18)), "the last autosave is the drawing");
  assert.equal((await call("PUT", `/api/files/${fileId}/content`, new Blob(["x"]), { "X-Autosave": "sometimes" })).status, 400);

  // ---- earlier builds' assets --------------------------------------------------------
  await until(() => readdirSync(join(data, "assets")).length > 0, "the build's assets to be kept");
  writeFileSync(join(data, "assets", "old-build-abc123.js"), "console.log('old')");
  const old = await fetch(`${BASE}/assets/old-build-abc123.js`);
  assert.equal(old.status, 200, "an earlier build's asset is still served");
  assert.match(old.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(old.headers.get("content-type"), "application/javascript; charset=utf-8");
  assert.equal((await fetch(`${BASE}/assets/never-built.js`)).status, 404);
  assert.equal((await fetch(`${BASE}/assets/..%2f..%2fopenvwx.db`)).status, 404, "no way out of the archive");

  console.log("reports-test: all passed");
} finally {
  server.kill();
  rmSync(data, { recursive: true, force: true });
}
