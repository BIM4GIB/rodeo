// Modify > Drafting Aids > Arc into Segments…, Even Divide… and Line into Segments…, as Vectorworks
// Fundamentals has them.
//
// Arc into Segments draws each selected arc, circle or oval again as straight segments of equal
// length along it, by their number or the longest a segment may be, as one polygon or as separate
// lines; the arcs stay. Line into Segments divides each selected line into equal segments, placing
// loci at the points between them, breaking it into lines, or both, and keeps the line or not.
// Even Divide splits each selected line, circular arc or circle into a number of equal lines or
// arcs, and each rectangle into a grid of equal rectangles (turned as it is), keeping the original
// or not; a kept original can stay selected with the parts.
// What is made takes the object's class and attributes and sits just above it, and ends up
// selected. The dialogs keep their last settings while the page is open.

import type { NewShape, Pt, Shape } from "../core/index.ts";
import { attempt, setSelection, turnAbout } from "./commands.ts";
import { h } from "./dom.ts";
import { ellipsePoints } from "./geom.ts";
import { showDialog } from "./menubar.ts";
import { arcRadii, isFullArc } from "./shapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** the most segments one object is divided into */
const MAX_SEGMENTS = 10000;
/** samples per full turn when measuring along an oval */
const SAMPLES_PER_TURN = 1440;

type ArcBy = "count" | "length";
type ArcMake = "polygon" | "lines";

let lastArc: { by: ArcBy; count: number; length: number; make: ArcMake } = { by: "count", count: 8, length: 0, make: "polygon" };
let lastLine = { count: 2, loci: true, divide: false, keep: true };
let lastEven = { count: 2, across: 2, up: 1, keep: false, leaveSelected: false };

/** The selected objects whose shape is `kind`, with it. */
function selectedShapes(kind: Shape["kind"]): { id: string; shape: Shape }[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return [...store.selection].flatMap((id) => {
    const shape = doc.object(id)?.shape;
    return shape?.kind === kind ? [{ id, shape }] : [];
  });
}

export function canArcIntoSegments(): boolean {
  return selectedShapes("arc").some(({ shape }) => !!arcRadii(shape));
}

export function canLineIntoSegments(): boolean {
  return selectedShapes("line").length > 0;
}

/** An arc's length and a point `along` it (0 at its start to its length at its end), measured on a fine sampling. */
function arcMeasure(shape: Shape): { length: number; at: (along: number) => Pt } | null {
  const c = shape.center;
  const r = arcRadii(shape);
  if (!c || !r || !(r.rx > 0 && r.ry > 0)) return null;
  const sweep = isFullArc(shape) ? 360 : (shape.sweepAngle ?? 0);
  if (!(Math.abs(sweep) > 0)) return null;
  const pts = ellipsePoints(c, r.rx, r.ry, shape.startAngle ?? 0, sweep, Math.max(8, Math.ceil((SAMPLES_PER_TURN * Math.abs(sweep)) / 360)));
  const run = [0];
  for (let i = 1; i < pts.length; i++) run.push(run[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const length = run.at(-1)!;
  const at = (along: number): Pt => {
    let lo = 0;
    let hi = run.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (run[mid] <= along) lo = mid;
      else hi = mid;
    }
    const span = run[hi] - run[lo];
    const t = span > 0 ? Math.min(1, Math.max(0, (along - run[lo]) / span)) : 0;
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * t, y: pts[lo].y + (pts[hi].y - pts[lo].y) * t };
  };
  return { length, at };
}

/** The points dividing `shape` into `n` segments of equal length along it: n + 1 of them, the last a full turn's first again. */
function arcDivisions(shape: Shape, n: number): Pt[] | null {
  const m = arcMeasure(shape);
  if (!m) return null;
  const pts = Array.from({ length: n + 1 }, (_, i) => m.at((m.length * i) / n));
  if (isFullArc(shape)) pts[n] = pts[0];
  return pts;
}

/** `pts` as one polygon (closed when it ends where it starts) or a line per segment. */
function segmentShapes(pts: Pt[], make: ArcMake): NewShape[] {
  const closed = pts.length > 3 && pts[0] === pts.at(-1);
  if (make === "polygon") return [{ kind: "polygon", points: closed ? pts.slice(0, -1) : pts, closed }];
  return pts.slice(1).map((b, i): NewShape => ({ kind: "line", a: pts[i], b }));
}

/** A whole number field with its label. */
function countField(label: string, value: number): { input: HTMLInputElement; row: HTMLElement } {
  const input = h("input", { cls: "menu-dialog-input", value: String(value), attrs: { type: "text", inputmode: "numeric", "aria-label": label } });
  return { input, row: h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input) };
}

