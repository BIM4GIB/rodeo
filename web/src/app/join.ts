// Modify > Join and Join (No Trim), as Vectorworks has them: two selected lines that aren't parallel,
// or two straight walls, are made to meet where their lines cross. Join moves the end of each nearer
// the crossing to it, so a line stopping short is extended and one running past is cut back, its
// shorter part going; walls meet in a mitred corner. Join (No Trim) only extends: a line running past
// the crossing stays as it is, and a wall running past it stays whole while the other runs into its
// side. Each object keeps its class and attributes. One undo step.

import type { ObjectInfo, Pt } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { moveEnd, pathOf, type CutPath } from "./cutting.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

const WALL = 68;
/** how near (mm) an end must be to the crossing to count as on it */
const ON_END = 1e-6;

type Pair = { kind: "lines"; a: Line; b: Line } | { kind: "walls"; a: string; b: string };

interface Line {
  readonly id: string;
  readonly path: CutPath;
  readonly p0: Pt;
  readonly p1: Pt;
}

/** The two selected top-level objects of the edit scope when they are two lines or two walls. */
function selectedPair(): Pair | null {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size !== 2) return null;
  const scope = store.editGroupId;
  const two = s.doc.objects(layerId).filter((o) => store.selection.has(o.id) && o.parentId === scope && !isDerivedId(o.id));
  if (two.length !== 2) return null;
  if (two.every((o) => o.type === WALL)) return { kind: "walls", a: two[0].id, b: two[1].id };
  const [a, b] = two.map(lineOf);
  return a && b ? { kind: "lines", a, b } : null;
}

function lineOf(o: ObjectInfo): Line | null {
  const path = o.shape ? pathOf(o.shape) : null;
  if (path?.kind !== "chain" || path.source !== "line" || path.pts.length !== 2) return null;
  return { id: o.id, path, p0: path.pts[0], p1: path.pts[1] };
}

export function canJoin(): boolean {
  return selectedPair() !== null;
}

/** Modify > Join (`trim`) or Join (No Trim). */
export function joinSelection(trim: boolean): void {
  const label = trim ? "Join" : "Join (No Trim)";
  const pair = selectedPair();
  if (!pair) {
    toast(`${label} needs two lines or two walls selected.`, "info");
    return;
  }
  if (pair.kind === "walls") {
    attempt(label, (s) => s.joinWallPair(pair.a, pair.b, trim ? "L" : "no-trim"));
    return;
  }
  const { a, b } = pair;
  const da = { x: a.p1.x - a.p0.x, y: a.p1.y - a.p0.y };
  const db = { x: b.p1.x - b.p0.x, y: b.p1.y - b.p0.y };
  const la = Math.hypot(da.x, da.y);
  const lb = Math.hypot(db.x, db.y);
  const den = da.x * db.y - da.y * db.x;
  if (!(la > 0 && lb > 0) || Math.abs(den) < 1e-9 * la * lb) {
    toast(`${label} needs lines that aren't parallel: these never meet.`, "info");
    return;
  }
  // where the lines cross, as a fraction along each
  const ta = ((b.p0.x - a.p0.x) * db.y - (b.p0.y - a.p0.y) * db.x) / den;
  const tb = ((b.p0.x - a.p0.x) * da.y - (b.p0.y - a.p0.y) * da.x) / den;
  const at = { x: a.p0.x + da.x * ta, y: a.p0.y + da.y * ta };
  const edits: { line: Line; end: 0 | 1 }[] = [];
  for (const [line, t, len] of [[a, ta, la], [b, tb, lb]] as const) {
    // an end already on the crossing stays; without trimming, so does a line running past it
    if (Math.abs(t) * len <= ON_END || Math.abs(1 - t) * len <= ON_END) continue;
    if (!trim && t > 0 && t < 1) continue;
    edits.push({ line, end: t < 0.5 ? 0 : 1 });
  }
  if (edits.length === 0) {
    toast(trim ? "Those lines meet already." : "Those lines meet or cross already: Join (No Trim) leaves them as they are.", "info");
    return;
  }
  attempt(label, (s) =>
    s.batch(() => {
      for (const e of edits) {
        const shape = moveEnd(e.line.path, e.end, at);
        if (!shape) throw new Error("that would leave nothing of a line");
        s.setGeometry(e.line.id, shape);
      }
    }),
  );
}
