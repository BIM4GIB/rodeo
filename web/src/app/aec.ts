// AEC menu: Create Objects from Shapes…, as Vectorworks' does for walls and slabs. The selected
// lines, rectangles, polygons and polylines become walls along their sides (mitred at the corners,
// a closed shape's run closed) or a slab over each rectangle, in a style the drawing has (the ones
// the Wall and Slab tools copy), on the shape's layer in the active class. Delete Source Shapes
// takes the shapes away too. One undo step; the new objects are selected. A Site Modifier makes a
// polygon with the Site Modifier record on each shape's outline, as the Site Modifiers tool would.

import { h } from "./dom.ts";
import { shapeObjectMakers } from "./ext.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { showDialog } from "./menubar.ts";
import { addMassingModel } from "./massingModel.ts";
import { modifierObject, type ModifierMode } from "./siteModel.ts";
import { store } from "./state.ts";
import { addPathModifier } from "./sitePath.ts";
import { closedOutline } from "./surfaces.ts";
import { massingSettings } from "./tools/massingModel.ts";
import { slabLabel } from "./tools/slab.ts";
import { wallLabel } from "./tools/wall.ts";

/** a feature's object (ext.ts registerShapeObject) is `object:` and its label */
type Made = "wall" | "slab" | "modifier" | "massing" | `object:${string}`;

const makerOf = (kind: Made) => shapeObjectMakers().find((m) => kind === `object:${m.label}`);

/** The site modifiers a shape can become. */
const SHAPE_MODIFIERS: readonly (readonly [ModifierMode | "pathway" | "boundary", string])[] = [
  ["limits", "Grade Limits"],
  ["pad", "Planar Pad"],
  ["edge", "Retaining Edge"],
  ["aligned", "Aligned"],
  ["line", "Open Edge Line"],
  ["bed", "Texture Bed"],
  ["spoil", "Spoil Pile"],
  ["pathway", "Pathway Path"],
  ["boundary", "Boundary Path"],
  ["crop", "Site Border"],
];

const ROUNDED_RECT = 13;
const SHAPES: ReadonlySet<string> = new Set(["line", "rect", "polygon", "polyline"]);

/** the last choices, offered again next time */
let last: { kind: Made; style: Partial<Record<Made, string>>; remove: boolean } = { kind: "wall", style: {}, remove: false };

/** The selected objects objects can be made from: lines, rectangles, polygons and polylines. */
function selectedShapes(): string[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return [...store.selection].filter((id) => {
    const o = doc.object(id);
    return !!o?.shape && o.type !== ROUNDED_RECT && SHAPES.has(o.shape.kind);
  });
}

export function canCreateObjectsFromShapes(): boolean {
  return selectedShapes().length > 0;
}

