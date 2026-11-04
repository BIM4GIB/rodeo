// View > Update Selected Viewports and Update All Viewports, and a viewport's right-click Update: the
// hidden-line viewports Rodeo draws (Create Section, Interior Elevation, Horizontal Section and
// Multiple Viewports, sectionViewport.ts) cut again from the model as it is now, through the same
// plane and of the same design layers, the classes hidden in the viewport (its own class visibility,
// else the drawing's) left out. The new drawing replaces the one before where that one stood, the
// viewport's box fitting it, and the rest of the viewport's annotations stays. Plan viewports draw
// live, and those read from Vectorworks files keep the drawing their file caches, so neither has
// anything to update. One undo step.

import type { BBox, Pt, VwxDocument } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { nextPaint } from "./dom.ts";
import { showLoading } from "./loading.ts";
import { sectionView, type CutMesh, type SectionDrawing, type SectionFrame } from "./sectionCut.ts";
import { drawSection, readSource, sectionHalves, sectionMeshes, type SectionSource } from "./sectionViewport.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";

/** The drawing Rodeo made in a viewport's annotations: its group, what it was cut from, and where it is now. */
interface Made {
  readonly id: string;
  readonly source: SectionSource;
  readonly box: BBox;
}

/** The drawing Rodeo made in viewport `vp`'s annotations, or null when it holds none. */
function madeIn(doc: VwxDocument, vp: string): Made | null {
  const notes = doc.openAnnotations(vp);
  if (!notes) return null;
  try {
    const all = doc.objects(notes);
    // it's a group: only groups need their records read
    for (const g of all) {
      if (g.shape) continue;
      const source = readSource(doc, g.id);
      if (!source) continue;
      const under = new Set([g.id]);
      let box: BBox | null = null;
      for (const o of all) {
        if (!o.parentId || !under.has(o.parentId)) continue;
        under.add(o.id);
        const b = o.shape?.bbox;
        if (b) box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : { ...b };
      }
      return box ? { id: g.id, source, box } : null;
    }
    return null;
  } finally {
    doc.openAnnotations(null);
  }
}

/** `frame` moved back along the way it looks till all of `meshes` is beyond it, as a view from outside must stay. */
function outsideOf(frame: SectionFrame, meshes: readonly CutMesh[]): SectionFrame {
  const [ox, oy, oz] = frame.origin;
  const [nx, ny, nz] = frame.toward;
  let near = Infinity;
  for (const m of meshes) {
    const t = m.triangles;
    for (let i = 0; i + 2 < t.length; i += 3) near = Math.min(near, (t[i] - ox) * nx + (t[i + 1] - oy) * ny + (t[i + 2] - oz) * nz);
  }
  if (!(near < 1)) return frame;
  const back = 1 - near + 1;
  return { ...frame, origin: [ox - nx * back, oy - ny * back, oz - nz * back] };
}

/** The viewports selected, or every one on a sheet layer. */
function viewportsOf(doc: VwxDocument, selected: boolean): string[] {
  if (selected) return [...store.selection].filter((id) => doc.viewport(id) !== null);
  return doc
    .layers()
    .filter((l) => l.kind === "sheet")
    .flatMap((l) => doc.viewportIds(l.id));
}

/** Updates the selected viewports (`selected`), or every viewport, or just `only`. */
export async function updateViewports(selected: boolean, only?: string): Promise<void> {
  const session = store.session;
  if (!session) return;
  if (store.symbolEdit) {
    toast("Leave the symbol or the viewport's annotations being edited first.", "info");
    return;
  }
  const doc = session.doc;
  const ids = only ? [only] : viewportsOf(doc, selected);
  const label = only ? "Update" : selected ? "Update Selected Viewports" : "Update All Viewports";
  const plans: { vp: string; made: Made; drawing: SectionDrawing & { box: BBox }; frame: SectionFrame; layers: string[] }[] = [];
  let others = 0;
  let empty = 0;
  const done = showLoading("Updating the viewports…");
  try {
    await nextPaint();
    const layerIds = new Set(doc.layers().map((l) => l.id));
    const docHidden = doc
      .classes()
      .filter((c) => c.visibility === "hidden")
      .map((c) => c.index);
    for (const vp of ids) {
      const info = doc.viewport(vp);
      const made = info && madeIn(doc, vp);
      if (!info || !made) {
        others++;
        continue;
      }
      // a class the viewport doesn't set keeps its own visibility
      const hidden = new Set(docHidden);
      for (const c of info.classes) {
        if (c.visibility === "hidden") hidden.add(c.index);
        else hidden.delete(c.index);
      }
      const layers = made.source.layers.filter((id) => layerIds.has(id));
      const meshes = sectionMeshes(layers, hidden);
      const frame = made.source.outside ? outsideOf(made.source.frame, meshes) : made.source.frame;
      const drawing = sectionView(meshes, frame);
      if (!drawing.box) {
        empty++;
        continue;
      }
      plans.push({ vp, made, drawing: { ...drawing, box: drawing.box }, frame, layers });
    }
  } catch (err) {
    toast(`The viewports couldn't be updated: ${errorMessage(err)}`);
    return;
  } finally {
    done();
  }
  if (store.session !== session) return;
  if (plans.length) {
    const r = attempt(label, (s) =>
      s.batch(() => {
        for (const { vp, made, drawing, frame, layers } of plans) {
          const info = s.doc.viewport(vp);
          if (!info) continue;
          // the new drawing goes where the old one stood, wherever that was moved to
          const off: Pt = { x: (made.box.x0 + made.box.x1 - made.source.box.x0 - made.source.box.x1) / 2, y: (made.box.y0 + made.box.y1 - made.source.box.y0 - made.source.box.y1) / 2 };
          const notes = s.doc.openAnnotations(vp);
          if (!notes) continue;
          try {
            s.deleteObjects([made.id]);
            drawSection(s, notes, drawing, (p) => ({ x: p.x + off.x, y: p.y + off.y }), { frame, layers, outside: made.source.outside });
          } finally {
            s.doc.openAnnotations(null);
          }
          // annotations are at the sheet × the scale
          const b = drawing.box;
          const { halfW, halfH } = sectionHalves(b, info.scale);
          const mid = { x: ((b.x0 + b.x1) / 2 + off.x) / info.scale, y: ((b.y0 + b.y1) / 2 + off.y) / info.scale };
          s.setViewportBox(vp, { x0: mid.x - halfW, y0: mid.y - halfH, x1: mid.x + halfW, y1: mid.y + halfH });
        }
      }),
    );
    if (!r) return;
  }
  const n = plans.length;
  const parts = [
    `${n} ${n === 1 ? "viewport" : "viewports"} updated`,
    ...(empty ? [`${empty} left as ${empty === 1 ? "it was" : "they were"}: nothing on ${empty === 1 ? "its" : "their"} layers is seen through ${empty === 1 ? "its" : "their"} plane now`] : []),
    ...(others && !only ? [`${others} ${others === 1 ? "draws" : "draw"} live or from ${others === 1 ? "its" : "their"} file`] : []),
  ];
  toast(only && others ? "This viewport draws live or from its file: it has nothing to update." : `${parts.join("; ")}.`, "info");
}

