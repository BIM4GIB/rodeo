// AEC > Framing > Create Joists…, Vectorworks' command of that name: the selected floor outline
// framed (joistShapes.ts) by members round its edge and joists across it, laid out from two clicks
// that set the way they run, with headers round any opening selected inside it, and a Joist Take-Off
// worksheet. Vectorworks makes framing member objects; here each member is a group of its plan, drawn
// as the Framing Member tool draws one, and its solid, which together show as a hybrid does.

import type { Attributes, EditSession, NewShape, NewSheetCell, Pt } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { appContext } from "./ext.ts";
import { framingMember } from "./framingShapes.ts";
import { pointInPolygon, signedArea } from "./geom.ts";
import { joistFraming, takeOff, type CornerCondition, type EndCondition, type JoistSpec, type Member, type MemberKind } from "./joistShapes.ts";
import { colorMatcher } from "./pdfImport.ts";
import { placeAtNextClick } from "./placeAt.ts";
import { prism } from "./solids3d.ts";
import { store } from "./state.ts";
import { closedOutline, hasClosedSelection } from "./surfaces.ts";
import { toast } from "./toast.ts";
import { toolPrefs, type PrefField } from "./toolPrefs.ts";
import type { Part } from "./tools/detailing.ts";
import { formatLength, millimetresPerUnit } from "./units.ts";

type Display = "solid" | "centre" | "width" | "both";

const DISPLAYS: readonly { readonly value: Display; readonly label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "centre", label: "Centerline" },
  { value: "width", label: "Width" },
  { value: "both", label: "Width with Centerline" },
];
const ENDS: readonly { readonly value: EndCondition; readonly label: string }[] = [
  { value: "inside", label: "Inside Face" },
  { value: "centre", label: "Centerline" },
  { value: "outside", label: "Outside Face" },
];
const CORNERS: readonly { readonly value: CornerCondition; readonly label: string }[] = [
  { value: "lapped", label: "Lapped" },
  { value: "mitred", label: "Mitered" },
];
const KIND_LABEL: Record<MemberKind, string> = { joist: "Joist", perimeter: "Perimeter", header: "Header" };

/** a label's height on paper, mm, as the Framing Member tool's */
const LABEL_MM = 2.5;
const H_CENTRE = 2;
const V_CENTRE = 3;
const TIMBER = { r: 0.82, g: 0.68, b: 0.47 };
const SHEET_NAME = "Joist Take-Off";
const BY_CLASS = ["fill", "lineStyle", "penColor", "lineWeight", "opacity"] as const;

interface MemberLook {
  readonly top: number;
  readonly classIndex: number;
  readonly width: number;
  readonly height: number;
  readonly display: Display;
  readonly showLabel: boolean;
  readonly label: string;
}

interface JoistSettings {
  readonly drawJoists: boolean;
  readonly spacing: number;
  readonly joist: MemberLook;
  readonly drawPerimeter: boolean;
  readonly perimeter: MemberLook;
  readonly end: EndCondition;
  readonly corner: CornerCondition;
  readonly deleteSource: boolean;
}

let last: JoistSettings | null = null;

/** 2x10s 16" apart in inches and feet, else 50 × 225 mm 400 apart. */
function firstSettings(): JoistSettings {
  const perUnit = millimetresPerUnit(store.session?.doc.info.units);
  const imperial = perUnit === 25.4 || perUnit === 304.8;
  const look = (label: string): MemberLook => ({ top: 0, classIndex: store.activeClassIndex, width: imperial ? 38.1 : 50, height: imperial ? 234.95 : 225, display: "solid", showLabel: false, label });
  return { drawJoists: true, spacing: imperial ? 406.4 : 400, joist: look("J"), drawPerimeter: true, perimeter: look("Rim"), end: "inside", corner: "lapped", deleteSource: false };
}

interface Floor {
  readonly outline: Pt[];
  readonly openings: Pt[][];
  readonly sources: string[];
  readonly layerId: string;
}

