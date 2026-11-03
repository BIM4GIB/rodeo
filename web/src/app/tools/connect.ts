// Connect/Combine, with Vectorworks' three modes. Single Object Connect: click a line or arc
// near the end you want to change, then the object to connect it to. The clicked end moves to
// the crossing nearest to it between the second object and the first one's line (or circle, for
// an arc), so the first object is extended or trimmed. Dual Object Connect: click two lines or
// arcs, each near the end to change; both ends move to where their lines or circles meet. Dual
// Object Combine does the same to two lines and joins them into one polyline. Hovering the
// second object previews the result. Objects keep their class and attributes (a combined
// polyline takes the first line's). Esc drops the first pick. Objects that never meet are
// refused.

import type { NewShape, ObjectInfo, Pt } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import {
  isLineOrArc,
  meetExtended,
  meetPoint,
  moveEnd,
  nearerEnd,
  pathOf,
  pathOutline,
  pointAt,
  shapeOutline,
  type CutPath,
} from "../cutting.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import {
  BaseTool,
  modeForKey,
  strokeScreen,
  withPreview,
  type Painter,
  type PointerInfo,
  type ToolModes,
} from "../tools.ts";

/** The first object as picked: its id and the end that moves. */
interface First {
  readonly id: string;
  readonly end: 0 | 1;
}

/** The first object as it is now. */
interface Current {
  readonly id: string;
  readonly end: 0 | 1;
  readonly path: CutPath;
}

/** The objects' new shapes, each with its id, or why the two cannot be connected. */
type Outcome = { readonly edits: readonly { readonly id: string; readonly shape: NewShape }[] } | { readonly reason: string };

type ConnectMode = "single" | "dual" | "combine";

function isConnectMode(id: string): id is ConnectMode {
  return id === "single" || id === "dual" || id === "combine";
}

const NOT_CONNECTABLE = "Connect extends a line or an arc.";
const NO_SECOND = "Connect meets lines, arcs, polylines, polygons, rectangles and circles.";
const NEVER_MEET = "Those two never meet, so there is nothing to connect to.";
const LEAVES_NOTHING = "That would leave nothing of the first object.";
const LEAVES_NOTHING_SECOND = "That would leave nothing of the second object.";
const DUAL_SECOND = "Dual Object Connect meets a line or an arc.";
const COMBINE_LINES = "Dual Object Combine joins two lines.";

export class ConnectTool extends BaseTool {
  readonly id = "connect";
  readonly cursor = "crosshair";

  /** the first object once picked; null while choosing one */
  private first: First | null = null;
  /** the object under the pointer, with its path when it can be connected */
  private hover: { readonly id: string; readonly path: CutPath } | null = null;
  /** the new shapes while the pointer is on the second object */
  private preview: readonly NewShape[] = [];
  private mode: ConnectMode = "single";

  modes(): ToolModes {
    return {
      options: [
        { id: "single", label: "Single Object Connect", key: "1" },
        { id: "dual", label: "Dual Object Connect", key: "2" },
        { id: "combine", label: "Dual Object Combine", key: "3" },
      ],
      active: this.mode,
    };
  }

  setMode(id: string): void {
    if (!isConnectMode(id)) return;
    this.mode = id;
    this.preview = [];
  }

  hint(): string {
    const first = this.mode === "combine" ? "Click near the end of a line" : "Click near the end of a line or arc";
    if (!this.first) return `${first} · 1–3 mode`;
    if (this.mode === "single") return "Click the object to connect to";
    return this.mode === "dual" ? "Click near the end of the other line or arc" : "Click near the end of the other line";
  }

  down(p: PointerInfo): void {
    const obj = this.pick(p.screen);
    if (!obj) {
      // symbol contents are never picked; say why the click does nothing
      if (this.overSymbol(p)) toast(this.first ? NO_SECOND : NOT_CONNECTABLE, "info");
      return;
    }
    const path = obj.shape ? pathOf(obj.shape) : null;
    if (!this.first) {
      if (!path || !isLineOrArc(path) || (this.mode === "combine" && path.kind !== "chain")) {
        toast(this.mode === "combine" ? COMBINE_LINES : NOT_CONNECTABLE, "info");
        return;
      }
      this.first = { id: obj.id, end: nearerEnd(path, p.raw) };
      return;
    }
    const first = this.current();
    if (!first) {
      this.first = null;
      return;
    }
    if (obj.id === first.id) return;
    if (!path) {
      toast(NO_SECOND, "info");
      return;
    }
    const out = this.outcome(first, obj.id, path, p.raw);
    if ("reason" in out) {
      toast(out.reason, "info");
      return;
    }
    if (this.mode === "combine") {
      // the polyline takes the first line's place, id, class and attributes
      const [a, b] = out.edits;
      attempt("Combine", (s) => s.replaceObjects([a.id, b.id], [a.shape]));
    } else {
      // one undo step; each object keeps its id, class and attributes
      attempt("Connect", (s) => s.batch(() => out.edits.forEach((e) => s.setGeometry(e.id, e.shape))));
    }
    this.first = null;
    this.preview = [];
  }

