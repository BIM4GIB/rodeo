// Model > Cut 2D Section and Cut 3D Section, as Vectorworks Fundamentals has them: with 3D objects
// selected, a line drawn across them and a click on the side to keep cut them with the upright
// plane through the line (carried on both ways), onto a new design layer; the model stays as it
// was.
//
// Cut 2D Section draws the cut as 2D objects, seen from the side given up, looking at the part
// kept. Each object's cut is grouped in its class, a part's closed cuts filled with its attributes
// (holes kept: the fill with them joined in, under outlines that draw the edges), open ones as open
// polygons. The section stands on the line's start: its ground runs from there the way the
// viewer's right hand points.
//
// Cut 3D Section keeps what of each object lies on that side, where it was, as a mesh closed over
// the cut (EditSession.cut3DSection), so the drawing needs a mesh to copy settings from.

import polygonClipping, { type Pair, type Polygon } from "polygon-clipping";
import type { Attributes, EditSession, NewShape, Pt, SectionCut } from "../core/index.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "./commands.ts";
import { canCreateContours, selectedCuttable } from "./compose.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { joinHoles } from "./surfaces.ts";
import { toast } from "./toast.ts";
import type { View } from "./view.ts";

/** The new layers' names, numbered past the names taken. */
const LAYER_NAME = "Section";
const LAYER_NAME_3D = "3D Section";

export function canCut2DSection(): boolean {
  return canCreateContours();
}

export function canCut3DSection(): boolean {
  return canCreateContours() && !!store.session?.canAddMeshes();
}

