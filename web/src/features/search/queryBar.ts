// The Query Bar: a line under the top bar where a query (see query.ts) selects
// objects as it is typed. The matches are highlighted on the drawing and selected on
// their layer (the active layer when it has matches, else the first layer that does).
// Enter keeps the selection; Esc puts back the selection and layer there were before.
// A parse error is shown under the bar with a caret at its position.

import type { BBox } from "../../core/index.ts";
import { h } from "../../app/dom.ts";
import { setActiveLayer, setEditGroup } from "../../app/commands.ts";
import { appContext } from "../../app/ext.ts";
import type { Painter } from "../../app/tools.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { topLevelId } from "./describe.ts";
import { QUERY_ICON } from "./glyphs.ts";
import { runQuery, type QueryHit } from "./query.ts";

/** How long typing settles before the query runs again. */
const SETTLE_MS = 120;

/** The examples the help lists; a click puts one in the bar. */
const EXAMPLES: readonly string[] = [
  'text where text contains "fire"',
  'objects where class = "A-Wall" on "Ground Floor"',
  "rectangles where area > 10m2",
  'symbols where symbol startswith "Door"',
  "lines where length >= 1m and pen = #000000",
];

interface Snapshot {
  readonly layer: string | null;
  readonly edit: string | null;
  readonly selection: readonly string[];
}

interface Bar {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  readonly status: HTMLElement;
  readonly help: HTMLElement;
  readonly helpButton: HTMLButtonElement;
  readonly snap: Snapshot;
  timer: number;
  /** the last query in the bar parsed; Enter does not close the bar on an error */
  valid: boolean;
}

let bar: Bar | null = null;
/** the bounds of the matches, drawn over the drawing while the bar is open */
let boxes: readonly BBox[] = [];

/** Opens the Query Bar with `text` in it (run at once), or brings it to the front. */
export function openQuery(text = ""): void {
  if (bar) {
    bar.input.value = text;
    bar.input.focus();
    schedule(0);
    return;
  }
  const ctx = appContext();
  if (!ctx || !store.session) {
    toast("Open a drawing to select by query.", "info");
    return;
  }
  const input = h("input", {
    cls: "sx-query-input",
    attrs: {
      type: "text",
      spellcheck: "false",
      autocomplete: "off",
      "aria-label": "Query",
      placeholder: 'objects where class = "A-Wall" on "Ground Floor"',
    },
  });
  const status = h("div", { cls: "sx-query-status", attrs: { role: "status", "aria-live": "polite" } });
  const help = h("div", { cls: "sx-help", hidden: true }, ...helpNodes((example) => {
    input.value = example;
    input.focus();
    schedule(0);
  }));
  const helpButton = h("button", { cls: "sx-query-btn", text: "?", attrs: { type: "button", title: "How queries work", "aria-expanded": "false" } });
  const keep = h("button", { cls: "sx-query-btn primary", text: "Select", attrs: { type: "button", title: "Keep the selection (Enter)" } });
  const back = h("button", { cls: "sx-query-btn", text: "×", attrs: { type: "button", title: "Put the selection back (Esc)", "aria-label": "Close query" } });
  const root = h(
    "div",
    { cls: "sx-query", attrs: { role: "dialog", "aria-label": "Select by query" } },
    h("div", { cls: "sx-query-row" }, h("span", { cls: "sx-query-icon", html: QUERY_ICON }), input, helpButton, keep, back),
    status,
    help,
  );
  document.body.append(root);
  const snap: Snapshot = {
    layer: store.activeLayerId,
    edit: store.editGroupId,
    selection: [...store.selection],
  };
  bar = { root, input, status, help, helpButton, snap, timer: 0, valid: true };

  input.addEventListener("input", () => schedule(SETTLE_MS));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      keepSelection();
    } else if (e.key === "Escape") {
      e.preventDefault();
      putBack();
    }
  });
  keep.addEventListener("click", keepSelection);
  back.addEventListener("click", putBack);
  helpButton.addEventListener("click", () => {
    if (!bar) return;
    const open = bar.help.hidden;
    bar.help.hidden = !open;
    helpButton.setAttribute("aria-expanded", String(open));
  });
  input.value = text;
  if (text) schedule(0);
  else showHint(status);
  input.focus();
}

function showHint(status: HTMLElement): void {
  status.classList.remove("error");
  status.textContent = "Enter keeps the selection · Esc puts it back · ? lists the grammar";
}

/** Runs the query after a pause (at once for 0). */
function schedule(ms: number): void {
  if (!bar) return;
  window.clearTimeout(bar.timer);
  bar.timer = window.setTimeout(() => run(), ms);
}

/** Runs the query in the bar and shows what it found, selecting the matches on their layer. */
function run(): void {
  const b = bar;
  const ctx = appContext();
  const doc = store.session?.doc;
  if (!b || !ctx || !doc) return;
  const text = b.input.value;
  b.valid = true;
  if (text.trim() === "") {
    boxes = [];
    showHint(b.status);
    select(null, []);
    ctx.requestDraw();
    return;
  }
  const out = runQuery(doc, text, { visible: (o) => ctx.scene.isObjectVisible(o) });
  if (!out.ok) {
    b.valid = false;
    boxes = [];
    b.status.classList.add("error");
    b.status.replaceChildren(
      h("div", { cls: "sx-query-error", text: `${out.error} (position ${out.pos + 1})` }),
      h("pre", { cls: "sx-caret", text: `${text}\n${" ".repeat(out.pos)}^` }),
    );
    select(null, []);
    ctx.requestDraw();
    return;
  }
  const hits = out.run.hits;
  const layer = targetLayer(hits);
  boxes = hits.flatMap((hit) => (hit.bbox ? [hit.bbox] : []));
  const onLayer = layer === null ? [] : hits.filter((hit) => hit.layerId === layer);
  select(layer, [...new Set(onLayer.map((hit) => topLevelId(doc, hit.id)))]);
  showResult(b.status, doc.layers(), hits, layer, out.run);
  ctx.requestDraw();
}

