// ConnectCAD's Create Riser Sheet and Create Cabling Sheet: a plan viewport of the cable network on
// a sheet layer, annotated. Both run Analyze Cable Routes' search first (cableAnalysis.ts), so the
// cable paths' Cable Counts are current. A riser sheet shows the design layers that hold cable paths;
// Auto-annotate tags each path with its ID, Location and Cable Count, Annotate manually opens the
// viewport's annotations with the Text tool, and Do not annotate leaves them empty. A cabling sheet
// shows one design layer and draws, in its annotations, the cables between each two places they join
// the network (drop points, racks, equipment on its own) as an arc between them or as home runs from
// each end, the nearest pairs as arcs as far as Cable Annotation Style says; a place on another layer
// gets only the home run toward it (cableSheetShapes.ts). Vectorworks' viewports can take any view;
// these are plans.

import type { Attributes, BBox, EditSession, NewShape, Pt, VwxDocument } from "../../../core/index.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "../../../app/commands.ts";
import { drawnBox, firstFree, NEW_SHEET, viewportClasses, viewportNamesTaken } from "../../../app/createViewport.ts";
import { appContext } from "../../../app/ext.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { store } from "../../../app/state.ts";
import { editAnnotations, exitSymbol } from "../../../app/symbolEdit.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs, type PrefField } from "../../../app/toolPrefs.ts";
import { analyzeRoutes } from "./cableAnalysis.ts";
import { cablePathsIn, setCableCounts } from "./cableRoute.ts";
import { cablingMarks, endPairs, pathTag, type CableRun } from "./cableSheetShapes.ts";
import { reportFacts } from "./schematic.ts";

/** on paper, mm: the margin round the drawing, the writing's height, a tag's leader rise and a home run's length */
const MARGIN_MM = 15;
const TEXT_MM = 2;
const LEADER_MM = 5;
const ARM_MM = 14;
/** the cabling marks' colour, the cable paths' */
const CABLE_INK = "#1f6feb";

const ANNOTATIONS = [
  { value: "auto", label: "Auto-annotate" },
  { value: "manual", label: "Annotate manually" },
  { value: "none", label: "Do not annotate" },
] as const;

/** the choices last made, for the next time */
export const sheetSettings = { annotate: "auto" as string, arcs: 50 };

const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

/** The dialog's Sheet Layer and Viewport Name. */
function sheetFields(doc: VwxDocument, base: string): PrefField[] {
  const sheets = doc.layers().filter((l) => l.kind === "sheet");
  return [
    { kind: "choice", key: "sheet", label: "Sheet Layer", value: NEW_SHEET, options: [...sheets.map((l) => ({ value: l.id, label: l.name })), { value: NEW_SHEET, label: "New Sheet Layer" }] },
    { kind: "text", key: "name", label: "Viewport Name", value: firstFree(base, viewportNamesTaken(doc)) },
  ];
}

/** Something drawn in a viewport's annotations, from points on the design layers placed with `place`, writing `scale` times its size on paper. */
type Annotate = (place: (p: Pt) => Pt, scale: number, ink: (hex: string) => number) => { shape: NewShape; look: Partial<Attributes> }[][];

/**
 * A plan viewport of `layerIds` at the first's scale, on sheet `sheet` (or a new sheet layer),
 * framing `box` with a margin, named `name`, with `annotate`'s marks in its annotations (each list
 * grouped), as part of a batch; the sheet layer and the viewport.
 */
