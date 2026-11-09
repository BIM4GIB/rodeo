// Faces for the solids whose own faces Rodeo can't rebuild from their cached edges. Vectorworks
// saves such a body's Parasolid data with its edges (section 19, a binary XT transmit file), and
// cadmpeg (WebAssembly, web/vendor/cadmpeg-xt) meshes it: in a browser the worker
// app/parasolid.worker.ts does that, driven by app/parasolidDecode.ts; on the command line
// convert/xtNode.ts does it in Node. This module is what they share: the bodies waiting, the faces
// that came back keyed by each body's record data, and a generation that moves whenever faces arrive
// so the 3D model is built again. model3d.ts queues a body whose edges don't make all of its faces
// and takes its faces from here once they are in. No DOM: it runs in Node and in browsers.
//
// cadmpeg's triangles are in its own unit. fitXt multiplies them by the power of ten that brings them
// to the body's section-0 points, and keeps them only when the two boxes agree. They then replace the
// edges' faces only where they cover more (XT_MORE_AREA): where they cover the same, they are the same
// faces made finer, and where they cover less, cadmpeg left faces out.

import type { Vec3 } from "./types.ts";

/** Mesh settings: chord tolerance as a share of the body's diagonal, and the largest angle between facets, degrees. */
export const XT_CHORD_REL = 0.002;
export const XT_ANGLE_DEG = 20;
/** A body that meshes to more triangles than this keeps its edges' faces: the mesher stops once the total passes it. */
export const XT_MAX_TRIANGLES = 50_000;
/** The error cadmpeg gives once a body passes XT_MAX_TRIANGLES; a body that gives it is too big. */
const OVER_CAP = /more than \d+ triangles/;
/** Bodies sent to the worker at a time. */
export const XT_BATCH = 50;
/** Decoded faces are kept only where their area is at least this many times the edges' faces' (finer curves add up to about 0.6%). */
export const XT_MORE_AREA = 1.01;
/** How far the decoded box may miss the points' box, as a share of the points' box diagonal. */
const BOX_TOL = 0.01;

/** A body's box in its own frame. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/** A body waiting for its faces: its record data (its key), its section 19 bytes, its section-0 box, the area of the faces its edges make, and the drawing it is in. */
export interface XtJob {
  id: number;
  data: Uint8Array;
  xt: Uint8Array;
  box: Box;
  area: number;
  owner: object;
}

/** cadmpeg's mesher: xt_mesh (which fails once the total passes maxTriangles), and xt_last_report for the call before. */
export interface XtMesher {
  mesh(xt: Uint8Array, chordRel: number, angleDeg: number, maxTriangles: number): Float64Array;
  report(): string;
}

/** What meshing one job gave: triangles in cadmpeg's unit (null when nothing meshed), cadmpeg's report as JSON, and why it failed. `trap` marks the body cadmpeg trapped on: its instance can't mesh again. */
export interface XtResult {
  id: number;
  triangles: Float64Array | null;
  report?: string;
  error?: string;
  trap?: boolean;
}

/** Page to worker: a batch of jobs, each with a copy of its section 19 bytes. */
export interface XtRequest {
  jobs: { id: number; xt: Uint8Array }[];
}

/** Worker to page: the batch's results, or why the worker could not mesh any of it. `restart` says cadmpeg trapped, so the worker must be replaced. */
export type XtReply = { type: "done"; results: XtResult[]; restart?: boolean } | { type: "error"; message: string };

/** What became of some bodies: faces kept, cut for their box, too big, with nothing meshed, or covering no more than the edges' faces; the faces cadmpeg refused; and the bodies cadmpeg trapped on. */
export interface XtApplied {
  faces: number;
  box: number;
  size: number;
  none: number;
  same: number;
  refused: number;
  trapped: number;
}

/** A WebAssembly trap: cadmpeg panicked (it is built with panic = "abort"), and its instance is unusable after. */
export function isTrap(err: unknown): boolean {
  return typeof WebAssembly !== "undefined" && err instanceof WebAssembly.RuntimeError;
}

/**
 * `mesher`, trapping again on every body after one it trapped on, for a thread that keeps one instance (the
 * command line, a page's converter): the instance is unusable after a trap and can't be started again there.
 */
