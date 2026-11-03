// Resources > Edit Hatch, New Hatch and Duplicate Hatch: a hatch's name, its
// ground colour, whether its sizes are on the printed page or in the world, and
// its levels, as Vectorworks' Edit Hatch dialog sets them. Each level is a
// family of parallel lines: its angle, the spacing between neighbours and how
// far each is shifted along from the last, its dash (the repeat and how much of
// it is drawn), a start point, colour and weight. A preview follows every
// change, and the hatch's own previews are drawn anew from it on OK. The
// change is one undo step.

import type { HatchFill, HatchLine, Pt, ResourceInfo, VwxDocument } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { colorSwatch } from "./panels/colorPicker.ts";
import { previewPngs, previewSizes } from "./resourcePreview.ts";
import { store } from "./state.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";
import "./hatchEditor.css";

const WHITE = 256;
const BLACK = 257;
/** the dialog's preview, CSS pixels */
const PREVIEW_PX = 168;
/** lines drawn into one preview at most (a stipple hatch has thousands of levels) */
const MAX_SEGMENTS = 40000;
/** spacing below which a level would draw solid (mm) */
const MIN_SPACING = 1e-4;

/** One level as the dialog edits it: angles in degrees, sizes in mm. */
interface Level {
  angle: number;
  spacing: number;
  shift: number;
  repeat: number;
  dash: number;
  base: Pt;
  color: number;
  weight: number;
  /** the line as the file had it, kept while nothing about it changes */
  orig: HatchLine | null;
}

function levelOf(l: HatchLine): Level {
  const len = Math.hypot(l.period.x, l.period.y);
  const u = len > 0 ? { x: l.period.x / len, y: l.period.y / len } : { x: 1, y: 0 };
  return {
    angle: (Math.atan2(u.y, u.x) * 180) / Math.PI,
    spacing: l.offset.y * u.x - l.offset.x * u.y,
    shift: l.offset.x * u.x + l.offset.y * u.y,
    repeat: len,
    dash: l.dash,
    base: { ...l.base },
    color: l.color,
    weight: l.weight,
    orig: l,
  };
}

