// Reshape tool: Vectorworks' 2D Reshape tool, for the selected lines, polygons and polylines.
// Move Vertices boxes vertices to pick them (Shift adds) and drags a picked one to move them
// all, across the selected objects at once; Delete removes the picked ones. Move Edge drags an
// edge with both its vertices. Change Vertex clicks a vertex to make it the chosen type (a
// polygon becomes a polyline). Add Vertex drags a new vertex, of the chosen type, out of an
// edge's midpoint. Delete Vertex clicks vertices away. Clicking off the grips selects the
// object there.

import type { EditSession, NewShape, ObjectInfo, Pt, Shape, VertexKind, VwxDocument } from "../../core/index.ts";
import { attempt, setActiveLayer, setSelection } from "../commands.ts";
import { pluginDriver } from "../ext.ts";
import { dist, distToSegment, normalizeRect } from "../geom.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT, HANDLE_PX } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { deleteVertices, insertVertex, moveVertices, setVertexKind } from "../shapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { BaseTool, modeForKey, type Painter, type PointerInfo, type ToolEnv, type ToolModes } from "../tools.ts";
import { drawReshaped } from "./select.ts";

const PLUGIN = 86;

type ReshapeMode = "vertices" | "edge" | "change" | "add" | "delete";
type VertexType = Extract<VertexKind, "corner" | "bezier" | "arc">;

const MODES: readonly { id: ReshapeMode; label: string }[] = [
  { id: "vertices", label: "Move Vertices" },
  { id: "edge", label: "Move Edge" },
  { id: "change", label: "Change Vertex" },
  { id: "add", label: "Add Vertex" },
  { id: "delete", label: "Delete Vertex" },
];
const VERTEX_TYPES: readonly { id: VertexType; label: string }[] = [
  { id: "corner", label: "Corner" },
  { id: "bezier", label: "Bezier" },
  { id: "arc", label: "Arc" },
];
/** pointer travel (CSS px) below which a press is a click, not a drag */
const DRAG_PX = 3;
const PICK_PX = HANDLE_PX / 2 + 3;

/** A selected object the tool reshapes, with its vertices and edge midpoints in world coordinates. */
interface Target {
  readonly obj: ObjectInfo;
  readonly shape: Shape;
  readonly vertices: readonly Pt[];
  /** edge i runs from vertex i to the next (a closed shape's last back to its first) */
  readonly edges: number;
  readonly midpoints: readonly Pt[];
  /** a plug-in's own path takes its new corners this way */
  readonly setPath?: (s: EditSession, corners: readonly Pt[]) => void;
}

interface VertexHit {
  readonly target: Target;
  readonly index: number;
}

type Gesture =
  | { readonly kind: "box"; readonly start: Pt; readonly startScreen: Pt; end: Pt; readonly shift: boolean }
  | {
      readonly kind: "move";
      readonly label: string;
      /** the point that follows the pointer: the pressed vertex, or the press on an edge */
      readonly anchor: Pt;
      readonly startScreen: Pt;
      /** vertex indices by object id */
      readonly moving: ReadonlyMap<string, ReadonlySet<number>>;
      to: Pt;
      dragged: boolean;
    }
  | { readonly kind: "add"; readonly target: Target; readonly edge: number; readonly startScreen: Pt; to: Pt };

export class ReshapeTool extends BaseTool {
  readonly id = "reshape";
  readonly cursor = "default";

  private mode: ReshapeMode = "vertices";
  private vertexType: VertexType = "corner";
  /** Move Vertices' picked vertices, by object id */
  private readonly picked = new Map<string, Set<number>>();
  private gesture: Gesture | null = null;
  /** the pointer while no button is down, for the hover highlight */
  private hover: Pt | null = null;

  constructor(env: ToolEnv) {
    super(env);
    store.on("selection", () => this.picked.clear());
  }

  modes(): ToolModes[] {
    return [
      { options: MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode },
      { label: "Vertex", options: VERTEX_TYPES, active: this.vertexType },
    ];
  }

