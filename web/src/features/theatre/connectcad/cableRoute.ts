// ConnectCAD's Cable Route tool set: cable paths and drop points. A cable path ('Rodeo Cable Path') is
// drawn by the Cable Route tool, its corners in 3D at the cable heights clicked at (a rise or drop
// where the height changes): in plan a line with a ring where it rises or drops, in 3D the line at
// its heights; Reshape moves its corners. Paths whose corners meet make a network; drawn with Join to
// Existing Routes, a path that ends on another splits it there. A drop point ('Rodeo Drop Point') is
// where cables come out to equipment (a wall box, a floor pocket): named A, B… (I and O passed by),
// its Location the layout room it's in, and Connected Equipment counting the equipment items whose
// Drop Point names it. cableNetwork gives Calculate Cable Lengths the network and what joins it;
// cableRouteShapes.ts has the sums.

import type { EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../../../core/index.ts";
import { attempt, setSelection } from "../../../app/commands.ts";
import { followEdits, registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../../app/ext.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { layerScaleOf } from "../../../app/spaces.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { dropName, nearestOnPath, network, pathLength3, splitPath, type Network, type Pt3 } from "./cableRouteShapes.ts";
import { dropPoints } from "./equipmentItem.ts";
import { roomIdAt } from "./layoutRoom.ts";

export const CABLE_PATH = "Rodeo Cable Path";
export const DROP_POINT = "Rodeo Drop Point";

const PLUGIN = 86;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const PATH = {
  id: "ID",
  location: "Location",
  length: "Length",
  /** the circuits Analyze Cable Routes found running along it */
  count: "Cable Count",
  /** its corners, [x, y, z] from its insertion and above its layer: kept out of Object Info */
  points: "Path Points",
} as const;

const DROP = {
  name: "Name",
  category: "Category",
  connected: "Connected Equipment",
  slack: "Cable Slack",
  location: "Location",
} as const;

export const DROP_CATEGORIES = ["Wall Box", "Floor Pocket", "Wall Socket", "Ceiling Box", "Cable Exit"] as const;

/** what the Cable Route tool draws at: its heights (Edit Cable Route Heights) and the one chosen, and whether a path joins those it ends on */
export const routeSettings = { heights: [0, 2400, 3000] as number[], height: 2400, join: true };
/** what the Drop Point tool places */
export const dropSettings = { category: "Wall Box" as string, slack: 0 };

/** a path's line, and a drop point's, mils */
const PATH_MILS = 25;
const DROP_MILS = 10;
/** a rise's ring across, a drop point's box across and its name's height, on paper, mm */
const RISE_MM = 2;
const DROP_MM = 4;
const LABEL_MM = 2;
/** a path's colour, so it reads apart from walls */
const PATH_INK = "#1f6feb";

interface Rec {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function recOf(doc: VwxDocument, id: string, name: string): Rec | null {
  const rec = doc.object(id)?.type === PLUGIN ? doc.records(id).find((r) => r.parametric && r.name === name) : undefined;
  const layerId = doc.object(id)?.layerId;
  return rec && layerId ? { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

function recsIn(doc: VwxDocument, name: string): Rec[] {
  if (!doc.hasPluginFormat(name)) return [];
  return doc.layers().flatMap((l) => doc.objects(l.id).flatMap((o) => (o.type === PLUGIN ? [recOf(doc, o.id, name)].filter((r): r is Rec => !!r) : [])));
}

const str = (v: RecordValue | undefined): string => (v === undefined ? "" : String(v));

function placeOf(o: ObjectInfo): { toWorld(q: Pt): Pt; toLocal(q: Pt): Pt } {
  const at = o.insertion ?? { x: 0, y: 0 };
  const turn = ((o.turned ?? 0) * Math.PI) / 180;
  const [c, n] = [Math.cos(turn), Math.sin(turn)];
  return {
    toWorld: (q) => ({ x: at.x + q.x * c - q.y * n, y: at.y + q.x * n + q.y * c }),
    toLocal: (q) => ({ x: (q.x - at.x) * c + (q.y - at.y) * n, y: -(q.x - at.x) * n + (q.y - at.y) * c }),
  };
}

/** A path's corners as it keeps them, from its insertion. */
function localCorners(r: Rec): Pt3[] {
  try {
    const raw: unknown = JSON.parse(str(r.value(PATH.points)) || "[]");
    return Array.isArray(raw) ? raw.flatMap((p): Pt3[] => (Array.isArray(p) && p.slice(0, 3).every(Number.isFinite) ? [{ x: Number(p[0]), y: Number(p[1]), z: Number(p[2]) }] : [])) : [];
  } catch {
    return [];
  }
}

const cornersText = (points: readonly Pt3[]): string => JSON.stringify(points.map((p) => [p.x, p.y, p.z].map((v) => Math.round(v * 1e4) / 1e4)));

/** A path's corners on the drawing. */
function worldCorners(doc: VwxDocument, r: Rec): Pt3[] {
  const o = doc.object(r.id);
  if (!o) return [];
  const { toWorld } = placeOf(o);
  return localCorners(r).map((p) => ({ ...toWorld(p), z: p.z }));
}

const ink = (hex: string): number => colorMatcher()({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

/** Draws path `r` from its corners, in the session's open batch. */
function drawPath(s: EditSession, r: Rec): void {
  const corners = localCorners(r);
  if (corners.length < 2) throw new Error("A cable path takes two corners or more.");
  const scale = layerScaleOf(r.layerId);
  const classIndex = s.doc.object(r.id)?.classIndex ?? store.activeClassIndex;
  const pen = { penFore: ink(PATH_INK), lineWeight: PATH_MILS, fillPattern: 0 };
  const plan: Pt[] = [];
  const shapes: NewShape[] = [];
  for (const p of corners) {
    const last = plan[plan.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) plan.push(p);
  }
  if (plan.length >= 2) shapes.push({ kind: "polyline", points: plan, closed: false } as NewShape);
  // a ring where it rises or drops
  const r0 = (RISE_MM / 2) * scale;
  for (let i = 0; i + 1 < corners.length; i++) {
    const [a, b] = [corners[i], corners[i + 1]];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6 && Math.abs(a.z - b.z) > 1e-6) shapes.push({ kind: "polygon", points: Array.from({ length: 16 }, (_, k) => ({ x: a.x + r0 * Math.cos((k * Math.PI) / 8), y: a.y + r0 * Math.sin((k * Math.PI) / 8) })), closed: true } as NewShape);
  }
  const ids = s.addObjects(r.layerId, shapes, classIndex, shapes.map(() => pen));
  // the layer's elevation is added as they're made, and a plug-in object's drawing is lifted by it again when shown
  const elevation = s.doc.layers().find((l) => l.id === r.layerId)?.elevation ?? 0;
  ids.push(s.add3DPolygons(r.layerId, [{ points: corners.flatMap((p) => [p.x, p.y, p.z - elevation]), closed: false }], classIndex));
  const length = Math.round(pathLength3(corners) * 1e4) / 1e4;
  if (r.value(PATH.length) !== length) s.setRecordField(r.id, r.format, PATH.length, length);
  s.setPluginDrawing(r.id, ids);
}

const pathSpecs = (points: string, location: string): PluginFieldSpec[] => [
  { name: PATH.id, type: TEXT, value: "" },
  { name: PATH.location, type: TEXT, value: location },
  { name: PATH.length, type: DIMENSION, value: 0 },
  { name: PATH.count, type: NUMBER, value: 0 },
  { name: PATH.points, type: TEXT, value: points },
];

/** Writes the cable paths' Cable Count (by path; 0 for those left out), as part of a batch. */
export function setCableCounts(s: EditSession, counts: ReadonlyMap<string, number>): void {
  s.growPluginFields(CABLE_PATH, pathSpecs("[]", ""));
  for (const r of recsIn(s.doc, CABLE_PATH)) {
    const n = counts.get(r.id) ?? 0;
    if (r.value(PATH.count) !== n) s.setRecordField(r.id, r.format, PATH.count, n);
  }
}

/** A new cable path on a layer through `corners` on the drawing, as part of a batch; its id. */
export function addCablePath(s: EditSession, layerId: string, corners: readonly Pt3[], location = ""): string {
  if (corners.length < 2) throw new Error("A cable path takes two corners or more.");
  const at = { x: corners[0].x, y: corners[0].y };
  const specs = pathSpecs(cornersText(corners.map((p) => ({ x: p.x - at.x, y: p.y - at.y, z: p.z }))), location);
  const made = s.addPluginObject(layerId, CABLE_PATH, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, store.activeClassIndex);
  drawPath(s, recOf(s.doc, made, CABLE_PATH)!);
  return made;
}

/** Gives path `id` new corners on the drawing, as part of a batch. */
function setCorners(s: EditSession, id: string, corners: readonly Pt3[]): void {
  const r = recOf(s.doc, id, CABLE_PATH);
  const o = s.doc.object(id);
  if (!r || !o) throw new Error("That isn't a cable path.");
  const { toLocal } = placeOf(o);
  s.setRecordField(id, r.format, PATH.points, cornersText(corners.map((p) => ({ ...toLocal(p), z: p.z }))));
  drawPath(s, recOf(s.doc, id, CABLE_PATH)!);
}

/** The drawing's cable paths: their corners on the drawing, ID, Location and Cable Count. */
export const cablePathsIn = (doc: VwxDocument): { id: string; layerId: string; points: Pt3[]; name: string; location: string; count: number }[] =>
  recsIn(doc, CABLE_PATH).map((r) => ({ id: r.id, layerId: r.layerId, points: worldCorners(doc, r), name: str(r.value(PATH.id)).trim(), location: str(r.value(PATH.location)).trim(), count: Number(r.value(PATH.count)) || 0 }));

/** The drawing's drop points: each one's name, where it is and its Cable Slack. */
export const dropPointsIn = (doc: VwxDocument): { id: string; layerId: string; name: string; at: Pt; slack: number }[] =>
  recsIn(doc, DROP_POINT).flatMap((r) => {
    const at = doc.object(r.id)?.insertion;
    return at ? [{ id: r.id, layerId: r.layerId, name: str(r.value(DROP.name)).trim(), at, slack: Math.max(0, Number(r.value(DROP.slack)) || 0) }] : [];
  });

/** Where a click at `p` lands for a cable path, within `within` on the drawing: a drop point (unless `drops` is false), or the nearest point of a path (with its height); null for neither. */
export function routeTarget(doc: VwxDocument, p: Pt, within: number, drops = true): { kind: "drop"; id: string; at: Pt } | { kind: "path"; id: string; i: number; t: number; at: Pt3 } | null {
  const drop = (drops ? dropPointsIn(doc) : [])
    .map((d) => ({ d, gap: Math.hypot(d.at.x - p.x, d.at.y - p.y) }))
    .filter((x) => x.gap <= within)
    .sort((a, b) => a.gap - b.gap)[0];
  if (drop) return { kind: "drop", id: drop.d.id, at: drop.d.at };
  let best: { id: string; i: number; t: number; at: Pt3; d: number } | null = null;
  for (const path of cablePathsIn(doc)) {
    const on = nearestOnPath(path.points, p);
    if (on && on.d <= within && (!best || on.d < best.d)) best = { id: path.id, ...on };
  }
  return best ? { kind: "path", id: best.id, i: best.i, t: best.t, at: best.at } : null;
}

/** Splits path `id` at `t` along its piece from corner `i`, as part of a batch: the second part a new path; nothing at its ends. */
export function splitCablePath(s: EditSession, id: string, i: number, t: number): void {
  const r = recOf(s.doc, id, CABLE_PATH);
  if (!r) return;
  const halves = splitPath(worldCorners(s.doc, r), i, t);
  if (!halves) return;
  setCorners(s, id, halves[0]);
  addCablePath(s, r.layerId, halves[1], str(r.value(PATH.location)));
}

/** The Cable Route tool's path: its corners, the paths it ends on split there when it joins them; the new path, selected. */
export function placeCableRoute(layerId: string, corners: readonly Pt3[], splits: readonly { id: string; i: number; t: number }[]): void {
  const r = attempt("Cable Route", (s) =>
    s.batch(() => {
      for (const k of splits) {
        // the path may already have been split by the other end
        const now = cablePathsIn(s.doc).find((p) => p.id === k.id);
        const at = now ? splitAt(s.doc, k) : null;
        const on = at && now ? nearestOnPath(now.points, at) : null;
        if (on) splitCablePath(s, k.id, on.i, on.t);
      }
      return addCablePath(s, layerId, corners);
    }),
  );
  if (r) setSelection([r.value]);
}

/** where a split asked for falls on the drawing, from the path as it was */
const splitAt = (doc: VwxDocument, k: { id: string; i: number; t: number }): Pt | null => {
  const path = cablePathsIn(doc).find((p) => p.id === k.id);
  const [a, b] = [path?.points[k.i], path?.points[k.i + 1]];
  return a && b ? { x: a.x + k.t * (b.x - a.x), y: a.y + k.t * (b.y - a.y) } : null;
};

/** The drawing's cable network, and the paths whose corners it was made from. */
export function cableNetwork(doc: VwxDocument): Network {
  return network(cablePathsIn(doc));
}

// ---- drop points

/** Draws drop point `r`, in the session's open batch, its Location and Connected Equipment written first. */
function drawDrop(s: EditSession, r: Rec): void {
  write(s, r, heldBy(s.doc, r));
  const scale = layerScaleOf(r.layerId);
  const classIndex = s.doc.object(r.id)?.classIndex ?? store.activeClassIndex;
  const black = ink("#000000");
  const h = (DROP_MM / 2) * scale;
  const category = str(r.value(DROP.category));
  const box: NewShape =
    category === "Floor Pocket" || category === "Ceiling Box"
      ? ({ kind: "polygon", points: Array.from({ length: 20 }, (_, k) => ({ x: h * Math.cos((k * Math.PI) / 10), y: h * Math.sin((k * Math.PI) / 10) })), closed: true } as NewShape)
      : ({ kind: "polygon", points: [{ x: -h, y: -h }, { x: h, y: -h }, { x: h, y: h }, { x: -h, y: h }], closed: true } as NewShape);
  const shapes: NewShape[] = [box, { kind: "line", a: { x: -h * 0.7, y: -h * 0.7 }, b: { x: h * 0.7, y: h * 0.7 } } as NewShape, { kind: "line", a: { x: -h * 0.7, y: h * 0.7 }, b: { x: h * 0.7, y: -h * 0.7 } } as NewShape];
  const looks: object[] = [{ penFore: black, lineWeight: DROP_MILS, fillPattern: 1, fillFore: ink("#ffffff"), fillBack: ink("#ffffff"), fillOpacity: 100 }, { penFore: black, lineWeight: DROP_MILS }, { penFore: black, lineWeight: DROP_MILS }];
  const name = str(r.value(DROP.name)).trim();
  if (name) {
    // its name upright to the right of it, however it's turned
    const turn = ((s.doc.object(r.id)?.turned ?? 0) * Math.PI) / 180;
    const at = { x: h * 1.4 * Math.cos(-turn), y: h * 1.4 * Math.sin(-turn) };
    shapes.push({ kind: "text", at, text: name, height: LABEL_MM * scale, hAlign: 1, vAlign: 3, angle: -(s.doc.object(r.id)?.turned ?? 0) } as NewShape);
    looks.push({ penFore: black, fillPattern: 0 });
  }
  s.setPluginDrawing(r.id, s.addObjects(r.layerId, shapes, classIndex, looks));
}

/** What a drop point takes from the drawing: the layout room it's in, and the equipment connected to it. */
function heldBy(doc: VwxDocument, r: Rec): Record<string, RecordValue> {
  const at = doc.object(r.id)?.insertion;
  const name = str(r.value(DROP.name)).trim();
  return { [DROP.location]: at ? roomIdAt(doc, at) : "", [DROP.connected]: name ? dropPoints.connected(doc, name) : 0 };
}

function write(s: EditSession, r: Rec, values: Readonly<Record<string, RecordValue>>): void {
  for (const [field, value] of Object.entries(values)) if (r.value(field) !== value) s.setRecordField(r.id, r.format, field, value);
}

/** A new drop point on a layer at `at`, turned `angle`, as part of a batch: the next free name; its id. */
export function addDropPoint(s: EditSession, layerId: string, at: Pt, angle: number): string {
  const name = dropName(new Set(dropPointsIn(s.doc).map((d) => d.name)));
  const specs: PluginFieldSpec[] = [
    { name: DROP.name, type: TEXT, value: name },
    { name: DROP.category, type: POPUP, value: dropSettings.category },
    { name: DROP.connected, type: NUMBER, value: 0 },
    { name: DROP.slack, type: DIMENSION, value: dropSettings.slack },
    { name: DROP.location, type: TEXT, value: "" },
  ];
  // equipment placed before drop points could be gains the field naming one
  dropPoints.grow(s);
  const made = s.addPluginObject(layerId, DROP_POINT, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, angle, store.activeClassIndex);
  drawDrop(s, recOf(s.doc, made, DROP_POINT)!);
  return made;
}

/** The Drop Point tool's clicks: a drop point (in Insert in Cable Path mode splitting the path it's on there), selected. */
export function placeDropPoint(layerId: string, at: Pt, angle: number, split: { id: string; i: number; t: number } | null): void {
  const r = attempt("Drop Point", (s) =>
    s.batch(() => {
      if (split) splitCablePath(s, split.id, split.i, split.t);
      return addDropPoint(s, layerId, at, angle);
    }),
  );
  if (r) setSelection([r.value]);
}

function editDrop(s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void {
  const r = recOf(s.doc, id, DROP_POINT);
  if (!r) throw new Error("That isn't a drop point.");
  const was = str(r.value(DROP.name)).trim();
  for (const [field, value] of Object.entries(values)) {
    if (field === DROP.slack && !(Number(value) >= 0)) throw new Error("Cable Slack can't be below 0.");
    if (field === DROP.name) {
      const name = String(value).trim();
      if (!name) throw new Error("A drop point needs a name.");
      if (name !== was && dropPointsIn(s.doc).some((d) => d.id !== id && d.name === name)) throw new Error(`Another drop point is named ${name}.`);
      s.setRecordField(id, r.format, field, name);
      // the equipment connected to it follows
      if (was && name !== was) dropPoints.rename(s, was, name);
    } else s.setRecordField(id, r.format, field, value);
  }
  drawDrop(s, recOf(s.doc, id, DROP_POINT)!);
}

// a drop point's Location and Connected Equipment follow the rooms and equipment as they change
followEdits((s) => {
  const stale = recsIn(s.doc, DROP_POINT).filter((r) => Object.entries(heldBy(s.doc, r)).some(([field, value]) => r.value(field) !== value));
  if (stale.length) s.followOn(() => stale.forEach((r) => write(s, r, heldBy(s.doc, r))));
});

dropPoints.names = (doc) => dropPointsIn(doc).map((d) => d.name);

const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });

const pathDriver: PluginDriver = {
  name: CABLE_PATH,
  shape: "linear",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === PATH.length || field === PATH.count,
  choices: () => undefined,
  place: () => toast("Draw it with the Cable Route tool in ConnectCAD Cable Route.", "info"),
  edit(id, values) {
    attempt("Edit Cable Path", (s) =>
      s.batch(() => {
        const r = recOf(s.doc, id, CABLE_PATH);
        if (!r) throw new Error("That isn't a cable path.");
        write(s, r, values);
        drawPath(s, recOf(s.doc, id, CABLE_PATH)!);
      }),
    );
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => {
        const r = recOf(s.doc, id, CABLE_PATH);
        if (r) drawPath(s, r);
      });
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => [param(1, PATH.id), param(2, PATH.location), param(3, PATH.length), param(4, PATH.count)],
  widgetStates: () => {},
  press: () => {},
  path(id) {
    const s = store.session;
    const r = s ? recOf(s.doc, id, CABLE_PATH) : null;
    if (!s || !r) return null;
    // a rise or drop is one corner in plan
    const points: Pt[] = [];
    for (const p of worldCorners(s.doc, r)) if (!points.length || Math.hypot(p.x - points[points.length - 1].x, p.y - points[points.length - 1].y) > 1e-6) points.push(p);
    return { points, closed: false };
  },
  setPath(s, id, corners) {
    const r = recOf(s.doc, id, CABLE_PATH);
    if (!r) return;
    // each plan corner keeps the heights it had (a rise or drop stays), a new one takes the height of the corner before
    const old = worldCorners(s.doc, r);
    const groups: Pt3[][] = [];
    for (const p of old) {
      const g = groups[groups.length - 1];
      if (g && Math.hypot(p.x - g[0].x, p.y - g[0].y) <= 1e-6) g.push(p);
      else groups.push([p]);
    }
    if (corners.length < 2) throw new Error("A cable path takes two corners or more.");
    const next: Pt3[] = [];
    corners.forEach((c, k) => {
      const g = groups.length === corners.length ? groups[k] : [{ x: 0, y: 0, z: next.length ? next[next.length - 1].z : (old[0]?.z ?? 0) }];
      for (const p of g) next.push({ x: c.x, y: c.y, z: p.z });
    });
    setCorners(s, id, next);
  },
};

const dropDriver: PluginDriver = {
  name: DROP_POINT,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === DROP.connected || field === DROP.location,
  choices: (field) => (field === DROP.category ? DROP_CATEGORIES.map((value) => ({ value, label: value })) : undefined),
  place: (layerId, at, angle) => placeDropPoint(layerId, at, angle, null),
  edit(id, values) {
    attempt("Edit Drop Point", (s) => s.batch(() => editDrop(s, id, values)));
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => {
        const r = recOf(s.doc, id, DROP_POINT);
        if (r) drawDrop(s, r);
      });
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => [{ id: 1, kind: "divider", label: "General", level: 0 }, param(2, DROP.name), param(3, DROP.category), param(4, DROP.connected), param(5, DROP.slack), param(6, DROP.location)],
  widgetStates: () => {},
  press: () => {},
};

registerPluginDrivers(() => [pathDriver, dropDriver]);
