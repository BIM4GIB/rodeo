// The menu bar's row of titles: File, Edit, View, Modify … Window, Help across the top of the
// window, as Vectorworks shows its menus, in place of reaching them through the Menu button.
// Window > Top Bar > Menu Bar shows it (the Dense and Classic workspaces do). A press on a title
// drops its menu; while one is down, moving over another title drops that one instead, as a
// native menu bar does. The titles follow the menus as they stand: the ones features add, and
// the order Window > Menus… sets.

import { h } from "./dom.ts";
import { closeContextMenu, openContextMenu, type Row } from "./menu.ts";
import "./menuStrip.css";

export function mountMenuStrip(strip: HTMLElement, menus: () => readonly { readonly title: string; readonly rows: readonly Row[] }[]): void {
  let drawn = "";
  /** the title whose menu is down */
  let open: HTMLButtonElement | null = null;

  const render = (): void => {
    const defs = menus();
    const key = defs.map((d) => d.title).join("\n");
    if (key === drawn) return;
    drawn = key;
    strip.replaceChildren(
      ...defs.map((d) => h("button", { cls: "menu-strip-title", text: d.title, attrs: { type: "button", "aria-haspopup": "menu", "data-title": d.title, "data-i18n": `Menu › ${d.title}` } })),
    );
  };

  const drop = (btn: HTMLButtonElement): void => {
    const rows = menus().find((d) => d.title === btn.dataset.title)?.rows;
    if (!rows) return;
    open?.classList.remove("open");
    open = btn;
    btn.classList.add("open");
    const r = btn.getBoundingClientRect();
    openContextMenu(rows, r.left, r.bottom, btn, () => {
      btn.classList.remove("open");
      if (open === btn) open = null;
    });
  };

  const titleOf = (e: Event): HTMLButtonElement | null => (e.target instanceof Element ? e.target.closest<HTMLButtonElement>(".menu-strip-title") : null);

  strip.addEventListener("pointerdown", (e) => {
    const btn = titleOf(e);
    if (!btn || e.button !== 0) return;
    // no focus ring from the pointer; the menu opens on the press, as a native one does
    e.preventDefault();
    if (open === btn) closeContextMenu();
    else drop(btn);
  });
  strip.addEventListener("pointerover", (e) => {
    const btn = titleOf(e);
    if (btn && open && open !== btn) drop(btn);
  });
  // the keyboard: Enter or Space on a title
  strip.addEventListener("click", (e) => {
    const btn = titleOf(e);
    if (!btn || e.detail !== 0) return;
    if (open === btn) closeContextMenu();
    else drop(btn);
  });
  // menus a feature adds once it knows it can (the cloud's, say) show as the pointer comes
  strip.addEventListener("pointerenter", render);
  window.addEventListener("focus", render);
  render();
}
