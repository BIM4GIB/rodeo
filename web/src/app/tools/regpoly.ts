// Regular Polygon tool, with Vectorworks' three modes. Inscribed (1): click the
// centre, then a vertex. Circumscribed (2): the centre, then the middle of a side.
// By Edge (3): the two ends of one side, the polygon lying to its left. The polygon
// has the number of sides set in the data bar (Tab; a whole number from 3 to 64, 6
// at first). Esc drops the first click. The polygon takes the active class and
// attributes.

import type { Pt } from "../../core/index.ts";
import { addAndSelect } from "../commands.ts";
import { dataBar, type BarField, type BarStage, type BarValues } from "../databar.ts";
import { dist } from "../geom.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

const DEFAULT_SIDES = 6;
const MIN_SIDES = 3;
const MAX_SIDES = 64;
const FIELD_SIDES: BarField = { key: "sides", label: "Sides", digits: 0 };
const SIDES_STAGE: BarStage = { key: "regpoly", caption: "Polygon", fields: [FIELD_SIDES] };
/** pointer travel in document units below which two points count as one */
const MIN_WORLD = 1e-9;

type Mode = "inscribed" | "circumscribed" | "edge";
const MODES: readonly { readonly id: Mode; readonly label: string }[] = [
  { id: "inscribed", label: "Inscribed" },
  { id: "circumscribed", label: "Circumscribed" },
  { id: "edge", label: "By Edge" },
];

export class RegularPolygonTool extends BaseTool {
  readonly id = "regpoly";
  readonly cursor = "crosshair";

  /** number of sides; a typed value replaces it once entered */
  private sides = DEFAULT_SIDES;
  /** the first click (the centre, or a side's first end by edge); null before */
  private centre: Pt | null = null;
  private mode: Mode = "inscribed";
  /** last pointer event; the preview and the data bar follow it */
  private pointer: PointerInfo | null = null;
  private readonly barHandlers = {
    commit: (values: BarValues) => this.onBarCommit(values),
    edit: () => this.env.requestDraw(),
  };

  modes(): ToolModes {
    return { options: MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode };
  }

  setMode(id: string): void {
    const m = MODES.find((x) => x.id === id);
    if (m) this.mode = m.id;
  }

  hint(): string {
    if (this.mode === "edge") return this.centre ? "Click the other end of the side · Tab sides" : "Click one end of a side · Tab sides · 1–3 mode";
    if (!this.centre) return "Click the centre · Tab sides · 1–3 mode";
    return this.mode === "inscribed" ? "Click to place a vertex · Tab sides" : "Click the middle of a side · Tab sides";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    if (!this.centre) this.centre = p.pos;
    else this.placeVertex(this.centre, p.pos);
    this.syncBar();
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.syncBar();
  }

  cancel(): void {
    this.centre = null;
    this.pointer = null;
    dataBar.reset();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key === "Tab") {
      if (!this.pointer) return false;
      dataBar.show();
      this.syncBar();
      return dataBar.focusField(e.shiftKey);
    }
    if (e.key === "Escape" && this.centre !== null) {
      this.centre = null;
      this.syncBar();
      return true;
    }
    return false;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    dataBar.position(g.toScreen(p.pos), g);
    const centre = this.centre;
    const sides = this.liveSides();
    if (!centre || sides === null || dist(centre, p.pos) <= MIN_WORLD) return;
    const pts = polygonFor(this.mode, centre, p.pos, sides);
    withPreview(g, () => strokeScreen(g, pts, true));
  }

  /** Adds the polygon the two clicks give, and selects it. A first point clicked again measures nothing and is kept. */
  private placeVertex(centre: Pt, vertex: Pt): void {
    if (dist(centre, vertex) <= MIN_WORLD) return;
    const sides = this.liveSides();
    if (sides === null) {
      toast("Enter a whole number of sides from 3 to 64.", "info");
      return;
    }
    this.centre = null;
    addAndSelect({ kind: "polygon", points: polygonFor(this.mode, centre, vertex, sides), closed: true });
    this.adopt(sides);
  }

  private onBarCommit(values: BarValues): void {
    const n = values.sides;
    if (!isSides(n)) {
      toast("Enter a whole number of sides from 3 to 64.", "info");
      return;
    }
    this.adopt(n);
    this.env.requestDraw();
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("Regular Polygon Preferences", [
      { kind: "number", key: "sides", label: "Sides", value: this.sides, min: MIN_SIDES, max: MAX_SIDES, integer: true },
    ]);
    if (v) this.adopt(v.num("sides"));
  }

  /** Makes `n` the number of sides and drops any typed lock, so the bar shows it again. */
  private adopt(n: number): void {
    this.sides = n;
    dataBar.update({ sides: n });
    dataBar.release();
  }

  /** The sides the bar holds: a typed value while one is locked, else the stored one. Null when that is not a valid count. */
  private liveSides(): number | null {
    const n = dataBar.resolve({ sides: this.sides })?.sides;
    return n !== undefined && isSides(n) ? n : null;
  }

  private syncBar(): void {
    dataBar.setStage(SIDES_STAGE, this.barHandlers);
    dataBar.update({ sides: this.sides });
    const p = this.pointer;
    if (p) dataBar.position(this.env.view.toScreen(p.pos), this.env.view);
  }
}

/**
 * The polygon two clicks give in `mode`: inscribed, `a` the centre and `b` a vertex; circumscribed,
 * `a` the centre and `b` the middle of a side; by edge, `a` and `b` the ends of a side, the polygon
 * lying to its left (counter-clockwise, y up).
 */
function polygonFor(mode: Mode, a: Pt, b: Pt, sides: number): Pt[] {
  const half = Math.PI / sides;
  if (mode === "circumscribed") {
    const r = dist(a, b) / Math.cos(half);
    const t = Math.atan2(b.y - a.y, b.x - a.x) - half;
    return regularPolygonPoints(a, { x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) }, sides);
  }
  if (mode === "edge") {
    const len = dist(a, b);
    const apothem = len / 2 / Math.tan(half);
    const centre = { x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * apothem, y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * apothem };
    return regularPolygonPoints(centre, a, sides);
  }
  return regularPolygonPoints(a, b, sides);
}

/** Whether `n` is a number of sides the tool takes: a whole number from 3 to 64. */
function isSides(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_SIDES && n <= MAX_SIDES;
}

/**
 * Vertices of a regular polygon with `sides` sides about `centre`: the first at
 * `vertex`, the others counter-clockwise from it (y up), at the same distance from
 * the centre.
 */
export function regularPolygonPoints(centre: Pt, vertex: Pt, sides: number): Pt[] {
  const r = dist(centre, vertex);
  const a0 = Math.atan2(vertex.y - centre.y, vertex.x - centre.x);
  const pts: Pt[] = [];
  for (let i = 0; i < sides; i++) {
    if (i === 0) {
      pts.push({ x: vertex.x, y: vertex.y });
      continue;
    }
    const a = a0 + (2 * Math.PI * i) / sides;
    pts.push({ x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) });
  }
  return pts;
}