function makeSheet(s: EditSession, sheet: string, name: string, layerIds: readonly string[], box: BBox | null, annotate: Annotate | null): { sheetId: string; id: string; marks: number } {
  const scale = s.doc.layers().find((l) => l.id === layerIds[0])?.scale || 1;
  const at = box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : { x: 0, y: 0 };
  const halfW = (box ? (box.x1 - box.x0) / 2 / scale : 0) + MARGIN_MM;
  const halfH = (box ? (box.y1 - box.y0) / 2 / scale : 0) + MARGIN_MM;
  const sheetId = sheet === NEW_SHEET ? s.createLayer(firstFree("Sheet", new Set(s.doc.layers().map((l) => l.name))), "sheet") : sheet;
  const id = s.createViewport(sheetId, {
    scale,
    box: { x0: -halfW, y0: -halfH, x1: halfW, y1: halfH },
    at,
    layers: layerIds.map((l) => ({ id: l, visibility: "visible" as const })),
    classes: viewportClasses(s.doc),
    classIndex: store.activeClassIndex,
  });
  if (name) s.setObjectName(id, name);
  if (!annotate) return { sheetId, id, marks: 0 };
  // the annotations are at sheet × scale, the viewport's middle at the box's
  const notes = s.doc.openAnnotations(id);
  if (!notes) throw new Error("The viewport's annotations couldn't be opened.");
  try {
    const match = colorMatcher();
    const marks = annotate((p) => ({ x: p.x - at.x, y: p.y - at.y }), scale, (hex) => match(hexToRgb(hex)));
    for (const mark of marks) {
      const ids = s.addObjects(notes, mark.map((m) => m.shape), store.activeClassIndex, mark.map((m) => m.look));
      if (ids.length > 1) s.groupObjects(ids);
    }
    return { sheetId, id, marks: marks.length };
  } finally {
    s.doc.openAnnotations(null);
  }
}

/** The new viewport on its sheet layer, selected and in view. */
function showSheet(r: { sheetId: string; id: string }): void {
  if (store.activeLayerId !== r.sheetId) setActiveLayer(r.sheetId);
  setSelection([r.id]);
  const ctx = appContext();
  if (ctx) zoomToSelection(ctx.scene, ctx.view);
}

/** Stage > ConnectCAD > Create Riser Sheet: the cable paths' layers in a viewport, each path tagged with its Cable Count, or left to be tagged by hand. */
export async function createRiserSheet(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const paths = cablePathsIn(s.doc);
  if (!paths.length) {
    toast("Create Riser Sheet: the drawing has no cable paths.", "info");
    return;
  }
  const v = await toolPrefs("Create Riser Sheet", [
    ...sheetFields(s.doc, "Riser"),
    { kind: "choice", key: "annotate", label: "Cable Path Annotation", value: sheetSettings.annotate, options: ANNOTATIONS.map((a) => ({ ...a })) },
  ]);
  if (!v || store.session !== s) return;
  sheetSettings.annotate = v.choice("annotate");
  exitSymbol();
  const layerIds = s.doc.layers().filter((l) => paths.some((p) => p.layerId === l.id)).map((l) => l.id);
  const box = drawnBox(layerIds);
  const tag: Annotate = (place, scale, ink) => {
    const black = ink("#000000");
    return cablePathsIn(s.doc).map((p) => {
      const t = pathTag(p.points.map(place), [p.name, p.location, `Cable Count: ${p.count}`].filter(Boolean).join("\r"), LEADER_MM * scale);
      return [
        { shape: { kind: "polyline", points: t.leader, closed: false } as NewShape, look: { penFore: black, fillPattern: 0 } },
        { shape: { kind: "text", at: t.note.at, text: t.note.text, height: TEXT_MM * scale, hAlign: t.note.hAlign, vAlign: t.note.vAlign, angle: 0 } as NewShape, look: { penFore: black, fillPattern: 0 } },
      ];
    });
  };
  const r = attempt("Create Riser Sheet", (session) =>
    session.batch(() => {
      setCableCounts(session, analyzeRoutes(session).counts);
      return makeSheet(session, v.choice("sheet"), v.choice("name"), layerIds, box, sheetSettings.annotate === "auto" ? tag : null);
    }),
  );
  if (!r) return;
  showSheet(r.value);
  if (sheetSettings.annotate === "manual") {
    editAnnotations(r.value.id);
    appContext()?.controller.setTool("text");
    toast("Riser sheet made; its annotations are open to tag the cable paths. Exit Viewport Annotation when done.", "info");
  } else toast(sheetSettings.annotate === "auto" ? `Riser sheet made: ${r.value.marks} cable path${r.value.marks === 1 ? "" : "s"} tagged with their Cable Count.` : "Riser sheet made.", "info");
}

