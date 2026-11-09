// Checks the ACIS reader under Node. Run from web/:
//   npx tsx src/import/acis.check.ts
// A box and a cylinder are written here as SAT text, in the version 400 and version 700 layouts, placed
// by a body transform, and read back. Each body must chain its loops, close its shells (every edge of a
// closed shell is used by two coedges in opposite directions), put its edges' ends on their curves at
// the curve parameters and on the surfaces of the faces using them, and run each planar loop
// counterclockwise about its face's outward normal. With DWG_SAMPLES set to the folder of public DWG
// files, the 3DSOLID, REGION and BODY data of every DWG file is read the same way, and so is that of
// some DXF files beside them: SAT from the 2000 to 2010 files, SAB from the ACDSDATA section of the
// later ones. Each SAB solid must give the same model as its SAT twin.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseAcisReport, type AcisReport } from "./acis.ts";
import { dwgAcisObjects } from "./dwg.ts";
import { dxfAcisObjects } from "./dxf.ts";
import { boxText, cylinderText, placed } from "./acis.fixture.ts";
import type { BrepBody, BrepCurve, BrepEdge, BrepFace, BrepSurface, V3 } from "./brep.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// ---- vectors and the curves and surfaces the checks measure against ----------------------------

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => scale(a, 1 / len(a));
const dist = (a: V3, b: V3): number => len(sub(a, b));

/** A point on a curve at parameter t. Lines run origin + t·dir; ellipses center + major·cos t + (normal × major)·ratio·sin t. */
function curvePoint(c: BrepCurve, t: number): V3 | null {
  if (c.kind === "line") return add(c.origin, scale(c.dir, t));
  if (c.kind === "ellipse") {
    const minor = scale(cross(c.normal, c.major), c.ratio);
    return add(add(c.center, scale(c.major, Math.cos(t))), scale(minor, Math.sin(t)));
  }
  return null;
}

/** The distance from p to a curve, measured at the parameter of p's nearest point; null where not known. */
function curveDistance(c: BrepCurve, p: V3): number | null {
  if (c.kind === "line") {
    const d = sub(p, c.origin);
    return len(sub(d, scale(c.dir, dot(d, c.dir) / dot(c.dir, c.dir))));
  }
  if (c.kind === "ellipse") {
    const minor = scale(cross(c.normal, c.major), c.ratio);
    const d = sub(p, c.center);
    const t = Math.atan2(dot(d, minor) / dot(minor, minor), dot(d, c.major) / dot(c.major, c.major));
    const q = curvePoint(c, t);
    return q === null ? null : dist(p, q);
  }
  return null;
}

/** The distance from p to a surface, or null for a kind this check does not measure (nurbs, torus-free unknowns). */
function surfaceDistance(s: BrepSurface, p: V3): number | null {
  switch (s.kind) {
    case "plane":
      return Math.abs(dot(sub(p, s.origin), s.normal));
    case "cone": {
      if (s.ratio !== 1 || s.cosHalf === 0) return null;
      const axis = unit(s.axis);
      const d = sub(p, s.origin);
      const h = dot(d, axis);
      const rho = len(sub(d, scale(axis, h)));
      const r = len(s.major) + (h * s.sinHalf) / s.cosHalf;
      return Math.abs(rho - r) * s.cosHalf;
    }
    case "sphere":
      return Math.abs(dist(p, s.center) - s.radius);
    default:
      return null;
  }
}

/** The outward normal of a face at p, for the surface kinds whose normal this check knows. */
function outwardAt(f: BrepFace, p: V3): V3 | null {
  const sign = f.reversed ? -1 : 1;
  const s = f.surface;
  if (s.kind === "plane") return scale(s.normal, sign);
  if (s.kind === "cone" && s.ratio === 1) {
    const axis = unit(s.axis);
    const d = sub(p, s.origin);
    const radial = sub(d, scale(axis, dot(d, axis)));
    return scale(sub(scale(unit(radial), s.cosHalf), scale(axis, s.sinHalf)), sign);
  }
  if (s.kind === "sphere") return scale(unit(sub(p, s.center)), sign);
  return null;
}