function readCount(input: HTMLInputElement, min: number): number | null {
  const n = Number(input.value.trim());
  return Number.isInteger(n) && n >= min && n <= MAX_SEGMENTS ? n : null;
}

/** For each object, what replaces a copy of it (or it, when `keep` is false), in one undo step; the new ids. */
function makeFrom(label: string, made: { id: string; shapes: NewShape[] }[], keep: boolean): string[] | null {
  const r = attempt(label, (s) =>
    s.batch(() =>
      made.flatMap(({ id, shapes }) => {
        // a copy takes the object's place in the stacking, class and attributes, just above it
        const target = keep ? s.duplicateObjects([id], 0, 0) : [id];
        return s.replaceObjects(target, shapes);
      }),
    ),
  );
  return r ? r.value : null;
}

export async function arcIntoSegmentsDialog(): Promise<void> {
  const arcs = selectedShapes("arc").filter(({ shape }) => !!arcMeasure(shape));
  if (!arcs.length) {
    toast("Arc into Segments works on arcs, circles and ovals: select them first.", "info");
    return;
  }
  const units = store.session?.doc.info.units;
  const suffix = lengthSuffix(units);
  const radio = (name: string, value: string, checked: boolean, label: string) => {
    const input = h("input", { checked, attrs: { type: "radio", name, value } });
    return { input, row: h("label", { cls: "menu-dialog-check" }, input, label) };
  };
  const byCount = radio("arc-by", "count", lastArc.by === "count", "Number of segments");
  const byLength = radio("arc-by", "length", lastArc.by === "length", "Segment length");
  const count = countField("Segments", lastArc.count);
  const length = h("input", {
    cls: "menu-dialog-input",
    value: formatLengthValue(lastArc.length, units),
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Longest segment" },
  });
  const lengthRow = h(
    "label",
    { cls: "menu-dialog-field" },
    h("span", { cls: "menu-dialog-label", text: "Longest segment" }),
    length,
    suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null,
  );
  const asPolygon = radio("arc-make", "polygon", lastArc.make === "polygon", "Draw a polygon");
  const asLines = radio("arc-make", "lines", lastArc.make === "lines", "Draw lines");
  const sync = (): void => {
    count.input.disabled = !byCount.input.checked;
    length.disabled = !byLength.input.checked;
  };
  for (const r of [byCount, byLength]) r.input.addEventListener("change", sync);
  sync();
  const n = arcs.length;
  const v = await showDialog<{ by: ArcBy; count: number; length: number; make: ArcMake }>({
    title: "Arc into Segments",
    okLabel: "Segment",
    body: [
      h("p", {
        cls: "muted",
        text: `Draws ${n} selected arc${n === 1 ? "" : "s"}, circle${n === 1 ? "" : "s"} or oval${n === 1 ? "" : "s"} again as straight segments of equal length along ${n === 1 ? "it" : "them"}, in ${n === 1 ? "its" : "their"} class and attributes. The arcs stay.`,
      }),
      byCount.row,
      count.row,
      byLength.row,
      lengthRow,
      asPolygon.row,
      asLines.row,
    ],
    check: () => {
      const make: ArcMake = asLines.input.checked ? "lines" : "polygon";
      if (byCount.input.checked) {
        const c = readCount(count.input, 1);
        if (c === null) return { error: `Segments: enter a whole number from 1 to ${MAX_SEGMENTS}.`, focus: count.input };
        return { value: { by: "count", count: c, length: lastArc.length, make } };
      }
      // typed lengths are read in the document's units; the session takes millimetres
      const mm = parseLength(length.value, units);
      if (mm === null || !(mm > 0)) return { error: "Longest segment: enter a length above 0.", focus: length };
      return { value: { by: "length", count: lastArc.count, length: mm, make } };
    },
  });
  if (!v) return;
  lastArc = v;
  const made: { id: string; shapes: NewShape[] }[] = [];
  for (const { id, shape } of arcs) {
    const m = arcMeasure(shape)!;
    const segments = v.by === "count" ? v.count : Math.max(1, Math.ceil(m.length / v.length - 1e-9));
    if (segments > MAX_SEGMENTS) {
      toast(`That length would cut an arc into more than ${MAX_SEGMENTS} segments: give a longer one.`, "error");
      return;
    }
    // a full turn needs three sides to close
    const pts = arcDivisions(shape, isFullArc(shape) ? Math.max(3, segments) : segments);
    if (pts) made.push({ id, shapes: segmentShapes(pts, v.make) });
  }
  const ids = makeFrom("Arc into Segments", made, true);
  if (!ids) return;
  setSelection(ids);
  const what = v.make === "polygon" ? `${ids.length} polygon${ids.length === 1 ? "" : "s"}` : `${ids.length} line${ids.length === 1 ? "" : "s"}`;
  toast(`Drew ${what} along ${n} arc${n === 1 ? "" : "s"}.`, "info");
}

