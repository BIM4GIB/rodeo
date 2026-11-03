// AEC > Roads > Station on Polyline…, Vectorworks' Place Station Points Along Polyline: stakes along
// the selected line, one every 100 feet (30.48 m) and at a smaller partial interval, each labeled with
// its station, and if asked each circular curve's data: drawn at the curve with its tangent guide
// lines, or in a worksheet. Stakes draw as the Stake tool's default, as plain 2D objects in groups;
// their properties, elevations from a site model and the road they lead to aren't here.

import { TEXT_LINE_HEIGHT, type NewSheetCell, type ObjectInfo, type Pt } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { appContext } from "./ext.ts";
import { curvesOf, dms, pathLength, stationName, stationsAlong, stationSpots, truePath, type Curve } from "./stationShapes.ts";
import { stake } from "./stakeShapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";
import { addPieces, type Part } from "./tools/detailing.ts";
import { markerParts } from "./tools/markers.ts";
import { formatLength, unitLabel } from "./units.ts";

/** paper mm, as the Stake tool draws them */
const TEXT_MM = 2.5;
const MARK_MM = 3;
/** at most, so a short interval on a long line can't flood the drawing */
const MAX_STATIONS = 2000;
const IMPERIAL = new Set(["in", "ft", "yd", "mi"]);
/** a character's width against the text's height, near enough to lay a block of it out */
const TEXT_WIDTH = 0.55;

type CurveOption = "labels" | "table" | "none";
const CURVE_OPTIONS: readonly { readonly value: CurveOption; readonly label: string }[] = [
  { value: "labels", label: "Create individual curve labels" },
  { value: "table", label: "Create circular curve data table" },
  { value: "none", label: "No Curve Data" },
];

const last = { partial: 15240, curves: "none" as CurveOption };

function selectedLine(): ObjectInfo | null {
  const s = store.session;
  if (!s || store.selection.size !== 1) return null;
  const obj = s.doc.object([...store.selection][0]);
  const shape = obj?.shape;
  if (!obj || !shape || (shape.kind !== "polyline" && shape.kind !== "polygon" && shape.kind !== "line")) return null;
  return pathLength(shape.points, shape.closed) > 0 ? obj : null;
}

/** A polyline, polygon or line selected, on a design layer. */
export function canPlaceStations(): boolean {
  const id = store.activeLayerId;
  return !!id && appContext()?.scene.layer(id)?.kind === "design" && selectedLine() !== null;
}

const label = (p: Pt, text: string, h: number): Part => ({ kind: "text", at: p, text, height: h });
const line = (a: Pt, b: Pt): Part => ({ kind: "line", a, b });

/** A curve's rows of data, as its label and the worksheet read them. */
function curveRows(c: Curve, metric: boolean): readonly (readonly [string, string])[] {
  const units = store.session?.doc.info.units;
  return [
    ["PC", stationName(c.fromAlong, metric)],
    ["PT", stationName(c.toAlong, metric)],
    ["I", dms(c.angle)],
    ["T", formatLength(c.tangent, units)],
    ["R", formatLength(c.r, units)],
    ["L", formatLength(c.length, units)],
    ["C", formatLength(c.chord, units)],
  ];
}

/** The curve's marks and tangent guide lines, and its data beside it. */
function curveParts(c: Curve, n: number, scale: number, metric: boolean): Part[] {
  const h = TEXT_MM * scale;
  const tick = MARK_MM * scale;
  const out = (p: Pt): Pt => {
    const d = Math.hypot(p.x - c.centre.x, p.y - c.centre.y) || 1;
    return { x: (p.x - c.centre.x) / d, y: (p.y - c.centre.y) / d };
  };
  const mark = (p: Pt, text: string): Part[] => {
    const u = out(p);
    return [line({ x: p.x - u.x * tick, y: p.y - u.y * tick }, { x: p.x + u.x * tick, y: p.y + u.y * tick }), label({ x: p.x + u.x * tick * 1.5, y: p.y + u.y * tick * 1.5 }, text, h)];
  };
  const parts = [...mark(c.from, "PC"), ...mark(c.to, "PT")];
  if (c.pi) parts.push(line(c.from, c.pi), line(c.pi, c.to), label({ x: c.pi.x, y: c.pi.y + h }, "PI", h));
  // the data inside the curve, its block running away from the curve
  const mid = { x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2 };
  const u = out(mid);
  const rows = [`Curve ${n}`, ...curveRows(c, metric).map(([k, v]) => `${k} ${v}`)];
  const wide = Math.max(...rows.map((r) => r.length)) * h * TEXT_WIDTH;
  const tall = rows.length * h * TEXT_LINE_HEIGHT;
  const near = { x: mid.x - u.x * h * 2, y: mid.y - u.y * h * 2 };
  parts.push(label({ x: u.x > 0 ? near.x - wide : near.x, y: u.y < 0 ? near.y + tall : near.y }, rows.join("\r"), h));
  return parts;
}

