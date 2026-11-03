// Event Design's Create Lectern (Spotlight > Event in Vectorworks; Stage > Event here): pick one of
// Rodeo's lecterns (lecternShapes.ts) in a dialog that previews it from the front, the side and above,
// then click where it stands and click again the way it faces the audience. It goes in as an
// instance of a hybrid symbol: its outlines for Top/Plan, solids for 3D. A lectern as it comes is the
// symbol of its own name, made the first time and placed again after that; Custom Attributes makes a
// new symbol under a name typed, its parts in a class chosen (or made) that sets their look, or in
// None with the fill, pen and texture set here. Stood on a stage built in 3D (an extrude, a mesh or a
// symbol with solids under the first click), it rises to the stage's top.

import type { Attributes, EditSession, NewShape, Pt } from "../../../core/index.ts";
import { attempt, setEditGroup } from "../../../app/commands.ts";
import { placed } from "../../../app/detailShapes.ts";
import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { showDialog } from "../../../app/menubar.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { placeAtNextClick } from "../../../app/placeAt.ts";
import { mapSolid, type Point3 } from "../../../app/solids3d.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import type { Part } from "../../../app/tools/detailing.ts";
import { rotationAbout } from "../../../app/tools/rotate.ts";
import { formatLength } from "../../../app/units.ts";
import { facing, highestAt, LECTERNS, lecternNamed, lecternSize, planOutlines, viewFaces, type LecternKind, type LecternRole, type PreviewView } from "./lecternShapes.ts";

/** A stage this far above the layer at most is stood on (a truss overhead isn't), mm */
const STAND_LIMIT = 3000;
/** setObjectTexture's part for all of an object */
const WHOLE_OBJECT = 3;

interface Custom {
  readonly name: string;
  /** the class the parts go in, null for None; `newClass` makes one of that name instead */
  readonly classIndex: number | null;
  readonly newClass: string;
  readonly fill: string;
  readonly pen: string;
  /** a texture resource's name index, or -1 for none */
  readonly texture: number;
}

interface LecternChoice {
  readonly kind: LecternKind;
  readonly custom: Custom | null;
}

/** the dialog's last answers, kept for the next time */
let last = { kind: LECTERNS[0].name, custom: false };

const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

/** Stage > Event > Create Lectern…: the dialog, then the two clicks. */
export async function createLectern(): Promise<void> {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s) return;
  if (!layerId || s.doc.layers().find((l) => l.id === layerId)?.kind !== "design") {
    toast("Make a design layer active to place a lectern.", "info");
    return;
  }
  const choice = await lecternDialog();
  if (!choice || store.session !== s) return;
  const { kind } = choice;
  const outline = (at: Pt, deg: number): Part[] =>
    planOutlines(kind).map((o): Part => ({ kind: "polygon", points: placed(o.outline, at, (deg * Math.PI) / 180), closed: true }));
  placeAtNextClick({
    what: kind.name,
    hint: `${choice.custom?.name ?? kind.name}: click where it stands · Esc cancels`,
    preview: (at) => outline(at, 0),
    place: (at) =>
      void placeAtNextClick({
        what: kind.name,
        hint: "Click the way the lectern faces the audience · Shift 15° · Esc cancels",
        from: at,
        preview: (to) => [...outline(at, facing(at, to)), { kind: "line", a: at, b: to }],
        place: (to) => placeLectern(choice, layerId, at, facing(at, to)),
      }),
  });
}

/** Places the lectern at `at` turned `deg`°, on top of the stage under it, and selects it. */
function placeLectern(choice: LecternChoice, layerId: string, at: Pt, deg: number): void {
  const s = store.session;
  if (!s) return;
  const ground = s.doc.layers().find((l) => l.id === layerId)?.elevation ?? 0;
  const top = stageTop(layerId, at, ground);
  const lift = top !== null && top - ground > 1 ? top - ground : 0;
  const r = attempt("Create Lectern", (s) =>
    s.batch(() => {
      const id = lecternInstance(s, choice, layerId, at);
      if (deg !== 0) s.transformObjects([id], rotationAbout(at, (deg * Math.PI) / 180));
      if (lift > 0) s.moveObjects3D([id], 0, 0, lift);
      return id;
    }),
  );
  if (!r) return;
  setEditGroup(null, [r.value]);
  if (lift > 0) toast(`The lectern stands on the stage, ${formatLength(lift, s.doc.info.units)} up.`, "info");
}

