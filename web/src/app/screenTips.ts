// Screen tips, as Vectorworks shows them over tools, modes and other palette features: after the
// pointer rests on one, a tip with its name and key and, where there is more to say, what it
// does (a tool: the tool set it is in and how to use it, as the Mode bar's help puts it; a mode:
// the group it is in). Once a tip has shown, the next comes at once as the pointer moves along
// the row; a press, a key, the wheel or the pointer leaving puts it away. Touch shows none.

import "./screenTips.css";
import { h } from "./dom.ts";

export interface ScreenTip {
  readonly title: string;
  /** its key, as the menus show keys */
  readonly keys?: string;
  /** a line in smaller type under the title: where it belongs */
  readonly note?: string;
  /** what it does; " · " parts after the first are keys to use, shown as keys */
  readonly detail?: string;
}

/** how long the pointer rests before a tip shows (ms) */
const DELAY = 550;
/** how long after a tip goes the next shows at once (ms) */
const WARM = 400;
/** the tip's gap from what it is about, and from the window's edges (px) */
const GAP = 8;

const tips = new WeakMap<Element, () => ScreenTip>();
let installed = false;

/** Gives `el` a screen tip in place of its title (which would show the browser's own tip too). */
export function screenTip(el: HTMLElement, tip: () => ScreenTip): void {
  el.removeAttribute("title");
  tips.set(el, tip);
  if (!installed) install();
}

function install(): void {
  installed = true;
  const box = h("div", { cls: "screen-tip", attrs: { role: "tooltip" }, hidden: true });
  document.body.append(box);
  let over: HTMLElement | null = null;
  let timer = 0;
  let warmUntil = 0;
  let pointer = { x: 0, y: 0 };

  const hide = (): void => {
    window.clearTimeout(timer);
    if (!box.hidden) warmUntil = performance.now() + WARM;
    box.hidden = true;
  };
  const show = (el: HTMLElement): void => {
    const tip = tips.get(el)?.();
    if (!tip || !el.isConnected) return;
    const [step, ...keys] = (tip.detail ?? "").split(" · ");
    const parts = [
      h("div", { cls: "screen-tip-head" }, h("span", { cls: "screen-tip-title", text: tip.title }), tip.keys ? h("kbd", { cls: "screen-tip-key", text: tip.keys }) : null),
      tip.note ? h("div", { cls: "screen-tip-note", text: tip.note }) : null,
      step ? h("div", { cls: "screen-tip-detail", text: step }) : null,
      keys.length ? h("div", { cls: "screen-tip-keys" }, ...keys.map((k) => h("span", { cls: "screen-tip-chip", text: k }))) : null,
    ];
    box.replaceChildren(...parts.filter((p) => p !== null));
    box.hidden = false;
    // under what it is about, from the pointer; above it when there's no room below
    const r = el.getBoundingClientRect();
    const w = box.offsetWidth;
    const ht = box.offsetHeight;
    const left = Math.min(Math.max(GAP, pointer.x - 12), window.innerWidth - w - GAP);
    const below = r.bottom + GAP;
    const top = below + ht <= window.innerHeight - GAP ? below : Math.max(GAP, r.top - ht - GAP);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  };

  document.addEventListener(
    "pointerover",
    (e) => {
      if (e.pointerType === "touch") return;
      let el: Element | null = e.target instanceof Element ? e.target : null;
      while (el && !tips.has(el)) el = el.parentElement;
      const next = el as HTMLElement | null;
      if (next === over) return;
      hide();
      over = next;
      if (!next) return;
      pointer = { x: e.clientX, y: e.clientY };
      if (performance.now() < warmUntil) show(next);
      else timer = window.setTimeout(() => show(next), DELAY);
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (box.hidden) pointer = { x: e.clientX, y: e.clientY };
    },
    true,
  );
  const away = (): void => {
    hide();
    warmUntil = 0;
  };
  for (const type of ["pointerdown", "keydown", "wheel"] as const) document.addEventListener(type, away, true);
  document.documentElement.addEventListener("pointerleave", () => {
    over = null;
    away();
  });
  window.addEventListener("blur", away);
}
