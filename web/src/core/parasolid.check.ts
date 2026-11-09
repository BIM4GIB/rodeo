// Checks the Parasolid faces of solids whose edges don't make all their faces (parasolid.ts, and the
// edge test in model3d.ts bodyGeometry), with a fake mesher. Run from web/:
//   npx tsx src/core/parasolid.check.ts
// With VW_DEMOS set to the folder of public demo drawings (or to one .vwx in it) it also opens each .vwx there, read only, and
// prints what the pass does to its bodies: with cadmpeg (web/vendor/cadmpeg-xt) it decodes them, else
// it only counts them. Nothing is written.
// The synthetic bodies: a square of four edges (its two triangles make all its faces, so it is not
// decoded), the same square with a stray edge off its plane (its faces are not all made, so it waits),
// and a body that is no solid (a sweep's, not decoded).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { loadXtMesherNode } from "../convert/xtNode.ts";
import { setF64, setU16, setU32 } from "./bytes.ts";
import { blankDrawing } from "./blank.ts";
import { TOKEN, tokenOf } from "./held.ts";
import { bodySections } from "./encode.ts";
import { Model } from "./model.ts";
import { bodyGeometry } from "./model3d.ts";
import { type Box, XT_ANGLE_DEG, XT_BATCH, XT_CHORD_REL, XT_MAX_TRIANGLES, XT_MORE_AREA, applyXt, cancelXt, drainXt, facesArea, fitXt, meshJobs, parasolidGeneration, pendingXt, waitingXt, xtFaces, xtScale, type XtMesher } from "./parasolid.ts";
import type { Rec } from "./records.ts";
import type { Mesh3D } from "./types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const DIRECTORY = 0x5a;
const BASE = 0x60;
const SEC_XT = 19;

/**
 * A type-114 body's data: its sections (id, bytes) after the directory, laid out as bodySections
 * reads them. Offsets count from BASE, and the directory (16 slots from DIRECTORY) reaches past it,
 * so the sections start after the directory, as edgesBody lays them out.
 */
function bodyData(sections: [number, Uint8Array][]): Uint8Array {
  const first = DIRECTORY + 6 * 16;
  const size = first + sections.reduce((n, [, b]) => n + b.length, 0);
  const d = new Uint8Array(size);
  setU16(d, DIRECTORY, sections.length);
  setU32(d, DIRECTORY + 2, size - BASE);
  for (let i = 1; i < 16; i++) setU16(d, DIRECTORY + 6 * i, 0xffff);
  let at = first;
  sections.forEach(([id, bytes], i) => {
    setU16(d, DIRECTORY + 6 * (i + 1), id);
    setU32(d, DIRECTORY + 6 * (i + 1) + 2, at - BASE);
    d.set(bytes, at);
    at += bytes.length;
  });
  return d;
}

function f64s(values: number[]): Uint8Array {
  const b = new Uint8Array(8 * values.length);
  values.forEach((v, i) => setF64(b, 8 * i, v));
  return b;
}

/** A wire of straight edges as a body keeps it: section 0 two points per edge, section 14 one two-point run per edge. */
function wire(edges: [number[], number[]][]): [number, Uint8Array][] {
  const lines = new Uint8Array(6 * edges.length);
  edges.forEach((_, i) => {
    setU16(lines, 6 * i, 2);
    setU32(lines, 6 * i + 2, 2 * i);
  });
  return [
    [0, f64s(edges.flatMap(([a, b]) => [...a, ...b]))],
    [14, lines],
  ];
}

/** The twelve triangles of the axis-aligned box from `lo` to `hi`, nine numbers each. */
function boxTriangles(lo: number[], hi: number[]): Float64Array {
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const c = (x: number, y: number, z: number): number[] => [x, y, z];
  const quads = [
    [c(x0, y0, z0), c(x1, y0, z0), c(x1, y1, z0), c(x0, y1, z0)],
    [c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)],
    [c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, z1), c(x0, y0, z1)],
    [c(x1, y0, z0), c(x1, y1, z0), c(x1, y1, z1), c(x1, y0, z1)],
    [c(x1, y1, z0), c(x0, y1, z0), c(x0, y1, z1), c(x1, y1, z1)],
    [c(x0, y1, z0), c(x0, y0, z0), c(x0, y0, z1), c(x0, y1, z1)],
  ];
  return Float64Array.from(quads.flatMap(([a, b, d, e]) => [...a, ...b, ...d, ...a, ...d, ...e]));
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
const rec = (data: Uint8Array): Rec => ({ data }) as unknown as Rec;
// the drawing the synthetic bodies are in
const owner = new Model(blankDrawing("mm"), "blank.vwx");

