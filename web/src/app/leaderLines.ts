// Modify > Align > Align/Distribute Leader Lines…, as Vectorworks has it: the Align Leader Lines
// dialog, then (when the shoulder or label points line up) a reference line drawn with two clicks
// by the Leader Lines tool (tools/alignLeaders.ts), then every selected leader moved at once
// (leaderAlign.ts). Rodeo's leaders are the Leader Line tools' open polygons (three points: the
// target point, the shoulder point and the label point, the shoulder the more level of its two
// segments) and the Callout tool's groups (a leader of two or three points, and its note); the
// note, and a box round it, go with the label point, the marker at the target stays.

import type { EditSession, NewShape, ObjectInfo, Pt } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { alignLeaders, needsReference, type Leader, type LeaderAlign, type LeaderSpacing } from "./leaderAlign.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";

/** One selected object with a leader: its leader object, which of its points is which, and what moves with its label */
interface Target {
  readonly leader: Leader;
  readonly lineId: string;
  readonly shape: NewShape & { kind: "polygon" | "polyline" };
  /** indices of the target, shoulder and label points in the line's points (shoulder = label for a two-point leader) */
  readonly at: readonly [number, number, number];
  /** a callout's note and box */
  readonly withLabel: readonly string[];
}

interface Job {
  readonly targets: readonly Target[];
  readonly options: LeaderAlign;
}

const SPACINGS: readonly { readonly value: LeaderSpacing; readonly label: string }[] = [
  { value: "none", label: "None" },
  { value: "parallel", label: "Parallel target lines" },
  { value: "equal", label: "Equal distance between shoulder lines" },
];

/** the shoulder may lean this far from level */
const MAX_SHOULDER_DEG = 30;

let job: Job | null = null;
let last: LeaderAlign = { shoulders: true, labels: false, moveShoulders: true, spacing: "none" };

export function leaderJob(): Job | null {
  return job;
}

export function endLeaderJob(): void {
  job = null;
}

/** The selected objects on the active layer (or in the edited group), groups included. */
function selection(): ObjectInfo[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  return s.doc.objects(layerId).filter((o) => store.selection.has(o.id) && o.parentId === store.editGroupId && !isDerivedId(o.id));
}

const lean = (a: Pt, b: Pt): number => {
  const run = Math.abs(b.x - a.x);
  return (Math.atan2(Math.abs(b.y - a.y), run) * 180) / Math.PI;
};

/** An open polygon or polyline of straight segments, as a shape to rewrite its points in. */
function openLine(o: ObjectInfo): (NewShape & { kind: "polygon" | "polyline" }) | null {
  const sh = o.shape;
  if (!sh || sh.closed || (sh.kind !== "polygon" && sh.kind !== "polyline")) return null;
  if (sh.kind === "polyline" && sh.vertices?.some((v) => v.kind !== "corner")) return null;
  return { kind: sh.kind, points: sh.points, closed: false };
}

/** Which of a three-point leader's ends is its target and which its label: the shoulder is the more level segment. */
function threePoint(pts: readonly Pt[]): [number, number, number] | null {
  if (pts.length !== 3) return null;
  const first = lean(pts[0], pts[1]);
  const second = lean(pts[1], pts[2]);
  if (Math.min(first, second) > MAX_SHOULDER_DEG || first === second) return null;
  return second < first ? [0, 1, 2] : [2, 1, 0];
}

function targetOf(o: ObjectInfo, all: readonly ObjectInfo[]): Target | null {
  const leaderOf = (line: ObjectInfo, at: [number, number, number], withLabel: string[]): Target => {
    const pts = line.shape!.points;
    return { leader: { target: pts[at[0]], shoulder: pts[at[1]], label: pts[at[2]] }, lineId: line.id, shape: openLine(line)!, at, withLabel };
  };
  if (o.kind !== "group") {
    const line = openLine(o);
    const at = line && threePoint(line.points);
    return at ? leaderOf(o, at, []) : null;
  }
  // a callout: its leader and its note
  const parts = all.filter((c) => c.parentId === o.id);
  const notes = parts.filter((c) => c.shape?.kind === "text");
  const lines = parts.filter((c) => openLine(c) && (c.shape!.points.length === 2 || threePoint(c.shape!.points)));
  if (notes.length !== 1 || lines.length !== 1) return null;
  const line = lines[0];
  const pts = line.shape!.points;
  let at = threePoint(pts);
  if (!at) {
    // no shoulder: the end further from the note is the target
    const c = notes[0].shape!.bbox;
    const mid = c ? { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 } : pts[1];
    at = Math.hypot(pts[0].x - mid.x, pts[0].y - mid.y) >= Math.hypot(pts[1].x - mid.x, pts[1].y - mid.y) ? [0, 1, 1] : [1, 0, 0];
  }
  const tip = pts[at[0]];
  // the marker at the target stays; the note and its box go with the label point
  const around = (c: ObjectInfo): boolean => {
    const b = c.shape?.bbox;
    return !!b && tip.x >= b.x0 - 1e-6 && tip.x <= b.x1 + 1e-6 && tip.y >= b.y0 - 1e-6 && tip.y <= b.y1 + 1e-6;
  };
  return leaderOf(line, at, parts.filter((c) => c !== line && !around(c)).map((c) => c.id));
}

