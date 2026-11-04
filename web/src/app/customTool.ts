// Tools > Custom Tool/Attribute…, as Vectorworks has it: records the attributes of the one object
// selected (or, with none, those new objects are drawn with) and the active tool in a script, kept in a
// script palette, which sets them again when it is run: double-click it to draw with them. The Custom
// Tools dialog ticks what is recorded, in Vectorworks' groups, each with All: Fill Attributes (style,
// colours, opacity), Pen Attributes (style, colours, line weight), Text Attributes (size, alignment)
// and Other Attributes (class, layer, tool). Not offered: line end markers, fonts and text styles,
// symbols and snapping, which Rodeo's script calls don't set.

import type { Attributes, ObjectInfo } from "../core/index.ts";
import { SCRIPT_MODES, selectorOfTool, toolAttributeScript, type ToolAttributes } from "./customScripts.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolDef } from "./toolbar.ts";
import { textDefaults } from "./tools/text.ts";
import "./customTool.css";

/** a point, mm */
const MM_PER_POINT = 25.4 / 72;
const H_ALIGN = ["Left", "Center", "Right"];
const V_ALIGN = ["Top", "Top baseline", "Center", "Bottom baseline", "Bottom"];

interface Item {
  readonly label: string;
  /** what is recorded, as the dialog shows it; null when there is nothing to record */
  readonly shown: string | HTMLElement | null;
  readonly put: (a: ToolAttributes) => ToolAttributes;
}

interface Group {
  readonly label: string;
  readonly items: readonly Item[];
}

const styleName = (fill: boolean, n: number): string =>
  n === 0 ? "None" : n === (fill ? 1 : 2) ? "Solid" : n < 0 ? `Dash style ${-n}` : `Pattern ${n}`;

/** The groups for `attrs` (partial for new objects' settings), class, layer, text and tool. */
function groupsOf(attrs: Partial<Attributes> | null, className: string, layerName: string, text: { pts: number; h: number; v: number } | null): Group[] {
  const doc = store.session?.doc;
  const rgb = (index: number): [number, number, number] => {
    const css = doc?.color(index) ?? "#000000";
    return [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16) || 0) as [number, number, number];
  };
  const swatch = (index: number): HTMLElement => {
    const css = doc?.color(index) ?? "#000000";
    return h("span", { cls: "ct-colour" }, h("span", { cls: "ct-swatch", attrs: { style: `background:${css}` } }), css);
  };
  const a = attrs ?? {};
  const has = <K extends keyof Attributes>(k: K): boolean => a[k] !== undefined;
  const tool = selectorOfTool(store.tool);
  const toolLabel = toolDef(store.tool)?.label ?? store.tool;
  return [
    {
      label: "Fill Attributes",
      items: [
        { label: "Style", shown: has("fillPattern") ? styleName(true, a.fillPattern!) : null, put: (t) => ({ ...t, fillPattern: a.fillPattern }) },
        { label: "Foreground Color", shown: has("fillFore") ? swatch(a.fillFore!) : null, put: (t) => ({ ...t, fillFore: rgb(a.fillFore!) }) },
        { label: "Background Color", shown: has("fillBack") ? swatch(a.fillBack!) : null, put: (t) => ({ ...t, fillBack: rgb(a.fillBack!) }) },
        {
          label: "Opacity",
          shown: has("fillOpacity") || has("penOpacity") ? `${a.fillOpacity ?? 100}% fill, ${a.penOpacity ?? 100}% pen` : null,
          put: (t) => ({ ...t, opacity: [a.fillOpacity ?? 100, a.penOpacity ?? 100] }),
        },
      ],
    },
    {
      label: "Pen Attributes",
      items: [
        { label: "Style", shown: has("lineStyle") ? styleName(false, a.lineStyle!) : null, put: (t) => ({ ...t, lineStyle: a.lineStyle }) },
        { label: "Foreground Color", shown: has("penFore") ? swatch(a.penFore!) : null, put: (t) => ({ ...t, penFore: rgb(a.penFore!) }) },
        { label: "Background Color", shown: has("penBack") ? swatch(a.penBack!) : null, put: (t) => ({ ...t, penBack: rgb(a.penBack!) }) },
        {
          label: "Line Weight",
          shown: has("lineWeight") ? `${Math.round(a.lineWeight! * 0.0254 * 100) / 100} mm` : null,
          put: (t) => ({ ...t, lineMils: a.lineWeight }),
        },
      ],
    },
    {
      label: "Text Attributes",
      items: [
        { label: "Size", shown: text ? `${Math.round(text.pts * 10) / 10} pt` : null, put: (t) => ({ ...t, textSize: text?.pts }) },
        {
          label: "Alignment",
          shown: text ? `${H_ALIGN[text.h - 1] ?? "Left"}, ${V_ALIGN[text.v - 1] ?? "Top"}` : null,
          put: (t) => (text ? { ...t, textAlign: { h: text.h, v: text.v } } : t),
        },
      ],
    },
    {
      label: "Other Attributes",
      items: [
        { label: "Class", shown: className.includes("'") ? null : className, put: (t) => ({ ...t, className }) },
        { label: "Layer", shown: layerName.includes("'") ? null : layerName, put: (t) => ({ ...t, layerName }) },
        { label: "Tool", shown: tool === null ? null : toolLabel, put: (t) => (tool === null ? t : { ...t, tool }) },
      ],
    },
  ];
}

