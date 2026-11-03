// HopOver (ConnectCAD Schematics and Cable/Power Planning; hopOver.ts): click a line where another
// crosses it and the clicked line hops over the other in a half circle, as a circuit with priority
// does. The line under the cursor and the hop the click makes show first, at the crossing nearest
// the cursor; a line or open polygon becomes a polyline. Vectorworks hops circuits; Rodeo hops any
// line, open polygon or open polyline on the active layer, over any other visible object's outline,
// and a plug-in object that hops itself (a ConnectCAD circuit hopping the circuit crossing it, kept
// with the circuit: PluginDriver.hopOver). One such object selected first always takes the hop where
// it crosses the one clicked, as a selected circuit keeps priority in Vectorworks.

import type { ObjectInfo, Pt } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import { pluginDriver, type PluginHop } from "../ext.ts";
import { intersections, pathOf, pointAt, type CutPath } from "../cutting.ts";
import { distanceToPiece, hopArc, hopPoints, hopRefusal, hopVertices, straightPieces, withHop, type HopPiece } from "../hopOver.ts";
import { pickObject, pickPx } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, type Painter, type PointerInfo } from "../tools.ts";
import { layerScale } from "./detailing.ts";

const UNSUPPORTED = "HopOver works on lines and open polygons and polylines.";
const NOTHING = "Nothing crosses the line's straight piece here: click where another line crosses it.";
/** a hop's radius on paper, mm */
const RADIUS_MM = 1.5;

/** What a click would do: the line, the hop over its crossing, or why nothing happens. */
interface Plan {
  readonly obj: ObjectInfo;
  readonly piece: HopPiece | null;
  readonly at: Pt | null;
  readonly hop: [Pt, Pt, Pt] | null;
  readonly reason: string;
}

