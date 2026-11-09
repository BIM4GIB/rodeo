// Navigation > Resources: the drawing's library (symbols, textures, hatches,
// materials, styles, ...) as tiles grouped by folder, each with a thumbnail and
// its name; the title bar's menu shows them as small, medium or large thumbnails
// or as a list (kept in this browser). A kind filter and a search box narrow the list. Choosing a symbol
// makes it the definition the Symbol tool places; choosing any other resource shows
// it larger in a detail area. The helpers at the top are shared with the Symbol tool
// (its placement ghost) and Object Info (the definition an instance shows).
// A right-click on a tile renames the resource, and edits, duplicates or deletes a symbol, hatch,
// gradient, line type or text style; it edits or deletes a worksheet or a data record format, or
// makes a new record format, hatch, gradient, line type or text style. A double-click edits a
// worksheet, record format, hatch, gradient, line type or text style, and the toolbar's + makes a
// new one of those. Locate in Resource Manager (an object's right-click menu) selects a tile here.

import type { BBox, ResourceInfo, ResourceKind, Shape, SymbolInfo, VwxDocument } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import { h } from "../dom.ts";
import { unionBBox } from "../geom.ts";
import { menuButton, openContextMenu, type Row } from "../menu.ts";
import { confirmDialog, showDialog } from "../menubar.ts";
import { editSymbol } from "../symbolEdit.ts";
import { editWorksheet } from "../worksheetEditor.ts";
import { editRecordFormat, newRecordFormat } from "../recordFormatEditor.ts";
import { duplicateHatch, editHatch, newHatch } from "../hatchEditor.ts";
import { duplicateGradient, editGradient, newGradient } from "../gradientEditor.ts";
import { canEditLineType, duplicateLineType, editLineType, newLineType } from "../lineTypeEditor.ts";
import { canEditTextStyle, duplicateTextStyle, editTextStyle, newTextStyle } from "../textStyleEditor.ts";
import { importResources } from "../resourceImport.ts";
import { setResourceLocator } from "../locateResource.ts";
import { buildGeom, shapeBBox } from "../shapes.ts";
import { store, type ToolId } from "../state.ts";
import { formatLength } from "../units.ts";
import "./resources.css";

/** A definition's outline in symbol coordinates (y up), with its bounds. */
export interface SymbolGeometry {
  readonly path: Path2D;
  readonly bbox: BBox | null;
}

// Per-document caches. Definitions change only in whole-document ("all") changes: Create
// Symbol, a resource's rename, a definition's duplicate or delete, and their undo. The panel
// drops the definition list on those; a definition's shapes never change under its index.
const defsCache = new WeakMap<VwxDocument, readonly SymbolInfo[]>();
const shapesCache = new WeakMap<VwxDocument, Map<number, readonly Shape[]>>();
const geomCache = new WeakMap<VwxDocument, Map<number, SymbolGeometry>>();

/** The per-document map of `cache`, created on first use. */
function mapFor<T>(cache: WeakMap<VwxDocument, Map<number, T>>, doc: VwxDocument): Map<number, T> {
  let m = cache.get(doc);
  if (!m) {
    m = new Map<number, T>();
    cache.set(doc, m);
  }
  return m;
}

/** Definitions in list order: by folder ("" first), then by name. */
export function symbolDefsOf(doc: VwxDocument): readonly SymbolInfo[] {
  let defs = defsCache.get(doc);
  if (!defs) {
    defs = doc.symbolDefs();
    defsCache.set(doc, defs);
  }
  return defs;
}

/** Geometry of one definition in symbol coordinates (the insertion point is 0,0). */
export function symbolShapesOf(doc: VwxDocument, index: number): readonly Shape[] {
  const m = mapFor(shapesCache, doc);
  let shapes = m.get(index);
  if (!shapes) {
    shapes = doc.symbolShapes(index);
    m.set(index, shapes);
  }
  return shapes;
}

/** Outline of a definition as one Path2D in symbol coordinates. Text and images are drawn as their bounds. */
export function symbolGeometry(doc: VwxDocument, index: number): SymbolGeometry {
  const m = mapFor(geomCache, doc);
  let geom = m.get(index);
  if (!geom) {
    const path = new Path2D();
    let bbox: BBox | null = null;
    for (const s of symbolShapesOf(doc, index)) {
      const b = shapeBBox(s);
      bbox = unionBBox(bbox, b);
      if (s.kind === "text" || s.kind === "image") {
        if (b) path.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      } else {
        const stroke = buildGeom(s).path;
        if (stroke) path.addPath(stroke);
      }
    }
    geom = { path, bbox };
    m.set(index, geom);
  }
  return geom;
}

