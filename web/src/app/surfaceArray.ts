// Model > Create Surface Array: copies of the selected items laid in a grid across a flat object or open surface,
// also selected, with the Create Surface Array dialog's Origin, Pattern Rotation, Repetition, Offset, Shift and
// Edge Conditions, the 3D view showing the base and the array's rectangles as they change. Rodeo has no surface
// array object to save, so it makes a group of the base and the copies, which can't be edited as an array
// afterwards (undo and create it again). Sums in surfaceArrayShapes.ts.

import "./surfaceArray.css";
import type { ObjectInfo } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { capTriangles, type Point3 } from "./loftShapes.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { isClosedMesh } from "./solidOps.ts";
import { store } from "./state.ts";
import { arrayLayout, baseSurface, cellLines, itemBox, itemMapper, newArrayOptions, rimLines, trimmer, type ArrayLayout, type ArrayOptions, type BaseSurface, type EdgeCondition, type Repeat } from "./surfaceArrayShapes.ts";
import { toast } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** a 3D polygon's and a 3D locus's record types */
const POLY3D = 25;
const LOCUS3D = 9;
const MESH = 40;
/** past this many triangles to repeat, it's too much to make */
const MAX_TRIANGLES = 200000;
const RED = 0xd8342b;

/** The dialog's last values, kept for the next time. */
const settings: ArrayOptions & { showBase: boolean } = { ...newArrayOptions(), showBase: true };

/** The selected objects at the level being edited. */
function selectedObjects(): ObjectInfo[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  return s.doc.objects(layerId).filter((o) => store.selection.has(o.id) && o.parentId === store.editGroupId && !isDerivedId(o.id));
}

interface Item {
  readonly object: ObjectInfo;
  /** in the model, a flat triangle list */
  readonly tris: number[] | null;
  /** or a line, as a flat x y z list */
  readonly line: { readonly points: number[]; readonly closed: boolean } | null;
}

/** A flat ring's triangles, facing up if it's level, as a flat list. */
function ringFaces(points: readonly (readonly number[])[]): number[] {
  const ring = points as unknown as Point3[];
  let up = 0;
  for (let i = 0; i < ring.length; i++) up += ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1];
  const round = up < 0 ? [...ring].reverse() : ring;
  return capTriangles(round).flatMap((t) => t.flatMap((i) => [...round[i]]));
}

/** What an object has to lay on a surface or be repeated: faces if it's closed and flat or solid, or a line. */
function itemOf(o: ObjectInfo): Item | null {
  const s = store.session;
  if (!s) return null;
  const path = s.curvePoints(o.id);
  if (path?.points.length && (o.type === POLY3D || o.type === LOCUS3D || !path.closed)) return { object: o, tris: null, line: { points: path.points.flat(), closed: path.closed } };
  if (path && path.points.length >= 3) {
    const cap = ringFaces(path.points);
    if (cap.length) return { object: o, tris: cap, line: null };
  }
  for (const faces of [() => s.solidTriangles(o.id), () => s.faceTriangles(o.id)]) {
    try {
      const raw = faces();
      if (raw.length) return { object: o, tris: Array.from(raw), line: null };
    } catch {
      // not that kind of object
    }
  }
  return null;
}

/** The faces a base would have: a flat closed shape, a closed 3D polygon on one plane, or an open surface. */
function baseOf(o: ObjectInfo): { object: ObjectInfo; base: BaseSurface; tris: readonly number[]; area: number } | null {
  const s = store.session;
  if (!s) return null;
  const path = s.curvePoints(o.id);
  let tris: ArrayLike<number> | null = null;
  if (path?.closed && path.points.length >= 3) {
    tris = ringFaces(path.points);
  } else if (!path) {
    try {
      tris = s.solidTriangles(o.id);
    } catch {
      return null;
    }
    if (isClosedMesh(tris)) return null;
  }
  if (!tris?.length) return null;
  const base = baseSurface(tris);
  return typeof base === "string" ? null : { object: o, base, tris: Array.from(tris), area: base.width * base.height };
}

export function canCreateSurfaceArray(): boolean {
  return selectedObjects().length >= 2;
}

