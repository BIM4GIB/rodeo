// The cursor aids Edit > Preferences… > Interactive turns on, as Vectorworks draws them: crosshairs
// across the whole drawing at the pointer (the full-screen cursor), for lining things up by eye; a
// square at the pointer the size of the selection box, within which a click picks an object; and a
// larger one the size of the snap box, within which snapping reaches. Rules and boxes over the
// canvas that let the pointer through; hidden when the pointer leaves the canvas or is a finger.

import { h } from "./dom.ts";
import { onPrefs, prefs } from "./prefs.ts";
import { store } from "./state.ts";

/** Puts the crosshairs and boxes over `canvas`, inside `wrap` (its positioned container). */
export function installCrosshair(canvas: HTMLElement, wrap: HTMLElement): void {
  const across = h("div", { cls: "crosshair across", attrs: { "aria-hidden": "true" } });
  const down = h("div", { cls: "crosshair down", attrs: { "aria-hidden": "true" } });
  const selectBox = h("div", { cls: "cursor-box select", attrs: { "aria-hidden": "true" } });
  const snapBox = h("div", { cls: "cursor-box snap", attrs: { "aria-hidden": "true" } });
  wrap.append(across, down, selectBox, snapBox);
  const all = [across, down, selectBox, snapBox];
  const hide = (): void => {
    for (const el of all) el.hidden = true;
  };
  hide();
  canvas.addEventListener("pointermove", (e) => {
    const p = prefs();
    if (e.pointerType === "touch" || !(p.fullCursor || p.selectBox || p.snapBox)) return hide();
    const r = wrap.getBoundingClientRect();
    const x = Math.round(e.clientX - r.left);
    const y = Math.round(e.clientY - r.top);
    across.style.transform = `translateY(${y}px)`;
    down.style.transform = `translateX(${x}px)`;
    across.hidden = down.hidden = !p.fullCursor;
    const place = (box: HTMLElement, side: number, on: boolean): void => {
      box.hidden = !on;
      if (!on) return;
      box.style.width = box.style.height = `${side}px`;
      box.style.transform = `translate(${x - side / 2}px, ${y - side / 2}px)`;
    };
    place(selectBox, p.selectBoxPx, p.selectBox);
    place(snapBox, store.snapSettings.radiusPx * 2, p.snapBox);
  });
  canvas.addEventListener("pointerleave", hide);
  onPrefs(() => {
    const p = prefs();
    if (!p.fullCursor) across.hidden = down.hidden = true;
    if (!p.selectBox) selectBox.hidden = true;
    if (!p.snapBox) snapBox.hidden = true;
  });
}
