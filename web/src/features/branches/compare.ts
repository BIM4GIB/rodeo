// Compare mode: the open drawing against another version of it (Main, a branch, where a branch
// started, a saved version or a file), drawn over the drawing. Unchanged geometry fades back, added
// objects are green, changed amber and removed ones come back as red ghosts, and each change is
// boxed. An onion-skin slider cross-fades to the other version, a palette lists the changes by
// layer and kind, and the 3D view boxes them. Ghosts are drawn by the editor's own Renderer, off
// screen, and only when the view has been still for a moment.

import { setActiveLayer } from "../../app/commands.ts";
import { h, nextPaint } from "../../app/dom.ts";
import { type AppContext, appContext, followEdits, on3d, onDocument, registerOverlay, registerPalette } from "../../app/ext.ts";
import { showLoading } from "../../app/loading.ts";
import { showDialog } from "../../app/menubar.ts";
import { Renderer } from "../../app/renderer.ts";
import { Scene, type TopEntry } from "../../app/scene.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import type { Painter, ToolOverlay } from "../../app/tools.ts";
import type { View3D } from "../../app/view3d.ts";
import { View } from "../../app/view.ts";
import { type BBox, openVwx, type VwxDocument } from "../../core/index.ts";
import { files } from "../../platform/api.ts";
import { cloudCall, headVersion, openCloudDrawing } from "../cloud/cloud.ts";
import { field } from "../cloud/ui.ts";
import { selectAndZoom } from "../search/select.ts";
import { branches } from "./api.ts";
import { type DiffItem, type DocumentDiff, diffUnits, unitLabel } from "./diff.ts";
import { familyState } from "./family.ts";
import { COMPARE } from "./glyphs.ts";
import { keepOnly, readUnits, type UnitKind } from "./units.ts";

/** Added objects in the drawing: green. */
export const ADDED = "#2f9e5b";
/** Removed objects, shown as ghosts: red. */
export const REMOVED = "#e5484d";
/** Changed objects: amber. */
export const CHANGED = "#d98a00";
/** The paper the editor draws on; faded unchanged geometry is laid over it. */
const PAPER = "#fcfcfb";
/** Larger drawings are not compared in the browser yet. */
const COMPARE_MAX = 200 * 1024 * 1024;
/** Most change boxes the 2D view draws at once. */
const BOX_CAP = 3000;
/** Most boxes the 3D view takes for added and for changed objects, each. */
const BOX3D_CAP = 1500;
/** Most rows a group of changes lists before "…and N more". */
const LIST_CAP = 500;
/** A group of changes opens by itself when it has at most this many rows. */
const OPEN_BELOW = 8;
/** How much of the drawing the fade covers: unchanged geometry shows through at this share. */
const FADE_ALPHA = 0.72;
/** The wait after the view stops moving before the ghosts are drawn again, in ms. */
const PAINT_DELAY = 150;
/** The palette's id, for Window > Palettes and for showing it. */
export const COMPARE_PALETTE_ID = "branches-compare";
const TOO_LARGE = "This drawing is too large to compare in the browser yet.";

/** The other version to compare with: its label in the palette, and its bytes. */
export interface CompareWith {
  readonly label: string;
  readonly bytes: Uint8Array;
}

/** A drawing drawn off screen by the editor's own renderer, and a tinted copy of the last frame. */
interface Ghost {
  readonly scene: Scene;
  readonly view: View;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly tinted: HTMLCanvasElement;
}

/** The kinds of change: what the overlay colours and the list groups. */
type Kind = "added" | "changed" | "removed";
/** A ghost: one of the changes, or the other version in full for the onion skin. */
type GhostKind = Kind | "onion";

/** A comparison in progress. */
interface State {
  readonly other: CompareWith;
  readonly diff: DocumentDiff;
  /** every changed object, added first, for the boxes and the list */
  readonly objects: readonly DiffItem[];
  /** the ghosts made so far: the onion skin only when the slider has been moved */
  readonly ghosts: Partial<Record<GhostKind, Ghost>>;
  /** the unchanged geometry is faded back */
  fade: boolean;
  /** the onion skin's share, 0 (Now only) to 1 (the other version) */
  onion: number;
  /** the drawing was edited since the comparison began */
  stale: boolean;
  /** the view the ghosts were last drawn at (see signature) */
  sig: string;
  /** the view the onion skin was last drawn at, or null when it is not drawn */
  onionSig: string | null;
  /** the 3D boxes, made the first time the 3D view is shown with the comparison */
  lines: readonly Coloured[] | null;
}

