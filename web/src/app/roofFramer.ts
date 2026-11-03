// AEC > Framing > Roof Framer…, Vectorworks' command of that name: the selected roofs framed
// (roofFramerShapes.ts) with rafters, ridges, hips and valleys, purlins and plates, each kind in the
// class chosen for it, and a Roof Framing Take-Off worksheet. Vectorworks frames a roof object from
// its settings and makes framing member objects; here a roof is framed from its 3D faces, so roof
// objects and roof faces read from a file, Create Roof's roofs and meshes all frame alike, and each
// member is a group of its plan and its solid, as Create Joists draws them.

import type { Attributes, EditSession, NewSheetCell } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { colorMatcher } from "./pdfImport.ts";
import { frameRoof, roofTakeOff, type RidgeElevation, type RoofFramerSpec, type RoofMember, type RoofMemberKind, type Surface } from "./roofFramerShapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs, type PrefField } from "./toolPrefs.ts";
import { formatLength, millimetresPerUnit } from "./units.ts";

const TIMBER = { r: 0.82, g: 0.68, b: 0.47 };
const SHEET_NAME = "Roof Framing Take-Off";
const BY_CLASS = ["fill", "lineStyle", "penColor", "lineWeight", "opacity"] as const;
/** Vectorworks' class for framing when Standard Naming's auto-classing is on */
const FRAMING_CLASS = "Structural-Framing";

const SURFACES: readonly { readonly value: Surface; readonly label: string }[] = [
  { value: "top", label: "Top of Roof object/component" },
  { value: "bottom", label: "Bottom of Roof object/component" },
];
const PURLIN_SURFACES: readonly { readonly value: Surface; readonly label: string }[] = [
  { value: "top", label: "Top of Rafter" },
  { value: "bottom", label: "Bottom of Rafter" },
];
const RIDGE_ELEVATIONS: readonly { readonly value: RidgeElevation; readonly label: string }[] = [
  { value: "flushTop", label: "Flush to Top of Rafters" },
  { value: "notched", label: "Notched into rafters" },
  { value: "flushBottom", label: "Flush to Bottom of Rafters" },
  { value: "aff", label: "Specify AFF" },
  { value: "hipTop", label: "Flush to Top of Hips" },
];
const KIND_LABEL: Record<RoofMemberKind, string> = { rafter: "Rafter", ridge: "Ridge", hip: "Hip", valley: "Valley", purlin: "Purlin", plate: "Plate" };
const PLURAL: Record<RoofMemberKind, [string, string]> = {
  rafter: ["rafter", "rafters"],
  ridge: ["ridge", "ridges"],
  hip: ["hip", "hips"],
  valley: ["valley", "valleys"],
  purlin: ["purlin", "purlins"],
  plate: ["plate", "plates"],
};

interface Settings {
  readonly spec: RoofFramerSpec;
  /** what each kind is framed, when on, and its class */
  readonly on: Readonly<Record<"rafters" | "ridges" | "hips" | "purlins" | "plates", boolean>>;
  readonly classes: Readonly<Record<"rafters" | "ridges" | "hips" | "purlins" | "plates", number>>;
}

let last: Settings | null = null;

/** Sawn sizes in inches and feet (2x8 rafters 16" apart), else metric ones 600 apart. */
function firstSettings(): Settings {
  const perUnit = millimetresPerUnit(store.session?.doc.info.units);
  const imperial = perUnit === 25.4 || perUnit === 304.8;
  const inch = (n: number): number => n * 25.4;
  const framing = store.session?.doc.classes().find((c) => c.name === FRAMING_CLASS)?.index ?? store.activeClassIndex;
  return {
    spec: {
      rafters: imperial ? { width: inch(1.5), height: inch(7.25), minSpacing: inch(16), maxSpacing: inch(16), surface: "top", match: true } : { width: 50, height: 200, minSpacing: 600, maxSpacing: 600, surface: "top", match: true },
      ridges: { width: imperial ? inch(1.5) : 50, height: imperial ? inch(9.25) : 250, elevation: "flushTop", notch: imperial ? inch(1.5) : 38, aff: imperial ? inch(120) : 3000 },
      hips: { width: imperial ? inch(1.5) : 50, height: imperial ? inch(9.25) : 250, surface: "top" },
      purlins: {
        width: imperial ? inch(3.5) : 75,
        height: imperial ? inch(5.5) : 150,
        first: imperial ? inch(96) : 2400,
        last: imperial ? inch(12) : 300,
        by: "count",
        count: 3,
        distance: imperial ? inch(48) : 1200,
        position: "bottom",
        fromLowerEnd: false,
        rotate: false,
        inset: 0,
      },
      plates: { width: imperial ? inch(5.5) : 140, height: imperial ? inch(1.5) : 45, inset: imperial ? inch(18) : 450, notched: false, notch: imperial ? inch(1.5) : 38 },
    },
    on: { rafters: true, ridges: true, hips: true, purlins: false, plates: false },
    classes: { rafters: framing, ridges: framing, hips: framing, purlins: framing, plates: framing },
  };
}

