// What Edit > Paste as Bitmap (images.ts) draws of the last Copy or Cut made here: the copied
// objects alone, as File > Export SVG draws them, at their layer's scale. A copy is drawn when it's
// pasted, so Copy stays quick; an edit made before then leaves it unknown. A cut is drawn as it's
// made, before its objects go.

import type { BBox, EditSession, ObjectInfo, VwxDocument } from "../core/index.ts";
import { exportSvg } from "../export/svg.ts";
import { withoutHidden } from "./hiddenObjects.ts";

/** The copied objects drawn: an SVG in drawing units, and their layer's scale (1:n gives n). */
export interface CopyPicture {
  readonly svg: string;
  readonly scale: number;
}

/** A Copy not drawn yet: what to draw, until the drawing changes. */
interface Pending {
  readonly session: EditSession;
  readonly layerId: string;
  readonly ids: readonly string[];
  readonly scale: number;
  changed: boolean;
  stop: () => void;
}

/** The last copy: drawn already (a cut), or waiting to be drawn (a copy). */
type Source = { readonly picture: CopyPicture } | Pending;

let source: Source | null = null;

/** the room left round the copied objects for their lines' widths, mm on paper */
const MARGIN_MM = 0.25;

/**
 * Where the copied objects lie in the drawing (y up): the SVG's box less the 2% the export pads
 * it by on every side, with a quarter millimetre on paper round them for their lines.
 */
export function copiedBounds(picture: CopyPicture): BBox {
  const tag = /<svg\b[^>]*>/i.exec(picture.svg)?.[0] ?? "";
  const [vx, vy, vw, vh] = (/viewBox="([^"]*)"/.exec(tag)?.[1] ?? "0 0 1 1").trim().split(/[\s,]+/).map(Number);
  // the export pads by 2% of the longer side (at least 1): w + 4% of max(w, h, 1)
  const pad = Math.max(vw, vh, 1.04) * (0.02 / 1.04);
  const m = MARGIN_MM * picture.scale;
  return { x0: vx + pad - m, x1: vx + vw - pad + m, y0: -(vy + vh) + pad - m, y1: -vy - pad + m };
}

/** The objects `ids`, with all they hold, on `layerId` drawn alone (hidden ones left out). */
export function drawObjects(doc: VwxDocument, layerId: string, ids: readonly string[]): string {
  const shown = withoutHidden(doc);
  const picked = new Set(ids);
  const known = new Map<string, boolean>();
  const inside = (o: ObjectInfo): boolean => {
    let v = known.get(o.id);
    if (v === undefined) {
      const parent = o.parentId === null ? null : shown.object(o.parentId);
      v = picked.has(o.id) || (parent !== null && inside(parent));
      known.set(o.id, v);
    }
    return v;
  };
  const only = new Proxy(shown, {
    get(target, prop) {
      if (prop === "objects") return (l: string) => target.objects(l).filter(inside);
      if (prop === "viewports") return (l: string) => target.viewports(l).filter((vp) => picked.has(vp.id));
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return exportSvg(only, [layerId]);
}

function forget(): void {
  if (source && "stop" in source) source.stop();
  source = null;
}

/** Edit > Copy made: the objects are drawn if they're pasted as a bitmap before the drawing changes. */
export function copiedFrom(session: EditSession, layerId: string, ids: readonly string[], scale: number): void {
  forget();
  const pending: Pending = { session, layerId, ids: [...ids], scale, changed: false, stop: () => undefined };
  pending.stop = session.onChange(() => {
    pending.changed = true;
    pending.stop();
  });
  source = pending;
}

/** Edit > Cut about to remove `ids`: they're drawn now, while they're there (a drawing that fails leaves no picture, not a failed cut). */
export function cutFrom(doc: VwxDocument, layerId: string, ids: readonly string[], scale: number): void {
  forget();
  try {
    source = { picture: { svg: drawObjects(doc, layerId, ids), scale } };
  } catch {
    source = null;
  }
}

/** The last copy drawn, null when nothing was copied here, or "changed" when the drawing changed since the Copy. */
export function copiedPicture(): CopyPicture | null | "changed" {
  if (!source) return null;
  if ("picture" in source) return source.picture;
  if (source.changed) return "changed";
  return { svg: drawObjects(source.session.doc, source.layerId, source.ids), scale: source.scale };
}
