// Modify > Drafting Aids > Create Dividing Lines…, as Vectorworks has it: with two lines selected,
// click where the new lines start and again where they end (the Dividing Lines tool,
// tools/dividing.ts), then give the number of equal divisions. The new lines divide the space between
// the two evenly: for lines at an angle they run out from where the lines cross, between the circles
// round it through the two clicks; for parallel lines they run alongside them, between the lines
// across them through the clicks. When both clicks are on the same circle or line across, loci are
// placed there instead. They are drawn in the active class with the attributes for new objects, on
// the layer (out of any group being edited), and selected. One undo step.

import type { NewShape, Pt } from "../core/index.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { pathOf } from "./cutting.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** The two lines the dividing lines go between, on their layer. */
export interface DividingJob {
  readonly layerId: string;
  readonly a: readonly [Pt, Pt];
  readonly b: readonly [Pt, Pt];
}

/** Where the dividing lines start or end, through a point: a circle round the crossing, or a line across parallel lines. */
export type DividingGuide = { readonly kind: "circle"; readonly center: Pt; readonly radius: number } | { readonly kind: "across"; readonly a: Pt; readonly b: Pt };

/** The lines' frame: angles from where they cross, or along and across parallel ones. */
type Frame =
  | { readonly kind: "angle"; readonly o: Pt; readonly from: number; readonly sweep: number }
  | { readonly kind: "parallel"; readonly origin: Pt; readonly u: Pt; readonly n: Pt; readonly across: number };

let job: DividingJob | null = null;
let lastCount = 2;

export function dividingJob(): DividingJob | null {
  return job;
}

export function endDividingJob(): void {
  job = null;
}

/** The two selected lines of the edit scope, or null. */
function selectedLines(): DividingJob | null {
  const doc = store.session?.doc;
  const layerId = store.activeLayerId;
  if (!doc || !layerId || store.selection.size !== 2) return null;
  const lines: [Pt, Pt][] = [];
  for (const id of store.selection) {
    const o = doc.object(id);
    const path = o?.shape && o.parentId === store.editGroupId && !isDerivedId(id) ? pathOf(o.shape) : null;
    if (path?.kind !== "chain" || path.source !== "line" || path.pts.length !== 2) return null;
    lines.push([path.pts[0], path.pts[1]]);
  }
  return { layerId, a: lines[0], b: lines[1] };
}

export function canCreateDividingLines(): boolean {
  return selectedLines() !== null;
}

function frameOf(j: DividingJob): Frame | null {
  const [a0, a1] = j.a;
  const [b0, b1] = j.b;
  const da = { x: a1.x - a0.x, y: a1.y - a0.y };
  const db = { x: b1.x - b0.x, y: b1.y - b0.y };
  const la = Math.hypot(da.x, da.y);
  const lb = Math.hypot(db.x, db.y);
  if (!(la > 0 && lb > 0)) return null;
  const den = da.x * db.y - da.y * db.x;
  if (Math.abs(den) < 1e-9 * la * lb) {
    const u = { x: da.x / la, y: da.y / la };
    const n = { x: -u.y, y: u.x };
    const across = (b0.x - a0.x) * n.x + (b0.y - a0.y) * n.y;
    // on one line: there is no space between them to divide
    return Math.abs(across) < 1e-9 * la ? null : { kind: "parallel", origin: a0, u, n, across };
  }
  const t = ((b0.x - a0.x) * db.y - (b0.y - a0.y) * db.x) / den;
  const o = { x: a0.x + da.x * t, y: a0.y + da.y * t };
  // each line's way out from the crossing: toward its end farther from it
  const away = (p: Pt, q: Pt): number => {
    const far = Math.hypot(p.x - o.x, p.y - o.y) >= Math.hypot(q.x - o.x, q.y - o.y) ? p : q;
    return Math.atan2(far.y - o.y, far.x - o.x);
  };
  const from = away(a0, a1);
  const to = away(b0, b1);
  return { kind: "angle", o, from, sweep: Math.atan2(Math.sin(to - from), Math.cos(to - from)) };
}