export const canFrameRoof = (): boolean => !!store.session && store.selection.size > 0;

async function askSettings(start: Settings): Promise<Settings | null> {
  const classes = (store.session?.doc.classes() ?? []).map((c) => ({ value: String(c.index), label: c.name }));
  const s = start.spec;
  const r = s.rafters!;
  const g = s.ridges!;
  const hv = s.hips!;
  const pu = s.purlins!;
  const pl = s.plates!;
  const classField = (key: keyof Settings["classes"]): PrefField => ({ kind: "choice", key: `${key}Class`, label: "Class", value: String(start.classes[key]), options: classes, wide: true });
  const v = await toolPrefs(
    "Roof Framer",
    [
      { kind: "heading", key: "", label: "Rafters" },
      { kind: "check", key: "rafters", label: "Create Rafters", value: start.on.rafters },
      { kind: "length", key: "rWidth", label: "Rafter Width", value: r.width },
      { kind: "length", key: "rHeight", label: "Rafter Height", value: r.height },
      { kind: "length", key: "rMin", label: "Minimum Spacing", value: r.minSpacing },
      { kind: "length", key: "rMax", label: "Maximum Spacing", value: r.maxSpacing },
      { kind: "choice", key: "rSurface", label: "Set top of Rafters to", value: r.surface, options: SURFACES, wide: true },
      { kind: "check", key: "rMatch", label: "Match Rafters across Ridges/Hips/Valleys", value: r.match },
      classField("rafters"),
      { kind: "heading", key: "", label: "Ridges" },
      { kind: "check", key: "ridges", label: "Create Ridges", value: start.on.ridges },
      { kind: "length", key: "gWidth", label: "Ridge Width", value: g.width },
      { kind: "length", key: "gHeight", label: "Ridge Height", value: g.height },
      { kind: "choice", key: "gElevation", label: "Ridge Elevation", value: g.elevation, options: RIDGE_ELEVATIONS, wide: true },
      { kind: "length", key: "gNotch", label: "Notch Depth", value: g.notch, zero: true },
      { kind: "length", key: "gAff", label: "AFF", value: g.aff, signed: true },
      classField("ridges"),
      { kind: "heading", key: "", label: "Hips/Valleys" },
      { kind: "check", key: "hips", label: "Create Hips and Valleys", value: start.on.hips },
      { kind: "length", key: "hWidth", label: "Hip/Valley Width", value: hv.width },
      { kind: "length", key: "hHeight", label: "Hip/Valley Height", value: hv.height },
      { kind: "choice", key: "hSurface", label: "Set top of Hips and Valleys to", value: hv.surface, options: SURFACES, wide: true },
      classField("hips"),
      { kind: "heading", key: "", label: "Purlins" },
      { kind: "check", key: "purlins", label: "Create Purlins", value: start.on.purlins },
      { kind: "length", key: "pWidth", label: "Purlin Width", value: pu.width },
      { kind: "length", key: "pHeight", label: "Purlin Height", value: pu.height },
      { kind: "length", key: "pFirst", label: "Elevation of First Purlin", value: pu.first, signed: true },
      { kind: "length", key: "pLast", label: "Elevation of Last Purlin", value: pu.last, zero: true },
      {
        kind: "choice",
        key: "pBy",
        label: "Create Purlins by",
        value: pu.by,
        options: [
          { value: "count", label: "Number of Purlins" },
          { value: "distance", label: "Distance Between Purlins" },
        ],
        wide: true,
      },
      { kind: "number", key: "pCount", label: "Number of Purlins", value: pu.count, min: 1, max: 200, integer: true },
      { kind: "length", key: "pDistance", label: "Distance Between Purlins", value: pu.distance },
      { kind: "choice", key: "pPosition", label: "Purlin Position", value: pu.position, options: PURLIN_SURFACES },
      { kind: "check", key: "pLower", label: "Purlins Start at the Lower End of the Rafter", value: pu.fromLowerEnd },
      { kind: "check", key: "pRotate", label: "Rotate Purlins to Roof Slope", value: pu.rotate },
      { kind: "length", key: "pInset", label: "Bearing inset", value: pu.inset, zero: true },
      classField("purlins"),
      { kind: "heading", key: "", label: "Plates" },
      { kind: "check", key: "plates", label: "Create Plates", value: start.on.plates },
      { kind: "length", key: "lWidth", label: "Plate Width", value: pl.width },
      { kind: "length", key: "lHeight", label: "Plate Height", value: pl.height },
      { kind: "length", key: "lInset", label: "Plate Inset from Eave", value: pl.inset, zero: true },
      {
        kind: "choice",
        key: "lConnection",
        label: "Rafter Connection",
        value: pl.notched ? "notched" : "flush",
        options: [
          { value: "flush", label: "Flush to Top of Plate" },
          { value: "notched", label: "Notched for Plate" },
        ],
        wide: true,
      },
      { kind: "length", key: "lNotch", label: "Notch Depth", value: pl.notch, zero: true },
      classField("plates"),
    ],
    "The selected roofs are framed from their 3D faces: rafters down each slope, spaced from Minimum to Maximum apart along its eave (the fewest that fit no more than Maximum apart, or Minimum apart from one end when they're the same); ridges, hips and valleys where slopes meet; purlins level across the slopes, their elevations above the layer (the Last Purlin's top is that far below the roof's top); plates along each eave under the rafters, their outer face the Plate Inset in from the eave. Elevations above finished floor are above the roof's layer. Each member is a group of its plan and its solid, in its class.",
  );
  if (!v) return null;
  const cls = (key: string): number => Number(v.choice(`${key}Class`)) || 0;
  const pick = <T extends string>(key: string, options: readonly { readonly value: T }[], was: T): T => options.find((o) => o.value === v.choice(key))?.value ?? was;
  return {
    spec: {
      rafters: { width: v.num("rWidth"), height: v.num("rHeight"), minSpacing: v.num("rMin"), maxSpacing: v.num("rMax"), surface: pick("rSurface", SURFACES, r.surface), match: v.flag("rMatch") },
      ridges: { width: v.num("gWidth"), height: v.num("gHeight"), elevation: pick("gElevation", RIDGE_ELEVATIONS, g.elevation), notch: v.num("gNotch"), aff: v.num("gAff") },
      hips: { width: v.num("hWidth"), height: v.num("hHeight"), surface: pick("hSurface", SURFACES, hv.surface) },
      purlins: {
        width: v.num("pWidth"),
        height: v.num("pHeight"),
        first: v.num("pFirst"),
        last: v.num("pLast"),
        by: v.choice("pBy") === "distance" ? "distance" : "count",
        count: v.num("pCount"),
        distance: v.num("pDistance"),
        position: pick("pPosition", PURLIN_SURFACES, pu.position),
        fromLowerEnd: v.flag("pLower"),
        rotate: v.flag("pRotate"),
        inset: v.num("pInset"),
      },
      plates: { width: v.num("lWidth"), height: v.num("lHeight"), inset: v.num("lInset"), notched: v.choice("lConnection") === "notched", notch: v.num("lNotch") },
    },
    on: { rafters: v.flag("rafters"), ridges: v.flag("ridges"), hips: v.flag("hips"), purlins: v.flag("purlins"), plates: v.flag("plates") },
    classes: { rafters: cls("rafters"), ridges: cls("ridges"), hips: cls("hips"), purlins: cls("purlins"), plates: cls("plates") },
  };
}

