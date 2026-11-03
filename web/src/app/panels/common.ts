// Shared bits for the navigation and inspector panels.

import type { Visibility } from "../../core/index.ts";
import { h } from "../dom.ts";
import { visibilityIcon } from "../icons.ts";
import type { Row } from "../menu.ts";
import { store } from "../state.ts";

/** visible -> grayed -> hidden -> visible */
export const NEXT_VISIBILITY: Record<Visibility, Visibility> = {
  visible: "grayed",
  grayed: "hidden",
  hidden: "visible",
};

export function visibilityLabel(v: Visibility): string {
  return v === "visible" ? "Visible" : v === "grayed" ? "Grayed" : "Hidden";
}

/** Context-menu rows that set a layer's or class's visibility, the current one checked. */
export function visibilityRows(current: Visibility, set: (v: Visibility) => void): Row[] {
  return (["visible", "grayed", "hidden"] as const).map((v) => ({
    label: visibilityLabel(v),
    checked: () => v === current,
    run: () => {
      if (v !== current) set(v);
    },
  }));
}

/** Eye button that cycles visibility. The click does not reach the row. */
export function visibilityButton(v: Visibility, onCycle: () => void): HTMLButtonElement {
  const btn = h("button", {
    cls: `icon-btn vis vis-${v}`,
    html: visibilityIcon(v),
    title: `${visibilityLabel(v)}. Click to change`,
    attrs: { "aria-label": visibilityLabel(v) },
  });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onCycle();
  });
  return btn;
}

/** First "<base>-<n>" not used by a layer or class (no prompt(): Electron has none). */
export function freeName(base: string): string {
  const s = store.session;
  const taken = new Set([...(s?.doc.layers().map((l) => l.name) ?? []), ...(s?.doc.classes().map((c) => c.name) ?? [])]);
  for (let i = 1; ; i++) {
    const name = `${base}-${i}`;
    if (!taken.has(name)) return name;
  }
}
