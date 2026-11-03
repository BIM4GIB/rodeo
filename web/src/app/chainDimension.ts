// The right-click menu's chain dimension commands, as Vectorworks has them: Delete Witness Line,
// Split Dimension, Edit Dimension and Add Dimension(s). A chain here is a group of linear dimension objects (the Dimension tool's
// Chain mode makes one when the drawing has a dimension to copy) whose dimension lines run along
// one line, each starting where the last ends. Where the right-click was says what it acts on: a
// witness line (one of the chain's points, out to its dimension line) or a dimension (its stretch
// of dimension line, or its value beside it).
//
// Delete Witness Line: the two dimensions either side of it become one, measuring both (its value
// measured again when it said its length, as Object Info has it); at an end, the end dimension goes.
// Split Dimension: at a witness line, two chains meeting there, the second selected; on a
// dimension, that dimension goes and the chains either side of it stay.
// Edit Dimension: the chain opened as Edit Group opens it, with that one dimension selected, so
// Object Info edits it alone.
// Add Dimension(s), on a chain or a linear dimension: each click (the Add Dimensions tool's) is
// where a new witness line ends, its dimension measuring along the chain's line to the witness
// line before or after it; one between two splits the dimension there in two (their values
// measured again as Delete Witness Line's are), one beyond an end adds a dimension there. A
// linear dimension becomes a chain of it and the new ones. Double-click or Enter ends, Backspace
// takes back the last, Esc ends. Each click is one undo step; the chain is grouped again each
// time, so it has to be on its layer, not in a group.
// A chain left with one dimension is that dimension, out of its group. One undo step each.

import type { EditSession, LinearDimensionInfo, Pt } from "../core/index.ts";
import { attempt, setEditGroup, setSelection, undo } from "./commands.ts";
import { dimensionValue } from "./dimension.ts";
import { appContext } from "./ext.ts";
import { store, type ToolId } from "./state.ts";
import { toast } from "./toast.ts";
import { parseLength } from "./units.ts";

/** How near a dimension's value must be to its length to be taken as saying it, in mm (as Object Info's). */
const MEASURED_MM = 2;

/** A chain of linear dimensions, in order along it. */
interface Chain {
  readonly group: string;
  readonly dims: readonly string[];
  /** where its witness lines are: the first dimension's start, then each one's end */
  readonly points: readonly Pt[];
  readonly u: Pt;
  /** the left of `u`, and how far along it the dimension line lies */
  readonly n: Pt;
  readonly line: number;
}

/** What a right-click on a chain is on: one of its witness lines, or one of its dimensions. */
export type ChainPart = { readonly chain: Chain; readonly witness: number } | { readonly chain: Chain; readonly dim: number };

const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;

/** The chain the group `id` is (or the group the dimension `id` is in), or null. */
function chainOf(id: string): Chain | null {
  const s = store.session;
  const o = s?.doc.object(id);
  if (!s || !o) return null;
  const group = o.kind === "group" ? o : o.parentId ? s.doc.object(o.parentId) : null;
  if (!group || group.kind !== "group") return null;
  const members = s.doc.objects(group.layerId).filter((c) => c.parentId === group.id);
  if (members.length < 2) return null;
  const dims: (LinearDimensionInfo & { id: string })[] = [];
  for (const c of members) {
    const d = s.linearDimension(c.id);
    if (!d) return null;
    dims.push({ id: c.id, ...d });
  }
  const u = dims[0].u;
  const n = { x: -u.y, y: u.x };
  dims.sort((p, q) => dot(p.a, u) - dot(q.a, u));
  const size = Math.max(...dims.map((d) => d.length), 1);
  const tol = 1e-6 * size;
  const line = dot(dims[0].a, n) + dims[0].offset;
  // one direction, one dimension line, each starting where the last ends
  for (let k = 0; k < dims.length; k++) {
    const d = dims[k];
    if (Math.abs(d.u.x - u.x) > 1e-9 || Math.abs(d.u.y - u.y) > 1e-9) return null;
    if (Math.abs(dot(d.a, n) + d.offset - line) > tol) return null;
    if (k > 0 && Math.abs(dot(d.a, u) - dot(dims[k - 1].b, u)) > tol) return null;
  }
  return { group: group.id, dims: dims.map((d) => d.id), points: [dims[0].a, ...dims.map((d) => d.b)], u, n, line };
}