export function stopsAfterTrap(mesher: XtMesher): XtMesher {
  let trapped = false;
  return {
    mesh(xt, chordRel, angleDeg, maxTriangles) {
      if (trapped) throw new WebAssembly.RuntimeError("cadmpeg stopped on an earlier solid; reload to read more");
      try {
        return mesher.mesh(xt, chordRel, angleDeg, maxTriangles);
      } catch (err) {
        if (isTrap(err)) trapped = true;
        throw err;
      }
    },
    report: () => mesher.report(),
  };
}

/** The decoded faces by body record data: triangles in Rodeo's millimetres, or null when they were refused. */
const faces = new WeakMap<Uint8Array, Float64Array | null>();
/** Bodies waiting or in flight, by record data, so none is queued twice. */
const queued = new Set<Uint8Array>();
let waiting: XtJob[] = [];
const inFlight = new Map<number, XtJob>();
let nextId = 1;
let generation = 0;
const arrivedListeners: ((bodies: Uint8Array[]) => void)[] = [];

/** A body's decoded faces: its triangles, null when they were refused, undefined when it has not been decoded. */
export function xtFaces(data: Uint8Array): Float64Array | null | undefined {
  return faces.get(data);
}

/** Puts a body in line for decoding, unless it is waiting, in flight or decoded already. */
export function queueXt(data: Uint8Array, xt: Uint8Array, box: Box, area: number, owner: object): void {
  if (queued.has(data) || faces.has(data)) return;
  queued.add(data);
  waiting.push({ id: nextId++, data, xt, box, area, owner });
}

/** How many bodies wait for the mesher, not counting those already sent to it. */
export function waitingXt(): number {
  return waiting.length;
}

/** Takes up to `max` waiting bodies for the mesher; they stay in flight until their results come back. */
export function pendingXt(max = Infinity): XtJob[] {
  const jobs = waiting.splice(0, max);
  for (const j of jobs) inFlight.set(j.id, j);
  return jobs;
}

/** Drops the bodies of `owner` (a drawing that has closed), or all of them: results still to come for them are ignored. */
export function cancelXt(owner?: object): void {
  const gone = (j: XtJob): boolean => owner === undefined || j.owner === owner;
  for (const j of waiting) if (gone(j)) queued.delete(j.data);
  waiting = waiting.filter((j) => !gone(j));
  for (const [id, j] of inFlight) {
    if (!gone(j)) continue;
    queued.delete(j.data);
    inFlight.delete(id);
  }
}

/** Moves whenever faces arrive, so a model built at an older generation is built again. */
export function parasolidGeneration(): number {
  return generation;
}

/** Calls `fn` with the bodies that got faces, each time some do. */
export function onXtFaces(fn: (bodies: Uint8Array[]) => void): void {
  arrivedListeners.push(fn);
}

/** The low and high corners of a mesh's triangles. */
function boundsOf(tris: Float64Array): { lo: number[]; hi: number[] } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    const k = i % 3;
    lo[k] = Math.min(lo[k], tris[i]);
    hi[k] = Math.max(hi[k], tris[i]);
  }
  return { lo, hi };
}

/** The diagonal of a box's extent, or NaN when it has none (NaN and infinities fail every test on it). */
function diagonal(lo: readonly number[], hi: readonly number[]): number {
  const d = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  return d > 0 && d < Infinity ? d : NaN;
}

/** The power of ten nearest the ratio of the body's box diagonal to the mesh's: the factor that takes the mesh to Rodeo's millimetres. NaN when either has no size. */
export function xtScale(tris: Float64Array, box: Box): number {
  const { lo, hi } = boundsOf(tris);
  const diagT = diagonal(lo, hi);
  const diagP = diagonal(box.min, box.max);
  if (Number.isNaN(diagT) || Number.isNaN(diagP)) return NaN;
  return 10 ** Math.round(Math.log10(diagP / diagT));
}

/**
 * cadmpeg's triangles in Rodeo's millimetres, or null. The triangles are scaled by xtScale, and the
 * scaled box must agree with the points' box within BOX_TOL of its diagonal at both corners.
 */
export function fitXt(tris: Float64Array, box: Box): Float64Array | null {
  if (tris.length < 9) return null;
  const scale = xtScale(tris, box);
  if (Number.isNaN(scale)) return null;
  const { lo, hi } = boundsOf(tris);
  const tol = BOX_TOL * diagonal(box.min, box.max);
  for (let k = 0; k < 3; k++) {
    if (!(Math.abs(lo[k] * scale - box.min[k]) <= tol && Math.abs(hi[k] * scale - box.max[k]) <= tol)) return null;
  }
  return scale === 1 ? tris : tris.map((v) => v * scale);
}

