// MEP's Piping Run (pipingShapes.ts), and AEC > MEP > Create Piping Runs for polygons and
// polylines already drawn. Click each corner of its path; a double-click or Enter ends it open, a
// click on the first corner closes it. Vectorworks makes a plug-in object of it, with its figures in
// Object Info; this draws its path and tag as plain objects, grouped and named, and reports the
// figures when it's placed, in a Piping Run record too where the drawing can hold one. They're worked
// out once: reshaping the path doesn't update them. Esc cancels.

import type { Attributes, EditSession, Pt, RecordFieldSpec, RecordValue, Shape } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { CONDUIT_TYPES } from "../conduitSizing.ts";
import { bendRadii, pipingFigures, runPoints, tagPlace, type PipingFigures, type PipingRun } from "../pipingShapes.ts";
import { store } from "../state.ts";
import { truePath } from "../stationShapes.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { formatLength } from "../units.ts";
import type { Part } from "./detailing.ts";
import { PathTool } from "./paths.ts";

const H_CENTRE = 2;
const V_BOTTOM = 5;
/** the tag's text height on paper, mm */
const TAG_MM = 2.5;
const FORMAT = "Piping Run";

const MATERIALS = CONDUIT_TYPES.map((c) => ({ value: c.label.split(" (")[0], label: c.label }));
const TURNS = [
  { value: "elbows", label: "Use Elbows" },
  { value: "bends", label: "Use Bends" },
];

/** the tool's and the command's settings, the same for both */
let settings: PipingRun = {
  size: 25.4,
  material: "EMT",
  remarks: "",
  showTag: true,
  showRemarks: false,
  sectionLength: 3048,
  runs: 1,
  turns: "elbows",
  radius: 150,
};

const units = (): string | undefined => store.session?.doc.info.units;

async function askSettings(title: string): Promise<boolean> {
  const r = settings;
  const v = await toolPrefs(
    title,
    [
      { kind: "length", key: "size", label: "Conduit Size", value: r.size },
      { kind: "choice", key: "material", label: "Material", value: r.material, options: MATERIALS },
      { kind: "text", key: "remarks", label: "Remarks", value: r.remarks },
      { kind: "check", key: "showTag", label: "Show Tag", value: r.showTag },
      { kind: "check", key: "showRemarks", label: "Show Remarks", value: r.showRemarks },
      { kind: "length", key: "section", label: "Section Length", value: r.sectionLength },
      { kind: "number", key: "runs", label: "Num of Runs", value: r.runs, min: 1, max: 9999, integer: true },
      { kind: "choice", key: "turns", label: "Turns", value: r.turns, options: TURNS },
      { kind: "length", key: "radius", label: "Radius", value: r.radius },
    ],
    "Length, sections, couplings and elbows are worked out as it's placed, and don't follow later reshaping.",
  );
  if (!v) return false;
  settings = {
    size: v.num("size"),
    material: v.choice("material"),
    remarks: v.choice("remarks"),
    showTag: v.flag("showTag"),
    showRemarks: v.flag("showRemarks"),
    sectionLength: v.num("section"),
    runs: v.num("runs"),
    turns: v.choice("turns") === "bends" ? "bends" : "elbows",
    radius: v.num("radius"),
  };
  return true;
}

/** The path as a polyline, its bends rounded when the run bends. */
function pathPart(points: readonly Pt[], closed: boolean): Part {
  const pts = runPoints(points, closed);
  const radii = settings.turns === "bends" ? bendRadii(pts, closed, settings.radius) : pts.map(() => 0);
  return {
    shape: { kind: "polyline", points: pts, closed, vertices: radii.map((r) => (r > 0 ? "arc" : "corner")), radii },
    attrs: { fillPattern: 0 },
  };
}

function tagPart(points: readonly Pt[], closed: boolean, scale: number): Part | null {
  const r = settings;
  const place = tagPlace(points, closed);
  if (!r.showTag || !place) return null;
  const lines = [`${formatLength(r.size, units())} ${r.material}`, ...(r.showRemarks && r.remarks ? [r.remarks] : [])];
  const height = TAG_MM * scale;
  // over the line, whichever way it runs
  const at = { x: place.at.x - Math.sin(place.angle) * height * 0.5, y: place.at.y + Math.cos(place.angle) * height * 0.5 };
  return { kind: "text", at, text: lines.join("\r"), height, hAlign: H_CENTRE, vAlign: V_BOTTOM, angle: (place.angle * 180) / Math.PI };
}

function partsFor(points: readonly Pt[], closed: boolean): Part[] | string {
  if (runPoints(points, closed).length < 2) return "A piping run needs two points or more.";
  const layer = store.activeLayerId ? store.session?.doc.layers().find((l) => l.id === store.activeLayerId) : undefined;
  const tag = tagPart(points, closed, layer?.kind === "design" && layer.scale > 0 ? layer.scale : 1);
  return tag ? [pathPart(points, closed), tag] : [pathPart(points, closed)];
}

const figuresText = (f: PipingFigures): string => {
  const elbows = settings.turns === "elbows" ? `, ${f.elbows90} 90° and ${f.elbows45} 45° elbows` : "";
  const runs = settings.runs > 1 ? ` in ${settings.runs} runs` : "";
  return `Piping run: ${formatLength(f.length, units())} long, ${f.sections} ${f.sections === 1 ? "section" : "sections"}, ${f.couplings} ${f.couplings === 1 ? "coupling" : "couplings"}${elbows}${runs}`;
};