/** The largest closed shape selected, and the others inside it as its openings, or what's wrong. */
function selectedFloor(): Floor | string {
  const doc = store.session?.doc;
  if (!doc) return "Open a drawing first.";
  const shapes = [...store.selection].flatMap((id) => {
    const o = doc.object(id);
    const ring = o?.shape ? closedOutline(o.shape) : null;
    return o && ring ? [{ id, ring, layerId: o.layerId }] : [];
  });
  if (!shapes.length) return "Select a rectangle, polygon, polyline or other closed shape to frame.";
  shapes.sort((a, b) => Math.abs(signedArea(b.ring)) - Math.abs(signedArea(a.ring)));
  const [floor, ...rest] = shapes;
  if (rest.some((r) => r.layerId !== floor.layerId || !r.ring.every((p) => pointInPolygon(p, floor.ring)))) return "Select one floor outline, and with it only openings inside it.";
  return { outline: floor.ring, openings: rest.map((r) => r.ring), sources: shapes.map((r) => r.id), layerId: floor.layerId };
}

export const canCreateJoists = (): boolean => hasClosedSelection(1);

async function askSettings(start: JoistSettings): Promise<JoistSettings | null> {
  const classes = (store.session?.doc.classes() ?? []).map((c) => ({ value: String(c.index), label: c.name }));
  const choice = <T extends string>(key: string, label: string, value: T, options: readonly { readonly value: T; readonly label: string }[], wide = false): PrefField => ({ kind: "choice", key, label, value, options, wide });
  const member = (p: string, m: MemberLook, topLabel: string): PrefField[] => [
    { kind: "length", key: `${p}Top`, label: topLabel, value: m.top, signed: true },
    ...(p === "j" ? [{ kind: "length" as const, key: "spacing", label: "Center-to-Center Spacing", value: start.spacing }] : []),
    { kind: "choice", key: `${p}Class`, label: "Class", value: String(m.classIndex), options: classes, wide: true },
    { kind: "length", key: `${p}Width`, label: "Width", value: m.width },
    { kind: "length", key: `${p}Height`, label: "Height", value: m.height },
    choice(`${p}Display`, "2D Display", m.display, DISPLAYS),
    { kind: "check", key: `${p}ShowLabel`, label: "Show Label", value: m.showLabel },
    { kind: "text", key: `${p}Label`, label: "Label Text", value: m.label },
  ];
  const v = await toolPrefs(
    "Create Joists",
    [
      { kind: "heading", key: "", label: "Joists" },
      { kind: "check", key: "drawJoists", label: "Draw Joists", value: start.drawJoists },
      ...member("j", start.joist, "Elevation of Top of Joist"),
      { kind: "heading", key: "", label: "Perimeter Framing Members" },
      { kind: "check", key: "drawPerimeter", label: "Draw Perimeter Framing Members", value: start.drawPerimeter },
      ...member("p", start.perimeter, "Elevation of Top of Framing"),
      { kind: "heading", key: "", label: "Framing" },
      choice("end", "End Condition of Joists at Perimeter", start.end, ENDS, true),
      choice("corner", "Corner Condition of Perimeter", start.corner, CORNERS),
      { kind: "check", key: "deleteSource", label: "Delete Source Geometry", value: start.deleteSource },
    ],
    "After OK, click two points along the way the joists run: they're laid out from the first, the spacing apart either way, wherever they fit clear of the perimeter and the headers, and stop at the end condition's face. Shapes selected inside the floor are openings, ringed by headers the joists' size with the members alongside the joists running through. Elevations are of the members' tops above the layer. Members take their class's attributes, or the drawing's in None. Each member is a group of its plan and its solid; types other than a solid beam, hangers, vertical reference and textures aren't drawn or kept.",
  );
  if (!v) return null;
  const look = (p: string, was: MemberLook): MemberLook => ({
    top: v.num(`${p}Top`),
    classIndex: Number(v.choice(`${p}Class`)) || 0,
    width: v.num(`${p}Width`),
    height: v.num(`${p}Height`),
    display: DISPLAYS.find((d) => d.value === v.choice(`${p}Display`))?.value ?? was.display,
    showLabel: v.flag(`${p}ShowLabel`),
    label: v.choice(`${p}Label`),
  });
  return {
    drawJoists: v.flag("drawJoists"),
    spacing: v.num("spacing"),
    joist: look("j", start.joist),
    drawPerimeter: v.flag("drawPerimeter"),
    perimeter: look("p", start.perimeter),
    end: ENDS.find((e) => e.value === v.choice("end"))?.value ?? start.end,
    corner: CORNERS.find((c) => c.value === v.choice("corner"))?.value ?? start.corner,
    deleteSource: v.flag("deleteSource"),
  };
}

