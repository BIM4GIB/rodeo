// File X-ray dialog: the file's size as a bar by category, a table of what each category holds (its
// parts expand, with a filter), and the findings with their fixes. The numbers come from analyse.ts;
// this file shows them and acts on the ids the findings name, through the session, so each fix is
// one undo step.

import { attempt, reconcile, setActiveLayer, setSelection } from "../../app/commands.ts";
import { h, nextPaint } from "../../app/dom.ts";
import type { AppContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { showLoading } from "../../app/loading.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { Model } from "../../core/model.ts";
import type { BBox } from "../../core/types.ts";
import { type CategoryId, CATEGORY_ORDER, type XrayFinding, type XrayReport, type XrayTarget, analyse } from "./analyse.ts";
import "./xray.css";

/** Segment colours by category (CATEGORY_ORDER); they read on both themes. */
const PALETTE: readonly string[] = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#2f8fa3",
  "#bab0ac",
  "#8cd17d",
  "#86bcb6",
  "#d37295",
  "#a0cbe8",
  "#f1ce63",
  "#79706e",
];
const OVERHEAD_COLOUR = "#55595f";
/** How many rows of a finding are listed; the rest are counted. */
const ROWS_SHOWN = 60;
const NAME_INDENT = 22;

interface State {
  report: XrayReport;
  tab: "contents" | "findings";
  filter: string;
  open: Set<CategoryId>;
}

let shown: { close(): void } | null = null;
let busy = false;

/** Closes the dialog (a drawing opened, say). */
export function closeXray(): void {
  shown?.close();
}

/** Analyses the open drawing and shows the dialog. */
export async function openXray(ctx: AppContext): Promise<void> {
  if (shown || busy) return;
  if (!(store.session?.doc instanceof Model)) {
    toast("Open a drawing to see what takes up its space", "info");
    return;
  }
  const report = await analysis();
  if (!report) return;
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const state: State = {
    report,
    tab: "contents",
    filter: "",
    open: new Set(report.categories.slice(0, 1).map((c) => c.id)),
  };
  const backdrop = build(ctx, state);
  const close = (): void => {
    backdrop.remove();
    shown = null;
    returnFocus?.focus();
  };
  shown = { close };
  document.body.append(backdrop);
  backdrop.querySelector<HTMLElement>("[data-first]")?.focus();
}

/** Runs the analysis behind the loading overlay; null when no drawing is open or it failed. */
async function analysis(): Promise<XrayReport | null> {
  const doc = store.session?.doc;
  if (!(doc instanceof Model)) return null;
  busy = true;
  const done = showLoading("Looking at what the drawing holds");
  try {
    await nextPaint();
    // the size the file had when it was opened; the record bytes stand in when that is unknown
    const fileBytes = store.fileSize > 0 ? store.fileSize : doc.recs.reduce((s, r) => s + r.size, 0);
    return await analyse(doc, fileBytes);
  } catch (err) {
    toast(`File X-ray failed: ${errorMessage(err)}`);
    return null;
  } finally {
    done();
    busy = false;
  }
}

// ---- formatting -----------------------------------------------------------------------------