  setMode(id: string): void {
    const mode = MODES.find((m) => m.id === id);
    if (mode) {
      this.gesture = null;
      this.mode = mode.id;
    }
    const type = VERTEX_TYPES.find((t) => t.id === id);
    if (type) this.vertexType = type.id;
  }

  hint(): string {
    if (this.targets().length === 0) return "Select lines, polygons or polylines to reshape · 1–5 mode";
    const type = VERTEX_TYPES.find((t) => t.id === this.vertexType)?.label.toLowerCase() ?? "";
    switch (this.mode) {
      case "vertices":
        if (this.gesture?.kind === "move") return "Release to move the vertices";
        return this.pickedCount() > 0
          ? "Drag a picked vertex to move them all · Shift adds · Delete removes them"
          : "Box or click vertices to pick them · Shift adds";
      case "edge":
        return this.gesture ? "Release to move the edge" : "Drag an edge to move it";
      case "change":
        return `Click a vertex to make it ${type}`;
      case "add":
        return this.gesture ? "Release to add the vertex" : `Drag from an edge's midpoint to add a ${type} vertex`;
      case "delete":
        return "Click a vertex to delete it";
    }
  }

  down(p: PointerInfo): void {
    this.hover = null;
    const targets = this.targets();
    switch (this.mode) {
      case "vertices": {
        const v = vertexAt(this.env, targets, p.screen);
        if (!v) break;
        const id = v.target.obj.id;
        if (this.isPicked(v)) {
          if (p.shift) {
            this.picked.get(id)?.delete(v.index);
            return;
          }
        } else {
          if (!p.shift) this.picked.clear();
          this.pick(id, v.index);
        }
        this.startMove(p, "Move vertices", v.target.vertices[v.index], this.picked);
        return;
      }
      case "edge": {
        const e = edgeAt(this.env, targets, p.screen);
        if (!e) break;
        const ends = new Set([e.index, (e.index + 1) % e.target.vertices.length]);
        this.startMove(p, "Move edge", p.pos, new Map([[e.target.obj.id, ends]]));
        return;
      }
      case "change": {
        const v = vertexAt(this.env, targets, p.screen);
        if (!v) break;
        this.changeVertex(v);
        return;
      }
      case "add": {
        const m = midpointAt(this.env, targets, p.screen);
        if (!m) break;
        this.gesture = { kind: "add", target: m.target, edge: m.index, startScreen: p.screen, to: m.target.midpoints[m.index] };
        return;
      }
      case "delete": {
        const v = vertexAt(this.env, targets, p.screen);
        if (!v) break;
        this.removeVertices(new Map([[v.target.obj.id, new Set([v.index])]]), "Delete vertex");
        return;
      }
    }
    // not on a grip: Move Vertices starts a box, over objects or not; elsewhere it is a click
    if (this.mode === "vertices") this.gesture = { kind: "box", start: p.raw, startScreen: p.screen, end: p.raw, shift: p.shift };
    else this.clickAt(p.screen, p.shift);
  }

  move(p: PointerInfo): void {
    const g = this.gesture;
    if (!g) {
      this.hover = p.screen;
      return;
    }
    if (g.kind === "box") {
      g.end = p.raw;
    } else if (g.kind === "move") {
      if (!g.dragged && dist(p.screen, g.startScreen) >= DRAG_PX) g.dragged = true;
      g.to = p.pos;
    } else if (dist(p.screen, g.startScreen) >= DRAG_PX) {
      g.to = p.pos;
    }
  }