// ---- checking one body ------------------------------------------------------------------------

const coStart = (c: { readonly reversed: boolean; readonly edge: BrepEdge }): V3 => (c.reversed ? c.edge.end : c.edge.start);
const coEnd = (c: { readonly reversed: boolean; readonly edge: BrepEdge }): V3 => (c.reversed ? c.edge.start : c.edge.end);

/** Points along one coedge in its own direction: a line's two ends, an ellipse sampled between its parameters. */
function coedgeSamples(c: { readonly reversed: boolean; readonly edge: BrepEdge }, steps: number): V3[] {
  const e = c.edge;
  if (!e.curve || (e.curve.kind !== "line" && e.curve.kind !== "ellipse")) return [coStart(c)];
  const pts: V3[] = [];
  for (let i = 0; i < steps; i++) {
    const t = e.t0 + ((e.t1 - e.t0) * i) / steps;
    const p = curvePoint(e.curve, t);
    if (p !== null) pts.push(p);
  }
  if (c.reversed) pts.reverse();
  return pts;
}

/** The oriented polygon a loop traces: its coedges' samples in order. */
function loopPolygon(coedges: readonly { readonly reversed: boolean; readonly edge: BrepEdge }[]): V3[] {
  const pts: V3[] = [];
  for (const c of coedges) pts.push(...coedgeSamples(c, 24));
  return pts;
}

/** The Newell vector of a closed polygon: its length is twice the area, its direction the right-hand normal of the loop. */
function newell(pts: readonly V3[]): V3 {
  let n: V3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) n = add(n, cross(pts[i], pts[(i + 1) % pts.length]));
  return n;
}

interface Tally {
  readonly faces: Record<string, number>;
  readonly edges: Record<string, number>;
  readonly unknown: string[];
  readonly problems: string[];
  vertices: number;
  closed: number;
  open: number;
  /** checks that were not made because the kind is not one this check measures */
  unchecked: number;
  /** curved faces whose outward normal points towards the body's centre */
  inward: number;
}