/** Line segments in one colour, for the 3D view. */
interface Coloured {
  readonly segments: Float32Array;
  readonly color: number;
}

/** A choice in the Compare dialog: where the other version comes from. */
interface Choice {
  /** the dialog's text for it */
  readonly text: string;
  /** what the palette calls the other version */
  readonly label: string;
  /** fetches the bytes; null when they could not be had (the failure was shown) */
  readonly fetch?: () => Promise<Uint8Array | null>;
  /** a .vwx file on this computer, read after the dialog */
  readonly file?: boolean;
}

const COLOUR: Record<Kind, string> = { added: ADDED, changed: CHANGED, removed: REMOVED };
const NONE: ReadonlySet<string> = new Set<string>();
const NO_TOOLS: ToolOverlay = { moveDelta: () => null, fillPreview: () => null, drawOverlay: () => {} };
/** the groups the list shows after the objects, with the kinds of unit each takes */
const OTHERS: readonly { readonly title: string; readonly kinds: readonly UnitKind[] }[] = [
  { title: "Layers", kinds: ["layer"] },
  { title: "Classes", kinds: ["class"] },
  { title: "Symbols and resources", kinds: ["symbol", "resource"] },
  { title: "Document settings", kinds: ["settings"] },
];

let state: State | null = null;
/** the pending paint of the ghosts, and the view it is for */
let timer = 0;
let pendingSig = "";
/** whether the 3D view holds this comparison's boxes (so they are cleared when it ends) */
let boxes3d = false;
/** the scenes' top-level bounds by object, rebuilt when a scene's list of entries changes */
const boxIndex = new Map<string, { from: readonly TopEntry[]; byId: Map<string, BBox | null> }>();

const body = h("div", { cls: "br-compare" });

registerPalette({ id: COMPARE_PALETTE_ID, title: "Compare", body, side: "right", icon: COMPARE, hidden: true, fill: true });
registerOverlay(drawCompare);
followEdits(() => {
  if (state && !state.stale) {
    state.stale = true;
    renderPalette();
  }
});
onDocument(() => stopCompare());
on3d(() => refresh3d());
store.on("view3d", () => refresh3d());

/** Starts comparing the open drawing with `other` (replacing any comparison running). */
export async function startCompare(other: CompareWith): Promise<void> {
  const ctx = appContext();
  const session = store.session;
  if (!ctx || !session) {
    toast("Open a drawing to compare.", "info");
    return;
  }
  if (other.bytes.length > COMPARE_MAX) {
    toast(TOO_LARGE, "info");
    return;
  }
  // the overlay shows first, so the wait for the reading and the diff shows
  const done = showLoading("Comparing…");
  await nextPaint();
  let next: State | null = null;
  try {
    const now = await ctx.documentBytes();
    if (!now) toast("Open a drawing to compare.", "info");
    else if (now.length > COMPARE_MAX) toast(TOO_LARGE, "info");
    else if (store.session === session) next = compareBytes(now, other);
  } catch (err) {
    toast(`Compare failed: ${errorMessage(err)}`);
  } finally {
    done();
  }
  if (!next) return;
  // a drawing opened meanwhile takes the comparison away, so this one is dropped
  if (store.session !== session) {
    disposeState(next);
    return;
  }
  if (state) {
    window.clearTimeout(timer);
    timer = 0;
    disposeState(state);
  }
  boxIndex.clear();
  state = next;
  renderPalette();
  ctx.palettes.show(COMPARE_PALETTE_ID);
  refresh3d();
  ctx.requestDraw();
}

/** Ends the comparison: the drawing shows as it is, the 3D boxes go, and the palette says so. */
export function stopCompare(): void {
  const s = state;
  if (!s) return;
  window.clearTimeout(timer);
  timer = 0;
  state = null;
  disposeState(s);
  boxIndex.clear();
  const ctx = appContext();
  if (boxes3d) {
    ctx?.view3d()?.setHighlightLines(null);
    boxes3d = false;
  }
  renderPalette();
  ctx?.requestDraw();
}

/** True while a comparison is running. */
export function comparing(): boolean {
  return state !== null;
}

