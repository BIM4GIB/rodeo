// The View bar's Layer and Class visibility lists, as Vectorworks drops them:
// every design layer or class with three columns (visible, grayed, hidden), set
// with a click, the list staying open for the next. A click on a column's head
// sets every listed row; the search narrows the list (classes run to hundreds).
// Each change is one undo step, as in the Navigation palette.

import type { Visibility } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { visibilityIcon } from "./icons.ts";
import { visibilityLabel } from "./panels/common.ts";
import { store } from "./state.ts";

const STATES: readonly Visibility[] = ["visible", "grayed", "hidden"];
/** gap kept between the list and the window's edges, px */
const EDGE = 8;

interface Entry {
  readonly key: string;
  readonly name: string;
  readonly visibility: Visibility;
  /** the active layer or class, marked in the list */
  readonly active: boolean;
}

interface ListKind {
  readonly noun: string;
  entries(): readonly Entry[];
  /** sets the visibility of the rows keyed `keys`, as one undo step */
  set(keys: readonly string[], v: Visibility): void;
}

const LAYERS: ListKind = {
  noun: "layer",
  entries: () =>
    (store.session?.doc.layers() ?? [])
      .filter((l) => l.kind === "design")
      .map((l) => ({ key: l.id, name: l.name, visibility: l.visibility, active: l.id === store.activeLayerId })),
  set: (keys, v) =>
    attempt("Change visibility", (s) => s.batch(() => keys.forEach((id) => s.setLayerVisibility(id, v)))),
};

const CLASSES: ListKind = {
  noun: "class",
  entries: () =>
    (store.session?.doc.classes() ?? []).map((c) => ({
      key: String(c.index),
      name: c.name,
      visibility: c.visibility,
      active: c.index === store.activeClassIndex,
    })),
  set: (keys, v) =>
    attempt("Change visibility", (s) => s.batch(() => keys.forEach((k) => s.setClassVisibility(Number(k), v)))),
};

let openList: { readonly anchor: HTMLElement; close(): void } | null = null;

/** A View bar button that drops the layer (or class) visibility list; a second press closes it. */
export function visibilityListButton(btn: HTMLButtonElement, what: "layers" | "classes"): HTMLButtonElement {
  btn.setAttribute("aria-haspopup", "dialog");
  btn.addEventListener("click", () => {
    btn.blur();
    if (openList?.anchor === btn) openList.close();
    else open(btn, what === "layers" ? LAYERS : CLASSES);
  });
  return btn;
}

function open(anchor: HTMLElement, kind: ListKind): void {
  openList?.close();
  const title = kind === LAYERS ? "Layer visibility" : "Class visibility";
  const search = h("input", {
    cls: "vl-search",
    placeholder: `Search ${kind === LAYERS ? "layers" : "classes"}`,
    attrs: { type: "search", "aria-label": `Search ${kind === LAYERS ? "layers" : "classes"}`, autocomplete: "off", spellcheck: "false" },
  });
  const heads = STATES.map((v) => {
    const btn = h("button", {
      cls: `vl-col vl-head vis-${v}`,
      html: visibilityIcon(v),
      title: `${visibilityLabel(v)}: set every listed ${kind.noun}`,
      attrs: { type: "button", "aria-label": `Make every listed ${kind.noun} ${visibilityLabel(v).toLowerCase()}` },
    });
    btn.addEventListener("click", () => kind.set(shown.map((e) => e.key), v));
    return btn;
  });
  const list = h("div", { cls: "vl-list", attrs: { role: "list" } });
  const empty = h("p", { cls: "vl-empty", text: "None match.", hidden: true });
  const pop = h(
    "div",
    { cls: "vl-pop", attrs: { role: "dialog", "aria-label": title, tabindex: "-1" } },
    search,
    h("div", { cls: "vl-row vl-headrow" }, ...heads, h("span", { cls: "vl-name", text: kind === LAYERS ? "Design layer" : "Class" })),
    list,
    empty,
  );

  let shown: readonly Entry[] = [];
  const render = (): void => {
    const q = search.value.trim().toLowerCase();
    const all = kind.entries();
    shown = q === "" ? all : all.filter((e) => e.name.toLowerCase().includes(q));
    // the rows are rebuilt: a focused cell's place is kept, so keys still reach the list
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
    list.replaceChildren(
      ...shown.map((e) =>
        h(
          "div",
          { cls: `vl-row${e.active ? " active" : ""}`, attrs: { role: "listitem" } },
          ...STATES.map((v) => {
            const on = e.visibility === v;
            const cell = h("button", {
              cls: `vl-col vis-${v}${on ? " on" : ""}`,
              html: on ? visibilityIcon(v) : "",
              title: visibilityLabel(v),
              attrs: {
                type: "button",
                "aria-label": `${e.name}: ${visibilityLabel(v)}`,
                "aria-pressed": String(on),
                "data-key": e.key,
                "data-vis": v,
              },
            });
            cell.addEventListener("click", () => {
              if (!on) kind.set([e.key], v);
            });
            return cell;
          }),
          h("span", { cls: "vl-name", text: e.name, title: e.active ? `${e.name} (active)` : e.name }),
        ),
      ),
    );
    empty.hidden = shown.length > 0;
    if (focused) {
      const again = [...list.querySelectorAll<HTMLElement>(".vl-col")].find(
        (c) => c.dataset.key === focused.dataset.key && c.dataset.vis === focused.dataset.vis,
      );
      (again ?? pop).focus();
    }
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
    close();
  };
  // Escape closes the list wherever focus is, and is not passed on to clear the selection
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  // a change made here (or by undo) re-reads the rows; a closed drawing closes the list
  const onSession = (): void => {
    if (!store.session) close();
    else if (openList === entry) render();
  };
  const off = store.on(["session", "layer", "class"], onSession);
  function close(): void {
    if (openList !== entry) return;
    openList = null;
    off();
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onEscape, true);
    window.removeEventListener("resize", place);
    pop.remove();
  }
  const entry = { anchor, close };

  pop.addEventListener("keydown", (e) => {
    // plain keys belong to the list (tool keys must not reach the editor); Cmd/Ctrl ones (undo) still do
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
  });
  search.addEventListener("input", render);
  render();
  document.body.append(pop);
  place();
  openList = entry;
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onEscape, true);
  window.addEventListener("resize", place);
  search.focus();
}
