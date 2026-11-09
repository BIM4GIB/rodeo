// Tests for the gallery's publishing, forking, moderation and public reads (src/galleryPublish.ts,
// src/gallery.ts, src/galleryModeration.ts): node scripts/gallery-test.ts
// A real server on a loopback port with its own data folder; people sign in through email links,
// each from an address of their own. Drawings are any bytes: the server never reads them.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ForkAttribution, GalleryList, EntryDetail, ModerationItem, OwnEntry, PublishState, ForkResult } from "../../web/src/features/gallery/rules.ts";

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "rodeo-gallery-"));
let log = "";

const server: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(PORT),
    DATA_DIR: data,
    PUBLIC_URL: BASE,
    ADMIN_EMAILS: "admin@example.com",
    CLIENT_IP_HEADER: "x-test-ip",
    // a free account keeps three versions, so the pinned one is what keeps a published drawing's bytes
    FREE_VERSIONS: "3",
    FREE_FILES: "20",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout?.on("data", (d: Buffer) => (log += d.toString()));
server.stderr?.on("data", (d: Buffer) => (log += d.toString()));

const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EMBED = "/?embed=";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A signed-in person: the session cookie, and the address the server sees their calls from. */
interface Who {
  readonly cookie: string;
  readonly ip: string;
}

/** One request as `who` (a guest when null). Bytes go as they are; anything else as JSON. */
async function call(who: Who | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const bytes = Buffer.isBuffer(body);
  return fetch(`${BASE}${path}`, {
    method,
    body: body === undefined ? undefined : bytes ? new Uint8Array(body) : JSON.stringify(body),
    headers: {
      "X-Requested-With": "openvwx",
      "User-Agent": CHROME_MAC,
      ...(body === undefined ? {} : { "Content-Type": bytes ? "application/octet-stream" : "application/json" }),
      ...(who?.cookie ? { Cookie: who.cookie } : {}),
      ...(who ? { "x-test-ip": who.ip } : {}),
      ...headers,
    },
    redirect: "manual",
  });
}

/** A call that must succeed, answered with its JSON body. */
async function json<T>(who: Who | null, method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await call(who, method, path, body, headers);
  const out = await res.text();
  assert.ok(res.ok, `${method} ${path} answered ${res.status}: ${out}`);
  return JSON.parse(out) as T;
}

/** A call that must succeed, answered with its body as text. */
async function text(who: Who | null, method: string, path: string, body?: unknown): Promise<string> {
  const res = await call(who, method, path, body);
  const out = await res.text();
  assert.ok(res.ok, `${method} ${path} answered ${res.status}: ${out}`);
  return out;
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}\n${log}`);
}

/** Signs `email` in through an email link from `ip`; resolves with the person's session. */
async function signIn(email: string, ip: string): Promise<Who> {
  const before = log.length;
  const sent = await call({ cookie: "", ip }, "POST", "/api/auth/email", { email });
  assert.equal(sent.status, 200);
  await until(() => /callback\?token=[\w-]+/.test(log.slice(before)), `${email}'s sign-in link`);
  const link = /(\/api\/auth\/email\/callback\?token=[\w-]+)/.exec(log.slice(before))![1];
  const res = await call({ cookie: "", ip }, "GET", link);
  assert.equal(res.status, 302);
  return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0], ip };
}

/** The share token of an entry's embed link. */
function tokenOf(embedUrl: string): string {
  assert.ok(embedUrl.startsWith(EMBED), `an embed link, not "${embedUrl}"`);
  return embedUrl.slice(EMBED.length);
}

/** A drawing's gallery body for publishing; tests change one field at a time. */
const CABIN = {
  title: "Cabin",
  description: "A small timber cabin.",
  tags: ["House", "timber frame"],
  licence: "CC-BY-4.0",
  creditName: "Ana",
  agree: true,
};

