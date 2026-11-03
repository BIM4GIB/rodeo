// ConnectCAD's Layout Room: an optional container for equipment racks, drawn from an outline by the
// Layout Room tool (Rectangle or Polygon mode) or made from a closed shape by AEC > Create Objects
// from Shapes. A plug-in object ('Rodeo Layout Room') placed at its first corner: its corners move
// with Reshape; in plan it draws its outline with its Room ID at the top left, and unless it's 2D
// only, the wireframe of its walls up to its Height in 3D. roomIdAt gives the Room ID of a point, the
// rooms round it from the outermost in (MAIN.AV1). layoutShapes.ts has the sums.

import type { EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../../../core/index.ts";
import { attempt, setSelection } from "../../../app/commands.ts";
import { registerPluginDrivers, registerShapeObject, type PluginDriver, type PluginWidget } from "../../../app/ext.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { layerScaleOf } from "../../../app/spaces.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { formatArea } from "../../../app/units.ts";
import { nextName } from "./ccadShapes.ts";
import { ringArea, roomLabelAt, roomPath, roomWireframe, type RoomRing } from "./layoutShapes.ts";

export const LAYOUT_ROOM = "Rodeo Layout Room";

const PLUGIN = 86;
const BOOL = 2;
const TEXT = 4;
const DIMENSION = 7;

const FIELD = {
  id: "Room ID",
  height: "Height",
  flat: "2D only",
  area: "Area",
  /** kept out of Object Info */
  path: "Path Points",
} as const;

/** what the tool and Create Objects from Shapes make a room with */
export const layoutRoomSettings = { id: "ROOM1", height: 3000, flat: true };

/** the outline's weight, mils */
const OUTLINE_MILS = 14;
/** the Room ID's height on paper, and how far in from the outline's top left it sits, mm */
const LABEL_MM = 3;
const INSET_MM = 1.5;

interface Room {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function roomOf(doc: VwxDocument, id: string): Room | null {
  const rec = doc.object(id)?.type === PLUGIN ? doc.records(id).find((r) => r.parametric && r.name === LAYOUT_ROOM) : undefined;
  const layerId = doc.object(id)?.layerId;
  return rec && layerId ? { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

const cornersOf = (r: Room): Pt[] => {
  try {
    const raw: unknown = JSON.parse(String(r.value(FIELD.path) || "[]"));
    return Array.isArray(raw) ? (raw as Pt[]) : [];
  } catch {
    return [];
  }
};

function placeOf(o: ObjectInfo): { toWorld(q: Pt): Pt; toLocal(q: Pt): Pt } {
  const at = o.insertion ?? { x: 0, y: 0 };
  const turn = ((o.turned ?? 0) * Math.PI) / 180;
  const [c, n] = [Math.cos(turn), Math.sin(turn)];
  return {
    toWorld: (q) => ({ x: at.x + q.x * c - q.y * n, y: at.y + q.x * n + q.y * c }),
    toLocal: (q) => ({ x: (q.x - at.x) * c + (q.y - at.y) * n, y: -(q.x - at.x) * n + (q.y - at.y) * c }),
  };
}

/** The drawing's layout rooms, their corners on the drawing. */
export function layoutRooms(doc: VwxDocument): (RoomRing & { readonly objectId: string; readonly layerId: string })[] {
  if (!doc.hasPluginFormat(LAYOUT_ROOM)) return [];
  return doc.layers().flatMap((l) =>
    doc.objects(l.id).flatMap((o) => {
      const r = o.type === PLUGIN ? roomOf(doc, o.id) : null;
      return r ? [{ objectId: o.id, layerId: l.id, id: String(r.value(FIELD.id) ?? "").trim(), ring: cornersOf(r).map(placeOf(o).toWorld) }] : [];
    }),
  );
}

/** The Room ID of what stands at `p` on the drawing: the layout rooms round it from the outermost in, joined by dots; "" in none. */
export const roomIdAt = (doc: VwxDocument, p: Pt): string => roomPath(layoutRooms(doc), p);

const black = (): number => colorMatcher()({ r: 0, g: 0, b: 0 });

/** Draws room `r` from its corners, in the session's open batch. */
function drawRoom(s: EditSession, r: Room): void {
  const corners = cornersOf(r);
  if (corners.length < 3) throw new Error("A layout room takes an outline of three corners or more.");
  const scale = layerScaleOf(r.layerId);
  const ink = black();
  const classIndex = s.doc.object(r.id)?.classIndex ?? store.activeClassIndex;
  const shapes: NewShape[] = [{ kind: "polygon", points: corners, closed: true } as NewShape];
  const looks = [{ penFore: ink, lineWeight: OUTLINE_MILS, fillPattern: 0 }];
  const name = String(r.value(FIELD.id) ?? "").trim();
  if (name) {
    shapes.push({ kind: "text", at: roomLabelAt(corners, INSET_MM * scale), text: name, height: LABEL_MM * scale, hAlign: 1, vAlign: 1, angle: 0 } as NewShape);
    looks.push({ penFore: ink, lineWeight: 1, fillPattern: 0 });
  }
  s.setRecordField(r.id, r.format, FIELD.area, formatArea(ringArea(corners), s.doc.info.units));
  const ids = s.addObjects(r.layerId, shapes, classIndex, looks);
  const height = Number(r.value(FIELD.height)) || 0;
  if (r.value(FIELD.flat) !== true && height > 0) {
    // the layer's elevation is added as they're made, and a plug-in object's drawing is lifted by it again when shown
    const elevation = s.doc.layers().find((l) => l.id === r.layerId)?.elevation ?? 0;
    ids.push(s.add3DPolygons(r.layerId, roomWireframe(corners, -elevation, height - elevation), classIndex));
  }
  s.setPluginDrawing(r.id, ids);
}

const clean = (corners: readonly Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (const p of corners) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1) out.pop();
  return out;
};

/** A new layout room on a layer, as part of a batch: its Room ID numbered on when another room has it. */
export function addLayoutRoom(s: EditSession, layerId: string, outline: readonly Pt[]): string {
  const corners = clean(outline);
  if (corners.length < 3) throw new Error("A layout room takes an outline of three corners or more.");
  const at = corners[0];
  const local = corners.map((p) => ({ x: p.x - at.x, y: p.y - at.y }));
  const k = layoutRoomSettings;
  const wanted = k.id.trim();
  const id = wanted ? nextName(wanted, new Set(layoutRooms(s.doc).map((r) => r.id))) : "";
  const specs: PluginFieldSpec[] = [
    { name: FIELD.id, type: TEXT, value: id },
    { name: FIELD.height, type: DIMENSION, value: k.height },
    { name: FIELD.flat, type: BOOL, value: k.flat },
    { name: FIELD.area, type: TEXT, value: "" },
    { name: FIELD.path, type: TEXT, value: JSON.stringify(local) },
  ];
  const made = s.addPluginObject(layerId, LAYOUT_ROOM, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, store.activeClassIndex);
  const r = roomOf(s.doc, made);
  if (!r) throw new Error("The layout room couldn't be made.");
  drawRoom(s, r);
  return made;
}

/** The tool's outline as a layout room, selected. */
export function placeLayoutRoom(layerId: string, outline: readonly Pt[]): void {
  const r = attempt("Layout Room", (s) => s.batch(() => addLayoutRoom(s, layerId, outline)));
  if (r) setSelection([r.value]);
}

function write(s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void {
  const r = roomOf(s.doc, id);
  if (!r) throw new Error("That isn't a layout room.");
  for (const [field, value] of Object.entries(values)) {
    if (field === FIELD.height && !(Number(value) >= 0)) throw new Error("A layout room's height can't be below 0.");
    s.setRecordField(id, r.format, field, field === FIELD.id ? String(value).trim() : value);
  }
  drawRoom(s, roomOf(s.doc, id)!);
}

const WIDGETS: readonly PluginWidget[] = [
  { id: 1, kind: "param", field: FIELD.id, label: "", level: 0 },
  { id: 2, kind: "param", field: FIELD.height, label: "", level: 0 },
  { id: 3, kind: "param", field: FIELD.flat, label: "", level: 0 },
  { id: 4, kind: "param", field: FIELD.area, label: "", level: 0 },
];

const driver: PluginDriver = {
  name: LAYOUT_ROOM,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === FIELD.area,
  choices: () => undefined,
  place: () => toast("Draw it with the Layout Room tool in ConnectCAD Layout.", "info"),
  edit(id, values) {
    attempt("Edit Layout Room", (s) => s.batch(() => write(s, id, values)));
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => {
        const r = roomOf(s.doc, id);
        if (r) drawRoom(s, r);
      });
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, apply) {
    const r = store.session ? roomOf(store.session.doc, id) : null;
    if (r) apply(new Map([[2, { enabled: r.value(FIELD.flat) !== true, visible: true }]]));
  },
  press: () => {},
  path(id) {
    const s = store.session;
    const r = s ? roomOf(s.doc, id) : null;
    const o = s?.doc.object(id);
    return r && o ? { points: cornersOf(r).map(placeOf(o).toWorld), closed: true } : null;
  },
  setPath(s, id, corners) {
    const o = s.doc.object(id);
    if (!o) return;
    const local = clean(corners).map(placeOf(o).toLocal);
    if (local.length < 3) throw new Error("A layout room takes an outline of three corners or more.");
    write(s, id, { [FIELD.path]: JSON.stringify(local) });
  },
};

registerPluginDrivers(() => [driver]);
registerShapeObject({ label: "Layout Room", style: "As the Layout Room tool's preferences", make: addLayoutRoom });