const specOf = (k: JoistSettings): JoistSpec => ({
  joists: k.drawJoists ? { width: k.joist.width, height: k.joist.height, top: k.joist.top, spacing: k.spacing } : null,
  perimeter: k.drawPerimeter ? { width: k.perimeter.width, height: k.perimeter.height, top: k.perimeter.top } : null,
  end: k.end,
  corner: k.corner,
});

/** headers take the joists' look */
const lookOf = (m: Member, k: JoistSettings): MemberLook => (m.kind === "perimeter" ? k.perimeter : k.joist);

const dashedStyle = (): number | undefined => store.session?.doc.lineTypes().find((t) => t.dashes.length > 0)?.style;

/** A member's plan as the Framing Member tool draws one, and its solid, grouped. */
function addMember(s: EditSession, layerId: string, m: Member, look: MemberLook, textSize: number): string {
  const byClass = s.doc.classes().find((c) => c.index === look.classIndex)?.name !== "None";
  const outline: NewShape = { kind: "polygon", points: m.outline, closed: true };
  const centre: NewShape = { kind: "polyline", points: m.centre, closed: false };
  const hollow = { fillPattern: 0 };
  const plan: [NewShape, Partial<Attributes>, boolean][] =
    look.display === "solid"
      ? [[outline, {}, true]]
      : look.display === "centre"
        ? [[centre, {}, true]]
        : look.display === "width"
          ? [[outline, hollow, false]]
          : [[outline, hollow, false], [centre, dashedStyle() === undefined ? {} : { lineStyle: dashedStyle() }, false]];
  const text = look.label.trim();
  if (look.showLabel && text) {
    const placed = framingMember(m.centre[0], m.centre[1], { width: m.width, startMiter: 0, endMiter: 0, inset: 0, overhang: 0 }, textSize);
    if (typeof placed !== "string") plan.push([{ kind: "text", at: placed.label.at, text, height: textSize, hAlign: H_CENTRE, vAlign: V_CENTRE, angle: placed.label.angle }, {}, true]);
  }
  const ids = plan.map(([shape, own, fill]) => {
    const id = s.addObject(layerId, shape, look.classIndex, { ...store.drawAttrs, ...own });
    if (byClass) for (const g of BY_CLASS) if (fill || g !== "fill") s.setAttributesByClass([id], g, true);
    return id;
  });
  const timber = colorMatcher()(TIMBER);
  const [mesh] = s.addMeshes(layerId, [prism([m.outline], m.top - m.height, m.top)], look.classIndex, { ...store.drawAttrs, fillPattern: 1, fillFore: timber, fillBack: timber, fillOpacity: 100 });
  if (byClass) for (const g of BY_CLASS) s.setAttributesByClass([mesh], g, true);
  return s.groupObjects([...ids, mesh]);
}

function freeSheetName(): string {
  const doc = store.session?.doc;
  const taken = new Set([...(doc?.resources() ?? []).map((r) => r.name), ...(doc?.layers() ?? []).map((l) => l.name)]);
  if (!taken.has(SHEET_NAME)) return SHEET_NAME;
  for (let n = 2; ; n++) if (!taken.has(`${SHEET_NAME} ${n}`)) return `${SHEET_NAME} ${n}`;
}