const numberInput = (label: string, value: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
const twoFields = (label: string, x: HTMLElement, y: HTMLElement): HTMLElement => h("div", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), x, y);
const select = (label: string, options: readonly (readonly [string, string])[], value: string): HTMLSelectElement => {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } }) as HTMLSelectElement;
  for (const [id, text] of options) el.append(h("option", { text, attrs: { value: id } }));
  el.value = value;
  return el;
};
const check = (text: string, on: boolean): { input: HTMLInputElement; row: HTMLElement } => {
  const input = h("input", { attrs: { type: "checkbox", "aria-label": text } }) as HTMLInputElement;
  input.checked = on;
  return { input, row: h("label", { cls: "menu-dialog-check" }, input, text) };
};

const REPEATS: readonly (readonly [Repeat, string])[] = [
  ["count", "No. of Repetitions"],
  ["distance", "Fixed Distance"],
];
const EDGES: readonly (readonly [EdgeCondition, string])[] = [
  ["overlap", "Overlap"],
  ["omit", "Omit"],
  ["trim", "Trim"],
];

/** Model > Create Surface Array…: the dialog, then the group. */
export async function surfaceArrayDialog(): Promise<void> {
  const app = appContext();
  const layerId = store.activeLayerId;
  const objects = selectedObjects();
  if (!app || !layerId) return;
  const bases = objects.flatMap((o) => baseOf(o) ?? []).sort((a, b) => b.area - a.area);
  if (!bases.length) {
    toast("Select a flat object or open surface for the base, with what to repeat on it.", "info");
    return;
  }
  let which = 0;
  const units = store.session?.doc.info.units;
  const suffix = lengthSuffix(units);

  const originX = numberInput("Origin X' Factor", String(settings.originX));
  const originY = numberInput("Origin Y' Factor", String(settings.originY));
  const rotation = numberInput("Pattern Rotation", String(settings.rotation));
  const modeX = select("Repetition Mode X'", REPEATS, settings.modeX);
  const modeY = select("Repetition Mode Y'", REPEATS, settings.modeY);
  const countX = numberInput("No. of Repetitions X'", String(settings.countX));
  const countY = numberInput("No. of Repetitions Y'", String(settings.countY));
  const distanceX = numberInput("Fixed Distance X'", formatLengthValue(settings.distanceX, units));
  const distanceY = numberInput("Fixed Distance Y'", formatLengthValue(settings.distanceY, units));
  const offsetX = numberInput("Offset X' Factor", String(settings.offsetX));
  const offsetY = numberInput("Offset Y' Factor", String(settings.offsetY));
  const shiftX = numberInput("Shift X' Factor", String(settings.shiftX));
  const shiftY = numberInput("Shift Y' Factor", String(settings.shiftY));
  const edge = select("Edge Conditions", EDGES, settings.edge);
  const showBase = check("Display Base Surface", settings.showBase);
  const scaleZ = check("Scale Z' Value", settings.scaleZ);
  const flip = check("Switch Z' Direction", settings.flip);

  const whichLabel = h("span", { cls: "menu-dialog-label" });
  const prev = h("button", { cls: "btn small", text: "Prev", attrs: { type: "button" } }) as HTMLButtonElement;
  const next = h("button", { cls: "btn small", text: "Next", attrs: { type: "button" } }) as HTMLButtonElement;
  prev.disabled = next.disabled = bases.length < 2;
  const note = h("p", { cls: "muted" });

  const read = (): ArrayOptions | { error: string; focus: HTMLInputElement } => {
    const num = (el: HTMLInputElement, name: string, test: (v: number) => boolean = () => true): number | { error: string; focus: HTMLInputElement } => {
      const v = Number(el.value);
      return el.value.trim() !== "" && Number.isFinite(v) && test(v) ? v : { error: `${name}: enter a number${test === inRange ? " from -1 to 1" : ""}.`, focus: el };
    };
    const inRange = (v: number): boolean => Math.abs(v) <= 1;
    const whole = (v: number): boolean => Number.isInteger(v) && v >= 1 && v <= 1000;
    const length = (el: HTMLInputElement, name: string): number | { error: string; focus: HTMLInputElement } => {
      const v = parseLength(el.value, units);
      return v !== null && v > 0 ? v : { error: `${name}: enter a length more than 0.`, focus: el };
    };
    const got = {
      originX: num(originX, "Origin X' Factor", inRange),
      originY: num(originY, "Origin Y' Factor", inRange),
      rotation: num(rotation, "Pattern Rotation"),
      countX: num(countX, "No. of Repetitions X'", whole),
      countY: num(countY, "No. of Repetitions Y'", whole),
      distanceX: length(distanceX, "Fixed Distance X'"),
      distanceY: length(distanceY, "Fixed Distance Y'"),
      offsetX: num(offsetX, "Offset X' Factor"),
      offsetY: num(offsetY, "Offset Y' Factor"),
      shiftX: num(shiftX, "Shift X' Factor"),
      shiftY: num(shiftY, "Shift Y' Factor"),
    };
    for (const v of Object.values(got)) if (typeof v !== "number") return v;
    return {
      ...(got as Record<keyof typeof got, number>),
      modeX: modeX.value as Repeat,
      modeY: modeY.value as Repeat,
      edge: edge.value as EdgeCondition,
      scaleZ: scaleZ.input.checked,
      flip: flip.input.checked,
    };
  };

  const view = await app.show3d();
  const preview = (): void => {
    whichLabel.textContent = bases.length > 1 ? `Base surface ${which + 1} of ${bases.length}` : "Base surface";
    const options = read();
    const { base } = bases[which];
    const layout = "error" in options ? null : arrayLayout(base, options);
    note.textContent = "error" in options ? options.error : typeof layout === "string" ? layout : `${(layout?.cells.length ?? 0).toLocaleString("en")} items`;
    const lines = layout && typeof layout !== "string" && layout.cells.length <= 2000 ? cellLines(base, layout) : [];
    view?.setHighlightLines(lines, undefined, [{ segments: rimLines(base), color: RED }]);
  };
  const live = [originX, originY, rotation, modeX, modeY, countX, countY, distanceX, distanceY, offsetX, offsetY, shiftX, shiftY, edge];
  for (const el of live) el.addEventListener("input", preview);
  prev.addEventListener("click", () => {
    which = (which + bases.length - 1) % bases.length;
    preview();
  });
  next.addEventListener("click", () => {
    which = (which + 1) % bases.length;
    preview();
  });
  preview();

  const done = await showDialog<ArrayOptions>({
    title: "Create Surface Array",
    okLabel: "OK",
    cls: "surface-array-dialog",
    body: [
      h("div", { cls: "menu-dialog-field" }, whichLabel, prev, next),
      twoFields("Origin Factor (X', Y')", originX, originY),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Pattern Rotation" }), rotation, h("span", { cls: "menu-dialog-unit", text: "°" })),
      twoFields("Repetition Mode", modeX, modeY),
      twoFields("No. of Repetitions", countX, countY),
      twoFields(`Fixed Distance${suffix ? ` (${suffix})` : ""}`, distanceX, distanceY),
      twoFields("Offset Factor", offsetX, offsetY),
      twoFields("Shift Factor", shiftX, shiftY),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Edge Conditions" }), edge),
      showBase.row,
      scaleZ.row,
      flip.row,
      note,
    ],
    check: () => {
      const options = read();
      if ("error" in options) return options;
      const layout = arrayLayout(bases[which].base, options);
      return typeof layout === "string" ? { error: layout } : { value: options };
    },
  });
  view?.setHighlightLines(null);
  if (!done) return;
  Object.assign(settings, done, { showBase: showBase.input.checked });
  make(bases[which], done, showBase.input.checked);
}