/** A new design layer named `base` (numbered when that is taken) at the active layer's scale. */
function sectionLayer(s: EditSession, base: string): { layerId: string; name: string } {
  const taken = new Set(s.doc.layers().map((l) => l.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  const scale = s.doc.layers().find((l) => l.id === store.activeLayerId)?.scale;
  return { layerId: s.createLayer(name, "design", scale), name };
}

/** A ring from polygon-clipping, without the first point it repeats at the end. */
function ringPoints(ring: readonly Pair[]): Pt[] {
  const pts = ring.map(([x, y]): Pt => ({ x, y }));
  const [first, last] = [pts[0], pts.at(-1)];
  if (pts.length > 1 && first.x === last!.x && first.y === last!.y) pts.pop();
  return pts;
}

/** One part's cut as shapes: its closed chains as areas (nested ones as holes), its open ones as lines. */
function partShapes(chains: SectionCut["parts"][number]["chains"], place: (p: Pt) => Pt, attrs: Partial<Attributes>): { shape: NewShape; attrs: Partial<Attributes> }[] {
  const out: { shape: NewShape; attrs: Partial<Attributes> }[] = [];
  const noPen = { ...attrs, lineStyle: 0 };
  const noFill = { ...attrs, fillPattern: 0 };
  const loops = chains.filter((c) => c.closed && c.points.length >= 3).map((c): Polygon => [c.points.map(place).map((p): Pair => [p.x, p.y])]);
  // even-odd: a loop inside another is a hole in it, one inside that an island again
  const areas = loops.length ? polygonClipping.xor(loops[0], ...loops.slice(1)) : [];
  for (const rings of areas) {
    const [outer, ...holes] = rings.map(ringPoints).filter((r) => r.length >= 3);
    if (!outer) continue;
    if (!holes.length) {
      out.push({ shape: { kind: "polygon", points: outer, closed: true }, attrs });
      continue;
    }
    // the fill with its holes joined in, without the pen that would draw the joins, then the outlines
    out.push({ shape: { kind: "polygon", points: joinHoles(outer, holes), closed: true }, attrs: noPen });
    for (const ring of [outer, ...holes]) out.push({ shape: { kind: "polygon", points: ring, closed: true }, attrs: noFill });
  }
  for (const c of chains) {
    if (c.closed || c.points.length < 2) continue;
    const pts = c.points.map(place);
    out.push({ shape: pts.length === 2 ? { kind: "line", a: pts[0], b: pts[1] } : { kind: "polygon", points: pts, closed: false }, attrs: noFill });
  }
  return out;
}

/**
 * Cuts the selected 3D objects with the upright plane through `a` and `b`, keeping the side left
 * of a → b (`keepLeft`) or right of it, onto a new design layer at the active layer's scale, which
 * becomes active with the cut selected.
 */
export function cut2DSection(a: Pt, b: Pt, keepLeft: boolean, scene: Scene, view: View): void {
  const ids = selectedCuttable();
  if (!ids.length) {
    toast("Cut 2D Section works on 3D objects, symbols and plug-in objects: select them first.", "info");
    return;
  }
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  // looking at the kept side, the viewer's right hand points along the line when the left side is kept
  const place = (p: Pt): Pt => ({ x: a.x + (keepLeft ? p.x : len - p.x), y: a.y + p.y });
  const r = attempt("Cut 2D Section", (s) =>
    s.batch(() => {
      const cuts = s.sectionCuts(ids, a, b);
      if (!cuts.length) throw new Error("the section line doesn't cross any of the selected objects in 3D");
      const { layerId, name } = sectionLayer(s, LAYER_NAME);
      // the objects' shapes, added a class at a time, then each object's grouped
      const byClass = new Map<number, { cut: number; shapes: NewShape[]; attrs: Partial<Attributes>[] }[]>();
      cuts.forEach((cut, k) => {
        const shapes: NewShape[] = [];
        const attrs: Partial<Attributes>[] = [];
        for (const part of cut.parts) {
          for (const piece of partShapes(part.chains, place, part.attrs ?? {})) {
            shapes.push(piece.shape);
            attrs.push(piece.attrs);
          }
        }
        if (!shapes.length) return;
        const list = byClass.get(cut.classIndex) ?? [];
        list.push({ cut: k, shapes, attrs });
        byClass.set(cut.classIndex, list);
      });
      const pieces: string[][] = [];
      for (const [cls, list] of byClass) {
        const added = s.addObjects(
          layerId,
          list.flatMap((l) => l.shapes),
          cls,
          list.flatMap((l) => l.attrs),
        );
        let at = 0;
        for (const l of list) {
          pieces.push(added.slice(at, at + l.shapes.length));
          at += l.shapes.length;
        }
      }
      if (!pieces.length) throw new Error("the section line doesn't cross any of the selected objects in 3D");
      const several = pieces.filter((p) => p.length > 1);
      const groups = s.groupEach(several);
      const made = pieces.map((p) => (p.length > 1 ? groups[several.indexOf(p)] : p[0]));
      return { layerId, name, made, missed: ids.length - pieces.length };
    }),
  );
  if (!r) return;
  const { layerId, name, made, missed } = r.value;
  setActiveLayer(layerId);
  setSelection(made);
  zoomToSelection(scene, view);
  const n = made.length;
  toast(`Cut ${n} ${n === 1 ? "object" : "objects"} onto the new layer ${name}${missed ? `; the line misses ${missed} more` : ""}.`, "info");
}

/**
 * Keeps what of each selected 3D object lies left of a → b (`keepLeft`) or right of it, as meshes
 * closed over the cut on a new design layer at the active layer's scale, which becomes active
 * with them selected.
 */
export function cut3DSection(a: Pt, b: Pt, keepLeft: boolean): void {
  const ids = selectedCuttable();
  if (!ids.length) {
    toast("Cut 3D Section works on 3D objects, symbols and plug-in objects: select them first.", "info");
    return;
  }
  const r = attempt("Cut 3D Section", (s) =>
    s.batch(() => {
      const { layerId, name } = sectionLayer(s, LAYER_NAME_3D);
      return { layerId, name, made: s.cut3DSection(ids, a, b, keepLeft, layerId) };
    }),
  );
  if (!r) return;
  const { layerId, name, made } = r.value;
  setActiveLayer(layerId);
  setSelection(made);
  const n = made.length;
  const gone = ids.length - n;
  toast(`Cut ${n} ${n === 1 ? "object" : "objects"} onto the new layer ${name}${gone > 0 ? `; ${gone} more lie wholly on the side given up` : ""}.`, "info");
}