// the square of four edges, on z = 0, a metre across
const corners = [
  [0, 0, 0],
  [1000, 0, 0],
  [1000, 1000, 0],
  [0, 1000, 0],
];
const square: [number[], number[]][] = corners.map((c, i) => [c, corners[(i + 1) % 4]]);
// an edge off the square's plane, its ends on no face
const stray: [number[], number[]][] = [[[500, 500, 200], [500, 800, 200]]];
const XT = new Uint8Array(16).fill(7);
/** the body's box: the square and the stray edge's points */
const BOX: Box = { min: [0, 0, 0], max: [1000, 1000, 200] };
const TENTH = boxTriangles([0, 0, 0], [100, 100, 20]);

console.log("-- scale fit");
{
  const fit = fitXt(TENTH, BOX);
  check(fit !== null && Math.max(...Array.from(fit).filter((_, i) => i % 3 === 0)) === 1000, "a mesh a tenth of the body's size is scaled up by ten onto its points' box");
  const hundredth = fitXt(boxTriangles([0, 0, 0], [10, 10, 2]), BOX);
  check(hundredth !== null && Math.max(...Array.from(hundredth).filter((_, i) => i % 3 === 0)) === 1000, "a mesh a hundredth of the size is scaled by one hundred");
  check(fitXt(boxTriangles([0, 0, 0], [1000, 1000, 200]), BOX) !== null, "a mesh already at the body's size is kept as it is");
  check(fitXt(boxTriangles([50, 0, 0], [150, 100, 20]), BOX) === null, "a mesh whose box is off by 5% of the diagonal is refused");
  check(fitXt(boxTriangles([0, 0, 0], [1000 / 3, 1000 / 3, 200 / 3]), BOX) === null, "a mesh a third of the size (no power of ten) is refused");
  check(fitXt(boxTriangles([0, 0, Number.NaN], [100, 100, 20]), BOX) === null, "a mesh with a NaN corner is refused");
  check(fitXt(new Float64Array(0), BOX) === null, "an empty mesh is refused");
  check(XT_MAX_TRIANGLES === 50_000 && XT_CHORD_REL === 0.002 && XT_ANGLE_DEG === 20 && XT_BATCH === 50, "the settings are 0.002, 20 degrees, 50,000 triangles and 50 bodies a batch");
}

console.log("-- edge coverage and queueing");
const faced = bodyData([...wire(square), [SEC_XT, XT]]);
const plain = bodyData(wire(square));
const open = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
const sweep = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
const facedGeo = bodyGeometry(rec(faced), owner);
const plainGeo = bodyGeometry(rec(plain), owner);
check(waitingXt() === 0, "a body whose edges make all its faces is not queued");
check(facedGeo !== null && plainGeo !== null && same(facedGeo.triangles, plainGeo.triangles) && facedGeo.triangles.length === 18, "a faced body comes out as it did before (the square's two triangles)");
const openGeo = bodyGeometry(rec(open), owner);
check(waitingXt() === 1, "a body with a stray edge and section 19 waits for its faces");
check(openGeo !== null && openGeo.triangles.length === 18 && openGeo.edges.length === 5 * 6, "it keeps the faces its edges make, and all five edges");
check(bodyGeometry(rec(sweep), null) !== null && waitingXt() === 1, "a body that is a sweep's is not queued");