function bytesText(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function shareText(share: number): string {
  return share > 0 && share < 0.0005 ? "<0.1%" : `${(share * 100).toFixed(1)}%`;
}

function count(n: number, unit: string): string {
  const word = n === 1 && unit.endsWith("s") ? unit.slice(0, -1) : unit;
  return `${n.toLocaleString("en-US")} ${word}`;
}

function colourOf(id: CategoryId): string {
  return PALETTE[CATEGORY_ORDER.indexOf(id) % PALETTE.length];
}

// ---- the dialog shell -------------------------------------------------------------------------

/** Builds the dialog (in a backdrop, not yet in the page) and paints it. */
function build(ctx: AppContext, state: State): HTMLElement {
  const title = h("h2", { cls: "xr-title" });
  const closeButton = h("button", { cls: "btn small", text: "Close", attrs: { type: "button" } });
  const summary = h("p", { cls: "xr-summary" });
  const bar = h("div", { cls: "xr-bar-block" });
  const tabs = h("div", { cls: "xr-tabs", attrs: { role: "tablist" } });
  const panel = h("div", { cls: "xr-panel" });
  const footer = h("div", { cls: "xr-foot" });
  const box = h(
    "div",
    { cls: "menu-dialog xr-dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "File X-ray" } },
    h("div", { cls: "xr-head" }, title, closeButton),
    summary,
    bar,
    tabs,
    panel,
    footer,
  );
  const backdrop = h("div", { cls: "menu-dialog-backdrop" }, box);
  const dismiss = (): void => {
    if (shown) shown.close();
    else backdrop.remove();
  };
  closeButton.addEventListener("click", dismiss);
  // every key stays inside the dialog, as in the other dialogs
  backdrop.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    }
  });
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) dismiss();
  });

  const paint = (): void => {
    const r = state.report;
    title.textContent = `File X-ray: ${store.fileName || "drawing"}`;
    summary.textContent =
      `The file is ${bytesText(r.fileBytes)} on disk. Its records hold ${bytesText(r.recordBytes)} in ` +
      `${r.recordCount.toLocaleString("en-US")} records, which compress to about ${Math.round(r.ratio * 100)}% of their size. ` +
      "Shares of the file are estimates from that ratio.";
    bar.replaceChildren(stackedBar(r), legend(r));
    tabs.replaceChildren(...tabButtons(state, paint));
    panel.replaceChildren(state.tab === "contents" ? contents(state, paint) : findings(ctx, state, paint, dismiss));
    const exportButton = h("button", { cls: "btn", text: "Export CSV", attrs: { type: "button" }, title: "Save the table as a spreadsheet file" });
    exportButton.addEventListener("click", () => exportCsv(state.report));
    const done = h("button", { cls: "btn primary", text: "Done", attrs: { type: "button" } });
    done.addEventListener("click", dismiss);
    footer.replaceChildren(exportButton, h("span", { cls: "xr-spacer" }), done);
  };
  paint();
  return backdrop;
}

/** Re-runs the analysis after a fix and paints again, keeping the tab and what is open. */
async function refresh(state: State, paint: () => void): Promise<void> {
  const next = await analysis();
  if (!next) return;
  state.report = next;
  state.open = new Set([...state.open].filter((id) => next.categories.some((c) => c.id === id)));
  paint();
}

function tabButtons(state: State, paint: () => void): HTMLElement[] {
  const make = (id: State["tab"], label: string): HTMLElement => {
    const selected = state.tab === id;
    const b = h("button", { cls: `xr-tab${selected ? " on" : ""}`, text: label, attrs: { type: "button", role: "tab", "aria-selected": String(selected) } });
    b.addEventListener("click", () => {
      if (state.tab === id) return;
      state.tab = id;
      paint();
    });
    return b;
  };
  const found = state.report.findings.reduce((n, f) => n + f.rows.length, 0);
  return [make("contents", "Contents"), make("findings", `Findings (${found.toLocaleString("en-US")})`)];
}

// ---- the stacked bar and its legend -----------------------------------------------------------

function stackedBar(r: XrayReport): HTMLElement {
  const bar = h("div", { cls: "xr-bar", attrs: { role: "img", "aria-label": "File size by category" } });
  for (const cat of r.categories) {
    const seg = h("div", { cls: "xr-seg", title: `${cat.label}: ${bytesText(cat.bytes)} of records, ${shareText(cat.share)} of the file` });
    seg.style.width = `${cat.share * 100}%`;
    seg.style.background = colourOf(cat.id);
    bar.append(seg);
  }
  if (r.overheadShare > 0) {
    const seg = h("div", { cls: "xr-seg", title: `Container overhead (file header and chunk framing): ${shareText(r.overheadShare)}` });
    seg.style.width = `${r.overheadShare * 100}%`;
    seg.style.background = OVERHEAD_COLOUR;
    bar.append(seg);
  }
  return bar;
}

