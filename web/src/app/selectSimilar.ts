// Edit > Select Similar and the Select Similar tool's matching, as Vectorworks has them: objects
// match when they are the same in every attribute ticked in Select Similar Preferences, grouped as
// Vectorworks groups them (other, fill, pen, text, wall and slab, line end markers). Out of the box
// they match on kind and class, a symbol instance on its definition and a plug-in object on its
// plug-in, as this command always did. The scope is the active layer's top-level objects, or the
// children of the group being edited. The preferences are kept per browser.

import type { ObjectInfo, VwxDocument } from "../core/index.ts";
import { setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import "./selectSimilar.css";

type Criterion =
  | "type"
  | "class"
  | "symbol"
  | "plugin"
  | "fillStyle"
  | "fillFore"
  | "fillBack"
  | "fillOpacity"
  | "penStyle"
  | "penFore"
  | "penBack"
  | "lineWeight"
  | "penOpacity"
  | "font"
  | "textSize"
  | "textFace"
  | "textAlign"
  | "textStyle"
  | "wallStyle"
  | "thickness"
  | "markers";

interface CriterionDef {
  readonly id: Criterion;
  readonly label: string;
  /** what the object has of it, or null when it has none of it (a rectangle's font) */
  value(doc: VwxDocument, o: ObjectInfo): string | null;
}

const WALL = 68;
const SLAB_PART = 71;
const PLUGIN = 86;
const KEY = "openvwx.selectSimilar.v1";
const DEFAULTS: readonly Criterion[] = ["type", "class", "symbol", "plugin"];
/** an object without the attribute matches others without it */
const NONE = "∅";

const num = (v: number): string => String(Math.round(v * 1e6) / 1e6);
const attr = (f: (a: NonNullable<ObjectInfo["attrs"]>) => string) => (_: VwxDocument, o: ObjectInfo) => (o.attrs ? f(o.attrs) : null);
const text = (f: (s: NonNullable<ObjectInfo["shape"]>) => string) => (_: VwxDocument, o: ObjectInfo) => (o.shape?.kind === "text" ? f(o.shape) : null);
/** a wall's or a slab's thickness and style, when `o` is one */
function build(doc: VwxDocument, o: ObjectInfo): { style: string | null; thickness: number } | null {
  if (o.type === WALL) return doc.wall(o.id);
  if (o.type === SLAB_PART || o.type === PLUGIN) return doc.slab(o.id);
  return null;
}

const GROUPS: readonly { readonly label: string; readonly criteria: readonly CriterionDef[] }[] = [
  {
    label: "Other attributes",
    criteria: [
      { id: "type", label: "Object type", value: (_, o) => `${o.type}:${o.kind}` },
      { id: "class", label: "Class", value: (_, o) => String(o.classIndex) },
      { id: "symbol", label: "Symbol definition", value: (_, o) => (o.kind === "symbol" ? String(o.symbol ?? "") : null) },
      { id: "plugin", label: "Plug-in object", value: (doc, o) => (o.type === PLUGIN ? (doc.records(o.id).find((r) => r.parametric)?.name ?? "") : null) },
    ],
  },
  {
    label: "Fill attributes",
    criteria: [
      { id: "fillStyle", label: "Fill style", value: attr((a) => String(a.fillPattern)) },
      { id: "fillFore", label: "Fill foreground colour", value: (doc, o) => (o.attrs ? doc.color(o.attrs.fillFore) : null) },
      { id: "fillBack", label: "Fill background colour", value: (doc, o) => (o.attrs ? doc.color(o.attrs.fillBack) : null) },
      { id: "fillOpacity", label: "Fill opacity", value: attr((a) => String(a.fillOpacity)) },
    ],
  },
  {
    label: "Pen attributes",
    criteria: [
      { id: "penStyle", label: "Pen style", value: attr((a) => String(a.lineStyle)) },
      { id: "penFore", label: "Pen foreground colour", value: (doc, o) => (o.attrs ? doc.color(o.attrs.penFore) : null) },
      { id: "penBack", label: "Pen background colour", value: (doc, o) => (o.attrs ? doc.color(o.attrs.penBack) : null) },
      { id: "lineWeight", label: "Line thickness", value: attr((a) => String(a.lineWeight)) },
      { id: "penOpacity", label: "Pen opacity", value: attr((a) => String(a.penOpacity)) },
    ],
  },
  {
    label: "Text attributes",
    criteria: [
      { id: "font", label: "Font", value: text((s) => String(s.fontIndex ?? "")) },
      { id: "textSize", label: "Size", value: text((s) => num(s.textSize ?? 0)) },
      { id: "textFace", label: "Style (bold, italic, underline)", value: text((s) => `${!!s.bold}${!!s.italic}${!!s.underline}`) },
      { id: "textAlign", label: "Alignment", value: text((s) => String(s.hAlign ?? 1)) },
      { id: "textStyle", label: "Text style", value: text((s) => String(s.textStyle ?? 0)) },
    ],
  },
  {
    label: "Wall and slab attributes",
    criteria: [
      { id: "wallStyle", label: "Style", value: (doc, o) => { const b = build(doc, o); return b ? (b.style ?? "") : null; } },
      { id: "thickness", label: "Thickness", value: (doc, o) => { const b = build(doc, o); return b ? num(b.thickness) : null; } },
    ],
  },
  {
    label: "Line end markers",
    criteria: [
      {
        id: "markers",
        label: "Markers (style and size)",
        value: (_, o) =>
          o.kind === "line" || o.kind === "arc" || o.kind === "polygon" || o.kind === "polyline" ? JSON.stringify([o.markers?.start ?? null, o.markers?.end ?? null]) : null,
      },
    ],
  },
];
const ALL: readonly CriterionDef[] = GROUPS.flatMap((g) => g.criteria);

let prefs: Set<Criterion> = loadPrefs();

function loadPrefs(): Set<Criterion> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(raw)) return new Set(ALL.map((c) => c.id).filter((id) => raw.includes(id)));
  } catch {
    // storage blocked or the entry unreadable: the defaults
  }
  return new Set(DEFAULTS);
}