console.log("-- the worker's round trip");
const jobs = pendingXt();
check(jobs.length === 1 && jobs[0].xt.length === XT.length && jobs[0].owner === owner, "the waiting body goes out with its section 19 bytes and its drawing");
check(jobs[0].area === 1_000_000 && facesArea(TENTH) === 2 * (100 * 100 + 100 * 20 + 100 * 20), "it carries the area of the faces its edges make (the square's, a square metre)");
const gen0 = parasolidGeneration();
const first = applyXt([{ id: jobs[0].id, triangles: TENTH, report: JSON.stringify({ refused: 2 }) }]);
check(first.faces === 1 && first.refused === 2 && parasolidGeneration() === gen0 + 1, "a fitted mesh is kept, its refused faces counted, and the generation moves");
const decoded = bodyGeometry(rec(open), owner);
check(decoded !== null && decoded.triangles.length === 12 * 9 && same(decoded.edges, openGeo!.edges), "the body now takes its decoded faces, and its edges stay the same");
check(waitingXt() === 0, "nothing waits after the faces arrive");
{
  // a big drawing's Parasolid data left in its file (held.ts): the body queues with its token, which the decoder reads back
  const token = new Uint8Array(TOKEN);
  token.set(new TextEncoder().encode("RodeoHLD"));
  setU32(token, 8, 7);
  setU32(token, 12, 3);
  setU32(token, 16, 90_000);
  const held = bodyData([...wire([...square, ...stray]), [SEC_XT, token]]);
  bodyGeometry(rec(held), owner);
  const queued = pendingXt().find((j) => j.data === held);
  const ref = queued ? tokenOf(queued.xt) : null;
  check(ref !== null && ref.table === 7 && ref.index === 3 && ref.length === 90_000, "a body whose Parasolid data is held in the file queues with its token, which names the part");
  check(tokenOf(XT) === null && tokenOf(new Uint8Array(TOKEN)) === null, "data that isn't a token names nothing");
  cancelXt();
}

console.log("-- rejected results");
const off = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
bodyGeometry(rec(off), owner);
const offJob = pendingXt()[0];
const outOfBox = applyXt([{ id: offJob.id, triangles: boxTriangles([50, 0, 0], [150, 100, 20]) }]);
check(outOfBox.box === 1 && outOfBox.faces === 0 && xtFaces(off) === null, "a result off its box is stored as refused, not kept");
check((bodyGeometry(rec(off), owner)?.triangles.length ?? 0) === 18 && waitingXt() === 0, "the body keeps its edge faces and is not queued again");
const huge = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
bodyGeometry(rec(huge), owner);
const hugeJob = pendingXt()[0];
const tooBig = applyXt([{ id: hugeJob.id, triangles: new Float64Array((XT_MAX_TRIANGLES + 1) * 9) }]);
check(tooBig.size === 1 && tooBig.faces === 0, "a mesh of more than 50,000 triangles is refused");
const capped = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
bodyGeometry(rec(capped), owner);
const cappedJob = pendingXt()[0];
const overCap = applyXt([{ id: cappedJob.id, triangles: null, error: `more than ${XT_MAX_TRIANGLES} triangles` }]);
check(overCap.size === 1 && overCap.none === 0 && xtFaces(capped) === null, "a mesher that stops at the cap (its error says so) counts as too big, not as nothing meshed");
const nothing = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
bodyGeometry(rec(nothing), owner);
const nothingJob = pendingXt()[0];
const noMesh = applyXt([{ id: nothingJob.id, triangles: null, error: "no face tessellates" }]);
check(noMesh.none === 1 && xtFaces(nothing) === null, "a body that meshes to nothing keeps its edge faces");
const nanBody = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
bodyGeometry(rec(nanBody), owner);
const nanJob = pendingXt()[0];
const nan = applyXt([{ id: nanJob.id, triangles: boxTriangles([0, 0, Number.NaN], [100, 100, 20]) }]);
check(nan.box === 1 && xtFaces(nanBody) === null, "a mesh with a NaN corner is refused as off its box");
// the square at a tenth, and a triangle of no area out to the stray edge so the box fits
const reach = [50, 50, 20, 50, 80, 20, 50, 80, 20];
const squareMesh = Float64Array.from([0, 0, 0, 100, 0, 0, 100, 100, 0, 0, 0, 0, 100, 100, 0, 0, 100, 0, ...reach]);
const halfMesh = Float64Array.from([0, 0, 0, 100, 0, 0, 100, 100, 0, ...reach]);
check(XT_MORE_AREA === 1.01, "decoded faces must cover 1% more than the edges' faces");
const sameBody = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
bodyGeometry(rec(sameBody), owner);
const sameJob = pendingXt()[0];
const sameArea = applyXt([{ id: sameJob.id, triangles: squareMesh }]);
check(sameArea.same === 1 && sameArea.faces === 0 && xtFaces(sameBody) === null, "a mesh covering the same area as the edges' faces (the same faces, finer) is not kept");
check((bodyGeometry(rec(sameBody), owner)?.triangles.length ?? 0) === 18 && waitingXt() === 0, "the body keeps its edge faces and is not queued again");
const lessBody = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
bodyGeometry(rec(lessBody), owner);
const lessJob = pendingXt()[0];
const lessArea = applyXt([{ id: lessJob.id, triangles: halfMesh }]);
check(lessArea.same === 1 && lessArea.faces === 0 && xtFaces(lessBody) === null, "a mesh covering less (cadmpeg left faces out) is not kept");

