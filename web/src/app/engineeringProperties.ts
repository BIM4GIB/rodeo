// Model > Engineering Properties…, as Vectorworks has it: the section properties of one closed 2D
// object (a polygon, polyline, rectangle or rounded rectangle, or a full circle or ellipse), and with
// a locus selected too, its moments about axes through the locus. Area, perimeter, centroid, the
// second moments about the centroid (Ix = ∫y² dA, Iy, Ixy), the polar and principal moments, the
// section moduli and the radii of gyration, in the units chosen. The dialog can place a locus at
// the centroid, place the list as text where the drawing is clicked next (placeAt.ts) and save it
// as a text file. Curved edges are taken as the drawing draws them; circles and ellipses are exact.
// The helpers for units, numbers and the list's output are shared with Volumetric Properties.

import type { Pt, Shape } from "../core/index.ts";
import { addAndSelect } from "./commands.ts";
import { ellipsePerimeter, pathLength } from "./dimension.ts";
import { h } from "./dom.ts";
import { downloadBlob } from "./fileio.ts";
import { showDialog } from "./menubar.ts";
import { placeAtNextClick } from "./placeAt.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLength, millimetresPerUnit, unitLabel } from "./units.ts";
import "./engineeringProperties.css";

/** Section properties in millimetres, moments about axes through the centroid. */
export interface Section {
  readonly area: number;
  readonly perimeter: number;
  readonly centroid: Pt;
  readonly ix: number;
  readonly iy: number;
  readonly ixy: number;
  /** how far the shape reaches from the centroid across x (for Sy) and across y (for Sx) */
  readonly reachX: number;
  readonly reachY: number;
}

/** A polygon's section properties by Green's theorem, its corners taken about the first so far drawings keep their precision. */
export function polygonSection(pts: readonly Pt[]): Section | null {
  if (pts.length < 3) return null;
  const o = pts[0];
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let i = 0; i < pts.length; i++) {
    const x0 = pts[i].x - o.x;
    const y0 = pts[i].y - o.y;
    const x1 = pts[(i + 1) % pts.length].x - o.x;
    const y1 = pts[(i + 1) % pts.length].y - o.y;
    const c = x0 * y1 - x1 * y0;
    a2 += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
    yy += (y0 * y0 + y0 * y1 + y1 * y1) * c;
    xx += (x0 * x0 + x0 * x1 + x1 * x1) * c;
    xy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
  }
  if (Math.abs(a2) < 1e-12) return null;
  // corners clockwise give every sum the other sign
  const s = Math.sign(a2);
  const area = Math.abs(a2) / 2;
  const gx = cx / (3 * a2);
  const gy = cy / (3 * a2);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x - o.x);
    maxX = Math.max(maxX, p.x - o.x);
    minY = Math.min(minY, p.y - o.y);
    maxY = Math.max(maxY, p.y - o.y);
  }
  return {
    area,
    perimeter: pathLength(pts, true),
    centroid: { x: o.x + gx, y: o.y + gy },
    ix: (s * yy) / 12 - area * gy * gy,
    iy: (s * xx) / 12 - area * gx * gx,
    ixy: (s * xy) / 24 - area * gx * gy,
    reachX: Math.max(maxX - gx, gx - minX),
    reachY: Math.max(maxY - gy, gy - minY),
  };
}

/** An ellipse's (or circle's) section properties, exactly. */
export function ellipseSection(center: Pt, rx: number, ry: number): Section {
  return {
    area: Math.PI * rx * ry,
    perimeter: ellipsePerimeter(rx, ry),
    centroid: center,
    ix: (Math.PI * rx * ry ** 3) / 4,
    iy: (Math.PI * rx ** 3 * ry) / 4,
    ixy: 0,
    reachX: rx,
    reachY: ry,
  };
}

