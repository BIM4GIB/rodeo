// File > Export > Export Shapefile…, as Vectorworks' command does: the drawing's plain shapes as a
// shapefile set for each kind a shapefile holds — polygons (rectangles, closed polygons and
// polylines, circles and ellipses), lines (lines, open polygons and polylines, arcs) and points
// (2D loci) — zipped into one download, each feature's layer, class and the fields of a chosen
// record format (its own, or its group's) as attributes. Each object on a layer is a feature, a
// group of shapes of one kind one multipart feature (a polygon Import Shapefile brought in with
// holes goes back out as one). Coordinates are measured from the internal
// origin in the units chosen; no .prj is written, as Rodeo doesn't keep a georeferenced coordinate
// system. Text, images, symbols, plug-in objects, walls and 3D objects are left out, and counted.

import type { FieldKind, ObjectInfo, Pt, RecordValue, Shape } from "../core/index.ts";
import { shapefileSet, type DbfColumn } from "../export/shapefile.ts";
import { arcPoint } from "../export/svg.ts";
import { zipFiles } from "../export/zip.ts";
import type { DbfValue, ShapeGeometry } from "../import/shapefile.ts";
import { h } from "./dom.ts";
import { downloadBlob } from "./fileio.ts";
import { pointInPolygon } from "./geom.ts";
import { withoutHidden } from "./hiddenObjects.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

type Scope = "selected" | "layer" | "all";

const SCOPES: readonly { readonly value: Scope; readonly label: string }[] = [
  { value: "selected", label: "Selected objects" },
  { value: "layer", label: "The active layer" },
  { value: "all", label: "All visible design layers" },
];

const UNITS: readonly { readonly label: string; readonly mm: number }[] = [
  { label: "Metres", mm: 1000 },
  { label: "Feet", mm: 304.8 },
  { label: "Millimetres", mm: 1 },
];

/** points per full turn of a circle or ellipse */
const TURN_STEPS = 72;

let lastUnit = 0;

/** A shape as a shapefile feature, in millimetres; null for one a shapefile can't hold. */
export function featureOf(s: Shape): ShapeGeometry | null {
  switch (s.kind) {
    case "locus":
      return s.points[0] ? { kind: "point", points: [s.points[0]] } : null;
    case "line":
      return s.points.length >= 2 ? { kind: "line", parts: [s.points.slice(0, 2)] } : null;
    case "rect":
    case "polygon":
    case "polyline": {
      const pts = s.points.filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
      if (s.closed && pts.length >= 3) return { kind: "polygon", polygons: [{ outer: pts, holes: [] }] };
      return pts.length >= 2 ? { kind: "line", parts: [pts] } : null;
    }
    case "arc": {
      if (!s.center || s.rx === undefined || s.ry === undefined || !s.sweepAngle) return null;
      const sweep = s.sweepAngle;
      const full = Math.abs(sweep) >= 360;
      const n = Math.max(8, Math.ceil((Math.abs(sweep) / 360) * TURN_STEPS));
      const pts: Pt[] = [];
      for (let i = 0; i <= (full ? n - 1 : n); i++) pts.push(arcPoint(s.center, Math.abs(s.rx), Math.abs(s.ry), (s.startAngle ?? 0) + (sweep * i) / n));
      return full ? { kind: "polygon", polygons: [{ outer: pts, holes: [] }] } : { kind: "line", parts: [pts] };
    }
    default:
      return null;
  }
}

/** The geometry scaled from millimetres to the unit. */
function scaled(g: ShapeGeometry, mm: number): ShapeGeometry {
  const f = (p: Pt): Pt => ({ x: p.x / mm, y: p.y / mm });
  if (g.kind === "point") return { kind: "point", points: g.points.map(f) };
  if (g.kind === "line") return { kind: "line", parts: g.parts.map((p) => p.map(f)) };
  return { kind: "polygon", polygons: g.polygons.map((p) => ({ outer: p.outer.map(f), holes: p.holes.map((r) => r.map(f)) })) };
}

/** The DBF column a record field becomes. */
function columnKind(kind: FieldKind): DbfColumn["kind"] {
  if (kind === "integer") return "integer";
  if (kind === "boolean") return "boolean";
  if (kind === "number" || kind === "dimension") return "number";
  return "text";
}

interface Feature {
  /** millimetres */
  geometry: ShapeGeometry;
  /** the object it stands for: a shape, or a group of shapes of one kind */
  o: ObjectInfo;
  /** the objects whose records it takes, in turn: its own, then its groups' */
  chain: string[];
}

interface Picked {
  features: Feature[];
  /** objects left out: text, images, lights, symbols, plug-ins, walls and 3D objects */
  left: number;
}

/**
 * A group's polygons as one feature's: its outlines alone when it also holds polygons drawn
 * without a pen (as Import Shapefile draws a polygon with holes: the fill, holes joined in, without
 * a pen, and each ring's outline), each ring a hole of the smallest larger ring holding it when an
 * odd number of rings hold it.
 */
