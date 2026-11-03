// View > Create Section Viewport…: with a Section-Elevation Line selected (Dims/Notes' tool), or a
// plain line or polyline, a viewport on a sheet layer of the 3D model cut by an upright plane along it,
// looking the way its arrows point (or the way chosen), drawn hidden-line (sectionCut.ts): what's cut
// filled in its colour with a heavier outline, the edges beyond in thin black lines. Vectorworks keeps
// a section viewport live with the model; Rodeo's viewports draw only plans live, so the section is
// drawn into the new viewport's annotations as the model stands when it's made, as Create Rack
// Elevation's are, and its design layers are hidden. A line with corners is cut straight between its
// ends, and only across its length.

import type { Attributes, BBox, NewShape, Pt } from "../core/index.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "./commands.ts";
import { firstFree, NEW_SHEET, viewportClasses, viewportNamesTaken } from "./createViewport.ts";
import { nextPaint } from "./dom.ts";
import { appContext } from "./ext.ts";
import { unionBBox } from "./geom.ts";
import { withoutHidden } from "./hiddenObjects.ts";
import { showLoading } from "./loading.ts";
import { drawingLabel } from "./markerShapes.ts";
import { colorMatcher } from "./pdfImport.ts";
import { sectionDrawing, type SectionDrawing } from "./sectionCut.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";
import { addPart } from "./tools/detailing.ts";
import { BUBBLE_MM, LABEL_LINE_MM, markerParts } from "./tools/markers.ts";

/** paper round the drawing inside the viewport, and between a new viewport and what's on its sheet, mm */
const MARGIN_MM = 10;
const GAP_MM = 20;
/** line weights, mils: the cut's outline and the lines beyond */
const CUT_MILS = 14;
const LINE_MILS = 5;

/** The line the section is cut along and what it says, or why there's none. */
interface Source {
  readonly a: Pt;
  readonly b: Pt;
  readonly layerId: string;
  /** the side its arrows point to, when it has any */
  readonly look: "left" | "right" | null;
  /** a section line's drawing number, from its bubble */
  readonly number: string | null;
}

const pick = "Select a Section-Elevation Line, or a line or polyline to cut the model along.";

function lineSource(): Source | string {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return pick;
  const obj = doc.object([...store.selection][0]);
  if (!obj) return pick;
  const layer = doc.layers().find((l) => l.id === obj.layerId);
  if (!layer || layer.kind === "sheet") return "Draw the section line on a design layer.";
  const ends = (pts: readonly Pt[]): Source | string => {
    const a = pts[0];
    const b = pts[pts.length - 1];
    return a && b && Math.hypot(b.x - a.x, b.y - a.y) > 0 ? { a, b, layerId: layer.id, look: null, number: null } : pick;
  };
  const s = obj.shape;
  if (s && (s.kind === "line" || ((s.kind === "polygon" || s.kind === "polyline") && !s.closed))) return ends(s.points);
  if (obj.kind !== "group") return pick;
  // a Section-Elevation Line: its lines in the order drawn, its arrows filled, its numbers in its bubbles
  const inGroup = new Set([obj.id]);
  const parts = doc.objects(layer.id).filter((o) => {
    if (o.parentId === null || !inGroup.has(o.parentId)) return false;
    inGroup.add(o.id);
    return true;
  });
  const lines = parts.filter((o) => o.shape && (o.shape.kind === "line" || ((o.shape.kind === "polyline" || o.shape.kind === "polygon") && !o.shape.closed)));
  if (!lines.length) return pick;
  const first = lines[0].shape!.points;
  const last = lines[lines.length - 1].shape!.points;
  const src = ends([first[0], last[last.length - 1]]);
  if (typeof src === "string") return src;
  const ux = src.b.x - src.a.x;
  const uy = src.b.y - src.a.y;
  let side = 0;
  for (const o of parts) {
    const pts = o.shape?.points ?? [];
    if (!(o.shape?.closed && (o.attrs?.fillPattern ?? 0) !== 0 && pts.length >= 3)) continue;
    const c = pts.reduce((m, p) => ({ x: m.x + p.x / pts.length, y: m.y + p.y / pts.length }), { x: 0, y: 0 });
    side += Math.sign(ux * (c.y - src.a.y) - uy * (c.x - src.a.x));
  }
  const number = parts.find((o) => o.shape?.kind === "text" && o.shape.text?.trim())?.shape?.text?.trim() ?? null;
  return { ...src, look: side > 0 ? "left" : side < 0 ? "right" : null, number };
}

/** What's on a sheet already, together. */
function sheetBox(sheetId: string): BBox | null {
  const scene = appContext()?.scene;
  let box: BBox | null = null;
  for (const e of scene?.topLevelEntries(sheetId, null) ?? []) if (e.bbox) box = unionBBox(box, e.bbox);
  return box;
}

