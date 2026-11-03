// File > Import > Import Shapefile…, as Vectorworks' command does: the shapefiles picked (each .shp
// with its .dbf, .shx, .prj and .cpg, or a zip of them) come in on a new design layer named after
// each, in a class of their own, each feature an object (a group where it has several parts) with
// the file's attributes attached as a record format named after it. Points become 2D loci, lines
// open polygons and polygons closed ones, a polygon with holes a group of its fill (the holes
// joined in, without a pen) and its rings' outlines. Coordinates come in at the units the .prj
// names (or those asked for), centred on the internal origin when far from it; longitude and
// latitude are projected onto a plane about the data's centre (equirectangular, good for a few
// kilometres across), as Rodeo doesn't keep a georeferenced coordinate system. Records need a
// record format in the drawing to copy settings from, as New Record Format does. One undo step.

import type { Attributes, NewShape, Pt, RecordFieldSpec, RecordValue } from "../core/index.ts";
import { readShapefiles, type DbfField, type DbfValue, type ShapeGeometry, type Shapefile } from "../import/shapefile.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { joinHoles } from "./surfaces.ts";
import { errorMessage, toast } from "./toast.ts";
import type { View } from "./view.ts";

const ACCEPT = ".shp,.shx,.dbf,.prj,.cpg,.zip";
/** metres a degree of latitude spans (the mean Earth radius's) */
const METRES_PER_DEGREE = (6371008.8 * Math.PI) / 180;
/** data whose centre lies farther than this from the internal origin comes in centred on it at first */
const FAR_MM = 10_000_000;

const UNITS: readonly { readonly label: string; readonly metres: number }[] = [
  { label: "Metres", metres: 1 },
  { label: "Feet", metres: 0.3048 },
  { label: "US survey feet", metres: 1200 / 3937 },
  { label: "Millimetres", metres: 0.001 },
  { label: "Centimetres", metres: 0.01 },
  { label: "Inches", metres: 0.0254 },
  { label: "Kilometres", metres: 1000 },
  { label: "Degrees (longitude, latitude)", metres: 0 },
];

/** File > Import > Import Shapefile…: asks for the files, then imports them. */
export function importShapefileFiles(scene: Scene, view: View): void {
  if (!store.session) return;
  const input = h("input", { attrs: { type: "file", accept: ACCEPT, multiple: "" }, hidden: true });
  document.body.append(input);
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    input.remove();
    if (files.length) void importShapefiles(files, scene, view);
  });
  input.addEventListener("cancel", () => input.remove());
  input.click();
}

/** A line about a shapefile: its features by kind, fields and coordinate system. */
function summary(f: Shapefile): string {
  const counts = new Map<string, number>();
  const word = (g: ShapeGeometry | null): string => (!g ? "empty" : g.kind === "point" ? "point" : g.kind === "line" ? "line" : "polygon");
  for (const g of f.features) counts.set(word(g), (counts.get(word(g)) ?? 0) + 1);
  const kinds = [...counts].map(([k, n]) => `${n.toLocaleString()} ${k === "empty" ? "empty" : n === 1 ? k : `${k}s`}`).join(", ");
  const fields = f.fields.length ? `, ${f.fields.length} ${f.fields.length === 1 ? "field" : "fields"}` : ", no attributes";
  const crs = f.crs ? `; ${f.crs.name || "unnamed system"} (${f.crs.geographic ? "longitude and latitude" : f.crs.unitName.toLowerCase()})` : "; no .prj";
  return `${f.name}: ${kinds || "no features"}${fields}${crs}`;
}

/** The record field kind a DBF field becomes. */
function fieldKind(f: DbfField): RecordFieldSpec["kind"] {
  if (f.type === "L") return "boolean";
  if (f.type === "N" || f.type === "F") return f.decimals === 0 && f.length <= 9 ? "integer" : "number";
  return "text";
}