function savePrefs(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...prefs]));
  } catch {
    // kept for this visit only
  }
}

/** What has to be the same for two objects to match: the ticked attributes' values. */
export function similarKey(doc: VwxDocument, o: ObjectInfo): string {
  return ALL.filter((c) => prefs.has(c.id))
    .map((c) => c.value(doc, o) ?? NONE)
    .join("\u0001");
}

/** The objects a Select Similar picks from: the edit scope's top-level ones. */
export function similarScope(doc: VwxDocument): ObjectInfo[] {
  const layerId = store.activeLayerId;
  if (!layerId) return [];
  const scope = store.editGroupId;
  return doc.objects(layerId).filter((o) => o.parentId === scope && !isDerivedId(o.id));
}

/** True when some attribute is ticked to match on; says so when none is. */
export function hasCriteria(): boolean {
  if (prefs.size > 0) return true;
  toast("Tick an attribute to match in Select Similar Preferences first.", "info");
  return false;
}

/** True when Select Similar has something to go on: one or more selected objects. */
export function canSelectSimilar(): boolean {
  return store.selection.size > 0;
}

/** Adds every object in the edit scope that matches a selected object to the selection, and says how many are selected. */
export function selectSimilar(): void {
  const doc = store.session?.doc;
  if (!doc || !store.activeLayerId || store.selection.size === 0 || !hasCriteria()) return;
  const selected = new Set<string>();
  for (const id of store.selection) {
    const o = doc.object(id);
    if (o) selected.add(similarKey(doc, o));
  }
  if (selected.size === 0) return;
  const next = new Set(store.selection);
  for (const o of similarScope(doc)) if (selected.has(similarKey(doc, o))) next.add(o.id);
  setSelection(next);
  const n = next.size;
  toast(`Selected ${n} ${n === 1 ? "object" : "objects"}`, "info");
}

/** The symbol definition the instance `id` places, or null when it isn't a symbol instance. */
function symbolOf(id: string): number | null {
  const o = store.session?.doc.object(id);
  return o?.kind === "symbol" && o.symbol !== undefined ? o.symbol : null;
}

export function isSymbolInstance(id: string): boolean {
  return symbolOf(id) !== null;
}

/** The object context menu's Select Objects of Same Symbol: every instance of the symbol `id` places, in Select Similar's scope. */
export function selectSameSymbol(id: string): void {
  const doc = store.session?.doc;
  const symbol = symbolOf(id);
  if (!doc || symbol === null) return;
  const ids = similarScope(doc)
    .filter((o) => o.kind === "symbol" && o.symbol === symbol)
    .map((o) => o.id);
  setSelection(ids.length ? ids : [id]);
  const n = Math.max(1, ids.length);
  toast(`Selected ${n} ${n === 1 ? "instance" : "instances"} of the symbol`, "info");
}

/** Select Similar Preferences: which attributes must match, a box each, grouped, with All for a group. */
export async function similarPrefsDialog(): Promise<void> {
  const boxes = new Map<Criterion, HTMLInputElement>();
  const groups = GROUPS.map((g) => {
    const all = h("input", { attrs: { type: "checkbox", "aria-label": `All ${g.label.toLowerCase()}` } });
    const own = g.criteria.map((c) => {
      const box = h("input", { checked: prefs.has(c.id), attrs: { type: "checkbox" } });
      boxes.set(c.id, box);
      return { c, box };
    });
    // All: ticked when every one is, a dash when some are; a click ticks or clears them all
    const sync = (): void => {
      const n = own.filter((x) => x.box.checked).length;
      all.checked = n === own.length;
      all.indeterminate = n > 0 && n < own.length;
    };
    all.addEventListener("change", () => {
      for (const x of own) x.box.checked = all.checked;
      sync();
    });
    for (const x of own) x.box.addEventListener("change", sync);
    sync();
    return h(
      "fieldset",
      { cls: "similar-group" },
      h("label", { cls: "menu-dialog-check similar-all" }, all, g.label),
      ...own.map((x) => h("label", { cls: "menu-dialog-check similar-item" }, x.box, x.c.label)),
    );
  });
  const chosen = await showDialog<Set<Criterion>>({
    title: "Select Similar Preferences",
    okLabel: "OK",
    cls: "similar-dialog",
    body: [h("p", { cls: "muted", text: "Objects are similar when they are the same in every attribute ticked." }), h("div", { cls: "similar-groups" }, ...groups)],
    check: () => {
      const on = new Set([...boxes].filter(([, b]) => b.checked).map(([id]) => id));
      return on.size ? { value: on } : { error: "Tick at least one attribute to match." };
    },
  });
  if (!chosen) return;
  prefs = chosen;
  savePrefs();
}