function checkBody(body: BrepBody, label: string): Tally {
  const t: Tally = { faces: {}, edges: {}, unknown: [], problems: [], vertices: 0, closed: 0, open: 0, unchecked: 0, inward: 0 };
  const faces: BrepFace[] = body.shells.flatMap((s) => s.faces);
  const edges = new Set<BrepEdge>();
  const usesOf = new Map<BrepEdge, BrepFace[]>();
  for (const f of faces) {
    for (const l of f.loops) {
      for (const c of l.coedges) {
        edges.add(c.edge);
        usesOf.set(c.edge, [...(usesOf.get(c.edge) ?? []), f]);
      }
    }
  }
  let lo: V3 = [Infinity, Infinity, Infinity];
  let hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const e of edges) {
    for (const p of [e.start, e.end]) {
      lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1]), Math.min(lo[2], p[2])];
      hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1]), Math.max(hi[2], p[2])];
    }
  }
  const size = edges.size > 0 ? dist(lo, hi) : 1;
  const tol = 1e-6 * size;

  for (const f of faces) {
    t.faces[f.surface.kind] = (t.faces[f.surface.kind] ?? 0) + 1;
    if (f.surface.kind === "unknown") t.unknown.push(f.surface.name);
  }
  for (const e of edges) {
    const kind = e.curve ? e.curve.kind : "none";
    t.edges[kind] = (t.edges[kind] ?? 0) + 1;
    if (e.curve?.kind === "unknown") t.unknown.push(e.curve.name);
  }

  // Loops chain: each coedge ends where the next one starts.
  for (const f of faces) {
    for (const l of f.loops) {
      const n = l.coedges.length;
      for (let k = 0; k < n; k++) {
        if (dist(coEnd(l.coedges[k]), coStart(l.coedges[(k + 1) % n])) > tol) t.problems.push(`${label}: loop breaks after coedge ${k}`);
      }
    }
  }

  // Shells close: in a closed shell every edge is used by two coedges running in opposite directions.
  for (const shell of body.shells) {
    const senses = new Map<BrepEdge, boolean[]>();
    for (const f of shell.faces) {
      for (const l of f.loops) for (const c of l.coedges) senses.set(c.edge, [...(senses.get(c.edge) ?? []), c.reversed]);
    }
    let closed = true;
    for (const rs of senses.values()) if (rs.length !== 2 || rs[0] === rs[1]) closed = false;
    if (closed) t.closed++;
    else t.open++;
  }

  // Edges: the parameters take each end to its vertex, and each end lies on its curve and on the surfaces of the faces using it.
  for (const e of edges) {
    if (!e.curve) continue;
    const p0 = curvePoint(e.curve, e.t0);
    const p1 = curvePoint(e.curve, e.t1);
    if (p0 === null || p1 === null) {
      t.unchecked++;
      continue;
    }
    if (dist(p0, e.start) > tol || dist(p1, e.end) > tol) t.problems.push(`${label}: edge parameters ${e.t0}..${e.t1} miss their ends`);
    for (const p of [e.start, e.end]) {
      const d = curveDistance(e.curve, p);
      if (d !== null && d > tol) t.problems.push(`${label}: edge end ${p.map((x) => +x.toFixed(6))} is ${d} off its curve`);
      for (const f of usesOf.get(e) ?? []) {
        const sd = surfaceDistance(f.surface, p);
        if (sd === null) t.unchecked++;
        else if (sd > tol) t.problems.push(`${label}: edge end ${p.map((x) => +x.toFixed(6))} is ${sd} off a surface`);
      }
    }
  }

  // Faces: a planar loop runs counterclockwise about the outward normal (the outer loop one way, holes the
  // other). A curved face's outward normal points away from the body's centre only where it is convex, so
  // the ones that point towards it (holes, and the inside of a bend) are counted, not failed.
  const sampled: V3[] = [];
  for (const e of edges) if (e.curve) sampled.push(...coedgeSamples({ reversed: false, edge: e }, 8));
  const centre = sampled.length > 0 ? scale(sampled.reduce((a, p) => add(a, p), [0, 0, 0] as V3), 1 / sampled.length) : ([0, 0, 0] as V3);
  for (const f of faces) {
    if (f.surface.kind === "plane") {
      const out = outwardAt(f, [0, 0, 0]);
      if (out === null) continue;
      const signs = f.loops.map((l) => dot(newell(loopPolygon(l.coedges)), out));
      if (signs.length === 0) continue;
      let outer = 0;
      for (let i = 1; i < signs.length; i++) if (Math.abs(signs[i]) > Math.abs(signs[outer])) outer = i;
      const ok = signs[outer] > 0 && signs.every((s, i) => (i === outer ? s > 0 : s < 0) || Math.abs(s) < 1e-12);
      if (!ok) t.problems.push(`${label}: a plane face's loops do not run about its outward normal (${signs.map((s) => s.toExponential(2)).join(", ")})`);
    } else if (f.loops.length > 0 && f.loops[0].coedges.length > 0) {
      const first = f.loops[0].coedges[0];
      const mid = coedgeSamples(first, 2)[0];
      const out = outwardAt(f, mid);
      if (out === null) {
        t.unchecked++;
        continue;
      }
      if (dot(out, sub(mid, centre)) <= 0) t.inward++;
    }
  }

  // Vertices: distinct ends of the edges, merged within the tolerance.
  const ends: V3[] = [];
  for (const e of edges) for (const p of [e.start, e.end]) if (!ends.some((q) => dist(p, q) <= tol)) ends.push(p);
  t.vertices = ends.length;
  return t;
}

function show(t: Tally): string {
  const kinds = (o: Record<string, number>) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  return `faces ${kinds(t.faces)}; edges ${kinds(t.edges)}; vertices ${t.vertices}; closed shells ${t.closed}, open ${t.open}${t.inward ? `; ${t.inward} curved faces face the centre` : ""}`;
}

// ---- the handwritten solids ------------------------------------------------------------------------

function expectNear(actual: readonly V3[], expected: readonly V3[], what: string): void {
  const ok = actual.length === expected.length && expected.every((e) => actual.some((a) => dist(a, e) < 1e-9));
  check(ok, what);
}

