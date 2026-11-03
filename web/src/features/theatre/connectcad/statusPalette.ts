// ConnectCAD's ConnectCAD Status (Stage > ConnectCAD): a palette that runs Check Drawing's checks
// (markup.ts) over every design layer again whenever the drawing changes while it's open, without
// marking anything, and lists the issues, errors first: each one's severity, the object, the issue and
// its details, buttons that zoom to it (and step through the others of a duplicate), its outline
// flashed on the drawing, and Ignore, which greys it at the foot until Restore. Ignored issues are
// kept by what they name while the drawing is open.

import type { BBox, Pt } from "../../../core/index.ts";
import { setActiveLayer } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { appContext, registerOverlay } from "../../../app/ext.ts";
import { UI_ICON } from "../../../app/icons.ts";
import { store } from "../../../app/state.ts";
import { watchDrawing } from "../loads/loadsUi.ts";
import { openPanel, type OpenPanel } from "../ui.ts";
import { CHECK_KINDS, issueObject, statusRows, type Issue } from "./ccadChecks.ts";
import { colours, issuesOn } from "./markup.ts";

/** how long a zoomed-to issue's outline shows, ms, and how long the drawing must be still before the checks run again */
const FLASH_MS = 2500;
const SETTLE_MS = 300;

let panel: OpenPanel | null = null;
let stopWatching: (() => void) | null = null;
/** the issues ignored, by issueKey, for the drawing they were ignored in */
let ignored = new Set<string>();
let ignoredIn: unknown = null;
/** the outline being flashed, until when */
let flash: { outline: readonly Pt[]; layerId: string; colour: string; until: number } | null = null;

registerOverlay((p) => {
  if (!flash || performance.now() > flash.until || store.activeLayerId !== flash.layerId) return;
  const ctx = p.ctx;
  ctx.save();
  ctx.strokeStyle = flash.colour;
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  flash.outline.forEach((q, i) => {
    const s = p.toScreen(q);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
});

/** The view zoomed to an issue's outline on its layer, the outline flashed. */
function showIssue(i: Issue): void {
  const ctx = appContext();
  if (!ctx || !i.outline.length) return;
  if (i.layerId && store.activeLayerId !== i.layerId && store.session?.doc.layers().some((l) => l.id === i.layerId)) setActiveLayer(i.layerId);
  const xs = i.outline.map((q) => q.x);
  const ys = i.outline.map((q) => q.y);
  const box: BBox = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  // a little of what's round it in view too
  const grow = Math.max(box.x1 - box.x0, box.y1 - box.y0) * 2;
  ctx.view.fit({ x0: box.x0 - grow, y0: box.y0 - grow, x1: box.x1 + grow, y1: box.y1 + grow });
  flash = { outline: i.outline, layerId: store.activeLayerId ?? "", colour: colours[i.severity], until: performance.now() + FLASH_MS };
  ctx.requestDraw();
  store.emit("view");
  setTimeout(() => appContext()?.requestDraw(), FLASH_MS + 50);
}

const button = (text: string, title: string, run: () => void, icon?: string): HTMLButtonElement => {
  const b = h("button", { cls: "btn ccad-status-btn", text, title, attrs: { type: "button", "aria-label": title } });
  if (icon) b.innerHTML = icon;
  b.addEventListener("click", run);
  return b;
};

/** The palette's content as the drawing is now. */
function contentNow(redraw: () => void): HTMLElement {
  const s = store.session;
  if (!s) return h("p", { cls: "muted", text: "No drawing is open." });
  if (ignoredIn !== s) {
    ignored = new Set();
    ignoredIn = s;
  }
  const design = new Set(s.doc.layers().filter((l) => l.kind === "design").map((l) => l.id));
  const rows = statusRows(issuesOn(s, design, new Set(CHECK_KINDS)), ignored);
  const live = rows.filter((r) => !r.ignored);
  if (!rows.length) return h("p", { cls: "ccad-note", text: "No issues found." });
  const count = (sv: Issue["severity"], one: string, many: string): string | null => {
    const n = live.filter((r) => r.issue.severity === sv).length;
    return n ? `${n} ${n === 1 ? one : many}` : null;
  };
  const summary = [count("Error", "error", "errors"), count("Warning", "warning", "warnings"), count("Notify", "note", "notes")].filter(Boolean).join(", ") || "No issues to resolve";
  const ignoredCount = rows.length - live.length;
  const head = h("tr", {}, ...["Status", "Object", "Issue", "Details", "View", "Resolve"].map((t) => h("th", { text: t })));
  const body = rows.map((r) => {
    const i = r.issue;
    const at = r.others.indexOf(i);
    const step = (by: number): void => showIssue(r.others[(at + by + r.others.length) % r.others.length]);
    const view = h(
      "td",
      { cls: "ccad-status-view" },
      ...(r.others.length > 1 ? [button("‹", "Previous of these", () => step(-1))] : []),
      button("", "Zoom to it", () => showIssue(i), UI_ICON.zoomSel),
      ...(r.others.length > 1 ? [button("›", "Next of these", () => step(1))] : []),
    );
    const resolve = button(r.ignored ? "Restore" : "Ignore", r.ignored ? "Restore this issue" : "Ignore this issue", () => {
      if (r.ignored) ignored.delete(r.key);
      else ignored.add(r.key);
      redraw();
    });
    return h(
      "tr",
      { cls: r.ignored ? "ccad-gone" : "" },
      h("td", { cls: "ccad-status-sev" }, h("span", { cls: "ccad-status-dot", attrs: { style: `background:${colours[i.severity]}` } }), i.severity === "Notify" ? "Note" : i.severity),
      h("td", { text: issueObject(i) }),
      h("td", { text: i.problem }),
      h("td", { text: i.information }),
      view,
      h("td", {}, resolve),
    );
  });
  return h("div", {}, h("p", { cls: "ccad-note", text: ignoredCount ? `${summary}; ${ignoredCount} ignored.` : `${summary}.` }), h("table", { cls: "ccad-table ccad-status" }, h("thead", {}, head), h("tbody", {}, ...body)));
}

/** Stage > ConnectCAD > ConnectCAD Status: opens the palette, or brings it forward. */
export function openConnectcadStatus(): void {
  if (panel) {
    document.body.append(panel.element);
    return;
  }
  const host = h("div", { cls: "ccad-status-host" });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const redraw = (): void => {
    host.replaceChildren(contentNow(redraw));
  };
  const later = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (panel) redraw();
    }, SETTLE_MS);
  };
  redraw();
  panel = openPanel({
    key: "ccad.status",
    title: "ConnectCAD Status",
    body: host,
    anchor: "side",
    width: 620,
    height: 380,
    onClose: () => {
      if (timer) clearTimeout(timer);
      stopWatching?.();
      stopWatching = null;
      panel = null;
    },
  });
  stopWatching = watchDrawing(later);
}
