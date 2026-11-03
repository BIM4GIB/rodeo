// Checks the IFC export under Node. Run from web/:
//   npx tsx src/export/ifc.check.ts
// A drawing with a design layer at 0 and a second at 3 m, with three objects (a door with a
// plug-in's parameters, a panel with a data record, and a slab with none) is exported, then read
// back with web-ifc: the storeys' elevations, each property set's name, values and IFC types, the
// link from each set to its element, the storey each element sits in, each entity's attribute
// count, and the height of each element's geometry.
// The session builds the layers, their elevations and the objects. A blank drawing has no mesh or
// record format to copy settings from, so the 3D faces and the records are supplied to exportIfc
// by a document that delegates everything else to the session.

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IfcAPI } from "web-ifc";
import { blankDrawing } from "../core/blank.ts";
import { openVwx } from "../core/index.ts";
import type { Mesh3D, ObjectRecord, VwxDocument } from "../core/types.ts";
import { exportIfc, ifcGuid } from "./ifc.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// ---- the drawing ----------------------------------------------------------

const s = openVwx(blankDrawing("mm"), "ifc-check.vwx");
const ground = s.doc.layers()[0].id;
const upper = s.createLayer("Upper", "design", 50);
s.setLayerElevation(upper, 3000);
const [door, panel] = s.addObjects(upper, [
  { kind: "rect", x0: 0, y0: 0, x1: 900, y1: 100 },
  { kind: "rect", x0: 1000, y0: 0, x1: 2000, y1: 100 },
]);
const [slab] = s.addObjects(ground, [{ kind: "rect", x0: 0, y0: 0, x1: 4000, y1: 3000 }]);

/** A box's 12 triangles (9 floats each), from its min and max corners, mm. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Float32Array {
  const c = (i: number, j: number, k: number) => [i ? x1 : x0, j ? y1 : y0, k ? z1 : z0];
  const quads: [number, number, number][][] = [
    [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]],
    [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]],
    [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]],
  ];
  const out: number[] = [];
  for (const [a, b, d, e] of quads) {
    for (const t of [[a, b, d], [a, d, e]]) for (const p of t) out.push(...c(...p));
  }
  return Float32Array.from(out);
}

/** A design layer's mesh of one object, z in mm above the drawing's origin (its layer's elevation included). */
const mesh = (layerId: string, objectId: string, triangles: Float32Array): Mesh3D => ({
  objectId,
  layerId,
  classIndex: 0,
  triangles,
  edges: new Float32Array(0),
  color: "#8a6a4a",
  opacity: 1,
  texture: -1,
});
const meshes: Mesh3D[] = [
  mesh(upper, door, box(0, 0, 3000, 900, 100, 3300)),
  mesh(upper, panel, box(1000, 0, 3000, 2000, 100, 3050)),
  mesh(ground, slab, box(0, 0, 0, 4000, 3000, 200)),
];

const doorParameters: ObjectRecord = {
  format: 1,
  name: "Door",
  parametric: true,
  fields: [
    { name: "Width", kind: "dimension", value: 900 },
    { name: "Style", kind: "choice", value: "Hinged" },
    { name: "Fire rated", kind: "boolean", value: true },
    { name: "Hidden", kind: "other", value: "" },
    { name: "", kind: "text", value: "not named, so not carried" },
    { name: "Offset", kind: "number", value: -250.5 },
  ],
};
const finish: ObjectRecord = {
  format: 2,
  name: "Finish",
  parametric: false,
  fields: [
    { name: "Colour", kind: "text", value: "Oak's café" },
    { name: "Coats", kind: "number", value: 2.5 },
    { name: "Sealed", kind: "boolean", value: false },
    { name: "Capacity", kind: "number", value: 1.5e21 },
  ],
};
const recordsOf = new Map<string, ObjectRecord[]>([
  [door, [doorParameters]],
  [panel, [finish]],
]);

// the session's own answers, except for the meshes and records it can't make on a blank drawing
const doc = new Proxy(s.doc, {
  get(target, key) {
    if (key === "model3d") return () => meshes;
    if (key === "records") return (id: string) => recordsOf.get(id) ?? target.records(id);
    const v = Reflect.get(target, key, target);
    return typeof v === "function" ? v.bind(target) : v;
  },
}) as VwxDocument;

const text = exportIfc(doc, new Set([ground, upper]), "ifc-check.vwx", new Date(Date.UTC(2026, 10, 1, 9, 0, 0)));
const dir = join(tmpdir(), "rodeo-ifc-check");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "ifc-check.ifc"), text);

