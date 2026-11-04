// Tools > Utilities > Color Palette Manager…, as Vectorworks has it (also at the foot of every
// colour picker): the palettes listed with an Active tick, which puts a palette in the colour
// pickers, beside Colors in Active Document, the drawing's own; the picked palette's colours in a
// grid; New…, Edit…, Duplicate and Delete. Edit Palette names a custom palette and lists its colours
// (#, colour, name; sorted by colour or name, dragged into another order), shown in a grid too:
// New… and Edit… a colour, Delete, Get… colours from the other palettes, Lighten and Darken, RGB
// Blend… and HSV Blend… between two colours picked, and Import… every colour of another .vwx file.
// The palettes are kept in this browser (colorPalettes.ts), as Vectorworks keeps them in the user
// folder. Purge Unused isn't offered: a colour taken out of a drawing's table would renumber those
// after it.

import { openVwx, type VwxDocument } from "../core/index.ts";
import {
  blend,
  customPalettes,
  darken,
  DOCUMENT_PALETTE,
  freePaletteName,
  lighten,
  MOST_BLENDED,
  setCustomPalettes,
  type ColorPalette,
  type PaletteColor,
} from "./colorPalettes.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";
import "./colorPaletteManager.css";

/** Palette indices of the classic entries, which the colour pickers list first. */
const WHITE = 256;
const BLACK = 257;

/** A drawing's own colours as the colour pickers list them: White, Black, then its table's. */
export function documentColors(doc: VwxDocument): PaletteColor[] {
  return [
    { css: doc.color(WHITE).toLowerCase(), name: "White" },
    { css: doc.color(BLACK).toLowerCase(), name: "Black" },
    ...doc
      .colors()
      .filter((c) => c.index !== WHITE && c.index !== BLACK)
      .map((c) => ({ css: c.css.toLowerCase(), name: c.name })),
  ];
}

/** A swatch for the grids, named by its colour's name or hex. */
function cell(c: PaletteColor, label: string): HTMLButtonElement {
  const b = h("button", { cls: "cp-cell", title: c.name ? `${c.name} ${c.css}` : c.css, attrs: { type: "button", "aria-label": label } });
  b.style.background = c.css;
  return b;
}

const button = (text: string, run: () => void | Promise<void>): HTMLButtonElement => {
  const b = h("button", { cls: "btn small", text, attrs: { type: "button" } });
  b.addEventListener("click", () => void run());
  return b;
};

/** Hue then brightness, for sorting by colour. */
function hueKey(css: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  // greys first, dark to light
  if (d === 0) return max - 1;
  const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return hue * 10 + max;
}

/** The Pick Color dialog (Get…): colours ticked in one of `sources`. */
async function pickColors(sources: readonly ColorPalette[]): Promise<PaletteColor[] | null> {
  if (!sources.length) return null;
  const which = h("select", { cls: "menu-dialog-input", attrs: { "aria-label": "Palette" } }, ...sources.map((p, i) => h("option", { text: p.name, attrs: { value: String(i) } })));
  const grid = h("div", { cls: "cp-grid cpm-grid", attrs: { role: "group", "aria-label": "Colors to get" } });
  const chosen = new Set<string>();
  const draw = (): void => {
    const p = sources[which.selectedIndex];
    grid.replaceChildren(
      ...p.colors.map((c, i) => {
        const b = cell(c, `${i + 1} ${c.name || c.css}`);
        const key = `${which.selectedIndex}:${i}`;
        const show = (): void => {
          b.classList.toggle("on", chosen.has(key));
          b.setAttribute("aria-pressed", String(chosen.has(key)));
        };
        b.addEventListener("click", () => {
          if (!chosen.delete(key)) chosen.add(key);
          show();
        });
        show();
        return b;
      }),
    );
  };
  which.addEventListener("change", draw);
  draw();
  return showDialog<PaletteColor[]>({
    title: "Pick Color",
    cls: "cpm-pick",
    okLabel: "OK",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Palette" }), which), grid],
    check: () => {
      const got = [...chosen].map((k) => {
        const [p, i] = k.split(":").map(Number);
        return sources[p].colors[i];
      });
      return got.length ? { value: got } : { error: "Click the colours to get.", focus: grid };
    },
  });
}

