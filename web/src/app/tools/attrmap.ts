// Attribute Mapping tool: Vectorworks' Attribute Mapping, which lays the selected object's hatch,
// tile or gradient. Handles show where the fill is laid: its origin (a square) and the ends of its
// two axes (circles), with one tile cell, or a hatch's frame, dashed between them. Dragging the
// origin moves the fill. Dragging the first axis end turns it, and scales a tile or a gradient;
// the second axis follows. Dragging the second end skews a tile or a hatch, and stretches a tile.
// Shift keeps the first axis to 15° steps and the second square to the first. A gradient's ramp
// runs from the origin to the first end (a radial one's radius), so it has no second axis. The
// fill follows the drag and commits when it ends; Esc abandons it. Clicking off the handles
// selects the object there.

import type { BBox, FillMapping, ObjectInfo, Pt, TileFill } from "../../core/index.ts";
import { attempt, setActiveLayer, setSelection } from "../commands.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT, HANDLE_PX } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { fillsShape } from "../shapes.ts";
import { store } from "../state.ts";
import { BaseTool, withPreview, type FillPreview, type Painter, type PointerInfo } from "../tools.ts";

type Fill = "hatch" | "tile" | "gradient";
type Handle = "origin" | "u" | "v";

/** Shift turns the first axis in these steps, radians. */
const STEP = Math.PI / 12;
/** how near (CSS px) a press must come to a handle to drag it */
const GRAB_PX = HANDLE_PX / 2 + 4;
/** a hatch's axes only give directions, so their ends are drawn this far from the origin, CSS px */
const HATCH_AXIS_PX = { min: 48, max: 160 };
/** a mapping's axes, 25.4 mm (one inch), when the object has none yet */
const AXIS = 25.4;
const LINEAR = 1;
const RADIAL = 2;

/** The selected object whose fill the tool lays. */
interface Target {
  readonly id: string;
  readonly fill: Fill;
  /** the mapping it has, or the one that lays the fill as it is drawn without one */
  readonly map: FillMapping;
  readonly bbox: BBox;
}

interface Drag {
  readonly target: Target;
  readonly handle: Handle;
  /** the mapping as the pointer leaves it; equal to the target's until it moves */
  map: FillMapping;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt): number => Math.hypot(a.x, a.y);
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const turn = (a: Pt, t: number): Pt => ({ x: a.x * Math.cos(t) - a.y * Math.sin(t), y: a.x * Math.sin(t) + a.y * Math.cos(t) });
const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });

/** The direction of `a`, kept to 15° steps. */
function snapAngle(a: Pt): Pt {
  const t = Math.round(Math.atan2(a.y, a.x) / STEP) * STEP;
  return scale({ x: Math.cos(t), y: Math.sin(t) }, len(a));
}

/**
 * The mapping that lays a fill where the renderer draws it without one: a gradient across the
 * bounds at mid-height; a tile's repeat from the origin, its corner moved by whole repeats to
 * near the middle of the object; a hatch from the middle of the object, square to the axes.
 */
function defaultMapping(fill: Fill, b: BBox, tile: TileFill | null): FillMapping {
  const mid = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  if (fill === "gradient") {
    const w = Math.max(b.x1 - b.x0, 1e-6);
    return { origin: { x: b.x0, y: mid.y }, u: { x: b.x1, y: mid.y }, v: { x: b.x0, y: mid.y + w }, shape: LINEAR };
  }
  if (fill === "tile" && tile) {
    const [U, V] = Math.abs(tile.u.x) >= Math.abs(tile.v.x) ? [tile.u, tile.v] : [tile.v, tile.u];
    const corner = scale(add(U, V), -0.5);
    // the whole repeats (s, t) that take the cell's corner nearest the middle
    const d = sub(mid, corner);
    const det = cross(U, V);
    const s = Math.round(cross(d, V) / det);
    const t = Math.round(cross(U, d) / det);
    const origin = add(corner, add(scale(U, s), scale(V, t)));
    return { origin, u: add(origin, U), v: add(origin, V), shape: LINEAR };
  }
  return { origin: mid, u: { x: mid.x + AXIS, y: mid.y }, v: { x: mid.x, y: mid.y + AXIS }, shape: LINEAR };
}

