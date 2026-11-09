// Gives the 3D view the Parasolid faces of its solids (core/parasolid.ts). After a model is built,
// the bodies waiting for their faces go to the worker (parasolid.worker.ts) a batch at a time, one
// batch in flight. A big drawing leaves its Parasolid data in its file (core/held.ts): a batch's are
// read back before it goes, and a body whose data can't be read keeps its edges' faces. Each batch's faces are stored when it answers, and the 3D view is drawn again while
// faces keep coming, no oftener than every REDRAW_MS, or REDRAW_SHARE times as long as the last redraw
// took (a big drawing's whole 3D is built again each time), and at once after the last batch. The
// worker starts only when something waits. A worker whose batch reports a trap (cadmpeg's panic), or
// that doesn't answer within BATCH_MS (stuck on a body, or ended without an error), is terminated, its
// batch keeps the faces its edges make, and the next batch starts a new worker.

import { heldEntry, tokenOf } from "../core/held.ts";
import { applyXt, cancelXt, pendingXt, XT_BATCH, type XtJob, type XtReply, type XtRequest, type XtResult } from "../core/parasolid.ts";

/** The least time between redraws while faces keep arriving, ms. */
const REDRAW_MS = 1500;
/** Redraws while faces keep arriving are at least this many times as far apart as the last one took. */
const REDRAW_SHARE = 4;
/** The longest a batch may take, ms: Dover Dam's take about 15 s, its slowest body 12 s. */
const BATCH_MS = 120_000;

let worker: Worker | null = null;
/** the batch in flight, null when none is */
let batch: XtJob[] | null = null;
/** the redraw given to the last decodeWaitingXt, for a batch that starts after a drawing closes */
let redrawLater: (() => void) | null = null;
let lastDraw = 0;
let drawTimer = 0;
/** ends the batch in flight that doesn't answer */
let batchTimer = 0;
/** the least time until the next redraw while faces keep arriving, ms */
let gap = REDRAW_MS;

/**
 * Sends the waiting bodies to the worker, one batch at a time. `redraw` gives the 3D view the faces
 * that have arrived; it runs as they arrive, and after the last of them.
 */
export function decodeWaitingXt(redraw: () => void): void {
  redrawLater = redraw;
  if (batch) return;
  const jobs = pendingXt(XT_BATCH);
  if (!jobs.length) return;
  batch = jobs;
  void send(jobs, redraw);
}

/** Reads the batch's Parasolid data, held parts from the drawing's file, and sends what was read to the worker. */
async function send(jobs: XtJob[], redraw: () => void): Promise<void> {
  const read = await Promise.all(jobs.map((j) => xtBytes(j.xt).catch(() => null)));
  // stopped while reading (its drawing closed)
  if (batch !== jobs) return;
  const unread: XtResult[] = jobs.filter((_, i) => !read[i]).map((j) => ({ id: j.id, triangles: null, error: "its Parasolid data can't be read from the drawing's file" }));
  const request: XtRequest = { jobs: jobs.flatMap((j, i) => (read[i] ? [{ id: j.id, xt: read[i] }] : [])) };
  if (!request.jobs.length) {
    finish(unread, redraw);
    return;
  }
  const w = (worker ??= new Worker(new URL("./parasolid.worker.ts", import.meta.url), { type: "module" }));
  w.onmessage = (e: MessageEvent<XtReply>) => {
    const reply = e.data;
    // cadmpeg trapped, so this worker's instance is unusable: it goes, and the next batch starts a new one
    if (reply.type === "done" && reply.restart) {
      w.terminate();
      if (worker === w) worker = null;
    }
    finish([...unread, ...(reply.type === "done" ? reply.results : request.jobs.map((j) => ({ id: j.id, triangles: null })))], redraw);
  };
  // the worker failed, or doesn't answer: its batch keeps the faces its edges make, and the next batch starts a new worker
  const fail = (): void => {
    w.terminate();
    if (worker === w) worker = null;
    finish([...unread, ...request.jobs.map((j) => ({ id: j.id, triangles: null }))], redraw);
  };
  w.onerror = fail;
  batchTimer = window.setTimeout(fail, BATCH_MS);
  w.postMessage(request, request.jobs.map((j) => j.xt.buffer));
}

/** A body's Parasolid data as a copy of its own, to move to the worker: read back from the file when it was held there. */
async function xtBytes(xt: Uint8Array): Promise<Uint8Array> {
  const ref = tokenOf(xt);
  return (ref ? await heldEntry(ref).read() : xt).slice();
}

/**
 * Drops the waiting bodies of a drawing that has closed. Its batch in flight is stopped when it
 * holds nothing else; a batch shared with other drawings runs on, its results for this one ignored.
 */
export function stopDecodingXt(owner: object): void {
  cancelXt(owner);
  if (batch?.every((j) => j.owner === owner)) {
    worker?.terminate();
    worker = null;
    batch = null;
    clearTimeout(batchTimer);
    clearTimeout(drawTimer);
    drawTimer = 0;
    if (redrawLater) decodeWaitingXt(redrawLater);
  }
}

/** Stores a batch's faces, sends the next batch, and draws the faces: soon, or at once after the last batch. */
function finish(results: XtResult[], redraw: () => void): void {
  clearTimeout(batchTimer);
  batch = null;
  const arrived = applyXt(results).faces > 0;
  decodeWaitingXt(redraw);
  if (arrived || (!batch && drawTimer)) drawSoon(redraw, !batch);
}

/**
 * Draws the 3D view as faces arrive, `gap` after the last redraw (a redraw already on its way takes the
 * latest faces too), or at once when `last`.
 */
function drawSoon(redraw: () => void, last: boolean): void {
  if (last) {
    clearTimeout(drawTimer);
    drawTimer = 0;
    draw(redraw);
    return;
  }
  if (drawTimer) return;
  const wait = gap - (Date.now() - lastDraw);
  if (wait <= 0) {
    draw(redraw);
    return;
  }
  drawTimer = window.setTimeout(() => {
    drawTimer = 0;
    draw(redraw);
  }, wait);
}

/** Redraws, and keeps the next redraw at least REDRAW_SHARE times as far off as this one took. */
function draw(redraw: () => void): void {
  const started = performance.now();
  redraw();
  lastDraw = Date.now();
  gap = Math.max(REDRAW_MS, REDRAW_SHARE * (performance.now() - started));
}
