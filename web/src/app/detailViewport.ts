// View > Create Detail Viewport…: a plan viewport of a detail, cropped to the box of a closed shape
// (the crop object) drawn round it, either on a design layer or on a sheet layer over a plan viewport,
// whose layers and classes it then shows. Vectorworks names it by its drawing and sheet numbers, and
// can add a detail callout round the crop pointing at it; so does this, the callout a leader and
// bubble grouped with the crop, and a drawing label under the viewport. Vectorworks' detail callout
// and label stay linked to the viewport; Rodeo's are plain lines and texts, and the crop is its box.

import { applyAffine } from "../core/encode.ts";
import type { Affine, BBox, NewViewport, Pt, Visibility } from "../core/index.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "./commands.ts";
import { firstFree, NEW_SHEET, viewportClasses, viewportNamesTaken } from "./createViewport.ts";
import { appContext } from "./ext.ts";
import { unionBBox } from "./geom.ts";
import { detailLeader, drawingLabel } from "./markerShapes.ts";
import { isClosedShape, outlineOf } from "./shapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";
import { addPart } from "./tools/detailing.ts";
import { BUBBLE_MM, LABEL_LINE_MM, markerParts } from "./tools/markers.ts";

/** the callout's leader leaves the crop up and to the right */
const OUT: Pt = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
/** paper between a new detail and what's already on its sheet, mm */
const GAP_MM = 20;

/** What the detail is made from: the crop and what the viewport shows. */
interface Source {
  readonly cropId: string;
  /** the crop's layer, where its callout goes */
  readonly layerId: string;
  /** the crop's outline point furthest up and right, in its layer's coordinates */
  readonly edge: Pt;
  /** the crop's box in design coordinates */
  readonly box: BBox;
  readonly scale: number;
  readonly layers: NewViewport["layers"];
  readonly classes: NewViewport["classes"];
}

function invert(m: Affine): Affine | null {
  const det = m.a * m.d - m.b * m.c;
  if (!(Math.abs(det) > 1e-12)) return null;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}