/** The part of the chain `id` the point `at` is on, within `tol`: a witness line first, else a dimension. */
export function chainPartAt(id: string | null, at: Pt, tol: number): ChainPart | null {
  const chain = id === null ? null : chainOf(id);
  if (!chain) return null;
  const { points, u, n, line } = chain;
  const t = dot(at, u);
  const s = dot(at, n);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const from = dot(p, n);
    const [lo, hi] = from < line ? [from, line] : [line, from];
    if (Math.abs(t - dot(p, u)) <= tol && s >= lo - tol && s <= hi + tol) return { chain, witness: i };
  }
  // the click was on the chain's drawing (`id` is what it picked), so off its witness lines it is on
  // a dimension's line, markers or value
  for (let k = 0; k + 1 < points.length; k++) {
    if (t > dot(points[k], u) && t < dot(points[k + 1], u)) return { chain, dim: k };
  }
  return null;
}

/** Whether dimension `d`'s value says its length (as the drawing writes lengths), so it measures again when it changes. */
function measured(d: LinearDimensionInfo): boolean {
  const shown = parseLength(d.value, store.session?.doc.info.units);
  return shown !== null && Math.abs(shown - d.length) < MEASURED_MM;
}

/** Selects `ids`, leaving the chain first when it was open (it may be gone, or what is selected). */
function select(chain: Chain, ids: readonly string[]): void {
  setEditGroup(store.editGroupId === chain.group ? null : store.editGroupId, ids);
}

/** Groups each run of two or more of `runs` again, after the chain's group is released; the last run's ids. */
function regroup(s: EditSession, chain: Chain, runs: readonly (readonly string[])[]): string[] {
  s.ungroupObjects([chain.group]);
  const kept = runs.filter((r) => r.length > 0);
  const groups = s.groupEach(kept.filter((r) => r.length > 1).map((r) => [...r]));
  let g = 0;
  const made = kept.map((r) => (r.length > 1 ? [groups[g++]] : [...r]));
  return made[made.length - 1] ?? [];
}

/** Delete Witness Line: the dimensions either side of witness `i` become one; at an end, the end dimension goes. */
export function deleteWitnessLine(part: ChainPart): void {
  if (!("witness" in part)) return;
  const { chain, witness: i } = part;
  const { dims, points, u } = chain;
  const units = store.session?.doc.info.units;
  const r = attempt("Delete Witness Line", (s) =>
    s.batch(() => {
      let left: string[];
      if (i === 0 || i === dims.length) {
        const gone = i === 0 ? dims[0] : dims[dims.length - 1];
        s.deleteObjects([gone]);
        left = dims.filter((d) => d !== gone);
      } else {
        const b = points[i + 1];
        const value = measured(s.linearDimension(dims[i - 1])!) ? dimensionValue(dot(b, u) - dot(points[i - 1], u), units) : undefined;
        s.setLinearDimension(dims[i - 1], { b, value });
        s.deleteObjects([dims[i]]);
        left = dims.filter((_, k) => k !== i);
      }
      if (left.length > 1) return [chain.group];
      s.ungroupObjects([chain.group]);
      return left;
    }),
  );
  if (r) select(chain, r.value);
}

/** Split Dimension: at a witness line, two chains meeting there; on a dimension, the chains either side of it. */
export function splitDimension(part: ChainPart): void {
  const { chain } = part;
  const { dims } = chain;
  const r = attempt("Split Dimension", (s) =>
    s.batch(() => {
      if ("witness" in part) return regroup(s, chain, [dims.slice(0, part.witness), dims.slice(part.witness)]);
      s.deleteObjects([dims[part.dim]]);
      return regroup(s, chain, [dims.slice(0, part.dim), dims.slice(part.dim + 1)]);
    }),
  );
  if (r) select(chain, r.value);
}

/** Split Dimension at a witness line between two dimensions, or on a dimension. */
export function canSplitDimension(part: ChainPart): boolean {
  return !("witness" in part) || (part.witness > 0 && part.witness < part.chain.dims.length);
}

/** Edit Dimension: the dimension `part` is on, selected inside its chain. */
export function editDimension(part: ChainPart): void {
  if ("dim" in part) setEditGroup(part.chain.group, [part.chain.dims[part.dim]]);
}