function mergedPolygons(leaves: readonly ObjectInfo[]): ShapeGeometry {
  const penned = leaves.filter((l) => l.attrs?.lineStyle !== 0);
  const kept = penned.length && penned.length < leaves.length ? penned : leaves;
  const rings = kept.flatMap((l) => {
    const g = featureOf(l.shape!);
    return g?.kind === "polygon" ? g.polygons.map((p) => p.outer) : [];
  });
  const area = (r: readonly Pt[]): number => Math.abs(r.reduce((a, p, i) => a + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0)) / 2;
  const areas = rings.map(area);
  // a larger ring holds a smaller one when most of the smaller one's corners lie inside it
  const holds = (a: number, b: number): boolean => areas[a] > areas[b] && rings[b].filter((p) => pointInPolygon(p, rings[a])).length * 2 > rings[b].length;
  const holders = rings.map((_, i) => rings.map((_, j) => j).filter((j) => j !== i && holds(j, i)));
  const polygons = rings.map((outer, i) => ({ i, outer, holes: [] as Pt[][] })).filter((p) => holders[p.i].length % 2 === 0);
  rings.forEach((ring, i) => {
    if (holders[i].length % 2 === 0) return;
    const owner = polygons.filter((p) => holders[i].includes(p.i)).sort((a, b) => areas[a.i] - areas[b.i])[0];
    if (owner) owner.holes.push(ring);
  });
  return { kind: "polygon", polygons: polygons.map(({ outer, holes }) => ({ outer, holes })) };
}

/**
 * The features in scope: each object on the layer a feature, a group one feature when its shapes
 * are all of one kind (a multipart line, multipoint or polygon with holes), else one a shape;
 * objects inside symbols and plug-in objects aside.
 */
function pick(scope: Scope): Picked {
  const doc = withoutHidden(store.session!.doc);
  const layers = doc
    .layers()
    .filter((l) => l.kind === "design" && (scope === "all" ? l.visibility !== "hidden" : l.id === store.activeLayerId));
  const out: Picked = { features: [], left: 0 };
  for (const layer of layers) {
    const objects = doc.objects(layer.id);
    const byId = new Map(objects.map((o) => [o.id, o]));
    const kids = new Map<string, ObjectInfo[]>();
    for (const o of objects) if (o.parentId) kids.set(o.parentId, [...(kids.get(o.parentId) ?? []), o]);
    const top = (o: ObjectInfo): ObjectInfo => {
      let t = o;
      while (t.parentId && byId.get(t.parentId)) t = byId.get(t.parentId)!;
      return t;
    };
    const chosen = scope === "selected" ? new Set([...store.selection].map((id) => byId.get(id)).filter((o): o is ObjectInfo => !!o).map((o) => top(o).id)) : null;
    for (const o of objects) {
      if (o.parentId || (chosen && !chosen.has(o.id))) continue;
      if (o.kind !== "group") {
        const g = o.shape && !o.wireframe ? featureOf(o.shape) : null;
        if (g) out.features.push({ geometry: g, o, chain: [o.id] });
        else out.left++;
        continue;
      }
      // the group's shapes, through the groups in it
      const leaves: { o: ObjectInfo; chain: string[] }[] = [];
      const walk = (g: ObjectInfo, chain: string[]): void => {
        for (const k of kids.get(g.id) ?? []) {
          if (k.kind === "group") walk(k, [k.id, ...chain]);
          else if (k.shape && !k.wireframe && featureOf(k.shape)) leaves.push({ o: k, chain: [k.id, ...chain] });
          else out.left++;
        }
      };
      walk(o, [o.id]);
      if (!leaves.length) continue;
      const kinds = new Set(leaves.map((l) => featureOf(l.o.shape!)!.kind));
      if (kinds.size > 1) {
        for (const l of leaves) out.features.push({ geometry: featureOf(l.o.shape!)!, o: l.o, chain: l.chain });
        continue;
      }
      const geoms = leaves.map((l) => featureOf(l.o.shape!)!);
      const [kind] = kinds;
      const geometry: ShapeGeometry =
        kind === "point"
          ? { kind: "point", points: geoms.flatMap((g) => (g.kind === "point" ? g.points : [])) }
          : kind === "line"
            ? { kind: "line", parts: geoms.flatMap((g) => (g.kind === "line" ? g.parts : [])) }
            : mergedPolygons(leaves.map((l) => l.o));
      out.features.push({ geometry, o, chain: [o.id] });
    }
  }
  return out;
}