/** Stage > ConnectCAD > Create Cabling Sheet: one design layer in a viewport, with the cables between each two places drawn as arcs or home runs. */
export async function createCablingSheet(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const paths = cablePathsIn(s.doc);
  if (!paths.length) {
    toast("Create Cabling Sheet: the drawing has no cable paths.", "info");
    return;
  }
  const designs = s.doc.layers().filter((l) => l.kind !== "sheet" && paths.some((p) => p.layerId === l.id));
  const v = await toolPrefs("Create Cabling Sheet", [
    { kind: "choice", key: "layer", label: "Design Layer (Source)", value: designs.find((l) => l.id === store.activeLayerId)?.id ?? designs[0].id, options: designs.map((l) => ({ value: l.id, label: l.name })) },
    ...sheetFields(s.doc, "Cabling"),
    { kind: "number", key: "arcs", label: "Cable Annotation Style: Arcs (the nearest first; the rest Home Runs)", value: sheetSettings.arcs, min: 0, max: 100, integer: true, unit: "%" },
  ]);
  if (!v || store.session !== s) return;
  sheetSettings.arcs = v.num("arcs");
  exitSymbol();
  const layerId = v.choice("layer");
  const box = drawnBox([layerId]);
  let drawn = { runs: 0, arcs: 0, homes: 0 };
  /** the routed cables, each end shown when it joins on the layer */
  const runsIn = (session: EditSession, ways: ReturnType<typeof analyzeRoutes>["ways"]): CableRun[] => {
    const facts = new Map(reportFacts(session).circuits.map((c) => [c.id, c]));
    const runs: CableRun[] = [];
    for (const [id, w] of ways) {
      if (w.external || !w.route) continue;
      const c = facts.get(id);
      runs.push({ ends: w.route.joins, at: w.route.places, shown: [w.route.layers[0] === layerId, w.route.layers[1] === layerId], kind: c?.cable || c?.signal || "" });
    }
    return runs;
  };
  const draw = (runs: readonly CableRun[]): Annotate => (place, scale, ink) => {
    const marks = cablingMarks(endPairs(runs), sheetSettings.arcs, ARM_MM * scale);
    const black = ink("#000000");
    const blue = ink(CABLE_INK);
    const pen = { penFore: blue, fillPattern: 0, lineWeight: 14 };
    const writing = (n: (typeof marks)[number]["note"]): { shape: NewShape; look: Partial<Attributes> } => ({ shape: { kind: "text", at: place(n.at), text: n.text, height: TEXT_MM * scale, hAlign: n.hAlign, vAlign: n.vAlign, angle: 0 } as NewShape, look: { penFore: black, fillPattern: 0 } });
    drawn = { runs: runs.filter((r) => r.shown[0] || r.shown[1]).length, arcs: marks.filter((m) => m.kind === "arc").length, homes: marks.filter((m) => m.kind === "home").length };
    return marks.map((m) =>
      m.kind === "arc"
        ? [{ shape: { kind: "polyline", points: m.line.map(place), closed: false } as NewShape, look: pen }, writing(m.note)]
        : [
            { shape: { kind: "polyline", points: m.line.map(place), closed: false } as NewShape, look: pen },
            { shape: { kind: "polygon", points: m.head.map(place), closed: true } as NewShape, look: { penFore: blue, fillPattern: 1, fillFore: blue, fillBack: blue, fillOpacity: 100 } },
            writing(m.note),
          ],
    );
  };
  const r = attempt("Create Cabling Sheet", (session) =>
    session.batch(() => {
      const a = analyzeRoutes(session);
      setCableCounts(session, a.counts);
      return makeSheet(session, v.choice("sheet"), v.choice("name"), [layerId], box, draw(runsIn(session, a.ways)));
    }),
  );
  if (!r) return;
  showSheet(r.value);
  const many = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;
  toast(drawn.runs ? `Cabling sheet made: ${many(drawn.runs, "cable")}, drawn as ${many(drawn.arcs, "arc")} and ${many(drawn.homes, "home run")}.` : "Cabling sheet made; no routed cables join the cable paths on that layer.", "info");
}