/** Name of a definition, for messages. */
export function symbolNameOf(doc: VwxDocument, index: number): string {
  return symbolDefsOf(doc).find((d) => d.index === index)?.name ?? `Symbol ${index}`;
}

/** Items grouped by folder name, in list order ("" = top level, first). */
export function groupByFolder<T extends { readonly folder: string }>(items: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const d of items) {
    const list = out.get(d.folder);
    if (list) list.push(d);
    else out.set(d.folder, [d]);
  }
  return out;
}

/** Filter label of each resource kind; the filter lists the kinds in this order. */
export const KIND_LABEL: Readonly<Record<ResourceKind, string>> = {
  symbol: "Symbols",
  texture: "Textures",
  hatch: "Hatches",
  tile: "Tiles",
  gradient: "Gradients",
  "image-fill": "Image fills",
  material: "Materials",
  "wall-style": "Wall styles",
  "slab-style": "Slab styles",
  "roof-style": "Roof styles",
  "line-type": "Line types",
  "text-style": "Text styles",
  "render-style": "Render styles",
  background: "Backgrounds",
  worksheet: "Worksheets",
  "record-format": "Record formats",
};
const KINDS = Object.keys(KIND_LABEL) as ResourceKind[];

// ---- thumbnails and pick --------------------------------------------------

/** How the palette shows resources, as Vectorworks' Resource Manager can. */
type ResourceView = "small" | "medium" | "large" | "list";

/** Each view and the size of its thumbnail box, CSS pixels with the 1 px frame. */
const VIEWS: readonly { readonly id: ResourceView; readonly label: string; readonly px: number }[] = [
  { id: "small", label: "Small Thumbnails", px: 44 },
  { id: "medium", label: "Medium Thumbnails", px: 64 },
  { id: "large", label: "Large Thumbnails", px: 96 },
  { id: "list", label: "List", px: 28 },
];
const VIEW_KEY = "openvwx.resview";

function readView(): ResourceView {
  try {
    const kept = localStorage.getItem(VIEW_KEY);
    return VIEWS.find((v) => v.id === kept)?.id ?? "medium";
  } catch {
    return "medium";
  }
}

let resourceView = readView();
const viewListeners = new Set<() => void>();
document.documentElement.dataset.resView = resourceView;

function setResourceView(next: ResourceView): void {
  resourceView = next;
  document.documentElement.dataset.resView = next;
  try {
    if (next === "medium") localStorage.removeItem(VIEW_KEY);
    else localStorage.setItem(VIEW_KEY, next);
  } catch {
    // storage blocked: the view lasts for this visit only
  }
  for (const fn of viewListeners) fn();
}

/** The Resources palette's own title bar rows: the thumbnail sizes and the list. */
export function resourceViewRows(): Row[] {
  return VIEWS.map((v): Row => ({ label: v.label, checked: () => resourceView === v.id, run: () => setResourceView(v.id) }));
}

/** Drawing box of a symbol thumbnail in the current view, CSS pixels inside the frame. */
function thumbPx(): number {
  return (VIEWS.find((v) => v.id === resourceView)?.px ?? 64) - 2;
}
const THUMB_INK = "#1d1d1f";
const THUMB_PAPER = "#fcfcfb";

/** Strokes a definition fitted into the thumbnail box, one CSS pixel wide. */
function drawThumb(canvas: HTMLCanvasElement, geom: SymbolGeometry): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const box = thumbPx();
  // the margin kept round the drawing: less in the list's small boxes
  const pad = box < 40 ? 2 : 4;
  const px = Math.round(box * dpr);
  if (canvas.width !== px) canvas.width = px;
  if (canvas.height !== px) canvas.height = px;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = THUMB_PAPER;
  ctx.fillRect(0, 0, px, px);
  const b = geom.bbox;
  if (!b) return;
  // fit the bounds into the box; a single point keeps scale 1
  const avail = box - 2 * pad;
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const fit = Math.min(bw > 0 ? avail / bw : Infinity, bh > 0 ? avail / bh : Infinity);
  const k = Number.isFinite(fit) ? fit : 1;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  // document (y up) to device pixels (y down), centred in the box
  ctx.setTransform(dpr * k, 0, 0, -dpr * k, dpr * (box / 2 - k * cx), dpr * (box / 2 + k * cy));
  ctx.lineWidth = 1 / k;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = THUMB_INK;
  ctx.stroke(geom.path);
}