/** File › Branches › Compare…: asks what to compare with, fetches it and starts. */
export async function openCompareDialog(): Promise<void> {
  const session = store.session;
  if (!session) {
    toast("Open a drawing to compare.", "info");
    return;
  }
  const open = openCloudDrawing();
  const fam = familyState();
  const choices: Choice[] = [];
  if (fam) {
    const { family, fileId, current } = fam;
    if (!current.main) choices.push({ text: "Main (latest)", label: "Main", fetch: () => contentOf(family.rootId) });
    for (const b of family.branches) {
      if (b.fileId === fileId) continue;
      choices.push({ text: `Branch: ${b.name} (latest)`, label: `Branch: ${b.name}`, fetch: () => contentOf(b.fileId) });
    }
    if (!current.main) choices.push({ text: "Where this branch started", label: "Where this branch started", fetch: () => baseOf(fileId) });
  }
  if (open) {
    const versions = await cloudCall("Loading the versions…", "Compare", () => files.versions(open.id));
    // the head is what Now is, so it is not offered again
    const head = fam?.current.headVersionId || headVersion(open.id);
    for (const v of versions ?? []) {
      if (v.id === head) continue;
      const when = `${v.label ?? "Version"} · ${new Date(v.createdAt).toLocaleString()}`;
      choices.push({ text: `${when} · ${v.authorName}`, label: when, fetch: () => contentOf(open.id, v.id) });
    }
  }
  choices.push({ text: "A .vwx file on this computer…", label: "", file: true });

  const pick: { file: Promise<File | null> | null } = { file: null };
  const select = h(
    "select",
    { cls: "menu-dialog-input", attrs: { "aria-label": "Compare with" } },
    ...choices.map((c, i) => h("option", { text: c.text, attrs: { value: String(i) } })),
  );
  const choice = await showDialog<Choice>({
    title: "Compare",
    okLabel: "Compare",
    body: [field("Compare with", select)],
    check: () => {
      const picked = choices[Number(select.value)];
      // the file picker opens from the dialog's own submit, which the browser allows
      if (picked.file) pick.file = pickFile();
      return { value: picked };
    },
  });
  if (!choice) return;

  let label = choice.label;
  let bytes: Uint8Array | null;
  if (choice.file) {
    const file = pick.file ? await pick.file : null;
    if (!file) return;
    label = file.name;
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    bytes = choice.fetch ? await choice.fetch() : null;
  }
  if (bytes) await startCompare({ label, bytes });
}

/** Reads both drawings, works out what changed and makes the ghosts the overlay draws. */
function compareBytes(now: Uint8Array, other: CompareWith): State {
  const nowUnits = readUnits(now);
  const otherUnits = readUnits(other.bytes);
  // from the other version to Now: what is only in Now is added
  const diff = diffUnits(otherUnits, nowUnits);
  const ghosts: Partial<Record<GhostKind, Ghost>> = {};
  const addedIds = objectIds(diff.added);
  if (addedIds.size > 0) ghosts.added = ghostOf(openVwx(keepOnly(nowUnits, addedIds), "compare.vwx").doc);
  const changedIds = objectIds(diff.changed);
  if (changedIds.size > 0) ghosts.changed = ghostOf(openVwx(keepOnly(nowUnits, changedIds), "compare.vwx").doc);
  const removedIds = objectIds(diff.removed);
  if (removedIds.size > 0) ghosts.removed = ghostOf(openVwx(keepOnly(otherUnits, removedIds), "compare.vwx").doc);
  const objects = [...diff.added, ...diff.changed, ...diff.removed].filter((i) => i.what === "object");
  return { other, diff, objects, ghosts, fade: true, onion: 0, stale: false, sig: "", onionSig: null, lines: null };
}

/** The ids of the object changes in `items`. */
function objectIds(items: readonly DiffItem[]): Set<string> {
  return new Set(items.filter((i) => i.what === "object").map((i) => i.id));
}

/** A ghost for a drawing: its own scene and view, drawn by the editor's renderer. */
function ghostOf(doc: VwxDocument): Ghost {
  const canvas = document.createElement("canvas");
  const scene = new Scene();
  const view = new View();
  scene.setDocument(doc);
  return { scene, view, canvas, renderer: new Renderer(canvas, view, scene, NO_TOOLS), tinted: document.createElement("canvas") };
}

/** Lets a comparison's ghosts go, so their drawings can be collected. */
function disposeState(s: State): void {
  for (const ghost of Object.values(s.ghosts)) ghost?.scene.setDocument(null);
}