/** An instance of the lectern's symbol at `at`, the symbol made first when the drawing hasn't it. */
function lecternInstance(s: EditSession, { kind, custom }: LecternChoice, layerId: string, at: Pt): string {
  const name = custom?.name ?? kind.name;
  const known = custom ? undefined : s.doc.symbolDefs().find((d) => d.name === name);
  if (known) return s.insertSymbol(layerId, known.index, at, store.activeClassIndex);
  const cls = custom?.newClass ? s.createClass(custom.newClass) : (custom?.classIndex ?? undefined);
  const match = colorMatcher();
  const ink = (hex: string): number => match(hexToRgb(hex));
  const look = (role: LecternRole): Partial<Attributes> => {
    const fill = ink(custom ? custom.fill : kind.fills[role]);
    return { penFore: ink(custom ? custom.pen : kind.pen), fillPattern: 1, fillFore: fill, fillBack: fill, fillOpacity: kind.opacity };
  };
  const outlines = planOutlines(kind);
  const shapes = outlines.map((o): NewShape => ({ kind: "polygon", points: placed(o.outline, at, 0), closed: true }));
  const plan = s.addObjects(layerId, shapes, cls, outlines.map((o) => look(o.role)));
  const solids = kind.parts.map((p) => mapSolid(p.solid, ([x, y, z]): Point3 => [x + at.x, y + at.y, z]));
  const meshes = s.addMeshes(layerId, solids, cls, kind.parts.map((p) => look(p.role)));
  if (cls !== undefined) {
    // a class sets the look: its fill, pen and texture
    for (const group of ["fill", "penColor"] as const) s.setAttributesByClass([...plan, ...meshes], group, true);
    for (const m of meshes) s.setObjectTexture(m, WHOLE_OBJECT, { texture: 0 });
  } else if (custom && custom.texture > 0) {
    for (const m of meshes) s.setObjectTexture(m, WHOLE_OBJECT, { texture: custom.texture });
  }
  const id = s.createSymbol([...plan, ...meshes], name, at);
  s.setObjectClass([id], store.activeClassIndex);
  return id;
}

/**
 * The top of the stage under `at`: the highest face, not upright, of the active layer's 3D objects
 * there, up to STAND_LIMIT above the layer; null over the bare floor.
 */
export function stageTop(layerId: string, at: Pt, ground: number): number | null {
  const ctx = appContext();
  const s = store.session;
  if (!ctx || !s) return null;
  const seen = new Set<string>();
  let best: number | null = null;
  for (const obj of ctx.scene.index(layerId).objects) {
    const box = obj.shape ? ctx.scene.geometry(obj)?.bbox : linesBox(obj.planLines);
    if (!box || at.x < box.x0 || at.x > box.x1 || at.y < box.y0 || at.y > box.y1) continue;
    // a group's or symbol's parts all give the whole of it
    let top = obj;
    for (let up = obj.parentId; up !== null; ) {
      const o = s.doc.object(up);
      if (!o) break;
      top = o;
      up = o.parentId;
    }
    if (seen.has(top.id)) continue;
    seen.add(top.id);
    const z = highestAt(s.faceTriangles(top.id), at, ground + STAND_LIMIT);
    if (z !== null && (best === null || z > best)) best = z;
  }
  return best;
}

function linesBox(lines: readonly Pt[] | undefined): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!lines?.length) return null;
  const xs = lines.map((p) => p.x);
  const ys = lines.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const VIEWS: readonly { readonly view: PreviewView; readonly label: string }[] = [
  { view: "front", label: "Front" },
  { view: "side", label: "Side" },
  { view: "top", label: "Top" },
];
/** each view's cell in the preview, and the room round it and under it for its name, px */
const CELL_W = 128;
const CELL_H = 150;
const PAD = 10;
const LABEL = 16;

/** The lectern from the front, the side and above, one scale for all three, as SVG. */
function previewSvg(kind: LecternKind, fill: (role: LecternRole) => string, pen: string): string {
  const views = VIEWS.map((v) => ({ ...v, faces: viewFaces(kind, v.view) }));
  const boxes = views.map((v) => {
    const pts = v.faces.flatMap((f) => f.points);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  });
  const k = Math.min(...boxes.map((b) => Math.min((CELL_W - 2 * PAD) / (b.x1 - b.x0 || 1), (CELL_H - LABEL - 2 * PAD) / (b.y1 - b.y0 || 1))));
  const opacity = kind.opacity / 100;
  const cells = views.map((v, i) => {
    const b = boxes[i];
    const ox = i * CELL_W + CELL_W / 2 - (k * (b.x0 + b.x1)) / 2;
    const oy = (CELL_H - LABEL) / 2 + (k * (b.y0 + b.y1)) / 2;
    const faces = v.faces
      .map((f) => {
        const pts = f.points.map((p) => `${(ox + k * p.x).toFixed(1)},${(oy - k * p.y).toFixed(1)}`).join(" ");
        return `<polygon points="${pts}" fill="${fill(f.role)}" fill-opacity="${opacity}" stroke="${pen}" stroke-width="0.6" stroke-linejoin="round"/>`;
      })
      .join("");
    return `${faces}<text x="${i * CELL_W + CELL_W / 2}" y="${CELL_H - 4}" text-anchor="middle" font-size="11" fill="currentColor">${v.label}</text>`;
  });
  return `<svg viewBox="0 0 ${CELL_W * VIEWS.length} ${CELL_H}" width="${CELL_W * VIEWS.length}" height="${CELL_H}" role="img" aria-label="${kind.name} from the front, the side and above">${cells.join("")}</svg>`;
}