/** Takes up the two selected lines for the Dividing Lines tool's clicks. False (with a message) when it can't. */
export function startDividingLines(): boolean {
  const j = selectedLines();
  if (!j) {
    toast("Create Dividing Lines needs two lines selected.", "info");
    return false;
  }
  if (!frameOf(j)) {
    toast("Those lines lie on one line: there is no space between them to divide.", "info");
    return false;
  }
  job = j;
  return true;
}

/** The guide through `at`, where dividing lines starting or ending there would. */
export function dividingGuide(j: DividingJob, at: Pt): DividingGuide | null {
  const f = frameOf(j);
  if (!f) return null;
  if (f.kind === "angle") return { kind: "circle", center: f.o, radius: Math.hypot(at.x - f.o.x, at.y - f.o.y) };
  const s = (at.x - f.origin.x) * f.u.x + (at.y - f.origin.y) * f.u.y;
  const p = (d: number): Pt => ({ x: f.origin.x + f.u.x * s + f.n.x * d, y: f.origin.y + f.u.y * s + f.n.y * d });
  return { kind: "across", a: p(0), b: p(f.across) };
}

/**
 * The dividing lines from the guide through `start` to the one through `end`, making `count` equal
 * divisions (count − 1 lines); loci on the start guide when the two are within `same` of each other.
 */
export function dividingShapes(j: DividingJob, start: Pt, end: Pt, count: number, same: number): NewShape[] {
  const f = frameOf(j);
  if (!f || count < 2) return [];
  const out: NewShape[] = [];
  if (f.kind === "angle") {
    const r1 = Math.hypot(start.x - f.o.x, start.y - f.o.y);
    const r2 = Math.hypot(end.x - f.o.x, end.y - f.o.y);
    for (let i = 1; i < count; i++) {
      const t = f.from + (f.sweep * i) / count;
      const at = (r: number): Pt => ({ x: f.o.x + r * Math.cos(t), y: f.o.y + r * Math.sin(t) });
      out.push(Math.abs(r1 - r2) <= same ? { kind: "locus", at: at(r1) } : { kind: "line", a: at(r1), b: at(r2) });
    }
    return out;
  }
  const along = (p: Pt): number => (p.x - f.origin.x) * f.u.x + (p.y - f.origin.y) * f.u.y;
  const s1 = along(start);
  const s2 = along(end);
  for (let i = 1; i < count; i++) {
    const d = (f.across * i) / count;
    const at = (s: number): Pt => ({ x: f.origin.x + f.u.x * s + f.n.x * d, y: f.origin.y + f.u.y * s + f.n.y * d });
    out.push(Math.abs(s1 - s2) <= same ? { kind: "locus", at: at(s1) } : { kind: "line", a: at(s1), b: at(s2) });
  }
  return out;
}

/** How many divisions the tool's preview shows: the last given. */
export function previewCount(): number {
  return lastCount;
}

/** After the clicks: the Dividing Lines Settings dialog, then the lines (or loci) drawn and selected. */
export async function finishDividingLines(j: DividingJob, start: Pt, end: Pt, same: number): Promise<void> {
  const field = h("input", { cls: "menu-dialog-input", value: String(lastCount), attrs: { type: "text", inputmode: "numeric", "aria-label": "Number of divisions" } });
  const count = await showDialog<number>({
    title: "Dividing Lines Settings",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Number of divisions" }), field),
      h("p", { cls: "muted", text: "The space between the two lines is divided into this many equal parts." }),
    ],
    check: () => {
      const n = Number(field.value.trim());
      return Number.isInteger(n) && n >= 2 && n <= 1000 ? { value: n } : { error: "Give a whole number of divisions from 2 to 1000.", focus: field };
    },
  });
  if (count === null) return;
  lastCount = count;
  const shapes = dividingShapes(j, start, end, count, same);
  if (!shapes.length) return;
  const attrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
  const r = attempt("Create Dividing Lines", (s) => s.batch(() => s.addObjects(j.layerId, shapes, store.activeClassIndex, attrs)));
  if (!r) return;
  // new objects go on the layer, not into the group being edited
  setEditGroup(null, r.value);
  const loci = shapes[0].kind === "locus";
  toast(`${shapes.length} dividing ${loci ? (shapes.length === 1 ? "locus" : "loci") : shapes.length === 1 ? "line" : "lines"} made.`, "info");
}
