// What the Stage menu's windows share: a floating window that leaves the drawing usable behind it, tabs,
// a sortable table with editable cells, and CSV and text downloads. Input forms use toolPrefs instead.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import "./theatre.css";

export interface PanelAction {
  readonly label: string;
  readonly run: () => void;
  readonly primary?: boolean;
}

export interface PanelOptions {
  /** a second open with the same key brings the first forward instead */
  readonly key: string;
  readonly title: string;
  readonly body: HTMLElement;
  /** buttons at its foot, beside Close */
  readonly actions?: readonly PanelAction[];
  readonly width?: number;
  readonly height?: number;
  /** "side" opens it against the canvas's right edge, for a window that reads what the drawing shows; otherwise it is centred */
  readonly anchor?: "side";
  readonly onClose?: () => void;
}

export interface OpenPanel {
  close(): void;
  readonly element: HTMLElement;
}

/** How far a "side" window keeps from the canvas's edges. */
const SIDE_GAP_PX = 12;

const open = new Map<string, OpenPanel>();
let cascade = 0;

/** Opens a floating window over the drawing, which stays usable; drag it by its title and resize it from its corner. */
export function openPanel(o: PanelOptions): OpenPanel {
  const already = open.get(o.key);
  if (already) {
    document.body.append(already.element);
    return already;
  }
  const closeButton = h("button", { cls: "btn th-close", text: "×", title: "Close", attrs: { type: "button", "aria-label": `Close ${o.title}` } });
  const title = h("div", { cls: "th-panel-title", text: o.title });
  const head = h("div", { cls: "th-panel-head" }, title, closeButton);
  const foot = h("div", { cls: "th-panel-foot" });
  for (const a of o.actions ?? []) {
    const b = h("button", { cls: a.primary ? "btn primary" : "btn", text: a.label, attrs: { type: "button" } });
    b.addEventListener("click", () => a.run());
    foot.append(b);
  }
  const el = h("section", { cls: "th-panel", attrs: { role: "dialog", "aria-label": o.title } }, head, h("div", { cls: "th-panel-body" }, o.body));
  if (o.actions?.length) el.append(foot);
  const width = Math.min(o.width ?? 720, window.innerWidth - 32);
  const height = Math.min(o.height ?? 520, window.innerHeight - 32);
  const step = cascade++ % 6;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  const canvas = o.anchor === "side" ? appContext()?.canvas.getBoundingClientRect() : undefined;
  el.style.left = `${canvas ? Math.max(16, canvas.right - width - SIDE_GAP_PX) : Math.max(16, (window.innerWidth - width) / 2 + step * 24)}px`;
  el.style.top = `${canvas ? canvas.top + SIDE_GAP_PX : Math.max(16, (window.innerHeight - height) / 2 + step * 24)}px`;
  const panel: OpenPanel = {
    element: el,
    close() {
      el.remove();
      open.delete(o.key);
      o.onClose?.();
    },
  };
  closeButton.addEventListener("click", () => panel.close());
  el.addEventListener("pointerdown", () => {
    if (document.body.lastElementChild !== el) document.body.append(el);
  });
  head.addEventListener("pointerdown", (e) => {
    if (e.target === closeButton) return;
    const startX = e.clientX - el.offsetLeft;
    const startY = e.clientY - el.offsetTop;
    head.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent): void => {
      el.style.left = `${Math.min(window.innerWidth - 80, Math.max(0, m.clientX - startX))}px`;
      el.style.top = `${Math.min(window.innerHeight - 40, Math.max(0, m.clientY - startY))}px`;
    };
    const up = (): void => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
  });
  // keys typed in a window aren't the drawing's shortcuts
  el.addEventListener("keydown", (e) => e.stopPropagation());
  document.body.append(el);
  open.set(o.key, panel);
  return panel;
}

export interface Tab {
  readonly id: string;
  readonly label: string;
  /** made each time the tab is shown */
  readonly build: () => HTMLElement;
}

/** A row of tabs over the one showing; `refresh` builds the tab in front again. */
export function tabs(list: readonly Tab[], first?: string): { readonly element: HTMLElement; refresh(): void; readonly current: () => string } {
  let current = list.find((t) => t.id === first)?.id ?? list[0]?.id ?? "";
  const body = h("div", { cls: "th-tab-body" });
  const strip = h("div", { cls: "th-tabs", attrs: { role: "tablist" } });
  const show = (): void => {
    for (const b of strip.children) b.classList.toggle("on", (b as HTMLElement).dataset.tab === current);
    const t = list.find((x) => x.id === current);
    body.replaceChildren(...(t ? [t.build()] : []));
  };
  for (const t of list) {
    const b = h("button", { cls: "th-tab", text: t.label, attrs: { type: "button", role: "tab" } });
    b.dataset.tab = t.id;
    b.addEventListener("click", () => {
      current = t.id;
      show();
    });
    strip.append(b);
  }
  show();
  return { element: h("div", { cls: "th-tabbed" }, strip, body), refresh: show, current: () => current };
}