export class HopOverTool extends BaseTool {
  readonly id = "hopover";
  readonly cursor = "crosshair";
  private radiusMm = RADIUS_MM;
  private downward = false;
  private target: Plan | null = null;
  private pluginTarget: PluginHop | null = null;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "HopOver Preferences",
      [
        { kind: "number", key: "radius", label: "Hop radius", value: this.radiusMm, min: 0.1, max: 50, unit: "mm" },
        {
          kind: "choice",
          key: "side",
          label: "Hop Side",
          value: this.downward ? "down" : "up",
          options: [
            { value: "up", label: "Up (left on an upright line)" },
            { value: "down", label: "Down (right on an upright line)" },
          ],
        },
      ],
      "Click a line where another crosses it: the clicked line hops over the other in a half circle, its radius on paper, at the crossing nearest the click. A line or open polygon becomes a polyline, the hop a true arc in it; markers, class and attributes stay. Closed shapes, curves and symbols aren't hopped. A ConnectCAD circuit keeps its hop over the circuit crossing it as either moves; a circuit selected first hops where it crosses the one clicked.",
    );
    if (!v) return;
    this.radiusMm = v.num("radius");
    this.downward = v.choice("side") === "down";
  }

  hint(): string {
    return "Click the line that hops, where another crosses it";
  }

  down(p: PointerInfo): void {
    const hop = this.pluginHop(p);
    if (hop) {
      if (hop.reason) toast(hop.reason, "info");
      else hop.apply();
      this.pluginTarget = null;
      return;
    }
    const obj = this.pick(p);
    if (!obj) return;
    const plan = this.plan(obj, p.raw);
    if (!plan.hop || !plan.piece) {
      toast(plan.reason, "info");
      return;
    }
    const verts = hopVertices(obj.shape!)!;
    const shape = withHop(verts, plan.piece, plan.hop);
    const id = obj.id;
    attempt("HopOver", (s) => s.replaceObjects([id], [shape]));
    this.target = null;
  }

  move(p: PointerInfo): void {
    this.pluginTarget = this.pluginHop(p);
    const obj = this.pluginTarget ? null : this.pick(p);
    this.target = obj ? this.plan(obj, p.raw) : null;
  }

  cancel(): void {
    this.target = null;
    this.pluginTarget = null;
  }

  overlay(g: Painter): void {
    const hop = this.pluginTarget;
    const t = hop ? { piece: null, hop: null, arc: hop.arc, at: hop.at } : this.target && { ...this.target, arc: this.target.hop && hopArc(this.target.hop) };
    if (!t) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.7;
    if (t.piece) strokeScreen(g, [t.piece.a, t.piece.b], false);
    if (t.arc) strokeScreen(g, t.arc, false);
    if (t.at) {
      // the crossing, ringed as Vectorworks marks it
      const c = g.toScreen(t.at);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** What a click on `obj` at `at` would do. */
  private plan(obj: ObjectInfo, at: Pt): Plan {
    const verts = obj.shape ? hopVertices(obj.shape) : null;
    const pieces = verts ? straightPieces(verts) : [];
    if (pieces.length === 0) return { obj, piece: null, at: null, hop: null, reason: UNSUPPORTED };
    const piece = pieces.reduce((best, q) => (distanceToPiece(at, q.a, q.b) < distanceToPiece(at, best.a, best.b) ? q : best));
    const path: CutPath = { kind: "chain", source: "line", pts: [piece.a, piece.b], closed: false };
    const hits = intersections(path, this.crossers(obj.id)).map((t) => pointAt(path, t));
    if (hits.length === 0) return { obj, piece, at: null, hop: null, reason: NOTHING };
    const near = hits.reduce((best, q) => (Math.hypot(q.x - at.x, q.y - at.y) < Math.hypot(best.x - at.x, best.y - at.y) ? q : best));
    const radius = this.radius();
    const reason = hopRefusal(piece, near, radius);
    if (reason) return { obj, piece, at: near, hop: null, reason };
    return { obj, piece, at: near, hop: hopPoints(piece, near, radius, this.downward), reason: "" };
  }

  /** the hop's radius on the drawing */
  private radius(): number {
    return this.radiusMm * (layerScale(this.env) ?? 1);
  }

  /**
   * What a click would do to the top-level plug-in object under the pointer that hops itself, or null
   * for none: the one selected hops instead when it crosses near the pointer.
   */
  private pluginHop(p: PointerInfo): PluginHop | null {
    const layerId = store.activeLayerId;
    const s = store.session;
    if (!layerId || !s || store.editGroupId) return null;
    const { scene, view } = this.env;
    const driverOf = (id: string) => pluginDriver(s.doc.records(id).find((r) => r.parametric)?.name ?? "");
    const hit = pickObject(scene, view, p.screen, [layerId]);
    // what a plug-in draws picks the plug-in
    const id = hit ? scene.topOf(hit) : null;
    const driver = id ? driverOf(id) : undefined;
    if (!id || !driver?.hopOver) return null;
    const [chosen] = store.selection.size === 1 ? store.selection : [];
    const first = chosen && chosen !== id && s.doc.object(chosen) ? driverOf(chosen) : undefined;
    const priority = first?.hopOver?.(chosen, p.raw, this.radius(), this.downward);
    if (priority?.at && Math.hypot(priority.at.x - p.raw.x, priority.at.y - p.raw.y) <= (3 * pickPx()) / view.scale) return priority;
    return driver.hopOver(id, p.raw, this.radius(), this.downward);
  }

  /** Outlines of the other visible objects on the active layer: what a line hops over. */
  private crossers(skip: string): CutPath[] {
    const layerId = store.activeLayerId;
    if (!layerId) return [];
    const scene = this.env.scene;
    const out: CutPath[] = [];
    for (const o of scene.index(layerId).objects) {
      if (o.id === skip || !o.shape || !scene.isObjectVisible(o)) continue;
      const path = pathOf(o.shape);
      if (path) out.push(path);
    }
    return out;
  }

  /** The topmost line of the active layer under the pointer: top-level, or in the group being edited; never symbol contents. */
  private pick(p: PointerInfo): ObjectInfo | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    const { scene, view } = this.env;
    const scope = store.editGroupId;
    const hit = pickObject(scene, view, p.screen, [layerId], (o) => {
      if (isDerivedId(o.id)) return false;
      return scope ? scene.unitOf(o, scope) !== null : o.parentId === null;
    });
    const path = hit?.shape ? pathOf(hit.shape) : null;
    if (!path || !hit) return null;
    const verts = hit.shape ? hopVertices(hit.shape) : null;
    const pieces = verts ? straightPieces(verts) : [];
    const near = pieces.length ? Math.min(...pieces.map((q) => distanceToPiece(p.raw, q.a, q.b))) : Infinity;
    return near <= pickPx() / view.scale || pieces.length === 0 ? hit : null;
  }
}