/** The section of a closed 2D shape, or null for one with no area to measure. */
export function sectionOf(shape: Shape): Section | null {
  if (shape.kind === "arc") {
    const { center, rx } = shape;
    const ry = shape.ry ?? rx;
    if (!center || !rx || !ry || Math.abs(shape.sweepAngle ?? 360) < 360) return null;
    return ellipseSection(center, rx, ry);
  }
  if (shape.kind === "rect" || ((shape.kind === "polygon" || shape.kind === "polyline") && shape.closed)) return polygonSection(shape.points);
  return null;
}

// ---- the selection --------------------------------------------------------------------------

/** The selected closed 2D object and the selected locus, if one is; null unless that is the whole selection. */
function selected(): { shape: Shape; locus: Pt | null } | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size < 1 || store.selection.size > 2) return null;
  let shape: Shape | null = null;
  let locus: Pt | null = null;
  for (const id of store.selection) {
    const o = doc.object(id);
    if (!o?.shape || o.wireframe || isDerivedId(id)) return null;
    if (o.shape.kind === "locus" && !locus) locus = o.shape.points[0] ?? null;
    else if (!shape && sectionOf(o.shape)) shape = o.shape;
    else return null;
  }
  return shape ? { shape, locus } : null;
}

export function canEngineeringProperties(): boolean {
  return selected() !== null;
}

/** The one selected closed 2D object, for Centroid. */
function selectedShape(): Shape | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return null;
  const [id] = store.selection;
  const o = doc.object(id);
  return o?.shape && !o.wireframe && !isDerivedId(id) && sectionOf(o.shape) ? o.shape : null;
}

export function canCentroid(): boolean {
  return selectedShape() !== null;
}

// ---- units, numbers and the list's output (Volumetric Properties too) ----------------------------

const UNIT_CHOICES: readonly { readonly key: string; readonly label: string; readonly mm: number }[] = [
  { key: "mm", label: "mm", mm: 1 },
  { key: "cm", label: "cm", mm: 10 },
  { key: "m", label: "m", mm: 1000 },
  { key: "in", label: "in", mm: 25.4 },
  { key: "ft", label: "ft", mm: 304.8 },
];

/** A unit the properties are given in: its short label and millimetres in one. */
export interface Unit {
  readonly label: string;
  readonly mm: number;
}

let lastUnits = "doc";

/** The Units menu: the document's units first, then the usual metric and imperial ones; `unit()` reads it. */
export function unitSelect(onChange: () => void): { readonly el: HTMLSelectElement; unit(): Unit } {
  const units = store.session?.doc.info.units;
  const doc: Unit = { label: unitLabel(units), mm: millimetresPerUnit(units) };
  const el = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Units" } },
    h("option", { value: "doc", text: `Document units (${doc.label})` }),
    ...UNIT_CHOICES.map((u) => h("option", { value: u.key, text: u.label })),
  );
  el.value = lastUnits;
  if (el.selectedIndex < 0) el.value = "doc";
  el.addEventListener("change", () => {
    lastUnits = el.value;
    onChange();
  });
  return { el, unit: () => UNIT_CHOICES.find((u) => u.key === el.value) ?? doc };
}

/** A property's number: six significant figures, very large and very small ones as 1.2346E+11. */
export function numberText(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a < 1e-12) return "0";
  if (a >= 1e9 || a < 1e-4) return v.toExponential(4).replace("e", "E");
  return String(Number(v.toPrecision(6)));
}

const POWER = ["", "", "²", "³", "⁴"];

/** One line of the list: a label, and a value in the unit raised to `power` (0 for a plain number or an angle). */
export interface PropertyLine {
  readonly label: string;
  /** the value in millimetres to `power` (degrees with `degrees`) */
  readonly mm: number;
  readonly power: number;
  readonly degrees?: boolean;
  /** a value already in words with its own units (a mass, a weight), which the Units menu doesn't change */
  readonly text?: string;
}

export function lineText(line: PropertyLine, unit: Unit): string {
  if (line.text !== undefined) return line.text;
  if (!Number.isFinite(line.mm)) return "—";
  if (line.degrees) return `${numberText(line.mm)}°`;
  if (!line.power) return numberText(line.mm);
  return `${numberText(line.mm / unit.mm ** line.power)} ${unit.label}${POWER[line.power]}`;
}

