// Modify > Join > Join and Fillet, as Vectorworks has it for two sets of double lines: four selected
// lines, two parallel pairs that aren't parallel to each other, are joined with rounded corners at
// the fillet radius the Fillet tool shares (asked for first in Fillet Settings when none has been
// set). Where both double lines end at their meeting they make an L: the inner lines meet in a
// fillet of the radius and the outer ones in one larger by the double lines' width. Where one runs
// on past the other they make a T: each line of the one that ends rounds into the near line of the
// other, which opens between the two fillets. Each line keeps its class and attributes, its fillet
// arc taking them too. One undo step.

import type { NewShape, ObjectInfo, Pt } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { pathOf } from "./cutting.ts";
import { filletRadius, filletRadiusChosen, setFilletRadius } from "./filletRadius.ts";
import { dist, filletLines, intersectLines, unitVector, type Fillet, type LineSeg } from "./geom.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";

const LABEL = "Join and Fillet";
const NEEDS = "Join and Fillet needs two double lines selected: four lines, two parallel pairs that aren't parallel to each other.";
/** sines this small are parallel */
const PARALLEL = 1e-6;

interface Line {
  readonly id: string;
  readonly seg: LineSeg;
}

/** One double line: its two lines, its direction and the distance between them. */
interface DoubleLine {
  readonly lines: readonly [Line, Line];
  readonly u: Pt;
  readonly width: number;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const mid = (l: Line): Pt => ({ x: (l.seg.a.x + l.seg.b.x) / 2, y: (l.seg.a.y + l.seg.b.y) / 2 });

/** The four selected lines of the edit scope, or null. */
function selectedLines(): Line[] | null {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size !== 4) return null;
  const scope = store.editGroupId;
  const four = s.doc.objects(layerId).filter((o) => store.selection.has(o.id) && o.parentId === scope && !isDerivedId(o.id));
  const lines = four.map(lineOf);
  return lines.length === 4 && lines.every((l): l is Line => l !== null) ? lines : null;
}

function lineOf(o: ObjectInfo): Line | null {
  const path = o.shape ? pathOf(o.shape) : null;
  if (path?.kind !== "chain" || path.source !== "line" || path.pts.length !== 2) return null;
  const [a, b] = path.pts;
  return Math.hypot(b.x - a.x, b.y - a.y) > 0 ? { id: o.id, seg: { a, b } } : null;
}

/** The two lines as a double line, when they're parallel and apart. */
function doubleLine(p: Line, q: Line): DoubleLine | null {
  const u = unitVector(p.seg.a, p.seg.b);
  if (Math.abs(cross(u, unitVector(q.seg.a, q.seg.b))) > PARALLEL) return null;
  const width = Math.abs(cross(u, sub(q.seg.a, p.seg.a)));
  return width > 0 ? { lines: [p, q], u, width } : null;
}

/** The four lines paired into two double lines that aren't parallel to each other. */
function doubleLines(lines: readonly Line[]): [DoubleLine, DoubleLine] | null {
  for (const [i, j, k, l] of [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]]) {
    const a = doubleLine(lines[i], lines[j]);
    const b = doubleLine(lines[k], lines[l]);
    if (a && b && Math.abs(cross(a.u, b.u)) > PARALLEL) return [a, b];
  }
  return null;
}

export function canJoinFillet(): boolean {
  const lines = selectedLines();
  return lines !== null && doubleLines(lines) !== null;
}

/** Where a double line's middle runs: a point on it. */
function middleOf(d: DoubleLine): Pt {
  const [p, q] = d.lines;
  const t = dot(sub(q.seg.a, p.seg.a), d.u);
  const foot = { x: p.seg.a.x + d.u.x * t, y: p.seg.a.y + d.u.y * t };
  return { x: (foot.x + q.seg.a.x) / 2, y: (foot.y + q.seg.a.y) / 2 };
}

/** How far a double line reaches either way along `u` from `at`. */
function reach(d: DoubleLine, at: Pt): { lo: number; hi: number } {
  const ts = d.lines.flatMap((l) => [l.seg.a, l.seg.b]).map((p) => dot(sub(p, at), d.u));
  return { lo: Math.min(...ts), hi: Math.max(...ts) };
}

/** The end of `l` furthest along `d`. */
function farEnd(l: Line, d: Pt): Pt {
  return dot(l.seg.a, d) > dot(l.seg.b, d) ? l.seg.a : l.seg.b;
}

/** The line of `d` further along `toward` from `at`: the inner one of a corner, the near one of a tee. */
function lineToward(d: DoubleLine, at: Pt, toward: Pt): [Line, Line] {
  const [p, q] = d.lines;
  return dot(sub(mid(p), at), toward) >= dot(sub(mid(q), at), toward) ? [p, q] : [q, p];
}