for (const version of [400, 700]) {
  const bodies = parseAcisReport(new TextEncoder().encode(boxText(version)));
  check(bodies.failed.length === 0 && bodies.bodies.length === 1, `box, version ${version}: one body reads (${bodies.failed.map((f) => f.reason).join("; ")})`);
  const box = bodies.bodies[0];
  if (box) {
    const t = checkBody(box, `box ${version}`);
    check(t.problems.length === 0, `box, version ${version}: topology and geometry hold ${t.problems.slice(0, 3).join("; ")}`);
    check(t.faces.plane === 6 && t.edges.line === 12 && t.vertices === 8 && t.closed === 1 && t.open === 0, `box, version ${version}: 6 planes, 12 lines, 8 vertices, one closed shell (${show(t)})`);
    const corners: V3[] = [];
    for (let i = 0; i < 8; i++) corners.push(placed([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]));
    const ends: V3[] = [];
    for (const f of box.shells[0].faces) for (const l of f.loops) for (const c of l.coedges) ends.push(c.edge.start, c.edge.end);
    expectNear(ends.filter((p, i) => ends.findIndex((q) => dist(p, q) < 1e-9) === i), corners, `box, version ${version}: its corners are the box's corners under the transform`);
  }
}

for (const version of [400, 700]) {
  const bodies = parseAcisReport(new TextEncoder().encode(cylinderText(version)));
  check(bodies.failed.length === 0 && bodies.bodies.length === 1, `cylinder, version ${version}: one body reads (${bodies.failed.map((f) => f.reason).join("; ")})`);
  const cyl = bodies.bodies[0];
  if (cyl) {
    const t = checkBody(cyl, `cylinder ${version}`);
    check(t.problems.length === 0, `cylinder, version ${version}: topology and geometry hold ${t.problems.slice(0, 3).join("; ")}`);
    check(t.faces.cone === 1 && t.faces.plane === 2 && t.edges.ellipse === 2 && t.edges.line === 1 && t.vertices === 2 && t.closed === 1, `cylinder, version ${version}: 1 cone, 2 planes, 2 circles, 1 seam, 2 vertices, closed (${show(t)})`);
    check(t.unchecked === 0, `cylinder, version ${version}: every cone and ellipse measure (${t.unchecked} unchecked)`);
    expectNear([placed([1, 0, 0]), placed([1, 0, 2])], [[10, 21, 30], [10, 21, 32]], `cylinder, version ${version}: the seam ends land at (10,21,30) and (10,21,32)`);
  }
}

// ---- the corpus ----------------------------------------------------------------------------------

/** The solids of a DXF file that hold ACIS data, as the DXF reader gives them. */
function solidsOf(path: string): { type: string; handle: string; bytes: Uint8Array }[] {
  return dxfAcisObjects(readFileSync(path, "latin1")).flatMap((o) => (o.data ? [{ type: o.type, handle: o.handle, bytes: o.data }] : []));
}

/** Whether two models are the same, with the numbers equal within tol. */
function sameModel(a: unknown, b: unknown, tol: number): boolean {
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b) || Math.abs(a - b) <= tol || (Number.isNaN(a) && Number.isNaN(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameModel(x, b[i], tol));
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = Object.keys(ra);
    return keys.length === Object.keys(rb).length && keys.every((k) => sameModel(ra[k], rb[k], tol));
  }
  return a === b;
}

/** The same bytes with the other binary signature spelling, or null when they open with neither. Both spellings are 15 bytes. */
function otherSignature(bytes: Uint8Array): Uint8Array | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 15));
  const other = head.startsWith("ACIS BinaryFile") ? "ASM BinaryFile4" : head.startsWith("ASM BinaryFile") ? "ACIS BinaryFile" : null;
  if (other === null) return null;
  const copy = bytes.slice();
  copy.set(new TextEncoder().encode(other), 0);
  return copy;
}