/** What the ghosts depend on: the view, the canvas size and the layer and class display. */
function signature(ctx: AppContext, p: Painter): string {
  const v = ctx.view;
  return [v.cx, v.cy, v.scale, v.rotation, p.width, p.height, store.activeLayerId, store.layerMode, store.classMode].join();
}

/** Draws the comparison over the drawing: the fade, the ghosts and the change boxes. */
function drawCompare(p: Painter): void {
  const s = state;
  const ctx = appContext();
  if (!s || !ctx) return;
  const g = p.ctx;
  if (s.fade) {
    g.save();
    g.globalAlpha = FADE_ALPHA;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, p.width, p.height);
    g.restore();
  }
  const sig = signature(ctx, p);
  const viewCurrent = s.sig === sig;
  const onionCurrent = s.onion === 0 || s.onionSig === sig;
  if (viewCurrent) {
    const onion = s.ghosts.onion;
    if (s.onion > 0 && onionCurrent && onion) {
      g.save();
      g.globalAlpha = s.onion;
      g.drawImage(onion.canvas, 0, 0, p.width, p.height);
      g.restore();
    }
    for (const kind of ["removed", "changed", "added"] as const) {
      const ghost = s.ghosts[kind];
      if (ghost) g.drawImage(ghost.tinted, 0, 0, p.width, p.height);
    }
  }
  if (!viewCurrent || !onionCurrent) schedule(sig, p.width, p.height);
  drawBoxes(g, s, ctx, p);
}

/** Draws the ghosts at `sig` once the view has been still for a moment: a pan or zoom sends many frames. */
function schedule(sig: string, width: number, height: number): void {
  if (timer !== 0 && pendingSig === sig) return;
  window.clearTimeout(timer);
  pendingSig = sig;
  timer = window.setTimeout(() => {
    timer = 0;
    const ctx = appContext();
    if (!state || !ctx) return;
    paintGhosts(sig, width, height);
    ctx.requestDraw();
  }, PAINT_DELAY);
}

/**
 * Draws the ghosts for the view as it is. When only the onion skin is out of date the changes are
 * kept, and the editor's settings it borrows (selection, grid) are put back afterwards.
 */
function paintGhosts(sig: string, width: number, height: number): void {
  const s = state;
  const ctx = appContext();
  if (!s || !ctx) return;
  const v = ctx.view;
  const onlyOnion = s.sig === sig;
  const kinds: readonly GhostKind[] = onlyOnion ? ["onion"] : ["removed", "changed", "added", "onion"];
  const dpr = window.devicePixelRatio || 1;
  const saved = {
    selection: store.selection,
    preselect: store.preselect,
    editGroupId: store.editGroupId,
    editVertex: store.editVertex,
    showGrid: store.showGrid,
  };
  try {
    store.selection = NONE;
    store.preselect = null;
    store.editGroupId = null;
    store.editVertex = null;
    store.showGrid = false;
    for (const kind of kinds) {
      if (kind === "onion") {
        if (s.onion === 0) continue;
        // the other version is only parsed once the onion skin is first used
        s.ghosts.onion ??= ghostOf(openVwx(s.other.bytes, "compare.vwx").doc);
      }
      const ghost = s.ghosts[kind];
      if (!ghost) continue;
      ghost.view.rotation = v.rotation;
      ghost.view.pivot = { ...v.pivot };
      ghost.view.insets = { ...v.insets };
      ghost.view.setSize(width, height);
      ghost.view.setCenterAndScale(v.cx, v.cy, v.scale);
      ghost.renderer.renderNow(width, height, dpr);
      if (kind !== "onion") tint(ghost, COLOUR[kind]);
    }
  } finally {
    Object.assign(store, saved);
  }
  if (!onlyOnion) s.sig = sig;
  s.onionSig = s.onion > 0 ? sig : null;
}

/** Turns a ghost's ink into `colour` and its paper clear, so it lies over the drawing. */
function tint(ghost: Ghost, colour: string): void {
  const { canvas, tinted } = ghost;
  const w = canvas.width;
  const ht = canvas.height;
  if (w === 0 || ht === 0) return;
  const src = canvas.getContext("2d");
  const out = tinted.getContext("2d");
  if (!src || !out) return;
  tinted.width = w;
  tinted.height = ht;
  const img = src.getImageData(0, 0, w, ht);
  const px = img.data;
  const [R, G, B] = rgb(colour);
  for (let i = 0; i < px.length; i += 4) {
    // the darker the ink, the more of the colour; the paper comes out clear
    const dark = 255 - Math.min(px[i], px[i + 1], px[i + 2]);
    px[i] = R;
    px[i + 1] = G;
    px[i + 2] = B;
    px[i + 3] = dark < 8 ? 0 : Math.min(255, dark * 2);
  }
  out.putImageData(img, 0, 0);
}