/** A flat triangle list as faces, each carried by `above`. */
function facesOf(tris: readonly number[], above: (flat: readonly number[]) => number[]): number[][] {
  const faces: number[][] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) faces.push(above(tris.slice(i, i + 9)));
  return faces;
}

function make(chosen: { object: ObjectInfo; base: BaseSurface; tris: readonly number[] }, options: ArrayOptions, keepBase: boolean): void {
  const layerId = store.activeLayerId;
  const { base } = chosen;
  const layout = arrayLayout(base, options);
  if (!layerId || typeof layout === "string") return;
  const others = selectedObjects().filter((o) => o.id !== chosen.object.id);
  const items = others.flatMap((o) => itemOf(o) ?? []);
  if (!items.length) {
    toast("Select what to repeat too: nothing else selected can be laid on a surface.", "info");
    return;
  }
  const box = itemBox(items.map((i) => i.tris ?? i.line?.points ?? []));
  if (!box) return;
  const triangles = items.reduce((sum, i) => sum + (i.tris?.length ?? 0) / 9, 0) * layout.cells.length;
  if (triangles > MAX_TRIANGLES) {
    toast(`That would be more than ${MAX_TRIANGLES.toLocaleString("en")} faces: use fewer repetitions, or simpler items.`, "info");
    return;
  }
  const built = placed(base, layout, box, options, items);
  const elevation = store.session?.doc.layers().find((l) => l.id === layerId)?.elevation ?? 0;
  const above = (flat: readonly number[]): number[] => flat.map((v, i) => (i % 3 === 2 ? v - elevation : v));
  const made = attempt("Create Surface Array", (s) =>
    s.batch(() => {
      const ids: string[] = [];
      // as a mesh, which shows in both Top/Plan and 3D, as a 2D object wouldn't in 3D
      if (keepBase && chosen.object.type === MESH) ids.push(chosen.object.id);
      else if (keepBase) ids.push(...s.addMeshes(layerId, [facesOf(chosen.tris, above)], chosen.object.classIndex, chosen.object.attrs ?? undefined));
      for (const b of built) {
        if (b.faces.length) ids.push(...s.addMeshes(layerId, [facesOf(b.faces, above)], b.object.classIndex, b.object.attrs ?? undefined));
        for (const line of b.lines) {
          if (line.points.length === 3) ids.push(...s.add3DLoci(layerId, [above(line.points)], b.object.classIndex));
          else ids.push(s.add3DPolygons(layerId, [{ points: above(line.points), closed: line.closed }], b.object.classIndex));
        }
      }
      s.deleteObjects([...others.map((o) => o.id), ...(keepBase && chosen.object.type === MESH ? [] : [chosen.object.id])]);
      return ids.length > 1 ? [s.groupObjects(ids)] : ids;
    }),
  );
  if (made) setSelection(made.value);
  const left = others.length - items.length;
  toast(`Made ${layout.cells.length.toLocaleString("en")} items${left ? `; left out ${left} that can't be repeated, such as text` : ""}.`, "info");
}

/** Each item's copies on the cells, faces in one list. */
function placed(base: BaseSurface, layout: ArrayLayout, box: NonNullable<ReturnType<typeof itemBox>>, options: ArrayOptions, items: readonly Item[]): { object: ObjectInfo; faces: number[]; lines: { points: number[]; closed: boolean }[] }[] {
  const mapper = itemMapper(base, layout, box, options);
  let reach = 0;
  for (const i of items) {
    const list = i.tris ?? i.line?.points ?? [];
    for (let k = 2; k < list.length; k += 3) reach = Math.max(reach, list[k] - box.z0);
  }
  const k = options.scaleZ ? Math.max(layout.sizeX / Math.max(box.x1 - box.x0, 1e-9), layout.sizeY / Math.max(box.y1 - box.y0, 1e-9)) : 1;
  const trim = options.edge === "trim" ? trimmer(base, reach * Math.min(k, 1e6)) : null;
  return items.map((item) => {
    const faces: number[] = [];
    const lines: { points: number[]; closed: boolean }[] = [];
    for (const cell of layout.cells) {
      if (item.tris) {
        const copy = mapper.placeFaces(item.tris, cell);
        const kept = trim && cell.onEdge ? trim(copy) : copy;
        for (const v of kept) faces.push(v);
      } else if (item.line) {
        lines.push({ points: mapper.place(item.line.points, cell), closed: item.line.closed });
      }
    }
    return { object: item.object, faces, lines };
  });
}