export interface Column<R> {
  readonly label: string;
  readonly value: (row: R) => string | number;
  /** a cell of this column can be typed in; the new text goes here */
  readonly edit?: (row: R, text: string) => void;
  /** numbers line up on the right */
  readonly numeric?: boolean;
  readonly width?: number;
  /** a class for a cell: th-bad (red) or th-warn (amber) mark a problem */
  readonly cellClass?: (row: R) => string | undefined;
}

export interface TableOptions<R> {
  readonly empty?: string;
  /** runs when a row is clicked (not while typing in one of its cells) */
  readonly onRow?: (row: R) => void;
  readonly rowClass?: (row: R) => string | undefined;
}

/** A sortable table: click a column's head to sort by it, again to reverse. `refresh` reads the rows again. */
export function dataTable<R>(columns: readonly Column<R>[], rows: () => readonly R[], options: TableOptions<R> = {}): { readonly element: HTMLElement; refresh(): void } {
  let sortBy = -1;
  let descending = false;
  const body = h("tbody");
  const head = h("tr");
  const table = h("table", { cls: "th-table" }, h("thead", {}, head), body);
  const empty = h("p", { cls: "th-empty", text: options.empty ?? "Nothing to show." });
  const wrap = h("div", { cls: "th-table-wrap" }, table, empty);
  const compare = (a: string | number, b: string | number): number => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }));
  const refresh = (): void => {
    let list = [...rows()];
    if (sortBy >= 0) {
      const col = columns[sortBy];
      list = list.map((r, i) => ({ r, i })).sort((x, y) => compare(col.value(x.r), col.value(y.r)) * (descending ? -1 : 1) || x.i - y.i).map((x) => x.r);
    }
    empty.hidden = list.length > 0;
    table.hidden = list.length === 0;
    body.replaceChildren(
      ...list.map((row) => {
        const tr = h("tr", { cls: options.rowClass?.(row) });
        for (const col of columns) {
          const shown = String(col.value(row));
          const td = h("td", { cls: [col.numeric ? "num" : "", col.cellClass?.(row) ?? ""].filter(Boolean).join(" ") });
          if (col.edit) {
            const input = h("input", { cls: "th-cell", value: shown, attrs: { type: "text", "aria-label": col.label } });
            input.addEventListener("click", (e) => e.stopPropagation());
            input.addEventListener("change", () => col.edit!(row, input.value));
            input.addEventListener("keydown", (e) => {
              if (e.key === "Enter") input.blur();
            });
            td.append(input);
          } else td.textContent = shown;
          tr.append(td);
        }
        if (options.onRow) tr.addEventListener("click", () => options.onRow!(row));
        return tr;
      }),
    );
  };
  columns.forEach((col, i) => {
    const th = h("th", { cls: col.numeric ? "num" : undefined, text: col.label, attrs: { scope: "col" } });
    if (col.width) th.style.width = `${col.width}px`;
    th.addEventListener("click", () => {
      if (sortBy === i) descending = !descending;
      else {
        sortBy = i;
        descending = false;
      }
      for (const c of head.children) c.classList.remove("up", "down");
      th.classList.add(descending ? "down" : "up");
      refresh();
    });
    head.append(th);
  });
  refresh();
  return { element: wrap, refresh };
}

/** The table's rows as CSV text, quoted as spreadsheets expect. */
export function csvText(headings: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const cell = (v: string | number): string => {
    const t = String(v);
    return /[",\r\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
  };
  return [headings, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** The rows of `columns` over `rows`, as csvText writes them. */
export function csvOf<R>(columns: readonly Column<R>[], rows: readonly R[]): string {
  return csvText(columns.map((c) => c.label), rows.map((r) => columns.map((c) => c.value(r))));
}

/** Saves text as a file in the downloads. */
export function downloadText(name: string, text: string, mime = "text/plain"): void {
  downloadBlob(name, new Blob([text], { type: `${mime};charset=utf-8` }));
}

/** A line of small text for under a table: what it counts, or a warning. */
export function noteLine(text: string, cls?: "th-bad" | "th-warn"): HTMLElement {
  return h("p", { cls: cls ? `th-note ${cls}` : "th-note", text });
}
