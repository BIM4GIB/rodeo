// Window > Visibility Grid…: one table of which classes (or design layers) each viewport on the
// sheets shows, in place of opening each viewport's settings. Columns are the viewports, grouped
// under their sheet; rows are the classes or the design layers. A cell cycles visible, grayed,
// hidden; a row, column or sheet head sets many at once. Each change goes through the session's
// setters: a click, a shift-drag or a menu choice is one undo step. The grid follows the drawing,
// so edits, undo and redo show at once. Only the rows on screen are drawn, so long lists scroll.

import { attempt } from "../../app/commands.ts";
import { documentSource } from "../../app/ext.ts";
import { h } from "../../app/dom.ts";
import { visibilityIcon } from "../../app/icons.ts";
import { buildPanel, type Panel, type Row } from "../../app/menu.ts";
import { visibilityLabel } from "../../app/panels/common.ts";
import { store } from "../../app/state.ts";
import type { Visibility } from "../../core/index.ts";
import { applyCells, cellAt, gridData, nextVisibility, type CellWrite, type GridData, type GridTab } from "./grid.ts";
import "./visgrid.css";

const ROW_H = 24;
const CELL_W = 26;
const ROW_HEAD_W = 200;
const SHEET_HEAD_H = 26;
/** room for a viewport's name, set vertically */
const COL_HEAD_H = 112;
const HEAD_H = SHEET_HEAD_H + COL_HEAD_H;
/** rows drawn beyond the visible ones, so a quick scroll shows no gap */
const OVERSCAN = 6;

const STATES: readonly Visibility[] = ["visible", "grayed", "hidden"];
const VERB: Record<Visibility, string> = { visible: "Show", grayed: "Gray", hidden: "Hide" };
const TABS: readonly { readonly id: GridTab; readonly label: string; readonly noun: string; readonly plural: string }[] = [
  { id: "classes", label: "Classes", noun: "class", plural: "classes" },
  { id: "layers", label: "Design Layers", noun: "design layer", plural: "design layers" },
];

/** the tab shown last, so the grid reopens on it */
let lastTab: GridTab = "classes";
/** the grid now open, if any */
let current: { close(): void } | null = null;