/** The spec with only the kinds ticked. */
const chosen = (k: Settings): RoofFramerSpec => ({
  rafters: k.on.rafters ? k.spec.rafters : null,
  ridges: k.on.ridges ? k.spec.ridges : null,
  hips: k.on.hips ? k.spec.hips : null,
  purlins: k.on.purlins ? k.spec.purlins : null,
  plates: k.on.plates ? k.spec.plates : null,
});

function problem(k: Settings): string | null {
  if (!Object.values(k.on).some(Boolean)) return "Tick something to create: rafters, ridges, hips and valleys, purlins or plates.";
  const r = k.spec.rafters!;
  if (k.on.rafters && r.minSpacing > r.maxSpacing) return "The rafters' Minimum Spacing is more than their Maximum Spacing.";
  return null;
}

const classOf = (m: RoofMember, k: Settings): number => k.classes[m.kind === "rafter" ? "rafters" : m.kind === "ridge" ? "ridges" : m.kind === "purlin" ? "purlins" : m.kind === "plate" ? "plates" : "hips"];

/** A member's plan and its solid, grouped. */
function addMember(s: EditSession, layerId: string, m: RoofMember, classIndex: number): string {
  const byClass = s.doc.classes().find((c) => c.index === classIndex)?.name !== "None";
  const own: Partial<Attributes> = { ...store.drawAttrs };
  const planId = s.addObject(layerId, { kind: "polygon", points: m.outline, closed: true }, classIndex, own);
  const timber = colorMatcher()(TIMBER);
  const [mesh] = s.addMeshes(layerId, [m.solid], classIndex, { ...store.drawAttrs, fillPattern: 1, fillFore: timber, fillBack: timber, fillOpacity: 100 });
  if (byClass) for (const g of BY_CLASS) s.setAttributesByClass([planId, mesh], g, true);
  return s.groupObjects([planId, mesh]);
}

