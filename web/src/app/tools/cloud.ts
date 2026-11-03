// Revision Cloud tool: a closed outline of arcs bulging outwards, drawn round a
// change, as the Vectorworks Revision Cloud draws one. Rectangle mode (1) takes a
// drag or two clicks; Polygon mode (2) takes each corner, and a double-click,
// Enter or a click on the first corner closes it. Esc cancels. The arcs are about
// the size set in Preferences (paper mm, times the layer scale); the cloud is one
// polygon in the active class.

import type { Pt } from "../../core/index.ts";
import { addAndSelect } from "../commands.ts";
import { dist, normalizeRect, signedArea } from "../geom.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

type CloudMode = "rectangle" | "polygon";

const MODES: readonly { readonly id: CloudMode; readonly label: string }[] = [
  { id: "rectangle", label: "Rectangle" },
  { id: "polygon", label: "Polygon" },
];
/** arc length on paper, mm, until Preferences change it */
const ARC_MM = 6;
/** arcs along each edge at the least, so a small cloud still reads as one */
const MIN_ARCS = 2;
/** how far each arc bulges, as a share of its chord */
const BULGE = 0.3;
/** points along each arc */
const ARC_STEPS = 6;
/** pointer travel (CSS px) below which a press is a click; clicks this close to the first corner close a polygon */
const CLICK_PX = 4;
const CLOSE_PX = 6;

export class RevisionCloudTool extends BaseTool {
  readonly id = "cloud";
  readonly cursor = "crosshair";

  private mode: CloudMode = "rectangle";
  private arcMm = ARC_MM;
  /** corners placed so far (a rectangle's first corner, or the polygon's) */
  private points: Pt[] = [];
  private pressScreen: Pt | null = null;
  private cursorAt: Pt | null = null;

  modes(): ToolModes {
    return { options: MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode };
  }

  setMode(id: string): void {
    const mode = MODES.find((m) => m.id === id);
    if (!mode || mode.id === this.mode) return;
    this.mode = mode.id;
    this.reset();
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Revision Cloud Preferences",
      [{ kind: "number", key: "arc", label: "Arc length", value: this.arcMm, min: 1, max: 100, unit: "mm" }],
      "On paper: a layer at 1:n draws the arcs n times larger.",
    );
    if (v) this.arcMm = v.num("arc");
  }

  hint(): string {
    if (this.mode === "rectangle") {
      return this.points.length === 0
        ? "Drag a rectangle or click two corners · 1–2 mode"
        : "Click or release at the opposite corner";
    }
    return this.points.length === 0
      ? "Click the first corner · 1–2 mode"
      : "Click the next corner · Enter closes";
  }

  down(p: PointerInfo): void {
    this.pressScreen = p.screen;
    if (this.mode === "rectangle") {
      if (this.points.length === 0) this.points = [p.pos];
      else this.finish([...this.points, p.pos]);
      return;
    }
    const first = this.points[0];
    if (this.points.length >= 3 && dist(p.pos, first) * this.env.view.scale <= CLOSE_PX) {
      this.finish(this.points);
      return;
    }
    const last = this.points.at(-1);
    if (!last || dist(last, p.pos) * this.env.view.scale > CLICK_PX) this.points.push(p.pos);
    if (p.detail >= 2) this.finish(this.points);
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
  }

  up(p: PointerInfo): void {
    // a drag in rectangle mode places the opposite corner where it is released
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.mode !== "rectangle" || this.points.length !== 1 || !press) return;
    if (dist(p.screen, press) > CLICK_PX) this.finish([this.points[0], p.pos]);
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if ((e.key === "1" || e.key === "2") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.setMode(MODES[Number(e.key) - 1].id);
      return true;
    }
    if (this.points.length === 0) return false;
    if (e.key === "Enter" && this.mode === "polygon") this.finish(this.points);
    else if (e.key === "Escape") this.reset();
    else return false;
    return true;
  }

  overlay(g: Painter): void {
    const at = this.cursorAt;
    if (!at || this.points.length === 0) return;
    const outline = this.outline([...this.points, at]);
    if (!outline) {
      withPreview(g, () => strokeScreen(g, [...this.points, at], false));
      return;
    }
    const arc = this.arcLength();
    const cloud = arc === null ? null : cloudOutline(outline, arc);
    withPreview(g, () => strokeScreen(g, cloud ?? outline, true));
  }

  /** Draws the cloud round `pts` (two corners, or the polygon's corners), selects it, and starts over. */
  private finish(pts: readonly Pt[]): void {
    const outline = this.outline(pts);
    const arc = this.arcLength();
    const cloud = outline && arc !== null ? cloudOutline(outline, arc) : null;
    if (!cloud) {
      if (this.mode === "polygon" && pts.length < 3) return;
      toast("A revision cloud needs an outline with some area.", "info");
      this.reset();
      return;
    }
    addAndSelect({ kind: "polygon", points: cloud, closed: true });
    this.reset();
  }

  /** The outline the cloud follows: the rectangle two corners span, or the polygon. Null when it has no area. */
  private outline(pts: readonly Pt[]): Pt[] | null {
    let outline: Pt[];
    if (this.mode === "rectangle") {
      if (pts.length < 2) return null;
      const r = normalizeRect(pts[0], pts[pts.length - 1]);
      outline = [
        { x: r.x0, y: r.y0 },
        { x: r.x1, y: r.y0 },
        { x: r.x1, y: r.y1 },
        { x: r.x0, y: r.y1 },
      ];
    } else {
      if (pts.length < 3) return null;
      outline = [...pts];
    }
    return Math.abs(signedArea(outline)) > 0 ? outline : null;
  }

  /** The arc length in world units for the active layer, or null without one. */
  private arcLength(): number | null {
    const layerId = store.activeLayerId;
    const layer = layerId ? this.env.scene.layer(layerId) : undefined;
    return layer ? this.arcMm * (layer.scale || 1) : null;
  }

  private reset(): void {
    this.points = [];
    this.pressScreen = null;
  }
}

