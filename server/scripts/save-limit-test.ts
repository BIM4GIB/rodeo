import { COLLAB_PROTOCOL } from "../../web/src/platform/protocol.ts";
// Tests for a live session's saves against the owner's plan (src/collab.ts, saveRefusal in
// src/files.ts): node scripts/save-limit-test.ts
// A real server on a loopback port with its own data folder and a tiny plan, signed in through an
// email link, and a ws client for the room. Takes about half a minute: the room looks every 10 s.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "rodeo-save-limit-"));
const PLAN = 13_000;
let log = "";

const server: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: { ...process.env, NODE_ENV: "development", PORT: String(PORT), DATA_DIR: data, PUBLIC_URL: BASE, FREE_BYTES: String(PLAN) },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout?.on("data", (d: Buffer) => (log += d.toString()));
server.stderr?.on("data", (d: Buffer) => (log += d.toString()));

let cookie = "";
let ws: WebSocket | undefined;

function call(method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    body,
    headers: { "X-Requested-With": "openvwx", ...(cookie ? { Cookie: cookie } : {}), ...headers },
    redirect: "manual",
  });
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}\n${log}`);
}

const blob = (n: number): Blob => new Blob([new Uint8Array(n).fill(7)]);

async function create(name: string, size: number): Promise<{ id: string; headVersionId: string }> {
  const res = await call("POST", "/api/files", blob(size), { "X-File-Name": name, "Content-Type": "application/octet-stream" });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { file: { id: string; headVersionId: string } }).file;
}

try {
  await until(() => log.includes("listening"), "the server");
  await call("POST", "/api/auth/email", JSON.stringify({ email: "tester@example.com" }), { "Content-Type": "application/json" });
  await until(() => /callback\?token=[\w-]+/.test(log), "the sign-in link");
  cookie = ((await call("GET", /(\/api\/auth\/email\/callback\?token=[\w-]+)/.exec(log)![1])).headers.get("set-cookie") ?? "").split(";")[0];

  const a = await create("a.vwx", 3000);
  const other = await create("b.vwx", 5000);

  // the room
  const seen: { t: string; seq?: number; error?: string }[] = [];
  ws = new WebSocket(`ws://localhost:${PORT}/api/collab/${a.id}`, { headers: { Cookie: cookie, Origin: BASE } });
  ws.on("message", (d) => seen.push(JSON.parse(d.toString()) as (typeof seen)[number]));
  await new Promise((resolve, reject) => {
    ws!.once("open", resolve);
    ws!.once("error", reject);
  });
  ws.send(JSON.stringify({ t: "hello", proto: COLLAB_PROTOCOL, versionId: a.headVersionId }));
  await until(() => seen.some((m) => m.t === "welcome"), "the welcome");

  const count = (t: string): number => seen.filter((m) => m.t === t).length;
  let seq = 0;
  const changes = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      const acks = count("ack");
      ws!.send(JSON.stringify({ t: "op", id: seq + 1, base: seq, op: { start: 0, del: 0, add: [`r${seq}`], kind: "objects", ids: [`i${seq}`] } }));
      await until(() => count("ack") > acks, "the change to be taken");
      seq++;
    }
  };
  const versions = async (): Promise<unknown[]> => ((await (await call("GET", `/api/files/${a.id}/versions`)).json()) as { versions: unknown[] }).versions;
  const save = (size: number): Promise<Response> => call("PUT", `/api/files/${a.id}/content`, blob(size), { "X-Collab-Seq": String(seq), "X-Autosave": "keep" });

  // 8000 used: one the size of the head fits (11000), so it is asked for
  await changes(60);
  await until(() => count("save-request") === 1, "the first request");
  assert.equal(count("save-blocked"), 0);

  // it comes in larger than that, and is refused: no second request, and the room says why
  const refused = await save(6000);
  assert.equal(refused.status, 409);
  assert.equal(((await refused.json()) as { code: string }).code, "limit");
  await until(() => count("save-blocked") === 1, "the room to say saves are blocked");
  assert.match(seen.find((m) => m.t === "save-blocked")!.error!, /plan allows/);
  assert.equal(count("save-request"), 1, "no save is asked for that would be refused");
  assert.equal((await versions()).length, 1, "looking for room leaves no version behind");
  assert.equal(((await (await call("GET", `/api/files/${a.id}`)).json()) as { file: { headVersionId: string } }).file.headVersionId, a.headVersionId);

  // a File > Save hears the same, and leaves nothing behind on disk
  const blobCount = (): number => readdirSync(join(data, "blobs"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
  const before = blobCount();
  assert.equal((await save(6000)).status, 409);
  assert.equal(blobCount(), before);

  // room is made: asked again, and that save goes through
  assert.equal((await call("DELETE", `/api/files/${other.id}`)).status < 300, true);
  await until(() => count("save-request") === 2, "a request once there is room", 25_000);
  const saved = await save(6000);
  assert.equal(saved.status, 200, await saved.clone().text());

  // now one the size of the head doesn't fit (15000): told at once, and never asked
  const blocked = count("save-blocked");
  await changes(60);
  await until(() => count("save-blocked") === blocked + 1, "the room to say saves are blocked again");
  assert.equal(count("save-request"), 2);
  assert.equal((await versions()).length, 2);

  console.log("save-limit-test: all passed");
} finally {
  ws?.terminate();
  server.kill();
  rmSync(data, { recursive: true, force: true });
}