function freeSheetName(): string {
  const doc = store.session?.doc;
  const taken = new Set([...(doc?.resources() ?? []).map((r) => r.name), ...(doc?.layers() ?? []).map((l) => l.name)]);
  if (!taken.has(SHEET_NAME)) return SHEET_NAME;
  for (let n = 2; ; n++) if (!taken.has(`${SHEET_NAME} ${n}`)) return `${SHEET_NAME} ${n}`;
}

function takeOffRows(members: readonly RoofMember[]): NewSheetCell[][] {
  const units = store.session?.doc.info.units;
  const len = (mm: number): string => formatLength(mm, units);
  const rows = roofTakeOff(members);
  const head: NewSheetCell[] = ["Type", "Width", "Height", "Length", "Count", "Total Length"].map((value) => ({ value, bold: true, align: "center" }));
  const body = rows.map((r): NewSheetCell[] => [{ value: KIND_LABEL[r.kind] }, { value: len(r.width) }, { value: len(r.height) }, { value: len(r.length) }, { value: r.count, align: "right" }, { value: len(r.length * r.count) }]);
  const total: NewSheetCell[] = [{ value: "Total", bold: true }, { value: "" }, { value: "" }, { value: "" }, { value: rows.reduce((n, r) => n + r.count, 0), align: "right", bold: true }, { value: len(rows.reduce((n, r) => n + r.length * r.count, 0)), bold: true }];
  return [head, ...body, total];
}

interface Roof {
  readonly id: string;
  readonly layerId: string;
  /** its faces, heights above its layer */
  readonly triangles: number[];
}

/** The selected objects' 3D faces, by object, their heights above the object's layer. */
function selectedRoofs(): Roof[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const elevation = new Map(doc.layers().map((l) => [l.id, l.elevation]));
  const roofs = new Map<string, Roof>();
  for (const m of doc.model3d()) {
    if (!store.selection.has(m.objectId)) continue;
    const roof = roofs.get(m.objectId) ?? { id: m.objectId, layerId: m.layerId, triangles: [] };
    roofs.set(m.objectId, roof);
    const lift = elevation.get(m.layerId) ?? 0;
    for (let i = 0; i < m.triangles.length; i++) roof.triangles.push(i % 3 === 2 ? m.triangles[i] - lift : m.triangles[i]);
  }
  return [...roofs.values()];
}

/** AEC > Framing > Roof Framer…. */
export async function roofFramerDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  if (!selectedRoofs().length) {
    toast("Select a roof to frame: nothing selected has faces in 3D.", "info");
    return;
  }
  const k = await askSettings(last ?? firstSettings());
  if (!k || store.session !== session) return;
  last = k;
  const wrong = problem(k);
  if (wrong) {
    toast(wrong, "info");
    return;
  }
  const spec = chosen(k);
  const framed: { roof: Roof; members: RoofMember[] }[] = [];
  const skipped: string[] = [];
  for (const roof of selectedRoofs()) {
    const members = frameRoof(roof.triangles, spec);
    if (typeof members === "string") skipped.push(members);
    else framed.push({ roof, members });
  }
  if (!framed.length) {
    toast(`Nothing framed: ${skipped[0] ?? "nothing selected is a roof"}.`, "info");
    return;
  }
  const all = framed.flatMap((f) => f.members);
  const sheets = !!session.doc.resources().some((r) => r.kind === "worksheet");
  const made = attempt("Roof Framer", (s) =>
    s.batch(() => {
      const ids = framed.flatMap(({ roof, members }) => members.map((m) => addMember(s, roof.layerId, m, classOf(m, k))));
      if (sheets) s.createWorksheet({ name: freeSheetName(), widths: [80, 64, 64, 90, 50, 100], rowHeight: 14, rows: takeOffRows(all) });
      return ids;
    }),
  );
  if (!made) return;
  setSelection(made.value);
  const what = (Object.keys(PLURAL) as RoofMemberKind[]).flatMap((kind) => {
    const n = all.filter((m) => m.kind === kind).length;
    return n ? [`${n} ${PLURAL[kind][n === 1 ? 0 : 1]}`] : [];
  });
  const roofs = framed.length === 1 ? "" : ` on ${framed.length} roofs`;
  const left = skipped.length ? ` ${skipped.length} selected ${skipped.length === 1 ? "object wasn't" : "objects weren't"} framed: ${skipped[0]}.` : "";
  toast(`Roof framed${roofs}: ${what.join(", ")}${sheets ? `, counted in a ${SHEET_NAME} worksheet` : ""}.${left}`, "info");
}