console.log("-- drawings that close, and batches");
const gone = new Model(blankDrawing("mm"), "blank.vwx");
const closing = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
bodyGeometry(rec(closing), gone);
const closingJob = pendingXt()[0];
cancelXt(gone);
const late = applyXt([{ id: closingJob.id, triangles: TENTH }]);
check(late.faces === 0 && xtFaces(closing) === undefined, "a result for a closed drawing's body is ignored");

const batch = [1, 2, 3].map(() => bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]));
for (const d of batch) bodyGeometry(rec(d), owner);
const calls: [number, number, number, number][] = [];
const mesher: XtMesher = {
  mesh(xt, chord, angle, cap) {
    calls.push([chord, angle, xt.length, cap]);
    return TENTH;
  },
  report: () => JSON.stringify({ faces: 12, tessellated: 12, refused: 1, triangles: 12, reasons: [] }),
};
const drained = drainXt(mesher);
check(drained.faces === 3 && drained.refused === 3 && waitingXt() === 0, "drain meshes every waiting body and stores its faces");
check(calls.length === 3 && calls.every(([c, a, n, cap]) => c === 0.002 && a === 20 && n === XT.length && cap === 50_000), "each body is meshed at 0.002 and 20 degrees, capped at 50,000 triangles, with its own section 19 bytes");
const throwing: XtMesher = {
  mesh() {
    throw new Error("does not decode");
  },
  report: () => "{}",
};
const thrown = bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]);
bodyGeometry(rec(thrown), owner);
const failed = drainXt(throwing);
check(failed.none === 1 && xtFaces(thrown) === null, "a mesher that throws leaves that body with its edge faces");

console.log("-- traps (cadmpeg is built with panic = abort)");
{
  // a trap fails its body and the rest of its batch; only the trapped body says so
  const trapping: XtMesher = {
    mesh() {
      throw new WebAssembly.RuntimeError("unreachable");
    },
    report: () => "{}",
  };
  cancelXt();
  const three = [1, 2, 3].map(() => bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]));
  for (const d of three) bodyGeometry(rec(d), owner);
  const results = meshJobs(pendingXt(), trapping);
  check(results[0].trap === true && results.slice(1).every((r) => r.triangles === null && r.trap === undefined), "a trap fails its body and the rest of its batch, and only its body says trap");
  const trapApplied = applyXt(results);
  check(trapApplied.trapped === 1 && trapApplied.none === 3 && three.every((d) => xtFaces(d) === null), "the trapped batch keeps every body's edge faces and is not queued again");
  // drain stops at a trap: the batches not yet sent stay waiting, and drain throws
  const many = Array.from({ length: XT_BATCH + 10 }, () => bodyData([...wire([...square, ...stray]), [SEC_XT, XT]]));
  for (const d of many) bodyGeometry(rec(d), owner);
  let threw = false;
  try {
    drainXt(trapping);
  } catch {
    threw = true;
  }
  check(threw && waitingXt() === 10, "a trap in drain stops the batches: the bodies not yet sent stay waiting, and drain throws");
  cancelXt();
}

// VW_DEMOS: the public demo drawings, read only
function vwxFiles(dir: string): string[] {
  if (statSync(dir).isFile()) return [dir];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".vwx") && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => join(dir, f));
}

/** The type-114 bodies with section 19, once each: a record can be reached through more than one parent. */
function xtBodies(recs: readonly Rec[], seen = new Map<Uint8Array, Rec>()): Rec[] {
  for (const r of recs) {
    if (r.type === 114 && bodySections(r.data)?.has(SEC_XT) && !seen.has(r.data)) seen.set(r.data, r);
    xtBodies(r.children, seen);
  }
  return [...seen.values()];
}

function triangles(meshes: readonly Mesh3D[]): number {
  return meshes.reduce((n, m) => n + m.triangles.length / 9, 0);
}

interface Slow {
  ms: number;
  file: string;
  id: number;
  xtBytes: number;
  triangles: string;
  scale: string;
  outcome: string;
}

