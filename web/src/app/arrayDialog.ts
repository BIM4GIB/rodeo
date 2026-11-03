// Edit > Duplicate Array… and Modify > Create Symbol…: the two dialogs that take numbers or a
// choice of their own. Duplicate Array makes its copies in a line, a grid or a circle, in one undo
// step, and selects the original with the copies. Create Symbol turns the selection into a symbol
// definition and selects the new instance. Both use the in-page dialog shell from menubar.ts.

import type { Affine, BBox, Pt } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { degToRad, unionBBox } from "./geom.ts";
import { showDialog, type DialogCheck } from "./menubar.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";
import "./arrayDialog.css";

/** Most copies one Duplicate Array makes. */
const MAX_COPIES = 1000;

/** Where each copy goes: rotated by `turn` degrees about `pivot`, then moved by `move`. */
export interface CopyPlan {
  readonly pivot: Pt;
  readonly turn: number;
  readonly move: Pt;
}

export type ArraySpec =
  | {
      readonly mode: "linear";
      readonly copies: number;
      readonly dx: number;
      readonly dy: number;
      readonly turn: number;
    }
  | {
      readonly mode: "grid";
      readonly rows: number;
      readonly cols: number;
      readonly rowGap: number;
      readonly colGap: number;
    }
  | {
      readonly mode: "circular";
      readonly copies: number;
      readonly angle: number;
      readonly centre: Pt;
      readonly rotate: boolean;
    };

type Mode = ArraySpec["mode"];

const MODES: readonly { readonly mode: Mode; readonly label: string }[] = [
  { mode: "linear", label: "Linear" },
  { mode: "grid", label: "Rectangular" },
  { mode: "circular", label: "Circular" },
];

/**
 * Where the copies of an array go, for a selection whose centre is `c`. The original is not in the
 * list. Linear copies turn about `c` by k times the rotation and move k times the offset. Grid
 * copies only move. Circular copies travel round the centre by k times the step (the step is
 * 360 over copies + 1 for a full turn, so the original takes a place in the circle, and angle over
 * copies for less); they turn with the trip only when `rotate` is set.
 */
export function planCopies(spec: ArraySpec, c: Pt): CopyPlan[] {
  const out: CopyPlan[] = [];
  switch (spec.mode) {
    case "linear":
      for (let k = 1; k <= spec.copies; k++) {
        out.push({ pivot: c, turn: k * spec.turn, move: { x: k * spec.dx, y: k * spec.dy } });
      }
      break;
    case "grid":
      for (let i = 0; i < spec.rows; i++) {
        for (let j = 0; j < spec.cols; j++) {
          if (i === 0 && j === 0) continue;
          out.push({ pivot: c, turn: 0, move: { x: j * spec.colGap, y: i * spec.rowGap } });
        }
      }
      break;
    case "circular": {
      const full = Math.abs(spec.angle) >= 360;
      const step = spec.angle / (full ? spec.copies + 1 : spec.copies);
      const o = spec.centre;
      for (let k = 1; k <= spec.copies; k++) {
        const phi = k * step;
        // the centre of the selection goes round the circle: turning (c - o) by phi and adding o - c
        const r = turnVec({ x: c.x - o.x, y: c.y - o.y }, phi);
        out.push({
          pivot: c,
          turn: spec.rotate ? phi : 0,
          move: { x: r.x + o.x - c.x, y: r.y + o.y - c.y },
        });
      }
      break;
    }
  }
  return out;
}

// ---- geometry -------------------------------------------------------------------

/** sin and cos of an angle, with the tiny residues at right angles taken out. */
function sinCos(deg: number): { readonly s: number; readonly c: number } {
  const t = degToRad(deg);
  const clean = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : v);
  return { s: clean(Math.sin(t)), c: clean(Math.cos(t)) };
}