export async function lineIntoSegmentsDialog(): Promise<void> {
  const lines = selectedShapes("line").filter(({ shape }) => shape.points.length >= 2);
  if (!lines.length) {
    toast("Line into Segments works on lines: select them first.", "info");
    return;
  }
  const check = (label: string, checked: boolean) => {
    const input = h("input", { checked, attrs: { type: "checkbox" } });
    return { input, row: h("label", { cls: "menu-dialog-check" }, input, label) };
  };
  const count = countField("Segments", lastLine.count);
  const loci = check("Place loci between the segments", lastLine.loci);
  const divide = check("Break the line into segments", lastLine.divide);
  const keep = check("Leave the original intact", lastLine.keep);
  const n = lines.length;
  const v = await showDialog<typeof lastLine>({
    title: "Line into Segments",
    okLabel: "Divide",
    body: [
      h("p", { cls: "muted", text: `Divides ${n} selected line${n === 1 ? "" : "s"} into segments of equal length.` }),
      count.row,
      loci.row,
      divide.row,
      keep.row,
    ],
    check: () => {
      const c = readCount(count.input, 2);
      if (c === null) return { error: `Segments: enter a whole number from 2 to ${MAX_SEGMENTS}.`, focus: count.input };
      if (!loci.input.checked && !divide.input.checked) return { error: "Choose loci, segments or both.", focus: loci.input };
      return { value: { count: c, loci: loci.input.checked, divide: divide.input.checked, keep: keep.input.checked } };
    },
  });
  if (!v) return;
  lastLine = v;
  const made = lines.map(({ id, shape }) => {
    const [a, b] = shape.points;
    const pts = Array.from({ length: v.count + 1 }, (_, i): Pt => (i === v.count ? b : { x: a.x + ((b.x - a.x) * i) / v.count, y: a.y + ((b.y - a.y) * i) / v.count }));
    const shapes: NewShape[] = [
      ...(v.divide ? pts.slice(1).map((q, i): NewShape => ({ kind: "line", a: pts[i], b: q })) : []),
      ...(v.loci ? pts.slice(1, -1).map((at): NewShape => ({ kind: "locus", at })) : []),
    ];
    return { id, shapes };
  });
  const ids = makeFrom("Line into Segments", made, v.keep);
  if (!ids) return;
  setSelection(ids);
  const parts = [
    v.divide ? `${n * v.count} segment${n * v.count === 1 ? "" : "s"}` : "",
    v.loci ? `${n * (v.count - 1)} loc${n * (v.count - 1) === 1 ? "us" : "i"}` : "",
  ].filter(Boolean);
  toast(`Made ${parts.join(" and ")} from ${n} line${n === 1 ? "" : "s"}${v.keep ? "" : ", which went"}.`, "info");
}

/** What Even Divide splits: a line, a circular arc or circle, or a rectangle. */
type Divisible = { id: string; shape: Shape; kind: "line" | "arc" | "rect" };

function selectedDivisible(): Divisible[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return [...store.selection].flatMap((id): Divisible[] => {
    const shape = doc.object(id)?.shape;
    if (shape?.kind === "line" && shape.points.length >= 2) return [{ id, shape, kind: "line" }];
    if (shape?.kind === "rect" && shape.points.length === 4) return [{ id, shape, kind: "rect" }];
    const r = shape?.kind === "arc" ? arcRadii(shape) : null;
    // ovals aren't divided: Vectorworks divides lines, arcs, circles and rectangles
    if (shape && r && r.rx > 0 && Math.abs(r.rx - r.ry) <= 1e-9 * r.rx && shape.center) return [{ id, shape, kind: "arc" }];
    return [];
  });
}

export function canEvenDivide(): boolean {
  return selectedDivisible().length > 0;
}