/** The members counted by kind, section and length, with a total. */
function takeOffRows(members: readonly Member[]): NewSheetCell[][] {
  const units = store.session?.doc.info.units;
  const len = (mm: number): string => formatLength(mm, units);
  const rows = takeOff(members);
  const head: NewSheetCell[] = ["Type", "Width", "Height", "Length", "Count", "Total Length"].map((value) => ({ value, bold: true, align: "center" }));
  const body = rows.map((r): NewSheetCell[] => [{ value: KIND_LABEL[r.kind] }, { value: len(r.width) }, { value: len(r.height) }, { value: len(r.length) }, { value: r.count, align: "right" }, { value: len(r.length * r.count) }]);
  const total: NewSheetCell[] = [{ value: "Total", bold: true }, { value: "" }, { value: "" }, { value: "" }, { value: rows.reduce((n, r) => n + r.count, 0), align: "right", bold: true }, { value: len(rows.reduce((n, r) => n + r.length * r.count, 0)), bold: true }];
  return [head, ...body, total];
}

function frame(floor: Floor, k: JoistSettings, a: Pt, b: Pt): void {
  const members = joistFraming(floor.outline, floor.openings, a, b, specOf(k));
  if (typeof members === "string") {
    toast(members, "info");
    return;
  }
  const doc = store.session?.doc;
  const layer = appContext()?.scene.layer(floor.layerId);
  const textSize = LABEL_MM * (layer?.scale || 1);
  const sheets = !!doc?.resources().some((r) => r.kind === "worksheet");
  const made = attempt("Create Joists", (s) =>
    s.batch(() => {
      const ids = members.map((m) => addMember(s, floor.layerId, m, lookOf(m, k), textSize));
      if (k.deleteSource) s.deleteObjects(floor.sources);
      if (sheets) s.createWorksheet({ name: freeSheetName(), widths: [80, 64, 64, 90, 50, 100], rowHeight: 14, rows: takeOffRows(members) });
      return ids;
    }),
  );
  if (!made) return;
  setSelection(made.value);
  const count = (kind: MemberKind, one: string, many: string): string[] => {
    const n = members.filter((m) => m.kind === kind).length;
    return n ? [`${n} ${n === 1 ? one : many}`] : [];
  };
  const what = [...count("joist", "joist", "joists"), ...count("perimeter", "perimeter member", "perimeter members"), ...count("header", "header", "headers")].join(", ");
  toast(sheets ? `Framed: ${what}, counted in a ${SHEET_NAME} worksheet.` : `Framed: ${what}. (This drawing has no worksheet to copy one from, so there's no ${SHEET_NAME}.)`, "info");
}

/** AEC > Framing > Create Joists…: the settings, then two clicks for the joists' direction. */
export async function createJoistsDialog(): Promise<void> {
  const floor = selectedFloor();
  if (typeof floor === "string") {
    toast(floor, "info");
    return;
  }
  const session = store.session;
  const k = await askSettings(last ?? firstSettings());
  if (!k || store.session !== session) return;
  last = k;
  if (!k.drawJoists) {
    frame(floor, k, { x: 0, y: 0 }, { x: 0, y: 0 });
    return;
  }
  const spec = specOf(k);
  placeAtNextClick({
    what: "Joists",
    hint: "Create Joists: click a point the first joist runs through · Esc cancels",
    place: (a) =>
      void placeAtNextClick({
        what: "Joists",
        hint: `Create Joists: click the way they run · Shift 15° · Esc cancels`,
        from: a,
        preview: (b): Part[] => {
          const line: Part = { kind: "polyline", points: [a, b], closed: false };
          const members = joistFraming(floor.outline, floor.openings, a, b, spec);
          return typeof members === "string" ? [line] : [line, ...members.map((m): Part => ({ kind: "polygon", points: m.outline, closed: true }))];
        },
        place: (b) => {
          if (store.session === session) frame(floor, k, a, b);
        },
      }),
  });
}