  move(p: PointerInfo): void {
    const obj = this.pick(p.screen);
    const path = obj?.shape ? pathOf(obj.shape) : null;
    this.hover = obj && path ? { id: obj.id, path } : null;
    const first = this.current();
    this.preview = [];
    if (first && this.hover && this.hover.id !== first.id) {
      const out = this.outcome(first, this.hover.id, this.hover.path, p.raw);
      // a combined polyline is the first edit; it replaces both lines
      if ("edits" in out) this.preview = out.edits.slice(0, this.mode === "combine" ? 1 : undefined).map((e) => e.shape);
    }
  }

  cancel(): void {
    this.first = null;
    this.hover = null;
    this.preview = [];
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || this.first === null) return false;
    this.first = null;
    this.preview = [];
    return true;
  }

  overlay(g: Painter): void {
    const first = this.current();
    if (!first) {
      // choosing the first object: outline a line or arc under the pointer
      if (this.hover && isLineOrArc(this.hover.path)) {
        const outline = pathOutline(this.hover.path);
        highlight(g, () => strokeScreen(g, outline.pts, outline.closed));
      }
      return;
    }
    const outline = pathOutline(first.path);
    highlight(g, () => strokeScreen(g, outline.pts, outline.closed));
    if (!this.hover || this.hover.id === first.id) return;
    const other = pathOutline(this.hover.path);
    highlight(g, () => strokeScreen(g, other.pts, other.closed));
    for (const shape of this.preview) {
      const next = shapeOutline(shape);
      if (next) withPreview(g, () => strokeScreen(g, next.pts, next.closed));
    }
  }

  /**
   * What connecting `first` to the object `id` (whose path is `second`, picked at `at`) makes, in
   * this mode: the first object with its end moved to meet the second; both with their nearer
   * ends moved to where they meet; or, combining, one polyline through both lines' far ends and
   * the meeting point.
   */
  private outcome(first: Current, id: string, second: CutPath, at: Pt): Outcome {
    const near = pointAt(first.path, first.end);
    if (this.mode === "single") {
      const to = meetPoint(first.path, second, near);
      if (!to) return { reason: NEVER_MEET };
      const shape = moveEnd(first.path, first.end, to);
      return shape ? { edits: [{ id: first.id, shape }] } : { reason: LEAVES_NOTHING };
    }
    if (!isLineOrArc(second)) return { reason: DUAL_SECOND };
    if (this.mode === "combine" && second.kind !== "chain") return { reason: COMBINE_LINES };
    const to = meetExtended(first.path, second, near);
    if (!to) return { reason: NEVER_MEET };
    const end = nearerEnd(second, at);
    const a = moveEnd(first.path, first.end, to);
    const b = moveEnd(second, end, to);
    if (!a) return { reason: LEAVES_NOTHING };
    if (!b) return { reason: LEAVES_NOTHING_SECOND };
    if (this.mode === "dual") return { edits: [{ id: first.id, shape: a }, { id, shape: b }] };
    const points = [pointAt(first.path, first.end === 0 ? 1 : 0), to, pointAt(second, end === 0 ? 1 : 0)];
    return { edits: [{ id: first.id, shape: { kind: "polyline", points, closed: false } }, { id, shape: b }] };
  }

  /** The first object as it is now, or null when it is gone or no longer a line or arc on this layer. */
  private current(): Current | null {
    if (!this.first) return null;
    const obj = store.session?.doc.object(this.first.id);
    const path = obj?.shape ? pathOf(obj.shape) : null;
    if (!obj || !path || !isLineOrArc(path) || obj.layerId !== store.activeLayerId) return null;
    return { id: obj.id, end: this.first.end, path };
  }

  /** True when the pointer is over symbol contents: they are never picked, but a click says why nothing happens. */
  private overSymbol(p: PointerInfo): boolean {
    const layerId = store.activeLayerId;
    if (!layerId) return false;
    const { scene, view } = this.env;
    return pickObject(scene, view, p.screen, [layerId], (o) => isDerivedId(o.id)) !== null;
  }

  /**
   * Topmost object of the active layer under `screen`: top-level objects, or the
   * children of the group being edited. Symbol contents are never picked.
   */
  private pick(screen: Pt): ObjectInfo | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    const { scene, view } = this.env;
    const scope = store.editGroupId;
    return pickObject(scene, view, screen, [layerId], (o) => {
      if (isDerivedId(o.id)) return false;
      return scope ? scene.unitOf(o, scope) !== null : o.parentId === null;
    });
  }
}

/** Solid accent stroke for the objects the tool is using or hovering over. */
function highlight(g: Painter, draw: () => void): void {
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  draw();
  ctx.restore();
}