/** The drawing's Piping Run record format; null when it has none and no format to make one from. */
function recordFormat(s: EditSession): number {
  const had = s.doc.recordFormats().find((f) => f.name === FORMAT);
  if (had) return had.format;
  const text = (name: string): RecordFieldSpec => ({ name, kind: "text", value: "" });
  const whole = (name: string): RecordFieldSpec => ({ name, kind: "integer", value: 0 });
  const length = (name: string): RecordFieldSpec => ({ name, kind: "dimension", value: 0 });
  return s.createRecordFormat(FORMAT, [
    length("Conduit Size"),
    text("Material"),
    text("Remarks"),
    length("Length"),
    length("Section Length"),
    whole("Num of Runs"),
    whole("Num of Sections"),
    whole("Couplings"),
    text("Turns"),
    whole("45s"),
    whole("90s"),
  ]);
}

function recordValues(f: PipingFigures): Readonly<Record<string, RecordValue>> {
  const r = settings;
  return {
    "Conduit Size": r.size,
    Material: r.material,
    Remarks: r.remarks,
    Length: f.length,
    "Section Length": r.sectionLength,
    "Num of Runs": r.runs,
    "Num of Sections": f.sections,
    Couplings: f.couplings,
    Turns: r.turns === "bends" ? "Bends" : "Elbows",
    "45s": f.elbows45,
    "90s": f.elbows90,
  };
}

/** The next free "Piping Run N", as a drawing's names are all different. */
function namer(s: EditSession): () => string {
  const used = new Set<string>();
  for (const l of s.doc.layers()) for (const o of s.doc.objects(l.id)) if (o.name) used.add(o.name);
  let n = 1;
  return () => {
    while (used.has(`${FORMAT} ${n}`)) n++;
    used.add(`${FORMAT} ${n}`);
    return `${FORMAT} ${n}`;
  };
}

interface RunPath {
  readonly points: readonly Pt[];
  readonly closed: boolean;
  readonly layerId: string;
  readonly classIndex: number;
  readonly attrs?: Partial<Attributes>;
}

/** Adds each run, grouped and named with its record where it can have one; returns what it made. */
function addRuns(s: EditSession, paths: readonly RunPath[]): { ids: string[]; figures: PipingFigures[] } {
  const next = namer(s);
  const format = recordFormat(s);
  const ids: string[] = [];
  const figures: PipingFigures[] = [];
  const values: { id: string; fields: Readonly<Record<string, RecordValue>> }[] = [];
  for (const p of paths) {
    const parts = partsFor(p.points, p.closed);
    if (typeof parts === "string") continue;
    const made = parts.map((part) => {
      const own = "shape" in part ? part : null;
      return s.addObject(p.layerId, own ? own.shape : (part as never), p.classIndex, { ...store.drawAttrs, ...p.attrs, ...own?.attrs });
    });
    const group = s.groupObjects(made);
    s.setObjectName(group, next());
    const f = pipingFigures(p.points, p.closed, settings);
    ids.push(group);
    figures.push(f);
    values.push({ id: group, fields: recordValues(f) });
  }
  if (values.length) {
    s.attachRecord(ids, format);
    s.setRecordFields(format, values);
  }
  return { ids, figures };
}

export class PipingRunTool extends PathTool {
  readonly id = "pipingrun";
  protected readonly label = "Piping Run";

  async preferences(): Promise<void> {
    await askSettings("Piping Run Preferences");
  }

  protected startHint(): string {
    return "Click the start of the piping run";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    return partsFor(points, closed);
  }

  protected override finish(points: Pt[], closed: boolean): void {
    const layerId = store.activeLayerId;
    if (!layerId) return;
    const r = attempt("Piping Run", (s) => s.batch(() => addRuns(s, [{ points, closed, layerId, classIndex: store.activeClassIndex }])));
    if (!r || !r.value.ids.length) return;
    setSelection(r.value.ids);
    toast(figuresText(r.value.figures[0]), "info");
  }
}

/** A selected polygon's or polyline's path: its corners, or its curves taken finely. */
function pathOf(shape: Shape): readonly Pt[] {
  const curved = shape.vertices?.some((v) => v.kind !== "corner");
  return curved ? truePath(shape) : shape.points;
}

function selectedPaths(): { id: string; path: RunPath }[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const out: { id: string; path: RunPath }[] = [];
  for (const id of store.selection) {
    const o = doc.object(id);
    const shape = o?.shape;
    if (!o || !shape || (shape.kind !== "polygon" && shape.kind !== "polyline")) continue;
    out.push({ id, path: { points: pathOf(shape), closed: shape.closed, layerId: o.layerId, classIndex: o.classIndex, attrs: o.attrs ? { penFore: o.attrs.penFore, lineWeight: o.attrs.lineWeight, lineStyle: o.attrs.lineStyle } : undefined } });
  }
  return out;
}

export const canCreatePipingRuns = (): boolean => selectedPaths().length > 0;

/** AEC > MEP > Create Piping Runs: each selected polygon or polyline becomes a piping run in its place. */
export async function createPipingRuns(): Promise<void> {
  if (!canCreatePipingRuns() || !(await askSettings("Create Piping Runs"))) return;
  const chosen = selectedPaths();
  const r = attempt("Create Piping Runs", (s) =>
    s.batch(() => {
      const made = addRuns(s, chosen.map((c) => c.path));
      s.deleteObjects(chosen.map((c) => c.id));
      return made;
    }),
  );
  if (!r) return;
  setSelection(r.value.ids);
  if (r.value.figures.length === 1) toast(figuresText(r.value.figures[0]), "info");
  else {
    const f = r.value.figures;
    const sum = (key: keyof PipingFigures): number => f.reduce((total, x) => total + x[key], 0);
    toast(figuresText({ length: sum("length"), sections: sum("sections"), couplings: sum("couplings"), elbows45: sum("elbows45"), elbows90: sum("elbows90") }).replace("Piping run:", `${f.length} piping runs:`), "info");
  }
}