function legend(r: XrayReport): HTMLElement {
  const chip = (colour: string, text: string, title: string): HTMLElement => {
    const swatch = h("span", { cls: "xr-swatch" });
    swatch.style.background = colour;
    return h("span", { cls: "xr-chip", title }, swatch, text);
  };
  const chips = r.categories.map((cat) => chip(colourOf(cat.id), `${cat.label} ${shareText(cat.share)}`, `${cat.label}: ${bytesText(cat.bytes)}`));
  if (r.overheadShare > 0) chips.push(chip(OVERHEAD_COLOUR, `Container ${shareText(r.overheadShare)}`, "File header and chunk framing"));
  return h("div", { cls: "xr-legend" }, ...chips);
}

// ---- contents: the expandable table -----------------------------------------------------------

function contents(state: State, paint: () => void): HTMLElement {
  const filter = h("input", {
    cls: "menu-dialog-input xr-filter",
    value: state.filter,
    attrs: { type: "search", placeholder: "Filter by name", "aria-label": "Filter by name", "data-first": "" },
  });
  const table = h("div", { cls: "xr-table", attrs: { role: "table" } });
  const fill = (): void => table.replaceChildren(...tableRows(state, paint));
  filter.addEventListener("input", () => {
    state.filter = filter.value;
    fill();
  });
  fill();
  const head = h(
    "div",
    { cls: "xr-row xr-head-row", attrs: { role: "row" } },
    h("span", { cls: "xr-c-name", text: "Name" }),
    h("span", { cls: "xr-c-count", text: "Count" }),
    h("span", { cls: "xr-c-bytes", text: "Bytes" }),
    h("span", { cls: "xr-c-share", text: "% of file" }),
  );
  return h("div", { cls: "xr-contents" }, h("div", { cls: "xr-toolbar" }, filter), h("div", { cls: "xr-scroll" }, head, table));
}

function tableRows(state: State, paint: () => void): HTMLElement[] {
  const needle = state.filter.trim().toLowerCase();
  const biggest = state.report.categories[0]?.bytes || 1;
  const out: HTMLElement[] = [];
  for (const cat of state.report.categories) {
    const catMatches = needle !== "" && cat.label.toLowerCase().includes(needle);
    const items = needle === "" || catMatches ? cat.items : cat.items.filter((it) => it.label.toLowerCase().includes(needle));
    if (needle !== "" && !catMatches && items.length === 0) continue;
    const expanded = needle !== "" ? items.length > 0 : state.open.has(cat.id);
    const caret = h("button", {
      cls: "xr-caret",
      text: cat.items.length ? (expanded ? "▾" : "▸") : "",
      attrs: { type: "button", "aria-expanded": String(expanded), "aria-label": `${expanded ? "Collapse" : "Expand"} ${cat.label}` },
      disabled: cat.items.length === 0,
    });
    caret.addEventListener("click", () => {
      if (state.open.has(cat.id)) state.open.delete(cat.id);
      else state.open.add(cat.id);
      paint();
    });
    const meter = h("span", { cls: "xr-meter" });
    meter.style.width = `calc((100% - ${NAME_INDENT}px) * ${cat.bytes / biggest})`;
    meter.style.background = colourOf(cat.id);
    out.push(
      h(
        "div",
        { cls: "xr-row xr-cat", attrs: { role: "row" } },
        h("span", { cls: "xr-c-name" }, caret, h("span", { cls: "xr-name", text: cat.label, title: cat.label }), meter),
        h("span", { cls: "xr-c-count", text: count(cat.records, "records") }),
        h("span", { cls: "xr-c-bytes", text: bytesText(cat.bytes) }),
        h("span", { cls: "xr-c-share", text: shareText(cat.share) }),
      ),
    );
    if (!expanded) continue;
    for (const it of items) {
      const tip = it.subtreeBytes !== it.bytes ? `${it.label}: ${bytesText(it.bytes)} here, ${bytesText(it.subtreeBytes)} with what it holds` : it.label;
      out.push(
        h(
          "div",
          { cls: "xr-row xr-item", attrs: { role: "row" } },
          h("span", { cls: "xr-c-name", title: tip }, h("span", { cls: "xr-name", text: it.label })),
          h("span", { cls: "xr-c-count", text: it.unit === "records" ? count(it.records, "records") : count(it.count, it.unit) }),
          h("span", { cls: "xr-c-bytes", text: bytesText(it.bytes) }),
          h("span", { cls: "xr-c-share", text: shareText(it.share) }),
        ),
      );
    }
  }
  if (out.length === 0) out.push(h("p", { cls: "xr-empty muted", text: "Nothing matches that name." }));
  return out;
}

