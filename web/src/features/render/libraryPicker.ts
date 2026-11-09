// The material library's picker: a popover beside the button that opens it (the Render palette's
// "Choose…"). It has a search box, a row of category chips and a grid of thumbnails. A click on one,
// or Enter on it, picks it; Escape, a click outside or Tab out closes it with no pick. One picker is
// open at a time, as colorPicker.ts's popover. Its keys stay in the picker: the arrows move through the
// thumbnails, and Enter in the search box picks the first match. Solid panels (render.css), no glass.

import "./libraryPicker.css";
import { h } from "../../app/dom.ts";
import { t } from "../../app/i18n.ts";
import { LIBRARY, libraryUrl, type LibraryCategory } from "./library.ts";

/** Smallest gap kept between the popover and the window edges (CSS px). */
const EDGE = 8;

/** One open picker: its anchor, and how it closes (`picked` is the id chosen, when one was). */
interface OpenPicker {
  readonly anchor: HTMLElement;
  close(restoreFocus: boolean, picked?: string): void;
}

/** One thumbnail: its material, and the text it is searched by (its label and category in English and as shown, lower case). */
interface Tile {
  readonly id: string;
  readonly category: LibraryCategory;
  readonly text: string;
  readonly current: boolean;
  readonly btn: HTMLButtonElement;
}

let openPicker: OpenPicker | null = null;

/**
 * Opens the picker beside `anchor`, with `current` (a library material's id, or null) marked. Resolves
 * with the id picked, or null when it closes without a pick. A second click on `anchor` closes it.
 */
export function pickLibraryMaterial(anchor: HTMLElement, current: string | null): Promise<string | null> {
  if (openPicker?.anchor === anchor) {
    openPicker.close(true);
    return Promise.resolve(null);
  }
  openPicker?.close(false);
  return new Promise((resolve) => openLibraryPicker(anchor, current, resolve));
}

function openLibraryPicker(anchor: HTMLElement, current: string | null, done: (id: string | null) => void): void {
  const search = h("input", {
    cls: "lib-search",
    placeholder: "Search materials",
    attrs: { type: "search", "aria-label": "Search materials", autocomplete: "off", spellcheck: "false" },
  });
  const grid = h("div", { cls: "lib-grid", attrs: { role: "group", "aria-label": "Materials" } });
  const empty = h("p", { cls: "lib-empty", text: "No materials match.", hidden: true });

  // the categories in the library's order, behind an All chip
  const categories: readonly LibraryCategory[] = [...new Set(LIBRARY.map((e) => e.category))];
  let category: LibraryCategory | null = null;
  const chips = [null, ...categories].map((value) => {
    // "Tile" and "Ground" mean other things elsewhere (a tile resource, a hatch's ground): the chips name theirs
    const context: Record<string, string> = value ? { "data-i18n": `Material library › ${value}` } : {};
    const btn = h("button", { cls: "lib-chip", text: value ?? "All", attrs: { type: "button", "aria-pressed": "false", ...context } });
    btn.addEventListener("click", () => {
      category = value;
      render();
    });
    return { value, btn };
  });

  const tiles: Tile[] = LIBRARY.map((entry) => {
    const isCurrent = entry.id === current;
    const btn = h(
      "button",
      { cls: isCurrent ? "lib-tile on" : "lib-tile", title: entry.label, attrs: { type: "button", "aria-label": entry.label } },
      h("img", { cls: "lib-thumb", attrs: { src: libraryUrl(entry.id, "thumb"), alt: "", loading: "lazy" } }),
      h("span", { cls: "lib-label", text: entry.label }),
    );
    if (isCurrent) btn.setAttribute("aria-current", "true");
    btn.addEventListener("click", () => close(true, entry.id));
    // searched in English and in the interface's language, as the names show
    const text = `${entry.label} ${entry.category} ${t(entry.label)} ${t(entry.category)}`.toLowerCase();
    return { id: entry.id, category: entry.category, text, current: isCurrent, btn };
  });

  let visible: Tile[] = [];
  const render = (): void => {
    const q = search.value.trim().toLowerCase();
    visible = tiles.filter((t) => (category === null || t.category === category) && (q === "" || t.text.includes(q)));
    for (const t of tiles) t.btn.tabIndex = -1;
    grid.replaceChildren(...visible.map((t) => t.btn));
    empty.hidden = visible.length > 0;
    // one tab stop in the grid (roving focus): the current material if it is listed, else the first
    const stop = visible.find((t) => t.current) ?? visible[0];
    if (stop) stop.btn.tabIndex = 0;
    for (const c of chips) {
      const on = c.value === category;
      c.btn.classList.toggle("on", on);
      c.btn.setAttribute("aria-pressed", String(on));
    }
  };

  const head = h("div", { cls: "lib-head" }, search, h("div", { cls: "lib-chips", attrs: { role: "group", "aria-label": "Categories" } }, ...chips.map((c) => c.btn)));
  const body: Node[] = LIBRARY.length === 0 ? [h("p", { cls: "lib-empty", text: "The material library is empty." })] : [head, grid, empty];
  const pop = h("div", { cls: "lib-pop", attrs: { role: "dialog", "aria-label": "Material library", tabindex: "-1" } }, ...body);

  /** How many thumbnails share the first row, so ArrowUp and ArrowDown move a row. */
  const columns = (): number => {
    const top = visible[0]?.btn.offsetTop;
    let n = 0;
    for (const t of visible) {
      if (t.btn.offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
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

  function close(restoreFocus: boolean, picked?: string): void {
    if (openPicker !== picker) return;
    openPicker = null;
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("scroll", onMove, true);
    window.removeEventListener("resize", onMove);
    pop.remove();
    if (restoreFocus && anchor.isConnected) anchor.focus();
    done(picked ?? null);
  }
  const picker: OpenPicker = { anchor, close };

  pop.addEventListener("keydown", (e) => {
    // plain keys belong to the picker: Delete and the tool keys must not reach the editor
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
        close(true, first.id);
      } else if (e.key === "ArrowDown" && first) {
        e.preventDefault();
        first.btn.focus();
      }
      return;
    }
    const at = visible.findIndex((t) => t.btn === e.target);
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
        to = Math.min(at + columns(), visible.length - 1);
        break;
      case "ArrowUp":
        to = at - columns();
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
    else if (to < visible.length) visible[to].btn.focus();
  });

  // Tab or a click that moves focus out closes the picker; focus going nowhere does not
  pop.addEventListener("focusout", (e) => {
    const next = e.relatedTarget;
    if (next instanceof Node && !pop.contains(next) && next !== anchor) close(false);
  });

  search.addEventListener("input", render);
  render();
  document.body.append(pop);
  place();
  openPicker = picker;
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("scroll", onMove, true);
  window.addEventListener("resize", onMove);
  // the current material is shown, and the keys go to the picker
  tiles.find((t) => t.current)?.btn.scrollIntoView({ block: "nearest" });
  if (LIBRARY.length > 0) search.focus();
  else pop.focus();
}
