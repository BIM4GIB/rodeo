// node scripts/plain-save-test.ts — pause real uploads across acknowledged edits and saves.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, statSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { CloudFile, ServerMessage } from "../../web/src/platform/protocol.ts";
const port = 21000 + Math.floor(Math.random() * 1000), base = `http://localhost:${port}`;
const data = mkdtempSync(join(tmpdir(), "rodeo-plain-save-"));
let log = "", cookie = "";
const sockets: WebSocket[] = [];
const requests: ReturnType<typeof request>[] = [];
const child = spawn(process.execPath, ["src/index.ts"], {
  cwd: join(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, DATA_DIR: data, PORT: String(port), PUBLIC_URL: base, NODE_ENV: "development", SMTP_URL: "", FREE_BYTES: "1000000" },
});
child.stdout.on("data", b => log += b); child.stderr.on("data", b => log += b);
const exited = once(child, "exit");
async function until(fn: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error(`timed out\n${log}`);
}
function call(method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(base + path, { method, body, redirect: "manual", headers: { Cookie: cookie, "X-Requested-With": "openvwx", ...headers } });
}
async function file(res: Response): Promise<CloudFile> {
  assert.ok(res.ok, await res.clone().text()); return ((await res.json()) as { file: CloudFile }).file;
}
const bytes = new Uint8Array(3000).fill(7);
const blobs = (): number => readdirSync(join(data, "blobs"), { recursive: true, withFileTypes: true }).filter(e => e.isFile()).length;
async function paused(f: CloudFile, withBase: boolean): Promise<() => Promise<number>> {
  let finish!: () => void;
  const result = new Promise<number>((resolve, reject) => {
    const req = request(base + `/api/files/${f.id}/content`, { method: "PUT", headers: {
      Cookie: cookie, "X-Requested-With": "openvwx", "Content-Length": String(bytes.length),
      ...(withBase ? { "X-Base-Version": f.headVersionId } : {}),
    } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
    requests.push(req); req.on("error", reject); req.write(bytes.subarray(0, 10));
    finish = () => req.end(bytes.subarray(10));
  });
  await until(() => readdirSync(join(data, "tmp")).some(n => statSync(join(data, "tmp", n)).size === 10));
  return () => { finish(); return result; };
}
try {
  await until(() => log.includes("listening"));
  await call("POST", "/api/auth/email", JSON.stringify({ email: "plain-test@example.com" }), { "Content-Type": "application/json" });
  await until(() => /callback\?token=[\w-]+/.test(log));
  cookie = (await call("GET", /(\/api\/auth\/email\/callback\?token=[\w-]+)/.exec(log)![1])).headers.get("set-cookie")!.split(";")[0];
  for (const withBase of [false, true]) for (const interveningSave of [false, true]) {
    const f = await file(await call("POST", "/api/files", bytes));
    const ws = new WebSocket(`ws://localhost:${port}/api/collab/${f.id}`, { headers: { Cookie: cookie, Origin: base } });
    sockets.push(ws);
    const seen: ServerMessage[] = [];
    ws.on("message", b => seen.push(JSON.parse(b.toString()) as ServerMessage));
    await once(ws, "open"); ws.send(JSON.stringify({ t: "hello", versionId: f.headVersionId }));
    await until(() => seen.some(m => m.t === "welcome"));
    const finish = await paused(f, withBase);
    ws.send(JSON.stringify({ t: "op", id: 1, base: 0, op: { start: 0, del: 0, kind: "objects", ids: ["test"], add: ["AQID"] } }));
    await until(() => seen.some(m => m.t === "ack" && m.seq === 1));
    let head = f;
    if (interveningSave) head = await file(await call("PUT", `/api/files/${f.id}/content`, new Uint8Array(3100).fill(8), { "X-Collab-Seq": "1" }));
    const before = blobs();
    assert.equal(await finish(), 409, "a plain upload cannot claim concurrent live edits, even if another save cleared the log");
    assert.equal(blobs(), before, "rejected upload blob released");
    assert.equal(readdirSync(join(data, "tmp")).length, 0);
    const actual = await file(await call("GET", `/api/files/${f.id}`));
    assert.equal(actual.headVersionId, head.headVersionId);
    // Same-session sequence-bearing saves are still accepted; a stable plain upload then succeeds.
    if (!interveningSave) head = await file(await call("PUT", `/api/files/${f.id}/content`, bytes, { "X-Collab-Seq": "1" }));
    assert.equal(await (await paused(head, withBase))(), 200);
    const res = await call("GET", `/api/files/${f.id}/content`);
    assert.equal(res.headers.get("x-collab-seq"), "1");
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
    ws.close(); await once(ws, "close");
    assert.equal((await call("DELETE", `/api/files/${f.id}`)).status, 204);
  }
  console.log("plain save race checks passed");
} finally {
  for (const req of requests) req.destroy();
  for (const ws of sockets) if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
  child.kill(); await exited; rmSync(data, { recursive: true, force: true });
}