// ---- findings ---------------------------------------------------------------------------------

function findings(ctx: AppContext, state: State, paint: () => void, dismiss: () => void): HTMLElement {
  if (state.report.findings.length === 0) {
    return h("div", { cls: "xr-scroll" }, h("p", { cls: "xr-empty", text: "Nothing to tidy: no stray or duplicate objects, empty layers, large images or unused resources were found." }));
  }
  return h("div", { cls: "xr-scroll xr-findings" }, ...state.report.findings.map((f) => findingCard(ctx, state, f, paint, dismiss)));
}

function findingCard(ctx: AppContext, state: State, f: XrayFinding, paint: () => void, dismiss: () => void): HTMLElement {
  const actions: HTMLElement[] = [];
  const action = (label: string, cls: string, run: () => void): void => {
    const b = h("button", { cls: `btn small ${cls}`, text: label, attrs: { type: "button" } });
    b.addEventListener("click", run);
    actions.push(b);
  };
  if (f.targets.length > 0) {
    action("Select", "", () => {
      selectTargets(ctx, f.targets);
      dismiss();
    });
  }
  if (f.id === "empty-layers" && f.layerIds.length > 0) {
    action("Select", "", () => {
      setActiveLayer(f.layerIds[0]);
      dismiss();
    });
  }
  if (f.id === "stray") action("Delete Stray Objects", "danger", () => void removeObjects(state, f, "Delete the stray objects?", paint));
  if (f.id === "duplicates") action("Delete Duplicates", "danger", () => void removeObjects(state, f, "Delete the duplicate objects?", paint));
  if (f.id === "empty-layers") action("Delete Empty Layers", "danger", () => void removeLayers(state, f, paint));

  const listed = f.rows.slice(0, ROWS_SHOWN);
  const note =
    f.id === "unused-symbols"
      ? "Rodeo cannot delete symbol definitions yet. In Vectorworks, purge them from the resource library."
      : f.id === "unused-resources"
        ? "Listed for review; Rodeo does not delete resources."
        : null;
  return h(
    "section",
    { cls: "xr-finding" },
    h("div", { cls: "xr-finding-head" }, h("h3", { cls: "xr-finding-title", text: f.title }), f.bytes > 0 ? h("span", { cls: "xr-finding-bytes", text: bytesText(f.bytes), title: "Record bytes this accounts for" }) : null),
    h("p", { cls: "xr-finding-summary muted", text: f.summary }),
    f.rows.length > 0
      ? h(
          "ul",
          { cls: "xr-rows" },
          ...listed.map((row) =>
            h(
              "li",
              { cls: "xr-row-item" },
              h("span", { cls: "xr-row-label", text: row.label, title: row.label }),
              h("span", { cls: "xr-row-detail muted", text: row.detail }),
              row.bytes > 0 ? h("span", { cls: "xr-row-bytes", text: bytesText(row.bytes) }) : null,
            ),
          ),
          f.rows.length > listed.length ? h("li", { cls: "xr-more muted", text: `and ${(f.rows.length - listed.length).toLocaleString("en-US")} more` }) : null,
        )
      : null,
    note ? h("p", { cls: "xr-note muted", text: note }) : null,
    actions.length > 0 ? h("div", { cls: "xr-actions" }, ...actions) : null,
  );
}