/** Chooses a definition for the Symbol tool and switches to that tool. */
function pick(index: number, setTool: (id: ToolId) => void): void {
  store.activeSymbol = index;
  store.emit("symbol");
  setTool("symbol");
}

/** The MIME type for stored image bytes: the record's own, else guessed from the signature (JPEG or PNG). */
function imageMime(bytes: Uint8Array, mime: string): string {
  if (mime) return mime;
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "image/png";
}

/** A length given in millimetres, as text in the drawing's units. */
function sizeText(mm: number, units: string | undefined): string {
  return formatLength(mm, units);
}

// ---- panel ----------------------------------------------------------------

/** One resource tile: a symbol definition or any other library resource. */
interface Entry {
  readonly kind: ResourceKind;
  /** name-table index: the definition of a symbol, else the resource's own index */
  readonly index: number;
  readonly name: string;
  readonly folder: string;
  /** the library record of a non-symbol resource; null for a symbol */
  readonly res: ResourceInfo | null;
  readonly el: HTMLButtonElement;
}

interface Group {
  readonly folder: string;
  /** the element hidden when the group has no match */
  readonly el: HTMLElement;
  /** the tile grid; hidden while the folder is collapsed */
  readonly body: HTMLElement;
  readonly entries: readonly Entry[];
  /** the folder header; absent for the top level, which has none */
  readonly head?: {
    readonly button: HTMLButtonElement;
    readonly caret: HTMLElement;
    readonly count: HTMLElement;
  };
}