  up(p: PointerInfo): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    if (g.kind === "box") {
      if (dist(p.screen, g.startScreen) < DRAG_PX) {
        this.clickAt(g.startScreen, g.shift);
        return;
      }
      this.pickInBox(normalizeRect(g.start, p.raw), g.shift);
      return;
    }
    if (g.kind === "move") {
      const d = { x: g.to.x - g.anchor.x, y: g.to.y - g.anchor.y };
      if (!g.dragged || (d.x === 0 && d.y === 0)) return;
      this.moveAll(g.moving, d, g.label);
      return;
    }
    const next = insertVertex(g.target.shape, g.edge, g.to, g.target.setPath ? "corner" : this.vertexType);
    if (next) this.commit(g.target, next, "Add vertex");
  }

  cancel(): void {
    this.gesture = null;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key === "Escape") {
      if (this.gesture) this.gesture = null;
      else if (this.pickedCount() > 0) this.picked.clear();
      else return false;
      return true;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && this.mode === "vertices" && this.pickedCount() > 0 && !this.gesture) {
      this.removeVertices(this.picked, "Delete vertices");
      return true;
    }
    return false;
  }

  overlay(g: Painter): void {
    const targets = this.targets();
    const gesture = this.gesture;
    if (gesture?.kind === "move" && gesture.dragged) {
      const d = { x: gesture.to.x - gesture.anchor.x, y: gesture.to.y - gesture.anchor.y };
      for (const t of targets) {
        const set = gesture.moving.get(t.obj.id);
        const next = set ? moveVertices(t.shape, set, d) : null;
        if (next) drawReshaped(g, next);
      }
    } else if (gesture?.kind === "add") {
      const next = insertVertex(gesture.target.shape, gesture.edge, gesture.to, this.vertexType);
      if (next) drawReshaped(g, next);
    }
    const { ctx } = g;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ACCENT;
    // the edge or vertex the pointer is over
    if (this.hover && !gesture) {
      if (this.mode === "edge") {
        const e = edgeAt(this.env, targets, this.hover);
        if (e) {
          const a = g.toScreen(e.target.vertices[e.index]);
          const b = g.toScreen(e.target.vertices[(e.index + 1) % e.target.vertices.length]);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.lineWidth = 1.5;
        }
      } else if (this.mode === "change" || this.mode === "delete") {
        const v = vertexAt(this.env, targets, this.hover);
        if (v) square(g, v.target.vertices[v.index], HANDLE_PX + 6, "ring");
      } else if (this.mode === "add") {
        const m = midpointAt(this.env, targets, this.hover);
        if (m) square(g, m.target.midpoints[m.index], HANDLE_PX + 4, "ring");
      }
    }
    for (const t of targets) {
      if (this.mode === "add") for (const mp of t.midpoints) square(g, mp, HANDLE_PX - 2, "hollow");
      const picked = this.picked.get(t.obj.id);
      t.vertices.forEach((v, i) => square(g, v, HANDLE_PX, this.mode === "vertices" && picked?.has(i) ? "filled" : "hollow"));
    }
    if (gesture?.kind === "box") {
      const a = g.toScreen(gesture.start);
      const b = g.toScreen(gesture.end);
      ctx.lineWidth = 1;
      ctx.fillStyle = "rgba(47, 111, 219, 0.10)";
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }
    ctx.restore();
  }

  // ---- targets and picking ---------------------------------------------------------

  /** The selected lines, polygons and polylines. */
  private targets(): Target[] {
    const { scene } = this.env;
    const doc = scene.document;
    if (!doc) return [];
    const out: Target[] = [];
    for (const id of store.selection) {
      const obj = isDerivedId(id) ? null : doc.object(id);
      const own = obj && !obj.shape ? pluginTarget(doc, obj) : null;
      if (own) {
        out.push(own);
        continue;
      }
      const shape = obj?.shape;
      if (!obj || !shape || (shape.kind !== "line" && shape.kind !== "polygon" && shape.kind !== "polyline")) continue;
      const geom = scene.geometry(obj);
      if (!geom || geom.handles.length < 2) continue;
      const n = geom.handles.length;
      const edges = shape.kind !== "line" && shape.closed ? n : n - 1;
      out.push({ obj, shape, vertices: geom.handles, edges, midpoints: geom.edges });
    }
    return out;
  }

  /** A click off the grips: selects the object there (Shift adds it), or nothing. */
  private clickAt(screen: Pt, shift: boolean): void {
    const hit = this.objectAt(screen);
    if (hit) setSelection(shift ? [...store.selection, hit] : [hit]);
    else if (!shift) setSelection([]);
  }

  private objectAt(screen: Pt): string | null {
    const { scene, view } = this.env;
    const active = store.activeLayerId;
    if (!active) return null;
    const scope = store.editGroupId;
    const hit = scope
      ? pickObject(scene, view, screen, [active], (o) => scene.unitOf(o, scope) !== null)
      : pickObject(scene, view, screen, scene.pickableLayers(active));
    if (!hit) return null;
    if (hit.layerId !== store.activeLayerId) setActiveLayer(hit.layerId);
    return scene.unitOf(hit, store.editGroupId);
  }

  private isPicked(v: VertexHit): boolean {
    return this.picked.get(v.target.obj.id)?.has(v.index) ?? false;
  }

  private pick(id: string, index: number): void {
    let set = this.picked.get(id);
    if (!set) this.picked.set(id, (set = new Set()));
    set.add(index);
  }

  private pickedCount(): number {
    let n = 0;
    for (const set of this.picked.values()) n += set.size;
    return n;
  }

  /** Picks the vertices inside `box` (world coordinates), added to those picked with Shift. */
  private pickInBox(box: { x0: number; y0: number; x1: number; y1: number }, add: boolean): void {
    if (!add) this.picked.clear();
    for (const t of this.targets()) {
      t.vertices.forEach((v, i) => {
        if (v.x >= box.x0 && v.x <= box.x1 && v.y >= box.y0 && v.y <= box.y1) this.pick(t.obj.id, i);
      });
    }
  }

  private startMove(p: PointerInfo, label: string, anchor: Pt, moving: ReadonlyMap<string, ReadonlySet<number>>): void {
    this.gesture = { kind: "move", label, anchor, startScreen: p.screen, moving, to: anchor, dragged: false };
  }

  // ---- changes ---------------------------------------------------------------------

  /** Moves the vertices `moving` of each target by `d`, in one undo step. */
  private moveAll(moving: ReadonlyMap<string, ReadonlySet<number>>, d: Pt, label: string): void {
    const jobs: { t: Target; next: NewShape }[] = [];
    for (const t of this.targets()) {
      const set = moving.get(t.obj.id);
      const next = set ? moveVertices(t.shape, set, d) : null;
      if (next) jobs.push({ t, next });
    }
    if (jobs.length === 0) return;
    attempt(label, (s) =>
      s.batch(() => {
        for (const j of jobs) write(s, j.t, j.next);
      }),
    );
  }

  /** Deletes the vertices `which` of each target, in one undo step; a shape that would keep too few keeps them all. */
  private removeVertices(which: ReadonlyMap<string, ReadonlySet<number>>, label: string): void {
    const jobs: { t: Target; next: NewShape }[] = [];
    let refused = false;
    for (const t of this.targets()) {
      const set = which.get(t.obj.id);
      if (!set || set.size === 0) continue;
      const next = deleteVertices(t.shape, set);
      if (next) jobs.push({ t, next });
      else refused = true;
    }
    if (refused) toast(jobs.length > 0 ? "Some shapes would keep too few vertices, so they keep them all." : "That would leave too few vertices.", "info");
    if (jobs.length === 0) return;
    this.picked.clear();
    attempt(label, (s) =>
      s.batch(() => {
        for (const j of jobs) write(s, j.t, j.next);
      }),
    );
  }

  /** Makes the vertex the chosen type. An open shape's ends stay corners. */
  private changeVertex(v: VertexHit): void {
    const { shape } = v.target;
    if (v.target.setPath) {
      toast("This object's path has only corners.", "info");
      return;
    }
    const n = v.target.vertices.length;
    if (shape.kind === "line" || (!shape.closed && (v.index === 0 || v.index === n - 1))) {
      toast("The ends of a line or an open shape are always corners.", "info");
      return;
    }
    const kind = shape.kind === "polyline" ? (shape.vertices?.[v.index]?.kind ?? "corner") : "corner";
    if (kind === this.vertexType) return;
    const next = setVertexKind(shape, v.index, this.vertexType);
    if (next) this.commit(v.target, next, "Change vertex");
  }

  /** Writes the target's new geometry; a polygon that has become a polyline is replaced by one, kept selected. */
  private commit(t: Target, next: NewShape, label: string): void {
    const id = t.obj.id;
    if (next.kind === t.shape.kind) {
      attempt(label, (s) => s.batch(() => write(s, t, next)));
      return;
    }
    const r = attempt(label, (s) => s.replaceObjects([id], [next]));
    if (r) setSelection([...[...store.selection].filter((x) => x !== id), ...r.value]);
  }
}

