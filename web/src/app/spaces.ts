// Space Planning's spaces, shared by the Space tool (tools/space.ts) and AEC > Space Planning's
// commands: Create Spaces from Walls and from Polys, Update Spaces and Create Walls from Spaces.
// Vectorworks makes Space objects, with room finishes, 3D volumes, zones and data tags; a space here is
// a group named "Space …" of its boundary polygon and label, with its data in a Space Data record where
// the drawing has record formats to make one from. Space objects a drawing already has aren't read
// by these commands.

import type { EditSession, ObjectInfo, Pt, RecordFieldSpec, RecordValue } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { pointInPolygon } from "./geom.ts";
import { spaceOf } from "./planShapes.ts";
import { meetLine, spaceWalls, type ExteriorAlign, type WallLine } from "./spaceWalls.ts";
import { store } from "./state.ts";
import { closedOutline } from "./surfaces.ts";
import { toast } from "./toast.ts";
import { toolPrefs, type PrefField, type PrefValues } from "./toolPrefs.ts";
import { formatArea } from "./units.ts";
import { ringArea, wallPolys } from "./wallPolys.ts";
import type { Part } from "./tools/detailing.ts";
import { wallLabel } from "./tools/wall.ts";

/** Vectorworks' wall object type */
export const WALL = 68;
const H_CENTRE = 2;
const V_CENTRE = 3;
/** the name's and the rest of a label's heights on paper, mm */
const NAME_MM = 3.5;
const LINE_MM = 2.5;
/** not "Space", which is the name of Vectorworks' own plug-in format in drawings that have Space objects */
export const SPACE_FORMAT = "Space Data";
const FORMAT = SPACE_FORMAT;
const SPACE_NAME = /^Space\b/;
const AREA_TEXT = /(m²|sq ft|sq yd|sq mi)$/;
/** how far a tee's end may be carried on to reach the wall it meets, past the wall's thickness, mm */
const TEE_MARGIN = 2;

export interface SpaceSettings {
  numberType: "text" | "increment";
  labelText: string;
  /** an integer or letters: the next new space's number */
  next: string;
  increment: number;
  spaceType: "Normal" | "Full Floor";
  name: string;
  occupantType: string;
  organization: string;
  occupantName: string;
  proposedArea: string;
  department: string;
  showBoundary: boolean;
  showName: boolean;
  showNumber: boolean;
  showArea: boolean;
  height: number;
}

export const spaceSettings: SpaceSettings = {
  numberType: "increment",
  labelText: "",
  next: "1",
  increment: 1,
  spaceType: "Normal",
  name: "Space",
  occupantType: "",
  organization: "",
  occupantName: "",
  proposedArea: "",
  department: "",
  showBoundary: true,
  showName: true,
  showNumber: true,
  showArea: true,
  height: 2438.4,
};