/** A #rrggbb colour as its three channels. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Boxes each change on the active layer (on every layer in the show-others modes), up to BOX_CAP. */
function drawBoxes(g: CanvasRenderingContext2D, s: State, ctx: AppContext, p: Painter): void {
  const allLayers = store.layerMode === "show-others" || store.layerMode === "modify-others";
  const active = store.activeLayerId;
  g.save();
  g.lineWidth = 1.5;
  let drawn = 0;
  for (const item of s.objects) {
    if (drawn >= BOX_CAP) break;
    if (item.layerId === null || (!allLayers && item.layerId !== active)) continue;
    const box = boxOf(s, ctx, item);
    if (!box) continue;
    const a = p.toScreen({ x: box.x0, y: box.y1 });
    const z = p.toScreen({ x: box.x1, y: box.y0 });
    g.strokeStyle = COLOUR[item.kind];
    g.setLineDash(item.kind === "removed" ? [4, 3] : []);
    g.strokeRect(Math.min(a.x, z.x) - 3, Math.min(a.y, z.y) - 3, Math.abs(z.x - a.x) + 6, Math.abs(z.y - a.y) + 6);
    drawn++;
  }
  g.restore();
}

/** A change's bounds in the drawing it is drawn from: the scene's when it has them, else the stored ones. */
function boxOf(s: State, ctx: AppContext, item: DiffItem): BBox | null {
  if (item.layerId === null) return item.bounds;
  const scene = item.kind === "removed" ? s.ghosts.removed?.scene : ctx.scene;
  const found = scene ? entryBox(scene, item.kind === "removed" ? "removed" : "now", item.layerId, item.id) : undefined;
  return found ?? item.bounds;
}

/** An object's scene bounds on a layer, from a map built once for each list of entries. */
function entryBox(scene: Scene, which: string, layerId: string, id: string): BBox | null | undefined {
  const entries = scene.topLevelEntries(layerId);
  const key = `${which}|${layerId}`;
  let hit = boxIndex.get(key);
  if (!hit || hit.from !== entries) {
    hit = { from: entries, byId: new Map<string, BBox | null>(entries.map((e): [string, BBox | null] => [e.id, e.bbox])) };
    boxIndex.set(key, hit);
  }
  return hit.byId.get(id);
}

/** A click on a change in the list: an object is selected and zoomed to; a removed one zooms to its ghost. */
function reveal(item: DiffItem): void {
  const ctx = appContext();
  const s = state;
  if (!ctx || !s || item.what !== "object" || item.layerId === null) return;
  if (item.kind !== "removed") {
    if (store.session?.doc.object(item.id)) selectAndZoom(ctx, item.layerId, [item.id]);
    return;
  }
  if (ctx.scene.layer(item.layerId)) setActiveLayer(item.layerId);
  const box = boxOf(s, ctx, item);
  if (!box) return;
  ctx.view.fit(box, 0.3);
  store.emit("view");
  ctx.requestDraw();
}

/** Writes the palette from the comparison as it is now (nothing when there is none). */
function renderPalette(): void {
  const s = state;
  if (!s) {
    body.replaceChildren(h("p", { cls: "br-note", text: "Not comparing. Use File › Branches › Compare… to compare two drawings." }));
    return;
  }
  const d = s.diff;
  const same = d.added.length + d.changed.length + d.removed.length === 0;
  body.replaceChildren(
    h("h3", { cls: "br-title", text: `Now ⟷ ${s.other.label}` }),
    ...(s.stale ? [staleRow(s)] : []),
    h(
      "div",
      { cls: "br-counts" },
      countChip("added", "Added", d.added.length),
      countChip("changed", "Changed", d.changed.length),
      countChip("removed", "Removed", d.removed.length),
    ),
    h("p", { cls: "br-note", text: same ? "No differences: the two drawings look the same." : `${d.unchanged} objects unchanged.` }),
    fadeRow(s),
    onionRow(s),
    changeList(s),
    h("div", { cls: "br-foot" }, stopButton()),
  );
}

