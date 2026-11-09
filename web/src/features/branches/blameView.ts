// Blame in the editor: who last changed each object of the open cloud drawing, read from its saved
// versions (the newest 30, oldest first when worked out). Every object is outlined on the active
// layer in its author's colour, and a palette lists the authors. With one object selected, the
// palette says who changed it and when, and offers to open that version or compare it with the one
// before. Each version's object fingerprints are kept in the browser, so a second look is quick.
// blame.ts and units.ts do the work without the DOM; this file reads versions and draws.

import { setEditGroup } from "../../app/commands.ts";
import type { PaletteSpec } from "../../app/dock.ts";
import { h } from "../../app/dom.ts";
import { appContext, onDocument, registerOverlay } from "../../app/ext.ts";
import { showLoading } from "../../app/loading.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import type { Painter } from "../../app/tools.ts";
import { files } from "../../platform/api.ts";
import { PEER_COLORS } from "../../platform/protocol.ts";
import { cloudCall, explainFailure, openCloudDrawing, openCloudVersion } from "../cloud/cloud.ts";
import { note, timeAgo } from "../cloud/ui.ts";
import { type BlameEntry, blameFrom, type VersionPrints } from "./blame.ts";
import { startCompare } from "./compare.ts";
import { onBranch } from "./family.ts";
import { BLAME } from "./glyphs.ts";
import { prints as printsOf, readUnits } from "./units.ts";

/** The palette's id, for Window > Palettes and for showing it. */
export const BLAME_PALETTE_ID = "branches-blame";
/** Most saved versions read: the newest ones, so older changes show as "or earlier". */
const BLAME_MAX_VERSIONS = 30;
/** Most bytes fetched for one blame; versions kept in the browser cost nothing. */
const BLAME_MAX_BYTES = 600 * 1024 * 1024;
/** A version bigger than this stops the walk back through the versions. */
const SKIP_ABOVE = 200 * 1024 * 1024;
/** The colour of the tenth author and beyond: PEER_COLORS holds eight. */
const OTHER_COLOUR = "#8b8d98";
/** Most objects outlined in the 2D view at once. */
const OUTLINE_CAP = 4000;
/** Most versions whose fingerprints the browser keeps. */
const CACHE_MAX = 60;
const DB_NAME = "openvwx-branches";
const DB_VERSION = 1;
const STORE = "prints";
/** The state of an unsaved drawing: no version, so no author id. */
const NOW = "now";

/** One author of a change in the drawing: their colour, and the objects whose latest change is theirs. */
interface Author {
  readonly key: string;
  readonly name: string;
  readonly colour: string;
  readonly ids: string[];
}

/** The blame of the open drawing as last worked out. */
interface Blame {
  readonly entries: ReadonlyMap<string, BlameEntry>;
  /** in the order each author first appears in the entries */
  readonly authors: readonly Author[];
  /** an author's key to their colour */
  readonly colourOf: ReadonlyMap<string, string>;
  /** the saved versions read, oldest first */
  readonly versions: readonly VersionPrints[];
  /** the oldest version read is the drawing's first */
  readonly complete: boolean;
}

/** A version's fingerprints as kept in the browser. */
interface Kept {
  readonly versionId: string;
  readonly usedAt: number;
  readonly prints: [string, string][];
}

const body = h("div", { cls: "br-blame" });
/** the selection's note and buttons, under the authors */
const info = h("div", { cls: "br-blame-info" });

/** The Blame palette: on the right, hidden until blame is turned on. */
export const blamePalette: PaletteSpec = {
  id: BLAME_PALETTE_ID,
  title: "Blame",
  body,
  side: "right",
  icon: BLAME,
  hidden: true,
};

/** Whether blame is on. */
let on = false;
let blame: Blame | null = null;
/** counts the computations, so an earlier one that ends late does not replace a newer one */
let runs = 0;
let dbPromise: Promise<IDBDatabase> | null = null;

registerOverlay(drawBlame);
onDocument(() => {
  if (on) turnOff();
});
store.on("selection", () => renderSelection());