/** Opens the Visibility Grid for the open drawing (one at a time). */
export function openVisibilityGrid(): void {
  if (current || !store.session) return;
  current = buildGrid();
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** The cell (or header cell) an event came from, if any. */
function cellFrom(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(".vg-cell") : null;
}

/** What the grid is showing, as a key: a change to it rebuilds the headers, a change to values only repaints. */
function structureOf(d: GridData): string {
  return JSON.stringify([d.tab, d.sheets, d.columns, d.rows.map((r) => [r.key, r.name])]);
}

function buildGrid(): { close(): void } {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let tab: GridTab = lastTab;
  let data: GridData = gridData(store.session!.doc, tab);
  /** the filter text, lower case, and the sheet shown (null for all) */
  let query = "";
  let sheetId: string | null = null;
  /** indices into data.rows and data.columns that the grid shows, in order */
  let shownRows: number[] = [];
  let shownCols: number[] = [];
  /** the first shown column of each sheet after the first: a divider is drawn before it */
  let sheetStarts = new Set<number>();
  let structure = "";
  /** the row elements drawn, by row index */
  let rowEls = new Map<number, HTMLElement>();
  let hoverCol = -1;
  let menu: Panel | null = null;
  let frame = 0;
  /** a shift-drag in progress: the value it paints, and the cells it has reached */
  let painting: { value: Visibility } | null = null;
  const pending = new Map<string, CellWrite>();
  /** set by a drag's end, so the click that follows it does nothing */
  let suppressClick = false;

  const plural = (): string => TABS.find((t) => t.id === tab)!.plural;
  const readOnly = (): boolean => documentSource()?.readOnly === true;

  // ---- the dialog ---------------------------------------------------------------

  const backdrop = h("div", { cls: "menu-dialog-backdrop vg-backdrop" });
  const dialog = h("div", {
    cls: "menu-dialog vg-dialog",
    attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Visibility Grid" },
  });
  const tabButtons = TABS.map((t) => {
    const btn = h("button", { cls: "seg-btn", text: t.label, attrs: { type: "button", role: "tab" } });
    btn.addEventListener("click", () => setTab(t.id));
    return btn;
  });
  const search = h("input", {
    cls: "menu-dialog-input vg-search",
    placeholder: `Filter ${plural()}`,
    attrs: { type: "search", "aria-label": "Filter the rows", autocomplete: "off", spellcheck: "false" },
  });
  const sheetSelect = h("select", { cls: "menu-dialog-select vg-sheet", attrs: { "aria-label": "Sheet" } });
  const top = h(
    "div",
    { cls: "vg-top" },
    h("h2", { cls: "vg-title", text: "Visibility Grid" }),
    h("div", { cls: "seg vg-tabs", attrs: { role: "tablist" } }, ...tabButtons),
    search,
    sheetSelect,
  );

  const note = h("p", { cls: "vg-note", hidden: true, attrs: { role: "status" } });
  const win = h("div", { cls: "vg-window" });
  const head = h("div", { cls: "vg-head" });
  const canvas = h("div", { cls: "vg-canvas" }, head, win);
  const scroll = h("div", { cls: "vg-scroll", attrs: { tabindex: "0", "aria-label": "Viewports and rows" } }, canvas);

  const count = h("span", { cls: "vg-count muted" });
  const hint = h("span", { cls: "vg-hint muted" });
  const done = h("button", { cls: "btn primary", text: "Done", attrs: { type: "button" } });
  const legend = h(
    "span",
    { cls: "vg-legend" },
    ...STATES.map((v) =>
      h("span", { cls: "vg-key" }, h("span", { cls: `vis-${v}`, html: visibilityIcon(v) }), h("span", { text: visibilityLabel(v) })),
    ),
  );
  const foot = h("div", { cls: "vg-foot" }, legend, hint, count, done);

  dialog.append(top, note, scroll, foot);
  backdrop.append(dialog);

  // ---- the table ----------------------------------------------------------------

  function computeShown(): void {
    const q = query;
    shownRows = [];
    data.rows.forEach((r, i) => {
      if (q === "" || r.name.toLowerCase().includes(q)) shownRows.push(i);
    });
    shownCols = [];
    data.columns.forEach((col, i) => {
      if (sheetId === null || data.sheets[col.sheet].id === sheetId) shownCols.push(i);
    });
    sheetStarts = new Set(shownCols.filter((c, i) => i === 0 || data.columns[c].sheet !== data.columns[shownCols[i - 1]].sheet));
  }

  function syncSheetOptions(): void {
    if (sheetId !== null && !data.sheets.some((s) => s.id === sheetId)) sheetId = null;
    sheetSelect.replaceChildren(
      h("option", { text: "All sheets", attrs: { value: "" } }),
      ...data.sheets.map((s) => h("option", { text: s.title ? `${s.number} ${s.title}` : s.number, attrs: { value: s.id } })),
    );
    sheetSelect.value = sheetId ?? "";
  }

  /** The sheet groups of the header row: each sheet's number and title, over its viewports' names. */
  function buildHead(): HTMLElement[] {
    const corner = h("div", { cls: "vg-corner" }, h("span", { text: tab === "classes" ? "Class" : "Design layer" }));
    const groups: HTMLElement[] = [corner];
    data.sheets.forEach((sheet, si) => {
      const cols = shownCols.filter((c) => data.columns[c].sheet === si);
      if (cols.length === 0) return;
      const sheetBtn = h(
        "button",
        {
          cls: "vg-sheethead",
          title: `${sheet.number}${sheet.title ? ` ${sheet.title}` : ""}: click for every ${plural()} in its viewports`,
          attrs: { type: "button", "data-s": String(si) },
        },
        h("span", { cls: "vg-sheetnum", text: sheet.number }),
        sheet.title ? h("span", { cls: "vg-sheettitle", text: sheet.title }) : null,
      );
      sheetBtn.addEventListener("click", () => openMenu(sheetBtn, sheetRows(si)));
      const colHeads = cols.map((c) => colHead(c));
      const group = h("div", { cls: groups.length > 1 ? "vg-sheetgroup sep" : "vg-sheetgroup" }, sheetBtn, h("div", { cls: "vg-colheads" }, ...colHeads));
      group.style.width = `${cols.length * CELL_W}px`;
      groups.push(group);
    });
    return groups;
  }

  function colHead(c: number): HTMLElement {
    const col = data.columns[c];
    const sheet = data.sheets[col.sheet];
    const btn = h(
      "button",
      {
        cls: col.plan ? "vg-colhead" : "vg-colhead other",
        title: `${col.label}, on sheet ${sheet.number}, 1:${col.scale}${col.plan ? "" : " (section, elevation or detail: drawn from the file's copy)"}`,
        attrs: { type: "button", "data-c": String(c) },
      },
      h("span", { cls: "vg-vtext", text: col.label }),
    );
    if (c === hoverCol) btn.classList.add("hl-col");
    btn.addEventListener("click", () => openMenu(btn, columnRows(c)));
    return btn;
  }

  function makeRow(r: number): HTMLElement {
    const row = data.rows[r];
    const rowHead = h(
      "button",
      { cls: "vg-rowhead", title: `${row.name}: click for every viewport`, attrs: { type: "button" } },
      h("span", { cls: "vg-rowname", text: row.name }),
    );
    rowHead.addEventListener("click", () => openMenu(rowHead, rowRows(r)));
    const el = h("div", { cls: "vg-row", attrs: { "data-r": String(r) } }, rowHead);
    for (let i = 0; i < shownCols.length; i++) {
      el.append(h("button", { cls: "vg-cell", attrs: { type: "button", "data-r": String(r), "data-c": String(shownCols[i]) } }));
    }
    return el;
  }

  /** Sets one cell's look from the grid's values, and the pending paint; leaves it alone when nothing changed. */
  function paintCell(el: HTMLElement, r: number, c: number): void {
    const cell = cellAt(data, r, c);
    const pend = pending.get(`${r},${c}`);
    const value = pend?.value ?? cell.value;
    const inherited = cell.inherited && !pend;
    const flags = `${value}|${inherited ? "i" : ""}${pend ? "p" : ""}${hoverCol === c ? "h" : ""}`;
    if (el.dataset.s === flags) return;
    el.dataset.s = flags;
    if (el.dataset.v !== value) {
      el.dataset.v = value;
      el.innerHTML = visibilityIcon(value);
    }
    el.className = [
      "vg-cell",
      `v-${value}`,
      inherited ? "inherited" : "",
      pend ? "pending" : "",
      hoverCol === c ? "hl-col" : "",
      sheetStarts.has(c) ? "sheet-start" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const name = `${data.rows[r].name} in ${data.columns[c].label}`;
    const label = `${visibilityLabel(value)}${inherited ? ", as the class is" : ""}`;
    el.setAttribute("aria-label", `${name}: ${label}`);
    el.title = readOnly() ? label : `${label}. Click for ${visibilityLabel(nextVisibility(value))}`;
  }

  function paintRow(el: HTMLElement): void {
    const r = Number(el.dataset.r);
    for (let i = 1; i < el.childElementCount; i++) paintCell(el.children[i] as HTMLElement, r, shownCols[i - 1]);
  }

  function paintAll(): void {
    for (const el of rowEls.values()) paintRow(el);
  }

  /** Draws the rows in view, plus a few beyond, and drops the rest. */
  function renderWindow(): void {
    const n = shownRows.length;
    const first = clamp(Math.floor((scroll.scrollTop - HEAD_H) / ROW_H) - OVERSCAN, 0, n);
    const last = clamp(Math.ceil((scroll.scrollTop + scroll.clientHeight - HEAD_H) / ROW_H) + OVERSCAN, first, n);
    const next = new Map<number, HTMLElement>();
    const els: HTMLElement[] = [];
    for (let p = first; p < last; p++) {
      const r = shownRows[p];
      const el = rowEls.get(r) ?? makeRow(r);
      next.set(r, el);
      els.push(el);
      paintRow(el);
    }
    rowEls = next;
    win.replaceChildren(...els);
    win.style.top = `${HEAD_H + first * ROW_H}px`;
  }

  function updateNote(): void {
    let text = "";
    if (data.columns.length === 0) text = "This drawing has no viewports on sheet layers.";
    else if (data.rows.length === 0) text = `This drawing has no ${plural()}.`;
    else if (shownRows.length === 0) text = `No ${plural()} match “${search.value.trim()}”.`;
    note.textContent = text;
    note.hidden = text === "";
    scroll.hidden = text !== "";
  }

  function updateCount(): void {
    const sheets = new Set(shownCols.map((c) => data.columns[c].sheet)).size;
    count.textContent = `${shownRows.length} of ${data.rows.length} ${plural()}, ${shownCols.length} of ${data.columns.length} viewports on ${sheets} ${sheets === 1 ? "sheet" : "sheets"}`;
    hint.textContent = readOnly()
      ? "View only: this drawing can't be changed here"
      : "Click a cell to change it. Shift-drag paints. Click a row, column or sheet head for more.";
  }

  /** Lays the grid out afresh: the headers, the rows' size, and the rows in view. */
  function rebuild(): void {
    structure = structureOf(data);
    syncSheetOptions();
    computeShown();
    head.replaceChildren(...buildHead());
    canvas.style.width = `${ROW_HEAD_W + shownCols.length * CELL_W}px`;
    canvas.style.height = `${HEAD_H + shownRows.length * ROW_H}px`;
    rowEls = new Map();
    win.replaceChildren();
    updateNote();
    updateCount();
    renderWindow();
  }

  function setHoverCol(c: number): void {
    if (c === hoverCol) return;
    hoverCol = c;
    for (const el of canvas.querySelectorAll<HTMLElement>(".vg-colhead.hl-col")) el.classList.remove("hl-col");
    if (c >= 0) for (const el of canvas.querySelectorAll<HTMLElement>(`.vg-colhead[data-c="${c}"]`)) el.classList.add("hl-col");
    paintAll();
  }

  // ---- changes ------------------------------------------------------------------

  /** Writes cells as one undo step. */
  function commit(writes: CellWrite[], label: string): void {
    if (readOnly() || writes.length === 0) return;
    attempt(label, (s) => applyCells(s, data, writes));
  }

  function rowsText(): string {
    return shownRows.length === data.rows.length ? `all ${data.rows.length} ${plural()}` : `the ${shownRows.length} ${plural()} shown`;
  }

  function rowRows(r: number): Row[] {
    const cols = shownCols;
    const scope = cols.length === data.columns.length ? "every viewport" : `the ${cols.length} viewports shown`;
    return STATES.map((v) => ({
      label: `${VERB[v]} in ${scope}`,
      icon: visibilityIcon(v),
      enabled: () => !readOnly(),
      run: () => commit(cols.map((col) => ({ row: r, col, value: v })), "Change visibility"),
    }));
  }

  function columnRows(c: number): Row[] {
    const rows = shownRows;
    return STATES.map((v) => ({
      label: `${VERB[v]} ${rowsText()} in this viewport`,
      icon: visibilityIcon(v),
      enabled: () => !readOnly(),
      run: () => commit(rows.map((row) => ({ row, col: c, value: v })), "Change visibility"),
    }));
  }

  function sheetRows(si: number): Row[] {
    const rows = shownRows;
    const cols = shownCols.filter((c) => data.columns[c].sheet === si);
    return STATES.map((v) => ({
      label: `${VERB[v]} ${rowsText()} in this sheet`,
      icon: visibilityIcon(v),
      enabled: () => !readOnly(),
      run: () => commit(rows.flatMap((row) => cols.map((col) => ({ row, col, value: v }))), "Change visibility"),
    }));
  }

  function openMenu(anchor: HTMLElement, rows: Row[]): void {
    closeMenu();
    menu = buildPanel(rows, closeMenu);
    backdrop.append(menu.el);
    menu.open(anchor, false);
  }

  function closeMenu(): void {
    menu?.remove();
    menu = null;
  }

  // ---- painting: shift-drag sets the value the first cell takes ------------------------------

  function reach(el: HTMLElement): void {
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    const key = `${r},${c}`;
    if (!painting || pending.has(key)) return;
    pending.set(key, { row: r, col: c, value: painting.value });
    paintCell(el, r, c);
  }

  function endPaint(): void {
    painting = null;
    pending.clear();
    window.removeEventListener("pointermove", onPaintMove);
    window.removeEventListener("pointerup", onPaintUp, true);
  }

  function cancelPaint(): void {
    if (!painting) return;
    endPaint();
    paintAll();
  }

  function onPaintMove(e: PointerEvent): void {
    const el = cellFrom(document.elementFromPoint(e.clientX, e.clientY));
    if (el && win.contains(el)) reach(el);
  }

  function onPaintUp(): void {
    const writes = [...pending.values()];
    endPaint();
    paintAll();
    suppressClick = true;
    window.setTimeout(() => (suppressClick = false), 0);
    commit(writes, "Paint visibility");
  }

  // ---- wiring -------------------------------------------------------------------

  function setTab(next: GridTab): void {
    const s = store.session;
    if (!s || next === tab) return;
    cancelPaint();
    closeMenu();
    tab = next;
    lastTab = next;
    query = "";
    search.value = "";
    search.placeholder = `Filter ${plural()}`;
    tabButtons.forEach((b, i) => {
      const on = TABS[i].id === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    data = gridData(s.doc, tab);
    scroll.scrollTop = 0;
    rebuild();
  }

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    rebuild();
  });
  sheetSelect.addEventListener("change", () => {
    sheetId = sheetSelect.value === "" ? null : sheetSelect.value;
    rebuild();
  });

  // a row, column or sheet head: its menu; a cell: cycles on a click, paints with Shift
  win.addEventListener("click", (e) => {
    const el = cellFrom(e.target);
    if (!el || suppressClick || readOnly()) return;
    // a mouse shift-click is the paint's; a keyboard click (detail 0) toggles the cell
    if (e.detail > 0 && e.shiftKey) return;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    commit([{ row: r, col: c, value: nextVisibility(cellAt(data, r, c).value) }], "Change visibility");
  });
  win.addEventListener("pointerdown", (e) => {
    const el = cellFrom(e.target);
    if (!el || e.button !== 0 || !e.shiftKey || readOnly()) return;
    e.preventDefault();
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    painting = { value: nextVisibility(cellAt(data, r, c).value) };
    reach(el);
    window.addEventListener("pointermove", onPaintMove);
    window.addEventListener("pointerup", onPaintUp, true);
  });
  canvas.addEventListener("pointerover", (e) => {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-c]") : null;
    setHoverCol(el ? Number(el.dataset.c) : -1);
  });
  scroll.addEventListener("pointerleave", () => setHoverCol(-1));
  scroll.addEventListener("scroll", () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderWindow();
    });
  });

  // every key stays inside the grid, so the editor's shortcuts do not run under it; undo and redo still do
  backdrop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (menu) closeMenu();
      else if (painting) cancelPaint();
      else close();
      return;
    }
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
  });
  // a click outside an open menu closes it; a click on the dimmed area outside the grid closes the grid
  backdrop.addEventListener("pointerdown", (e) => {
    if (menu) {
      if (!(e.target instanceof Node && menu.el.contains(e.target))) closeMenu();
      return;
    }
    if (e.target === backdrop) close();
  });
  done.addEventListener("click", () => close());
  // a key pressed with focus outside the grid (on the page) does not reach the editor's shortcuts either
  const onWindowKey = (e: KeyboardEvent): void => {
    if (e.target instanceof Node && backdrop.contains(e.target)) return;
    if (e.key === "Escape") close();
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
  };
  window.addEventListener("keydown", onWindowKey, true);

  const off = store.on("session", onSession);
  const ro = new ResizeObserver(() => renderWindow());
  ro.observe(scroll);

  /** The drawing changed (an edit, undo, redo, or another drawing): repaint, or relay out when the grid's shape changed. */
  function onSession(): void {
    const s = store.session;
    if (!s) {
      close();
      return;
    }
    cancelPaint();
    closeMenu();
    const next = gridData(s.doc, tab);
    const same = structureOf(next) === structure;
    data = next;
    if (same) {
      paintAll();
      updateNote();
      updateCount();
    } else {
      rebuild();
    }
  }

  function close(): void {
    if (current !== handle) return;
    cancelPaint();
    closeMenu();
    off();
    window.removeEventListener("keydown", onWindowKey, true);
    ro.disconnect();
    if (frame) cancelAnimationFrame(frame);
    backdrop.remove();
    current = null;
    returnFocus?.focus();
  }

  const handle = { close };
  document.body.append(backdrop);
  rebuild();
  tabButtons.forEach((b, i) => {
    const on = TABS[i].id === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  search.focus();
  return handle;
}