/** The notice that the drawing changed since the comparison, with a Refresh button. */
function staleRow(s: State): HTMLElement {
  const refresh = h("button", { cls: "btn small", text: "Refresh", attrs: { type: "button" } });
  refresh.addEventListener("click", () => void startCompare(s.other));
  return h("div", { cls: "br-notice" }, h("span", { cls: "br-notice-text" }, h("strong", { text: "Out of date. " }), "The drawing changed since this comparison."), refresh);
}

/** A count of one kind of change, in its colour. */
function countChip(kind: Kind, label: string, n: number): HTMLElement {
  return h("span", { cls: `br-count br-kind-${kind}` }, h("span", { cls: `br-dot br-kind-${kind}` }), `${label} ${n}`);
}

/** The "Fade unchanged" check box. */
function fadeRow(s: State): HTMLElement {
  const box = h("input", { attrs: { type: "checkbox" }, checked: s.fade });
  box.addEventListener("change", () => {
    if (state !== s) return;
    s.fade = box.checked;
    appContext()?.requestDraw();
  });
  return h("label", { cls: "br-check" }, box, h("span", { text: "Fade unchanged" }));
}

/** The onion skin's slider: Now at the left, the other version at the right. */
function onionRow(s: State): HTMLElement {
  const slider = h("input", {
    cls: "br-slider",
    value: String(Math.round(s.onion * 100)),
    attrs: { type: "range", min: "0", max: "100", step: "1", "aria-label": "Blend between Now and the other version" },
  });
  slider.addEventListener("input", () => {
    if (state !== s) return;
    s.onion = Number(slider.value) / 100;
    appContext()?.requestDraw();
  });
  return h("div", { cls: "br-onion" }, h("span", { text: "Now" }), slider, h("span", { cls: "br-onion-end", text: s.other.label }));
}

/** The footer's button that ends the comparison. */
function stopButton(): HTMLButtonElement {
  const btn = h("button", { cls: "btn", text: "Stop Comparing", attrs: { type: "button" } });
  btn.addEventListener("click", () => stopCompare());
  return btn;
}