// ---- the file as text: each entity's attribute count -------------------------

/** The top-level attributes of one STEP entity line (strings and nested lists skipped). */
function attributeCount(line: string): number {
  const body = line.slice(line.indexOf("(") + 1, line.lastIndexOf(")"));
  let depth = 0;
  let n = 1;
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === "'") {
        if (body[i + 1] === "'") i++;
        else quoted = false;
      }
    } else if (ch === "'") quoted = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) n++;
  }
  return n;
}

const lines = text.split("\n");
const expected: Record<string, number> = { IFCBUILDINGSTOREY: 10, IFCPROPERTYSET: 5, IFCPROPERTYSINGLEVALUE: 4, IFCRELDEFINESBYPROPERTIES: 6 };
for (const [entity, count] of Object.entries(expected)) {
  const found = lines.filter((l) => new RegExp(`^#\\d+=${entity}\\(`).test(l));
  check(found.length > 0 && found.every((l) => attributeCount(l) === count), `${entity}: ${found.length} written, each with ${count} attributes`);
}

// ---- read back with web-ifc ----------------------------------------------

const lib = await import("web-ifc");
const api: IfcAPI = new lib.IfcAPI();
await api.Init();
const model = api.OpenModel(new TextEncoder().encode(text), { COORDINATE_TO_ORIGIN: false });
try {
  const idsOf = (type: number): number[] => {
    const v = api.GetLineIDsWithType(model, type);
    const out: number[] = [];
    for (let i = 0; i < v.size(); i++) out.push(v.get(i));
    return out;
  };
  // a STEP value's payload: a reference's id, a typed value's value (web-ifc keeps a real's number
  // apart from its text), or a plain value
  const val = (v: unknown): unknown => {
    if (!v || typeof v !== "object") return v;
    if ("_representationValue" in v) return (v as { _representationValue: unknown })._representationValue;
    return "value" in v ? (v as { value: unknown }).value : v;
  };
  // a typed value's STEP type, e.g. IFCREAL
  const typeName = (v: unknown): string | null => (v && typeof v === "object" && "name" in v ? String((v as { name: unknown }).name) : null);
  // an entity's STEP name, e.g. IFCDOOR (web-ifc names it IfcDoor)
  const entityOf = (id: number): string => api.GetNameFromTypeCode(api.GetLineType(model, id)).toUpperCase();

  check(api.GetModelSchema(model) === "IFC4", "web-ifc opens the file as IFC4, without a throw");
  check(idsOf(lib.IFCPROJECT).length === 1 && idsOf(lib.IFCBUILDING).length === 1, "one project and one building");

  // storeys: each design layer's name and elevation (mm)
  const storeys = new Map(idsOf(lib.IFCBUILDINGSTOREY).map((id) => {
    const l = api.GetLine(model, id);
    return [String(val(l.Name)), val(l.Elevation)] as const;
  }));
  check(storeys.size === 2 && storeys.get("Design Layer-1") === 0, "storey Design Layer-1 at elevation 0");
  check(storeys.get("Upper") === 3000, "storey Upper at elevation 3000 (mm)");

  // each element's storey, from the containment relations
  const storeyOf = new Map<number, string>();
  for (const id of idsOf(lib.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const rel = api.GetLine(model, id);
    const at = val(rel.RelatingStructure) as number;
    for (const e of rel.RelatedElements) storeyOf.set(val(e) as number, String(val(api.GetLine(model, at).Name)));
  }

  // property sets: each one's name and its single values
  const sets = new Map<number, { name: string; props: { name: string; ifc: string | null; value: unknown }[] }>();
  for (const id of idsOf(lib.IFCPROPERTYSET)) {
    const set = api.GetLine(model, id);
    const props = (set.HasProperties as unknown[]).map((p) => {
      const single = api.GetLine(model, val(p) as number);
      const nominal = single.NominalValue as unknown;
      return { name: String(val(single.Name)), ifc: nominal ? typeName(nominal) : null, value: nominal ? val(nominal) : null };
    });
    sets.set(id, { name: String(val(set.Name)), props });
  }
  check(sets.size === 2, `${sets.size} property sets (one per record with a named field)`);

  // links: each set to its element
  const rels = idsOf(lib.IFCRELDEFINESBYPROPERTIES);
  check(rels.length === sets.size, "one IFCRELDEFINESBYPROPERTIES per set");
  const linked = new Map<string, number>();
  for (const id of rels) {
    const rel = api.GetLine(model, id);
    const elements = (rel.RelatedObjects as unknown[]).map((e) => val(e) as number);
    const set = val(rel.RelatingPropertyDefinition) as number;
    check(elements.length === 1 && sets.has(set), `relation #${id} links one element to a property set`);
    linked.set(sets.get(set)?.name ?? "?", elements[0]);
  }

  const door9 = linked.get("Door")!;
  const finish9 = linked.get("Finish")!;
  check(door9 !== undefined && api.GetLine(model, door9).GlobalId.value === ifcGuid(door), "Door set links to the door element (GlobalId of the door object)");
  check(finish9 !== undefined && api.GetLine(model, finish9).GlobalId.value === ifcGuid(panel), "Finish set links to the panel element");
  check(entityOf(door9) === "IFCDOOR", "the door element is an IfcDoor (its plug-in's class)");
  check(entityOf(finish9) === "IFCBUILDINGELEMENTPROXY", "the panel element is a building element proxy");
  check(storeyOf.get(door9) === "Upper" && storeyOf.get(finish9) === "Upper", "the door and the panel sit in storey Upper");

  // values and types
  const expectDoor = [
    ["Width", "IFCREAL", 900],
    ["Style", "IFCLABEL", "Hinged"],
    ["Fire rated", "IFCBOOLEAN", true],
    ["Hidden", null, null],
    ["Offset", "IFCREAL", -250.5],
  ] as const;
  const expectFinish = [
    ["Colour", "IFCLABEL", "Oak's café"],
    ["Coats", "IFCREAL", 2.5],
    ["Sealed", "IFCBOOLEAN", false],
    ["Capacity", "IFCREAL", 1.5e21],
  ] as const;
  const door2 = [...sets.values()].find((x) => x.name === "Door");
  const finish2 = [...sets.values()].find((x) => x.name === "Finish");
  const same = (got: { name: string; ifc: string | null; value: unknown }[] | undefined, want: readonly (readonly [string, string | null, unknown])[]): boolean =>
    !!got && got.length === want.length && want.every(([n, t, v], i) => got[i].name === n && got[i].ifc === t && (typeof v === "number" ? Math.abs((got[i].value as number) - v) <= 1e-9 * Math.max(1, Math.abs(v)) : got[i].value === v));
  check(door2?.name === "Door" && same(door2.props, expectDoor), "Door: Width, Style, Fire rated, Hidden (no value) and Offset with their types and values; the unnamed field left out");
  check(finish2?.name === "Finish" && same(finish2.props, expectFinish), "Finish: text with an apostrophe and accent, number, boolean and a number of 1E21");

  // geometry: each element's height as web-ifc reads it (metres, y up), which must not move with the storey
  const heights = new Map<number, [number, number]>();
  api.StreamAllMeshes(model, (m) => {
    for (let i = 0; i < m.geometries.size(); i++) {
      const pg = m.geometries.get(i);
      const geo = api.GetGeometry(model, pg.geometryExpressID);
      const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
      const t = pg.flatTransformation;
      for (let k = 0; k < v.length; k += 6) {
        const y = t[1] * v[k] + t[5] * v[k + 1] + t[9] * v[k + 2] + t[13];
        const [lo, hi] = heights.get(m.expressID) ?? [Infinity, -Infinity];
        heights.set(m.expressID, [Math.min(lo, y), Math.max(hi, y)]);
      }
      geo.delete();
    }
  });
  const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) < 1e-3;
  const doorH = heights.get(door9);
  const finishH = heights.get(finish9);
  check(!!doorH && near(doorH[0], 3.0) && near(doorH[1], 3.3), `door's geometry from 3.0 m to 3.3 m (${doorH?.map((h) => h.toFixed(3)).join(" to ")})`);
  check(!!finishH && near(finishH[0], 3.0) && near(finishH[1], 3.05), `panel's geometry from 3.0 m to 3.05 m (${finishH?.map((h) => h.toFixed(3)).join(" to ")})`);
  const slabH = [...heights.entries()].find(([id]) => storeyOf.get(id) === "Design Layer-1");
  check(!!slabH && near(slabH[1][0], 0) && near(slabH[1][1], 0.2), `slab on the ground storey from 0 to 0.2 m (${slabH?.[1].map((h) => h.toFixed(3)).join(" to ")})`);
} finally {
  api.CloseModel(model);
}

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