/** `shape` (a line or circular arc) as `n` equal lines or arcs, in its direction. */
function evenParts(d: Divisible, n: number): NewShape[] {
  const s = d.shape;
  if (d.kind === "line") {
    const [a, b] = s.points;
    const at = (i: number): Pt => (i === n ? b : { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
    return Array.from({ length: n }, (_, i): NewShape => ({ kind: "line", a: at(i), b: at(i + 1) }));
  }
  const sweep = isFullArc(s) ? 360 : (s.sweepAngle ?? 0);
  const start = s.startAngle ?? 0;
  return Array.from({ length: n }, (_, i): NewShape => ({
    kind: "arc",
    center: s.center!,
    radius: s.rx!,
    startAngle: (((start + (sweep * i) / n) % 360) + 360) % 360,
    sweepAngle: sweep / n,
  }));
}

/**
 * A rectangle as `across` × `up` equal rectangles, drawn square to the axes from its first corner,
 * and the turn (degrees, counter-clockwise about that corner) that sets them as it lies.
 */
function rectParts(shape: Shape, across: number, up: number): { shapes: NewShape[]; turn: number; about: Pt } {
  const [p0, p1, , p3] = shape.points;
  const w = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const ht = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const turn = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
  const shapes: NewShape[] = [];
  for (let j = 0; j < up; j++) {
    for (let i = 0; i < across; i++) {
      shapes.push({ kind: "rect", x0: p0.x + (w * i) / across, y0: p0.y + (ht * j) / up, x1: p0.x + (w * (i + 1)) / across, y1: p0.y + (ht * (j + 1)) / up });
    }
  }
  return { shapes, turn, about: p0 };
}

/** Modify > Drafting Aids > Even Divide…: asks how many parts, then splits the selection into them. */
export async function evenDivideDialog(): Promise<void> {
  const objects = selectedDivisible();
  if (!objects.length) {
    toast("Even Divide splits lines, arcs, circles and rectangles: select them first.", "info");
    return;
  }
  const hasCurves = objects.some((o) => o.kind !== "rect");
  const hasRects = objects.some((o) => o.kind === "rect");
  const check = (label: string, checked: boolean) => {
    const input = h("input", { checked, attrs: { type: "checkbox" } });
    return { input, row: h("label", { cls: "menu-dialog-check" }, input, label) };
  };
  const count = countField("Number of divisions", lastEven.count);
  const across = countField("Divisions in width", lastEven.across);
  const up = countField("Divisions in height", lastEven.up);
  const keep = check("Retain the original", lastEven.keep);
  const leave = check("Leave the original selected", lastEven.leaveSelected);
  const sync = (): void => {
    leave.input.disabled = !keep.input.checked;
  };
  keep.input.addEventListener("change", sync);
  sync();
  const n = objects.length;
  const v = await showDialog<typeof lastEven>({
    title: "Even Divide",
    okLabel: "Divide",
    body: [
      h("p", { cls: "muted", text: `Splits ${n} selected object${n === 1 ? "" : "s"} into equal parts, in ${n === 1 ? "its" : "their"} class and attributes.` }),
      ...(hasCurves ? [count.row] : []),
      ...(hasRects ? [across.row, up.row] : []),
      keep.row,
      leave.row,
    ],
    check: () => {
      const c = hasCurves ? readCount(count.input, 2) : lastEven.count;
      if (c === null) return { error: `Number of divisions: enter a whole number from 2 to ${MAX_SEGMENTS}.`, focus: count.input };
      const w = hasRects ? readCount(across.input, 1) : lastEven.across;
      if (w === null) return { error: `Divisions in width: enter a whole number from 1 to ${MAX_SEGMENTS}.`, focus: across.input };
      const ht = hasRects ? readCount(up.input, 1) : lastEven.up;
      if (ht === null) return { error: `Divisions in height: enter a whole number from 1 to ${MAX_SEGMENTS}.`, focus: up.input };
      if (hasRects && w * ht < 2) return { error: "Give a rectangle more than one division across its width or height.", focus: across.input };
      if (hasRects && w * ht > MAX_SEGMENTS) return { error: `That would make more than ${MAX_SEGMENTS} rectangles from one.`, focus: across.input };
      return { value: { count: c, across: w, up: ht, keep: keep.input.checked, leaveSelected: keep.input.checked && leave.input.checked } };
    },
  });
  if (!v) return;
  lastEven = v;
  const r = attempt("Even Divide", (s) =>
    s.batch(() =>
      objects.flatMap((o) => {
        // the parts take the object's place in the stacking, class and attributes (a copy's, when it stays)
        const target = v.keep ? s.duplicateObjects([o.id], 0, 0) : [o.id];
        if (o.kind !== "rect") return s.replaceObjects(target, evenParts(o, v.count));
        const { shapes, turn, about } = rectParts(o.shape, v.across, v.up);
        const ids = s.replaceObjects(target, shapes);
        if (Math.abs(turn) > 1e-9) s.transformObjects(ids, turnAbout(about, turn));
        return ids;
      }),
    ),
  );
  if (!r) return;
  setSelection(v.leaveSelected ? [...objects.map((o) => o.id), ...r.value] : r.value);
  toast(`Divided ${n} object${n === 1 ? "" : "s"} into ${r.value.length} part${r.value.length === 1 ? "" : "s"}${v.keep ? "" : ", in place of the original" + (n === 1 ? "" : "s")}.`, "info");
}