/** The changes as groups: objects by layer, then by kind; then layers, classes, symbols and resources, and settings. */
function changeList(s: State): HTMLElement {
  const order = new Map<string, number>();
  (store.session?.doc.layers() ?? []).forEach((l, i) => order.set(l.id, i));
  const layers = new Map<string, { name: string; rank: number; types: Map<string, DiffItem[]> }>();
  for (const item of s.objects) {
    const key = item.layerId ?? "";
    let layer = layers.get(key);
    if (!layer) {
      // a layer only the other version has comes after the current ones
      layer = { name: item.layerName || "No layer", rank: order.get(key) ?? Number.MAX_SAFE_INTEGER, types: new Map() };
      layers.set(key, layer);
    }
    const list = layer.types.get(item.typeName);
    if (list) list.push(item);
    else layer.types.set(item.typeName, [item]);
  }

  const out: HTMLElement[] = [];
  const sorted = [...layers.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  for (const layer of sorted) {
    out.push(h("h4", { cls: "br-layer", text: layer.name }));
    const types = [...layer.types.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [typeName, items] of types) {
      out.push(group(`${typeTitle(typeName)}${items.length > 1 ? ` ×${items.length}` : ""}`, items, items.length <= OPEN_BELOW));
    }
  }

  const rest = [...s.diff.added, ...s.diff.changed, ...s.diff.removed].filter((i) => i.what !== "object");
  for (const { title, kinds } of OTHERS) {
    const items = rest.filter((i) => kinds.includes(i.what));
    if (items.length === 0) continue;
    out.push(group(`${title}${items.length > 1 ? ` ×${items.length}` : ""}`, items, false));
  }
  return h("div", { cls: "br-changes" }, ...out);
}

/** A collapsible group of change rows, up to LIST_CAP of them; its rows are made when it first opens. */
function group(title: string, items: readonly DiffItem[], open: boolean): HTMLElement {
  const rows = h("div", { cls: "br-group-rows" });
  const fill = (): void => {
    if (rows.childElementCount > 0) return;
    const shown = items.slice(0, LIST_CAP).map(rowOf);
    const more = items.length - shown.length;
    rows.append(...shown);
    if (more > 0) rows.append(h("p", { cls: "br-note", text: `…and ${more} more` }));
  };
  const det = h("details", { cls: "br-group", attrs: open ? { open: "" } : {} }, h("summary", { text: title }), rows);
  det.addEventListener("toggle", () => {
    if (det.open) fill();
  });
  if (open) fill();
  return det;
}

/** One change as a row: a dot in its colour, its label, and a note when it moved or was renamed. */
function rowOf(item: DiffItem): HTMLButtonElement {
  const notes = [item.moved ? "moved to another layer" : "", item.renamed ? "renamed" : ""].filter((t) => t !== "").join(", ");
  const btn = h(
    "button",
    { cls: "br-row", attrs: { type: "button", title: unitLabel(item) } },
    h("span", { cls: `br-dot br-kind-${item.kind}` }),
    h("span", { cls: "br-row-text", text: rowText(item) }),
    notes ? h("span", { cls: "br-row-note", text: `(${notes})` }) : null,
  );
  btn.addEventListener("click", () => reveal(item));
  return btn;
}

/** A change's label; an object's drops "on <layer>", since the list is grouped by layer. */
function rowText(item: DiffItem): string {
  const text = unitLabel(item);
  const tail = ` on ${item.layerName || "a layer"}`;
  return item.what === "object" && text.endsWith(tail) ? text.slice(0, -tail.length) : text;
}

/** A record type's name as a heading: "rounded-rectangle" reads "Rounded rectangle"; an unknown type reads "Object". */
function typeTitle(typeName: string): string {
  if (typeName.startsWith("type-")) return "Object";
  const words = typeName.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The 3D view: the changes boxed (added and changed by their 3D bounds, removed by their 2D bounds at ground level). */
function refresh3d(): void {
  const v = appContext()?.view3d();
  if (!v) return;
  const s = state;
  if (!s) {
    if (boxes3d) {
      v.setHighlightLines(null);
      boxes3d = false;
    }
    return;
  }
  // the 3D view is only asked for its boxes once it is on screen: finding them is a pass over the model
  if (!store.view3d) return;
  s.lines ??= boxesOf(v, s);
  v.setHighlightLines(null, undefined, s.lines);
  boxes3d = true;
}

/** The boxes of a comparison's changes, one colour each, for the 3D view. */
function boxesOf(v: View3D, s: State): Coloured[] {
  const edges: Record<Kind, number[]> = { added: [], changed: [], removed: [] };
  const seen: Record<Kind, number> = { added: 0, changed: 0, removed: 0 };
  const shown = s.objects.filter((item) => seen[item.kind]++ < BOX3D_CAP);
  // one pass over the model's faces for every box, not one per change
  const drawn = v.boundsEach(new Set(shown.filter((item) => item.kind !== "removed").map((item) => item.id)));
  for (const item of shown) {
    if (item.kind === "removed") {
      if (item.bounds) rectEdges(edges.removed, item.bounds);
      continue;
    }
    const b = drawn.get(item.id);
    if (b) boxEdges(edges[item.kind], b.min, b.max);
    else if (item.bounds) rectEdges(edges[item.kind], item.bounds);
  }
  return (["added", "changed", "removed"] as const).map((k) => ({ segments: Float32Array.from(edges[k]), color: parseInt(COLOUR[k].slice(1), 16) }));
}

/** The twelve edges of a box, six numbers each, added to `out`. */
function boxEdges(out: number[], min: readonly number[], max: readonly number[]): void {
  const corner = (i: number): [number, number, number] => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const a = corner(i);
      const b = corner(i | bit);
      out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }
}

/** The four edges of a plan rectangle at ground level, six numbers each, added to `out`. */
function rectEdges(out: number[], b: BBox): void {
  const pts: [number, number][] = [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ];
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % 4];
    out.push(p[0], p[1], 0, q[0], q[1], 0);
  }
}

/** A drawing's bytes at its head, or at one of its versions. */
function contentOf(fileId: string, versionId?: string): Promise<Uint8Array | null> {
  return cloudCall("Fetching…", "Compare", async () => (await files.content(fileId, versionId)).bytes);
}

/** A branch's common ancestor, the version it and Main last agreed on. */
function baseOf(branchId: string): Promise<Uint8Array | null> {
  return cloudCall("Fetching…", "Compare", () => branches.base(branchId));
}

/** The browser's file picker for a .vwx file; resolves with the file, or null when none is chosen. */
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h("input", { attrs: { type: "file", accept: ".vwx" }, hidden: true });
    const done = (file: File | null): void => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => done(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => done(null));
    document.body.append(input);
    input.click();
  });
}

renderPalette();