/** Every colour of a .vwx file chosen here, or null when none is chosen or it can't be read. */
function importColors(): Promise<PaletteColor[] | null> {
  return new Promise((resolve) => {
    const input = h("input", { attrs: { type: "file", accept: ".vwx", "aria-label": "Vectorworks file to import colours from" } });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      void file
        .arrayBuffer()
        .then((buf) => resolve(documentColors(openVwx(new Uint8Array(buf), file.name).doc)))
        .catch(() => {
          toast(`${file.name} couldn't be read for its colours.`);
          resolve(null);
        });
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** The New Color or Edit Color dialog. */
async function colorDialog(title: string, c: PaletteColor): Promise<PaletteColor | null> {
  const v = await toolPrefs(title, [
    { kind: "color", key: "css", label: "Color", value: c.css },
    { kind: "text", key: "name", label: "Name", value: c.name },
  ]);
  return v ? { css: v.choice("css").toLowerCase(), name: v.choice("name") } : null;
}

/** The Edit Palette (or New Palette) dialog: the palette as edited, or null when cancelled. */
async function editPalette(title: string, start: ColorPalette, taken: readonly string[], others: () => ColorPalette[]): Promise<ColorPalette | null> {
  let colors: PaletteColor[] = [...start.colors];
  const sel = new Set<number>();
  let anchor = -1;
  const name = h("input", { cls: "menu-dialog-input", value: start.name, attrs: { type: "text", "aria-label": "Name" } });
  const list = h("div", { cls: "cpe-list", attrs: { role: "listbox", "aria-label": "Color List", "aria-multiselectable": "true", tabindex: "0" } });
  const grid = h("div", { cls: "cp-grid cpm-grid", attrs: { role: "group", "aria-label": "Color Grid" } });
  const picked = (): number[] => [...sel].sort((a, b) => a - b);

  const choose = (i: number, e: MouseEvent): void => {
    if (e.shiftKey && anchor >= 0) {
      sel.clear();
      for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) sel.add(k);
    } else if (e.metaKey || e.ctrlKey) {
      if (!sel.delete(i)) sel.add(i);
      anchor = i;
    } else {
      sel.clear();
      sel.add(i);
      anchor = i;
    }
    draw();
  };
  /** puts `items` at `at`, picked */
  const insert = (at: number, items: readonly PaletteColor[]): void => {
    colors.splice(at, 0, ...items);
    sel.clear();
    items.forEach((_, k) => sel.add(at + k));
    anchor = at;
    draw();
  };
  const sortBy = (key: (c: PaletteColor) => string | number): void => {
    colors = [...colors].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    });
    sel.clear();
    draw();
  };
  let dragged = -1;
  const row = (c: PaletteColor, i: number): HTMLElement => {
    const swatch = h("span", { cls: "cp-chip" });
    swatch.style.background = c.css;
    const r = h(
      "div",
      { cls: "cpe-row", attrs: { role: "option", "aria-selected": String(sel.has(i)), draggable: "true", "data-i": String(i) } },
      h("span", { cls: "cpe-num", text: String(i + 1) }),
      swatch,
      h("span", { cls: "cpe-name", text: c.name }),
      h("span", { cls: "cpe-hex", text: c.css }),
    );
    r.addEventListener("click", (e) => choose(i, e));
    r.addEventListener("dblclick", () => void edit());
    r.addEventListener("dragstart", (e) => {
      dragged = i;
      e.dataTransfer?.setData("text/plain", String(i));
    });
    r.addEventListener("dragover", (e) => e.preventDefault());
    r.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragged < 0 || dragged === i) return;
      const [moved] = colors.splice(dragged, 1);
      colors.splice(i, 0, moved);
      sel.clear();
      sel.add(i);
      anchor = i;
      dragged = -1;
      draw();
    });
    return r;
  };
  const head = h(
    "div",
    { cls: "cpe-row cpe-head" },
    h("span", { cls: "cpe-num", text: "#" }),
    button("Color", () => sortBy((c) => hueKey(c.css))),
    button("Name", () => sortBy((c) => c.name.toLowerCase())),
  );

  const edit = async (): Promise<void> => {
    const [i] = picked();
    if (i === undefined || sel.size !== 1) return;
    const c = await colorDialog("Edit Color", colors[i]);
    if (!c) return;
    colors[i] = c;
    draw();
  };
  const blendDialog = async (by: "rgb" | "hsv"): Promise<void> => {
    const [a, b] = picked();
    if (sel.size !== 2) return;
    const v = await toolPrefs(by === "rgb" ? "RGB Blend" : "HSV Blend", [{ kind: "number", key: "n", label: "Number of new colors", value: 5, min: 1, max: MOST_BLENDED, integer: true }]);
    if (!v) return;
    insert(a + 1, blend(colors[a].css, colors[b].css, v.num("n"), by).map((css) => ({ css, name: "" })));
  };
  const actions = {
    edit: button("Edit…", edit),
    del: button("Delete", () => {
      colors = colors.filter((_, i) => !sel.has(i));
      sel.clear();
      draw();
    }),
    lighten: button("Lighten", () => {
      colors = colors.map((c, i) => (sel.has(i) ? { ...c, css: lighten(c.css) } : c));
      draw();
    }),
    darken: button("Darken", () => {
      colors = colors.map((c, i) => (sel.has(i) ? { ...c, css: darken(c.css) } : c));
      draw();
    }),
    rgb: button("RGB Blend…", () => blendDialog("rgb")),
    hsv: button("HSV Blend…", () => blendDialog("hsv")),
  };
  const buttons = h(
    "div",
    { cls: "cpm-buttons" },
    button("New…", async () => {
      const c = await colorDialog("New Color", { css: "#808080", name: "" });
      if (c) insert(sel.size ? Math.max(...sel) + 1 : colors.length, [c]);
    }),
    actions.edit,
    actions.del,
    button("Get…", async () => {
      const got = await pickColors(others().filter((p) => p.colors.length));
      if (got) insert(colors.length, got);
    }),
    actions.lighten,
    actions.darken,
    actions.rgb,
    actions.hsv,
    button("Import…", async () => {
      const got = await importColors();
      if (!got) return;
      const have = new Set(colors.map((c) => c.css));
      const fresh: PaletteColor[] = [];
      for (const c of got) {
        if (have.has(c.css)) continue;
        have.add(c.css);
        fresh.push(c);
      }
      toast(fresh.length ? `${fresh.length} ${fresh.length === 1 ? "colour" : "colours"} imported.` : "The file has no colours this palette lacks.", "info");
      if (fresh.length) insert(colors.length, fresh);
    }),
  );

  function draw(): void {
    list.replaceChildren(head, ...colors.map(row));
    grid.replaceChildren(
      ...colors.map((c, i) => {
        const b = cell(c, `${i + 1} ${c.name || c.css}`);
        b.classList.toggle("on", sel.has(i));
        b.addEventListener("click", (e) => choose(i, e));
        return b;
      }),
    );
    actions.edit.disabled = sel.size !== 1;
    actions.del.disabled = actions.lighten.disabled = actions.darken.disabled = sel.size === 0;
    actions.rgb.disabled = actions.hsv.disabled = sel.size !== 2;
  }
  draw();
  return showDialog<ColorPalette>({
    title,
    cls: "cpm-dialog",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), name),
      h("div", { cls: "cpm-body" }, h("div", { cls: "cpm-col" }, list, buttons), grid),
    ],
    check: () => {
      const n = name.value.trim();
      if (!n) return { error: "Name the palette.", focus: name };
      if (n === DOCUMENT_PALETTE || taken.includes(n)) return { error: `There is a palette named ${n} already.`, focus: name };
      return { value: { name: n, colors, active: start.active } };
    },
  });
}

