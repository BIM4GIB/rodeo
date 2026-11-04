// Colour swatch button and its popover palette, after Vectorworks' colour
// picker. The popover shows the document's colours (doc.colors()) in a grid,
// White and Black first, with a search box that matches name or hex. The
// active custom palettes (Color Palette Manager) are offered beside them; a
// colour picked from one is added to the document's in the same undo step. One
// popover is open at a time. It closes on Esc, an outside click, focus leaving
// it, or closeColorPicker() (panels call that before they re-render).

import type { ColorInfo, VwxDocument } from "../../core/index.ts";
import { activePalettes, DOCUMENT_PALETTE, type ColorPalette } from "../colorPalettes.ts";
import { attempt } from "../commands.ts";
import { h } from "../dom.ts";
import { store } from "../state.ts";
import "./colorPicker.css";

/** Palette indices of the classic entries, always listed first. */
const WHITE = 256;
const BLACK = 257;
/** Grid columns. ArrowUp and ArrowDown move by this many cells; keep in step with colorPicker.css. */
const COLS = 8;
/** Smallest gap kept between the popover and the window edges (CSS px). */
const EDGE = 8;
const MIXED = "— mixed —";
const FROM_TEMPLATE = "From template";

export interface ColorSwatchOptions {
  readonly doc: VwxDocument;
  /** colour index; null when the selection differs; undefined when unset (From template) */
  readonly value: number | null | undefined;
  /** what the colour is for, e.g. "Pen colour" */
  readonly label: string;
  /** called with the chosen palette index */
  readonly onPick: (index: number) => void;
  /** when given, the popover offers "From template" and calls this */
  readonly onClear?: () => void;
}

interface Palette {
  /** the document's colours when this was built: changed, and it is built again */
  readonly key: string;
  readonly colors: readonly ColorInfo[];
  /** one button per colour, built once per document and moved into the grid on each open */
  readonly cells: readonly HTMLButtonElement[];
  /** lower-case text each colour is searched by: its name and its hex */
  readonly keys: readonly string[];
}

interface OpenPicker {
  readonly anchor: HTMLElement;
  close(restoreFocus: boolean): void;
}

const palettes = new WeakMap<VwxDocument, Palette>();
let openPicker: OpenPicker | null = null;
/** the custom palette last shown, kept for the next open; null for the document's */
let shownPalette: string | null = null;

/** Closes the open colour popover without moving focus. Call before a panel re-renders. */
export function closeColorPicker(): void {
  openPicker?.close(false);
}

/** A button that shows a colour and opens the palette to change it. */
export function colorSwatch(opts: ColorSwatchOptions): HTMLButtonElement {
  const { doc, value } = opts;
  const chip = h("span", { cls: "cp-chip" });
  let text: string;
  if (value === null) {
    chip.classList.add("mixed");
    text = MIXED;
  } else if (value === undefined) {
    chip.classList.add("unset");
    text = FROM_TEMPLATE;
  } else {
    text = doc.color(value);
    chip.style.background = text;
  }
  const btn = h(
    "button",
    {
      cls: "cp-button",
      title: `${opts.label}: ${text}`,
      attrs: { type: "button", "aria-haspopup": "dialog", "aria-label": `${opts.label}: ${text}` },
    },
    chip,
    h("span", { cls: "cp-text", text }),
  );
  btn.addEventListener("click", () => {
    if (openPicker?.anchor === btn) openPicker.close(true);
    else openPopover(btn, opts);
  });
  return btn;
}

