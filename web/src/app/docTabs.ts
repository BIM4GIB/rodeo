// Document tabs: several drawings open in one window, as Vectorworks keeps them. A strip of
// tabs over the drawing shows while one is open: a click brings one to the front, its × (or a
// middle-click) closes it, and + starts or opens another. Features mark a tab (an agent at work in
// that drawing, ext.ts registerTabMark). Window > Drawings lists them too. The App (app.ts) keeps
// the drawings and what each was left at; this draws them.

import type { TabMark } from "./ext.ts";
import { openContextMenu, type Row } from "./menu.ts";
import { h } from "./dom.ts";
import { store } from "./state.ts";
import "./docTabs.css";

/** An open drawing as its tab shows it. */
export interface DocTab {
  /** the file name, without .vwx */
  readonly name: string;
  /** the file name and where it came from, for the tooltip */
  readonly title: string;
  readonly dirty: boolean;
  /** the drawing the window shows */
  readonly front: boolean;
  /** features' marks, before the name */
  readonly marks: readonly TabMark[];
}

export interface DocTabActions {
  tabs(): readonly DocTab[];
  select(index: number): void;
  close(index: number): void;
  newDrawing(): void;
  newFromTemplate(): void;
  open(): void;
  /** File > Open Recent's rows */
  recentRows(): Row[];
}

const CLOSE_ICON = `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const NEW_ICON = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

const SHOWN_KEY = "openvwx.docTabs";

/** Window > Show Document Tabs: the strip shows while a drawing is open, unless turned off (kept per browser). */
let wanted = ((): boolean => {
  try {
    return localStorage.getItem(SHOWN_KEY) !== "off";
  } catch {
    return true;
  }
})();
let redraw: () => void = () => undefined;

export function docTabsShown(): boolean {
  return wanted;
}

export function setDocTabsShown(on: boolean): void {
  wanted = on;
  try {
    if (on) localStorage.removeItem(SHOWN_KEY);
    else localStorage.setItem(SHOWN_KEY, "off");
  } catch {
    // storage blocked: the choice lasts while the page is open
  }
  redraw();
}

/** Mounts the strip at the top of the stage; returns a function that draws it again (after a tab closes behind the front one, or a mark changes). */
export function mountDocTabs(stage: HTMLElement, actions: DocTabActions): () => void {
  const strip = h("div", { cls: "doc-tabs", attrs: { role: "tablist", "aria-label": "Open drawings" } });
  stage.prepend(strip);
  let drawn = "";

  const newMenu = (anchor: HTMLElement): void => {
    const r = anchor.getBoundingClientRect();
    openContextMenu(
      [
        { label: "New Drawing", run: () => actions.newDrawing() },
        { label: "New from Template…", run: () => actions.newFromTemplate() },
        "-",
        { label: "Open…", run: () => actions.open() },
        { label: "Open Recent", items: () => actions.recentRows() },
      ],
      r.left,
      r.bottom + 4,
      anchor,
    );
  };

  const render = (): void => {
    const tabs = actions.tabs();
    // redrawn only when what it shows changes: every edit says "session"
    const key = JSON.stringify([wanted, tabs]);
    if (key === drawn) return;
    drawn = key;
    const shown = wanted && tabs.length >= 1;
    stage.classList.toggle("has-tabs", shown);
    strip.hidden = !shown;
    strip.replaceChildren();
    if (!shown) return;
    tabs.forEach((t, i) => {
      const close = h("button", { cls: "doc-tab-close", attrs: { type: "button", title: "Close", "aria-label": `Close ${t.name}` } });
      close.innerHTML = CLOSE_ICON;
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        actions.close(i);
      });
      const marks = t.marks.map((m) => h("span", { cls: `doc-tab-mark${m.cls ? ` ${m.cls}` : ""}`, html: m.html, attrs: { title: m.title } }));
      const title = [t.title, ...t.marks.map((m) => m.title)].join("\n");
      const tab = h(
        "div",
        { cls: `doc-tab${t.front ? " front" : ""}${t.dirty ? " dirty" : ""}`, attrs: { role: "tab", "aria-selected": String(t.front), tabindex: t.front ? "0" : "-1", title } },
        ...marks,
        h("span", { cls: "doc-tab-name", text: t.name, attrs: { translate: "no" } }),
        h("span", { cls: "doc-tab-dot", attrs: { title: "Unsaved changes" } }),
        close,
      );
      tab.addEventListener("pointerdown", (e) => {
        if (e.button === 0 && !(e.target as Element).closest(".doc-tab-close")) actions.select(i);
      });
      // a middle-click closes, as in a browser
      tab.addEventListener("auxclick", (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        actions.close(i);
      });
      tab.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const to = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          actions.select(to);
          strip.querySelector<HTMLElement>(".doc-tab.front")?.focus();
        }
      });
      strip.append(tab);
    });
    const add = h("button", { cls: "doc-tab-new", attrs: { type: "button", title: "New or open a drawing", "aria-label": "New or open a drawing", "aria-haspopup": "menu" } });
    add.innerHTML = NEW_ICON;
    add.addEventListener("click", () => newMenu(add));
    strip.append(add);
    strip.querySelector(".doc-tab.front")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  store.on(["session", "file"], render);
  redraw = render;
  render();
  return render;
}

/** Window > Drawings: each open drawing, the front one checked, and the next and previous. */
export function drawingRows(actions: DocTabActions): Row[] {
  const tabs = actions.tabs();
  const front = tabs.findIndex((t) => t.front);
  const step = (by: number): void => actions.select((front + by + tabs.length) % tabs.length);
  return [
    ...tabs.map((t, i): Row => ({ label: t.dirty ? `${t.name} •` : t.name, checked: () => t.front, run: () => actions.select(i) })),
    "-",
    { label: "Next Drawing", why: () => "Open another drawing first", enabled: () => tabs.length > 1, run: () => step(1) },
    { label: "Previous Drawing", why: () => "Open another drawing first", enabled: () => tabs.length > 1, run: () => step(-1) },
  ];
}
