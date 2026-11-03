// Text > Text Along Path…, as Vectorworks has it: with a single-line text and a path selected (a
// line, polyline, polygon, rectangle, arc or circle), the text's characters become polylines (as
// Convert Text to Polylines makes them) set along the path, each letter turned to the path where
// its middle falls, above the path (on the left as it was drawn) or below it. Text Size is
// Vectorworks' three ways: the letters as they are (the path must be as long as the text), stretched
// across to the path's length, or stretched both ways. Reverse Direction (in Vectorworks' Object Info
// once made) runs the text the other way along the path. The path and the letters are grouped,
// where Vectorworks makes its Text Along Path object, and the text goes; one undo step. Letters come
// as curves only: Vectorworks' Surfaces and Extrusions are 3D objects.

import { TEXT_ASCENT, type Attributes, type NewShape, type ObjectInfo, type Pt } from "../core/index.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { pathOf, type CutPath } from "./cutting.ts";
import { h } from "./dom.ts";
import { degToRad } from "./geom.ts";
import { showDialog } from "./menubar.ts";
import { walkOf } from "./pathWalk.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { fontOf } from "./textMenu.ts";
import { lineWidth, paintText } from "./textPaint.ts";
import { traceDrawn } from "./textToPolylines.ts";
import { toast } from "./toast.ts";
import { formatLength } from "./units.ts";

/** a text that would make more polylines than this is refused */
const MAX_OBJECTS = 4000;

type TextSize = "preserve" | "width" | "both";

interface Choice {
  readonly size: TextSize;
  readonly above: boolean;
  readonly reverse: boolean;
}

let last: Choice = { size: "preserve", above: true, reverse: false };

/** The selected text and path, when the selection is just those two. */
function parts(): { text: ObjectInfo; path: ObjectInfo; along: CutPath } | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 2) return null;
  const objs = [...store.selection].filter((id) => !isDerivedId(id)).map((id) => doc.object(id));
  const text = objs.find((o) => o?.shape?.kind === "text");
  const path = objs.find((o) => o && o !== text && o.shape && pathOf(o.shape));
  if (!text || !path?.shape) return null;
  const along = pathOf(path.shape);
  return along ? { text, path, along } : null;
}

export function canTextAlongPath(): boolean {
  return parts() !== null;
}

/** The path run the other way. */
function reversed(p: CutPath): CutPath {
  if (p.kind === "arc") return { ...p, start: p.start + p.sweep, sweep: -p.sweep };
  return { ...p, pts: p.closed ? [p.pts[0], ...p.pts.slice(1).reverse()] : [...p.pts].reverse() };
}

/** Opens Text Along Path and sets the text along the path. */
export async function textAlongPathDialog(): Promise<void> {
  const found = parts();
  if (!found) {
    toast("Select one text and one path (a line, polyline, polygon, rectangle, arc or circle).", "info");
    return;
  }
  const { text, path } = found;
  const shape = text.shape!;
  if ((shape.lines?.length ?? 1) > 1 || /[\r\n]/.test(shape.text ?? "")) {
    toast("Text Along Path takes a single line of text.", "info");
    return;
  }
  if (text.parentId || path.parentId || text.layerId !== path.layerId) {
    toast("The text and the path need to be on one layer and outside groups: open the group first, or ungroup it.", "info");
    return;
  }
  const radio = (size: TextSize, label: string): { size: TextSize; input: HTMLInputElement; row: HTMLElement } => {
    const input = h("input", { checked: last.size === size, attrs: { type: "radio", name: "text-along-size", value: size } });
    return { size, input, row: h("label", { cls: "menu-dialog-check" }, input, h("span", { text: label })) };
  };
  const check = (label: string, on: boolean): [HTMLElement, HTMLInputElement] => {
    const box = h("input", { attrs: { type: "checkbox" }, checked: on });
    return [h("label", { cls: "menu-dialog-check" }, box, h("span", { text: label })), box];
  };
  const sizes = [radio("preserve", "Preserve Height and Width"), radio("width", "Scale Width Only"), radio("both", "Scale Height and Width")];
  const [aboveRow, above] = check("Above Path", last.above);
  const [reverseRow, reverse] = check("Reverse Direction", last.reverse);
  const choice = await showDialog<Choice>({
    title: "Text Along Path",
    okLabel: "OK",
    body: [
      h("p", { cls: "menu-dialog-label", text: "Text Size" }),
      ...sizes.map((r) => r.row),
      aboveRow,
      reverseRow,
      h("p", {
        cls: "muted",
        text: "The letters become polylines set along the path, grouped with it; the text goes. Above Path sets them on the path's left as it was drawn. The scaling sizes fit the text to the path's length.",
      }),
    ],
    check: () => ({ value: { size: sizes.find((r) => r.input.checked)?.size ?? "preserve", above: above.checked, reverse: reverse.checked } }),
  });
  if (!choice) return;
  last = choice;
  setAlongPath(choice);
}