/** A plug-in that shows its path to the tool, as a polygon of its corners. */
function pluginTarget(doc: VwxDocument, obj: ObjectInfo): Target | null {
  if (obj.type !== PLUGIN) return null;
  const driver = pluginDriver(doc.records(obj.id).find((r) => r.parametric)?.name ?? "");
  const path = driver?.path?.(obj.id);
  const setPath = driver?.setPath;
  if (!path || !setPath || path.points.length < 2) return null;
  const points = [...path.points];
  const edges = path.closed ? points.length : points.length - 1;
  const midpoints = Array.from({ length: edges }, (_, i) => {
    const [a, b] = [points[i], points[(i + 1) % points.length]];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  });
  return { obj, shape: { kind: "polygon", points, closed: path.closed } as Shape, vertices: points, edges, midpoints, setPath: (s, corners) => setPath(s, obj.id, corners) };
}

/** Writes a reshaped target. */
function write(s: EditSession, t: Target, next: NewShape): void {
  if (t.setPath) t.setPath(s, (next as { points: readonly Pt[] }).points);
  else s.setGeometry(t.obj.id, next);
}

/** The vertex nearest the pointer, within reach. */
function vertexAt(env: ToolEnv, targets: readonly Target[], screen: Pt): VertexHit | null {
  return nearest(env, targets, screen, (t) => t.vertices);
}