/** The refused faces in cadmpeg's report, 0 without one. */
function refusedOf(report: string | undefined): number {
  if (!report) return 0;
  try {
    const n = (JSON.parse(report) as { refused?: unknown }).refused;
    return typeof n === "number" ? n : 0;
  } catch {
    return 0;
  }
}

/** The area of triangles given as 9 numbers each. */
export function facesArea(t: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0; i + 8 < t.length; i += 9) {
    const ux = t[i + 3] - t[i];
    const uy = t[i + 4] - t[i + 1];
    const uz = t[i + 5] - t[i + 2];
    const vx = t[i + 6] - t[i];
    const vy = t[i + 7] - t[i + 1];
    const vz = t[i + 8] - t[i + 2];
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return a;
}

/**
 * Stores what meshing gave for the jobs in flight: each body's triangles fitted to its box, or null
 * for one that meshed to nothing, to too many triangles, or off its box. A result whose job was
 * cancelled is ignored. When faces arrive the generation moves and the listeners are told which bodies.
 */
export function applyXt(results: readonly XtResult[]): XtApplied {
  const out: XtApplied = { faces: 0, box: 0, size: 0, none: 0, same: 0, refused: 0, trapped: 0 };
  const arrived: Uint8Array[] = [];
  for (const r of results) {
    const job = inFlight.get(r.id);
    if (!job) continue;
    inFlight.delete(r.id);
    queued.delete(job.data);
    out.refused += refusedOf(r.report);
    if (r.trap) out.trapped++;
    let kept: Float64Array | null = null;
    const tooBig = OVER_CAP.test(r.error ?? "") || (r.triangles !== null && r.triangles.length / 9 > XT_MAX_TRIANGLES);
    if (tooBig) out.size++;
    else if (!r.triangles) out.none++;
    else {
      kept = fitXt(r.triangles, job.box);
      if (!kept) out.box++;
      else if (facesArea(kept) < job.area * XT_MORE_AREA) {
        kept = null;
        out.same++;
      }
    }
    faces.set(job.data, kept);
    if (kept) {
      out.faces++;
      arrived.push(job.data);
    }
  }
  if (arrived.length) {
    generation++;
    for (const fn of arrivedListeners) fn(arrived);
  }
  return out;
}

/**
 * Meshes each job with `mesher` at the settings above; a job that won't mesh gives no triangles, and why
 * (one past the cap says so). A trap fails its job and the rest of the batch (no triangles, not meshed),
 * and its job says `trap`: the mesher can't be used again.
 */
export function meshJobs(jobs: readonly { id: number; xt: Uint8Array }[], mesher: XtMesher): XtResult[] {
  const out: XtResult[] = [];
  let trapped = false;
  for (const job of jobs) {
    if (trapped) {
      out.push({ id: job.id, triangles: null, error: "not meshed: cadmpeg trapped on an earlier body in this batch" });
      continue;
    }
    try {
      const triangles = mesher.mesh(job.xt, XT_CHORD_REL, XT_ANGLE_DEG, XT_MAX_TRIANGLES);
      out.push({ id: job.id, triangles, report: mesher.report() });
    } catch (err) {
      const trap = isTrap(err);
      if (trap) trapped = true;
      out.push({ id: job.id, triangles: null, error: err instanceof Error ? err.message : String(err), ...(trap ? { trap } : {}) });
    }
  }
  return out;
}

/**
 * Meshes every waiting body on this thread, a batch at a time, and stores the faces: the command line and the
 * checks, which have no worker. After a trap nothing more is meshed: the bodies not yet sent stay waiting, and
 * this throws, since the mesher can't be started again here.
 */
export function drainXt(mesher: XtMesher): XtApplied {
  const total: XtApplied = { faces: 0, box: 0, size: 0, none: 0, same: 0, refused: 0, trapped: 0 };
  for (let jobs = pendingXt(XT_BATCH); jobs.length; jobs = pendingXt(XT_BATCH)) {
    const a = applyXt(meshJobs(jobs, mesher));
    total.faces += a.faces;
    total.box += a.box;
    total.size += a.size;
    total.none += a.none;
    total.same += a.same;
    total.refused += a.refused;
    total.trapped += a.trapped;
    if (a.trapped) throw new Error(`cadmpeg trapped on a body: ${waitingXt()} solid(s) were not meshed`);
  }
  return total;
}