/** The list shown in the dialog, a heading for each group of lines. */
export function propertyList(groups: readonly { readonly title?: string; readonly lines: readonly PropertyLine[] }[], unit: Unit): HTMLElement {
  return h(
    "dl",
    { cls: "props-list" },
    ...groups.flatMap((g) => [
      ...(g.title ? [h("div", { cls: "props-group", text: g.title })] : []),
      ...g.lines.flatMap((l) => [h("dt", { text: l.label }), h("dd", { text: lineText(l, unit) })]),
    ]),
  );
}

/** The list as text lines, for the drawing and the file. */
export function propertyText(title: string, groups: readonly { readonly title?: string; readonly lines: readonly PropertyLine[] }[], unit: Unit): string[] {
  const out = [title];
  for (const g of groups) {
    if (g.title) out.push(g.title);
    for (const l of g.lines) out.push(`${l.label}: ${lineText(l, unit)}`);
  }
  return out;
}

/** Paper height of the placed text, as the Text tool's. */
const TEXT_MM = 2.5;

/** Places `lines` as one text, its top left where the drawing is clicked next, on the active layer. */
export function placeTextAtClick(what: string, lines: readonly string[]): void {
  placeAtNextClick({
    what,
    place: (at) => {
      const layer = store.session?.doc.layers().find((l) => l.id === store.activeLayerId);
      if (!layer) return;
      const shape = { kind: "text" as const, at, text: lines.join("\r"), height: TEXT_MM * layer.scale };
      // justifying moves the origin so the text stays put, so the origin goes back on the click after
      addAndSelect(shape, undefined, (s, id) => {
        s.setTextStyle([id], { hAlign: 1, vAlign: 1 });
        s.setGeometry(id, shape);
      });
    },
  });
}