/** The edge midpoint nearest the pointer, within reach (polygons and polylines). */
function midpointAt(env: ToolEnv, targets: readonly Target[], screen: Pt): VertexHit | null {
  return nearest(env, targets, screen, (t) => t.midpoints);
}

function nearest(env: ToolEnv, targets: readonly Target[], screen: Pt, points: (t: Target) => readonly Pt[]): VertexHit | null {
  let best: VertexHit | null = null;
  let bestD = PICK_PX;
  for (const target of targets) {
    points(target).forEach((p, index) => {
      const d = dist(env.view.toScreen(p), screen);
      if (d < bestD) {
        best = { target, index };
        bestD = d;
      }
    });
  }
  return best;
}

/** The edge nearest the pointer, within reach; a curved polyline's edges are its control lines. */
function edgeAt(env: ToolEnv, targets: readonly Target[], screen: Pt): VertexHit | null {
  let best: VertexHit | null = null;
  let bestD = PICK_PX;
  for (const target of targets) {
    const n = target.vertices.length;
    for (let index = 0; index < target.edges; index++) {
      const a = env.view.toScreen(target.vertices[index]);
      const b = env.view.toScreen(target.vertices[(index + 1) % n]);
      const d = distToSegment(screen, a, b);
      if (d < bestD) {
        best = { target, index };
        bestD = d;
      }
    }
  }
  return best;
}

/** A grip: white with an accent edge, filled accent when picked, or an accent ring for the hover. */
function square(g: Painter, p: Pt, size: number, style: "hollow" | "filled" | "ring"): void {
  const { ctx } = g;
  const s = g.toScreen(p);
  const half = size / 2;
  if (style !== "ring") {
    ctx.fillStyle = style === "filled" ? ACCENT : "#ffffff";
    ctx.fillRect(s.x - half, s.y - half, size, size);
  }
  ctx.strokeRect(s.x - half + 0.5, s.y - half + 0.5, size - 1, size - 1);
}