/** The layer the matches are selected on: the active one if it has matches, else the first layer (in drawing order) that has.  */
function targetLayer(hits: readonly QueryHit[]): string | null {
  if (hits.length === 0) return null;
  const active = store.activeLayerId;
  if (active !== null && hits.some((hit) => hit.layerId === active)) return active;
  return hits[0].layerId;
}

/** Selects top-level objects on `layer` (activating it), or clears the selection when `layer` is null. */
function select(layer: string | null, ids: readonly string[]): void {
  if (layer !== null && layer !== store.activeLayerId) setActiveLayer(layer);
  setEditGroup(null, ids);
}

function showResult(
  status: HTMLElement,
  layers: readonly { readonly id: string; readonly name: string }[],
  hits: readonly QueryHit[],
  layer: string | null,
  run: { readonly kind: string; readonly kindCount: number; readonly capped: boolean },
): void {
  status.classList.remove("error");
  if (hits.length === 0) {
    status.textContent =
      run.kindCount === 0 ? `No ${run.kind} in this drawing.` : "No matches.";
    return;
  }
  const name = layers.find((l) => l.id === layer)?.name ?? "";
  const other = hits.length - hits.filter((hit) => hit.layerId === layer).length;
  const noun = hits.length === 1 ? "match" : "matches";
  let text = `${hits.length} ${noun} on ${name}`;
  if (other > 0) text += `, ${other} more on other layers`;
  if (run.capped) text += " (the first few)";
  status.textContent = text;
}

/** Keeps the matches selected and closes the bar (it stays open while the query has an error). */
function keepSelection(): void {
  const b = bar;
  if (!b) return;
  window.clearTimeout(b.timer);
  run();
  if (b.valid) finish();
  else b.input.focus();
}

/** Puts the selection and layer back as they were, and closes the bar. */
function putBack(): void {
  const b = bar;
  if (!b) return;
  const { snap } = b;
  if (snap.layer !== null && snap.layer !== store.activeLayerId) setActiveLayer(snap.layer);
  setEditGroup(snap.edit, snap.selection);
  finish();
}

function finish(): void {
  const b = bar;
  if (!b) return;
  window.clearTimeout(b.timer);
  b.root.remove();
  bar = null;
  boxes = [];
  appContext()?.requestDraw();
}

/** Draws a dashed box round each match while the bar is open. Registered as a drawing overlay (ext.ts). */
export function drawQueryHighlights(p: Painter): void {
  if (boxes.length === 0) return;
  const ctx = p.ctx;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(43, 153, 255, 0.95)";
  ctx.setLineDash([4, 3]);
  const limit = Math.min(boxes.length, 4000);
  for (let i = 0; i < limit; i++) {
    const b = boxes[i];
    const a = p.toScreen({ x: b.x0, y: b.y1 });
    const z = p.toScreen({ x: b.x1, y: b.y0 });
    const x = Math.min(a.x, z.x) - 3;
    const y = Math.min(a.y, z.y) - 3;
    ctx.strokeRect(x, y, Math.abs(z.x - a.x) + 6, Math.abs(z.y - a.y) + 6);
  }
  ctx.restore();
}

/** The help popover: the grammar, the fields and operators, and examples a click puts in the bar. */
function helpNodes(pick: (example: string) => void): Node[] {
  const examples = EXAMPLES.map((example) => {
    const button = h("button", { cls: "sx-help-example", text: example, attrs: { type: "button" } });
    button.addEventListener("click", () => pick(example));
    return button;
  });
  return [
    h("code", { cls: "sx-help-line", text: "<kind> [where <condition> (and | or <condition>)*] [on <layer> | on all]" }),
    h(
      "dl",
      { cls: "sx-help-list" },
      h("dt", { text: "Kinds" }),
      h("dd", { text: "objects, lines, rectangles, polygons, polylines, arcs (circles, ovals), text, images, groups, symbols, other, or a plug-in such as walls or windows" }),
      h("dt", { text: "Fields" }),
      h("dd", { text: "kind, class, layer, name, text, symbol, linetype, fill, pen, lineweight, width, height, area, length, x, y, record.Name, record.Format.Name" }),
      h("dt", { text: "Operators" }),
      h("dd", { text: "=  !=  >  <  >=  <=  contains  startswith (measurements take the first six)" }),
      h("dt", { text: "Values" }),
      h("dd", { text: "500, 1.5m, 30cm: lengths in mm. 10m2, 500mm2: areas. \"Quoted\" for spaces. Colours by name, #rrggbb or index." }),
      h("dt", { text: "Notes" }),
      h("dd", { text: "and binds before or. x and y are the centre of an object's bounds. Without on, every layer is searched. Parts of symbol instances are not matched: select the instance." }),
    ),
    h("div", { cls: "sx-help-examples-title", text: "Examples" }),
    ...examples,
  ];
}