function summarize(name: string, report: AcisReport): void {
  check(report.failed.length === 0, `${name}: every body reads (${report.failed.map((f) => `#${f.record} ${f.reason}`).join("; ") || "all read"})`);
  for (const body of report.bodies) {
    const t = checkBody(body, name);
    console.log(`     ${name} ACIS ${report.version} ${report.form.toUpperCase()}: ${show(t)}${t.unknown.length ? `; unknown ${[...new Set(t.unknown)].join(", ")}` : ""}`);
    check(t.problems.length === 0, `${name}: topology and geometry hold ${t.problems.slice(0, 3).join("; ")}`);
  }
}

const dwgSamples = process.env.DWG_SAMPLES;
if (dwgSamples) {
  const root = dwgSamples.startsWith("~/") ? join(homedir(), dwgSamples.slice(2)) : dwgSamples;
  const files = [
    "libredwg/test/test-data/2000/TS1.dxf",
    "acadsharp/samples/sample_AC1015_ascii.dxf",
    "acadsharp/samples/sample_AC1018_ascii.dxf",
    "acadsharp/samples/sample_AC1021_ascii.dxf",
    "acadsharp/samples/sample_AC1024_ascii.dxf",
    "libredwg/test/test-data/2018/TS1.dxf",
    "acadsharp/samples/sample_AC1027_ascii.dxf",
    "acadsharp/samples/sample_AC1032_ascii.dxf",
  ];
  const models = new Map<string, AcisReport>();
  for (const f of files) {
    const path = join(root, f);
    const name = f.split("/").pop() ?? f;
    const solids = solidsOf(path);
    check(solids.length > 0, `${name}: has solids to read (${solids.length})`);
    for (const s of solids) {
      const report = parseAcisReport(s.bytes);
      models.set(`${f} ${s.type} ${s.handle}`, report);
      summarize(`${name} ${s.type} ${s.handle}`, report);
      // the other spelling of the binary signature (both are 15 bytes) must read to the same model
      const other = otherSignature(s.bytes);
      if (report.form === "sab" && other !== null) {
        const again = parseAcisReport(other);
        check(again.form === "sab" && again.failed.length === report.failed.length && sameModel(again.bodies, report.bodies, 1e-9), `${name} ${s.type} ${s.handle}: the other binary signature reads to the same model`);
      }
    }
  }
  // every solid, region and body of every DWG file, as the DWG reader gives its data
  const dwgs: string[] = [];
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.dwg$/i.test(n)) dwgs.push(p);
    }
  };
  walk(root);
  let dwgSolids = 0;
  for (const path of dwgs) {
    let objects: ReturnType<typeof dwgAcisObjects>;
    try {
      objects = dwgAcisObjects(new Uint8Array(readFileSync(path)));
    } catch {
      continue; // files from before R13 and the like, which dwg.check.ts covers
    }
    const name = path.slice(root.length + 1);
    for (const o of objects) {
      if (!o.data) continue;
      dwgSolids++;
      summarize(`${name} ${o.type} ${o.handle}`, parseAcisReport(o.data));
    }
  }
  check(dwgSolids > 0, `${dwgSolids} solids, regions and bodies of DWG files read`);
  // SAB twins: a SAT save and a SAB save of the same drawing must read to the same models, for every
  // solid handle the two share (the 2000 and 2018 TS1 files; the 2010 and 2013 and 2018 samples).
  const twinFiles: [string, string][] = [
    ["libredwg/test/test-data/2000/TS1.dxf", "libredwg/test/test-data/2018/TS1.dxf"],
    ["acadsharp/samples/sample_AC1024_ascii.dxf", "acadsharp/samples/sample_AC1027_ascii.dxf"],
    ["acadsharp/samples/sample_AC1024_ascii.dxf", "acadsharp/samples/sample_AC1032_ascii.dxf"],
  ];
  for (const [satFile, sabFile] of twinFiles) {
    let paired = 0;
    let same = true;
    for (const [key, a] of models) {
      if (!key.startsWith(`${satFile} `)) continue;
      const b = models.get(key.replace(`${satFile} `, `${sabFile} `));
      if (b === undefined) continue;
      paired++;
      if (!(a.bodies.length === b.bodies.length && a.bodies.every((x, i) => sameModel(x, b.bodies[i], 1e-9)))) same = false;
    }
    check(paired > 0 && same, `${sabFile} reads to the same models as ${satFile} (${paired} solids paired)`);
  }
}

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