/** Sets the selected text along the selected path as `choice` says. */
export function setAlongPath(choice: Choice): void {
  const found = parts();
  if (!found) return;
  const { text, path } = found;
  const shape = text.shape!;
  const size = shape.textSize ?? 0;
  if (!(size > 0)) {
    toast("The text has no size to set along the path.", "info");
    return;
  }
  const walk = walkOf(choice.reverse ? reversed(found.along) : found.along);
  const font = fontOf(text);
  const chars = [...(shape.text ?? "")];
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) {
    toast("Text Along Path needs a 2D canvas, which this browser doesn't give.");
    return;
  }
  // where each character starts along the line, kerning and all
  const starts = chars.map((_, i) => lineWidth(ctx, chars.slice(0, i).join(""), shape, font));
  const width = lineWidth(ctx, chars.join(""), shape, font);
  if (!(width > 0) || !chars.some((c) => c.trim())) {
    toast("The text draws nothing to set along the path.", "info");
    return;
  }
  const units = store.session?.doc.info.units;
  if (choice.size === "preserve" && width > walk.length * (1 + 1e-9)) {
    toast(`The path (${formatLength(walk.length, units)}) is shorter than the text (${formatLength(width, units)}): choose a longer path, or a Text Size that scales.`, "info");
    return;
  }
  const sx = choice.size === "preserve" ? 1 : walk.length / width;
  const sy = choice.size === "both" ? sx : 1;
  // below the path, the tops of the capitals sit on it
  const drop = choice.above ? 0 : -TEXT_ASCENT * size * sy;
  const one = { ...shape, anchor: { x: 0, y: 0 }, textAngle: 0, hAlign: 1, vAlign: 2, underline: false };

  const shapes: NewShape[] = [];
  try {
    chars.forEach((c, i) => {
      if (!c.trim()) return;
      const advance = (i + 1 < chars.length ? starts[i + 1] : width) - starts[i];
      const mid = advance / 2;
      const spot = walk.at((starts[i] + mid) * sx);
      const a = degToRad(spot.angle);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const place = (q: Pt): Pt => {
        const u = (q.x - mid) * sx;
        const v = q.y * sy + drop;
        return { x: spot.p.x + u * cos - v * sin, y: spot.p.y + u * sin + v * cos };
      };
      const letter = { ...one, text: c, lines: [c] };
      const box = { x0: 0, y0: -size, x1: Math.max(advance, size), y1: size };
      for (const traced of traceDrawn(box, size, (g) => paintText(g, letter, box, font))) {
        if (traced.kind === "polyline") shapes.push({ ...traced, points: traced.points.map(place) });
      }
    });
  } catch (err) {
    toast(`Text Along Path failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (shapes.length === 0) {
    toast("The text draws nothing to set along the path.", "info");
    return;
  }
  if (shapes.length > MAX_OBJECTS) {
    toast(`The letters would make ${shapes.length} polylines (at most ${MAX_OBJECTS}): set a shorter text along the path.`);
    return;
  }
  // filled as the text is drawn, in its pen colour, with no pen (as Convert Text to Polylines makes them)
  const pen = text.attrs ? { fillFore: text.attrs.penFore, fillBack: text.attrs.penFore, fillOpacity: text.attrs.penOpacity } : {};
  const attrs: Partial<Attributes> = { fillPattern: 1, lineStyle: 0, ...pen };
  const r = attempt("Text Along Path", (s) =>
    s.batch(() => {
      const ids = s.addObjects(path.layerId, shapes, text.classIndex, attrs);
      s.deleteObjects([text.id]);
      return s.groupObjects([path.id, ...ids]);
    }),
  );
  if (!r) return;
  setEditGroup(null, [r.value]);
}