/** AEC > Create Objects from Shapes…: asks what to make and in which style, then makes it. */
export async function createObjectsFromShapesDialog(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const units = s.doc.info.units;
  const styles = (kind: Made): { value: string; label: string }[] =>
    makerOf(kind)
      ? [{ value: kind, label: makerOf(kind)!.style }]
      : kind === "modifier"
      ? SHAPE_MODIFIERS.map(([value, label]) => ({ value, label }))
      : kind === "massing"
      ? [{ value: "massing", label: "As the Massing Model tool last made one" }]
      : kind === "wall"
        ? s.wallTemplates().map((k) => ({ value: k.id, label: wallLabel(k, units) }))
        : s.slabTemplates().map((k) => ({ value: k.id, label: slabLabel(k, units) }));
  const select = (label: string): HTMLSelectElement => h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } });
  const kind = select("Object type");
  for (const [value, text] of [["wall", "Walls"], ["slab", "Slab"], ["modifier", "Site Modifier"], ["massing", "Massing Model"], ...shapeObjectMakers().map((m) => [`object:${m.label}`, m.label] as const)]) kind.append(h("option", { value, text }));
  kind.value = last.kind;
  const style = select("Style");
  const fill = (): void => {
    const k = kind.value as Made;
    const options = styles(k);
    style.replaceChildren(...(options.length ? options.map((o) => h("option", { value: o.value, text: o.label })) : [h("option", { value: "", text: "None in this drawing" })]));
    style.disabled = !options.length;
    style.value = options.some((o) => o.value === last.style[k]) ? last.style[k]! : (options[0]?.value ?? "");
  };
  fill();
  kind.addEventListener("change", fill);
  const remove = h("input", { checked: last.remove, attrs: { type: "checkbox" } });
  const field = (label: string, input: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);
  const v = await showDialog<{ kind: Made; style: string; remove: boolean }>({
    title: "Create Objects from Shapes",
    okLabel: "Create",
    body: [
      field("Object type", kind),
      field("Style", style),
      h("label", { cls: "menu-dialog-check" }, remove, "Delete source shapes"),
      h("p", {
        cls: "muted",
        text: "Walls run along each side of the selected lines, rectangles, polygons and polylines, mitred at the corners; a slab covers each rectangle square to the drawing. Each copies one the drawing has in that style. A massing model goes on each closed shape, as the Massing Model tool last made one, and so does a layout room, as its tool's preferences say.",
      }),
    ],
    check: () => {
      const k = kind.value as Made;
      if (!style.value) return { error: k === "wall" ? "This drawing has no straight, square-ended wall to copy." : "This drawing has no rectangular slab to copy.", focus: kind };
      return { value: { kind: k, style: style.value, remove: remove.checked } };
    },
  });
  if (!v) return;
  last = { kind: v.kind, style: { ...last.style, [v.kind]: v.style }, remove: v.remove };
  const ids = selectedShapes();
  const layerId = store.activeLayerId;
  const r = attempt("Create Objects from Shapes", (session) => {
    const maker = makerOf(v.kind);
    if (maker) {
      return session.batch(() => {
        const made = ids.flatMap((id) => {
          const shape = session.doc.object(id)?.shape;
          const ring = shape ? closedOutline(shape) : null;
          return ring && ring.length >= 3 && layerId ? [maker.make(session, layerId, ring)] : [];
        });
        if (!made.length) throw new Error(`A ${maker.label.toLowerCase()} takes a closed shape.`);
        if (v.remove) session.deleteObjects(ids);
        return made;
      });
    }
    if (v.kind === "massing") {
      return session.batch(() => {
        const made = ids.flatMap((id) => {
          const shape = session.doc.object(id)?.shape;
          const ring = shape ? closedOutline(shape) : null;
          return ring && ring.length >= 3 && layerId ? [addMassingModel(session, layerId, ring, massingSettings())] : [];
        });
        if (!made.length) throw new Error("A massing model takes a closed shape.");
        if (v.remove) session.deleteObjects(ids);
        return made;
      });
    }
    if (v.kind === "wall" || v.kind === "slab") return session.objectsFromShapes(ids, v.kind, v.style, store.activeClassIndex, v.remove);
    return session.batch(() => {
      const made = ids.flatMap((id) => {
        const shape = session.doc.object(id)?.shape;
        const line = v.style === "line" || v.style === "pathway";
        const curve = shape && line ? session.curvePoints(id) : null;
        const open = curve ? curve.points.map((p) => ({ x: p[0], y: p[1] })) : null;
        const ring = shape ? (line ? (open && curve?.closed ? [...open, open[0]] : open) : closedOutline(shape)) : null;
        if (!ring || ring.length < (line ? 2 : 3) || !layerId) return [];
        if (v.style === "pathway" || v.style === "boundary") return [addPathModifier(session, layerId, ring, v.style === "pathway" ? "Pathway" : "Boundary", { width: 1828.8, applyExisting: false, elevation: 0 })];
        // a foot of spoil, for want of a thickness
        return [modifierObject(session, layerId, ring, { kind: v.style as ModifierMode, elevation: v.style === "spoil" ? 304.8 : 0, useSurface: true, slope: 0, direction: 0 })];
      });
      if (!made.length) throw new Error("A site modifier takes a closed shape, or any line for an Open Edge Line or a Pathway Path.");
      if (v.remove) session.deleteObjects(ids);
      return made;
    });
  });
  if (r) setEditGroup(null, r.value);
}