/** The vector v turned counter-clockwise by deg degrees. */
function turnVec(v: Pt, deg: number): Pt {
  const { s, c } = sinCos(deg);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

/** Turns points counter-clockwise by deg degrees about p (the same transform as rotateBy). */
function turnAbout(p: Pt, deg: number): Affine {
  const { s, c } = sinCos(deg);
  return { a: c, b: s, c: -s, d: c, e: p.x - c * p.x + s * p.y, f: p.y - s * p.x - c * p.y };
}

function centreOf(box: BBox): Pt {
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
}

/** Bounds of the selection (each selected object with its contents), or null when nothing has geometry. */
function selectionBox(scene: Scene): BBox | null {
  const layerId = store.activeLayerId;
  if (!layerId) return null;
  let box: BBox | null = null;
  for (const e of scene.topLevelEntries(layerId, store.editGroupId)) {
    if (e.bbox && store.selection.has(e.id)) box = unionBBox(box, e.bbox);
  }
  return box;
}

// ---- Duplicate Array -------------------------------------------------------------

/** A labelled number field: its row for the dialog and its input. */
function numberField(
  label: string,
  value: string,
  unit = "",
): { readonly row: HTMLElement; readonly input: HTMLInputElement } {
  const input = h("input", {
    cls: "menu-dialog-input",
    value,
    attrs: { type: "text", inputmode: "decimal", "aria-label": label },
  });
  const row = h(
    "label",
    { cls: "menu-dialog-field" },
    h("span", { cls: "menu-dialog-label", text: label }),
    input,
    unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null,
  );
  return { row, input };
}

/** A number typed in a field (a comma counts as a point), or null when it is not one. */
function numberOf(input: HTMLInputElement): number | null {
  const text = input.value.trim().replace(",", ".");
  const n = Number(text);
  return text !== "" && Number.isFinite(n) ? n : null;
}

/** A length field: its text is read in the document's units (a bare number is in them), and the result is millimetres. */
function readLength(input: HTMLInputElement, label: string, units: string | undefined): Read {
  const mm = parseLength(input.value, units);
  return mm === null ? { error: `${label}: enter a length.`, focus: input } : { value: mm };
}

interface Rule {
  readonly integer?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly nonZero?: boolean;
}

/** One field read: its number, or the message and the field to focus. */
type Read = { readonly value: number } | { readonly error: string; readonly focus: HTMLInputElement };

function read(input: HTMLInputElement, label: string, rule: Rule = {}): Read {
  const n = numberOf(input);
  if (n === null) return { error: `${label}: enter a number.`, focus: input };
  if (rule.integer && !Number.isInteger(n)) return { error: `${label}: enter a whole number.`, focus: input };
  if (rule.min !== undefined && n < rule.min) return { error: `${label}: must be at least ${rule.min}.`, focus: input };
  if (rule.max !== undefined && n > rule.max) return { error: `${label}: must be at most ${rule.max}.`, focus: input };
  if (rule.nonZero && n === 0) return { error: `${label}: must not be 0.`, focus: input };
  return { value: n };
}

/** The values of all reads in order, or the first failure. */
function gather(
  reads: readonly Read[],
): { readonly value: number[] } | { readonly error: string; readonly focus: HTMLInputElement } {
  const values: number[] = [];
  for (const r of reads) {
    if ("error" in r) return r;
    values.push(r.value);
  }
  return { value: values };
}

/** Edit > Duplicate Array…: asks for the mode and its numbers, then makes the copies in one step. */
export async function duplicateArrayDialog(scene: Scene): Promise<void> {
  const doc = store.session?.doc;
  const ids = [...store.selection];
  if (!doc || ids.length === 0) return;
  const units = doc.info.units;
  const unit = lengthSuffix(units);
  const box = selectionBox(scene);
  const w = box ? box.x1 - box.x0 : 0;
  const ht = box ? box.y1 - box.y0 : 0;
  const c = box ? centreOf(box) : { x: 0, y: 0 };

  const select = h(
    "select",
    { cls: "array-select", attrs: { "aria-label": "Array type" } },
    ...MODES.map((m) => h("option", { text: m.label, value: m.mode })),
  );
  const lin = {
    copies: numberField("Copies", "2"),
    dx: numberField("X offset", formatLengthValue(w, units), unit),
    dy: numberField("Y offset", formatLengthValue(0, units), unit),
    turn: numberField("Rotation per copy", "0", "°"),
  };
  const grid = {
    rows: numberField("Rows", "2"),
    cols: numberField("Columns", "2"),
    rowGap: numberField("Row spacing", formatLengthValue(ht, units), unit),
    colGap: numberField("Column spacing", formatLengthValue(w, units), unit),
  };
  // the default centre sits one selection-width to the right of the selection, so the copies
  // do not start on top of the original
  const circ = {
    copies: numberField("Copies", "5"),
    angle: numberField("Total angle", "360", "°"),
    cx: numberField("Centre X", formatLengthValue(c.x + w, units), unit),
    cy: numberField("Centre Y", formatLengthValue(c.y, units), unit),
  };
  const rotate = h("input", { attrs: { type: "checkbox" }, checked: true });

  const groups: Record<Mode, HTMLElement> = {
    linear: h(
      "div",
      { cls: "array-group" },
      lin.copies.row,
      lin.dx.row,
      lin.dy.row,
      lin.turn.row,
      h("p", {
        cls: "array-hint",
        text: "Copies are added to the original. Each copy moves by its number times the offset.",
      }),
    ),
    grid: h(
      "div",
      { cls: "array-group" },
      grid.rows.row,
      grid.cols.row,
      grid.rowGap.row,
      grid.colGap.row,
      h("p", { cls: "array-hint", text: "Rows and columns count the original." }),
    ),
    circular: h(
      "div",
      { cls: "array-group" },
      circ.copies.row,
      circ.angle.row,
      circ.cx.row,
      circ.cy.row,
      h("label", { cls: "array-check" }, rotate, h("span", { text: "Rotate copies" })),
      h("p", {
        cls: "array-hint",
        text: "A full turn spreads the copies and the original evenly round the centre. "
          + "Less spreads them from the original to that angle.",
      }),
    ),
  };
  const showGroup = (): void => {
    for (const m of MODES) groups[m.mode].hidden = select.value !== m.mode;
  };
  select.addEventListener("change", showGroup);
  showGroup();

  const check = (): DialogCheck<ArraySpec> => {
    const mode = select.value as Mode;
    if (mode === "linear") {
      const r = gather([
        read(lin.copies.input, "Copies", { integer: true, min: 1, max: MAX_COPIES }),
        readLength(lin.dx.input, "X offset", units),
        readLength(lin.dy.input, "Y offset", units),
        read(lin.turn.input, "Rotation per copy"),
      ]);
      if ("error" in r) return r;
      const [copies, dx, dy, turn] = r.value;
      return { value: { mode, copies, dx, dy, turn } };
    }
    if (mode === "grid") {
      const r = gather([
        read(grid.rows.input, "Rows", { integer: true, min: 1, max: MAX_COPIES + 1 }),
        read(grid.cols.input, "Columns", { integer: true, min: 1, max: MAX_COPIES + 1 }),
        readLength(grid.rowGap.input, "Row spacing", units),
        readLength(grid.colGap.input, "Column spacing", units),
      ]);
      if ("error" in r) return r;
      const [rows, cols, rowGap, colGap] = r.value;
      if (rows * cols < 2) return { error: "The array needs at least two objects.", focus: grid.rows.input };
      if (rows * cols - 1 > MAX_COPIES) {
        return {
          error: `At most ${MAX_COPIES} copies: rows times columns minus one is ${rows * cols - 1}.`,
          focus: grid.rows.input,
        };
      }
      return { value: { mode, rows, cols, rowGap, colGap } };
    }
    const r = gather([
      read(circ.copies.input, "Copies", { integer: true, min: 1, max: MAX_COPIES }),
      read(circ.angle.input, "Total angle", { nonZero: true }),
      readLength(circ.cx.input, "Centre X", units),
      readLength(circ.cy.input, "Centre Y", units),
    ]);
    if ("error" in r) return r;
    const [copies, angle, cx, cy] = r.value;
    return { value: { mode, copies, angle, centre: { x: cx, y: cy }, rotate: rotate.checked } };
  };

  const spec = await showDialog<ArraySpec>({
    title: "Duplicate Array",
    okLabel: "Duplicate",
    cls: "array-dialog",
    body: [
      h(
        "label",
        { cls: "menu-dialog-field" },
        h("span", { cls: "menu-dialog-label", text: "Array" }),
        select,
      ),
      groups.linear,
      groups.grid,
      groups.circular,
    ],
    check,
  });
  if (!spec) return;

  const plans = planCopies(spec, c);
  const r = attempt("Duplicate Array", (s) =>
    s.batch(() => {
      const made: string[] = [];
      for (const p of plans) {
        const copy = s.duplicateObjects(ids, p.move.x, p.move.y);
        // the copy is already moved, so it turns about the pivot moved by the same amount
        if (p.turn !== 0) {
          s.transformObjects(copy, turnAbout({ x: p.pivot.x + p.move.x, y: p.pivot.y + p.move.y }, p.turn));
        }
        made.push(...copy);
      }
      return made;
    }),
  );
  if (r) setSelection([...ids, ...r.value]);
}

// ---- Create Symbol ----------------------------------------------------------------

/** Modify > Create Symbol…: names the new symbol and picks its insertion point, then makes it. */
export async function createSymbolDialog(scene: Scene): Promise<void> {
  const session = store.session;
  const ids = [...store.selection];
  if (!session || ids.length === 0) return;
  const taken = new Set(session.doc.symbolDefs().map((d) => d.name));
  let n = 1;
  while (taken.has(`Symbol-${n}`)) n++;
  const box = selectionBox(scene);

  const name = h("input", {
    cls: "menu-dialog-input array-name",
    value: `Symbol-${n}`,
    attrs: { type: "text", "aria-label": "Symbol name" },
  });
  const where = h(
    "select",
    { cls: "array-select", attrs: { "aria-label": "Insertion point" } },
    h("option", { text: "Centre of selection", value: "centre" }),
    h("option", { text: "Bottom-left of selection", value: "bottom-left" }),
    h("option", { text: "Drawing origin (0, 0)", value: "origin" }),
  );

  const value = await showDialog<{ readonly name: string; readonly at: Pt | undefined }>({
    title: "Create Symbol",
    okLabel: "Create",
    cls: "array-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), name),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Insertion point" }), where),
    ],
    check: () => {
      const text = name.value.trim();
      if (!text) return { error: "Enter a name for the symbol.", focus: name };
      const pick = where.value;
      if (pick !== "origin" && !box) return { error: "These objects have no extent to place the symbol from." };
      let at: Pt | undefined;
      if (pick === "origin") at = { x: 0, y: 0 };
      else if (pick === "bottom-left" && box) at = { x: box.x0, y: box.y0 };
      else if (box) at = centreOf(box);
      return { value: { name: text, at } };
    },
  });
  if (!value) return;

  const r = attempt("Create Symbol", (s) => s.createSymbol(ids, value.name, value.at));
  if (r) setSelection([r.value]);
}