/** The section of the 3D model the design layers the 3D view shows hold, their classes shown. */
function cutModel(src: Source, look: "left" | "right", depth: number): SectionDrawing {
  const session = store.session!;
  const ctx = appContext();
  let layers = ctx?.scene.drawnLayers(store.activeLayerId).filter((l) => l.kind === "design") ?? [];
  if (!layers.length) layers = session.doc.layers().filter((l) => l.kind === "design" && l.visibility !== "hidden");
  const shown = new Set(layers.map((l) => l.id));
  const hiddenClasses = new Set(session.doc.classes().filter((c) => c.visibility === "hidden").map((c) => c.index));
  const meshes = withoutHidden(session.doc)
    .model3d()
    .filter((m) => shown.has(m.layerId) && !hiddenClasses.has(m.classIndex) && m.triangles.length >= 9)
    .map((m) => ({ id: m.objectId, triangles: m.triangles, edges: m.edges, color: m.color }));
  return sectionDrawing(meshes, { a: src.a, b: src.b, look, depth });
}

export async function createSectionViewportDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const src = lineSource();
  if (typeof src === "string") {
    toast(src, "error");
    return;
  }
  const doc = session.doc;
  const all = doc.layers();
  const sheets = all.filter((l) => l.kind === "sheet");
  const newSheetName = firstFree("Sheet", new Set(all.map((l) => l.name)));
  const taken = viewportNamesTaken(doc);
  const first = sheets.find((l) => l.id === store.activeLayerId) ?? sheets[0];
  const lineLayer = all.find((l) => l.id === src.layerId);
  const firstNumber = (): string => {
    let n = (first ? doc.viewports(first.id).length : 0) + 1;
    while (taken.has(`${n}/${first?.name ?? newSheetName}`)) n++;
    return String(n);
  };
  const v = await toolPrefs(
    "Create Section Viewport",
    [
      { kind: "check", key: "byNumber", label: "Name viewport as Dwg No./Sheet No.", value: true },
      { kind: "text", key: "name", label: "Viewport Name", value: firstFree("Section", taken) },
      {
        kind: "choice",
        key: "sheet",
        label: "Create on Layer",
        value: first?.id ?? NEW_SHEET,
        options: [...sheets.map((l) => ({ value: l.id, label: l.name })), { value: NEW_SHEET, label: "New Sheet Layer" }],
      },
      { kind: "text", key: "number", label: "Drawing Number", value: src.number ?? firstNumber() },
      { kind: "text", key: "title", label: "Drawing Title", value: "Section" },
      { kind: "number", key: "scale", label: "Scale 1:", value: lineLayer?.scale || 1, min: 0.001, max: 1e6 },
      {
        kind: "choice",
        key: "look",
        label: "Look",
        value: src.look ?? "left",
        options: [
          { value: "left", label: "Left of the line" },
          { value: "right", label: "Right of the line" },
        ],
      },
      { kind: "check", key: "beyond", label: "Display extents beyond cut plane", value: true },
      { kind: "length", key: "far", label: "Limited to (0 is unlimited)", value: 0 },
      { kind: "check", key: "label", label: "Drawing label under the viewport", value: true },
    ],
    [
      "The visible design layers' 3D objects, their classes shown, cut by an upright plane along the line from its first point to its last and looked at square to it, to the left or right of the way it was drawn: the cut filled in each object's colour, the edges beyond drawn where nothing nearer hides them.",
      ...(src.look ? ["The look starts as the line's arrows point."] : []),
      "It's drawn into the viewport's annotations as the model is now; it isn't kept up to date.",
    ].join(" "),
  );
  if (!v || store.session !== session) return;
  const chosen = v.choice("sheet");
  const sheetName = chosen === NEW_SHEET ? newSheetName : (sheets.find((l) => l.id === chosen)?.name ?? "");
  const number = v.choice("number").trim();
  const title = v.choice("title").trim();
  const name = v.flag("byNumber") ? `${number}/${sheetName}` : v.choice("name").trim();
  if (name && taken.has(name)) {
    toast(`“${name}” is already a layer's, resource's or viewport's name.`, "error");
    return;
  }
  const scale = v.num("scale");
  const depth = !v.flag("beyond") ? 0 : v.num("far") > 0 ? v.num("far") : Infinity;
  const look = v.choice("look") === "right" ? "right" : "left";

  const done = showLoading("Cutting the section…");
  let drawing: SectionDrawing;
  try {
    await nextPaint();
    drawing = cutModel(src, look, depth);
  } catch (err) {
    toast(`The section couldn't be cut: ${errorMessage(err)}`);
    return;
  } finally {
    done();
  }
  const box = drawing.box;
  if (!box || store.session !== session) {
    if (!box) toast("The line doesn't cut or look at any 3D objects on the visible design layers.", "info");
    return;
  }
  const halfW = (box.x1 - box.x0) / 2 / scale + MARGIN_MM;
  const halfH = (box.y1 - box.y0) / 2 / scale + MARGIN_MM;
  // on paper right of what the sheet holds already, tops level; at the sheet's origin on an empty one
  const busy = chosen === NEW_SHEET ? null : sheetBox(chosen);
  const mid = busy ? { x: busy.x1 + GAP_MM + halfW, y: busy.y1 - halfH } : { x: 0, y: 0 };
  const match = colorMatcher();
  const ink = (hex: string): number => {
    const h = /^#([0-9a-f]{6})/i.exec(hex)?.[1] ?? "808080";
    return match({ r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 });
  };
  const black = ink("#000000");
  const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  // annotations are at the sheet × the scale
  const place = (p: Pt): Pt => ({ x: p.x - centre.x + mid.x * scale, y: p.y - centre.y + mid.y * scale });
  const made = attempt("Create Section Viewport", (s) =>
    s.batch(() => {
      const sheetId = chosen === NEW_SHEET ? s.createLayer(newSheetName, "sheet") : chosen;
      const id = s.createViewport(sheetId, {
        scale,
        box: { x0: mid.x - halfW, y0: mid.y - halfH, x1: mid.x + halfW, y1: mid.y + halfH },
        at: { x: (src.a.x + src.b.x) / 2, y: (src.a.y + src.b.y) / 2 },
        layers: [],
        classes: viewportClasses(s.doc),
        classIndex: store.activeClassIndex,
      });
      if (name) s.setObjectName(id, name);
      const notes = s.doc.openAnnotations(id);
      if (!notes) throw new Error("The viewport's annotations couldn't be opened.");
      try {
        for (const piece of drawing.pieces) {
          const parts: { shape: NewShape; look: Partial<Attributes> }[] = [];
          for (const c of piece.cuts) {
            const fill = ink(c.color);
            // a cut with holes: one outline, each hole joined to it by an edge both ways that isn't drawn
            const points = c.outer.map(place);
            const hidden: number[] = [];
            for (const h of c.holes) {
              const ring = h.map(place);
              let bi = 0;
              let bj = 0;
              let best = Infinity;
              points.forEach((p, i) =>
                ring.forEach((q, j) => {
                  const d = Math.hypot(p.x - q.x, p.y - q.y);
                  if (d < best) [best, bi, bj] = [d, i, j];
                }),
              );
              const loop = [...ring.slice(bj), ...ring.slice(0, bj + 1)];
              // shift the hidden edges after where the hole goes in
              for (let k = 0; k < hidden.length; k++) if (hidden[k] > bi) hidden[k] += loop.length + 1;
              hidden.push(bi, bi + loop.length);
              points.splice(bi + 1, 0, ...loop, points[bi]);
            }
            const shape: NewShape = hidden.length ? { kind: "polyline", points, closed: true, hidden } : { kind: "polygon", points, closed: true };
            parts.push({ shape, look: { penFore: black, lineWeight: CUT_MILS, fillPattern: 1, fillFore: fill, fillBack: fill, fillOpacity: 100, penOpacity: 100 } });
          }
          for (const l of piece.cutLines) parts.push({ shape: { kind: "polygon", points: l.map(place), closed: false }, look: { penFore: black, lineWeight: CUT_MILS, fillPattern: 0 } });
          for (const l of piece.lines)
            parts.push({
              shape: l.length === 2 ? { kind: "line", a: place(l[0]), b: place(l[1]) } : { kind: "polygon", points: l.map(place), closed: false },
              look: { penFore: black, lineWeight: LINE_MILS, fillPattern: 0 },
            });
          const ids = s.addObjects(
            notes,
            parts.map((p) => p.shape),
            store.activeClassIndex,
            parts.map((p) => p.look),
          );
          if (ids.length > 1) s.groupObjects(ids);
        }
      } finally {
        s.doc.openAnnotations(null);
      }
      if (v.flag("label")) {
        // on the sheet under the viewport's box, as Vectorworks' drawing label sits
        const lr = BUBBLE_MM / 2;
        const d = drawingLabel({ x: mid.x - halfW + lr, y: mid.y - halfH - 1.6 * lr }, lr, number, sheetName, title, `Scale 1:${scale}`, LABEL_LINE_MM);
        if (d) s.groupObjects(markerParts(d).map((p) => addPart(s, sheetId, p)));
      }
      return { sheetId, id };
    }),
  );
  if (!made) return;
  if (store.activeLayerId !== made.value.sheetId) setActiveLayer(made.value.sheetId);
  setSelection([made.value.id]);
  const ctx = appContext();
  if (ctx) zoomToSelection(ctx.scene, ctx.view);
  const cut = drawing.pieces.filter((p) => p.cuts.length || p.cutLines.length).length;
  toast(`Section viewport ${name ? `“${name}” ` : ""}made: ${cut} ${cut === 1 ? "object" : "objects"} cut, ${drawing.pieces.length} drawn.`, "info");
}