/** Whether a fillet's trimmed line still runs to `far`: a radius too big for the line moves that end instead. */
const keeps = (seg: LineSeg, far: Pt): boolean => dist(seg.a, far) < 1e-9 || dist(seg.b, far) < 1e-9;

const arcOf = (f: Fillet): NewShape => ({ kind: "arc", center: f.centre, radius: f.radius, startAngle: f.startAngle, sweepAngle: f.sweepAngle });
const lineShape = (s: LineSeg): NewShape => ({ kind: "line", a: s.a, b: s.b });

/** What joining the two double lines with fillets of `r` makes of each line, or why it can't. */
export function joinFilletPlan(a: DoubleLine, b: DoubleLine, r: number): Map<string, NewShape[]> | string {
  const at = intersectLines(middleOf(a), a.u, middleOf(b), b.u);
  if (!at) return NEEDS;
  const ra = reach(a, at);
  const rb = reach(b, at);
  // a double line runs past the other when it goes on beyond it, a width or more, on both sides
  const pastA = ra.lo < -b.width && ra.hi > b.width;
  const pastB = rb.lo < -a.width && rb.hi > a.width;
  if (pastA && pastB) return "Those double lines cross: Join and Fillet makes an L or a T where one ends at the other.";
  const misfit = "The fillet radius doesn't fit these double lines: set a smaller one with the Fillet tool's preferences.";
  const out = new Map<string, NewShape[]>();
  const away = (d: DoubleLine, rr: { lo: number; hi: number }): Pt => (rr.hi >= -rr.lo ? d.u : { x: -d.u.x, y: -d.u.y });
  if (!pastA && !pastB) {
    // an L: inner lines round at r, outer ones a width further out
    const da = away(a, ra);
    const db = away(b, rb);
    const [aIn, aOut] = lineToward(a, at, db);
    const [bIn, bOut] = lineToward(b, at, da);
    const ends = [farEnd(aIn, da), farEnd(bIn, db), farEnd(aOut, da), farEnd(bOut, db)];
    const inner = filletLines(aIn.seg, ends[0], bIn.seg, ends[1], r);
    const outer = filletLines(aOut.seg, ends[2], bOut.seg, ends[3], r + (a.width + b.width) / 2);
    if (!inner || !outer || ![inner.line1, inner.line2, outer.line1, outer.line2].every((l, i) => keeps(l, ends[i]))) return misfit;
    out.set(aIn.id, [lineShape(inner.line1), arcOf(inner)]);
    out.set(bIn.id, [lineShape(inner.line2)]);
    out.set(aOut.id, [lineShape(outer.line1), arcOf(outer)]);
    out.set(bOut.id, [lineShape(outer.line2)]);
    return out;
  }
  // a T: the stem's lines round into the near line of the one running past, which opens between them
  const [through, stem, rs] = pastA ? [a, b, rb] : [b, a, ra];
  const ds = away(stem, rs);
  const [near] = lineToward(through, at, ds);
  const crossings = stem.lines.map((s) => intersectLines(s.seg.a, stem.u, near.seg.a, through.u));
  if (!crossings[0] || !crossings[1]) return NEEDS;
  const pieces: LineSeg[] = [];
  for (const k of [0, 1] as const) {
    const s = stem.lines[k];
    const here = crossings[k]!;
    const side = dot(sub(here, crossings[1 - k]!), through.u) >= 0 ? through.u : { x: -through.u.x, y: -through.u.y };
    const f = filletLines(s.seg, farEnd(s, ds), near.seg, { x: here.x + side.x, y: here.y + side.y }, r);
    if (!f || !keeps(f.line1, farEnd(s, ds))) return misfit;
    if (!keeps(f.line2, farEnd(near, side))) return "The double line the other meets doesn't run on past the fillets: make it longer, or the fillet radius smaller.";
    out.set(s.id, [lineShape(f.line1), arcOf(f)]);
    pieces.push(f.line2);
  }
  out.set(near.id, pieces.map(lineShape));
  return out;
}

/** Modify > Join > Join and Fillet. */
export async function joinAndFillet(): Promise<void> {
  const lines = selectedLines();
  const pair = lines ? doubleLines(lines) : null;
  if (!pair) {
    toast(NEEDS, "info");
    return;
  }
  if (!filletRadiusChosen()) {
    const v = await toolPrefs("Fillet Settings", [{ kind: "length", key: "radius", label: "Fillet Radius", value: filletRadius() }]);
    if (!v) return;
    if (!(v.num("radius") > 0)) {
      toast("Enter a fillet radius greater than 0.", "info");
      return;
    }
    setFilletRadius(v.num("radius"));
  }
  const plan = joinFilletPlan(pair[0], pair[1], filletRadius());
  if (typeof plan === "string") {
    toast(plan, "info");
    return;
  }
  attempt(LABEL, (s) =>
    s.batch(() => {
      for (const [id, shapes] of plan) s.replaceObjects([id], shapes);
    }),
  );
}