/** File › Branches › Blame: turns blame on (reading the versions) or off. */
export function toggleBlame(): void {
  if (on) {
    turnOff();
    return;
  }
  if (!openCloudDrawing()) return;
  on = true;
  appContext()?.palettes.show(BLAME_PALETTE_ID);
  void compute();
}

/** Whether blame is on (the Blame menu row is checked then). */
export function blameOn(): boolean {
  return on;
}

/** Turns blame off: the outlines go and the palette closes. */
function turnOff(): void {
  on = false;
  blame = null;
  runs++;
  const ctx = appContext();
  if (ctx?.palettes.isShown(BLAME_PALETTE_ID)) ctx.palettes.toggle(BLAME_PALETTE_ID);
  render();
  ctx?.requestDraw();
}

/** Reads the open drawing's versions and works out who last changed each object. */
async function compute(): Promise<void> {
  const open = openCloudDrawing();
  const ctx = appContext();
  if (!open || !ctx) {
    turnOff();
    return;
  }
  const run = ++runs;
  blame = null;
  render();
  const loading = showLoading("Reading the versions…");
  try {
    // newest first, as the server lists them
    const listed = await files.versions(open.id);
    const chosen = listed.slice(0, BLAME_MAX_VERSIONS);
    // a branch is never complete: its first version is a copy of the version it started from
    let complete = listed.length <= BLAME_MAX_VERSIONS && !onBranch();
    let fetched = 0;
    const read: VersionPrints[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const v = chosen[i];
      loading.label(`Reading version ${i + 1} of ${chosen.length}…`);
      loading.progress(i / chosen.length);
      let prints = await cachedPrints(v.id);
      if (!prints) {
        // a big version, or too much fetched already, stops the walk: the older changes are left out
        if (v.size > SKIP_ABOVE || fetched + v.size > BLAME_MAX_BYTES) {
          complete = false;
          break;
        }
        const bytes = (await files.content(open.id, v.id)).bytes;
        fetched += bytes.length;
        prints = printsOf(readUnits(bytes));
        void keep({ versionId: v.id, usedAt: Date.now(), prints: [...prints] });
      }
      read.push({ versionId: v.id, authorId: v.authorId, authorName: v.authorName, at: v.createdAt, label: v.label, prints });
      // lets the window breathe between versions
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    const oldestFirst = read.reverse();
    // unsaved changes are the newest state, and belong to no one but whoever is editing
    let now: VersionPrints | undefined;
    if (store.session?.dirty) {
      const bytes = await ctx.documentBytes();
      if (bytes) {
        now = { versionId: NOW, authorId: null, authorName: "You (unsaved)", at: new Date().toISOString(), label: null, prints: printsOf(readUnits(bytes)) };
      }
    }
    if (run !== runs) return;
    blame = summarise(oldestFirst, complete, blameFrom(oldestFirst, complete, now));
  } catch (err) {
    if (run !== runs) return;
    await explainFailure("Blame", err);
    turnOff();
    return;
  } finally {
    loading();
  }
  render();
  ctx.requestDraw();
}

/** The authors of each object, and their colours in order of first appearance. */
function summarise(versions: readonly VersionPrints[], complete: boolean, entries: ReadonlyMap<string, BlameEntry>): Blame {
  const byKey = new Map<string, Author>();
  for (const [id, e] of entries) {
    const key = keyOf(e);
    let author = byKey.get(key);
    if (!author) {
      const index = byKey.size;
      author = { key, name: e.authorName, colour: index < PEER_COLORS.length ? PEER_COLORS[index] : OTHER_COLOUR, ids: [] };
      byKey.set(key, author);
    }
    author.ids.push(id);
  }
  const authors = [...byKey.values()];
  return { entries, authors, colourOf: new Map(authors.map((a) => [a.key, a.colour])), versions, complete };
}

/** The key an author is known by: their id, or their name for an unsaved change, which has no id. */
function keyOf(e: BlameEntry): string {
  return e.authorId ?? `name:${e.authorName}`;
}

/** Draws the palette: the note, the authors, Refresh, and the selection's info. */
function render(): void {
  const parts: Node[] = [];
  if (!on) {
    parts.push(note("Turn Blame on from File › Branches › Blame."));
  } else if (!blame) {
    parts.push(note("Reading the versions…"));
  } else {
    const b = blame;
    parts.push(note(`Based on the last ${b.versions.length} versions${b.complete ? "" : " (older changes show as 'or earlier')"}.`));
    parts.push(
      b.authors.length > 0
        ? h("ul", { cls: "br-legend" }, ...b.authors.map((a) => h("li", {}, authorButton(a))))
        : note("This drawing has no objects to show."),
    );
    parts.push(h("div", { cls: "br-foot" }, button("Refresh", "btn", () => void compute())));
  }
  parts.push(info);
  body.replaceChildren(...parts);
  renderSelection();
}

/** One author in the legend: a swatch, the name and how many objects are theirs. A click selects those objects on the active layer. */
function authorButton(a: Author): HTMLButtonElement {
  const swatch = h("span", { cls: "br-swatch" });
  swatch.style.background = a.colour;
  const btn = h(
    "button",
    { cls: "br-author", attrs: { type: "button", title: `Select ${a.name}'s objects on the active layer` } },
    swatch,
    h("span", { cls: "br-author-name", text: a.name }),
    h("span", { cls: "br-row-note", text: a.ids.length === 1 ? "1 object" : `${a.ids.length} objects` }),
  );
  btn.addEventListener("click", () => selectAuthor(a));
  return btn;
}

/** Selects an author's objects that are on the active layer. */
function selectAuthor(a: Author): void {
  const ctx = appContext();
  const layer = store.activeLayerId;
  if (!ctx || layer === null) return;
  const onLayer = new Set(ctx.scene.topLevelEntries(layer).map((e) => e.id));
  setEditGroup(null, a.ids.filter((id) => onLayer.has(id)));
}

/** The selection's line: who last changed the one selected object, and the buttons that act on that change. */
function renderSelection(): void {
  info.replaceChildren();
  if (!on || !blame || store.selection.size !== 1) return;
  const [id] = store.selection;
  const entry = blame.entries.get(id);
  if (!entry) {
    info.append(note("No saved change to this object."));
    return;
  }
  const current = blame;
  const line =
    entry.versionId === NOW
      ? "Changed since the last save"
      : `Last changed by ${entry.authorName} · ${timeAgo(entry.at)}${entry.label ? ` · "${entry.label}"` : ""}${entry.orEarlier ? " or earlier" : ""}`;
  const actions = h("div", { cls: "br-actions" });
  if (entry.versionId !== NOW) actions.append(button("Open That Version", "btn", () => void openThat(entry.versionId)));
  const compare = button("Compare with the Version Before", "btn", () => void compareBefore(current, entry));
  compare.disabled = beforeOf(current, entry) === undefined;
  actions.append(compare);
  info.append(note(line), actions);
}

/** The version before the one that last changed an object: for unsaved changes, the last saved version. */
function beforeOf(b: Blame, e: BlameEntry): VersionPrints | undefined {
  const at = e.versionId === NOW ? b.versions.length : b.versions.findIndex((v) => v.versionId === e.versionId);
  return at > 0 ? b.versions[at - 1] : undefined;
}

/** A button with its label and click handler. */
function button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const btn = h("button", { cls, text, attrs: { type: "button" } });
  btn.addEventListener("click", onClick);
  return btn;
}