/** A number or run of letters moved on by `by`: 9 to 10, Z to AA, z to aa. */
export function nextNumber(value: string, by: number): string {
  if (/^\d+$/.test(value)) return String(Math.max(0, Number(value) + by)).padStart(value.length, "0");
  if (!/^[A-Za-z]+$/.test(value)) return value;
  const lower = value === value.toLowerCase();
  let n = 0;
  for (const c of value.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
  n = Math.max(1, n + by);
  let out = "";
  while (n > 0) {
    n--;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return lower ? out.toLowerCase() : out;
}

/** Whether a number can count on from `value`. */
export const countable = (value: string): boolean => /^(\d+|[A-Za-z]+)$/.test(value);

export function spacePrefFields(): PrefField[] {
  const p = spaceSettings;
  return [
    { kind: "choice", key: "numberType", label: "Space Number Type", value: p.numberType, options: [{ value: "increment", label: "Incrementing Value" }, { value: "text", label: "Label Text" }] },
    { kind: "text", key: "labelText", label: "Label Text", value: p.labelText },
    { kind: "text", key: "next", label: "Next Value (a number or letters)", value: p.next },
    { kind: "number", key: "increment", label: "Increment", value: p.increment, min: 1, max: 9999, integer: true },
    { kind: "choice", key: "spaceType", label: "Space Type", value: p.spaceType, options: [{ value: "Normal", label: "Normal" }, { value: "Full Floor", label: "Full Floor" }] },
    { kind: "text", key: "name", label: "Space Name", value: p.name },
    { kind: "text", key: "occupantType", label: "Occupant Type", value: p.occupantType },
    { kind: "text", key: "organization", label: "Occup. Organization", value: p.organization },
    { kind: "text", key: "occupantName", label: "Occupant Name", value: p.occupantName },
    { kind: "text", key: "proposedArea", label: "Proposed Area", value: p.proposedArea },
    { kind: "text", key: "department", label: "Department", value: p.department },
    { kind: "length", key: "height", label: "Height", value: p.height },
    { kind: "check", key: "showBoundary", label: "Show 2D Boundary", value: p.showBoundary },
    { kind: "check", key: "showName", label: "Label: Space Name", value: p.showName },
    { kind: "check", key: "showNumber", label: "Label: Space Number", value: p.showNumber },
    { kind: "check", key: "showArea", label: "Label: Area", value: p.showArea },
  ];
}

export function readSpacePrefs(v: PrefValues): void {
  const p = spaceSettings;
  p.numberType = v.choice("numberType") === "text" ? "text" : "increment";
  p.labelText = v.choice("labelText");
  if (countable(v.choice("next").trim())) p.next = v.choice("next").trim();
  p.increment = v.num("increment");
  p.spaceType = v.choice("spaceType") === "Full Floor" ? "Full Floor" : "Normal";
  p.name = v.choice("name");
  p.occupantType = v.choice("occupantType");
  p.organization = v.choice("organization");
  p.occupantName = v.choice("occupantName");
  p.proposedArea = v.choice("proposedArea");
  p.department = v.choice("department");
  p.height = v.num("height");
  p.showBoundary = v.flag("showBoundary");
  p.showName = v.flag("showName");
  p.showNumber = v.flag("showNumber");
  p.showArea = v.flag("showArea");
}

export async function spacePreferences(): Promise<void> {
  const v = await toolPrefs(
    "Space Preferences",
    spacePrefFields(),
    "A space is a group of its boundary and label. Its data goes in a Space Data record where the drawing can make one; room finishes, zones, data tags and 3D volumes aren't made.",
  );
  if (v) readSpacePrefs(v);
}

const units = (): string | undefined => store.session?.doc.info.units;

interface SpaceFigures {
  readonly area: number;
  readonly perimeter: number;
  readonly length: number;
  readonly width: number;
}

function figuresOf(ring: readonly Pt[]): SpaceFigures {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const perimeter = ring.reduce((a, p, i) => a + Math.hypot(ring[(i + 1) % ring.length].x - p.x, ring[(i + 1) % ring.length].y - p.y), 0);
  const across = Math.max(...xs) - Math.min(...xs);
  const up = Math.max(...ys) - Math.min(...ys);
  return { area: ringArea(ring), perimeter, length: Math.max(across, up), width: Math.min(across, up) };
}

/** The label's lines at the centre of the space, from the top down. */
function labelParts(at: Pt, number: string, area: string, scale: number, name: string): Part[] {
  const p = spaceSettings;
  const lines: { text: string; mm: number }[] = [
    ...(p.showName && name ? [{ text: name, mm: NAME_MM }] : []),
    ...(p.showNumber && number ? [{ text: number, mm: LINE_MM }] : []),
    ...(p.showArea ? [{ text: area, mm: LINE_MM }] : []),
  ];
  const gaps = lines.map((l) => l.mm * scale * 1.3);
  let y = at.y + gaps.reduce((a, g) => a + g, 0) / 2;
  return lines.map((l, i): Part => {
    const part: Part = { kind: "text", at: { x: at.x, y: y - gaps[i] / 2 }, text: l.text, height: l.mm * scale, hAlign: H_CENTRE, vAlign: V_CENTRE };
    y -= gaps[i];
    return part;
  });
}

/** added after the first spaces were made: a record format from then gains them */
const PLANNING_FIELDS: readonly RecordFieldSpec[] = [
  { name: "Department", kind: "text", value: "" },
  { name: "Matrix Order", kind: "number", value: 0 },
];

/** The Space Data record format, made if it's new and with the planning fields whatever it was. */
export function recordFormat(s: EditSession): number {
  const had = s.doc.recordFormats().find((f) => f.name === FORMAT);
  if (had) {
    const fields = s.doc.recordFormatFields(had.format);
    if (fields && !PLANNING_FIELDS.every((f) => fields.some((x) => x.name === f.name))) {
      const kept = fields.map((f): RecordFieldSpec => ({ name: f.name, kind: f.kind, value: f.value, from: f.name }));
      s.editRecordFormat(had.format, [...kept, ...PLANNING_FIELDS.filter((f) => !fields.some((x) => x.name === f.name))]);
    }
    return had.format;
  }
  const text = (name: string): RecordFieldSpec => ({ name, kind: "text", value: "" });
  const length = (name: string): RecordFieldSpec => ({ name, kind: "dimension", value: 0 });
  return s.createRecordFormat(FORMAT, [
    text("Space Number"),
    text("Space Type"),
    text("Space Name"),
    text("Occupant Type"),
    text("Occup. Organization"),
    text("Occupant Name"),
    text("Proposed Area"),
    { name: "Area", kind: "number", value: 0 },
    length("Perimeter"),
    length("Length"),
    length("Width"),
    length("Height"),
    ...PLANNING_FIELDS,
  ]);
}

/** The record's figures; a new field can't be an area, so Area is a number in the unit an area reads in. */
const figureFields = (f: SpaceFigures): Record<string, RecordValue> => ({ Area: f.area / areaUnit().mm2, Perimeter: f.perimeter, Length: f.length, Width: f.width });

export interface SpacePath {
  readonly ring: readonly Pt[];
  readonly layerId: string;
  readonly classIndex: number;
  readonly scale: number;
  /** what the space preferences would give it, otherwise */
  readonly name?: string;
  readonly department?: string;
  readonly order?: number;
}

/** Adds a space for each path, numbered on, in one step with whatever calls it; their groups' ids. */
export function addSpaces(s: EditSession, paths: readonly SpacePath[]): string[] {
  const p = spaceSettings;
  const used = new Set<string>();
  for (const l of s.doc.layers()) for (const o of s.doc.objects(l.id)) if (o.name) used.add(o.name);
  const nameFor = (number: string): string => {
    const base = number ? `Space ${number}` : "Space";
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
    used.add(name);
    return name;
  };
  const format = recordFormat(s);
  const ids: string[] = [];
  const values: { id: string; fields: Readonly<Record<string, RecordValue>> }[] = [];
  const boundary = p.showBoundary ? store.drawAttrs : { ...store.drawAttrs, lineStyle: 0, fillPattern: 0 };
  for (const path of paths) {
    const space = spaceOf(path.ring);
    if (!space) continue;
    const number = p.numberType === "text" ? p.labelText : p.next;
    const figures = figuresOf(space.outline);
    const made = [s.addObject(path.layerId, { kind: "polygon", points: space.outline, closed: true }, path.classIndex, boundary)];
    for (const part of labelParts(space.labelAt, number, formatArea(space.area, units()), path.scale, path.name ?? p.name)) made.push(s.addObject(path.layerId, part as never, path.classIndex, store.drawAttrs));
    const group = s.groupObjects(made);
    s.setObjectName(group, nameFor(number));
    ids.push(group);
    values.push({
      id: group,
      fields: {
        "Space Number": number,
        "Space Type": p.spaceType,
        "Space Name": path.name ?? p.name,
        "Occupant Type": p.occupantType,
        "Occup. Organization": p.organization,
        "Occupant Name": p.occupantName,
        "Proposed Area": p.proposedArea,
        Department: path.department ?? p.department,
        "Matrix Order": path.order ?? 0,
        Height: p.height,
        ...figureFields(figures),
      },
    });
    if (p.numberType === "increment") p.next = nextNumber(p.next, p.increment);
  }
  if (ids.length) {
    s.attachRecord(ids, format);
    s.setRecordFields(format, values);
  }
  return ids;
}

/** The scale text is drawn at on this layer. */
export function layerScaleOf(layerId: string): number {
  const layer = store.session?.doc.layers().find((l) => l.id === layerId);
  return layer?.kind === "design" && layer.scale > 0 ? layer.scale : 1;
}

/** The ids of walls on a layer. */
export function wallsOn(layerId: string): string[] {
  const doc = store.session?.doc;
  return doc ? doc.objects(layerId).filter((o) => o.type === WALL).map((o) => o.id) : [];
}

// ---- reading spaces back ------------------------------------------------------------

export interface SpaceGroup {
  readonly obj: ObjectInfo;
  readonly boundary: ObjectInfo;
  readonly ring: Pt[];
  readonly texts: readonly ObjectInfo[];
}

/** The spaces on a layer, from the groups the tool and commands make. */
export function spacesOn(layerId: string): SpaceGroup[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const objects = doc.objects(layerId);
  const out: SpaceGroup[] = [];
  for (const obj of objects) {
    if (obj.kind !== "group" || obj.parentId || !obj.name || !SPACE_NAME.test(obj.name)) continue;
    const kids = objects.filter((k) => k.parentId === obj.id);
    const boundary = kids.find((k) => k.shape && closedOutline(k.shape));
    const ring = boundary?.shape ? closedOutline(boundary.shape) : null;
    if (boundary && ring) out.push({ obj, boundary, ring, texts: kids.filter((k) => k.shape?.kind === "text") });
  }
  return out;
}

export const hasSpaces = (): boolean => !!store.session?.doc.layers().some((l) => spacesOn(l.id).length > 0);

/** Re-measures a space's label and record from its boundary. */
function remeasure(s: EditSession, space: SpaceGroup, ring: readonly Pt[]): void {
  const area = formatArea(ringArea(ring), units());
  for (const t of space.texts) if (AREA_TEXT.test(t.shape?.text ?? "")) s.setText(t.id, area);
  const format = s.doc.recordFormats().find((f) => f.name === FORMAT);
  if (format && s.doc.records(space.obj.id).some((r) => r.format === format.format)) s.setRecordFields(format.format, [{ id: space.obj.id, fields: figureFields(figuresOf(ring)) }]);
}

/** AEC > Space Planning > Update Spaces…: spaces' areas re-measured, once their boundaries have been edited. */
export async function updateSpacesDialog(): Promise<void> {
  const doc = store.session?.doc;
  const layerId = store.activeLayerId;
  if (!doc) return;
  const v = await toolPrefs(
    "Update Spaces",
    [{ kind: "choice", key: "which", label: "Update", value: "all", options: [{ value: "selected", label: "All selected spaces in the drawing" }, { value: "layer", label: "All spaces on the current layer" }, { value: "all", label: "All spaces in the document" }] }],
    "Re-measures each space's area in its label and record from its boundary, for the spaces this app has made.",
  );
  if (!v) return;
  const which = v.choice("which");
  const layers = which === "layer" ? (layerId ? [layerId] : []) : doc.layers().map((l) => l.id);
  const chosen = layers.flatMap(spacesOn).filter((sp) => which !== "selected" || store.selection.has(sp.obj.id));
  if (!chosen.length) {
    toast("No spaces to update there.", "info");
    return;
  }
  const r = attempt("Update Spaces", (s) => s.batch(() => chosen.forEach((sp) => remeasure(s, sp, sp.ring))));
  if (r) toast(`Updated ${chosen.length} ${chosen.length === 1 ? "space" : "spaces"}.`, "info");
}

// ---- from walls and shapes ---------------------------------------------------------------

const layerOptions = (): { value: string; label: string }[] =>
  (store.session?.doc.layers() ?? []).filter((l) => l.kind === "design").map((l) => ({ value: l.id, label: l.name }));

/** mm² in the unit an area reads in, in this drawing. */
export function areaUnit(): { readonly mm2: number; readonly name: string } {
  const name = formatArea(1e9, units()).split(" ").slice(1).join(" ");
  return { name, mm2: name === "sq ft" ? 304.8 ** 2 : name === "sq yd" ? 914.4 ** 2 : name === "sq mi" ? 1609344 ** 2 : 1e6 };
}

/** AEC > Space Planning > Create Spaces from Walls…: room or gross spaces; run again, spaces there are reshaped to the walls. */
export async function createSpacesFromWallsDialog(): Promise<void> {
  const session = store.session;
  const active = store.activeLayerId;
  const options = layerOptions();
  if (!session || !options.length) return;
  const start = options.find((l) => l.value === active)?.value ?? options[0].value;
  const unit = areaUnit();
  const v = await toolPrefs(
    "Create Spaces from Walls",
    [
      { kind: "choice", key: "kind", label: "Create", value: "rooms", options: [{ value: "rooms", label: "Create Room Spaces" }, { value: "gross", label: "Create Gross Floor Space" }] },
      { kind: "choice", key: "source", label: "Source Layer", value: start, options },
      { kind: "choice", key: "dest", label: "Destination Layer", value: start, options },
      { kind: "number", key: "min", label: `Minimum area (${unit.name})`, value: 0, min: 0, max: 1e9 },
      { kind: "check", key: "selected", label: "Create Spaces from Selected Walls Only", value: false },
    ],
    "Rooms are what walls joined at their corners close. Run it again after moving walls, and spaces already there are reshaped, keeping their data.",
  );
  if (!v) return;
  const source = v.choice("source");
  const dest = v.choice("dest");
  const minimum = v.num("min") * unit.mm2;
  const walls = wallsOn(source).filter((id) => !v.flag("selected") || store.selection.has(id));
  if (!walls.length) {
    toast(v.flag("selected") ? "No walls selected on that layer." : "That layer has no walls.", "info");
    return;
  }
  let rings: Pt[][];
  try {
    rings = wallPolys(session.wallFootprints(walls), v.choice("kind") === "rooms").filter((ring) => ringArea(ring) > minimum);
  } catch (e) {
    toast(`Create Spaces from Walls: ${(e as Error).message}`, "error");
    return;
  }
  if (!rings.length) {
    toast(v.choice("kind") === "rooms" ? "Those walls close no room big enough. Make sure they're joined." : "Those walls have no area to go round.", "info");
    return;
  }
  const have = spacesOn(dest);
  const reshaped = new Set<SpaceGroup>();
  const pairs = rings.map((ring) => {
    const sp = have.find((h) => {
      if (reshaped.has(h)) return false;
      const at = spaceOf(h.ring)?.labelAt;
      return at ? pointInPolygon(at, ring) : false;
    });
    if (sp) reshaped.add(sp);
    return { ring, sp };
  });
  const r = attempt("Create Spaces from Walls", (s) =>
    s.batch(() => {
      for (const { ring, sp } of pairs) {
        if (!sp) continue;
        s.replaceObjects([sp.boundary.id], [{ kind: "polygon", points: ring, closed: true }]);
        remeasure(s, sp, ring);
      }
      const fresh = pairs.filter((p) => !p.sp).map((p): SpacePath => ({ ring: p.ring, layerId: dest, classIndex: store.activeClassIndex, scale: layerScaleOf(dest) }));
      return addSpaces(s, fresh);
    }),
  );
  if (!r) return;
  setSelection(r.value);
  const total = rings.reduce((a, ring) => a + ringArea(ring), 0);
  toast(`${r.value.length} new ${r.value.length === 1 ? "space" : "spaces"}${reshaped.size ? `, ${reshaped.size} reshaped` : ""}: ${formatArea(total, units())} in all.`, "info");
}

const selectedClosed = (): { id: string; ring: Pt[]; obj: ObjectInfo }[] => {
  const doc = store.session?.doc;
  if (!doc) return [];
  const out: { id: string; ring: Pt[]; obj: ObjectInfo }[] = [];
  for (const id of store.selection) {
    const obj = doc.object(id);
    const ring = obj?.shape ? closedOutline(obj.shape) : null;
    if (obj && ring) out.push({ id, ring, obj });
  }
  return out;
};

export const canCreateSpacesFromPolys = (): boolean => selectedClosed().length > 0;

/** AEC > Space Planning > Create Spaces from Polys: each selected closed shape becomes a space in its place. */
export function createSpacesFromPolys(): void {
  const chosen = selectedClosed();
  if (!chosen.length) return;
  const r = attempt("Create Spaces from Polys", (s) =>
    s.batch(() => {
      const made = addSpaces(s, chosen.map((c): SpacePath => ({ ring: c.ring, layerId: c.obj.layerId, classIndex: c.obj.classIndex, scale: layerScaleOf(c.obj.layerId) })));
      s.deleteObjects(chosen.map((c) => c.id));
      return made;
    }),
  );
  if (r) setSelection(r.value);
}

// ---- walls from spaces ----------------------------------------------------------------

const ALIGNS: readonly { readonly value: ExteriorAlign; readonly label: string }[] = [
  { value: "outer", label: "Align Outer Side to Space Edge" },
  { value: "inner", label: "Align Inner Side to Space Edge" },
  { value: "centre", label: "Align Centerline to Space Edge" },
  { value: "control", label: "Align Wall Control Offset to Space Edge" },
];

/** AEC > Space Planning > Create Walls from Spaces…: exterior walls round the spaces, interior ones where two meet. */
export async function createWallsFromSpacesDialog(): Promise<void> {
  const session = store.session;
  const options = layerOptions();
  const kinds = session?.wallTemplates() ?? [];
  if (!session || !options.length) return;
  if (!kinds.length) {
    toast("This drawing has no straight, square-ended wall to copy.", "info");
    return;
  }
  const start = options.find((l) => l.value === store.activeLayerId)?.value ?? options[0].value;
  const styles = kinds.map((k) => ({ value: k.id, label: wallLabel(k, units()) }));
  const v = await toolPrefs(
    "Create Walls from Spaces",
    [
      { kind: "check", key: "selected", label: "Create Walls from Selected Spaces Only", value: false },
      { kind: "choice", key: "source", label: "Source Layer", value: start, options },
      { kind: "choice", key: "dest", label: "Destination Layer", value: start, options },
      { kind: "choice", key: "align", label: "Place Exterior Walls", value: "inner", options: ALIGNS },
      { kind: "choice", key: "exterior", label: "Exterior Wall Style", value: kinds[0].id, options: styles },
      { kind: "choice", key: "interior", label: "Interior Wall Style", value: kinds[0].id, options: styles },
      { kind: "check", key: "combine", label: "Combine collinear interior walls", value: true },
    ],
    "A wall is a copy of one the drawing has in that style. Curved edges come out as straight runs; alignment goes by the whole wall, not its core.",
  );
  if (!v) return;
  const spaces = spacesOn(v.choice("source")).filter((sp) => !v.flag("selected") || store.selection.has(sp.obj.id));
  if (!spaces.length) {
    toast("No spaces there to make walls from.", "info");
    return;
  }
  const exterior = kinds.find((k) => k.id === v.choice("exterior")) ?? kinds[0];
  const interior = kinds.find((k) => k.id === v.choice("interior")) ?? kinds[0];
  const align = ALIGNS.find((a) => a.value === v.choice("align"))?.value ?? "inner";
  const plan = spaceWalls(spaces.map((sp) => sp.ring), exterior.faces, interior.faces, align, v.flag("combine"));
  const dest = v.choice("dest");
  const reach = exterior.thickness + TEE_MARGIN;
  const r = attempt("Create Walls from Spaces", (s) =>
    s.batch(() => {
      const placed: { line: WallLine; id: string }[] = [];
      for (const loop of plan.exterior) {
        const ids: string[] = [];
        loop.walls.forEach((line, i) => {
          const last = i === loop.walls.length - 1;
          const id = s.addWall(dest, line.a, line.b, exterior.id, store.activeClassIndex, { before: ids.at(-1), after: last && loop.closed && ids.length > 1 ? ids[0] : undefined });
          ids.push(id);
          placed.push({ line, id });
        });
      }
      for (const wall of plan.interior) {
        const meet = (end: "a" | "b"): { at: Pt; id: string } | null => {
          for (const other of placed) {
            const at = meetLine(wall, end, other.line, reach);
            if (at) return { at, id: other.id };
          }
          return null;
        };
        const a = meet("a");
        const b = meet("b");
        const line = { a: a?.at ?? wall.a, b: b?.at ?? wall.b };
        placed.push({ line, id: s.addWall(dest, line.a, line.b, interior.id, store.activeClassIndex, { before: a?.id, after: b?.id }) });
      }
      return placed.map((p) => p.id);
    }),
  );
  if (!r) return;
  setSelection(r.value);
  toast(`Made ${r.value.length} ${r.value.length === 1 ? "wall" : "walls"}.`, "info");
}