/** File > Export > Export Shapefile…: asks what and how, then downloads the zipped shapefiles. */
export async function exportShapefileDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const select = (label: string): HTMLSelectElement => h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } });
  const scope = select("Export");
  for (const s of SCOPES) scope.append(h("option", { value: s.value, text: s.label }));
  scope.value = store.selection.size ? "selected" : "all";
  const record = select("Attributes");
  const unit = select("Units");
  UNITS.forEach((u, i) => unit.append(h("option", { value: String(i), text: u.label })));
  unit.value = String(lastUnit);
  const counts = h("p", { cls: "muted" });
  const layerName = new Map(doc.layers().map((l) => [l.id, l.name]));
  let first = true;
  /** the record formats the scope's features (or their groups) hold, by name index */
  const refresh = (): void => {
    const picked = pick(scope.value as Scope);
    const formats = new Map<number, string>();
    const seen = new Set<string>();
    for (const { chain } of picked.features) {
      for (const id of chain) {
        if (seen.has(id)) continue;
        seen.add(id);
        for (const r of doc.records(id)) if (!r.parametric) formats.set(r.format, r.name);
      }
    }
    const was = record.value;
    record.replaceChildren(h("option", { value: "", text: "Layer and class only" }), ...[...formats].sort((a, b) => a[1].localeCompare(b[1])).map(([f, name]) => h("option", { value: String(f), text: `Layer, class and ${name}` })));
    // a record format the objects hold, at first
    record.value = !first && [...record.options].some((o) => o.value === was) ? was : (record.options[1]?.value ?? "");
    first = false;
    const kinds = { polygon: 0, line: 0, point: 0 };
    for (const f of picked.features) kinds[f.geometry.kind]++;
    const parts = [kinds.polygon && `${kinds.polygon} polygons`, kinds.line && `${kinds.line} lines`, kinds.point && `${kinds.point} points`].filter(Boolean);
    counts.textContent = parts.length
      ? `${parts.join(", ")}${picked.left ? `; ${picked.left} other ${picked.left === 1 ? "object" : "objects"} (text, images, symbols, plug-ins, walls, 3D) left out` : ""}.`
      : "Nothing here can go into a shapefile.";
  };
  scope.addEventListener("change", refresh);
  refresh();
  const field = (label: string, input: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);
  const v = await showDialog<{ picked: Picked; format: number | null; unit: number }>({
    title: "Export Shapefile",
    okLabel: "Export",
    body: [
      field("Export", scope),
      field("Attributes", record),
      field("Units", unit),
      counts,
      h("p", { cls: "muted", text: "Coordinates are measured from the internal origin. No .prj is written: Rodeo doesn't keep the drawing's coordinate system." }),
    ],
    check: () => {
      const picked = pick(scope.value as Scope);
      if (!picked.features.length) return { error: "Nothing here can go into a shapefile: choose objects with lines, polygons, circles or loci.", focus: scope };
      return { value: { picked, format: record.value === "" ? null : Number(record.value), unit: Number(unit.value) } };
    },
  });
  if (!v) return;
  lastUnit = v.unit;
  const fields = v.format === null ? [] : recordFields(v.picked, v.format);
  const columns: DbfColumn[] = [
    { name: "Layer", kind: "text" },
    { name: "Class", kind: "text" },
    ...fields.map((f) => ({ name: f.name, kind: columnKind(f.kind) })),
  ];
  const groups = new Map<ShapeGeometry["kind"], { geometry: ShapeGeometry[]; rows: DbfValue[][] }>();
  for (const { geometry, o, chain } of v.picked.features) {
    const g = scaled(geometry, UNITS[v.unit].mm);
    const set = groups.get(g.kind) ?? { geometry: [], rows: [] };
    let values: Map<string, RecordValue> | null = null;
    if (v.format !== null) {
      for (const id of chain) {
        const r = doc.records(id).find((x) => x.format === v.format);
        if (r) {
          values = new Map(r.fields.map((f) => [f.name, f.value]));
          break;
        }
      }
    }
    set.geometry.push(g);
    set.rows.push([layerName.get(o.layerId) ?? "", o.className, ...fields.map((f) => values?.get(f.name) ?? null)]);
    groups.set(g.kind, set);
  }
  const base = (store.fileName || "Drawing").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-") || "Drawing";
  const files: [string, Uint8Array][] = [];
  const plural = { polygon: "polygons", line: "lines", point: "points" };
  for (const [kind, set] of groups) {
    const stem = groups.size > 1 ? `${base}_${plural[kind]}` : base;
    const out = shapefileSet(kind, set.geometry, columns, set.rows);
    files.push([`${stem}.shp`, out.shp], [`${stem}.shx`, out.shx], [`${stem}.dbf`, out.dbf], [`${stem}.cpg`, out.cpg]);
  }
  downloadBlob(`${base}.zip`, new Blob([zipFiles(files) as BlobPart], { type: "application/zip" }));
  const n = v.picked.features.length;
  toast(`Exported ${n.toLocaleString()} ${n === 1 ? "feature" : "features"} as ${groups.size} ${groups.size === 1 ? "shapefile" : "shapefiles"}${v.picked.left ? `; ${v.picked.left} other ${v.picked.left === 1 ? "object" : "objects"} left out` : ""}.`, "info");
}

/** The fields of record format `format`, as the first shape (or group) holding it has them. */
function recordFields(picked: Picked, format: number): { name: string; kind: FieldKind }[] {
  const doc = store.session!.doc;
  for (const { chain } of picked.features) {
    for (const id of chain) {
      const r = doc.records(id).find((x) => x.format === format);
      if (r) return r.fields.map((f) => ({ name: f.name, kind: f.kind }));
    }
  }
  return [];
}