function fieldValue(kind: RecordFieldSpec["kind"], v: DbfValue): RecordValue | null {
  if (v === null) return null;
  if (kind === "boolean") return typeof v === "boolean" ? v : null;
  if (kind === "integer") return typeof v === "number" ? Math.round(v) : null;
  if (kind === "number") return typeof v === "number" ? v : null;
  return String(v);
}

/** Imports the shapefiles among `files`. */
export async function importShapefiles(files: readonly File[], scene: Scene, view: View): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  let sets: Shapefile[];
  try {
    const bytes = new Map<string, Uint8Array>();
    for (const f of files) bytes.set(f.name, new Uint8Array(await f.arrayBuffer()));
    sets = readShapefiles(bytes);
  } catch (err) {
    toast(`Could not read the shapefile: ${errorMessage(err)}`);
    return;
  }
  if (sets.length === 0) {
    toast("Pick a shapefile's .shp with its .dbf, .shx and .prj (or a zip of them).", "info");
    return;
  }
  const noDbf = sets.filter((s) => s.fields.length === 0 && s.rows.length === 0).length;

  const select = (label: string, options: readonly [string, string][]): HTMLSelectElement =>
    h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...options.map(([value, text]) => h("option", { value, text })));
  const field = (label: string, input: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);
  const activeLayer = doc.layers().find((l) => l.id === store.activeLayerId);
  const layer = select("Layer", [
    ["new", sets.length > 1 ? "A new layer for each file" : `A new layer, "${sets[0].name}"`],
    ...(activeLayer?.kind === "design" ? ([["active", `The active layer, ${activeLayer.name}`]] as [string, string][]) : []),
  ]);
  const activeClass = doc.classes().find((c) => c.index === store.activeClassIndex)?.name ?? "None";
  const cls = select("Class", [
    ["new", sets.length > 1 ? "A new class for each file" : `A new class, "GIS-${sets[0].name}"`],
    ["active", `The active class, ${activeClass}`],
  ]);
  const withFields = sets.some((s) => s.fields.length > 0);
  const records = h("input", { attrs: { type: "checkbox" }, checked: withFields, disabled: !withFields });
  const unprojected = sets.filter((s) => !s.crs);
  const units = select(
    "Coordinates in",
    UNITS.map((u, i) => [String(i), u.label]),
  );
  // degrees when the numbers look like longitudes and latitudes
  const lonLat = unprojected.every((s) => !s.bbox || (Math.abs(s.bbox.x0) <= 180 && Math.abs(s.bbox.x1) <= 180 && Math.abs(s.bbox.y0) <= 90 && Math.abs(s.bbox.y1) <= 90));
  units.value = String(lonLat && unprojected.some((s) => s.bbox && s.bbox.x1 - s.bbox.x0 < 5) ? UNITS.length - 1 : 0);
  const position = select("Position", [
    ["centre", "Centred on the internal origin"],
    ["file", "At the file's coordinates"],
  ]);
  const geographic = sets.some((s) => s.crs?.geographic);
  const body: HTMLElement[] = [
    h("div", { cls: "muted" }, ...sets.map((s) => h("p", { text: summary(s) }))),
    field("Layer", layer),
    field("Class", cls),
    h("label", { cls: "menu-dialog-check" }, records, h("span", { text: sets.length > 1 ? "Attach each file's attributes as a record" : `Attach the attributes as the record "${sets[0].name} Data"` })),
  ];
  if (unprojected.length) body.push(field(unprojected.length < sets.length ? "Units (no .prj)" : "Coordinates in", units));
  body.push(field("Position", position));
  if (geographic) {
    body.push(h("p", { cls: "muted", text: "Longitude and latitude are projected onto a flat plane about the data's centre, true to a few metres across a few kilometres." }));
  }
  if (noDbf) body.push(h("p", { cls: "muted", text: `${noDbf === 1 ? "A file has" : `${noDbf} files have`} no .dbf beside it, so no attributes.` }));

  // where the numbers are once in metres (geographic ones about their centre), before any centring
  const metresOf = (s: Shapefile, unit: number): ((p: Pt) => Pt) => {
    const deg = s.crs ? s.crs.geographic : UNITS[unit].metres === 0;
    if (deg) {
      const b = s.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
      const lon0 = (b.x0 + b.x1) / 2;
      const lat0 = (b.y0 + b.y1) / 2;
      const k = Math.cos((lat0 * Math.PI) / 180);
      return (p) => ({ x: (p.x - lon0) * METRES_PER_DEGREE * k, y: (p.y - lat0) * METRES_PER_DEGREE });
    }
    const m = s.crs ? s.crs.metresPerUnit : UNITS[unit].metres;
    return (p) => ({ x: p.x * m, y: p.y * m });
  };
  const centreOf = (unit: number): Pt | null => {
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    for (const s of sets) {
      if (!s.bbox) continue;
      const to = metresOf(s, unit);
      const a = to({ x: s.bbox.x0, y: s.bbox.y0 });
      const b = to({ x: s.bbox.x1, y: s.bbox.y1 });
      box = box ? { x0: Math.min(box.x0, a.x), y0: Math.min(box.y0, a.y), x1: Math.max(box.x1, b.x), y1: Math.max(box.y1, b.y) } : { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    }
    return box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : null;
  };
  const far = (c: Pt | null): boolean => !!c && Math.hypot(c.x, c.y) * 1000 > FAR_MM;
  position.value = far(centreOf(Number(units.value))) ? "centre" : "file";
  units.addEventListener("change", () => (position.value = far(centreOf(Number(units.value))) ? "centre" : "file"));

  const choice = await showDialog<{ newLayer: boolean; newClass: boolean; records: boolean; unit: number; centre: boolean }>({
    title: "Import Shapefile",
    okLabel: "Import",
    cls: "shp-dialog",
    body,
    check: () => ({
      value: { newLayer: layer.value === "new", newClass: cls.value === "new", records: records.checked && !records.disabled, unit: Number(units.value), centre: position.value === "centre" },
    }),
  });
  if (!choice) return;
  const centre = choice.centre ? (centreOf(choice.unit) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
  const drawAttrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
  const noPen: Partial<Attributes> = { ...drawAttrs, lineStyle: 0 };
  const noFill: Partial<Attributes> = { ...drawAttrs, fillPattern: 0 };

  const r = attempt("Import Shapefile", (s) =>
    s.batch(() => {
      const taken = new Set([...s.doc.layers().map((l) => l.name), ...s.doc.classes().map((c) => c.name), ...s.doc.resources().map((x) => x.name)].map((n) => n.toLowerCase()));
      const free = (base: string): string => {
        let name = base;
        for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
        taken.add(name.toLowerCase());
        return name;
      };
      const made: { file: string; ids: string[]; layer: string | null; fields: number; empty: number }[] = [];
      for (const set of sets) {
        const layerId = choice.newLayer ? s.createLayer(free(set.name)) : store.activeLayerId;
        if (!layerId) throw new Error("there is no active layer to import into");
        let classIndex = store.activeClassIndex;
        if (choice.newClass) {
          const want = `GIS-${set.name}`;
          classIndex = s.doc.classes().find((c) => c.name.toLowerCase() === want.toLowerCase())?.index ?? s.createClass(free(want));
        }
        const kinds = set.fields.map(fieldKind);
        const format =
          choice.records && set.fields.length
            ? s.createRecordFormat(
                free(`${set.name} Data`),
                set.fields.map((f, i) => ({ name: f.name, kind: kinds[i], value: kinds[i] === "boolean" ? false : kinds[i] === "text" ? "" : 0 })),
              )
            : null;
        const to = metresOf(set, choice.unit);
        const world = (p: Pt): Pt => {
          const m = to(p);
          return { x: (m.x - centre.x) * 1000, y: (m.y - centre.y) * 1000 };
        };
        // every shape at once, then each feature of several shapes grouped, then the records: a change each
        const shapes: NewShape[] = [];
        const attrs: (Partial<Attributes> | undefined)[] = [];
        const spans: { row: number; from: number; to: number }[] = [];
        let empty = 0;
        set.features.forEach((g, i) => {
          const from = shapes.length;
          const add = (shape: NewShape, a = drawAttrs): void => {
            shapes.push(shape);
            attrs.push(a);
          };
          if (g?.kind === "point") for (const p of g.points) add({ kind: "locus", at: world(p) });
          else if (g?.kind === "line") {
            for (const part of g.parts) {
              const pts = part.map(world);
              add(pts.length === 2 ? { kind: "line", a: pts[0], b: pts[1] } : { kind: "polygon", points: pts, closed: false });
            }
          } else if (g?.kind === "polygon") {
            for (const p of g.polygons) {
              const outer = p.outer.map(world);
              if (!p.holes.length) {
                add({ kind: "polygon", points: outer, closed: true });
                continue;
              }
              // the fill with its holes joined in, without the pen that would draw the joins, then the outlines
              const holes = p.holes.map((ring) => ring.map(world));
              add({ kind: "polygon", points: joinHoles(outer, holes), closed: true }, noPen);
              for (const ring of [outer, ...holes]) add({ kind: "polygon", points: ring, closed: true }, noFill);
            }
          }
          if (shapes.length === from) empty++;
          else spans.push({ row: i, from, to: shapes.length });
        });
        const added = shapes.length ? s.addObjects(layerId, shapes, classIndex, attrs) : [];
        const several = spans.filter((sp) => sp.to - sp.from > 1);
        const groups = s.groupEach(several.map((sp) => added.slice(sp.from, sp.to)));
        const grouped = new Map(several.map((sp, k) => [sp, groups[k]]));
        const ids = spans.map((sp) => grouped.get(sp) ?? added[sp.from]);
        if (format !== null && ids.length) {
          s.attachRecord(ids, format);
          const values = ids.map((id, k) => {
            const row = set.rows[spans[k].row] ?? [];
            const fields: Record<string, RecordValue> = {};
            set.fields.forEach((f, j) => {
              const value = fieldValue(kinds[j], row[j] ?? null);
              // the attached record holds the defaults already
              if (value !== null && value !== "" && value !== 0 && value !== false) fields[f.name] = value;
            });
            return { id, fields };
          });
          s.setRecordFields(format, values.filter((v) => Object.keys(v.fields).length));
        }
        made.push({ file: set.name, ids, layer: choice.newLayer ? layerId : null, fields: format !== null ? set.fields.length : 0, empty });
      }
      return made;
    }),
  );
  if (!r) return;
  const made = r.value;
  const ids = made.flatMap((m) => m.ids);
  const firstLayer = made.find((m) => m.layer)?.layer;
  if (firstLayer) setActiveLayer(firstLayer);
  setSelection(made.filter((m) => !m.layer || m.layer === firstLayer).flatMap((m) => m.ids));
  if (ids.length) zoomToSelection(scene, view);
  const n = ids.length;
  const recs = made.filter((m) => m.fields > 0).length;
  const empty = made.reduce((k, m) => k + m.empty, 0);
  const skipped = sets.reduce((k, x) => k + x.skipped, 0);
  const parts = [
    `Imported ${n.toLocaleString()} ${n === 1 ? "feature" : "features"} from ${made.length === 1 ? made[0].file : `${made.length} shapefiles`}`,
    recs ? `with ${recs === made.length ? "their" : `${recs} files'`} attributes as records` : "",
    empty ? `${empty} empty left out` : "",
    skipped ? `${skipped} MultiPatch ${skipped === 1 ? "feature" : "features"} not read` : "",
  ].filter(Boolean);
  toast(`${parts.join("; ")}.`, "info");
}