/** Activates the layer holding most of the targets, selects those on it, and zooms to all of them. */
function selectTargets(ctx: AppContext, targets: readonly XrayTarget[]): void {
  const perLayer = new Map<string, number>();
  for (const t of targets) perLayer.set(t.layerId, (perLayer.get(t.layerId) ?? 0) + 1);
  let best = "";
  let most = -1;
  for (const [layer, n] of perLayer) {
    if (n > most) {
      best = layer;
      most = n;
    }
  }
  setActiveLayer(best);
  setSelection(targets.filter((t) => t.layerId === best).map((t) => t.id));
  const box = unionOf(targets.map((t) => t.box));
  if (box) {
    ctx.view.fit(box);
    store.emit("view");
  }
}

function unionOf(boxes: readonly (BBox | undefined)[]): BBox | null {
  let out: BBox | null = null;
  for (const b of boxes) {
    if (!b) continue;
    out = out ? { x0: Math.min(out.x0, b.x0), y0: Math.min(out.y0, b.y0), x1: Math.max(out.x1, b.x1), y1: Math.max(out.y1, b.y1) } : { ...b };
  }
  return out;
}

async function removeObjects(state: State, f: XrayFinding, question: string, paint: () => void): Promise<void> {
  const ids = f.targets.map((t) => t.id);
  if (ids.length === 0) return;
  const ok = await confirmDialog(question, `${count(ids.length, "objects")}, ${bytesText(f.bytes)} of records. The change is one undo step.`, "Delete");
  if (!ok) return;
  if (!attempt("Delete", (s) => s.batch(() => s.deleteObjects(ids)))) return;
  setSelection([]);
  toast(`Deleted ${count(ids.length, "objects")}`, "info");
  await refresh(state, paint);
}

async function removeLayers(state: State, f: XrayFinding, paint: () => void): Promise<void> {
  const ids = [...f.layerIds];
  if (ids.length === 0) return;
  const ok = await confirmDialog("Delete the empty layers?", `${count(ids.length, "layers")} with no objects. The change is one undo step.`, "Delete");
  if (!ok) return;
  // a batch that throws (the last design layer, say) is rolled back whole
  if (!attempt("Delete layers", (s) =>
    s.batch(() => {
      for (const id of ids) s.deleteLayer(id);
    }),
  )) return;
  reconcile();
  toast(`Deleted ${count(ids.length, "layers")}`, "info");
  await refresh(state, paint);
}

// ---- CSV export --------------------------------------------------------------------------------

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function exportCsv(r: XrayReport): void {
  const pct = (share: number): string => (share * 100).toFixed(3);
  const rows: string[][] = [["Category", "Item", "Unit", "Count", "Record bytes", "Bytes with what it holds", "Percent of file (estimated)"]];
  for (const cat of r.categories) {
    rows.push([cat.label, "", "records", String(cat.records), String(cat.bytes), String(cat.bytes), pct(cat.share)]);
    for (const it of cat.items) {
      rows.push([cat.label, it.label, it.unit, String(it.count), String(it.bytes), String(it.subtreeBytes), pct(it.share)]);
    }
  }
  rows.push(["Container overhead", "", "", "", String(r.headerBytes + r.framingBytes), "", pct(r.overheadShare)]);
  const text = rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const base = (store.fileName || "drawing").replace(/\.vwx$/i, "");
  downloadBlob(`${base}-xray.csv`, new Blob([text], { type: "text/csv" }));
}