async function demos(target: string): Promise<void> {
  let mesher: XtMesher | null = null;
  try {
    mesher = await loadXtMesherNode();
  } catch (err) {
    console.log(`no cadmpeg mesher (${err instanceof Error ? err.message : String(err)}): the bodies are counted, not decoded`);
  }
  const tally = new Map<string, { accepted: number; box: number; none: number; size: number; same: number }>();
  const slow: Slow[] = [];
  // a trap leaves the mesher unusable: the drawing it hit stops, and so do the drawings after it
  let poisoned = false;
  for (const file of vwxFiles(target)) {
    const started = performance.now();
    const rel = file === target ? basename(file) : file.slice(target.length + 1);
    if (poisoned) {
      console.log(`${rel}: not decoded, cadmpeg trapped on an earlier drawing`);
      continue;
    }
    const doc = new Model(new Uint8Array(readFileSync(file)), basename(file));
    const withXt = xtBodies(doc.recs).length;
    const before = triangles(doc.model3d());
    const unfaced = waitingXt();
    const got = { faces: 0, box: 0, size: 0, none: 0, same: 0, refused: 0, trapped: 0 };
    let decodeMs = 0;
    if (mesher) {
      // one body at a time, so each one's time is its own
      for (let jobs = pendingXt(XT_BATCH); jobs.length && !poisoned; jobs = pendingXt(XT_BATCH)) {
        for (const job of jobs) {
          const t = performance.now();
          const [result] = meshJobs([job], mesher);
          const ms = performance.now() - t;
          decodeMs += ms;
          const scale = result.triangles ? xtScale(result.triangles, job.box) : NaN;
          const a = applyXt([result]);
          got.faces += a.faces;
          got.box += a.box;
          got.size += a.size;
          got.none += a.none;
          got.same += a.same;
          got.refused += a.refused;
          got.trapped += a.trapped;
          const outcome = a.faces ? "accepted" : a.box ? "box" : a.size ? "size" : a.same ? "same" : "none";
          const key = Number.isNaN(scale) ? "no size" : String(scale);
          const row = tally.get(key) ?? { accepted: 0, box: 0, none: 0, size: 0, same: 0 };
          if (outcome === "accepted") row.accepted++;
          else if (outcome === "box") row.box++;
          else if (outcome === "size") row.size++;
          else if (outcome === "same") row.same++;
          else row.none++;
          tally.set(key, row);
          const tris = result.triangles ? String(result.triangles.length / 9) : outcome === "size" ? `over ${XT_MAX_TRIANGLES}` : "0";
          slow.push({ ms, file: rel, id: job.id, xtBytes: job.xt.length, triangles: tris, scale: key, outcome });
          if (a.trapped) {
            console.log(`${rel}: cadmpeg trapped on body #${job.id}; the rest of this drawing is not decoded`);
            poisoned = true;
            break;
          }
        }
      }
    }
    const after = triangles(doc.model3d());
    const decoded = got.faces + got.box + got.size + got.none + got.same;
    console.log(
      `${rel}: ${withXt} bodies with section 19, ${unfaced} unfaced before, decoded ${decoded}, accepted ${got.faces}, rejected (scale/bbox) ${got.box}` +
        `, rejected (size) ${got.size}, no more area than the edges' faces ${got.same}, no mesh ${got.none}, refused ${got.refused} faces, trapped ${got.trapped}, decode ${Math.round(decodeMs)} ms, total ${Math.round(performance.now() - started)} ms` +
        `; triangles ${before} before, ${after} after`,
    );
    cancelXt(doc);
  }
  if (tally.size) {
    console.log("scale factors (power of ten; accepted / rejected by box / over the size limit / no more area / nothing meshed):");
    const all = (r: { accepted: number; box: number; none: number; size: number; same: number }): number => r.accepted + r.box + r.size + r.same + r.none;
    for (const [key, row] of [...tally].sort((a, b) => all(b[1]) - all(a[1]))) {
      console.log(`  ${key.padStart(8)}: ${row.accepted} / ${row.box} / ${row.size} / ${row.same} / ${row.none}`);
    }
  }
  if (slow.length) {
    console.log("slowest bodies (ms, file, body, section 19 bytes, triangles, scale, outcome):");
    for (const s of slow.sort((a, b) => b.ms - a.ms).slice(0, 8)) {
      console.log(`  ${Math.round(s.ms).toString().padStart(7)} ms  ${s.file}  #${s.id}  ${s.xtBytes} B  ${s.triangles} tris  scale ${s.scale}  ${s.outcome}`);
    }
  }
}

async function main(): Promise<void> {
  const folder = process.env.VW_DEMOS;
  if (folder) await demos(folder);
  console.log(failures ? `${failures} failed` : "all passed");
  process.exitCode = failures ? 1 : 0;
}

void main();