try {
  await until(() => log.includes("listening"), "the server");

  // ---- 1. accounts -----------------------------------------------------------------
  const alice = await signIn("alice@example.com", "10.0.1.1");
  const bob = await signIn("bob@example.com", "10.0.1.2");
  const carol = await signIn("carol@example.com", "10.0.1.3");
  const dave = await signIn("dave@example.com", "10.0.1.4");
  const erin = await signIn("erin@example.com", "10.0.1.5");
  const admin = await signIn("admin@example.com", "10.0.1.6");

  // ---- 2. a drawing with a head ---------------------------------------------------
  const made = await json<{ file: { id: string } }>(alice, "POST", "/api/files", Buffer.from("drawing A"), { "X-File-Name": "Cabin" });
  const fileId = made.file.id;
  await json(alice, "PUT", `/api/files/${fileId}/content`, Buffer.from("drawing B"));

  // ---- 3. the publish dialog's state -----------------------------------------------
  const state = await json<PublishState>(alice, "GET", `/api/gallery/files/${fileId}`);
  assert.equal(state.canPublish, true);
  assert.equal(state.reason, null);
  assert.equal(state.licences.length, 4);
  assert.equal(state.defaultLicence, "CC-BY-4.0");
  assert.equal(state.entry, null);
  assert.equal(state.forkedFrom, null);
  assert.equal(state.isAdmin, false);
  assert.ok(state.defaultCredit, "the signed-in name is the credit to start with");
  assert.equal((await call(bob, "GET", `/api/gallery/files/${fileId}`)).status, 404, "a stranger sees no drawing state");

  // ---- 4. publishing --------------------------------------------------------------
  assert.equal((await call(alice, "POST", `/api/gallery/files/${fileId}/publish`, { ...CABIN, agree: false })).status, 400, "the right to share is confirmed");
  assert.equal((await call(alice, "POST", `/api/gallery/files/${fileId}/publish`, { ...CABIN, licence: "MIT" })).status, 400, "only the four licences");
  const first = await call(alice, "POST", `/api/gallery/files/${fileId}/publish`, CABIN);
  assert.equal(first.status, 201);
  const { entry: cabin } = (await first.json()) as { entry: OwnEntry };
  assert.deepEqual(cabin.tags, ["house", "timber-frame"]);
  assert.ok(cabin.embedUrl.startsWith(EMBED));
  assert.equal(cabin.fileId, fileId);
  assert.equal(cabin.creditName, "Ana");
  assert.equal(cabin.official, false);
  const entryId = cabin.id;
  const token = tokenOf(cabin.embedUrl);

  // ---- 5. the public reads, with nobody signed in ----------------------------------
  const listed = await json<GalleryList>(null, "GET", "/api/gallery/entries");
  assert.ok(listed.entries.some((e) => e.id === entryId), "the listing has it");
  const house = await json<GalleryList>(null, "GET", "/api/gallery/entries?tag=house");
  assert.ok(house.entries.some((e) => e.id === entryId), "a tag finds it");
  const timber = await json<GalleryList>(null, "GET", "/api/gallery/entries?q=timber");
  assert.ok(timber.entries.some((e) => e.id === entryId), "a search finds it");
  const nothing = await json<GalleryList>(null, "GET", "/api/gallery/entries?q=zzz");
  assert.equal(nothing.entries.length, 0);
  const tags = await json<{ tags: { tag: string; count: number }[] }>(null, "GET", "/api/gallery/tags");
  assert.ok(tags.tags.some((t) => t.tag === "house"));
  const guestView = await json<EntryDetail>(null, "GET", `/api/gallery/entries/${entryId}`);
  assert.equal(guestView.entry.title, "Cabin");
  assert.equal(guestView.fileId, null, "a guest is not told the drawing's id");
  assert.equal(guestView.viewer.isOwner, false);

  // ---- 6. the snapshot: later saves do not show, pruning does not touch it ---------
  await json(alice, "PUT", `/api/files/${fileId}/content`, Buffer.from("drawing C"));
  await json(alice, "PUT", `/api/files/${fileId}/content`, Buffer.from("drawing D"));
  assert.equal(await text(null, "GET", `/api/s/${token}/content`), "drawing B", "the link shows the version published");
  const shared = await json<{ fileName: string; ownerName: string }>(null, "GET", `/api/s/${token}`);
  assert.equal(shared.fileName, "Cabin");
  assert.equal(shared.ownerName, "Ana", "the credit, not the account name");
  await json(alice, "PUT", `/api/files/${fileId}/content`, Buffer.from("drawing E"));
  await json(alice, "PUT", `/api/files/${fileId}/content`, Buffer.from("drawing F"));
  await json(alice, "PUT", `/api/files/${fileId}/content`, Buffer.from("drawing G"));
  assert.equal(await text(null, "GET", `/api/s/${token}/content`), "drawing B", "pruning keeps the published version");
  const versions = await json<{ versions: { label: string | null }[] }>(alice, "GET", `/api/files/${fileId}/versions`);
  assert.equal(versions.versions.length, 4, "three kept by the plan, and the published one");
  assert.ok(versions.versions.some((v) => v.label === "Published to the gallery"), "the published version is labelled");
  const aliceShares = await json<{ shares: { token: string }[] }>(alice, "GET", `/api/files/${fileId}/shares`);
  assert.ok(!aliceShares.shares.some((s) => s.token === token), "the gallery's link is not one of her share links");
  assert.equal((await call(alice, "DELETE", `/api/shares/${token}`)).status, 400, "the gallery's link is unpublished, not revoked");

  // ---- 7. forking -----------------------------------------------------------------
  const forked = await call(bob, "POST", `/api/gallery/entries/${entryId}/fork`);
  assert.equal(forked.status, 201);
  const bobFork = ((await forked.json()) as ForkResult).fileId;
  assert.equal(await text(bob, "GET", `/api/files/${bobFork}/content`), "drawing B", "the fork is the version published");
  const attribution = await json<{ attribution: ForkAttribution }>(bob, "GET", `/api/gallery/forked/${bobFork}`);
  assert.equal(attribution.attribution.title, "Cabin");
  assert.equal(attribution.attribution.creditName, "Ana");
  assert.equal(attribution.attribution.licence, "CC-BY-4.0");
  assert.ok(attribution.attribution.path, "its original is still in the gallery");
  assert.equal((await json<{ attribution: ForkAttribution | null }>(alice, "GET", `/api/gallery/forked/${fileId}`)).attribution, null, "her own drawing was not forked");
  assert.equal((await json<EntryDetail>(null, "GET", `/api/gallery/entries/${entryId}`)).entry.forks, 1);
  assert.equal((await call(alice, "POST", `/api/gallery/entries/${entryId}/fork`)).status, 201, "an owner may fork her own");
  assert.equal((await json<EntryDetail>(null, "GET", `/api/gallery/entries/${entryId}`)).entry.forks, 1, "the author's own forks do not count");

  // ---- 8. the licence of the original changes; forks keep theirs -------------------
  const patched = await json<{ entry: OwnEntry }>(alice, "PATCH", `/api/gallery/entries/${entryId}`, { licence: "CC-BY-SA-4.0" });
  assert.equal(patched.entry.licence, "CC-BY-SA-4.0");
  assert.equal((await call(bob, "PATCH", `/api/gallery/entries/${entryId}`, { title: "Mine now" })).status, 404, "only the owner edits details");
  const bobState = await json<PublishState>(bob, "GET", `/api/gallery/files/${bobFork}`);
  assert.deepEqual([...bobState.licences], ["CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0"], "a CC BY fork may not become CC0");
  assert.equal(bobState.forkedFrom?.licence, "CC-BY-4.0");
  const bigger = { title: "Cabin, bigger", description: "", tags: [], creditName: "", agree: true };
  assert.equal((await call(bob, "POST", `/api/gallery/files/${bobFork}/publish`, { ...bigger, licence: "CC0-1.0" })).status, 400);
  const biggerRes = await call(bob, "POST", `/api/gallery/files/${bobFork}/publish`, { ...bigger, licence: "CC-BY-4.0", official: true, featured: true });
  assert.equal(biggerRes.status, 201);
  const bobEntry = ((await biggerRes.json()) as { entry: OwnEntry }).entry;
  assert.equal(bobEntry.official, false, "only an admin credits as Rodeo");
  assert.equal(bobEntry.featured, false, "only an admin picks");
  assert.equal(bobEntry.creditName, "bob", "the signed-in name, when no credit is given");
  const carolFork = await json<ForkResult>(carol, "POST", `/api/gallery/entries/${entryId}/fork`);
  const carolState = await json<PublishState>(carol, "GET", `/api/gallery/files/${carolFork.fileId}`);
  assert.deepEqual([...carolState.licences], ["CC-BY-SA-4.0"], "a fork of a BY-SA drawing may only be BY-SA");
  const remixed = await json<EntryDetail>(alice, "GET", `/api/gallery/entries/${entryId}`);
  assert.equal(remixed.remixes[0].card.title, "Cabin, bigger", "a published fork is in the remix tree");
  assert.equal(remixed.remixes.length, 1, "a fork nobody published is only counted");
  // carol's fork is not published, so it is counted but not shown
  assert.equal(remixed.privateForks, 1);
  const bobDetail = await json<EntryDetail>(null, "GET", `/api/gallery/entries/${bobEntry.id}`);
  assert.equal(bobDetail.entry.forkedFrom?.title, "Cabin");
  const notAdmin = await json<{ entry: OwnEntry }>(bob, "PATCH", `/api/gallery/entries/${bobEntry.id}`, { official: true });
  assert.equal(notAdmin.entry.official, false, "only an admin sets official");

  // ---- 9. the cover ----------------------------------------------------------------
  const png = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(100)]);
  assert.equal((await call(alice, "PUT", `/api/gallery/entries/${entryId}/cover`, png)).status, 204);
  const cover = await call(null, "GET", `/api/gallery/entries/${entryId}/cover`);
  assert.equal(cover.status, 200);
  assert.equal(cover.headers.get("content-type"), "image/png");
  assert.equal((await call(alice, "PUT", `/api/gallery/entries/${entryId}/cover`, Buffer.from("GIF89a" + "\0".repeat(20)))).status, 400, "a GIF is no cover");
  assert.equal((await call(alice, "PUT", `/api/gallery/entries/${entryId}/cover`, Buffer.alloc(1536 * 1024))).status, 413, "a cover over 1 MB");
  assert.equal((await call(bob, "PUT", `/api/gallery/entries/${entryId}/cover`, png)).status, 404, "only the owner changes the cover");

  // ---- 10. download, as a guest ----------------------------------------------------
  const download = await call(null, "GET", `/api/gallery/entries/${entryId}/download`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
  assert.equal(await download.text(), "drawing B");

  // ---- 11. sitemap, robots, and the pages' head ------------------------------------
  assert.ok((await text(null, "GET", "/sitemap.xml")).includes(cabin.path), "the sitemap lists the drawing");
  assert.ok((await text(null, "GET", "/robots.txt")).includes("Sitemap:"));
  if (existsSync(join(import.meta.dirname, "../../web/dist/gallery.html"))) {
    const page = await call(null, "GET", `/gallery/${entryId}/x`);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes("og:title"));
    const missing = await call(null, "GET", "/gallery/aaaaaaaaaaaa");
    assert.equal(missing.status, 404);
    assert.ok((await missing.text()).includes("noindex"));
  } else {
    console.log("skipped page checks: web/dist/gallery.html is not built");
  }

  // ---- 12. the CSRF guard ----------------------------------------------------------
  assert.equal((await call(alice, "POST", `/api/gallery/entries/${entryId}/fork`, undefined, { "X-Requested-With": "" })).status, 403);

  // ---- 13. reports, hiding, and the admins' list -----------------------------------
  const report = (who: Who, reason = "spam") => call(who, "POST", `/api/gallery/entries/${entryId}/report`, { reason, note: "An advert" });
  // only accounts older than a few days count towards hiding, so these are made old; erin stays new
  const db = new DatabaseSync(join(data, "openvwx.db"));
  db.prepare("UPDATE users SET created_at = '2020-01-01T00:00:00.000Z' WHERE email IN ('carol@example.com', 'dave@example.com', 'bob@example.com')").run();
  db.close();
  assert.equal((await report(alice)).status, 400, "an owner reports nothing");
  assert.equal((await report(carol)).status, 201);
  assert.equal((await report(dave)).status, 201);
  assert.equal((await json<EntryDetail>(null, "GET", `/api/gallery/entries/${entryId}`)).entry.state, "published", "two reports do not hide it");
  assert.equal((await report(erin)).status, 201);
  assert.equal((await json<EntryDetail>(null, "GET", `/api/gallery/entries/${entryId}`)).entry.state, "published", "a new account's report does not count");
  assert.equal((await report(bob)).status, 201);
  assert.equal((await call(null, "GET", `/api/gallery/entries/${entryId}`)).status, 404, "three established people hide it");
  assert.equal((await call(null, "GET", `/api/s/${token}`)).status, 200, "its link and embeds keep working until an admin looks");
  assert.equal((await json<EntryDetail>(alice, "GET", `/api/gallery/entries/${entryId}`)).entry.state, "hidden", "its owner still sees it");
  assert.equal((await call(bob, "GET", "/api/gallery/admin/reports")).status, 403);
  const queue = await json<{ items: ModerationItem[] }>(admin, "GET", "/api/gallery/admin/reports");
  const reported = queue.items.find((i) => i.entry.id === entryId);
  assert.ok(reported, "the admins' list has it");
  assert.equal(reported.reports.length, 4);
  assert.equal((await call(admin, "POST", `/api/gallery/admin/entries/${entryId}/restore`)).status, 204);
  const back = await json<EntryDetail>(null, "GET", `/api/gallery/entries/${entryId}`);
  assert.equal(back.entry.state, "published");
  const token2 = tokenOf(back.entry.embedUrl);
  assert.equal(token2, token, "a drawing hidden by reports keeps its link");
  assert.equal(await text(null, "GET", `/api/s/${token2}/content`), "drawing B");

  // ---- 14. unpublish, and publish again --------------------------------------------
  assert.equal((await call(alice, "DELETE", `/api/gallery/entries/${entryId}`)).status, 204);
  assert.equal((await call(null, "GET", `/api/gallery/entries/${entryId}`)).status, 404);
  assert.equal((await call(null, "GET", `/api/s/${token2}`)).status, 404);
  assert.equal(await text(bob, "GET", `/api/files/${bobFork}/content`), "drawing B", "a fork is its taker's");
  assert.equal((await json<{ attribution: ForkAttribution }>(bob, "GET", `/api/gallery/forked/${bobFork}`)).attribution.path, null, "the original has gone");
  const previous = await json<PublishState>(alice, "GET", `/api/gallery/files/${fileId}`);
  assert.equal(previous.entry, null);
  assert.equal(previous.previous?.title, "Cabin", "the dialog fills in what it was published with");
  const again = await call(alice, "POST", `/api/gallery/files/${fileId}/publish`, CABIN);
  assert.equal(again.status, 201);
  assert.equal(((await again.json()) as { entry: OwnEntry }).entry.id, entryId, "the same entry, the same address");

  // ---- 15. the owner deletes the drawing -------------------------------------------
  assert.equal((await call(alice, "DELETE", `/api/files/${fileId}`)).status, 204);
  assert.equal(await text(bob, "GET", `/api/files/${bobFork}/content`), "drawing B", "a fork outlives its original's bytes");
  assert.equal((await json<{ attribution: ForkAttribution }>(bob, "GET", `/api/gallery/forked/${bobFork}`)).attribution.creditName, "Ana", "and keeps its credit");

  // ---- 16. an admin's drawing, credited as Rodeo and picked ------------------------
  const demo = await json<{ file: { id: string } }>(admin, "POST", "/api/files", Buffer.from("demo"), { "X-File-Name": "Demo house" });
  const demoPublished = await call(admin, "POST", `/api/gallery/files/${demo.file.id}/publish`, {
    ...CABIN,
    title: "Demo house",
    creditName: "Someone else",
    official: true,
    featured: true,
  });
  assert.equal(demoPublished.status, 201);
  const demoEntry = ((await demoPublished.json()) as { entry: OwnEntry }).entry;
  assert.equal(demoEntry.creditName, "Rodeo");
  assert.equal(demoEntry.official, true);
  assert.equal(demoEntry.featured, true);
  assert.equal((await json<GalleryList>(null, "GET", "/api/gallery/entries?featured=1")).entries[0].id, demoEntry.id);

  console.log("gallery: all checks passed");
} catch (e) {
  console.error(e);
  console.error(log.split("\n").slice(-30).join("\n"));
  process.exitCode = 1;
} finally {
  server.kill();
  rmSync(data, { recursive: true, force: true });
}