/** Saves `lines` as a text file named for the drawing and `what`. */
export function writeTextFile(what: string, lines: readonly string[]): void {
  const name = `${store.fileName.replace(/\.vwx$/i, "")} ${what.toLowerCase()}.txt`;
  downloadBlob(name, new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
}

export function checkRow(label: string): [HTMLInputElement, HTMLElement] {
  const box = h("input", { attrs: { type: "checkbox", "aria-label": label } });
  return [box, h("label", { cls: "menu-dialog-check" }, box, label)];
}

// ---- the command ---------------------------------------------------------------------------------

function sectionLines(sec: Section, locus: Pt | null): { title?: string; lines: PropertyLine[] }[] {
  const { area: a, ix, iy } = sec;
  // what is left of a symmetric shape's Ixy by rounding is nought
  const ixy = Math.abs(sec.ixy) < 1e-9 * Math.max(ix, iy) ? 0 : sec.ixy;
  const half = (ix + iy) / 2;
  const r = Math.hypot((ix - iy) / 2, ixy);
  // the axis of the largest moment, from +x counter-clockwise
  const angle = ixy === 0 ? (ix >= iy ? 0 : 90) : (Math.atan2(-2 * ixy, ix - iy) * 90) / Math.PI;
  const groups: { title?: string; lines: PropertyLine[] }[] = [
    {
      lines: [
        { label: "Area", mm: a, power: 2 },
        { label: "Perimeter", mm: sec.perimeter, power: 1 },
        { label: "Centroid X", mm: sec.centroid.x, power: 1 },
        { label: "Centroid Y", mm: sec.centroid.y, power: 1 },
      ],
    },
    {
      title: "About the centroid",
      lines: [
        { label: "Ix", mm: ix, power: 4 },
        { label: "Iy", mm: iy, power: 4 },
        { label: "Ixy", mm: ixy, power: 4 },
        { label: "Polar moment J", mm: ix + iy, power: 4 },
        { label: "Principal I1", mm: half + r, power: 4 },
        { label: "Principal I2", mm: half - r, power: 4 },
        { label: "Angle of I1's axis", mm: angle, power: 0, degrees: true },
        { label: "Section modulus Sx", mm: sec.reachY > 0 ? ix / sec.reachY : NaN, power: 3 },
        { label: "Section modulus Sy", mm: sec.reachX > 0 ? iy / sec.reachX : NaN, power: 3 },
        { label: "Radius of gyration rx", mm: Math.sqrt(ix / a), power: 1 },
        { label: "Radius of gyration ry", mm: Math.sqrt(iy / a), power: 1 },
      ],
    },
  ];
  if (locus) {
    const dx = sec.centroid.x - locus.x;
    const dy = sec.centroid.y - locus.y;
    const lx = ix + a * dy * dy;
    const ly = iy + a * dx * dx;
    groups.push({
      title: "About the locus",
      lines: [
        { label: "Centroid from locus X", mm: dx, power: 1 },
        { label: "Centroid from locus Y", mm: dy, power: 1 },
        { label: "Ix", mm: lx, power: 4 },
        { label: "Iy", mm: ly, power: 4 },
        { label: "Ixy", mm: ixy + a * dx * dy, power: 4 },
        { label: "Polar moment J", mm: lx + ly, power: 4 },
        { label: "Radius of gyration rx", mm: Math.sqrt(lx / a), power: 1 },
        { label: "Radius of gyration ry", mm: Math.sqrt(ly / a), power: 1 },
      ],
    });
  }
  return groups;
}

/** Model > Engineering Properties…: the list in the units chosen, and what to do with it. */
export async function engineeringPropertiesDialog(): Promise<void> {
  const sel = selected();
  const sec = sel && sectionOf(sel.shape);
  if (!sel || !sec) {
    toast("Select one closed 2D object (and a locus, for moments about it).", "info");
    return;
  }
  const groups = sectionLines(sec, sel.locus);
  const holder = h("div", { cls: "props-holder" });
  const units = unitSelect(() => holder.replaceChildren(propertyList(groups, units.unit())));
  holder.replaceChildren(propertyList(groups, units.unit()));
  const [locus, locusRow] = checkRow("Place locus at centroid");
  const [place, placeRow] = checkRow("Place properties on drawing");
  const [write, writeRow] = checkRow("Write properties to file");
  const r = await showDialog<{ unit: Unit; locus: boolean; place: boolean; write: boolean }>({
    title: "Engineering Properties",
    okLabel: "OK",
    cls: "props-dialog",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Units" }), units.el), holder, locusRow, placeRow, writeRow],
    check: () => ({ value: { unit: units.unit(), locus: locus.checked, place: place.checked, write: write.checked } }),
  });
  if (!r) return;
  const text = propertyText("Engineering Properties", groups, r.unit);
  if (r.locus) addAndSelect({ kind: "locus", at: sec.centroid });
  if (r.write) writeTextFile("Engineering Properties", text);
  if (r.place) placeTextAtClick("Engineering Properties", text);
}

/** AEC > Machine Design > Centroid…: where the selected closed 2D object's centroid lies, and a locus placed there when asked. */
export async function centroidDialog(): Promise<void> {
  const shape = selectedShape();
  const sec = shape && sectionOf(shape);
  if (!sec) {
    toast("Select one closed 2D object.", "info");
    return;
  }
  const units = store.session?.doc.info.units;
  const [locus, locusRow] = checkRow("Place locus at centroid");
  const at = h(
    "dl",
    { cls: "props-list" },
    ...[
      ["X", formatLength(sec.centroid.x, units)],
      ["Y", formatLength(sec.centroid.y, units)],
    ].flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })]),
  );
  const place = await showDialog<boolean>({
    title: "Centroid",
    okLabel: "OK",
    body: [h("p", { cls: "menu-dialog-text", text: "The centroid of the selected object lies at" }), h("div", { cls: "props-holder" }, at), locusRow],
    check: () => ({ value: locus.checked }),
  });
  if (place) addAndSelect({ kind: "locus", at: sec.centroid });
}
