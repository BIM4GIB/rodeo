// The Palettes button for a phone: the top bar's right end drops the list of palettes, and the one
// picked comes up as the bottom sheet (dock.ts). Only a phone shows the button (touch.css); wider
// windows have the docks and the Window menu.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { menuButton } from "../../app/menu.ts";

/** A window with its lower panel marked off: the palettes' sheet. */
const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12.5h16"/></svg>`;

/** The Palettes button; a click drops the palettes to pick from (Object Info first, the one in view checked). */
export function paletteButton(): HTMLElement {
  const btn = h("button", {
    cls: "tb-icon touch-palettes",
    html: ICON,
    title: "Palettes",
    attrs: { type: "button", id: "btn-palettes", "aria-label": "Palettes" },
  });
  menuButton(btn, () => appContext()?.palettes.choices() ?? []);
  return btn;
}