/** True when the command can start: something is selected. */
export function canAlignLeaders(): boolean {
  return store.selection.size > 0;
}

/**
 * Asks for the alignment. Returns true when a reference line is to be drawn next (the caller
 * takes up the Leader Lines tool); otherwise the leaders have moved, or nothing could.
 */
export async function startAlignLeaders(): Promise<boolean> {
  const sel = selection();
  const s = store.session;
  if (!s || !store.activeLayerId || sel.length === 0) return false;
  const all = s.doc.objects(store.activeLayerId);
  const targets = sel.map((o) => targetOf(o, all)).filter((t): t is Target => t !== null);
  if (targets.length === 0) {
    toast("None of the selected objects is a callout or leader line with a shoulder.", "info");
    return false;
  }
  const skipped = sel.length - targets.length;
  const v = await toolPrefs(
    "Align Leader Lines",
    [
      { kind: "check", key: "shoulders", label: "Align shoulder points", value: last.shoulders },
      { kind: "check", key: "labels", label: "Align label points", value: last.labels },
      { kind: "check", key: "move", label: "Move shoulder points", value: last.moveShoulders },
      { kind: "choice", key: "spacing", label: "Vertical Distribution", value: last.spacing, options: SPACINGS },
    ],
    `${skipped ? `${skipped} of the selected objects ${skipped === 1 ? "isn't a leader and stays" : "aren't leaders and stay"} as ${skipped === 1 ? "it is" : "they are"}. ` : ""}Horizontal alignment puts the shoulder points, or the label points, on a reference line drawn next (not level); with both, every label point also lines up under the topmost's. Move shoulder points keeps each shoulder line's length when only the label points align. Parallel target lines turns each target line parallel to the topmost's; equal distance spaces the shoulder lines as far apart as the top two. Callouts (the Callout tool's) and leader lines (the Leader Line tools') align; Rodeo has no other objects with leaders yet.`,
  );
  if (!v) return false;
  last = {
    shoulders: v.flag("shoulders"),
    labels: v.flag("labels"),
    moveShoulders: v.flag("move"),
    spacing: SPACINGS.find((o) => o.value === v.choice("spacing"))?.value ?? "none",
  };
  if (!needsReference(last)) {
    apply({ targets, options: last }, null);
    return false;
  }
  job = { targets, options: last };
  return true;
}

/** Moves the job's leaders, the reference line from a to b. */
export function finishAlignLeaders(j: Job, a: Pt, b: Pt): void {
  job = null;
  apply(j, [a, b]);
}

function apply(j: Job, ref: [Pt, Pt] | null): void {
  const moved = alignLeaders(
    j.targets.map((t) => t.leader),
    j.options,
    ref,
  );
  if (typeof moved === "string") {
    toast(moved, "info");
    return;
  }
  attempt("Align/Distribute Leader Lines", (s: EditSession) =>
    s.batch(() => {
      j.targets.forEach((t, k) => {
        const { shoulder, label } = moved[k];
        const points = t.shape.points.slice();
        points[t.at[1]] = shoulder;
        points[t.at[2]] = label;
        s.replaceObjects([t.lineId], [{ ...t.shape, points }]);
        const dx = label.x - t.leader.label.x;
        const dy = label.y - t.leader.label.y;
        if (t.withLabel.length && (dx !== 0 || dy !== 0)) s.moveObjects([...t.withLabel], dx, dy);
      });
    }),
  );
}