/** The first of "Station Worksheet 1", 2 and so on that's free. */
function freeSheetName(): string {
  const doc = store.session?.doc;
  const taken = new Set([...(doc?.resources() ?? []).map((r) => r.name), ...(doc?.layers() ?? []).map((l) => l.name)]);
  for (let n = 1; ; n++) if (!taken.has(`Station Worksheet ${n}`)) return `Station Worksheet ${n}`;
}

function curveSheet(curves: readonly Curve[], metric: boolean): number | null {
  const head: NewSheetCell[] = ["Curve", ...curveRows(curves[0], metric).map(([k]) => k)].map((value) => ({ value, bold: true, align: "center" }));
  const rows = curves.map((c, i): NewSheetCell[] => [{ value: i + 1, align: "center" }, ...curveRows(c, metric).map(([, value]) => ({ value }))]);
  const name = freeSheetName();
  const made = attempt("Station Worksheet", (s) => s.createWorksheet({ name, widths: [40, ...Array.from({ length: 7 }, () => 72)], rowHeight: 14, rows: [head, ...rows] }));
  return made ? made.value : null;
}

/** AEC > Roads > Station on Polyline…: the interval and the curve data, then the stakes. */
export async function stationOnPolylineDialog(): Promise<void> {
  const obj = selectedLine();
  const shape = obj?.shape;
  const layerId = store.activeLayerId;
  const layer = layerId ? appContext()?.scene.layer(layerId) : undefined;
  const s = store.session;
  if (!shape || !layer || !s) return;
  const v = await toolPrefs(
    "Place Station Points Along Polyline",
    [
      { kind: "length", key: "partial", label: "Partial station interval", value: last.partial, zero: true },
      { kind: "choice", key: "curves", label: "Curve data", value: last.curves, options: CURVE_OPTIONS },
    ],
    "Stations are placed every 100' (30.48 m) from the line's first point, at the partial interval between them (0 for none), and at its end. Curve data covers a polyline's circular curves: individual labels draw each with its tangent guide lines; a table lists them in a worksheet.",
  );
  if (!v) return;
  const partial = v.num("partial");
  const curves = CURVE_OPTIONS.find((o) => o.value === v.choice("curves"))?.value ?? "none";
  last.partial = partial;
  last.curves = curves;
  const path = truePath(shape);
  const total = pathLength(path, shape.closed);
  const count = stationSpots(total, partial).length;
  if (count > MAX_STATIONS) return void toast(`That is ${count.toLocaleString()} stations, more than the ${MAX_STATIONS.toLocaleString()} one line can take: make the partial interval longer.`, "info");

  const units = s.doc.info.units;
  const metric = !IMPERIAL.has(unitLabel(units));
  const scale = layer.scale || 1;
  const look = {
    style: "triangle",
    bubble: "none",
    markSize: MARK_MM * scale,
    markOffset: { x: 0, y: 0 },
    markRotation: 0,
    textHeight: TEXT_MM * scale,
    margin: scale,
    cornerRadius: scale,
    position: "auto",
    leader: true,
  } as const;
  const stations = stationsAlong(path, shape.closed, partial);
  const pieces: Part[][] = stations.map((st) => markerParts(stake(st.at, null, [stationName(st.along, metric)], look)));
  const found = curves === "none" ? [] : curvesOf(shape, path);
  // a worksheet is made from one the drawing has; without one the data is drawn instead
  const noSheet = curves === "table" && found.length > 0 && !s.doc.resources().some((r) => r.kind === "worksheet");
  if (curves === "labels" || noSheet) found.forEach((c, i) => pieces.push(curveParts(c, i + 1, scale, metric)));
  addPieces("Station on Polyline", pieces);
  const sheet = curves === "table" && found.length > 0 && !noSheet ? curveSheet(found, metric) : null;
  const of = found.length ? `, ${found.length} ${found.length === 1 ? "curve" : "curves"}` : curves === "none" ? "" : ", no circular curves";
  toast(
    `${stations.length} ${stations.length === 1 ? "station" : "stations"} over ${formatLength(total, units)}${of}${sheet !== null ? ", listed in a worksheet" : ""}.${noSheet ? " This drawing has no worksheet to make one from, so the curve data is drawn at the curves." : ""}`,
    "info",
  );
}