/** A group's rows: All, ticking or clearing the group (a dash when some are ticked), and an item each. */
function groupRows(g: Group): { readonly el: HTMLElement; readonly ticked: () => Item[] } {
  const boxes = g.items.map((item) => {
    const box = h("input", { attrs: { type: "checkbox", "aria-label": `${g.label}: ${item.label}` } });
    box.checked = item.shown !== null;
    box.disabled = item.shown === null;
    const shown = item.shown ?? "not set";
    return {
      item,
      box,
      row: h(
        "label",
        { cls: "menu-dialog-check ct-item" },
        box,
        h("span", { text: item.label }),
        h("span", { cls: "muted ct-value" }, shown),
      ),
    };
  });
  const all = h("input", { attrs: { type: "checkbox", "aria-label": `${g.label}: All` } });
  const live = boxes.filter((b) => !b.box.disabled);
  const sync = (): void => {
    const on = live.filter((b) => b.box.checked).length;
    all.checked = live.length > 0 && on === live.length;
    all.indeterminate = on > 0 && on < live.length;
  };
  all.disabled = live.length === 0;
  // Vectorworks' All: a dash or an empty box ticks every one; a tick clears them
  all.addEventListener("change", () => {
    const tick = live.some((b) => !b.box.checked);
    for (const b of live) b.box.checked = tick;
    sync();
  });
  for (const b of live) b.box.addEventListener("change", sync);
  sync();
  return {
    el: h(
      "fieldset",
      { cls: "ct-group" },
      h("legend", { text: g.label }),
      h("label", { cls: "menu-dialog-check ct-all" }, all, h("span", { text: "All" })),
      ...boxes.map((b) => b.row),
    ),
    ticked: () => boxes.filter((b) => b.box.checked && !b.box.disabled).map((b) => b.item),
  };
}

/** Opens Custom Tools for the one object selected, or for new objects' settings with none, and keeps its script. */
export async function customToolDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  if (store.selection.size > 1) {
    toast("Custom Tool/Attribute records one object's attributes: select one, or none to record what new objects are drawn with.", "info");
    return;
  }
  const [id] = store.selection;
  const obj: ObjectInfo | null = id ? doc.object(id) : null;
  const layerOf = (layerId: string): { name: string; scale: number } | undefined => doc.layers().find((l) => l.id === layerId);
  const layer = layerOf(obj?.layerId ?? store.activeLayerId ?? "");
  const className = obj ? obj.className || "None" : (doc.classes().find((c) => c.index === store.activeClassIndex)?.name ?? "None");
  let text: { pts: number; h: number; v: number } | null = { pts: textDefaults.paperHeight / MM_PER_POINT, h: textDefaults.align.h, v: textDefaults.align.v };
  if (obj) {
    const s = obj.shape;
    text = s?.kind === "text" && s.textSize && layer?.scale ? { pts: s.textSize / layer.scale / MM_PER_POINT, h: s.hAlign ?? 1, v: s.vAlign ?? 1 } : null;
  }
  const groups = groupsOf(obj ? (obj.attrs ?? null) : store.drawAttrs, className, layer?.name ?? "", text);
  const rows = groups.map(groupRows);
  const language = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Script" } },
    ...SCRIPT_MODES.filter((m) => m.id !== "now").map((m) => h("option", { value: m.id, text: m.label })),
  );
  const done = await showDialog<{ code: string; language: "python" | "vectorscript" }>({
    title: "Custom Tools",
    okLabel: "OK",
    cls: "ct-dialog",
    body: [
      h("p", { cls: "muted", text: obj ? "Record the selected object's attributes:" : "Record the attributes new objects are drawn with:" }),
      h("div", { cls: "ct-groups" }, ...rows.map((r) => r.el)),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Script" }), language),
    ],
    check: () => {
      const items = rows.flatMap((r) => r.ticked());
      if (!items.length) return { error: "Tick what the script should record." };
      const recorded = items.reduce<ToolAttributes>((a, item) => item.put(a), {});
      const lang = language.value === "python" ? "python" : "vectorscript";
      return { value: { code: toolAttributeScript(lang, recorded), language: lang } };
    },
  });
  if (!done) return;
  const { addScript } = await import("../features/python/scriptPalettes.ts");
  await addScript(done.language, done.code, "Custom Tool");
}