/** What Add Dimension(s) adds to: a chain's group or a linear dimension on its own, as each click leaves it. */
interface AddJob {
  target: string;
  /** what it was before each click, for Backspace */
  readonly before: string[];
}

let job: AddJob | null = null;
let back: ToolId = "select";

/** The chain `id` is in, or the linear dimension `id` is, as a one-dimension chain: either on its layer, not in a group. */
function addable(id: string): Chain | null {
  const s = store.session;
  const chain = chainOf(id);
  if (chain) return s?.doc.object(chain.group)?.parentId === null ? chain : null;
  const d = s?.linearDimension(id);
  if (!s || !d || s.doc.object(id)?.parentId !== null) return null;
  const n = { x: -d.u.y, y: d.u.x };
  return { group: id, dims: [id], points: [d.a, d.b], u: d.u, n, line: dot(d.a, n) + d.offset };
}

export function canAddDimensions(id: string | null): boolean {
  return id !== null && addable(id) !== null;
}

/** Add Dimension(s): takes up the Add Dimensions tool for the chain or dimension `id`, selected. */
export function startAddDimensions(id: string): void {
  const chain = addable(id);
  const ctx = appContext();
  if (!chain || !ctx) return;
  if (ctx.controller.activeId !== "adddims") back = ctx.controller.activeId;
  job = { target: chain.group, before: [] };
  setEditGroup(null, [chain.group]);
  ctx.show2d();
  ctx.setTool("adddims");
}

/** The chain being added to, as it is now, or null. */
export function addingTo(): Chain | null {
  return job ? addable(job.target) : null;
}

/** Ends Add Dimension(s), giving back the tool before it. */
export function endAddDimensions(): void {
  job = null;
  appContext()?.setTool(back);
}

/** A new witness line ending at `p`: the dimension it falls in split there, or a new one past an end. */
export function addDimensionAt(p: Pt): void {
  const chain = addingTo();
  if (!job || !chain) return endAddDimensions();
  const { dims, points, u, n, line } = chain;
  const t = dot(p, u);
  const ts = points.map((q) => dot(q, u));
  const size = Math.max(ts[ts.length - 1] - ts[0], 1);
  if (ts.some((x) => Math.abs(x - t) <= 1e-6 * size)) {
    toast("A witness line is there already: click somewhere along the chain without one.", "info");
    return;
  }
  const s = store.session!;
  const layerId = s.doc.object(chain.group)!.layerId;
  const units = s.doc.info.units;
  // where the new witness line meets the chain's dimension line
  const at = { x: p.x + n.x * (line - dot(p, n)), y: p.y + n.y * (line - dot(p, n)) };
  const value = (length: number): string => dimensionValue(length, units);
  const r = attempt("Add Dimension", (s) =>
    s.batch(() => {
      const members = dims.length > 1 ? s.ungroupObjects([chain.group]) : [...dims];
      const like = (id: string): number => s.doc.object(id)!.classIndex;
      let added: string;
      if (t < ts[0]) {
        added = s.addDimension(layerId, p, points[0], at, u, value(ts[0] - t), dims[0], like(dims[0]));
      } else if (t > ts[ts.length - 1]) {
        const last = dims[dims.length - 1];
        added = s.addDimension(layerId, points[points.length - 1], p, at, u, value(t - ts[ts.length - 1]), last, like(last));
      } else {
        const k = ts.findIndex((x, i) => t > x && t < ts[i + 1]);
        const d = s.linearDimension(dims[k])!;
        s.setLinearDimension(dims[k], { b: p, value: measured(d) ? value(t - ts[k]) : undefined });
        added = s.addDimension(layerId, p, points[k + 1], at, u, value(ts[k + 1] - t), dims[k], like(dims[k]));
      }
      return s.groupObjects([...members, added]);
    }),
  );
  if (!r) return;
  job.before.push(job.target);
  job.target = r.value;
  setSelection([r.value]);
}

/** Backspace: the last click's dimension taken back (its undo step undone). */
export function takeBackDimension(): void {
  const was = job?.before.pop();
  if (!job || was === undefined) return;
  undo();
  job.target = was;
  setSelection([was]);
}
