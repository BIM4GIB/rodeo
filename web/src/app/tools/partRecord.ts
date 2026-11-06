// Tools > Machine Design > Create 3D Object From 2D, and the memory it works from. A 2D machine part
// whose tool has a "- 3D" twin (a gear, bearing, spring, fastener, steel section...) keeps, in a
// 'Rodeo Machine Part' record on what it places, the twin's tool, the tool's settings as they were
// (JSON) and where it was placed and turned. The command builds each selected part's 3D version
// from that, as its "- 3D" tool would place it, on the part's layer and in its class; a part moved
// since is followed by its bounds' centre. Objects without the record (drawn before Rodeo kept it,
// or Vectorworks' own plug-in objects) have no 3D version: they are deselected and counted, as
// Vectorworks deselects what it can't convert.

import type { BBox, EditSession, Pt, RecordFieldSpec, RecordValue, VwxDocument } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { unionBBox } from "../geom.ts";
import { store, type ToolId } from "../state.ts";
import { toast } from "../toast.ts";
import type { ToolEnv } from "../tools.ts";

export const PART_FORMAT = "Rodeo Machine Part";

const F = {
  part: "Part",
  tool: "3D Tool",
  settings: "Settings",
  x: "Insertion X",
  y: "Insertion Y",
  angle: "Rotation",
  cx: "Center X",
  cy: "Center Y",
} as const;

/** A "- 3D" tool, as Create 3D Object From 2D drives it. */
export interface PartTwin {
  /** Adds its 3D part at `at`, turned `angle` radians, on the layer and in the class; the ids added, or why nothing was. */
  placeIn(s: EditSession, layerId: string, classIndex: number, at: Pt, angle: number): string[] | string;
}

type TwinMaker = new (env: ToolEnv) => PartTwin;

/** each 2D tool class with a twin: the twin's tool id */
const twinIds = new Map<abstract new (...args: never[]) => unknown, ToolId>();
/** the twins by their tool id */
const twins = new Map<ToolId, TwinMaker>();
/** what the twins are built with: the editor's, kept as the tools are made */
let toolEnv: ToolEnv | null = null;

/** Records `twin` (tool `id`) as the 3D version of what tools of class `base` place. */
export function registerTwin(base: abstract new (...args: never[]) => unknown, id: ToolId, twin: TwinMaker): void {
  twinIds.set(base, id);
  twins.set(id, twin);
}

/** Keeps the editor's tool surroundings for the twins Create 3D Object From 2D builds. */
export function noteToolEnv(env: ToolEnv): void {
  toolEnv = env;
}

/** a tool's own fields that aren't its settings */
const NOT_SETTINGS = new Set(["env", "id", "cursor", "label", "press", "pointer", "last", "placing"]);
const MAP = "<map>";
const SET = "<set>";

/** A tool's settings as JSON: its own fields, Maps and Sets marked, functions and its surroundings left out. */
export function packSettings(tool: object): string {
  const seen = new WeakSet<object>();
  const pack = (v: unknown): unknown => {
    if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") return undefined;
    if (!v || typeof v !== "object") return v;
    if (seen.has(v)) return undefined;
    seen.add(v);
    if (v instanceof Map) return { [MAP]: [...v].map(([k, x]) => [k, pack(x)]) };
    if (v instanceof Set) return { [SET]: [...v].map(pack) };
    if (Array.isArray(v)) return v.map(pack);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
  };
  const own = Object.entries(tool).filter(([k, v]) => !NOT_SETTINGS.has(k) && typeof v !== "function");
  return JSON.stringify(Object.fromEntries(own.map(([k, v]) => [k, pack(v)])));
}

/**
 * Sets a fresh tool's fields to settings packSettings made. A class instance the tool holds (its
 * preferences' parts) is copied with its class and its fields set; plain values and tables' rows
 * are replaced, so the tables they came from are left alone.
 */
export function unpackSettings(tool: object, json: string): void {
  const into = (cur: unknown, v: unknown): unknown => {
    if (!v || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => into(undefined, x));
    const o = v as Record<string, unknown>;
    if (Array.isArray(o[MAP])) return new Map((o[MAP] as [unknown, unknown][]).map(([k, x]) => [k, into(cur instanceof Map ? cur.get(k) : undefined, x)]));
    if (Array.isArray(o[SET])) return new Set((o[SET] as unknown[]).map((x) => into(undefined, x)));
    const proto = cur && typeof cur === "object" && !Array.isArray(cur) ? Object.getPrototypeOf(cur) : null;
    const out: Record<string, unknown> = proto && proto !== Object.prototype ? Object.assign(Object.create(proto), cur) : {};
    for (const [k, x] of Object.entries(o)) out[k] = into(out[k], x);
    return out;
  };
  const t = tool as Record<string, unknown>;
  for (const [k, v] of Object.entries(JSON.parse(json) as Record<string, unknown>)) {
    if (!NOT_SETTINGS.has(k) && k in t && typeof t[k] !== "function") t[k] = into(t[k], v);
  }
}