/** Tools > Utilities > Color Palette Manager…; the custom palettes are kept on OK. */
export async function colorPaletteManager(): Promise<void> {
  const doc = store.session?.doc ?? null;
  let work: ColorPalette[] = [...customPalettes()];
  let picked = DOCUMENT_PALETTE;
  const list = h("div", { cls: "cpm-list", attrs: { role: "listbox", "aria-label": "Color palettes" } });
  const grid = h("div", { cls: "cp-grid cpm-grid", attrs: { role: "group", "aria-label": "Palette colors" } });
  const count = h("p", { cls: "muted cpm-count" });
  const documentPalette = (): ColorPalette => ({ name: DOCUMENT_PALETTE, colors: doc ? documentColors(doc) : [], active: true });
  const all = (): ColorPalette[] => [documentPalette(), ...work];
  const names = (except?: string): string[] => work.map((p) => p.name).filter((n) => n !== except);

  const edit = button("Edit…", async () => {
    const i = work.findIndex((p) => p.name === picked);
    if (i < 0) return;
    const p = await editPalette("Edit Palette", work[i], names(picked), () => all().filter((q) => q.name !== picked));
    if (!p) return;
    work = work.map((q, k) => (k === i ? p : q));
    picked = p.name;
    draw();
  });
  const del = button("Delete", () => {
    work = work.filter((p) => p.name !== picked);
    picked = DOCUMENT_PALETTE;
    draw();
  });
  const buttons = h(
    "div",
    { cls: "cpm-buttons" },
    button("New…", async () => {
      const start = { name: freePaletteName("Untitled Palette", names()), colors: [], active: true };
      const p = await editPalette("New Palette", start, names(), all);
      if (!p) return;
      work = [...work, p];
      picked = p.name;
      draw();
    }),
    edit,
    button("Duplicate", () => {
      const from = all().find((p) => p.name === picked);
      if (!from) return;
      const name = freePaletteName(from.name, names());
      work = [...work, { name, colors: [...from.colors], active: true }];
      picked = name;
      draw();
    }),
    del,
  );

  function draw(): void {
    list.replaceChildren(
      ...all().map((p) => {
        const mine = p.name !== DOCUMENT_PALETTE;
        const tick = h("input", { attrs: { type: "checkbox", "aria-label": `Active: ${p.name}` } });
        tick.checked = p.active;
        tick.disabled = !mine;
        tick.addEventListener("change", () => {
          work = work.map((q) => (q.name === p.name ? { ...q, active: tick.checked } : q));
        });
        const r = h("div", { cls: "cpm-row", attrs: { role: "option", "aria-selected": String(p.name === picked) } }, tick, h("span", { text: p.name }));
        r.addEventListener("click", (e) => {
          if (e.target === tick) return;
          picked = p.name;
          draw();
        });
        return r;
      }),
    );
    const shown = all().find((p) => p.name === picked)?.colors ?? [];
    grid.replaceChildren(...shown.map((c, i) => cell(c, `${i + 1} ${c.name || c.css}`)));
    count.textContent = `${shown.length} ${shown.length === 1 ? "colour" : "colours"}`;
    edit.disabled = del.disabled = picked === DOCUMENT_PALETTE;
  }
  draw();
  const kept = await showDialog<ColorPalette[]>({
    title: "Color Palette Manager",
    cls: "cpm-dialog",
    okLabel: "OK",
    body: [
      h("div", { cls: "cpm-body" }, h("div", { cls: "cpm-col" }, h("span", { cls: "menu-dialog-label", text: "Palettes (ticked ones show in the colour pickers)" }), list, buttons), h("div", { cls: "cpm-col" }, grid, count)),
    ],
    check: () => ({ value: work }),
  });
  if (kept) setCustomPalettes(kept);
}