/** The document's palette, built on first use: White, Black, then the document colours. */
function paletteOf(doc: VwxDocument): Palette {
  const known = palettes.get(doc);
  const key = doc
    .colors()
    .map((c) => `${c.css}${c.name}`)
    .join("|");
  if (known && known.key === key) return known;
  const colors: ColorInfo[] = [
    { index: WHITE, css: doc.color(WHITE), name: "White" },
    { index: BLACK, css: doc.color(BLACK), name: "Black" },
    ...doc.colors().filter((c) => c.index !== WHITE && c.index !== BLACK),
  ];
  const cells = colors.map((c) => {
    const cell = h("button", {
      cls: "cp-cell",
      title: c.name || c.css,
      attrs: { type: "button", "aria-label": c.name || c.css, "data-index": String(c.index) },
    });
    cell.style.background = c.css;
    return cell;
  });
  const pal: Palette = { key, colors, cells, keys: colors.map((c) => `${c.name} ${c.css}`.toLowerCase()) };
  palettes.set(doc, pal);
  return pal;
}

function openPopover(anchor: HTMLElement, opts: ColorSwatchOptions): void {
  closeColorPicker();
  const pal = paletteOf(opts.doc);

  const search = h("input", {
    cls: "cp-search",
    placeholder: "Search name or hex",
    attrs: { type: "search", "aria-label": "Search colours", autocomplete: "off", spellcheck: "false" },
  });
  const grid = h("div", { cls: "cp-grid", attrs: { role: "group", "aria-label": `${opts.label} palette` } });
  const empty = h("p", { cls: "cp-empty", text: "No colours match.", hidden: true });
  const head = h("div", { cls: "cp-head" }, search);
  const onClear = opts.onClear;
  if (onClear) {
    const clear = h("button", { cls: "cp-clear", text: FROM_TEMPLATE, attrs: { type: "button" } });
    clear.addEventListener("click", () => {
      close(true);
      onClear();
    });
    head.prepend(clear);
  }
  const customs = activePalettes();
  let custom: ColorPalette | null = customs.find((p) => p.name === shownPalette) ?? null;
  if (customs.length) {
    const which = h(
      "select",
      { cls: "cp-palette", attrs: { "aria-label": "Color palette" } },
      h("option", { text: DOCUMENT_PALETTE, attrs: { value: "" } }),
      ...customs.map((p) => h("option", { text: p.name, attrs: { value: p.name } })),
    );
    which.value = custom?.name ?? "";
    which.addEventListener("change", () => {
      custom = customs.find((p) => p.name === which.value) ?? null;
      shownPalette = custom?.name ?? null;
      render();
    });
    head.append(which);
  }
  const manage = h("button", { cls: "cp-clear cp-manage", text: "Color Palette Manager…", attrs: { type: "button" } });
  manage.addEventListener("click", () => {
    close(false);
    void import("../colorPaletteManager.ts").then((m) => m.colorPaletteManager());
  });
  const pop = h(
    "div",
    { cls: "cp-pop", attrs: { role: "dialog", "aria-label": `${opts.label} colour` } },
    head,
    grid,
    empty,
    manage,
  );

  // the palette is reused by every open of this document: mark the current colour afresh
  const current = typeof opts.value === "number" ? opts.value : -1;
  pal.colors.forEach((c, i) => {
    const cell = pal.cells[i];
    const on = c.index === current;
    cell.classList.toggle("on", on);
    if (on) cell.setAttribute("aria-current", "true");
    else cell.removeAttribute("aria-current");
  });

  // a custom palette's swatches, made as it is shown; the current colour marked by its hex
  const currentCss = current >= 0 ? opts.doc.color(current).toLowerCase() : "";
  const customCells = (p: ColorPalette): { cells: HTMLButtonElement[]; keys: string[] } => ({
    cells: p.colors.map((c) => {
      const cell = h("button", { cls: "cp-cell", title: c.name || c.css, attrs: { type: "button", "aria-label": c.name || c.css, "data-css": c.css } });
      cell.style.background = c.css;
      cell.classList.toggle("on", c.css === currentCss);
      return cell;
    }),
    keys: p.colors.map((c) => `${c.name} ${c.css}`.toLowerCase()),
  });

  let visible: readonly HTMLButtonElement[] = pal.cells;
  const render = (): void => {
    const q = search.value.trim().toLowerCase();
    const shown = custom ? customCells(custom) : pal;
    visible = q === "" ? shown.cells : shown.cells.filter((_, i) => shown.keys[i].includes(q));
    for (const cell of shown.cells) cell.tabIndex = -1;
    grid.replaceChildren(...visible);
    empty.hidden = visible.length > 0;
    // one tab stop in the grid (roving focus): the current colour if it is listed, else the first
    const stop = visible.find((c) => c.classList.contains("on")) ?? visible[0];
    if (stop) stop.tabIndex = 0;
  };

  const pick = (index: number): void => {
    close(true);
    opts.onPick(index);
  };
  /** a custom palette's colour: added to the document's, then picked, as one undo step */
  const pickCss = (css: string): void => {
    close(true);
    const s = store.session;
    if (s?.doc !== opts.doc) return;
    attempt("Add colour", (session) =>
      session.batch(() => {
        const [index] = session.addColors([css]);
        opts.onPick(index);
      }),
    );
  };
  const choose = (cell: HTMLElement): void => {
    if (cell.dataset.css) pickCss(cell.dataset.css);
    else pick(Number(cell.dataset.index));
  };

  const place = (): void => {
    const r = anchor.getBoundingClientRect();
    const below = r.bottom + 4;
    const fitsBelow = below + pop.offsetHeight <= window.innerHeight - EDGE;
    const top = fitsBelow ? below : Math.max(EDGE, r.top - 4 - pop.offsetHeight);
    const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - EDGE - pop.offsetWidth));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.target instanceof Node && (pop.contains(e.target) || anchor.contains(e.target))) return;
    close(false);
  };
  // the panel scrolls and the window resizes: follow the anchor, or give up when it has gone
  const onMove = (e: Event): void => {
    if (!anchor.isConnected) close(false);
    else if (!(e.target instanceof Node && pop.contains(e.target))) place();
  };

  function close(restoreFocus: boolean): void {
    if (openPicker !== picker) return;
    openPicker = null;
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("scroll", onMove, true);
    window.removeEventListener("resize", onMove);
    pop.remove();
    if (restoreFocus && anchor.isConnected) anchor.focus();
  }
  const picker: OpenPicker = { anchor, close };

  pop.addEventListener("keydown", (e) => {
    // plain keys belong to the palette: tool keys, Delete, Space must not reach the editor.
    // Cmd/Ctrl shortcuts (undo, save) still do; a session change closes the palette anyway.
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.target === search) {
      const first = visible[0];
      if (e.key === "Enter" && first) {
        e.preventDefault();
        choose(first);
      } else if (e.key === "ArrowDown" && first) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    const at = visible.indexOf(e.target as HTMLButtonElement);
    if (at < 0) return;
    let to: number;
    switch (e.key) {
      case "ArrowRight":
        to = at + 1;
        break;
      case "ArrowLeft":
        to = at - 1;
        break;
      case "ArrowDown":
        to = Math.min(at + COLS, visible.length - 1);
        break;
      case "ArrowUp":
        to = at - COLS;
        break;
      case "Home":
        to = 0;
        break;
      case "End":
        to = visible.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (to < 0) search.focus();
    else if (to < visible.length) visible[to].focus();
  });

  // Tab or a click that moves focus out closes the popover; focus going nowhere does not
  pop.addEventListener("focusout", (e) => {
    const next = e.relatedTarget;
    if (next instanceof Node && !pop.contains(next) && next !== anchor) close(false);
  });

  grid.addEventListener("click", (e) => {
    const cell = e.target instanceof Element ? e.target.closest<HTMLElement>(".cp-cell") : null;
    if (cell) choose(cell);
  });

  search.addEventListener("input", render);
  render();
  document.body.append(pop);
  place();
  openPicker = picker;
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("scroll", onMove, true);
  window.addEventListener("resize", onMove);
  search.focus();
}