function lineOf(v: Level): HatchLine {
  if (v.orig) return v.orig;
  const a = (v.angle * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  return {
    base: { ...v.base },
    period: { x: v.repeat * u.x, y: v.repeat * u.y },
    offset: { x: v.shift * u.x - v.spacing * u.y, y: v.shift * u.y + v.spacing * u.x },
    dash: v.dash,
    color: v.color,
    weight: v.weight,
  };
}

/** Paints `hatch` over its ground across a square canvas of `px` device pixels. */
function paintHatch(canvas: HTMLCanvasElement, px: number, hatch: HatchFill, doc: VwxDocument): void {
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = doc.color(hatch.background);
  ctx.fillRect(0, 0, px, px);
  const gaps = hatch.lines.map((l) => {
    const len = Math.hypot(l.period.x, l.period.y);
    return len > 0 ? Math.abs((l.offset.y * l.period.x - l.offset.x * l.period.y) / len) : 0;
  });
  const usable = gaps.filter((g) => g > MIN_SPACING);
  if (!usable.length) return;
  // enough of it to see the pattern: eight of the closest lines across, more for wider levels
  const least = Math.min(...usable);
  const span = Math.min(40 * least, Math.max(8 * least, Math.max(...usable)));
  const k = px / span;
  ctx.setTransform(k, 0, 0, -k, 0, px);
  ctx.lineWidth = Math.max(1, px / 128) / k;
  ctx.lineCap = "butt";
  const corners = [0, 0, span, 0, span, span, 0, span];
  let segs = 0;
  hatch.lines.forEach((l, i) => {
    const len = Math.hypot(l.period.x, l.period.y);
    const gap = gaps[i];
    if (!(len > 0) || gap <= MIN_SPACING || segs >= MAX_SEGMENTS) return;
    const ux = l.period.x / len;
    const uy = l.period.y / len;
    const signed = l.offset.y * ux - l.offset.x * uy;
    let lo = Infinity;
    let hi = -Infinity;
    for (let c = 0; c < 8; c += 2) {
      const v = ((corners[c + 1] - l.base.y) * ux - (corners[c] - l.base.x) * uy) / signed;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const path = new Path2D();
    const on = l.dash * len;
    for (let j = Math.ceil(lo); j <= hi && segs < MAX_SEGMENTS; j++) {
      const x = l.base.x + j * l.offset.x;
      const y = l.base.y + j * l.offset.y;
      let t0 = Infinity;
      let t1 = -Infinity;
      for (let c = 0; c < 8; c += 2) {
        const t = (corners[c] - x) * ux + (corners[c + 1] - y) * uy;
        t0 = Math.min(t0, t);
        t1 = Math.max(t1, t);
      }
      if (l.dash >= 1) {
        path.moveTo(x + t0 * ux, y + t0 * uy);
        path.lineTo(x + t1 * ux, y + t1 * uy);
        segs++;
        continue;
      }
      if (on <= 0) continue;
      for (let n = Math.floor(t0 / len); n * len <= t1 && segs < MAX_SEGMENTS; n++) {
        const a = Math.max(t0, n * len);
        const e = Math.min(t1, n * len + on);
        if (e <= a) continue;
        path.moveTo(x + a * ux, y + a * uy);
        path.lineTo(x + e * ux, y + e * uy);
        segs++;
      }
    }
    ctx.strokeStyle = doc.color(l.color);
    ctx.stroke(path);
  });
}

/** A hatch's previews, painted in `doc`'s colours at the sizes `own` (the hatch edited or copied) or the drawing's hatches have. */
export function hatchPreviews(doc: VwxDocument, hatch: HatchFill, own?: ResourceInfo): Map<number, Uint8Array> {
  return previewPngs(previewSizes(doc, "hatch", own), (c, w) => paintHatch(c, w, hatch, doc));
}

/** New Hatch…: one level of lines at 45°, black on white, sized on the page. */
export function newHatch(): Promise<void> {
  return openEditor(null, "New Hatch", {
    page: true,
    background: WHITE,
    lines: [lineOf({ angle: 45, spacing: 2, shift: 0, repeat: 2, dash: 1, base: { x: 0, y: 0 }, color: BLACK, weight: 4, orig: null })],
  });
}

/** Edit Hatch…: the hatch with name index `index`. */
export function editHatch(index: number): Promise<void> {
  const res = store.session?.doc.resources().find((r) => r.kind === "hatch" && r.index === index);
  if (!res?.hatch) return Promise.resolve();
  return openEditor(index, res.name, res.hatch);
}

/** Duplicate…: a copy of the hatch, its tags too, to change. */
export function duplicateHatch(index: number): Promise<void> {
  const res = store.session?.doc.resources().find((r) => r.kind === "hatch" && r.index === index);
  if (!res?.hatch) return Promise.resolve();
  return openEditor(null, res.name, res.hatch, index);
}

/** The dialog: `index` is the hatch edited (null for a new one); `like`, the one a duplicate copies. */
async function openEditor(index: number | null, name: string, start: HatchFill, like?: number): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const units = doc.info.units;
  const suffix = lengthSuffix(units);
  const resources = doc.resources();
  const taken = new Set([
    ...doc.classes().map((c) => c.name),
    ...doc.layers().map((l) => l.name),
    ...doc.stories().map((s) => s.name),
    ...resources.filter((r) => r.index !== index).map((r) => r.name),
  ]);
  let firstName = name;
  if (index === null) {
    const base = like === undefined ? "Hatch" : name.replace(/-\d+$/, "");
    let n = like === undefined ? 1 : 2;
    while (taken.has(`${base}-${n}`)) n++;
    firstName = `${base}-${n}`;
  }
  const levels = start.lines.map(levelOf);
  let ground = start.background;
  let selected = 0;
  const bad = new Set<HTMLInputElement>();

  const nameInput = h("input", { cls: "menu-dialog-input hatch-name", value: firstName, attrs: { type: "text", "aria-label": "Name", spellcheck: "false" } });
  const page = h("input", { checked: start.page, attrs: { type: "checkbox" } });
  const groundCell = h("span", { cls: "hatch-ground" });
  const preview = h("canvas", { cls: "hatch-preview", attrs: { "aria-label": "Preview", role: "img" } });
  const list = h("div", { cls: "hatch-levels", attrs: { role: "listbox", "aria-label": "Levels" } });
  const fields = h("div", { cls: "hatch-fields" });
  const add = h("button", { cls: "btn small", text: "Add Level", attrs: { type: "button" } });
  const remove = h("button", { cls: "btn small", text: "Remove", attrs: { type: "button" } });

  const current = (): HatchFill => ({ page: page.checked, background: ground, lines: levels.map(lineOf) });
  const redraw = (): void => {
    const dpr = window.devicePixelRatio || 1;
    paintHatch(preview, Math.round(PREVIEW_PX * dpr), current(), doc);
  };
  const sizeText = (mm: number): string => formatLengthValue(mm, units);
  const label = (v: Level, i: number): string => `${i + 1}. ${round(v.angle)}°, ${sizeText(v.spacing)}${suffix ? ` ${suffix}` : ""}${v.dash < 1 ? `, ${Math.round(v.dash * 100)}% dash` : ""}`;

  const renderGround = (): void => {
    groundCell.replaceChildren(
      colorSwatch({
        doc,
        value: ground,
        label: "Ground",
        onPick: (c) => {
          ground = c;
          renderGround();
          redraw();
        },
      }),
    );
  };

  const renderList = (): void => {
    list.replaceChildren(
      ...levels.map((v, i) => {
        const row = h("button", {
          cls: `hatch-level${i === selected ? " sel" : ""}`,
          text: label(v, i),
          attrs: { type: "button", role: "option", "aria-selected": String(i === selected) },
        });
        row.addEventListener("click", () => {
          selected = i;
          renderList();
          renderFields();
        });
        return row;
      }),
    );
    remove.disabled = levels.length <= 1;
  };

  /** The selected level's fields; each change redraws the preview and the level's row. */
  const renderFields = (): void => {
    bad.clear();
    const v = levels[selected];
    if (!v) {
      fields.replaceChildren();
      return;
    }
    const changed = (): void => {
      v.orig = null;
      const row = list.children[selected];
      if (row) row.textContent = label(v, selected);
      redraw();
    };
    const field = (text: string, value: string, unit: string, read: (t: string) => boolean): HTMLElement => {
      const input = h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": text, spellcheck: "false" } });
      input.addEventListener("input", () => {
        // left as shown, it keeps its exact value (the field rounds it)
        if (input.value === value) {
          bad.delete(input);
          input.classList.remove("bad");
          return;
        }
        const ok = read(input.value.trim());
        input.classList.toggle("bad", !ok);
        if (ok) {
          bad.delete(input);
          changed();
        } else bad.add(input);
      });
      return h("label", { cls: "hatch-field" }, h("span", { cls: "muted", text }), input, h("span", { cls: "muted", text: unit }));
    };
    const length = (t: string): number | null => parseLength(t, units);
    const num = (t: string): number | null => {
      const n = Number(t.replace(",", "."));
      return t !== "" && Number.isFinite(n) ? n : null;
    };
    fields.replaceChildren(
      field("Angle", String(round(v.angle)), "°", (t) => {
        const n = num(t);
        if (n === null) return false;
        v.angle = n;
        return true;
      }),
      field("Spacing", sizeText(v.spacing), suffix, (t) => {
        const n = length(t);
        if (n === null || Math.abs(n) < MIN_SPACING) return false;
        v.spacing = n;
        return true;
      }),
      field("Shift", sizeText(v.shift), suffix, (t) => {
        const n = length(t);
        if (n === null) return false;
        v.shift = n;
        return true;
      }),
      field("Dash repeat", sizeText(v.repeat), suffix, (t) => {
        const n = length(t);
        if (n === null || !(n > 0)) return false;
        v.repeat = n;
        return true;
      }),
      field("Dash", String(round(v.dash * 100)), "%", (t) => {
        const n = num(t);
        if (n === null || n < 0 || n > 100) return false;
        v.dash = n / 100;
        return true;
      }),
      field("Start X", sizeText(v.base.x), suffix, (t) => {
        const n = length(t);
        if (n === null) return false;
        v.base = { ...v.base, x: n };
        return true;
      }),
      field("Start Y", sizeText(v.base.y), suffix, (t) => {
        const n = length(t);
        if (n === null) return false;
        v.base = { ...v.base, y: n };
        return true;
      }),
      field("Weight", String(v.weight), "mils", (t) => {
        const n = num(t);
        if (n === null || !Number.isInteger(n) || n < 0 || n > 255) return false;
        v.weight = n;
        return true;
      }),
      h(
        "div",
        { cls: "hatch-field hatch-colour" },
        h("span", { cls: "muted", text: "Colour" }),
        colorSwatch({
          doc,
          value: v.color,
          label: "Level colour",
          onPick: (c) => {
            v.color = c;
            changed();
            renderFields();
          },
        }),
      ),
    );
  };

  add.addEventListener("click", () => {
    const like = levels[selected] ?? levelOf(start.lines[0]);
    levels.splice(selected + 1, 0, { ...like, base: { ...like.base }, angle: like.angle + 90, orig: null });
    selected++;
    renderList();
    renderFields();
    redraw();
  });
  remove.addEventListener("click", () => {
    if (levels.length <= 1) return;
    levels.splice(selected, 1);
    selected = Math.min(selected, levels.length - 1);
    renderList();
    renderFields();
    redraw();
  });
  page.addEventListener("change", redraw);

  renderGround();
  renderList();
  renderFields();
  redraw();
  const result = await showDialog<{ name: string; hatch: HatchFill }>({
    title: index === null ? (like === undefined ? "New Hatch" : "Duplicate Hatch") : `Edit Hatch: ${name}`,
    okLabel: "OK",
    cls: "hatch-dialog",
    body: [
      h(
        "div",
        { cls: "hatch-top" },
        preview,
        h(
          "div",
          { cls: "hatch-settings" },
          h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), nameInput),
          h("div", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Ground" }), groundCell),
          h("label", { cls: "hatch-check" }, page, h("span", { text: "Sizes on the printed page (else in the world)" })),
          h("div", { cls: "hatch-list-head" }, h("span", { cls: "muted", text: "Levels" }), add, remove),
          list,
        ),
      ),
      fields,
      h("p", {
        cls: "muted",
        text: "Each level is a family of parallel lines: spacing is across them, shift along them from one line to the next, and the dash is how much of each repeat is drawn.",
      }),
    ],
    check: () => {
      const n = nameInput.value.trim();
      if (!n) return { error: "Enter a name for the hatch.", focus: nameInput };
      if ((index === null || n !== name) && taken.has(n)) return { error: `"${n}" is already used in this drawing.`, focus: nameInput };
      const wrong = [...bad][0];
      if (wrong) return { error: `${wrong.getAttribute("aria-label")} takes another value.`, focus: wrong };
      return { value: { name: n, hatch: current() } };
    },
  });
  if (!result) return;
  const own = resources.find((r) => r.kind === "hatch" && r.index === (index ?? like));
  const pngs = hatchPreviews(doc, result.hatch, own);
  if (index === null) {
    attempt(like === undefined ? "New hatch" : "Duplicate hatch", (s) => s.createHatch(result.name, result.hatch, pngs, like));
    return;
  }
  attempt("Edit hatch", (s) =>
    s.batch(() => {
      s.editHatch(index, result.hatch, pngs);
      if (result.name !== name) s.renameResource(index, result.name);
    }),
  );
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
