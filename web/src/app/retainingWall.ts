// AEC > Terrain > Create Retaining Wall Site Modifier: from connected walls or an extrude, a modifier with a left and a
// right edge that each hold their own height and a pad at the bottom of the wall, so the ground can be retained on one side
// and sculpted on the other. It's a plug-in with Rodeo's own name, placed at its first corner; the wall isn't tied to it.

import type { Attributes, EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { registerModifierSource, registerPluginDrivers, registerSurfaceSender, type PluginDriver, type PluginWidget } from "./ext.ts";
import {
  bandSections,
  carriedHeights,
  chainRuns,
  heightBy,
  movedPart,
  partHeight,
  retainingBand,
  RETAINING_PARTS,
  thinRun,
  withVertexHeight,
  type HeightMode,
  type RetainingOptions,
  type RetainingPart,
  type RetainingVertex,
  type RunSource,
} from "./retainingShapes.ts";
import { modelsIn, modifierClass, nearColour, pen, selectedTop, surfaceHeightAt, terrainOf, updateSiteModels } from "./siteModel.ts";
import type { Pt3, SiteModifier } from "./siteModelShapes.ts";
import { pathOutline } from "./sitePathShapes.ts";
import { layerScaleOf } from "./spaces.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";

export const RETAINING_WALL = "Rodeo Retaining Wall Modifier";

const PLUGIN = 86;
const EXTRUDE = 24;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const FIELD = {
  apply: "Apply To",
  width: "Width",
  padOffset: "Pad Offset",
  left: "Include Left Modifier Edge",
  right: "Include Right Modifier Edge",
  start: "Include Start Modifier Edge",
  end: "Include End Modifier Edge",
  move: "Move",
  elevation: "Elevation",
  vertex: "Vertex",
  vertexZ: "Vertex Elevation",
  /** kept out of Object Info */
  path: "Path Points",
  index: "Vertex Index",
} as const;

const APPLY = ["Proposed site model", "Existing site model"] as const;
const COLOUR = "#1f8f96";
/** a side's letter on paper, mm */
const LETTER_MM = 2.5;

type Look = Partial<Attributes>;

interface Retaining {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function retainingOf(doc: VwxDocument, id: string): Retaining | null {
  const rec = doc.records(id).find((r) => r.parametric && r.name === RETAINING_WALL);
  const layerId = doc.object(id)?.layerId;
  return rec && layerId ? { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

const verticesOf = (r: Retaining): RetainingVertex[] => {
  try {
    return JSON.parse(String(r.value(FIELD.path) || "[]")) as RetainingVertex[];
  } catch {
    return [];
  }
};

const optionsOf = (r: Retaining): RetainingOptions => ({
  width: Number(r.value(FIELD.width)) || 0,
  left: r.value(FIELD.left) === true,
  right: r.value(FIELD.right) === true,
  start: r.value(FIELD.start) === true,
  end: r.value(FIELD.end) === true,
  padOffset: Number(r.value(FIELD.padOffset)) || 0,
});

const partOf = (r: Retaining): RetainingPart => (RETAINING_PARTS as readonly string[]).includes(String(r.value(FIELD.move))) ? (String(r.value(FIELD.move)) as RetainingPart) : "Left Edge";

function placeOf(o: ObjectInfo): { toWorld(q: Pt): Pt; toLocal(q: Pt): Pt } {
  const at = o.insertion ?? { x: 0, y: 0 };
  const turn = ((o.turned ?? 0) * Math.PI) / 180;
  const [c, n] = [Math.cos(turn), Math.sin(turn)];
  return {
    toWorld: (q) => ({ x: at.x + q.x * c - q.y * n, y: at.y + q.x * n + q.y * c }),
    toLocal: (q) => ({ x: (q.x - at.x) * c + (q.y - at.y) * n, y: -(q.x - at.x) * n + (q.y - at.y) * c }),
  };
}

const tenth = (v: number): number => Math.round(v * 10) / 10;

// a site model reads them as it's updated
registerModifierSource((doc, modelLayer, scope): SiteModifier[] => {
  if (!doc.hasPluginFormat(RETAINING_WALL)) return [];
  const out: SiteModifier[] = [];
  for (const layer of doc.layers()) {
    if (scope === "Same Layer as Site Model only" && layer.id !== modelLayer) continue;
    if (scope === "Visible Layers Only" && layer.visibility !== "visible") continue;
    for (const o of doc.objects(layer.id)) {
      if (o.type !== PLUGIN) continue;
      const r = retainingOf(doc, o.id);
      const band = r ? retainingBand(verticesOf(r), optionsOf(r)) : null;
      if (!r || !band) continue;
      const { toWorld } = placeOf(o);
      out.push({
        kind: "path",
        ring: band.ring.map(toWorld).map((q) => ({ x: tenth(q.x), y: tenth(q.y) })),
        elevation: 0,
        slope: 0,
        slopeAngle: 0,
        samples: band.samples.map((q): Pt3 => {
          const w = toWorld({ x: q[0], y: q[1] });
          return [tenth(w.x), tenth(w.y), tenth(q[2])];
        }),
        ...(r.value(FIELD.apply) === APPLY[1] ? { existing: true } : {}),
      });
    }
  }
  return out;
});

/** The figures Object Info shows, from the corners. */
function setFigures(s: EditSession, r: Retaining): void {
  const v = verticesOf(r);
  if (!v.length) return;
  const index = Math.max(0, Math.min(v.length - 1, Number(r.value(FIELD.index)) || 0));
  const part = partOf(r);
  const set = (field: string, value: RecordValue): void => s.setRecordField(r.id, r.format, field, value);
  set(FIELD.index, index);
  set(FIELD.vertex, `${index + 1} of ${v.length}`);
  set(FIELD.elevation, partHeight(v, part));
  set(FIELD.vertexZ, part === "Right Edge" ? v[index].right : v[index].left);
}

function redraw(s: EditSession, id: string): void {
  const first = retainingOf(s.doc, id);
  if (!first) return;
  setFigures(s, first);
  const r = retainingOf(s.doc, id) as Retaining;
  const v = verticesOf(r);
  const o = optionsOf(r);
  const sections = bandSections(v, o);
  if (sections.length < 2) throw new Error("A retaining wall modifier needs a length and a width.");
  const classIndex = s.doc.object(id)?.classIndex ?? store.activeClassIndex;
  const main = nearColour(s.doc)(COLOUR);
  const letter = LETTER_MM * layerScaleOf(r.layerId);
  const outward = (from: Pt, to: Pt): Pt => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: to.x + ((to.x - from.x) / len) * letter, y: to.y + ((to.y - from.y) / len) * letter };
  };
  const dashed = s.doc.lineTypes().find((x) => x.dashes.length > 0)?.style;
  const shapes: NewShape[] = [{ kind: "polygon", points: pathOutline(sections), closed: true } as NewShape, { kind: "polygon", points: sections.map((c) => c.c), closed: false } as NewShape];
  const looks: Look[] = [pen(main, 7), pen(main, 5, dashed ?? 2)];
  for (const [text, at] of [["L", outward(sections[0].c, sections[0].left)], ["R", outward(sections[0].c, sections[0].right)]] as const) {
    shapes.push({ kind: "text", at, text, height: letter, hAlign: 2, vAlign: 3 } as NewShape);
    looks.push({ fillPattern: 0, penFore: main });
  }
  const ids = s.addObjects(r.layerId, shapes, classIndex, looks);
  // the layer's elevation is added as they're made, and a plug-in's drawing is lifted by it again when shown
  const lift = -(s.doc.layers().find((l) => l.id === r.layerId)?.elevation ?? 0);
  const line = (points: readonly (readonly [Pt, number])[]): string => s.add3DPolygons(r.layerId, [{ points: points.flatMap(([p, z]) => [p.x, p.y, z + lift]), closed: false }], classIndex);
  const round: [Pt, number][] = [...sections.map((c, i): [Pt, number] => [c.left, v[i].left]), ...sections.map((c, i): [Pt, number] => [c.right, v[i].right]).reverse()];
  // left open and brought back to its start, since a closed one would show filled
  const edge = line([...round, round[0]]);
  const pad = line(sections.map((c, i): [Pt, number] => [c.c, v[i].pad + o.padOffset]));
  s.setAttributes([edge, pad], pen(main, 7));
  s.setPluginDrawing(id, [...ids, edge, pad]);
}

function write(s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void {
  const r = retainingOf(s.doc, id);
  if (!r) throw new Error("That isn't a retaining wall modifier.");
  for (const [field, value] of Object.entries(values)) s.setRecordField(id, r.format, field, value);
  redraw(s, id);
}

/** Object Info's edits, some of which are heights along the corners. */
function edit(id: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt("Edit Retaining Wall Modifier", (s) =>
    s.batch(() => {
      const r = retainingOf(s.doc, id);
      if (!r) throw new Error("That isn't a retaining wall modifier.");
      const kept = { ...values };
      if (FIELD.width in kept && !(Number(kept[FIELD.width]) > 0)) throw new Error("Its width has to be over zero.");
      let v = verticesOf(r);
      if (FIELD.elevation in kept) v = movedPart(v, partOf(r), Number(kept[FIELD.elevation]) || 0);
      if (FIELD.vertexZ in kept) v = withVertexHeight(v, partOf(r), Number(r.value(FIELD.index)) || 0, Number(kept[FIELD.vertexZ]) || 0);
      delete kept[FIELD.elevation];
      delete kept[FIELD.vertexZ];
      write(s, id, { ...kept, [FIELD.path]: JSON.stringify(v) });
    }),
  );
}

/** The edges or the pad on the ground beneath them. */
function sendParts(s: EditSession, id: string, parts: "edges" | "pad", height: (x: number, y: number) => number | null): boolean {
  const r = retainingOf(s.doc, id);
  const o = s.doc.object(id);
  if (!r || !o) return false;
  const v = verticesOf(r);
  const sections = bandSections(v, optionsOf(r));
  const { toWorld } = placeOf(o);
  const groundAt = (p: Pt): number | null => {
    const w = toWorld(p);
    return height(w.x, w.y);
  };
  let found = false;
  const next = v.map((q, i) => {
    const c = sections[i];
    if (parts === "pad") {
      const z = groundAt(c.c);
      if (z === null) return q;
      found = true;
      return { ...q, pad: z };
    }
    const [l, right] = [groundAt(c.left), groundAt(c.right)];
    if (l !== null || right !== null) found = true;
    return { ...q, left: l ?? q.left, right: right ?? q.right };
  });
  if (!found) throw new Error("It isn't over a site model.");
  write(s, id, { [FIELD.path]: JSON.stringify(next), ...(parts === "pad" ? { [FIELD.padOffset]: 0 } : {}) });
  return true;
}

/** Its own buttons go by the existing ground, since the proposed ground already has it in. */
function sendTo(id: string, parts: "edges" | "pad"): void {
  attempt("Send to Surface", (s) =>
    s.batch(() => {
      const terrains = modelsIn(s.doc).map(terrainOf);
      sendParts(s, id, parts, (x, y) => {
        for (const t of terrains) {
          const z = t.existingAt(x, y);
          if (z !== null) return z;
        }
        return null;
      });
    }),
  );
}

// the menu's Send to Surface takes the edges, as the modifier's own button does
registerSurfaceSender((s, o, height) => o.type === PLUGIN && retainingOf(s.doc, o.id) !== null && sendParts(s, o.id, "edges", height));

function step(id: string, by: number): void {
  attempt("Choose Vertex", (s) =>
    s.batch(() => {
      const r = retainingOf(s.doc, id);
      if (!r) return;
      const count = verticesOf(r).length;
      write(s, id, { [FIELD.index]: ((Number(r.value(FIELD.index)) || 0) + by + count) % count });
    }),
  );
}

const sourcesOf = (s: EditSession, picked: readonly ObjectInfo[]): RunSource[] | null => {
  const out: RunSource[] = [];
  for (const o of picked) {
    const wall = s.doc.wall(o.id);
    if (wall) {
      out.push({ start: wall.start, end: wall.end, top: wall.top, bottom: wall.bottom, thickness: wall.thickness });
      continue;
    }
    if (o.type !== EXTRUDE) return null;
    const t = s.solidTriangles(o.id);
    if (!t.length) return null;
    const lift = s.doc.layers().find((l) => l.id === o.layerId)?.elevation ?? 0;
    const points: Pt[] = [];
    const heights: number[] = [];
    for (let i = 0; i + 2 < t.length; i += 3) {
      points.push({ x: t[i], y: t[i + 1] });
      heights.push(t[i + 2]);
    }
    const run = thinRun(points, Math.max(...heights) - lift, Math.min(...heights) - lift);
    if (!run) return null;
    out.push(run);
  }
  return out;
};

export const retainingSelected = (): boolean => {
  const doc = store.session?.doc;
  return !!doc && selectedTop(doc).some((o) => doc.wall(o.id) !== null || o.type === EXTRUDE);
};

const MODES: readonly { value: HeightMode; label: string }[] = [
  { value: "top", label: "Offset Below Wall Top" },
  { value: "bottom", label: "Offset Above Wall Bottom" },
  { value: "terrain", label: "Follow Terrain" },
];

/** AEC > Terrain > Create Retaining Wall Site Modifier. */
export async function createRetainingWall(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const doc = session.doc;
  const picked = selectedTop(doc);
  const layerId = picked[0]?.layerId;
  const sources = layerId ? sourcesOf(session, picked) : null;
  if (!layerId || !sources) {
    toast("Select connected walls or an extrude first.", "error");
    return;
  }
  const run = chainRuns(sources);
  if (!run) {
    toast("Those don't connect end to end. Select walls that make one run.", "error");
    return;
  }
  const choice = (key: string, label: string, value: HeightMode) => ({ kind: "choice" as const, wide: true, key, label, value, options: MODES.map((m) => ({ value: m.value, label: m.label })) });
  const v = await toolPrefs(
    "Create Retaining Wall Site Modifier",
    [
      { kind: "heading", key: "", label: "Pad" },
      choice("padMode", "Pad", "bottom"),
      { kind: "length", key: "padOff", label: "Pad Offset", value: 0, zero: true, signed: true },
      { kind: "heading", key: "", label: "Side Edges" },
      { kind: "check", key: "left", label: FIELD.left, value: true },
      choice("leftMode", "Left Edge", "top"),
      { kind: "length", key: "leftOff", label: "Left Offset", value: 0, zero: true, signed: true },
      { kind: "check", key: "right", label: FIELD.right, value: true },
      choice("rightMode", "Right Edge", "terrain"),
      { kind: "length", key: "rightOff", label: "Right Offset", value: 0, zero: true, signed: true },
      { kind: "heading", key: "", label: "Start/End Edges" },
      { kind: "check", key: "start", label: FIELD.start, value: true },
      { kind: "check", key: "end", label: FIELD.end, value: true },
    ],
    "Left and right go by the way the wall was drawn. It needs grade limits round it on the site model, to bring the ground back to its own level. The wall stays as it is, and isn't tied to the modifier.",
  );
  if (!v || store.session !== session) return;
  const r = attempt("Create Retaining Wall Site Modifier", (s) =>
    s.batch(() => {
      const at = run.line[0];
      const sections = bandSections(
        run.line.map((p) => ({ ...p, left: 0, right: 0, pad: 0 })),
        { width: run.width, left: true, right: true, start: true, end: true, padOffset: 0 },
      );
      const ground = (p: Pt): number | null => surfaceHeightAt(s.doc, p);
      const vertices = run.line.map((p, i): RetainingVertex => ({
        x: p.x - at.x,
        y: p.y - at.y,
        left: heightBy(v.choice("leftMode") as HeightMode, v.num("leftOff"), run.tops[i], run.bottoms[i], ground(sections[i].left)),
        right: heightBy(v.choice("rightMode") as HeightMode, v.num("rightOff"), run.tops[i], run.bottoms[i], ground(sections[i].right)),
        pad: heightBy(v.choice("padMode") as HeightMode, v.num("padOff"), run.tops[i], run.bottoms[i], ground(sections[i].c)),
      }));
      const specs: PluginFieldSpec[] = [
        { name: FIELD.apply, type: POPUP, value: APPLY[0] },
        { name: FIELD.width, type: DIMENSION, value: run.width },
        { name: FIELD.padOffset, type: DIMENSION, value: 0 },
        { name: FIELD.left, type: BOOL, value: v.flag("left") },
        { name: FIELD.right, type: BOOL, value: v.flag("right") },
        { name: FIELD.start, type: BOOL, value: v.flag("start") },
        { name: FIELD.end, type: BOOL, value: v.flag("end") },
        { name: FIELD.move, type: POPUP, value: RETAINING_PARTS[0] },
        { name: FIELD.elevation, type: DIMENSION, value: 0 },
        { name: FIELD.vertex, type: TEXT, value: "" },
        { name: FIELD.vertexZ, type: DIMENSION, value: 0 },
        { name: FIELD.path, type: TEXT, value: JSON.stringify(vertices) },
        { name: FIELD.index, type: NUMBER, value: 0 },
      ];
      const id = s.addPluginObject(layerId, RETAINING_WALL, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, modifierClass(s));
      redraw(s, id);
      return id;
    }),
  );
  if (!r) return;
  setSelection([r.value]);
  toast("Retaining wall modifier made. Update the site model to see it.", "info");
}

const BUTTON = { update: 1, previous: 2, next: 3, edges: 4, pad: 5 } as const;
const VERTEX_WIDGETS = [BUTTON.previous, BUTTON.next, 19, 20];
const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const button = (id: number, label: string): PluginWidget => ({ id, kind: "button", label, level: 0 });

const WIDGETS: readonly PluginWidget[] = [
  button(BUTTON.update, "Update Site Model"),
  param(11, FIELD.apply),
  param(12, FIELD.width),
  param(13, FIELD.padOffset),
  param(14, FIELD.left),
  param(15, FIELD.right),
  param(16, FIELD.start),
  param(17, FIELD.end),
  { id: 10, kind: "divider", label: "Elevations", level: 0 },
  param(21, FIELD.move),
  param(18, FIELD.elevation),
  param(19, FIELD.vertex),
  button(BUTTON.previous, "Previous Vertex"),
  button(BUTTON.next, "Next Vertex"),
  param(20, FIELD.vertexZ),
  button(BUTTON.edges, "Send Edges to Surface"),
  button(BUTTON.pad, "Send Pad to Surface"),
];

const POPUPS: Readonly<Record<string, readonly string[]>> = { [FIELD.apply]: APPLY, [FIELD.move]: RETAINING_PARTS };

const driver: PluginDriver = {
  name: RETAINING_WALL,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === FIELD.vertex,
  choices: (field) => POPUPS[field]?.map((value) => ({ value, label: value })),
  place: () => toast("Select connected walls or an extrude, then AEC > Terrain > Create Retaining Wall Site Modifier.", "info"),
  edit,
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => redraw(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, apply) {
    const r = store.session ? retainingOf(store.session.doc, id) : null;
    if (!r) return;
    const part = partOf(r);
    const along = part === "Left Edge" || part === "Right Edge";
    apply(new Map(VERTEX_WIDGETS.map((w): [number, { enabled: boolean; visible: boolean }] => [w, { enabled: true, visible: along }])));
  },
  press(id, widget) {
    if (widget === BUTTON.update) updateSiteModels();
    else if (widget === BUTTON.previous) step(id, -1);
    else if (widget === BUTTON.next) step(id, 1);
    else if (widget === BUTTON.edges) sendTo(id, "edges");
    else if (widget === BUTTON.pad) sendTo(id, "pad");
  },
  path(id) {
    const s = store.session;
    const r = s ? retainingOf(s.doc, id) : null;
    const o = s?.doc.object(id);
    return r && o ? { points: verticesOf(r).map((q) => placeOf(o).toWorld(q)), closed: false } : null;
  },
  setPath(s, id, corners) {
    const r = retainingOf(s.doc, id);
    const o = s.doc.object(id);
    if (!r || !o) return;
    const local = corners.map(placeOf(o).toLocal);
    write(s, id, { [FIELD.path]: JSON.stringify(carriedHeights(verticesOf(r), local)) });
  },
};
registerPluginDrivers(() => [driver]);