/** Keeps a point within twice the object's size of it, where the renderer still lays a fill from it. */
function keepNear(p: Pt, b: BBox): Pt {
  const reach = 1.99 * Math.max(b.x1 - b.x0, b.y1 - b.y0);
  return {
    x: Math.min(b.x1 + reach, Math.max(b.x0 - reach, p.x)),
    y: Math.min(b.y1 + reach, Math.max(b.y0 - reach, p.y)),
  };
}

export class AttributeMappingTool extends BaseTool {
  readonly id = "attrmap";
  readonly cursor = "crosshair";

  private drag: Drag | null = null;

  hint(): string {
    const t = this.target();
    if (!t) return "Select one object with a hatch, tile or gradient fill";
    if (this.drag) return this.drag.handle === "origin" ? "Drag to move the fill · Esc cancels" : "Shift 15° or square · Esc cancels";
    if (t.fill === "gradient") return "Drag the square to move the gradient · Drag the circle to turn and scale it";
    const what = t.fill === "tile" ? "turn and scale" : "turn";
    return `Drag the square to move the ${t.fill} · First circle to ${what} it · Second to skew it`;
  }

  fillPreview(): FillPreview | null {
    return this.drag ? { id: this.drag.target.id, map: this.drag.map } : null;
  }

  down(p: PointerInfo): void {
    this.drag = null;
    const t = this.target();
    const handle = t && this.handleAt(t, p.screen);
    if (t && handle) {
      this.drag = { target: t, handle, map: t.map };
      return;
    }
    this.clickAt(p.screen, p.shift);
  }

  move(p: PointerInfo): void {
    const d = this.drag;
    if (!d) return;
    d.map = this.dragged(d, p.pos, p.shift) ?? d.map;
  }

  up(p: PointerInfo): void {
    const d = this.drag;
    if (!d) return;
    this.move(p);
    this.drag = null;
    if (d.map === d.target.map) return;
    attempt("Attribute mapping", (s) => s.setFillMapping(d.target.id, d.map));
  }