function boxOf(pts: readonly Pt[]): BBox {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** The selected crop and what its detail shows, or why there's none. */
function detailSource(): Source | string {
  const doc = store.session?.doc;
  const pick = "Select one closed shape round the detail: on a design layer, or on a sheet layer over a plan viewport.";
  if (!doc || store.selection.size !== 1) return pick;
  const crop = doc.object([...store.selection][0]);
  const shape = crop?.shape;
  const bbox = shape?.bbox;
  if (!crop || !shape || !bbox || !isClosedShape(shape)) return pick;
  const layer = doc.layers().find((l) => l.id === crop.layerId);
  if (!layer) return pick;
  const outline = outlineOf(shape, bbox);
  const edge = outline.reduce((a, p) => (p.x + p.y > a.x + a.y ? p : a), { x: bbox.x1, y: bbox.y0 });
  const common = { cropId: crop.id, layerId: layer.id, edge };
  if (layer.kind !== "sheet") {
    // as Create Viewport starts: the crop's layer visible, the other design layers as they are
    const layers = doc
      .layers()
      .filter((l) => l.kind !== "sheet")
      .map((l) => ({ id: l.id, visibility: l.id === layer.id ? ("visible" as Visibility) : l.visibility }))
      .filter((l) => l.visibility !== "hidden");
    return { ...common, box: bbox, scale: layer.scale || 1, layers, classes: viewportClasses(doc) };
  }
  // on a sheet: the top plan viewport the crop's middle is over, the crop taken back to its design layers
  const mid = { x: (bbox.x0 + bbox.x1) / 2, y: (bbox.y0 + bbox.y1) / 2 };
  const under = doc
    .viewports(layer.id)
    .filter((v) => !v.uncropped && mid.x >= v.clip.x0 && mid.x <= v.clip.x1 && mid.y >= v.clip.y0 && mid.y <= v.clip.y1)
    .at(-1);
  const info = under && doc.viewport(under.id);
  const back = under && invert(under.m);
  if (!under || !info?.plan || !back) return "The crop on a sheet layer has to lie over a plan viewport.";
  const corners = [
    { x: bbox.x0, y: bbox.y0 },
    { x: bbox.x1, y: bbox.y0 },
    { x: bbox.x1, y: bbox.y1 },
    { x: bbox.x0, y: bbox.y1 },
  ];
  return {
    ...common,
    box: boxOf(corners.map((p) => applyAffine(back, p))),
    scale: info.scale,
    layers: info.layers.filter((l) => l.visibility !== "hidden").map((l) => ({ id: l.id, visibility: l.visibility })),
    classes: info.classes,
  };
}

/** What's on a sheet already, together. */
function sheetBox(sheetId: string): BBox | null {
  const scene = appContext()?.scene;
  let box: BBox | null = null;
  for (const e of scene?.topLevelEntries(sheetId, null) ?? []) if (e.bbox) box = unionBBox(box, e.bbox);
  return box;
}

/** The first drawing number on a sheet that no viewport there is named by: one past its plan viewports. */
function nextNumber(sheetId: string | null, sheetName: string, taken: ReadonlySet<string>): string {
  let n = (sheetId ? (store.session?.doc.viewports(sheetId).length ?? 0) : 0) + 1;
  while (taken.has(`${n}/${sheetName}`)) n++;
  return String(n);
}

export async function createDetailViewportDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const src = detailSource();
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
  const v = await toolPrefs("Create Detail Viewport", [
    { kind: "check", key: "byNumber", label: "Name viewport as Dwg No./Sheet No.", value: true },
    { kind: "text", key: "name", label: "Viewport Name", value: firstFree("Detail", taken) },
    {
      kind: "choice",
      key: "sheet",
      label: "Create on Layer",
      value: first?.id ?? NEW_SHEET,
      options: [...sheets.map((l) => ({ value: l.id, label: l.name })), { value: NEW_SHEET, label: "New Sheet Layer" }],
    },
    { kind: "text", key: "number", label: "Drawing Number", value: nextNumber(first?.id ?? null, first?.name ?? newSheetName, taken) },
    { kind: "text", key: "title", label: "Drawing Title", value: "Detail" },
    { kind: "number", key: "scale", label: "Scale 1:", value: src.scale, min: 0.001, max: 1e6 },
    { kind: "check", key: "callout", label: "Detail callout round the crop", value: true },
    { kind: "check", key: "label", label: "Drawing label under the viewport", value: true },
  ]);
  if (!v) return;
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
  const { box } = src;
  const halfW = (box.x1 - box.x0) / 2 / scale;
  const halfH = (box.y1 - box.y0) / 2 / scale;
  if (!(halfW > 0 && halfH > 0)) {
    toast("The crop has no area to show.", "error");
    return;
  }
  const cropLayer = all.find((l) => l.id === src.layerId);
  // on paper right of what the sheet holds already, tops level; at the sheet's origin on an empty one
  const busy = chosen === NEW_SHEET ? null : sheetBox(chosen);
  const mid = busy ? { x: busy.x1 + GAP_MM + halfW, y: busy.y1 - halfH } : { x: 0, y: 0 };
  const r = (BUBBLE_MM / 2) * (cropLayer?.scale || 1);
  const made = attempt("Create Detail Viewport", (s) =>
    s.batch(() => {
      const sheetId = chosen === NEW_SHEET ? s.createLayer(newSheetName, "sheet") : chosen;
      const id = s.createViewport(sheetId, {
        scale,
        box: { x0: mid.x - halfW, y0: mid.y - halfH, x1: mid.x + halfW, y1: mid.y + halfH },
        at: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 },
        layers: src.layers,
        classes: src.classes,
        classIndex: store.activeClassIndex,
      });
      if (name) s.setObjectName(id, name);
      if (v.flag("callout")) {
        const parts = markerParts(detailLeader(src.edge, OUT, r, number, sheetName)).map((p) => addPart(s, src.layerId, p));
        // the crop joins its callout, unless it's already inside a group
        const top = s.doc.object(src.cropId)?.parentId === null;
        s.groupObjects(top ? [src.cropId, ...parts] : parts);
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
  toast(`Detail viewport ${name ? `“${name}” ` : ""}made on its sheet layer.`, "info");
}