function partFormat(s: EditSession): number {
  const had = s.doc.recordFormats().find((f) => f.name === PART_FORMAT);
  if (had) return had.format;
  const text = (name: string): RecordFieldSpec => ({ name, kind: "text", value: "" });
  const num = (name: string): RecordFieldSpec => ({ name, kind: "number", value: 0 });
  return s.createRecordFormat(PART_FORMAT, [text(F.part), text(F.tool), text(F.settings), num(F.x), num(F.y), num(F.angle), num(F.cx), num(F.cy)]);
}

const centre = (b: BBox): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

/** Where an object lies in plan: its shape's box, a 3D object's, or a group's members' together. */
function boxOf(doc: VwxDocument, id: string): BBox | null {
  const o = doc.object(id);
  if (!o) return null;
  let box = o.shape?.bbox ?? o.bounds ?? null;
  if (o.typeName === "group") for (const c of doc.objects(o.layerId)) if (c.parentId === id) box = unionBBox(box, boxOf(doc, c.id));
  return box;
}

/**
 * What a 2D tool's placing does besides, inside its undo step: on the object it placed, the record
 * Create 3D Object From 2D builds from; undefined for a tool with no 3D twin.
 */
export function partNote(tool: object, label: string, placing: { at: Pt; angle: number } | null): ((s: EditSession, id: string) => void) | undefined {
  const twin = twinIds.get(tool.constructor as abstract new (...args: never[]) => unknown);
  if (!twin || !placing) return undefined;
  const settings = packSettings(tool);
  return (s, id) => {
    const b = boxOf(s.doc, id);
    const c = b ? centre(b) : placing.at;
    const fields: Record<string, RecordValue> = {
      [F.part]: label,
      [F.tool]: twin,
      [F.settings]: settings,
      [F.x]: placing.at.x,
      [F.y]: placing.at.y,
      [F.angle]: (placing.angle * 180) / Math.PI,
      [F.cx]: c.x,
      [F.cy]: c.y,
    };
    s.attachRecords([{ id, format: partFormat(s), fields }]);
  };
}

interface Remembered {
  readonly id: string;
  readonly layerId: string;
  readonly classIndex: number;
  readonly twin: TwinMaker;
  readonly settings: string;
  readonly at: Pt;
  readonly angle: number;
}

/** The selected object's part record, followed to where its bounds' centre is now; null when it has none or no twin. */
function remembered(id: string): Remembered | null {
  const doc = store.session?.doc;
  const o = doc?.object(id);
  const rec = o && doc!.records(id).find((r) => !r.parametric && r.name === PART_FORMAT);
  if (!o || !rec) return null;
  const field = (name: string): RecordValue | undefined => rec.fields.find((f) => f.name === name)?.value;
  const num = (name: string): number => Number(field(name) ?? NaN);
  const twin = twins.get(String(field(F.tool) ?? "") as ToolId);
  const settings = String(field(F.settings) ?? "");
  const [x, y, cx, cy, angle] = [num(F.x), num(F.y), num(F.cx), num(F.cy), num(F.angle)];
  if (!twin || !settings || ![x, y, cx, cy, angle].every(Number.isFinite)) return null;
  const box = boxOf(doc!, id);
  const now = box ? centre(box) : { x: cx, y: cy };
  return { id, layerId: o.layerId, classIndex: o.classIndex, twin, settings, at: { x: x + now.x - cx, y: y + now.y - cy }, angle: (angle * Math.PI) / 180 };
}

/** Create 3D Object From 2D wants something selected. */
export const canCreate3DFrom2D = (): boolean => store.selection.size > 0;

/** Tools > Machine Design > Create 3D Object From 2D: one undo step; the 3D parts made are selected. */
export function create3DObjectFrom2D(): void {
  const parts: Remembered[] = [];
  const without: string[] = [];
  for (const id of store.selection) {
    const r = remembered(id);
    if (r) parts.push(r);
    else without.push(id);
  }
  const env = toolEnv;
  if (!parts.length || !env) {
    setSelection([]);
    toast("Nothing selected has a 3D version: select 2D machine parts placed by Rodeo's Machine Components, Fasteners or Steel Section tools.", "info");
    return;
  }
  const problems: string[] = [];
  const made = attempt("Create 3D Object From 2D", (s) =>
    s.batch(() =>
      parts.flatMap((p) => {
        const twin = new p.twin(env);
        unpackSettings(twin, p.settings);
        const ids = twin.placeIn(s, p.layerId, p.classIndex, p.at, p.angle);
        if (typeof ids === "string") problems.push(ids);
        return typeof ids === "string" ? [] : ids;
      }),
    ),
  );
  if (!made) return;
  setSelection(made.value);
  const notes = [
    `${parts.length - problems.length} 3D ${parts.length - problems.length === 1 ? "object" : "objects"} made`,
    ...(without.length ? [`${without.length} with no 3D version deselected`] : []),
    ...(problems.length ? [`${problems.length} refused: ${problems[0]}`] : []),
  ];
  toast(`${notes.join("; ")}.`, "info");
}