  cancel(): void {
    this.drag = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.drag) return false;
    this.drag = null;
    return true;
  }

  overlay(g: Painter): void {
    const t = this.drag?.target ?? this.target();
    if (!t) return;
    const map = this.drag?.map ?? t.map;
    const ends = this.ends(t.fill, map, g.scale);
    const { ctx } = g;
    const o = g.toScreen(map.origin);
    const u = g.toScreen(ends.u);
    withPreview(g, () => {
      ctx.beginPath();
      if (t.fill === "gradient" && map.shape === RADIAL) {
        ctx.arc(o.x, o.y, Math.hypot(u.x - o.x, u.y - o.y), 0, Math.PI * 2);
      } else if (t.fill !== "gradient") {
        // the cell (a tile's repeat; a hatch's frame) the origin and axes span
        const v = g.toScreen(ends.v);
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(u.x + v.x - o.x, u.y + v.y - o.y);
        ctx.lineTo(v.x, v.y);
      }
      ctx.stroke();
    });
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(u.x, u.y);
    if (t.fill !== "gradient") {
      const v = g.toScreen(ends.v);
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(v.x, v.y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = "#ffffff";
    const half = HANDLE_PX / 2;
    for (const h of t.fill === "gradient" ? [ends.u] : [ends.u, ends.v]) {
      const s = g.toScreen(h);
      ctx.beginPath();
      ctx.arc(s.x, s.y, half, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = ACCENT;
    ctx.fillRect(o.x - half, o.y - half, HANDLE_PX, HANDLE_PX);
    ctx.restore();
  }

  /** The one selected object with a hatch, tile or gradient fill, and how that fill is laid. */
  private target(): Target | null {
    const { scene } = this.env;
    const doc = scene.document;
    if (!doc || store.selection.size !== 1) return null;
    const [id] = store.selection;
    if (isDerivedId(id)) return null;
    const obj = doc.object(id);
    return obj ? this.targetOf(obj) : null;
  }

  private targetOf(obj: ObjectInfo): Target | null {
    const { scene } = this.env;
    const fp = obj.attrs?.fillPattern ?? 0;
    if (fp >= 0 || !obj.shape || !fillsShape(obj.shape)) return null;
    const tile = scene.tile(fp);
    const fill: Fill | null = scene.gradient(fp) ? "gradient" : tile ? "tile" : scene.hatch(fp) ? "hatch" : null;
    const bbox = scene.geometry(obj)?.bbox;
    if (!fill || !bbox) return null;
    const map = obj.fillMap && len(sub(obj.fillMap.u, obj.fillMap.origin)) > 0 ? obj.fillMap : defaultMapping(fill, bbox, tile);
    return { id: obj.id, fill, map, bbox };
  }

  /** Where the axis handles are drawn: a hatch's at a readable length along its axes, others' at their ends. */
  private ends(fill: Fill, map: FillMapping, px: number): { u: Pt; v: Pt } {
    if (fill !== "hatch") return { u: map.u, v: map.v };
    const at = (end: Pt): Pt => {
      const a = sub(end, map.origin);
      const l = len(a);
      if (!(l > 0)) return end;
      const shown = Math.min(HATCH_AXIS_PX.max, Math.max(HATCH_AXIS_PX.min, l * px)) / px;
      return add(map.origin, scale(a, shown / l));
    };
    return { u: at(map.u), v: at(map.v) };
  }

  private handleAt(t: Target, screen: Pt): Handle | null {
    const ends = this.ends(t.fill, t.map, this.env.view.scale);
    const points: [Handle, Pt][] = [
      ["origin", t.map.origin],
      ["u", ends.u],
    ];
    if (t.fill !== "gradient") points.push(["v", ends.v]);
    let best: Handle | null = null;
    let near = GRAB_PX;
    for (const [h, w] of points) {
      const s = this.env.view.toScreen(w);
      const d = Math.hypot(s.x - screen.x, s.y - screen.y);
      if (d <= near) {
        best = h;
        near = d;
      }
    }
    return best;
  }

  /** The mapping with the dragged handle at `q`; null when that would leave it without two axes. */
  private dragged(d: Drag, q: Pt, shift: boolean): FillMapping | null {
    const { fill, bbox } = d.target;
    const m = d.target.map;
    const o = m.origin;
    const u = sub(m.u, o);
    const v = sub(m.v, o);
    if (d.handle === "origin") {
      const at = keepNear(q, bbox);
      const by = sub(at, o);
      return { ...m, origin: at, u: add(m.u, by), v: add(m.v, by) };
    }
    let a = sub(q, o);
    if (!(len(a) > 1e-9)) return null;
    if (d.handle === "u") {
      if (shift) a = snapAngle(a);
      const t = Math.atan2(a.y, a.x) - Math.atan2(u.y, u.x);
      // a hatch's axes only turn; a tile's and a gradient's also scale with the drag
      const k = fill === "hatch" ? 1 : len(a) / len(u);
      const nu = scale(turn(u, t), k);
      const nv = fill === "gradient" ? perp(nu) : scale(turn(v, t), k);
      return { ...m, u: add(o, nu), v: add(o, nv) };
    }
    if (shift) {
      // square to the first axis, on the side the pointer is
      const n = perp(u);
      a = scale(n, (a.x * n.x + a.y * n.y) / (len(n) * len(n)));
    }
    if (fill === "hatch") a = scale(a, len(v) / len(a));
    if (Math.abs(cross(u, a)) <= 1e-6 * len(u) * len(a)) return null;
    return { ...m, v: add(o, a) };
  }

  /** A click off the handles: selects the object there (Shift adds it), or nothing. */
  private clickAt(screen: Pt, shift: boolean): void {
    const { scene, view } = this.env;
    const active = store.activeLayerId;
    if (!active) return;
    const scope = store.editGroupId;
    const hit = scope
      ? pickObject(scene, view, screen, [active], (o) => scene.unitOf(o, scope) !== null)
      : pickObject(scene, view, screen, scene.pickableLayers(active));
    if (!hit) {
      if (!shift) setSelection([]);
      return;
    }
    if (hit.layerId !== store.activeLayerId) setActiveLayer(hit.layerId);
    const id = scene.unitOf(hit, store.editGroupId);
    if (id) setSelection(shift ? [...store.selection, id] : [id]);
  }
}
