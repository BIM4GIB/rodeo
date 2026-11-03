// Modify > Convert > Convert Object to Dimension, as Vectorworks has it: each selected line becomes a
// linear dimension measuring it, its dimension line where the line was, and each circular arc an
// angular dimension of the angle it spans, its arc where the arc was. A line becomes a dimension
// object when the drawing has a linear one to copy (as the Dimension tool's are) and no group is
// being edited; otherwise, and for arcs (Rodeo makes no angular dimension objects), the dimension is
// drawn as its pieces, grouped, in the object's place with its class and attributes. One undo step.

import type { NewShape, ObjectInfo } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { selectedObjects } from "./compose.ts";
import { angleArc, dimensionLayout, dimensionValue, linearDrawing, withoutCovered, type DimensionDrawing } from "./dimension.ts";
import { layerInfo, store } from "./state.ts";
import { toast } from "./toast.ts";

/** Text justification codes, as the Dimension tool sets its value's */
const TEXT_H_CENTRE = 2;
const TEXT_V_BASELINE = 4;
/** Sweeps within this many degrees of none or a whole turn are not angles to dimension. */
const SWEEP_EPS = 1e-6;

/** The dimension a selected line or circular arc becomes; null for any other object. */
function drawingOf(o: ObjectInfo): DimensionDrawing | null {
  const s = o.shape;
  if (!s) return null;
  const scale = layerInfo(o.layerId)?.scale || 1;
  if (s.kind === "line" && s.points.length >= 2) {
    const [a, b] = s.points;
    // the dimension line through the line itself: no extension lines
    const layout = dimensionLayout(a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, true, scale);
    return layout ? linearDrawing(layout, dimensionValue(layout.length, store.session?.doc.info.units)) : null;
  }
  const sweep = s.sweepAngle ?? 360;
  if (s.kind !== "arc" || !s.center || !(s.rx !== undefined && s.rx > 0) || (s.ry ?? s.rx) !== s.rx) return null;
  if (!(Math.abs(sweep) > SWEEP_EPS && Math.abs(sweep) < 360 - SWEEP_EPS)) return null;
  // a clockwise arc spans the same angle counter-clockwise from its far end
  const start = sweep < 0 ? (s.startAngle ?? 0) + sweep : (s.startAngle ?? 0);
  return angleArc(s.center, s.rx, (start * Math.PI) / 180, (Math.abs(sweep) * Math.PI) / 180, scale);
}

/** The selected lines and circular arcs (at the level being edited), each with its dimension. */
function jobs(): { o: ObjectInfo; d: DimensionDrawing }[] {
  return selectedObjects().flatMap((o) => {
    const d = drawingOf(o);
    return d ? [{ o, d }] : [];
  });
}

export function canConvertToDimension(): boolean {
  return jobs().length > 0;
}

/** Modify > Convert > Convert Object to Dimension: the selected lines and arcs become dimensions, selected. */
export function convertToDimensionSelection(): void {
  const todo = jobs();
  const session = store.session;
  if (!session || todo.length === 0) {
    toast("Convert Object to Dimension works on lines and circular arcs.", "info");
    return;
  }
  const template = store.editGroupId === null ? session.dimensionTemplate() : null;
  const r = attempt("Convert Object to Dimension", (s) =>
    s.batch(() =>
      todo.map(({ o, d }) => {
        if (template && d.linear) {
          const { a, b, at, u } = d.linear;
          const id = s.addDimension(o.layerId, a, b, at, u, d.text.value, template, o.classIndex);
          s.deleteObjects([o.id]);
          return id;
        }
        const text: NewShape = { kind: "text", at: d.text.at, text: d.text.value, height: d.text.height };
        const shapes: NewShape[] = [
          ...withoutCovered(d.lines).map((l): NewShape => ({ kind: "line", a: l.a, b: l.b })),
          ...d.arcs.map((c): NewShape => ({ kind: "arc", center: c.centre, radius: c.radius, startAngle: c.startAngle, sweepAngle: c.sweepAngle })),
          text,
        ];
        const ids = s.replaceObjects([o.id], shapes);
        // turning and justifying the text moves its origin, so the origin goes back on the anchor after
        const textId = ids[ids.length - 1];
        s.setTextStyle([textId], { hAlign: TEXT_H_CENTRE, vAlign: TEXT_V_BASELINE, angle: d.text.angle });
        s.setGeometry(textId, text);
        return s.groupObjects(ids);
      }),
    ),
  );
  if (r) setSelection(r.value);
}