export function mountResources(root: HTMLElement, setTool: (id: ToolId) => void): void {
  const search = h("input", {
    cls: "search",
    attrs: { type: "search", placeholder: "Search resources", "aria-label": "Search resources" },
  });
  const kindSelect = h("select", { cls: "res-kind", attrs: { "aria-label": "Resource kind" } });
  // New Resource: each kind a new one can be copied from the drawing's own (a first gradient comes from a hatch)
  const has = (...kinds: ResourceKind[]): boolean => !!doc?.resources().some((r) => kinds.includes(r.kind));
  const newButton = menuButton(h("button", { cls: "btn res-new", text: "+", title: "New resource", attrs: { type: "button", "aria-label": "New resource" } }), () => [
    { label: "New Hatch…", enabled: () => has("hatch"), run: () => void newHatch() },
    { label: "New Gradient…", enabled: () => has("gradient", "hatch"), run: () => void newGradient() },
    { label: "New Line Type…", enabled: () => has("line-type"), run: () => void newLineType() },
    { label: "New Text Style…", enabled: () => has("text-style", "hatch", "gradient"), run: () => void newTextStyle() },
    { label: "New Record Format…", enabled: () => has("record-format"), run: () => void newRecordFormat() },
    "-",
    { label: "Import from Another File…", enabled: () => !!doc, run: () => void importResources() },
  ]);
  const detailImg = h("div", { cls: "res-detail-img" });
  const detailName = h("div", { cls: "res-detail-name" });
  const detailMeta = h("div", { cls: "res-meta" });
  const detail = h(
    "div",
    { cls: "res-detail", hidden: true },
    detailImg,
    h("div", { cls: "res-detail-text" }, detailName, detailMeta),
  );
  const list = h("div", { cls: "list" });
  const noMatch = h("div", { cls: "empty", text: "No matches", hidden: true });
  root.replaceChildren(h("div", { cls: "toolbar" }, search, kindSelect, newButton), detail, list);

  /** the document the list was built for; undefined before the first sync */
  let doc: VwxDocument | null | undefined = undefined;
  let groups: Group[] = [];
  let entries: Entry[] = [];
  /** draws a thumbnail once its tile scrolls into view */
  let pending = new Map<Element, () => void>();
  /** symbol thumbnails drawn so far, redrawn at the new size when the view changes */
  let drawn = new Map<HTMLCanvasElement, () => void>();
  let io: IntersectionObserver | null = null;
  /** Blob URLs of thumbnails, released when the list is rebuilt */
  let urls: string[] = [];
  /** the non-symbol resource the detail area shows */
  let current: Entry | null = null;
  /** Blob URL of the detail picture */
  let detailUrl: string | null = null;
  /** folders the user collapsed */
  const collapsed = new Set<string>();

  /** A Blob URL for stored picture bytes, kept until the list is rebuilt. */
  const thumbUrl = (bytes: Uint8Array, mime: string): string => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: imageMime(bytes, mime) }));
    urls.push(url);
    return url;
  };

  /** Shows a resource larger in the detail area (a texture its tiled image), or hides the area. */
  const showDetail = (e: Entry | null): void => {
    if (detailUrl) URL.revokeObjectURL(detailUrl);
    detailUrl = null;
    const res = e?.res ?? null;
    if (!e || !res) {
      detail.hidden = true;
      detailImg.replaceChildren();
      return;
    }
    const picture = res.image
      ? { bytes: res.image, mime: res.imageMime ?? "" }
      : res.preview
        ? { bytes: res.preview, mime: res.previewMime }
        : null;
    if (picture) {
      const blob = new Blob([new Uint8Array(picture.bytes)], { type: imageMime(picture.bytes, picture.mime) });
      detailUrl = URL.createObjectURL(blob);
      detailImg.replaceChildren(h("img", { attrs: { alt: e.name, src: detailUrl } }));
    } else {
      detailImg.replaceChildren(h("span", { cls: "res-none", text: KIND_LABEL[e.kind] }));
    }
    detailName.textContent = e.name;
    const lines = [`Kind: ${KIND_LABEL[e.kind]}`, `Folder: ${e.folder || "Top level"}`];
    // the core leaves imageSize 0 when the file does not say how large the image is
    const size = res.imageSize ?? 0;
    if (size > 0) lines.push(`Tile size: ${sizeText(size, doc?.info.units)}`);
    detailMeta.replaceChildren(...lines.map((text) => h("div", { text })));
    detail.hidden = false;
  };

  /** Pressed state: the active symbol, or the resource the detail area shows. */
  const markPressed = (): void => {
    for (const e of entries) {
      const on = e.kind === "symbol" ? e.index === store.activeSymbol : e === current;
      e.el.setAttribute("aria-pressed", String(on));
    }
  };

  /** A symbol picks the Symbol tool's definition; any other resource shows in the detail area. */
  const choose = (e: Entry): void => {
    if (e.kind === "symbol") {
      current = null;
      showDetail(null);
      pick(e.index, setTool);
      return;
    }
    current = e;
    showDetail(e);
    markPressed();
  };

  /** One tile: its thumbnail, then the name. The thumbnail is drawn when the tile scrolls into view. */
  const tileOf = (fields: Omit<Entry, "el">, thumb: HTMLElement): Entry => {
    const el = h(
      "button",
      {
        cls: "res-tile",
        title: `${fields.name} (${KIND_LABEL[fields.kind]})`,
        attrs: { type: "button", "aria-pressed": "false" },
      },
      thumb,
      h("span", { cls: "res-label", text: fields.name, attrs: { translate: "no" } }),
      h("span", { cls: "res-kind-label", text: KIND_LABEL[fields.kind] }),
    );
    const entry: Entry = { ...fields, el };
    el.addEventListener("click", () => choose(entry));
    if (fields.kind === "worksheet") el.addEventListener("dblclick", () => void editWorksheet(fields.index));
    if (fields.kind === "record-format") el.addEventListener("dblclick", () => void (doc?.recordFormatFields(fields.index) && editRecordFormat(fields.index)));
    if (fields.kind === "hatch") el.addEventListener("dblclick", () => void editHatch(fields.index));
    if (fields.kind === "gradient") el.addEventListener("dblclick", () => void editGradient(fields.index));
    if (fields.kind === "line-type") el.addEventListener("dblclick", () => void editLineType(fields.index));
    if (fields.kind === "text-style") el.addEventListener("dblclick", () => void (canEditTextStyle(fields.index) && editTextStyle(fields.index)));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(tileMenu(entry), e.clientX, e.clientY);
    });
    return entry;
  };

  /** Asks for a resource's name, starting from `initial`; a name the drawing already uses (but `own`) is refused. */
  const askName = (title: string, okLabel: string, initial: string, own?: string): Promise<string | null> => {
    const d = doc;
    if (!d) return Promise.resolve(null);
    const taken = new Set([
      ...entries.map((e) => e.name),
      ...d.classes().map((c) => c.name),
      ...d.layers().map((l) => l.name),
    ]);
    const input = h("input", {
      cls: "menu-dialog-input",
      value: initial,
      attrs: { type: "text", "aria-label": "Name", spellcheck: "false" },
    });
    return showDialog<string>({
      title,
      okLabel,
      body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), input)],
      check: () => {
        const name = input.value.trim();
        if (!name) return { error: "Enter a name.", focus: input };
        if (name !== own && taken.has(name)) return { error: `"${name}" is already used in this drawing.`, focus: input };
        return { value: name };
      },
    });
  };

  /** Scrolls a symbol's tile into view and focuses it (a duplicate, once the list is rebuilt). */
  const reveal = (index: number): void => {
    const el = entries.find((e) => e.kind === "symbol" && e.index === index)?.el;
    el?.scrollIntoView({ block: "nearest" });
    el?.focus();
  };

  const rename = async (e: Entry): Promise<void> => {
    const name = await askName("Rename Resource", "Rename", e.name, e.name);
    if (name && name !== e.name) attempt("Rename", (s) => s.renameResource(e.index, name));
  };

  const duplicate = async (e: Entry): Promise<void> => {
    const base = e.name.replace(/-\d+$/, "");
    const taken = new Set(entries.map((x) => x.name));
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    const name = await askName("Duplicate Symbol", "Duplicate", `${base}-${n}`);
    if (!name) return;
    const r = attempt("Duplicate", (s) => s.duplicateSymbol(e.index, name));
    if (r) reveal(r.value);
  };

  const remove = async (e: Entry): Promise<void> => {
    if (e.kind === "record-format") {
      const ok = await confirmDialog("Delete Record Format", `Delete the record format "${e.name}"? Objects that have a record of it lose the record and its values.`, "Delete");
      if (ok) attempt("Delete", (s) => s.deleteRecordFormat(e.index));
      return;
    }
    if (e.kind === "worksheet") {
      if (await confirmDialog("Delete Worksheet", `Delete the worksheet "${e.name}"?`, "Delete")) attempt("Delete", (s) => s.deleteWorksheet(e.index));
      return;
    }
    if (e.kind === "hatch") {
      if (await confirmDialog("Delete Hatch", `Delete the hatch "${e.name}"?`, "Delete")) attempt("Delete", (s) => s.deleteHatch(e.index));
      return;
    }
    if (e.kind === "gradient") {
      if (await confirmDialog("Delete Gradient", `Delete the gradient "${e.name}"?`, "Delete")) attempt("Delete", (s) => s.deleteGradient(e.index));
      return;
    }
    if (e.kind === "line-type") {
      if (await confirmDialog("Delete Line Type", `Delete the line type "${e.name}"?`, "Delete")) attempt("Delete", (s) => s.deleteLineType(e.index));
      return;
    }
    if (e.kind === "text-style") {
      if (await confirmDialog("Delete Text Style", `Delete the text style "${e.name}"?`, "Delete")) attempt("Delete", (s) => s.deleteTextStyle(e.index));
      return;
    }
    if (!(await confirmDialog("Delete Symbol", `Delete the symbol definition "${e.name}"?`, "Delete"))) return;
    attempt("Delete", (s) => s.deleteSymbol(e.index));
  };

  /** A right-click on a tile: every resource renames; a symbol also places, duplicates and deletes; a worksheet, data record format, hatch, gradient, line type or text style edits and deletes. */
  const tileMenu = (e: Entry): Row[] => {
    const rows: Row[] = [{ label: "Rename…", run: () => void rename(e) }];
    if (e.kind === "worksheet") {
      return [{ label: "Edit Worksheet…", run: () => void editWorksheet(e.index) }, "-", ...rows, { label: "Delete…", run: () => void remove(e) }];
    }
    if (e.kind === "record-format" && doc?.recordFormatFields(e.index)) {
      return [
        { label: "Edit Record Format…", run: () => void editRecordFormat(e.index) },
        { label: "New Record Format…", run: () => void newRecordFormat() },
        "-",
        ...rows,
        { label: "Delete…", run: () => void remove(e) },
      ];
    }
    if (e.kind === "hatch") {
      return [
        { label: "Edit Hatch…", run: () => void editHatch(e.index) },
        { label: "New Hatch…", run: () => void newHatch() },
        "-",
        ...rows,
        { label: "Duplicate…", run: () => void duplicateHatch(e.index) },
        { label: "Delete…", run: () => void remove(e) },
      ];
    }
    if (e.kind === "gradient") {
      return [
        { label: "Edit Gradient…", run: () => void editGradient(e.index) },
        { label: "New Gradient…", run: () => void newGradient() },
        "-",
        ...rows,
        { label: "Duplicate…", run: () => void duplicateGradient(e.index) },
        { label: "Delete…", run: () => void remove(e) },
      ];
    }
    if (e.kind === "line-type") {
      // a line type whose dashes can't be read (a complex one, drawn with geometry) is only renamed and deleted
      const editable = canEditLineType(e.index);
      return [
        ...(editable ? [{ label: "Edit Line Type…", run: () => void editLineType(e.index) }] : []),
        { label: "New Line Type…", run: () => void newLineType() },
        "-",
        ...rows,
        ...(editable ? [{ label: "Duplicate…", run: () => void duplicateLineType(e.index) }] : []),
        { label: "Delete…", run: () => void remove(e) },
      ];
    }
    if (e.kind === "text-style") {
      const editable = canEditTextStyle(e.index);
      return [
        ...(editable ? [{ label: "Edit Text Style…", run: () => void editTextStyle(e.index) }] : []),
        { label: "New Text Style…", run: () => void newTextStyle() },
        "-",
        ...rows,
        ...(editable ? [{ label: "Duplicate…", run: () => void duplicateTextStyle(e.index) }] : []),
        { label: "Delete…", run: () => void remove(e) },
      ];
    }
    if (e.kind !== "symbol") return rows;
    return [
      { label: "Place with Symbol Tool", run: () => choose(e) },
      { label: "Edit Symbol", run: () => editSymbol(e.index) },
      "-",
      ...rows,
      { label: "Duplicate…", run: () => void duplicate(e) },
      { label: "Delete…", run: () => void remove(e) },
    ];
  };

  /** The kind filter lists "All" and each kind the drawing has, with counts. */
  const fillKinds = (): void => {
    const counts = new Map<ResourceKind, number>();
    for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    const keep = kindSelect.value;
    const options = [h("option", { text: `All (${entries.length})`, attrs: { value: "all" } })];
    for (const k of KINDS) {
      const n = counts.get(k);
      if (n) options.push(h("option", { text: `${KIND_LABEL[k]} (${n})`, attrs: { value: k } }));
    }
    kindSelect.replaceChildren(...options);
    kindSelect.value = keep === "all" || counts.has(keep as ResourceKind) ? keep : "all";
  };

  const applyFilter = (): void => {
    if (entries.length === 0) return;
    const q = search.value.trim().toLowerCase();
    const kind = kindSelect.value;
    const filtering = q !== "";
    let shown = 0;
    for (const g of groups) {
      let n = 0;
      for (const e of g.entries) {
        const on = (kind === "all" || e.kind === kind) && (!filtering || e.name.toLowerCase().includes(q));
        e.el.hidden = !on;
        if (on) n++;
      }
      shown += n;
      g.el.hidden = n === 0;
      if (g.head) {
        // a search opens every folder, so its matches are visible
        const open = filtering || !collapsed.has(g.folder);
        g.body.hidden = !open;
        g.head.button.setAttribute("aria-expanded", String(open));
        g.head.caret.textContent = open ? "▾" : "▸";
        g.head.count.textContent = String(n);
      }
    }
    noMatch.hidden = shown > 0;
  };

  const build = (): void => {
    io?.disconnect();
    io = null;
    pending = new Map();
    drawn = new Map();
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    groups = [];
    entries = [];
    current = null;
    showDetail(null);
    const d = doc ?? null;
    if (!d) {
      kindSelect.replaceChildren();
      list.replaceChildren(h("div", { cls: "empty", text: "No drawing open" }));
      return;
    }
    const built: Entry[] = [];
    for (const def of symbolDefsOf(d)) {
      const canvas = h("canvas", { attrs: { "aria-hidden": "true" } });
      const thumb = h("span", { cls: "res-thumb" }, canvas);
      pending.set(thumb, () => {
        const draw = (): void => drawThumb(canvas, symbolGeometry(d, def.index));
        drawn.set(canvas, draw);
        draw();
      });
      built.push(
        tileOf({ kind: "symbol", index: def.index, name: def.name, folder: def.folder, res: null }, thumb),
      );
    }
    for (const res of d.resources()) {
      if (res.kind === "symbol") continue;
      const thumb = h("span", { cls: "res-thumb" });
      if (res.preview) {
        const bytes = res.preview;
        const mime = res.previewMime;
        pending.set(thumb, () => {
          thumb.append(h("img", { attrs: { alt: "", decoding: "async", src: thumbUrl(bytes, mime) } }));
        });
      } else {
        thumb.append(h("span", { cls: "res-none", text: KIND_LABEL[res.kind] }));
      }
      built.push(tileOf({ kind: res.kind, index: res.index, name: res.name, folder: res.folder, res }, thumb));
    }
    if (built.length === 0) {
      kindSelect.replaceChildren();
      list.replaceChildren(h("div", { cls: "empty", text: "No resources" }));
      return;
    }
    entries = built.sort(
      (a, b) =>
        a.folder.localeCompare(b.folder) ||
        a.name.localeCompare(b.name) ||
        KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind),
    );
    // a thumbnail is drawn when its tile scrolls into view, so large libraries stay cheap
    io = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          if (!r.isIntersecting) continue;
          pending.get(r.target)?.();
          pending.delete(r.target);
          io?.unobserve(r.target);
        }
      },
      { root, rootMargin: "120px 0px" },
    );
    for (const el of pending.keys()) io.observe(el);

    for (const [folder, items] of groupByFolder(entries)) {
      const body = h("div", { cls: "res-grid" }, ...items.map((e) => e.el));
      if (folder === "") {
        groups.push({ folder, el: body, body, entries: items });
        continue;
      }
      const button = h("button", { cls: "res-folder", attrs: { type: "button" } });
      const caret = h("span", { cls: "res-caret", attrs: { "aria-hidden": "true" } });
      const count = h("span", { cls: "res-count" });
      button.append(caret, h("span", { cls: "res-name", text: folder }), count);
      button.addEventListener("click", () => {
        if (collapsed.has(folder)) collapsed.delete(folder);
        else collapsed.add(folder);
        applyFilter();
      });
      const el = h("div", { cls: "res-group" }, button, body);
      groups.push({ folder, el, body, entries: items, head: { button, caret, count } });
    }
    list.replaceChildren(...groups.map((g) => g.el), noMatch);
    fillKinds();
    applyFilter();
    markPressed();
  };

  let detach: (() => void) | null = null;

  /** Drops a chosen definition that no longer exists (deleted, or an undone Create Symbol or Duplicate). */
  const dropMissing = (d: VwxDocument | null): void => {
    if (store.activeSymbol === null) return;
    if (d && symbolDefsOf(d).some((def) => def.index === store.activeSymbol)) return;
    store.activeSymbol = null;
    store.emit("symbol");
  };

  /**
   * Follows the open drawing. The list is rebuilt when the document object changes
   * (a file was opened) and when its resources may have changed: Create Symbol, a
   * rename, duplicate or delete, and their undo are whole-document changes ("all");
   * other edits leave it alone.
   */
  const sync = (): void => {
    const next = store.session?.doc ?? null;
    if (next !== doc) {
      doc = next;
      detach?.();
      detach =
        store.session?.onChange((e) => {
          if (e.kind !== "all" || !doc) return;
          defsCache.delete(doc);
          dropMissing(doc);
          build();
        }) ?? null;
      // a definition index names a definition in one drawing only
      if (store.activeSymbol !== null) {
        store.activeSymbol = null;
        store.emit("symbol");
      }
      build();
    }
    markPressed();
  };

  // Locate in Resource Manager (locateResource.ts): the tile shown and selected, a symbol without
  // taking up the Symbol tool
  setResourceLocator((r) => {
    const e = entries.find((x) => x.kind === r.kind && x.index === r.index);
    if (!e) return false;
    search.value = "";
    kindSelect.value = "all";
    collapsed.delete(e.folder);
    applyFilter();
    if (e.kind === "symbol") {
      current = null;
      showDetail(null);
      store.activeSymbol = e.index;
      store.emit("symbol");
    } else {
      current = e;
      showDetail(e);
      markPressed();
    }
    e.el.scrollIntoView({ block: "nearest" });
    e.el.focus();
    return true;
  });
  search.addEventListener("input", applyFilter);
  kindSelect.addEventListener("change", applyFilter);
  store.on("session", sync);
  store.on("symbol", markPressed);
  viewListeners.add(() => {
    for (const draw of drawn.values()) draw();
  });
  sync();
}
