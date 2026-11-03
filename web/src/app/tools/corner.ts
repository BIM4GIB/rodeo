// The Fillet and Chamfer tools' modes, as Vectorworks has them: what becomes of the
// two lines once the arc or cut is in. Fillet (or Chamfer) leaves them as they are,
// … and Split cuts each at the arc's or cut's end into two lines, … and Trim cuts
// them back to it (extending a line that stops short, in both of the last two).

import type { EditSession, ObjectInfo } from "../../core/index.ts";
import { dist, type LineSeg } from "../geom.ts";
import type { ToolModes } from "../tools.ts";

export type CornerMode = "keep" | "split" | "trim";

const EPS = 1e-9;

export function isCornerMode(id: string): id is CornerMode {
  return id === "keep" || id === "split" || id === "trim";
}

export function cornerModes(verb: "Fillet" | "Chamfer", active: CornerMode): ToolModes {
  return {
    options: [
      { id: "keep", label: verb, key: "1" },
      { id: "split", label: `${verb} and Split`, key: "2" },
      { id: "trim", label: `${verb} and Trim`, key: "3" },
    ],
    active,
  };
}

/**
 * Gives `line` (whose segment was `orig`) the segment `trimmed` reaching the arc or cut, as the mode
 * says; in Split mode the piece cut off stays as a line of its own, with the same class and
 * attributes.
 */
export function shapeCornerLine(
  s: EditSession,
  layerId: string,
  line: ObjectInfo,
  orig: LineSeg,
  trimmed: LineSeg,
  mode: CornerMode,
): void {
  if (mode === "keep") return;
  s.setGeometry(line.id, { kind: "line", a: trimmed.a, b: trimmed.b });
  const rest = mode === "split" ? cutOff(orig, trimmed) : null;
  if (rest) s.addObject(layerId, { kind: "line", a: rest.a, b: rest.b }, line.classIndex, line.attrs ?? undefined);
}

/** The piece of `orig` that trimming it to `trimmed` cuts away, or null when it was not cut (or was lengthened). */
function cutOff(orig: LineSeg, trimmed: LineSeg): LineSeg | null {
  if (dist(trimmed.a, trimmed.b) >= dist(orig.a, orig.b) - EPS) return null;
  // the end that moved: from where it is now back to where it was
  const piece = dist(trimmed.a, orig.a) <= EPS ? { a: trimmed.b, b: orig.b } : { a: trimmed.a, b: orig.a };
  return dist(piece.a, piece.b) > EPS ? piece : null;
}