/** The Create Lectern dialog; null when cancelled. */
async function lecternDialog(): Promise<LecternChoice | null> {
  const doc = store.session?.doc;
  if (!doc) return null;
  const units = doc.info.units;
  const taken = (name: string): boolean => doc.resources().some((r) => r.name === name);
  const freeName = (base: string): string => {
    let n = 1;
    while (taken(n === 1 ? base : `${base} ${n}`)) n++;
    return n === 1 ? base : `${base} ${n}`;
  };
  const field = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
  const colour = (label: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", attrs: { type: "color", "aria-label": label, style: "width: 64px; padding: 2px" } });

  const kindSelect = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Choose Lectern" } }, ...LECTERNS.map((k) => h("option", { value: k.name, text: k.name })));
  kindSelect.value = lecternNamed(last.kind).name;
  const picture = h("div", { attrs: { style: "display: flex; justify-content: center; margin: 4px 0 0" } });
  const size = h("div", { cls: "muted", attrs: { style: "text-align: center; margin-bottom: 8px" } });
  const custom = h("input", { checked: last.custom, attrs: { type: "checkbox" } });
  const name = h("input", { cls: "menu-dialog-input", attrs: { type: "text", "aria-label": "New Symbol Name" } });
  const classes = doc.classes().filter((c) => c.name !== "None");
  const classSelect = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Class" } },
    h("option", { value: "none", text: "None" }),
    ...classes.map((c) => h("option", { value: String(c.index), text: c.name })),
    h("option", { value: "new", text: "New Class…" }),
  );
  const newClass = h("input", { cls: "menu-dialog-input", attrs: { type: "text", "aria-label": "New Class Name" } });
  const newClassRow = field("New Class Name", newClass);
  const fill = colour("Fill Color");
  const pen = colour("Pen Color");
  const textures = doc
    .resources()
    .filter((r) => r.kind === "texture")
    .sort((a, b) => a.name.localeCompare(b.name));
  const texture = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Texture" }, title: textures.length ? "" : "This drawing has no textures" },
    h("option", { value: "-1", text: "None" }),
    ...textures.map((t) => h("option", { value: String(t.index), text: t.name })),
  );

  let typedName = false;
  name.addEventListener("input", () => (typedName = true));
  const kind = (): LecternKind => lecternNamed(kindSelect.value);
  const sync = (): void => {
    const on = custom.checked;
    const byClass = classSelect.value !== "none";
    name.disabled = classSelect.disabled = !on;
    newClassRow.hidden = !on || classSelect.value !== "new";
    fill.disabled = pen.disabled = !on || byClass;
    texture.disabled = !on || byClass || !textures.length;
    const k = kind();
    const own = !on || byClass;
    picture.innerHTML = previewSvg(k, (role) => (own ? k.fills[role] : fill.value), own ? k.pen : pen.value);
    const sz = lecternSize(k);
    size.textContent = `${formatLength(sz.width, units)} wide · ${formatLength(sz.depth, units)} deep · ${formatLength(sz.height, units)} high`;
  };
  const choose = (): void => {
    const k = kind();
    fill.value = k.fills.desk;
    pen.value = k.pen;
    if (!typedName) name.value = freeName(`${k.name} Custom`);
    sync();
  };
  kindSelect.addEventListener("change", choose);
  for (const el of [custom, classSelect, fill, pen]) el.addEventListener("input", sync);
  classSelect.addEventListener("change", sync);
  choose();

  const choice = await showDialog<LecternChoice>({
    title: "Create Lectern",
    okLabel: "OK",
    body: [
      field("Choose Lectern", kindSelect),
      picture,
      size,
      h("label", { cls: "menu-dialog-check" }, custom, "Custom Attributes"),
      field("New Symbol Name", name),
      field("Class", classSelect),
      newClassRow,
      field("Fill Color", fill),
      field("Pen Color", pen),
      field("Texture", texture),
      h("p", { cls: "muted", text: "Click where the lectern stands, then click the way it faces the audience. On a stage built in 3D it stands on the stage's top." }),
    ],
    check: () => {
      const k = kind();
      if (!custom.checked) {
        if (taken(k.name) && !doc.symbolDefs().some((d) => d.name === k.name)) return { error: `${k.name} names another resource here: use Custom Attributes to name the lectern's symbol.`, focus: custom };
        return { value: { kind: k, custom: null } };
      }
      const symbolName = name.value.trim();
      if (!symbolName) return { error: "New Symbol Name: enter a name for the lectern's symbol.", focus: name };
      if (taken(symbolName)) return { error: `A resource named ${symbolName} is in the drawing already.`, focus: name };
      const making = classSelect.value === "new";
      const className = newClass.value.trim();
      if (making && !className) return { error: "New Class Name: enter a name for the class.", focus: newClass };
      if (making && doc.classes().some((c) => c.name === className)) return { error: `A class named ${className} is in the drawing already: choose it in the list.`, focus: newClass };
      return {
        value: {
          kind: k,
          custom: {
            name: symbolName,
            classIndex: making || classSelect.value === "none" ? null : Number(classSelect.value),
            newClass: making ? className : "",
            fill: fill.value,
            pen: pen.value,
            texture: Number(texture.value),
          },
        },
      };
    },
  });
  if (choice) last = { kind: choice.kind.name, custom: choice.custom !== null };
  return choice;
}