/** Opens a saved version read only, in a tab of its own. */
async function openThat(versionId: string): Promise<void> {
  const open = openCloudDrawing();
  if (!open) return;
  const content = await cloudCall("Fetching the version…", "Open version", () => files.content(open.id, versionId));
  if (content) await openCloudVersion(open, versionId, store.fileName, content.bytes);
}

/** Compare with the Version Before: opens the version that changed the object (unless it is the unsaved state), then compares it with the one before. */
async function compareBefore(b: Blame, e: BlameEntry): Promise<void> {
  const open = openCloudDrawing();
  const before = beforeOf(b, e);
  if (!open || !before) {
    toast("There is no earlier version to compare with.", "info");
    return;
  }
  // the comparison is always of the open drawing, so the version that made the change is opened first
  if (e.versionId !== NOW) {
    const content = await cloudCall("Fetching the version…", "Open version", () => files.content(open.id, e.versionId));
    if (!content) return;
    await openCloudVersion(open, e.versionId, store.fileName, content.bytes);
  }
  const earlier = await cloudCall("Fetching the version before…", "Compare", () => files.content(open.id, before.versionId));
  if (earlier) await startCompare({ label: "The version before", bytes: earlier.bytes });
}

/** Outlines the objects of the active layer in their authors' colours, with a faint fill. */
function drawBlame(p: Painter): void {
  const b = blame;
  const ctx = appContext();
  const layer = store.activeLayerId;
  if (!on || !b || !ctx || layer === null) return;
  const g = p.ctx;
  g.save();
  g.lineWidth = 1.5;
  let drawn = 0;
  for (const e of ctx.scene.topLevelEntries(layer)) {
    if (drawn >= OUTLINE_CAP) break;
    const entry = b.entries.get(e.id);
    if (!entry || !e.bbox) continue;
    const colour = b.colourOf.get(keyOf(entry)) ?? OTHER_COLOUR;
    const a = p.toScreen({ x: e.bbox.x0, y: e.bbox.y1 });
    const z = p.toScreen({ x: e.bbox.x1, y: e.bbox.y0 });
    // two pixels of padding, so a thin object still shows its box
    const x = Math.min(a.x, z.x) - 2;
    const y = Math.min(a.y, z.y) - 2;
    const w = Math.abs(z.x - a.x) + 4;
    const hgt = Math.abs(z.y - a.y) + 4;
    g.globalAlpha = 0.08;
    g.fillStyle = colour;
    g.fillRect(x, y, w, hgt);
    g.globalAlpha = 1;
    g.strokeStyle = colour;
    g.strokeRect(x, y, w, hgt);
    drawn++;
  }
  g.restore();
}

