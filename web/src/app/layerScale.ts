// Active Layer Scale…, on the drawing's right-click menu as Vectorworks' document context menu has
// it: the active design layer's scale, picked from the usual architectural, engineering and metric
// scales (the drawing's own kind first) or typed as 1:n, and All Layers to give every design layer
// that scale. One undo step. Vectorworks' Scale Text isn't offered: how it keeps a text's size as
// the scale changes isn't known, so texts stay as they are.

import { h } from "./dom.ts";
import { attempt } from "./commands.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** Each list of scales: the label shown and n of 1:n. */
const ARCHITECTURAL: readonly (readonly [string, number])[] = [
  ['1/16" = 1\'-0"', 192],
  ['1/8" = 1\'-0"', 96],
  ['3/16" = 1\'-0"', 64],
  ['1/4" = 1\'-0"', 48],
  ['3/8" = 1\'-0"', 32],
  ['1/2" = 1\'-0"', 24],
  ['3/4" = 1\'-0"', 16],
  ['1" = 1\'-0"', 12],
  ['1-1/2" = 1\'-0"', 8],
  ['3" = 1\'-0"', 4],
];
const ENGINEERING: readonly (readonly [string, number])[] = [
  ["1\" = 10'", 120],
  ["1\" = 20'", 240],
  ["1\" = 30'", 360],
  ["1\" = 40'", 480],
  ["1\" = 50'", 600],
  ["1\" = 60'", 720],
  ["1\" = 100'", 1200],
];
const METRIC: readonly (readonly [string, number])[] = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 1250, 2500, 5000].map((n) => [`1:${n}`, n] as const);

function activeDesignLayer(): { id: string; scale: number } | null {
  const doc = store.session?.doc;
  const l = doc?.layers().find((x) => x.id === store.activeLayerId);
  return l?.kind === "design" ? { id: l.id, scale: l.scale } : null;
}

export function canSetActiveLayerScale(): boolean {
  return activeDesignLayer() !== null;
}

function imperial(units: string | undefined): boolean {
  const u = (units ?? "").toLowerCase();
  return u.includes("feet") || u.includes("foot") || u.includes("inch");
}

export async function activeLayerScaleDialog(): Promise<void> {
  const doc = store.session?.doc;
  const layer = activeDesignLayer();
  if (!doc || !layer) return;
  const groups: [string, readonly (readonly [string, number])[]][] = [
    ["Architectural", ARCHITECTURAL],
    ["Engineering", ENGINEERING],
    ["Metric", METRIC],
  ];
  if (!imperial(doc.info.units)) groups.unshift(groups.pop()!);
  const list = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Scale" } },
    ...groups.map(([label, scales]) => h("optgroup", { attrs: { label } }, ...scales.map(([text, n]) => h("option", { value: String(n), text })))),
  );
  const ratio = h("input", { cls: "menu-dialog-input", value: String(layer.scale), attrs: { type: "text", inputmode: "decimal", "aria-label": "Scale 1:" } });
  // the list shows the scale typed when it has it, else nothing
  const sync = (): void => {
    list.value = String(Number(ratio.value));
    if (list.selectedIndex < 0) list.value = "";
  };
  list.addEventListener("change", () => {
    if (list.value) ratio.value = list.value;
  });
  ratio.addEventListener("input", sync);
  sync();
  const all = h("input", { attrs: { type: "checkbox", "aria-label": "All Layers" } });
  const r = await showDialog<{ scale: number; all: boolean }>({
    title: "Layer Scale",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Scale" }), list),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "1:" }), ratio),
      h("label", { cls: "menu-dialog-check" }, all, "All Layers"),
      h("p", { cls: "muted", text: "All Layers gives every design layer this scale; otherwise only the active one takes it." }),
    ],
    check: () => {
      const n = Number(ratio.value.trim());
      if (!(n > 0) || !Number.isFinite(n)) return { error: "The scale is 1 to a positive number.", focus: ratio };
      return { value: { scale: n, all: all.checked } };
    },
  });
  if (!r) return;
  const ids = r.all ? doc.layers().filter((l) => l.kind === "design" && l.scale !== r.scale).map((l) => l.id) : layer.scale !== r.scale ? [layer.id] : [];
  if (!ids.length) {
    toast(r.all ? `Every design layer is at 1:${r.scale} already.` : `The layer is at 1:${r.scale} already.`, "info");
    return;
  }
  const done = attempt("Layer Scale", (s) =>
    s.batch(() => {
      for (const id of ids) s.setLayerScale(id, r.scale);
    }),
  );
  if (done) toast(`${ids.length === 1 ? "1 design layer is" : `${ids.length} design layers are`} now at 1:${r.scale}.`, "info");
}