/**
 * A closed outline of arcs along `outline`: each edge is cut into chords of about
 * `arc` (MIN_ARCS at the least), and each chord bulges outwards by BULGE of its
 * length. Null when the outline has no area.
 */
export function cloudOutline(outline: readonly Pt[], arc: number): Pt[] | null {
  const area = signedArea(outline);
  if (!(Math.abs(area) > 0) || !(arc > 0)) return null;
  // counter-clockwise, so outwards is to the right of each edge
  const ring = area > 0 ? outline : [...outline].reverse();
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = dist(a, b);
    if (len === 0) continue;
    const n = Math.max(MIN_ARCS, Math.round(len / arc));
    for (let k = 0; k < n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      const q = { x: a.x + ((b.x - a.x) * (k + 1)) / n, y: a.y + ((b.y - a.y) * (k + 1)) / n };
      out.push(...bulge(p, q));
    }
  }
  return out.length >= 3 ? out : null;
}

/** Points along an arc from `p` towards `q` (q itself is left for the next arc), bulging to the right of p→q. */
function bulge(p: Pt, q: Pt): Pt[] {
  const c = dist(p, q);
  const u = { x: (q.x - p.x) / c, y: (q.y - p.y) / c };
  // the right-hand normal: outwards on a counter-clockwise outline
  const n = { x: u.y, y: -u.x };
  const s = BULGE * c;
  const r = (c * c) / 4 / (2 * s) + s / 2;
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const centre = { x: mid.x - n.x * (r - s), y: mid.y - n.y * (r - s) };
  const half = Math.asin(Math.min(1, c / 2 / r));
  const pts: Pt[] = [];
  for (let i = 0; i < ARC_STEPS; i++) {
    const phi = -half + (2 * half * i) / ARC_STEPS;
    pts.push({
      x: centre.x + r * (Math.cos(phi) * n.x + Math.sin(phi) * u.x),
      y: centre.y + r * (Math.cos(phi) * n.y + Math.sin(phi) * u.y),
    });
  }
  return pts;
}