// ---- the fingerprints kept in the browser ----------------------------------------------------
// A version's fingerprints are the same whenever they are read, so they are kept by version id. Every
// call may fail (private windows, blocked storage): then the version is read again.

function database(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const created = req.result.createObjectStore(STORE, { keyPath: "versionId" });
      created.createIndex("usedAt", "usedAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // a database that failed to open is retried on the next call, not kept failing
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("the blame cache transaction was aborted"));
  });
}

/** A version's fingerprints from the browser, marking it as just used; undefined when it is not kept. */
async function cachedPrints(versionId: string): Promise<Map<string, string> | undefined> {
  try {
    const db = await database();
    const tx = db.transaction(STORE, "readonly");
    const hit = (await request(tx.objectStore(STORE).get(versionId))) as Kept | undefined;
    await finished(tx);
    if (!hit) return undefined;
    void keep({ ...hit, usedAt: Date.now() });
    return new Map(hit.prints);
  } catch {
    return undefined;
  }
}

/** Keeps a version's fingerprints, then drops the least recently used beyond CACHE_MAX. */
async function keep(kept: Kept): Promise<void> {
  try {
    const db = await database();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(kept);
    await finished(tx);
    await trim(db);
  } catch {
    // the cache is an extra: without it the next look reads the version again
  }
}

/** Deletes the least recently used fingerprints until no more than CACHE_MAX are kept. */
async function trim(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE, "readwrite");
  const os = tx.objectStore(STORE);
  let excess = (await request(os.count())) - CACHE_MAX;
  if (excess > 0) {
    await new Promise<void>((resolve, reject) => {
      const cursor = os.index("usedAt").openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || excess <= 0) {
          resolve();
          return;
        }
        c.delete();
        excess--;
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }
  await finished(tx);
}
